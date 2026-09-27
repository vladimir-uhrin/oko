import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { fixture, credentials, newPassword, fastPasswords, messageToken, deferred } from './account-test-helpers.mjs';
import { SESSION_IDLE_MS, SESSION_TTL_MS } from './http.js';

test('profile fields round-trip with defaults, Unicode limits and immutable ownership/security fields', async t => {
  const f = await fixture(t), client = f.client();
  const registered = await client.register({ ...credentials, role: 'owner', emailVerified: true, bio: 'ignored' });
  const user = registered.data.user;
  assert.equal(user.role, 'member'); assert.equal(user.emailVerified, false);
  assert.equal(user.bio, ''); assert.equal(user.avatar, 'orbit'); assert.equal(user.avatarColor, 'cyan');
  assert.equal(user.lastLoginAt, f.clock.time); assert.equal(user.passwordChangedAt, null);
  const fields = { bio: '🔭'.repeat(280), avatar: 'satellite', avatarColor: 'violet', displayName: '  New Name  ' };
  const changed = await client.request('/api/account', { method: 'PATCH', body: fields });
  assert.equal(changed.status, 200);
  for (const key of ['bio', 'avatar', 'avatarColor']) assert.equal(changed.data.user[key], fields[key]);
  assert.equal(changed.data.user.displayName, 'New Name');
  for (const [body, code] of [[{ bio: 'a'.repeat(281) }, 'invalid_bio'], [{ bio: 'bad\u0000bio' }, 'invalid_bio'],
    [{ avatar: 'https://attacker.example/image.svg' }, 'invalid_avatar'], [{ avatarColor: '#abc' }, 'invalid_avatar_color'],
    [{ bio: null }, 'invalid_bio'], [{}, 'invalid_input'], [{ role: 'owner' }, 'invalid_input'],
    [{ id: 'other' }, 'invalid_input'], [{ emailVerified: true }, 'invalid_input'], [{ passwordChangedAt: 0 }, 'invalid_input'],
    [{ lastLoginAt: 0 }, 'invalid_input'], [{ email: 'other@example.com' }, 'invalid_input']]) {
    const response = await client.request('/api/account', { method: 'PATCH', body });
    assert.equal(response.data.error, code);
  }
  const cleared = await client.request('/api/account', { method: 'PATCH', body: { bio: '' } });
  assert.equal(cleared.data.user.bio, ''); assert.equal(cleared.data.user.avatar, 'satellite');
});

test('no-mail capabilities are truthful for anonymous and authenticated clients', async t => {
  const f = await fixture(t, { mailer: { configured: false } }), client = f.client();
  const anonymous = await client.request('/api/auth/session');
  assert.equal(anonymous.headers.has('set-cookie'), false);
  // 2026-09-27: + oauth — bez AUTH_GOOGLE_*/AUTH_GITHUB_* v .env žiadne tlačidlá poskytovateľov.
  assert.deepEqual(anonymous.data.capabilities, { mailConfigured: false, emailVerification: false, passwordReset: false,
    emailChange: false, passwordChange: true, sessionManagement: true, accountExport: true,
    oauth: { google: false, github: false } });
  await client.register();
  assert.deepEqual((await client.request('/api/auth/session')).data.capabilities, anonymous.data.capabilities);
  for (const [route, body] of [['/api/account/email/verification', {}], ['/api/auth/password/forgot', { email: credentials.email }],
    ['/api/account/email/change', { email: 'new@example.com', currentPassword: credentials.password }]]) {
    const response = await client.post(route, body);
    assert.equal(response.status, 503); assert.equal(response.data.error, 'mail_unavailable');
  }
  assert.equal(f.messages.length, 0);
  assert.equal((await client.request('/api/public-globe')).data, 'public');
});

