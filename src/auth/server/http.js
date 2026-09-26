import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { normalizeEmail, validateCredentials, validEmail, validPassword, validateProfile } from '../validation.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { unavailableMailer, accountMail } from './mail.js';
import { receivePhoto } from './photos.js';

export const SESSION_TTL_MS = 7 * 86400_000;
export const SESSION_IDLE_MS = 86400_000;
const ANONYMOUS_TTL_MS = 20 * 60_000;
export const MAX_PENDING_RECOVERY = 20;
const tokenHash = token => createHash('sha256').update(`session:${token}`).digest('hex');
const csrfFor = token => createHash('sha256').update(`csrf:${token}`).digest('base64url');
const actionHash = token => createHash('sha256').update(`account-action:${token}`).digest('hex');
const loopback = ip => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);
const localHost = name => ['localhost', '127.0.0.1', '[::1]'].includes(name);
const fail = (code, status = 400) => Object.assign(new Error(code), { status });
const ROUTE_ALIASES = Object.freeze({ '/api/account/verification': '/api/account/email/verification',
  '/api/account/email': '/api/account/email/change', '/api/auth/forgot-password': '/api/auth/password/forgot',
  '/api/auth/reset-password': '/api/auth/password/reset', '/api/auth/verify-email': '/api/auth/email/verify',
  '/api/auth/confirm-email': '/api/auth/email/change/confirm' });
const publicUser = user => ({ id: user.id ?? user.user_id, email: user.email,
  displayName: user.display_name, role: user.role, createdAt: user.user_created_at ?? user.created_at,
  emailVerified: Boolean(user.email_verified), bio: user.bio, avatar: user.avatar, avatarColor: user.avatar_color,
  lastLoginAt: user.last_login_at, passwordChangedAt: user.password_changed_at, photoVersion: user.photo_version ?? null });

export function sessionLabel(raw = '') {
  const ua = String(raw).slice(0, 512);
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /(?:Chrome|CriOS)\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const platform = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows'
    : /Macintosh|Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return platform ? `${browser} on ${platform}` : browser === 'Browser' ? 'Unknown browser' : browser;
}

export function parseOrigins(value = '') {
  return value.split(',').map(x => x.trim()).filter(Boolean).map(raw => {
    const url = new URL(raw);
    if (url.origin !== raw || (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHost(url.hostname)))) {
      throw new Error('AUTH_ORIGINS must contain exact HTTPS origins (HTTP only for localhost)');
    }
    return url.origin;
  });
}

