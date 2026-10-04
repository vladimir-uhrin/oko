import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { normalizeEmail, validateCredentials, validEmail, validName, validPassword, validateProfile } from '../validation.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { unavailableMailer, accountMail } from './mail.js';
import { receivePhoto } from './photos.js';
import { FOLLOW_MAX, sanitizeFollow, validFollowKey } from '../follows.js';
import {
  OAUTH_STATE_TTL_MS, authorizeUrl, createOAuthStateStore, fetchOAuthIdentity, safeReturnPath, withQueryParam,
} from './oauth.js';
import { createAdminRoutes } from './admin.js';

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
  passwords = { hash: hashPassword, verify: verifyPassword }, mailer = unavailableMailer,
  oauthProviders = {}, oauthFetch = (...args) => globalThis.fetch(...args), adminSources = {}, ownerEmails = [] }) {
  let lastPrune = 0;
  // Jedno vlastníctvo (2026-10-03): admin pustí rolu `owner` z DB AJ účty z OKO_OWNER_EMAILS (udalosti).
  // 2026-10-04: e-mail z OKO_OWNER_EMAILS platí len pre OVERENÝ účet — registrácia e-mail neoveruje, takže
  // neobsadenú adresu vlastníka by si inak mohol zaregistrovať ktokoľvek a dostať admin.
  const isOwnerSession = session => Boolean(session?.user_id && (session.role === 'owner'
    || (session.email_verified && ownerEmails.includes(String(session.email || '').toLowerCase()))));
  const handleAdmin = createAdminRoutes({ store, now, idleMs: SESSION_IDLE_MS, sources: adminSources, isOwnerSession });
  const pendingRecovery = new Set();
  const oauthStates = createOAuthStateStore({ now });
  const mailConfigured = mailer.configured === true && typeof mailer.send === 'function' && Boolean(mailer.publicUrl);
  const capabilities = Object.freeze({ mailConfigured, emailVerification: mailConfigured,
    passwordReset: mailConfigured, emailChange: mailConfigured, passwordChange: true, sessionManagement: true, accountExport: true,
    // Prihlásenie cez Google/GitHub (2026-09-27): len poskytovatelia s ID aj tajomstvom v .env.
    oauth: Object.freeze({ google: Boolean(oauthProviders.google), github: Boolean(oauthProviders.github) }) });
  function context(req, res, { mutation = false, required = false, providerReturn = false } = {}) {
    const origin = expectedOrigin(req, origins);
    // Návrat od poskytovateľa (OAuth callback) je z podstaty cross-site navigácia GET; chráni ho
    // jednorazový state + nonce v cookie, nie Sec-Fetch-Site. Host sa overuje vždy (expectedOrigin).
    if (!providerReturn && (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== origin)
      || (mutation && req.headers.origin !== origin))) throw fail('origin_denied', 403);
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
    return { origin, secure, name, token, hash: session ? hash : null, session, time, ip, res, label: sessionLabel(req.headers['user-agent']) };
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
  // ── Prihlásenie cez Google/GitHub (2026-09-27) ────────────────────────────────
  const oauthCookie = secure => (secure ? '__Host-oko_oauth' : 'oko_oauth');
  /** Presmerovanie prehliadača (303) bez cache a bez referera — URL s kódom nikam neunikne. */
  function redirect(res, location) {
    res.statusCode = 303;
    res.setHeader('Location', location);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.end();
  }
  /** Pridá Set-Cookie k už nastaveným (session cookie z rotate()). */
  function appendCookie(res, name, value, secure, ttlMs) {
    const cookie = `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ttlMs / 1000)}${secure ? '; Secure' : ''}`;
    const previous = res.getHeader('Set-Cookie');
    res.setHeader('Set-Cookie', previous ? [].concat(previous, cookie) : cookie);
  }
  const oauthName = (identity, email) => {
    const name = String(identity.name || '').trim();
    if (validName(name)) return [...name].slice(0, 80).join('');
    const local = String(email || '').split('@')[0];
    return validName(local) ? [...local].slice(0, 80).join('') : 'OKO';
  };
  async function oauthStart(req, res, providerId) {
    const url = new URL(req.url || '/', 'http://localhost');
    const returnTo = safeReturnPath(url.searchParams.get('return'));
    const provider = oauthProviders[providerId];
    if (!provider) return redirect(res, withQueryParam(returnTo, 'auth_error', 'oauth_unavailable'));
    const ctx = context(req, res);
    try {
      rate(ctx, 'oauth-start-ip', ctx.ip, 30);
      rate(ctx, 'oauth-start-global', 'all', 600);
      const wantsLink = url.searchParams.get('link') === '1';
      const linkUserId = wantsLink ? ctx.session?.user_id || null : null;
      if (wantsLink && !linkUserId) throw fail('authentication_required', 401);
      const begun = oauthStates.begin({ provider: providerId, returnTo, linkUserId });
      if (!begun) throw fail('rate_limited', 429);
      appendCookie(res, oauthCookie(ctx.secure), begun.nonce, ctx.secure, OAUTH_STATE_TTL_MS);
      return redirect(res, authorizeUrl(provider, {
        redirectUri: `${ctx.origin}/api/auth/oauth/${providerId}/callback`, state: begun.state, verifier: begun.verifier,
      }));
    } catch (error) {
      return redirect(res, withQueryParam(returnTo, 'auth_error', error.status ? error.message : 'server_error'));
    }
  }
  async function oauthCallback(req, res, providerId) {
    const url = new URL(req.url || '/', 'http://localhost');
    const ctx = context(req, res, { providerReturn: true });
    let returnTo = '/';
    try {
      rate(ctx, 'oauth-callback-ip', ctx.ip, 30);
      const entry = oauthStates.take({
        state: url.searchParams.get('state'), nonce: cookieToken(req, oauthCookie(ctx.secure)), provider: providerId,
      });
      const provider = oauthProviders[providerId];
      if (!entry || !provider) throw fail('oauth_state');
      returnTo = entry.returnTo;
      if (url.searchParams.get('error')) throw fail('oauth_cancelled');
      const identity = await fetchOAuthIdentity(provider, {
        code: url.searchParams.get('code'), verifier: entry.verifier, fetchImpl: oauthFetch,
        redirectUri: `${ctx.origin}/api/auth/oauth/${providerId}/callback`,
      });
      const email = identity.email && validEmail(identity.email) ? normalizeEmail(identity.email) : null;
      const outcome = store.transaction(() => {
        // Po await: stav session čítať nanovo, nie zo snímky pred sieťou.
        const session = ctx.hash ? store.findSession(ctx.hash, now(), SESSION_IDLE_MS) : null;
        const existing = store.identity(identity.provider, identity.subject);
        if (entry.linkUserId) {
          if (session?.user_id !== entry.linkUserId) throw fail('oauth_link_session', 409);
          if (existing && existing.user_id !== entry.linkUserId) throw fail('oauth_identity_in_use', 409);
          if (!existing) {
            if (!store.linkIdentity(entry.linkUserId, identity.provider, identity.subject, email, now())) throw fail('oauth_provider_linked', 409);
            store.event(entry.linkUserId, `${identity.provider}_linked`, now());
          }
          return { marker: `${providerId}-linked` };
        }
        if (existing) {
          if (store.userById(existing.user_id)?.disabled_at) throw fail('account_disabled', 403);
          store.recordLogin(existing.user_id, now());
          store.event(existing.user_id, `login_${identity.provider}`, now());
          rotate(ctx, existing.user_id);
          return { marker: providerId };
        }
        if (!email || !identity.emailVerified) throw fail('oauth_email_unverified', 409);
        // Existujúci účet s tým istým e-mailom sa NEPREPÁJA automaticky — lokálny e-mail nemusí byť
        // overený (niekto by si mohol vopred založiť účet s cudzou adresou). Prepojiť ho môže
        // majiteľ po prihlásení heslom (link=1).
        if (store.userByEmail(email)) throw fail('oauth_email_exists', 409);
        const user = store.createOAuthUser(email, oauthName(identity, email), identity.provider, identity.subject, now());
        if (!user) throw fail('oauth_email_exists', 409);
        store.recordLogin(user.id, now());
        store.event(user.id, `registered_${identity.provider}`, now());
        rotate(ctx, user.id);
        return { marker: providerId };
      });
      appendCookie(res, oauthCookie(ctx.secure), '', ctx.secure, 0);
      return redirect(res, withQueryParam(returnTo, 'auth', outcome.marker));
    } catch (error) {
      appendCookie(res, oauthCookie(ctx.secure), '', ctx.secure, 0);
      return redirect(res, withQueryParam(returnTo, 'auth_error', error.status ? error.message : 'server_error'));
    }
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
    const adminRoute = pathname === '/api/admin' || pathname.startsWith('/api/admin/');
    if (!(adminRoute || pathname === '/api/account' || pathname.startsWith('/api/account/') || pathname === '/api/auth' || pathname.startsWith('/api/auth/'))) return next();
    try {
      if (adminRoute) {
        const ctx = context(req, res, { mutation: !['GET', 'HEAD'].includes(req.method) });
        return await handleAdmin(pathname, req, res, ctx, { json, readJson, fail, fields, active, rate });
      }
      const oauthRoute = /^\/api\/auth\/oauth\/(google|github)\/(start|callback)$/.exec(pathname);
      if (oauthRoute) {
        if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); throw fail('method_not_allowed', 405); }
        return oauthRoute[2] === 'start' ? await oauthStart(req, res, oauthRoute[1]) : await oauthCallback(req, res, oauthRoute[1]);
      }
      let sessionId = /^\/api\/account\/sessions\/([a-f0-9-]{36})$/.exec(pathname)?.[1];
      const routes = { '/api/auth/session': ['GET'], '/api/auth/csrf': ['GET'], '/api/auth/register': ['POST'],
        '/api/auth/login': ['POST'], '/api/auth/logout': ['POST'], '/api/account': ['GET', 'PATCH'],
        '/api/account/password': ['POST'], '/api/account/security': ['GET'], '/api/account/export': ['GET'],
        '/api/account/photo': ['GET', 'PUT', 'DELETE'], '/api/account/follows': ['GET', 'POST', 'DELETE'],
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
        const security = { ...store.security(ctx.session.user_id, ctx.hash, now(), SESSION_IDLE_MS),
          identities: store.identities(ctx.session.user_id) };
        return json(res, 200, pathname.endsWith('/export')
          ? { exportedAt: now(), user: publicUser(ctx.session), ...security, follows: store.follows(ctx.session.user_id) }
          : security);
      }
      // Sledované lety (2026-09-27): len pre prihláseného (required vyššie), zápis s Origin + CSRF.
      if (pathname === '/api/account/follows') {
        if (req.method === 'GET') return json(res, 200, { follows: store.follows(ctx.session.user_id), max: FOLLOW_MAX });
        rate(ctx, 'follows', ctx.session.user_id, 120);
        const body = await readJson(req);
        let item = null;
        if (req.method === 'POST') {
          fields(body, ['hex', 'callsign', 'label']);
          item = sanitizeFollow(body);
          if (!item) throw fail('invalid_flight');
        } else {
          fields(body, ['key']);
          if (!validFollowKey(body.key)) throw fail('invalid_flight');
        }
        const follows = store.transaction(() => {
          active(ctx);
          if (item && !store.addFollow(ctx.session.user_id, item, now(), FOLLOW_MAX)) throw fail('follow_limit', 409);
          if (!item) store.removeFollow(ctx.session.user_id, body.key);
          return store.follows(ctx.session.user_id);
        });
        return json(res, 200, { follows, max: FOLLOW_MAX });
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
        // Až po overení hesla: zablokovanie neprezradí nikomu, kto heslo nepozná.
        if (user.disabled_at) throw fail('account_disabled', 403);
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
  /**
   * Kto je prihlásený (pre iné služby, napr. udalosti len pre vlastníka — 2026-10-03): rovnaké
   * kontroly ako účet (pôvod, cookie relácie, pri zápise CSRF), ale bez odpovede klientovi —
   * vráti `{ id, email }` alebo null; nikdy nevyhodí chybu.
   */
  function identify(req, res, { mutation = false } = {}) {
    try {
      const ctx = context(req, res, { required: true, mutation });
      return { id: ctx.session.user_id, email: String(ctx.session.email || '').toLowerCase(), role: ctx.session.role || 'member',
        emailVerified: Boolean(ctx.session.email_verified) };
    } catch { return null; }
  }
  return { middleware, requireAuthenticated, identify, close: async () => { await Promise.allSettled([...pendingRecovery]); } };
}

/** E-maily vlastníka z `OKO_OWNER_EMAILS` (čiarkou oddelené, malé písmená); prázdne = nikto. Pure. */
export function parseOwnerEmails(raw = '') {
  return [...new Set(String(raw || '').split(/[,\s;]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
}