test('all new account routes enforce auth, CSRF, origin, method and input ownership', async t => {
  const f = await fixture(t), guest = f.client(), client = f.client();
  await client.register();
  const id = (await client.request('/api/account/security')).data.sessions[0].id;
  const writes = [
    ['/api/account/password', 'POST', { currentPassword: credentials.password, newPassword }],
    ['/api/account/sessions/revoke-others', 'POST', {}], [`/api/account/sessions/${id}`, 'DELETE', {}],
    ['/api/account/email/verification', 'POST', {}],
    ['/api/account/email/change', 'POST', { email: 'new@example.com', currentPassword: credentials.password }],
  ];
  for (const route of ['/api/account/security', '/api/account/export']) assert.equal((await guest.request(route)).status, 401);
  for (const [route, method, body] of writes) {
    assert.equal((await guest.request(route, { method, body })).status, 401);
    for (const headers of [{ 'X-CSRF-Token': '' }, { Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      assert.equal((await client.request(route, { method, body, headers })).status, 403);
    }
    assert.equal((await client.request(route)).status, 405);
    assert.equal((await client.request(route, { method, body: { ...body, userId: 'someone-else' } })).status, 400);
  }
  await guest.bootstrap();
  for (const route of ['/api/auth/password/forgot', '/api/auth/password/reset', '/api/auth/email/verify', '/api/auth/email/change/confirm']) {
    assert.equal((await guest.post(route, {}, { headers: { 'X-CSRF-Token': '' } })).status, 403);
  }
});

test('devices use unrelated random IDs and coarse labels, and reject cross-account revocation', async t => {
  const f = await fixture(t), a = f.client(), b = f.client('Mozilla/5.0 (iPhone) Version/18.0 Safari/605.1');
  await a.register(); await b.login();
  const other = f.client(); await other.register({ ...credentials, email: 'other@example.com' });
  const security = (await a.request('/api/account/security')).data;
  assert.equal(security.sessions.length, 2);
  for (const session of security.sessions) {
    assert.match(session.id, /^[a-f0-9-]{36}$/);
    assert.deepEqual(Object.keys(session).sort(), ['id', 'label', 'createdAt', 'lastSeen', 'expiresAt', 'current'].sort());
  }
  assert.equal(security.sessions.find(s => s.current).label, 'Chrome on Windows');
  assert.equal(security.sessions.find(s => !s.current).label, 'Safari on iOS');
  const serialized = JSON.stringify(security);
  assert.equal(serialized.includes('secret-UA-value') || serialized.includes('127.0.0.1') || serialized.includes('token_hash'), false);
  const rawToken = a.cookie.split('=')[1], hash = createHash('sha256').update(`session:${rawToken}`).digest('hex');
  assert.equal(serialized.includes(rawToken) || serialized.includes(hash), false);
  const target = security.sessions.find(s => !s.current).id;
  assert.equal((await other.request(`/api/account/sessions/${target}`, { method: 'DELETE', body: {} })).status, 404);
  assert.equal((await b.request('/api/account')).status, 200);
  assert.equal((await a.request(`/api/account/sessions/${target}`, { method: 'DELETE', body: {} })).data.current, false);
  assert.equal((await b.request('/api/account')).status, 401);
  const mine = security.sessions.find(s => s.current).id;
  const result = await a.request(`/api/account/sessions/${mine}`, { method: 'DELETE', body: {} });
  assert.deepEqual(result.data, { revoked: true, current: true, user: null, csrfToken: null });
  assert.match(result.headers.get('set-cookie'), /Max-Age=0/);
});

test('revoke-others retains only current session, and export contains only own bounded public data', async t => {
  const f = await fixture(t), a = f.client(), b = f.client(), c = f.client();
  await a.register(); await b.login(); await c.login();
  const outsider = f.client(); await outsider.register({ ...credentials, email: 'other@example.com' });
  assert.deepEqual((await a.post('/api/account/sessions/revoke-others')).data, { revoked: 2 });
  assert.equal((await a.request('/api/account')).status, 200);
  assert.equal((await b.request('/api/account')).status, 401); assert.equal((await c.request('/api/account')).status, 401);
  const exported = await a.request('/api/account/export');
  assert.equal(exported.data.exportedAt, f.clock.time); assert.equal(exported.data.sessions.length, 1);
  assert.ok(exported.data.events.some(e => e.type === 'other_sessions_revoked'));
  assert.equal(exported.text.includes('other@example.com') || exported.text.includes('password_hash') || exported.text.includes('credential_version'), false);
  assert.equal(exported.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Object.keys(exported.data.events[0]).sort(), ['id', 'type', 'createdAt'].sort());
});

test('password change requires current password, rotates atomically and revokes all other sessions/tokens', async t => {
  const f = await fixture(t), a = f.client(), b = f.client(), guest = f.client();
  await a.register(); await b.login(); await guest.bootstrap();
  await a.post('/api/account/email/verification');
  await guest.post('/api/auth/password/forgot', { email: credentials.email });
  const verify = messageToken(f.messages[0]).token, reset = messageToken(f.messages[1]).token;
  for (const body of [{ currentPassword: 'wrong', newPassword }, { currentPassword: credentials.password, newPassword: 'short' }]) {
    assert.ok([400, 401].includes((await a.post('/api/account/password', body)).status));
  }
  const oldCookie = a.cookie, oldCsrf = a.csrf;
  f.clock.time += 1000;
  const changed = await a.post('/api/account/password', { currentPassword: credentials.password, newPassword });
  assert.equal(changed.status, 200); assert.notEqual(a.cookie, oldCookie); assert.notEqual(a.csrf, oldCsrf);
  assert.equal(changed.data.user.passwordChangedAt, f.clock.time);
  assert.equal(changed.data.user.lastLoginAt, f.clock.time - 1000);
  assert.equal((await a.request('/api/account', { headers: { Cookie: oldCookie }, update: false })).status, 401);
  assert.equal((await b.request('/api/account')).status, 401);
  assert.equal((await guest.post('/api/auth/password/reset', { token: reset, newPassword })).data.error, 'invalid_token');
  assert.equal((await guest.post('/api/auth/email/verify', { token: verify })).data.error, 'invalid_token');
  assert.equal((await guest.login()).data.error, 'invalid_credentials');
  assert.equal((await guest.login({ ...credentials, password: newPassword })).status, 200);
  const events = (await a.request('/api/account/security')).data.events;
  assert.ok(events.some(event => event.type === 'password_changed'));
});

test('unchanged password is rejected only after current-password verification without changing any credentials', async t => {
  const f = await fixture(t), a = f.client(); await a.register();
  const cookie = a.cookie, csrf = a.csrf, user = { ...f.store.userByEmail(credentials.email) };
  assert.equal((await a.post('/api/account/password', { currentPassword: newPassword, newPassword })).data.error, 'invalid_current_password');
  const rejected = await a.post('/api/account/password', { currentPassword: credentials.password, newPassword: credentials.password });
  assert.equal(rejected.status, 400); assert.equal(rejected.data.error, 'password_unchanged');
  assert.equal(a.cookie, cookie); assert.equal(a.csrf, csrf);
  assert.deepEqual({ ...f.store.userByEmail(credentials.email) }, user);
});

test('forgot-password responses do not wait for known-account mail latency; late failures invalidate tokens', async t => {
  const entered = deferred(), release = deferred();
  let sentToken;
  const f = await fixture(t, { mailer: { configured: true, publicUrl: 'https://oko.example', send: async message => {
    sentToken = messageToken(message).token; entered.resolve(); await release.promise; throw new Error('provider unavailable');
  } } });
  const a = f.client(), guest = f.client(); await a.register(); await guest.bootstrap();
  const missing = await guest.post('/api/auth/forgot-password', { email: 'unknown@example.com' });
  const pending = guest.post('/api/auth/forgot-password', { email: credentials.email });
  let timer;
  try {
    await entered.promise;
    const result = await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve(null), 3000); })]);
    assert.ok(result, 'the accepted response must arrive while mail delivery remains blocked');
    assert.equal(result.status, missing.status); assert.deepEqual(result.data, missing.data);
    assert.equal(result.text.includes(sentToken), false);
  } finally { clearTimeout(timer); release.resolve(); await f.drainMail(); await pending; }
  assert.equal((await guest.post('/api/auth/reset-password', { token: sentToken, password: newPassword })).data.error, 'invalid_token');
});

