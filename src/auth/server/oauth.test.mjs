// src/auth/server/oauth.test.mjs
// Prihlásenie cez Google a GitHub (2026-09-27, vlastník: „mohol by si mi vytvoriť aj
// prihlásenie cez Google a Git, ale v štýle OKO"): kód + PKCE na serveri, jednorazový
// state naviazaný na prehliadač, bez automatického prepájania existujúceho e-mailu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { openAuthStore } from './store.js';
import { createAuthService } from './http.js';
import { oauthProvidersFromEnv, safeReturnPath, withQueryParam } from './oauth.js';

const fastPasswords = { hash: async p => `test:${p}`, verify: async (p, h) => h === `test:${p}` };
const providers = oauthProvidersFromEnv({
  AUTH_GOOGLE_CLIENT_ID: 'g-id', AUTH_GOOGLE_CLIENT_SECRET: 'g-secret',
  AUTH_GITHUB_CLIENT_ID: 'gh-id', AUTH_GITHUB_CLIENT_SECRET: 'gh-secret',
});

/** Podvrhnutý Google + GitHub: kód → token (s kontrolou PKCE) → profil. */
function fakeProviders() {
  const codes = new Map(); // code → { challenge, profile }
  const calls = [];
  const users = { google: null, github: null, githubEmails: [] };
  const fetchImpl = async (url, init = {}) => {
    calls.push(String(url));
    const json = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
    if (String(url).includes('oauth2.googleapis.com/token') || String(url).includes('github.com/login/oauth/access_token')) {
      const form = new URLSearchParams(init.body);
      const entry = codes.get(form.get('code'));
      const challenge = createHash('sha256').update(form.get('code_verifier') || '').digest('base64url');
      if (!entry || entry.challenge !== challenge) return json(400, { error: 'invalid_grant' });
      const secretOk = form.get('client_secret') === (String(url).includes('google') ? 'g-secret' : 'gh-secret');
      if (!secretOk) return json(401, { error: 'invalid_client' });
      return json(200, { access_token: `tok-${form.get('code')}` });
    }
    if (String(url).includes('openidconnect.googleapis.com/v1/userinfo')) return json(200, users.google);
    if (String(url) === 'https://api.github.com/user') return json(200, users.github);
    if (String(url) === 'https://api.github.com/user/emails') return json(200, users.githubEmails);
    return json(404, {});
  };
  return { codes, calls, users, fetchImpl };
}