function expectedOrigin(req, origins) {
  const host = req.headers.host;
  if (typeof host !== 'string' || /[\s/\\@?#]/.test(host)) throw fail('origin_denied', 403);
  // The configured public origin is authoritative. Never trust forwarded Host/Proto.
  const configured = origins.find(value => new URL(value).host === host.toLowerCase());
  if (configured) return configured;
  let url;
  try { url = new URL(`http://${host}`); } catch { throw fail('origin_denied', 403); }
  if (localHost(url.hostname) && loopback(req.socket.remoteAddress)) return `${req.socket.encrypted ? 'https:' : 'http:'}//${url.host}`;
  throw fail('origin_denied', 403);
}

function cookieToken(req, name) {
  const matches = String(req.headers.cookie || '').split(';').map(x => x.trim()).filter(x => x.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(name.length + 1);
  return /^[\w-]{43}$/.test(token) ? token : null;
}

function writeCookie(res, name, token, secure, ttlMs) {
  res.setHeader('Set-Cookie', `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ttlMs / 1000)}${secure ? '; Secure' : ''}`);
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')) throw fail('json_required', 415);
  if (req.headers['content-encoding'] || Number(req.headers['content-length']) > 8192) throw fail('body_too_large', 413);
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const cleanup = () => { clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', error); req.off('aborted', aborted); };
    const stop = err => { cleanup(); req.resume(); reject(err); };
    const timer = setTimeout(() => stop(fail('request_timeout', 408)), 10000);
    const error = () => stop(fail('invalid_input'));
    const aborted = () => stop(fail('invalid_input'));
    const data = chunk => { size += chunk.length; if (size > 8192) stop(fail('body_too_large', 413)); else chunks.push(chunk); };
    const end = () => {
      cleanup();
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
        resolve(body);
      } catch { reject(fail('invalid_input')); }
    };
    req.on('data', data); req.on('end', end); req.on('error', error); req.on('aborted', aborted);
  });
}

/** Framework-free controllers plus reusable authentication / CSRF middleware. */
export function createAuthService({ store, origins = [], trustProxy = false, now = Date.now,
  passwords = { hash: hashPassword, verify: verifyPassword }, mailer = unavailableMailer }) {
  let lastPrune = 0;
  const pendingRecovery = new Set();
  const mailConfigured = mailer.configured === true && typeof mailer.send === 'function' && Boolean(mailer.publicUrl);
  const capabilities = Object.freeze({ mailConfigured, emailVerification: mailConfigured,
    passwordReset: mailConfigured, emailChange: mailConfigured, passwordChange: true, sessionManagement: true, accountExport: true });
  function context(req, res, { mutation = false, required = false } = {}) {
    const origin = expectedOrigin(req, origins);
    if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== origin)
      || (mutation && req.headers.origin !== origin)) throw fail('origin_denied', 403);
    const secure = origin.startsWith('https:');
    const name = secure ? '__Host-oko_session' : 'oko_session';
    const token = cookieToken(req, name);
    const hash = token && tokenHash(token);
    const time = now();
    if (time - lastPrune > 60_000) { store.prune(time, SESSION_IDLE_MS); lastPrune = time; }
    const session = hash ? store.findSession(hash, time, SESSION_IDLE_MS) : null;
    if (token && !session) writeCookie(res, name, '', secure, 0);
    if (required && !session?.user_id) throw fail('authentication_required', 401);
    if (mutation) {
      const supplied = req.headers['x-csrf-token'];
      const expected = token ? csrfFor(token) : '';
      if (!session || typeof supplied !== 'string' || !/^[\w-]{43}$/.test(supplied) || supplied.length !== expected.length
        || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw fail('csrf_failed', 403);
    }
    if (session) store.touchSession(hash, time);
    let ip = req.socket.remoteAddress || 'unknown';
    if (trustProxy && loopback(ip) && isIP(req.headers['cf-connecting-ip'] || '')) ip = req.headers['cf-connecting-ip'];
    return { secure, name, token, hash: session ? hash : null, session, time, ip, res, label: sessionLabel(req.headers['user-agent']) };
  }
  function rate(ctx, bucket, identity, count, ms = 15 * 60_000) {
    const key = createHash('sha256').update(`${bucket}:${identity}`).digest('hex');
    const retry = store.consume(key, count, ms, ctx.time);
    if (retry) { ctx.res.setHeader('Retry-After', String(retry)); throw fail('rate_limited', 429); }
  }
  function rotate(ctx, userId) {
    const token = randomBytes(32).toString('base64url');
    const ttl = userId ? SESSION_TTL_MS : ANONYMOUS_TTL_MS;
    store.rotateSession(ctx.hash, tokenHash(token), userId, now(), ttl, ctx.label);
    writeCookie(ctx.res, ctx.name, token, ctx.secure, ttl);
    return csrfFor(token);
  }
  function clearCookie(ctx) { writeCookie(ctx.res, ctx.name, '', ctx.secure, 0); }
  function active(ctx) {
    const session = store.findSession(ctx.hash, now(), SESSION_IDLE_MS);
    if (!session || session.user_id !== ctx.session?.user_id) throw fail('csrf_failed', 403);
    return session;
  }
  function unchanged(user) {
    const current = store.userById(user.id);
    if (!current || current.credential_version !== user.credential_version || current.password_hash !== user.password_hash
      || current.email !== user.email) throw fail('credentials_changed', 409);
    return current;
  }
  function fields(body, allowed) {
    if (Object.keys(body).some(key => !allowed.includes(key))) throw fail('invalid_input');
  }
  function credentialRate(ctx, identity) {
    rate(ctx, 'credentials-ip', ctx.ip, 40);
    rate(ctx, 'credentials-global', 'all', 200);
    rate(ctx, 'credentials-email', identity, 10);
  }
  async function reauthenticate(ctx, password) {
    credentialRate(ctx, ctx.session.email);
    if (typeof password !== 'string' || !password.length || [...password].length > 128) throw fail('invalid_current_password', 401);
    const user = store.userById(ctx.session.user_id);
    if (!await passwords.verify(password, user?.password_hash)) throw fail('invalid_current_password', 401);
    return user;
  }
  function requireMail() { if (!mailConfigured) throw fail('mail_unavailable', 503); }
  function mailRate(ctx, identity) {
    rate(ctx, 'mail-ip', ctx.ip, 20, 3600_000);
    rate(ctx, 'mail-global', 'all', 100, 3600_000);
    rate(ctx, 'mail-identity', identity, 5, 3600_000);
  }
  async function deliver(ctx, user, purpose, email, { anonymous = false } = {}) {
    const token = randomBytes(32).toString('base64url');
    const hash = actionHash(token);
    store.transaction(() => {
      active(ctx);
      unchanged(user);
      store.prepareToken(hash, user, purpose, email, now(), purpose === 'verify' ? 86400_000 : 30 * 60_000);
    });
    try {
      await mailer.send(accountMail(mailer.publicUrl, email, purpose, token));
      store.transaction(() => {
        // Activate only the latest delivery under the same persisted credentials.
        // A late result cannot overwrite a newer send or revive a revoked token.
        if (store.activateToken(hash, now())) store.event(user.id,
          { verify: 'verification_requested', reset: 'password_reset_requested', email: 'email_change_requested' }[purpose], now());
      });
    } catch {
      store.deletePendingToken(hash);
      // Recovery requests give the same public result for absent accounts and delivery failures.
      if (!anonymous) throw fail('mail_unavailable', 503);
    }
  }
  function dispatchRecovery(ctx, user, email) {
    // The request must never wait for the mail gateway: its latency (or outage)
    // would expose whether the email exists. Delivery is bounded by the adapter's
    // timeout and the persistent global mail limit. Track it for graceful shutdown.
    if (pendingRecovery.size >= MAX_PENDING_RECOVERY) return;
    const pending = deliver(ctx, user, 'reset', email, { anonymous: true });
    pendingRecovery.add(pending);
    void pending.catch(() => {}).finally(() => pendingRecovery.delete(pending));
  }
  function oneTime(body, purpose) {
    if (typeof body.token !== 'string' || !/^[\w-]{43}$/.test(body.token)) throw fail('invalid_token');
    const token = store.findToken(actionHash(body.token), purpose, now());
    if (!token) throw fail('invalid_token');
    return token;
  }
  function sendError(res, error) {
    const status = error.status || 500;
    if ([408, 413].includes(status)) res.setHeader('Connection', 'close');
    if (status === 503) res.setHeader('Retry-After', '3');
    json(res, status, { error: error.status ? error.message : 'server_error' });
  }
  const requireAuthenticated = (req, res, next) => {
    try {
      const ctx = context(req, res, { required: true, mutation: !['GET', 'HEAD', 'OPTIONS'].includes(req.method) });
      req.auth = { user: publicUser(ctx.session) };
      res.setHeader('Cache-Control', 'no-store');
      next();
    } catch (error) { sendError(res, error); }
  };
  async function middleware(req, res, next) {
    const requestedPath = (req.url || '').split('?')[0];
    const pathname = Object.hasOwn(ROUTE_ALIASES, requestedPath) ? ROUTE_ALIASES[requestedPath] : requestedPath;
    if (!(pathname === '/api/account' || pathname.startsWith('/api/account/') || pathname === '/api/auth' || pathname.startsWith('/api/auth/'))) return next();
    try {
      let sessionId = /^\/api\/account\/sessions\/([a-f0-9-]{36})$/.exec(pathname)?.[1];
      const routes = { '/api/auth/session': ['GET'], '/api/auth/csrf': ['GET'], '/api/auth/register': ['POST'],
        '/api/auth/login': ['POST'], '/api/auth/logout': ['POST'], '/api/account': ['GET', 'PATCH'],
        '/api/account/password': ['POST'], '/api/account/security': ['GET'], '/api/account/export': ['GET'],
        '/api/account/photo': ['GET', 'PUT', 'DELETE'],
        '/api/account/sessions/revoke-others': ['POST'], '/api/account/sessions/revoke': ['POST'], '/api/account/email/verification': ['POST'],
        '/api/account/email/change': ['POST'], '/api/auth/email/verify': ['POST'],
        '/api/auth/password/forgot': ['POST'], '/api/auth/password/reset': ['POST'],
        '/api/auth/email/change/confirm': ['POST'], ...(sessionId ? { [pathname]: ['DELETE'] } : {}) };
      if (!routes[pathname]) throw fail('not_found', 404);
      if (!routes[pathname].includes(req.method)) { res.setHeader('Allow', routes[pathname].join(', ')); throw fail('method_not_allowed', 405); }
      const mutation = req.method !== 'GET';
      const ctx = context(req, res, { mutation, required: pathname === '/api/account' || pathname.startsWith('/api/account/') });
      rate(ctx, 'requests', ctx.ip, 300, 60_000);
      if (pathname === '/api/auth/session') {
        return json(res, 200, { user: ctx.session?.user_id ? publicUser(ctx.session) : null,
          csrfToken: ctx.session ? csrfFor(ctx.token) : null, capabilities });
      }
      if (pathname === '/api/auth/csrf') {
        if (!ctx.session) { rate(ctx, 'bootstrap', ctx.ip, 30); rate(ctx, 'bootstrap-global', 'all', 500); }
        return json(res, 200, { csrfToken: ctx.session ? csrfFor(ctx.token) : rotate(ctx, null) });
      }
      if (pathname === '/api/account' && req.method === 'GET') return json(res, 200, { user: publicUser(ctx.session) });
      if (['/api/account/security', '/api/account/export'].includes(pathname)) {
        const security = store.security(ctx.session.user_id, ctx.hash, now(), SESSION_IDLE_MS);
        return json(res, 200, pathname.endsWith('/export') ? { exportedAt: now(), user: publicUser(ctx.session), ...security } : security);
      }
      if (pathname === '/api/account/photo') {
        if (req.method === 'GET') {
          const photo = store.photo(ctx.session.user_id);
          if (!photo) throw fail('photo_not_found', 404);
          res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': photo.length,
            'Cache-Control': 'private, no-store', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
            'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': 'inline; filename="avatar.webp"' });
          return res.end(Buffer.from(photo));
        }
        rate(ctx, 'photo-user', ctx.session.user_id, 15);
        rate(ctx, 'photo-global', 'all', 150);
        let bytes = null;
        if (req.method === 'PUT') bytes = await receivePhoto(req);
        else fields(await readJson(req), []);
        const user = store.transaction(() => {
          active(ctx);
          if (req.aborted) throw fail('photo_invalid');
          const result = store.setPhoto(ctx.session.user_id, bytes, now());
          store.event(result.id, bytes ? 'photo_updated' : 'photo_removed', now());
          return result;
        });
        return json(res, 200, { user: publicUser(user) });
      }
      const body = await readJson(req);
      if (requestedPath === '/api/auth/reset-password') {
        fields(body, ['token', 'password']);
        body.newPassword = body.password;
        delete body.password;
      }
      if (pathname === '/api/account/sessions/revoke') {
        fields(body, ['id']);
        if (typeof body.id !== 'string' || !/^[a-f0-9-]{36}$/.test(body.id)) throw fail('invalid_input');
        sessionId = body.id;
        delete body.id;
      }
      // readJson and password derivation yield to other requests. Never authorize a
      // write solely from the session/hash snapshot taken before either await.
      active(ctx);
      if (pathname === '/api/auth/logout') {
        fields(body, []);
        store.transaction(() => {
          active(ctx);
          store.deleteSession(ctx.hash);
          if (ctx.session.user_id) store.event(ctx.session.user_id, 'logout', now());
        });
        clearCookie(ctx);
        return json(res, 200, { user: null, csrfToken: null });
      }
      if (pathname === '/api/account') {
        rate(ctx, 'profile', ctx.session.user_id, 30);
        const validation = validateProfile(body);
        if (validation) throw fail(validation);
        const user = store.transaction(() => {
          active(ctx);
          const user = store.updateProfile(ctx.session.user_id, { ...body, ...('displayName' in body ? { displayName: body.displayName.trim() } : {}) });
          store.event(user.id, 'profile_updated', now());
          return user;
        });
        return json(res, 200, { user: publicUser(user) });
      }
      if (sessionId || pathname === '/api/account/sessions/revoke-others') {
        fields(body, []);
        rate(ctx, 'sessions', ctx.session.user_id, 30);
        const result = store.transaction(() => {
          active(ctx);
          if (sessionId) {
            if (!store.revokeSession(sessionId, ctx.session.user_id)) throw fail('session_not_found', 404);
            store.event(ctx.session.user_id, 'session_revoked', now());
            return { revoked: true, current: sessionId === ctx.session.session_id };
          }
          const revoked = store.deleteUserSessions(ctx.session.user_id, ctx.hash);
          store.event(ctx.session.user_id, 'other_sessions_revoked', now());
          return { revoked };
        });
        if (result.current) { clearCookie(ctx); Object.assign(result, { user: null, csrfToken: null }); }
        return json(res, 200, result);
      }
      if (pathname === '/api/account/password') {
        fields(body, ['currentPassword', 'newPassword']);
        if (!validPassword(body.newPassword)) throw fail('invalid_password');
        const user = await reauthenticate(ctx, body.currentPassword);
        if (body.currentPassword === body.newPassword) throw fail('password_unchanged');
        const passwordHash = await passwords.hash(body.newPassword);
        const result = store.transaction(() => {
          active(ctx); unchanged(user);
          store.changePassword(user.id, passwordHash, now());
          store.deleteUserSessions(user.id, ctx.hash);
          store.deleteUserTokens(user.id);
          store.event(user.id, 'password_changed', now());
          return { user: publicUser(store.userById(user.id)), csrfToken: rotate(ctx, user.id) };
        });
        return json(res, 200, result);
      }
      if (pathname === '/api/account/email/verification') {
        fields(body, []); requireMail(); mailRate(ctx, ctx.session.email);
        const user = store.userById(ctx.session.user_id);
        if (!user.email_verified) await deliver(ctx, user, 'verify', user.email);
        return json(res, 200, { accepted: true });
      }
      if (pathname === '/api/account/email/change') {
        fields(body, ['email', 'currentPassword']); requireMail();
        if (!validEmail(body.email)) throw fail('invalid_email');
        const email = normalizeEmail(body.email);
        const user = await reauthenticate(ctx, body.currentPassword);
        mailRate(ctx, user.email);
        if (store.userByEmail(email)) throw fail('email_unavailable', 409);
        await deliver(ctx, user, 'email', email);
        return json(res, 200, { accepted: true });
      }
      if (pathname === '/api/auth/password/forgot') {
        fields(body, ['email']); requireMail();
        if (!validEmail(body.email)) throw fail('invalid_email');
        const email = normalizeEmail(body.email);
        mailRate(ctx, email);
        const user = store.userByEmail(email);
        if (user) dispatchRecovery(ctx, user, email);
        return json(res, 200, { accepted: true });
      }
      if (['/api/auth/email/verify', '/api/auth/password/reset', '/api/auth/email/change/confirm'].includes(pathname)) {
        const purpose = pathname.endsWith('/reset') ? 'reset' : pathname.endsWith('/verify') ? 'verify' : 'email';
        fields(body, purpose === 'reset' ? ['token', 'newPassword'] : ['token']);
        rate(ctx, 'token-ip', ctx.ip, 30);
        // Confirmation of an already-delivered token works during a mail outage.
        const token = oneTime(body, purpose);
        let passwordHash;
        if (purpose === 'reset') {
          if (!validPassword(body.newPassword)) throw fail('invalid_password');
          rate(ctx, 'reset-user', token.user_id, 10);
          passwordHash = await passwords.hash(body.newPassword);
        }
        store.transaction(() => {
          active(ctx);
          const current = oneTime(body, purpose);
          const user = store.userById(current.user_id);
          if (purpose !== 'email' && current.email !== user.email) throw fail('invalid_token');
          if (purpose === 'verify') {
            store.verifyEmail(user.id);
            store.deleteToken(current.token_hash);
            store.event(user.id, 'email_verified', now());
          } else {
            if (purpose === 'reset') store.changePassword(user.id, passwordHash, now());
            else {
              if (store.userByEmail(current.email)) throw fail('email_unavailable', 409);
              store.changeEmail(user.id, current.email);
            }
            store.deleteUserSessions(user.id);
            store.deleteUserTokens(user.id);
            // Also discard the caller's anonymous (or other-account) context.
            store.deleteSession(ctx.hash);
            store.event(user.id, purpose === 'reset' ? 'password_reset' : 'email_changed', now());
          }
        });
        if (purpose === 'verify') return json(res, 200, { verified: true });
        clearCookie(ctx);
        return json(res, 200, { [purpose === 'reset' ? 'reset' : 'changed']: true, user: null, csrfToken: null });
      }
      const register = pathname === '/api/auth/register';
      rate(ctx, 'credentials-ip', ctx.ip, 40);
      rate(ctx, 'credentials-global', 'all', 200);
      const validation = validateCredentials(body, register);
      if (validation) throw fail(validation);
      const email = normalizeEmail(body.email);
      rate(ctx, 'credentials-email', email, 10);
      let result;
      if (register) {
        // Hash before UNIQUE conflict handling: no cheap existing-account path.
        const hash = await passwords.hash(body.password);
        result = store.transaction(() => {
          active(ctx);
          const user = store.createUser(email, body.displayName.trim(), hash, now());
          if (!user) throw fail('registration_failed', 409);
          store.recordLogin(user.id, now());
          store.event(user.id, 'registered', now());
          return { user: publicUser(store.userById(user.id)), csrfToken: rotate(ctx, user.id) };
        });
      } else {
        const user = store.userByEmail(email);
        if (!await passwords.verify(body.password, user?.password_hash)) throw fail('invalid_credentials', 401);
        result = store.transaction(() => {
          active(ctx); unchanged(user);
          store.recordLogin(user.id, now());
          store.event(user.id, 'login', now());
          return { user: publicUser(store.userById(user.id)), csrfToken: rotate(ctx, user.id) };
        });
      }
      json(res, register ? 201 : 200, result);
    } catch (error) { sendError(res, error); }
  }
  return { middleware, requireAuthenticated, close: async () => { await Promise.allSettled([...pendingRecovery]); } };
}