test('verification delivers only to mail adapter and requires single-use, purpose-bound explicit confirmation', async t => {
  const f = await fixture(t), a = f.client(), guest = f.client();
  await a.register(); await guest.bootstrap();
  const request = await a.post('/api/account/email/verification');
  assert.deepEqual(request.data, { accepted: true });
  const { token, link, params } = messageToken(f.messages[0]);
  assert.equal(link.origin, 'https://oko.example'); assert.equal(link.pathname, '/account.html');
  assert.equal(link.search, ''); assert.equal(params.get('action'), 'verify');
  assert.equal(f.messages[0].to, credentials.email); assert.equal(request.text.includes(token), false);
  assert.equal((await a.request('/api/account')).data.user.emailVerified, false);
  assert.equal((await guest.post('/api/auth/password/reset', { token, newPassword })).data.error, 'invalid_token');
  assert.equal((await guest.request('/api/auth/email/verify?token=' + token)).status, 405);
  assert.deepEqual((await guest.post('/api/auth/email/verify', { token })).data, { verified: true });
  assert.equal((await a.request('/api/auth/session')).data.user.emailVerified, true);
  assert.equal((await guest.post('/api/auth/email/verify', { token })).data.error, 'invalid_token');
});

test('reset keeps requests generic, never auto-logins, revokes sessions, and cannot be replayed', async t => {
  const f = await fixture(t), a = f.client(), b = f.client(), guest = f.client();
  await a.register(); await b.login(); await guest.bootstrap();
  const missing = await guest.post('/api/auth/password/forgot', { email: 'missing@example.com' });
  const existing = await guest.post('/api/auth/password/forgot', { email: credentials.email });
  assert.deepEqual(existing.data, missing.data); assert.equal(existing.status, missing.status);
  assert.equal(f.messages.length, 1);
  const token = messageToken(f.messages[0]).token;
  assert.equal(messageToken(f.messages[0]).params.get('action'), 'reset');
  const done = await guest.post('/api/auth/password/reset', { token, newPassword });
  assert.deepEqual(done.data, { reset: true, user: null, csrfToken: null });
  assert.match(done.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await guest.request('/api/account')).status, 401);
  assert.equal((await a.request('/api/account')).status, 401); assert.equal((await b.request('/api/account')).status, 401);
  await guest.bootstrap();
  assert.equal((await guest.post('/api/auth/password/reset', { token, newPassword })).data.error, 'invalid_token');
  assert.equal((await guest.login()).status, 401);
  assert.equal((await guest.login({ ...credentials, password: newPassword })).status, 200);
});

