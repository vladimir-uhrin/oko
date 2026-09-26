import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openAuthStore } from './store.js';
import { createAuthService, parseOrigins, SESSION_IDLE_MS, SESSION_TTL_MS } from './http.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { validateCredentials, validName } from '../validation.js';

const credentials = { email: 'operator@example.com', password: '  correct horse battery staple  ', displayName: 'Operátor OKO' };
// Control-flow tests use a deterministic adapter; the lifecycle and password
// tests below exercise the production scrypt implementation separately.
const fastPasswords = { hash: async p => `test:${p}`, verify: async (p, h) => h === `test:${p}` };
async function fixture(t, options = {}) {
  const store = options.store || openAuthStore(':memory:');
  const service = createAuthService({ store, passwords: fastPasswords, ...options });
  const server = http.createServer((req, res) => {
    if (req.url === '/api/future-private') return service.requireAuthenticated(req, res, () => res.end(JSON.stringify(req.auth)));
    void service.middleware(req, res, () => { res.statusCode = 200; res.end('public globe/feed'); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await service.close(); if (!options.store) store.close(); });
  let cookie = '';
  let csrf = '';
  async function request(route, { method = 'GET', body, headers, updateCookie = true, raw } = {}) {
    // Raw HTTP preserves Host for the HTTPS reverse-proxy boundary tests;
    // browser/undici fetch deliberately rewrites that forbidden header.
    const response = await new Promise((resolve, reject) => {
      const outgoing = http.request(base + route, { method, headers: {
      Cookie: cookie, Origin: base, ...(body || raw ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}), ...headers,
      } }, incoming => {
        const chunks = [];
        incoming.on('data', chunk => chunks.push(chunk));
        incoming.on('end', () => resolve({ status: incoming.statusCode, headers: new Headers(incoming.headers), text: Buffer.concat(chunks).toString('utf8') }));
        incoming.on('error', reject);
      });
      outgoing.on('error', reject);
      outgoing.end(body || raw ? raw || JSON.stringify(body) : undefined);
    });
    const text = response.text;
    let data; try { data = JSON.parse(text); } catch { data = text; }
    const set = response.headers.get('set-cookie');
    if (updateCookie && set) cookie = set.split(';')[0];
    if (updateCookie && data?.csrfToken) csrf = data.csrfToken;
    return { status: response.status, headers: response.headers, data };
  }
  return { store, request, base, get cookie() { return cookie; }, get csrf() { return csrf; },
    bootstrap: () => request('/api/auth/csrf'),
    register: (data = credentials) => request('/api/auth/register', { method: 'POST', body: data }),
    login: (data = credentials) => request('/api/auth/login', { method: 'POST', body: data }),
    logout: () => request('/api/auth/logout', { method: 'POST', body: {} }) };
}

test('complete real-scrypt lifecycle: register, profile, rotation, logout, login and revoked cookie', async t => {
  const f = await fixture(t, { passwords: { hash: hashPassword, verify: verifyPassword } });
  const anonymous = await f.request('/api/auth/session');
  assert.equal(anonymous.data.user, null);
  assert.equal(anonymous.data.csrfToken, null);
  assert.equal(anonymous.data.capabilities.mailConfigured, false);
  assert.equal(anonymous.headers.get('set-cookie'), null, 'passive visitors get no session cookie');
  assert.equal((await f.request('/api/account')).status, 401);
  await f.bootstrap();
  const preauth = f.cookie;
  const registered = await f.register({ ...credentials, email: '  OPERATOR@EXAMPLE.COM  ' });
  assert.equal(registered.status, 201);
  assert.equal(registered.data.user.email, credentials.email);
  assert.equal(registered.data.user.displayName, credentials.displayName);
  assert.equal(registered.data.user.emailVerified, false);
  assert.equal(registered.data.user.role, 'member');
  assert.notEqual(preauth, f.cookie);
  assert.match(registered.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Max-Age=604800/);
  assert.equal(registered.headers.get('cache-control'), 'no-store');
  assert.equal(registered.headers.get('access-control-allow-origin'), null);
  assert.equal('password' in registered.data.user || 'password_hash' in registered.data.user, false);
  assert.match(f.store.userByEmail(credentials.email).password_hash, /^scrypt\$131072\$8\$1\$/);
  assert.equal((await f.request('/api/auth/session', { headers: { Cookie: preauth }, updateCookie: false })).data.user, null);
  const authenticated = f.cookie;
  const profile = await f.request('/api/account');
  assert.equal(profile.data.user.id, registered.data.user.id);
  assert.equal((await f.request('/api/future-private')).status, 200);
  assert.equal((await f.logout()).status, 200);
  assert.equal((await f.request('/api/account', { headers: { Cookie: authenticated }, updateCookie: false })).status, 401);
  assert.equal((await f.request('/api/future-private')).status, 401);
  await f.bootstrap();
  assert.equal((await f.login({ ...credentials, password: 'not the correct password' })).data.error, 'invalid_credentials');
  assert.equal((await f.login()).status, 200);
  assert.notEqual(f.cookie, authenticated);
  assert.equal((await f.request('/api/public-feed')).data, 'public globe/feed', 'no blanket API gate');
});

test('real password hashing uses random salts, bounded format, exact Unicode/spaces and no plaintext', async () => {
  const password = '  🔭 ďalekohľad a dlhé heslo  ';
  const a = await hashPassword(password);
  const b = await hashPassword(password);
  assert.notEqual(a, b);
  assert.equal(a.includes(password), false);
  assert.equal(await verifyPassword(password, a), true);
  assert.equal(await verifyPassword(password.trim(), a), false);
  assert.equal(await verifyPassword(password, undefined), false, 'unknown users run dummy scrypt');
  assert.equal(await verifyPassword(password, a.replace('131072', '999999999')), false, 'DB parameters cannot select arbitrary memory costs');
});

test('validation: email normalization, types, long inputs and Unicode character counts', () => {
  for (const data of [null, [], { ...credentials, email: 'a@@b.com' }, { ...credentials, email: 'a@-example.com' },
    { ...credentials, password: 42 }, { ...credentials, password: 'x'.repeat(129) }, { ...credentials, password: 'short' },
    { ...credentials, displayName: 'x' }, { ...credentials, displayName: 'x\ny' }]) assert.ok(validateCredentials(data, true));
  assert.equal(validateCredentials({ ...credentials, password: '🔭'.repeat(15) }, true), null);
  assert.equal(validateCredentials({ ...credentials, password: 'a' }, false), null, 'login checks do not redefine the registration policy');
  assert.equal(validName('  Vlado  '), true);
});

test('CSRF: pre-login token, exact Origin, cross-site metadata and custom header all enforced', async t => {
  const f = await fixture(t);
  assert.equal((await f.register()).status, 403);
  await f.bootstrap();
  for (const headers of [{ Origin: '' }, { Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' },
    { 'X-CSRF-Token': '' }, { 'X-CSRF-Token': 'é'.repeat(43) }, { 'Content-Type': 'text/plain' }]) {
    const result = await f.request('/api/auth/register', { method: 'POST', body: credentials, headers });
    assert.ok([403, 415].includes(result.status), JSON.stringify(headers));
  }
  assert.equal(f.store.userByEmail(credentials.email), undefined);
  const preauthCsrf = f.csrf;
  await f.register();
  assert.equal((await f.request('/api/account', { method: 'PATCH', body: { displayName: 'Stolen' }, headers: { 'X-CSRF-Token': preauthCsrf } })).status, 403);
  assert.equal((await f.request('/api/auth/logout', { method: 'GET' })).status, 405);
  assert.equal((await f.request('/api/auth/login', { method: 'OPTIONS' })).status, 405);
});

test('profile ownership and injection: only session owner is writable, values remain inert data', async t => {
  const f = await fixture(t);
  await f.bootstrap(); await f.register();
  const other = f.store.createUser('other@example.com', 'Other', 'test:irrelevant', Date.now());
  const injection = `Robert'); DROP TABLE users; -- <img src=x onerror=alert(1)>`;
  assert.equal((await f.request('/api/account', { method: 'PATCH', body: { displayName: injection, id: other.id } })).status, 400);
  const changed = await f.request('/api/account', { method: 'PATCH', body: { displayName: injection } });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.user.displayName, injection);
  assert.equal(f.store.userByEmail(other.email).display_name, 'Other');
  assert.equal(f.store.userByEmail(credentials.email).display_name, injection);
  assert.equal((await f.request('/api/account', { method: 'PATCH', body: { displayName: 'Valid', paid: true } })).status, 400);
});

test('HTTPS origin uses host-only __Host- cookie; untrusted forwarding and origins cannot opt out', async t => {
  const f = await fixture(t, { origins: parseOrigins('https://oko.example') });
  const https = await f.request('/api/auth/csrf', { headers: { Host: 'oko.example', Origin: 'https://oko.example', 'X-Forwarded-Proto': 'http' } });
  assert.equal(https.status, 200);
  assert.match(https.headers.get('set-cookie'), /^__Host-oko_session=/);
  assert.match(https.headers.get('set-cookie'), /; Secure/);
  assert.equal(https.headers.get('set-cookie').includes('Domain='), false);
  assert.equal((await f.request('/api/auth/session', { headers: { Host: 'evil.example', Origin: 'https://evil.example', 'X-Forwarded-Host': 'oko.example' } })).status, 403);
  assert.throws(() => parseOrigins('http://public.example'));
  assert.throws(() => parseOrigins('https://oko.example/'));
});

test('duplicate account cannot overwrite credentials; unknown and wrong login use the same error', async t => {
  const f = await fixture(t);
  await f.bootstrap(); await f.register();
  assert.equal((await f.register({ ...credentials, password: 'replacement phrase is wrong' })).status, 409);
  assert.equal(f.store.userByEmail(credentials.email).password_hash, `test:${credentials.password}`);
  assert.deepEqual((await f.login({ ...credentials, password: 'wrong' })).data,
    (await f.login({ ...credentials, email: 'missing@example.com' })).data);
});

test('rate limits survive session/cookie changes and ignore spoofed X-Forwarded-For', async t => {
  let time = Date.now();
  const f = await fixture(t, { now: () => time });
  await f.bootstrap();
  for (let i = 0; i < 10; i++) assert.equal((await f.login()).status, 401);
  const blocked = await f.request('/api/auth/login', { method: 'POST', body: credentials, headers: { 'X-Forwarded-For': '1.2.3.4' } });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  time += 15 * 60_000 + 1;
  assert.equal((await f.login()).status, 401);
});

test('session idle/absolute expiry and cookie tampering deny private endpoints', async t => {
  let time = Date.now();
  const f = await fixture(t, { now: () => time });
  await f.bootstrap(); await f.register();
  const cookie = f.cookie;
  assert.equal((await f.request('/api/account', { headers: { Cookie: cookie + 'x' }, updateCookie: false })).status, 401);
  assert.equal((await f.request('/api/account', { headers: { Cookie: `${cookie}; ${cookie}` }, updateCookie: false })).status, 401);
  time += SESSION_IDLE_MS + 1;
  assert.equal((await f.request('/api/account')).status, 401);
  await f.bootstrap(); await f.login();
  for (let i = 0; i < 14; i++) {
    time += SESSION_TTL_MS / 14;
    const session = await f.request('/api/auth/session');
    assert.equal(Boolean(session.data.user), i < 13);
  }
});

test('oversize, malformed JSON and non-JSON requests are rejected without changing profile', async t => {
  const f = await fixture(t);
  await f.bootstrap(); await f.register();
  assert.equal((await f.request('/api/account', { method: 'PATCH', raw: '{' })).status, 400);
  assert.equal((await f.request('/api/account', { method: 'PATCH', raw: '[]' })).status, 400);
  assert.equal((await f.request('/api/account', { method: 'PATCH', body: { displayName: 'x'.repeat(10000) } })).status, 413);
  assert.equal((await f.request('/api/account')).data.user.displayName, credentials.displayName);
});

test('an expired pre-login cookie is replaced in one bootstrap, without a spurious CSRF failure', async t => {
  let time = Date.now();
  const f = await fixture(t, { now: () => time });
  await f.bootstrap();
  const stale = f.cookie;
  time += 21 * 60_000;
  assert.equal((await f.bootstrap()).status, 200);
  assert.notEqual(f.cookie, stale);
  assert.equal((await f.register()).status, 201);
});

test('SQLite persistence, limiter persistence, hashed session identifiers and five-session cap', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'oko-auth-test-'));
  const filename = path.join(directory, 'accounts.sqlite');
  let store;
  try {
    store = openAuthStore(filename);
    const time = Date.now();
    const user = store.createUser(credentials.email, credentials.displayName, 'hashed-password', time);
    for (let i = 0; i < 7; i++) store.rotateSession(null, `hash-${i}`, user.id, time + i, SESSION_TTL_MS);
    assert.equal(store.findSession('hash-0', time + 10, SESSION_IDLE_MS), undefined);
    assert.equal(store.findSession('hash-2', time + 10, SESSION_IDLE_MS).user_id, user.id);
    store.consume('limit', 1, 60000, time);
    store.close(); store = openAuthStore(filename);
    assert.equal(store.userByEmail(credentials.email).id, user.id);
    assert.equal(store.findSession('hash-6', time + 10, SESSION_IDLE_MS).user_id, user.id);
    assert.ok(store.consume('limit', 1, 60000, time));
    assert.equal(readFileSync(filename).includes(Buffer.from(credentials.password)), false);
  } finally {
    store?.close();
    // A newly-created, uniquely-named fixture directory under the OS temp root.
    assert.ok(directory.startsWith(path.join(tmpdir(), 'oko-auth-test-')));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('logout while password verification is pending cannot resurrect the revoked session', async t => {
  let release;
  const f = await fixture(t, { passwords: { ...fastPasswords, verify: () => new Promise(resolve => { release = resolve; }) } });
  await f.bootstrap(); await f.register();
  const pending = f.login();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await f.logout(); release(true);
  assert.equal((await pending).status, 403);
  assert.equal((await f.request('/api/account')).status, 401);
});

test('owner provisioning is server-only; registration and profile edits cannot elevate a member', async t => {
  const f = await fixture(t);
  await f.bootstrap();
  const registered = await f.register({ ...credentials, role: 'owner', isAdmin: true });
  assert.equal(registered.status, 201);
  assert.equal(registered.data.user.role, 'member');
  assert.equal((await f.request('/api/account', { method: 'PATCH', body: { displayName: 'Admin', role: 'owner' } })).status, 400);
  assert.equal(f.store.userByEmail(credentials.email).role, 'member');
  assert.throws(() => f.store.createOwner(credentials.email, 'Owner', 'replacement', Date.now()), /email_exists/);
  assert.equal(f.store.userByEmail(credentials.email).password_hash, `test:${credentials.password}`);
  const ownerCredentials = { email: 'owner@oko.test', password: 'random owner test phrase' };
  const owner = f.store.createOwner(ownerCredentials.email, 'OKO Owner', await fastPasswords.hash(ownerCredentials.password), Date.now());
  assert.equal(owner.role, 'owner');
  assert.throws(() => f.store.createOwner('second@oko.test', 'Owner Two', 'hash', Date.now()), /owner_exists/);
  await f.logout(); await f.bootstrap();
  const loggedIn = await f.login(ownerCredentials);
  assert.equal(loggedIn.status, 200);
  assert.equal(loggedIn.data.user.role, 'owner');
  assert.equal((await f.request('/api/auth/session')).data.user.role, 'owner');
  assert.equal((await f.request('/api/account')).data.user.role, 'owner');
  assert.equal((await f.request('/api/account', { method: 'PATCH', body: { displayName: 'Vlado' } })).data.user.role, 'owner');
  assert.equal((await f.request('/api/account', { method: 'PATCH', body: { displayName: 'Vlado', role: 'member' } })).status, 400);
});

test('v1 migration preserves existing users, password hashes and sessions; reopening is idempotent', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'oko-owner-migration-'));
  const filename = path.join(directory, 'accounts.sqlite');
  let legacy;
  let store;
  try {
    legacy = new DatabaseSync(filename);
    legacy.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
      PRAGMA user_version = 1;`);
    legacy.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)').run('existing-id', credentials.email, 'Existing', 'old-hash', 100);
    legacy.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)').run('session-hash', 'existing-id', 100, 10000, 100);
    legacy.close(); legacy = null;
    for (let i = 0; i < 2; i++) {
      store = openAuthStore(filename);
      const user = store.userByEmail(credentials.email);
      assert.equal(user.id, 'existing-id');
      assert.equal(user.password_hash, 'old-hash');
      assert.equal(user.role, 'member');
      assert.equal(store.findSession('session-hash', 200, 10000).role, 'member');
      store.close(); store = null;
    }
  } finally {
    legacy?.close(); store?.close();
    assert.ok(directory.startsWith(path.join(tmpdir(), 'oko-owner-migration-')));
    rmSync(directory, { recursive: true, force: true });
  }
});
