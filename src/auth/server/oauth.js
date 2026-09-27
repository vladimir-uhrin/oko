// src/auth/server/oauth.js
/**
 * Prihlásenie cez Google a GitHub (2026-09-27, vlastník: „mohol by si mi vytvoriť aj
 * prihlásenie cez Google a Git, ale v štýle OKO").
 *
 * Tok: autorizačný kód s PKCE (S256) na strane SERVERA — client secret je len v .env, do
 * prehliadača nejde nič okrem presmerovania. `state` je jednorazový, platí 10 min, drží sa
 * v pamäti servera a je naviazaný na prehliadač cez HttpOnly cookie s náhodným nonce
 * (ochrana proti podvrhnutiu prihlásenia — login CSRF). Návratová cesta je len lokálna.
 *
 * Tento modul nerozhoduje o účtoch — len overí poskytovateľa a vráti identitu
 * {provider, subject, email, emailVerified, name}. Politiku účtov robí http.js.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const OAUTH_STATE_TTL_MS = 10 * 60_000;
export const OAUTH_MAX_PENDING = 2000;
const RESPONSE_LIMIT = 64 * 1024;
const PROVIDER_TIMEOUT_MS = 10_000;

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sha256 = (text) => createHash('sha256').update(text).digest();

/** Konfigurácia poskytovateľov z .env; bez ID a tajomstva poskytovateľ neexistuje. */
export function oauthProvidersFromEnv(env = {}) {
  const providers = {};
  if (env.AUTH_GOOGLE_CLIENT_ID && env.AUTH_GOOGLE_CLIENT_SECRET) {
    providers.google = {
      id: 'google',
      clientId: String(env.AUTH_GOOGLE_CLIENT_ID).trim(),
      clientSecret: String(env.AUTH_GOOGLE_CLIENT_SECRET).trim(),
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scope: 'openid email profile',
    };
  }
  if (env.AUTH_GITHUB_CLIENT_ID && env.AUTH_GITHUB_CLIENT_SECRET) {
    providers.github = {
      id: 'github',
      clientId: String(env.AUTH_GITHUB_CLIENT_ID).trim(),
      clientSecret: String(env.AUTH_GITHUB_CLIENT_SECRET).trim(),
      authorizeUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scope: 'read:user user:email',
    };
  }
  return providers;
}

/**
 * Lokálna návratová cesta po prihlásení — nikdy iný pôvod, nikdy /api. Inak „/".
 * @param {unknown} value
 */