test('email change confirms current password, delays update until new inbox verification and enforces uniqueness', async t => {
  const f = await fixture(t), a = f.client(), guest = f.client();
  await a.register(); await guest.bootstrap();
  const email = 'new@example.com';
  assert.equal((await a.post('/api/account/email/change', { email, currentPassword: 'wrong' })).status, 401);
  assert.equal(f.messages.length, 0);
  assert.deepEqual((await a.post('/api/account/email/change', { email, currentPassword: credentials.password })).data, { accepted: true });
  assert.equal((await a.request('/api/account')).data.user.email, credentials.email);
  assert.equal(f.messages[0].to, email);
  const { token, params } = messageToken(f.messages[0]); assert.equal(params.get('action'), 'email');
  const changed = await guest.post('/api/auth/email/change/confirm', { token });
  assert.deepEqual(changed.data, { changed: true, user: null, csrfToken: null });
  assert.equal((await a.request('/api/account')).status, 401);
  assert.equal(f.store.userByEmail(credentials.email), undefined);
  const user = f.store.userByEmail(email); assert.equal(user.email_verified, 1); assert.equal(user.role, 'member');
  assert.equal((await guest.login({ ...credentials, email })).status, 200);
  f.store.createUser('taken@example.com', 'Other User', 'test:unrelated', f.clock.time);
  assert.equal((await guest.post('/api/account/email/change', { email: 'taken@example.com', currentPassword: credentials.password })).data.error, 'email_unavailable');
});