async function fixture(t, { oauthProviders = providers } = {}) {
  const store = openAuthStore(':memory:');
  const fake = fakeProviders();
  const service = createAuthService({ store, passwords: fastPasswords, oauthProviders, oauthFetch: fake.fetchImpl });
  const server = http.createServer((req, res) => { void service.middleware(req, res, () => { res.statusCode = 200; res.end('public'); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await service.close(); store.close(); });
  /** Jeden „prehliadač" so svojím košíkom cookies. */
  const browser = () => {
    const jar = new Map();
    let csrf = '';
    async function request(route, { method = 'GET', body, headers = {} } = {}) {
      const payload = body ? JSON.stringify(body) : undefined;
      const cookie = [...jar].filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');
      const response = await new Promise((resolve, reject) => {
        const outgoing = http.request(base + route, { method, headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(payload ? { Origin: base, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        } }, incoming => {
          const chunks = [];
          incoming.on('data', c => chunks.push(c));
          incoming.on('end', () => resolve({ status: incoming.statusCode, headers: incoming.headers, text: Buffer.concat(chunks).toString('utf8') }));
          incoming.on('error', reject);
        });
        outgoing.on('error', reject);
        outgoing.end(payload);
      });
      for (const set of [].concat(response.headers['set-cookie'] || [])) {
        const [pair] = set.split(';');
        const at = pair.indexOf('=');
        jar.set(pair.slice(0, at), pair.slice(at + 1));
      }
      let data; try { data = JSON.parse(response.text); } catch { data = response.text; }
      if (data?.csrfToken) csrf = data.csrfToken;
      return { status: response.status, headers: response.headers, data, location: response.headers.location || '' };
    }
    return {
      request, jar,
      /** Klik na tlačidlo: štart na našom pôvode, potom návrat od poskytovateľa (cross-site). */
      async signIn(provider, profile, { returnTo = '/', link = false, code = `code-${Math.random().toString(36).slice(2)}`, tamper = null } = {}) {
        const start = await request(`/api/auth/oauth/${provider}/start?return=${encodeURIComponent(returnTo)}${link ? '&link=1' : ''}`, { headers: { 'Sec-Fetch-Site': 'same-origin' } });
        if (start.status !== 303 || !/^https:\/\/(accounts\.google\.com|github\.com)\//.test(start.location)) return { start };
        const authorize = new URL(start.location);
        if (provider === 'google') fake.users.google = profile; else { fake.users.github = profile.user; fake.users.githubEmails = profile.emails || []; }
        fake.codes.set(code, { challenge: authorize.searchParams.get('code_challenge') });
        const state = tamper?.state ?? authorize.searchParams.get('state');
        if (tamper?.dropNonce) jar.delete('oko_oauth');
        const query = tamper?.error ? `error=${tamper.error}&state=${state}` : `code=${code}&state=${state}`;
        const callback = await request(`/api/auth/oauth/${provider}/callback?${query}`, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
        return { start, authorize, callback, state };
      },
    };
  };
  return { store, fake, browser, base };
}

const GOOGLE = { sub: '1098765', email: 'Pilot@Gmail.com', email_verified: true, name: 'Jana Pilotová' };

test('oauth.js: návratová cesta len lokálna; parameter pred #hash; poskytovateľ len s ID aj tajomstvom', () => {
  for (const bad of ['https://evil.example/', '//evil.example', '/\\evil', '/api/auth/session', 'javascript:alert(1)', '', null, '/x\u0000y']) {
    assert.equal(safeReturnPath(bad), '/', String(bad));
  }
  assert.equal(safeReturnPath('/#v=2&lat=48.1'), '/#v=2&lat=48.1');
  assert.equal(safeReturnPath('/account.html'), '/account.html');
  assert.equal(withQueryParam('/?auth_error=x#v=2', 'auth', 'google'), '/?auth=google#v=2');
  assert.deepEqual(Object.keys(oauthProvidersFromEnv({ AUTH_GOOGLE_CLIENT_ID: 'x' })), [], 'bez tajomstva nič');
  assert.deepEqual(Object.keys(providers).sort(), ['github', 'google']);
});

test('Google: nový účet s overeným e-mailom, bez hesla; session cookie; state je jednorazový', async t => {
  const f = await fixture(t);
  const b = f.browser();
  const caps = await b.request('/api/auth/session');
  assert.deepEqual(caps.data.capabilities.oauth, { google: true, github: true });
  const { start, authorize, callback, state } = await b.signIn('google', GOOGLE, { returnTo: '/#v=2&lat=48.15' });
  assert.equal(authorize.searchParams.get('client_id'), 'g-id');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorize.searchParams.get('redirect_uri'), `${f.base}/api/auth/oauth/google/callback`);
  assert.equal(authorize.searchParams.get('client_secret'), null, 'tajomstvo nikdy do prehliadača');
  assert.match(String(start.headers['set-cookie']), /oko_oauth=[\w-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600/);
  assert.equal(callback.status, 303);
  assert.equal(callback.location, '/?auth=google#v=2&lat=48.15');
  assert.equal(callback.headers['referrer-policy'], 'no-referrer');
  const session = await b.request('/api/auth/session');
  assert.equal(session.data.user.email, 'pilot@gmail.com');
  assert.equal(session.data.user.displayName, 'Jana Pilotová');
  assert.equal(session.data.user.emailVerified, true, 'e-mail overil Google');
  const user = f.store.userByEmail('pilot@gmail.com');
  assert.equal(user.password_hash, '!oauth', 'účet bez hesla');
  const passwordLogin = await f.browser().request('/api/auth/login', { method: 'POST', body: { email: 'pilot@gmail.com', password: '!oauth' } });
  assert.notEqual(passwordLogin.status, 200, 'heslom sa do účtu bez hesla nedá');
  // replay toho istého state
  const replay = await b.request(`/api/auth/oauth/google/callback?code=again&state=${state}`, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.match(replay.location, /auth_error=oauth_state/);
  // druhé prihlásenie tou istou identitou = ten istý účet
  const again = f.browser();
  await again.signIn('google', GOOGLE);
  assert.equal((await again.request('/api/auth/session')).data.user.id, user.id);
  const security = await again.request('/api/account/security');
  assert.deepEqual(security.data.identities.map(i => i.provider), ['google']);
});

test('ochrana toku: bez nonce cookie, cudzí state, zrušenie, cross-site štart, nenastavený poskytovateľ', async t => {
  const f = await fixture(t);
  const noNonce = await f.browser().signIn('google', GOOGLE, { tamper: { dropNonce: true } });
  assert.match(noNonce.callback.location, /auth_error=oauth_state/, 'state z iného prehliadača (login CSRF) neprejde');
  const forged = await f.browser().signIn('google', GOOGLE, { tamper: { state: 'x'.repeat(43) } });
  assert.match(forged.callback.location, /auth_error=oauth_state/);
  const cancelled = await f.browser().signIn('google', GOOGLE, { tamper: { error: 'access_denied' } });
  assert.match(cancelled.callback.location, /auth_error=oauth_cancelled/);
  assert.equal(f.store.userByEmail('pilot@gmail.com'), undefined, 'nič sa nevytvorilo');
  const crossSite = await f.browser().request('/api/auth/oauth/google/start', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(crossSite.status, 403, 'štart len z nášho pôvodu');
  const post = await f.browser().request('/api/auth/oauth/google/start', { method: 'POST', body: {} });
  assert.equal(post.status, 405);
  const bad = await f.browser().request('/api/auth/oauth/google/start?return=https%3A%2F%2Fevil.example', { headers: { 'Sec-Fetch-Site': 'same-origin' } });
  assert.match(bad.location, /^https:\/\/accounts\.google\.com\//);
  const g = f.browser();
  const evil = await g.signIn('google', { ...GOOGLE, sub: 'evil-return' }, { returnTo: '//evil.example/x' });
  assert.match(evil.callback.location, /^\/\?auth=google$/, 'cudzia návratová adresa → domov');
});

test('rovnaký e-mail ako existujúci účet sa NEPREPOJÍ sám; majiteľ ho prepojí po prihlásení heslom', async t => {
  const f = await fixture(t);
  const owner = f.browser();
  await owner.request('/api/auth/csrf');
  assert.equal((await owner.request('/api/auth/register', { method: 'POST', body: { email: 'pilot@gmail.com', password: 'correct horse battery staple', displayName: 'Majiteľ' } })).status, 201);
  const stranger = await f.browser().signIn('google', GOOGLE);
  assert.match(stranger.callback.location, /auth_error=oauth_email_exists/);
  assert.equal(f.store.identity('google', GOOGLE.sub), undefined);
  // prepojenie z prihláseného účtu
  const linked = await owner.signIn('google', GOOGLE, { link: true, returnTo: '/account.html' });
  assert.equal(linked.callback.location, '/account.html?auth=google-linked');
  const userId = f.store.userByEmail('pilot@gmail.com').id;
  assert.equal(f.store.identity('google', GOOGLE.sub).user_id, userId);
  // odteraz sa dá prihlásiť cez Google do toho istého účtu
  const later = f.browser();
  await later.signIn('google', GOOGLE);
  assert.equal((await later.request('/api/auth/session')).data.user.id, userId);
  // link bez prihlásenia sa nedá
  const guestLink = await f.browser().request('/api/auth/oauth/github/start?link=1', { headers: { 'Sec-Fetch-Site': 'same-origin' } });
  assert.match(guestLink.location, /auth_error=authentication_required/);
});

test('identita patriaca inému účtu sa neprepojí; GitHub bez overeného e-mailu nevytvorí účet', async t => {
  const f = await fixture(t);
  await f.browser().signIn('google', GOOGLE); // účet A cez Google
  const other = f.browser();
  await other.request('/api/auth/csrf');
  const reg = await other.request('/api/auth/register', { method: 'POST', body: { email: 'b@example.com', password: 'correct horse battery staple', displayName: 'Bea' } });
  assert.equal(reg.status, 201);
  const steal = await other.signIn('google', GOOGLE, { link: true });
  assert.match(steal.callback.location, /auth_error=oauth_identity_in_use/);
  const unverified = await f.browser().signIn('github', { user: { id: 42, login: 'octo' }, emails: [{ email: 'octo@example.com', primary: true, verified: false }] });

  assert.match(unverified.callback.location, /auth_error=oauth_email_unverified/);
  const ok = f.browser();
  const gh = await ok.signIn('github', { user: { id: 43, login: 'pilotka', name: '' }, emails: [{ email: 'x@example.com', primary: false, verified: true }, { email: 'Main@Example.com', primary: true, verified: true }] });
  assert.equal(gh.callback.location, '/?auth=github');
  const me = (await ok.request('/api/auth/session')).data.user;
  assert.equal(me.email, 'main@example.com', 'primárny overený e-mail');
  assert.equal(me.displayName, 'pilotka', 'meno z loginu, keď GitHub meno nemá');
  assert.ok(f.fake.calls.includes('https://api.github.com/user/emails'));
});

test('nenastavený poskytovateľ: tlačidlo sa neukáže a štart vráti chybu, nie stránku poskytovateľa', async t => {
  const f = await fixture(t, { oauthProviders: {} });
  const b = f.browser();
  assert.deepEqual((await b.request('/api/auth/session')).data.capabilities.oauth, { google: false, github: false });
  const start = await b.request('/api/auth/oauth/google/start?return=%2F', { headers: { 'Sec-Fetch-Site': 'same-origin' } });
  assert.equal(start.location, '/?auth_error=oauth_unavailable');
});