export function safeReturnPath(value) {
  const text = typeof value === 'string' ? value : '';
  if (!text || text.length > 2048 || !text.startsWith('/') || text.startsWith('//') || text.startsWith('/\\')) return '/';
  if (/[\u0000-\u001f\u007f\\]/.test(text)) return '/';
  if (/^\/api(?:\/|$|\?|#)/i.test(text)) return '/';
  return text;
}

/** Pridá do návratovej cesty parameter (pred #hash), napr. auth=google. */
export function withQueryParam(path, key, value) {
  const hashAt = path.indexOf('#');
  const base = hashAt >= 0 ? path.slice(0, hashAt) : path;
  const hash = hashAt >= 0 ? path.slice(hashAt) : '';
  const [pathname, query = ''] = base.split('?');
  const params = new URLSearchParams(query);
  params.delete('auth'); params.delete('auth_error');
  params.set(key, value);
  return `${pathname}?${params.toString()}${hash}`;
}

/**
 * Pamäť rozpracovaných prihlásení (jeden proces servera; reštart ich zahodí — používateľ
 * skúsi znova). Kľúč je hash `state`, nonce sa ukladá ako hash.
 */
export function createOAuthStateStore({ now = Date.now, ttlMs = OAUTH_STATE_TTL_MS, max = OAUTH_MAX_PENDING } = {}) {
  const pending = new Map();
  const prune = () => {
    const time = now();
    for (const [key, value] of pending) if (value.expiresAt <= time) pending.delete(key);
  };
  return {
    /** @returns {{state: string, nonce: string, verifier: string}|null} null = plno */
    begin({ provider, returnTo, linkUserId = null }) {
      prune();
      if (pending.size >= max) return null;
      const state = b64url(randomBytes(32));
      const nonce = b64url(randomBytes(32));
      const verifier = b64url(randomBytes(32));
      pending.set(sha256(`oauth-state:${state}`).toString('hex'), {
        provider, returnTo, linkUserId, verifier,
        nonceHash: sha256(`oauth-nonce:${nonce}`), expiresAt: now() + ttlMs,
      });
      return { state, nonce, verifier };
    },
    /** Jednorazovo vyzdvihne `state`; overí poskytovateľa a nonce z cookie. */
    take({ state, nonce, provider }) {
      if (typeof state !== 'string' || !/^[\w-]{43}$/.test(state)) return null;
      const key = sha256(`oauth-state:${state}`).toString('hex');
      const entry = pending.get(key);
      pending.delete(key);
      if (!entry || entry.expiresAt <= now() || entry.provider !== provider) return null;
      if (typeof nonce !== 'string' || !/^[\w-]{43}$/.test(nonce)) return null;
      const got = sha256(`oauth-nonce:${nonce}`);
      if (!timingSafeEqual(got, entry.nonceHash)) return null;
      return entry;
    },
    size: () => pending.size,
  };
}

/** PKCE S256 výzva z overovača. */
export const pkceChallenge = (verifier) => b64url(sha256(verifier));

/** URL na stránku poskytovateľa (prihlásenie / súhlas). */
export function authorizeUrl(provider, { redirectUri, state, verifier }) {
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set('client_id', provider.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', provider.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', pkceChallenge(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  if (provider.id === 'google') {
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('prompt', 'select_account');
  } else {
    url.searchParams.set('allow_signup', 'true');
  }
  return url.toString();
}

async function readLimitedJson(response) {
  const text = await response.text();
  if (text.length > RESPONSE_LIMIT) throw new Error('oauth_response_too_large');
  try { return JSON.parse(text); } catch { throw new Error('oauth_bad_response'); }
}

/**
 * Vymení kód za token a načíta identitu. Každá chyba poskytovateľa = 'oauth_failed'.
 * @returns {Promise<{provider: string, subject: string, email: string|null, emailVerified: boolean, name: string}>}
 */
export async function fetchOAuthIdentity(provider, { code, redirectUri, verifier, fetchImpl = globalThis.fetch }) {
  const fail = () => Object.assign(new Error('oauth_failed'), { status: 502 });
  if (typeof code !== 'string' || !code || code.length > 2048) throw fail();
  const call = (url, init = {}) => fetchImpl(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS), redirect: 'error' });
  const form = new URLSearchParams({
    client_id: provider.clientId, client_secret: provider.clientSecret, code, redirect_uri: redirectUri,
    code_verifier: verifier, ...(provider.id === 'google' ? { grant_type: 'authorization_code' } : {}),
  });
  let token;
  try {
    const response = await call(provider.tokenUrl, {
      method: 'POST', body: form.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    });
    if (!response.ok) throw fail();
    token = await readLimitedJson(response);
  } catch { throw fail(); }
  const accessToken = typeof token?.access_token === 'string' ? token.access_token : '';
  if (!accessToken) throw fail();
  const auth = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'User-Agent': 'OKO-account' };
  try {
    if (provider.id === 'google') {
      const response = await call('https://openidconnect.googleapis.com/v1/userinfo', { headers: auth });
      if (!response.ok) throw fail();
      const info = await readLimitedJson(response);
      const subject = typeof info?.sub === 'string' ? info.sub : '';
      if (!/^[\w-]{1,255}$/.test(subject)) throw fail();
      return {
        provider: 'google', subject,
        email: typeof info.email === 'string' ? info.email : null,
        emailVerified: info.email_verified === true || info.email_verified === 'true',
        name: typeof info.name === 'string' ? info.name : '',
      };
    }
    const github = { ...auth, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const userResponse = await call('https://api.github.com/user', { headers: github });
    if (!userResponse.ok) throw fail();
    const user = await readLimitedJson(userResponse);
    const subject = Number.isSafeInteger(user?.id) ? String(user.id) : '';
    if (!subject) throw fail();
    let email = null;
    let emailVerified = false;
    const emailsResponse = await call('https://api.github.com/user/emails', { headers: github });
    if (emailsResponse.ok) {
      const emails = await readLimitedJson(emailsResponse);
      const list = Array.isArray(emails) ? emails.filter((e) => e && typeof e.email === 'string' && e.verified === true) : [];
      const chosen = list.find((e) => e.primary === true) || list[0] || null;
      if (chosen) { email = chosen.email; emailVerified = true; }
    }
    return {
      provider: 'github', subject, email, emailVerified,
      name: typeof user.name === 'string' && user.name.trim() ? user.name : (typeof user.login === 'string' ? user.login : ''),
    };
  } catch (error) {
    if (error?.message === 'oauth_failed') throw error;
    throw fail();
  }
}