test('competing new-email confirmations cannot overwrite another account', async t => {
  const f = await fixture(t), a = f.client(), b = f.client(), guest = f.client();
  await a.register(); await b.register({ ...credentials, email: 'second@example.com' }); await guest.bootstrap();
  for (const c of [a, b]) assert.equal((await c.post('/api/account/email/change', { email: 'shared@example.com', currentPassword: credentials.password })).status, 200);
  const [first, second] = f.messages.map(messageToken);
  assert.equal((await guest.post('/api/auth/email/change/confirm', { token: first.token })).status, 200);
  await guest.bootstrap();
  assert.equal((await guest.post('/api/auth/email/change/confirm', { token: second.token })).data.error, 'email_unavailable');
  assert.equal(f.store.userByEmail('shared@example.com').id, (await a.login({ ...credentials, email: 'shared@example.com' })).data.user.id);
  assert.equal(f.store.userByEmail('second@example.com').email, 'second@example.com');
});

for (const change of ['password', 'reset']) test(`pending old-password login is rejected after ${change}, including from an independent anonymous session`, async t => {
  const entered = deferred(), release = deferred(); let pause = false;
  const f = await fixture(t, { passwords: { ...fastPasswords, verify: async (value, hash) => {
    if (pause) { pause = false; entered.resolve(); await release.promise; }
    return fastPasswords.verify(value, hash);
  } } });
  const account = f.client(), pendingClient = f.client(), recovery = f.client();
  await account.register(); await pendingClient.bootstrap(); await recovery.bootstrap();
  pause = true;
  const pending = pendingClient.post('/api/auth/login', credentials);
  await entered.promise;
  if (change === 'password') assert.equal((await account.post('/api/account/password', { currentPassword: credentials.password, newPassword })).status, 200);
  else {
    await recovery.post('/api/auth/password/forgot', { email: credentials.email });
    assert.equal((await recovery.post('/api/auth/password/reset', { token: messageToken(f.messages[0]).token, newPassword })).status, 200);
  }
  release.resolve();
  const result = await pending;
  assert.equal(result.status, 409); assert.equal(result.data.error, 'credentials_changed');
  assert.equal((await pendingClient.request('/api/account')).status, 401);
});

test('two pending password changes have one winner and cannot restore revoked credentials', async t => {
  const entered = deferred(), release = deferred(); let pause = false;
  const f = await fixture(t, { passwords: { ...fastPasswords, hash: async value => {
    if (pause) { pause = false; entered.resolve(); await release.promise; }
    return fastPasswords.hash(value);
  } } });
  const a = f.client(), b = f.client(); await a.register(); await b.login();
  pause = true;
  const pending = a.post('/api/account/password', { currentPassword: credentials.password, newPassword: 'losing password phrase' });
  await entered.promise;
  assert.equal((await b.post('/api/account/password', { currentPassword: credentials.password, newPassword })).status, 200);
  release.resolve(); assert.equal((await pending).status, 403);
  assert.equal(f.store.userByEmail(credentials.email).password_hash, `test:${newPassword}`);
});

test('concurrent reset redemption hashes outside the lock but consumes inside the transaction once', async t => {
  const entered = deferred(), release = deferred(); let pause = false;
  const f = await fixture(t, { passwords: { ...fastPasswords, hash: async value => {
    if (pause) { pause = false; entered.resolve(); await release.promise; }
    return fastPasswords.hash(value);
  } } });
  const a = f.client(), first = f.client(), second = f.client();
  await a.register(); await first.bootstrap(); await second.bootstrap();
  await first.post('/api/auth/password/forgot', { email: credentials.email });
  const token = messageToken(f.messages[0]).token;
  pause = true;
  const pending = first.post('/api/auth/password/reset', { token, newPassword: 'losing password phrase' });
  await entered.promise;
  assert.equal((await second.post('/api/auth/password/reset', { token, newPassword })).status, 200);
  release.resolve(); assert.equal((await pending).data.error, 'invalid_token');
  assert.equal(f.store.userByEmail(credentials.email).password_hash, `test:${newPassword}`);
});

test('revocation during request-body streaming cannot mutate a profile using a stale context', async t => {
  const f = await fixture(t), a = f.client(), b = f.client(); await a.register(); await b.login();
  const result = deferred();
  const req = http.request(f.base + '/api/account', { method: 'PATCH', headers: {
    Origin: f.base, Cookie: a.cookie, 'X-CSRF-Token': a.csrf, 'Content-Type': 'application/json',
  } }, res => { res.resume(); res.on('end', () => result.resolve(res.statusCode)); });
  req.on('error', result.resolve);
  req.flushHeaders(); req.write('{"displayName":');
  await b.post('/api/account/sessions/revoke-others');
  req.end('"Revoked Writer"}');
  assert.ok([401, 403].includes(await result.promise));
  assert.equal(f.store.userByEmail(credentials.email).display_name, credentials.displayName);
});

test('absolute/idle session expiry and action expiry are checked again after async password work', async t => {
  const entered = deferred(), release = deferred(); let pause = false;
  const f = await fixture(t, { passwords: { ...fastPasswords, hash: async value => {
    if (pause) { pause = false; entered.resolve(); await release.promise; }
    return fastPasswords.hash(value);
  } } });
  const a = f.client(), guest = f.client(); await a.register(); await guest.bootstrap();
  await guest.post('/api/auth/password/forgot', { email: credentials.email });
  const token = messageToken(f.messages[0]).token;
  pause = true;
  const pending = guest.post('/api/auth/password/reset', { token, newPassword });
  await entered.promise; f.clock.time += 31 * 60_000; release.resolve();
  assert.equal((await pending).status, 403, 'anonymous session expired during hash');
  await guest.bootstrap(); assert.equal((await guest.post('/api/auth/password/reset', { token, newPassword })).data.error, 'invalid_token');
  f.clock.time += SESSION_IDLE_MS;
  assert.equal((await a.request('/api/account/security')).status, 401);
  await a.login();
  const start = f.clock.time;
  for (let i = 1; i <= 14; i++) {
    f.clock.time = start + i * SESSION_TTL_MS / 14;
    assert.equal((await a.request('/api/account/security')).status, i < 14 ? 200 : 401);
  }
});

test('re-request supersedes old token, expired verification fails, and delivery failures remove issued tokens', async t => {
  const f = await fixture(t), a = f.client(), guest = f.client(); await a.register(); await guest.bootstrap();
  await a.post('/api/account/email/verification'); await a.post('/api/account/email/verification');
  const [old, latest] = f.messages.map(messageToken);
  assert.equal((await guest.post('/api/auth/email/verify', { token: old.token })).data.error, 'invalid_token');
  f.clock.time += 86400_000; await guest.bootstrap();
  assert.equal((await guest.post('/api/auth/email/verify', { token: latest.token })).data.error, 'invalid_token');
  assert.equal(f.store.userByEmail(credentials.email).email_verified, 0);
  await a.login();
  let delivered;
  f.mailer.send = async message => { delivered = messageToken(message).token; throw new Error('sensitive provider detail'); };
  const failed = await a.post('/api/account/email/verification');
  assert.deepEqual(failed.data, { error: 'mail_unavailable' });
  assert.equal((await guest.post('/api/auth/email/verify', { token: delivered })).data.error, 'invalid_token');
  assert.deepEqual((await guest.post('/api/auth/password/forgot', { email: credentials.email })).data, { accepted: true });
  assert.equal((await guest.post('/api/auth/password/reset', { token: delivered, newPassword })).data.error, 'invalid_token');
});

test('owner retains role through password/reset/profile changes and activity is bounded and ages out', async t => {
  const f = await fixture(t), owner = f.client(), guest = f.client();
  const user = f.store.createOwner(credentials.email, 'Original Owner', `test:${credentials.password}`, f.clock.time);
  await owner.login(); await guest.bootstrap();
  await owner.request('/api/account', { method: 'PATCH', body: { bio: 'Owner profile', avatar: 'compass' } });
  await owner.post('/api/account/password', { currentPassword: credentials.password, newPassword });
  await guest.post('/api/auth/password/forgot', { email: credentials.email });
  await guest.post('/api/auth/password/reset', { token: messageToken(f.messages[0]).token, newPassword: credentials.password });
  assert.equal(f.store.userById(user.id).role, 'owner');
  assert.equal(f.store.userById(user.id).bio, 'Owner profile');
  for (let i = 0; i < 110; i++) f.store.event(user.id, 'login', f.clock.time + i);
  assert.equal(f.store.security(user.id, '', f.clock.time + 110, SESSION_IDLE_MS).events.length, 100);
  assert.equal(f.store.security(user.id, '', f.clock.time + 91 * 86400_000, SESSION_IDLE_MS).events.length, 0);
});
