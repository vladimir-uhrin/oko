import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthClient } from './client.js';

const user = { id: 'test', email: 'test@example.com', displayName: 'Test' };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
test('avatar upload sends binary with CSRF, keeps file out of state, and delete sends JSON', async () => {
  const calls = []; const file = new Blob(['image bytes'], { type: 'image/png' });
  const client = createAuthClient({ fetchImpl: async (path, options) => {
    calls.push({ path, options }); return response({ user: { ...user, photoVersion: options.method === 'PUT' ? 'version' : null }, csrfToken: 'csrf' });
  } });
  await client.refresh(); await client.uploadPhoto(file);
  assert.equal(calls.at(-1).options.body, file); assert.equal(calls.at(-1).options.headers['Content-Type'], 'image/png');
  assert.equal(calls.at(-1).options.headers['X-CSRF-Token'], 'csrf'); assert.equal(client.getState().user.photoVersion, 'version');
  assert.ok(!JSON.stringify(client.getState()).includes('image bytes'));
  await client.removePhoto(); assert.equal(calls.at(-1).options.method, 'DELETE'); assert.equal(calls.at(-1).options.body, '{}');
  assert.equal(client.getState().user.photoVersion, null);
});
test('client keeps session out of JS storage, attaches CSRF, clears state only on confirmed logout', async () => {
  const calls = [];
  let logoutFails = true;
  const client = createAuthClient({ fetchImpl: async (path, options) => {
    calls.push({ path, options });
    if (path.endsWith('/csrf')) return response({ csrfToken: 'preauth' });
    if (path.endsWith('/login')) return response({ user, csrfToken: 'authenticated' });
    if (path.endsWith('/logout')) { if (logoutFails) throw new Error('offline'); return response({ user: null, csrfToken: null }); }
    return response({ user: null, csrfToken: null });
  } });
  await client.refresh(); assert.equal(client.getState().status, 'guest');
  await client.login({ email: user.email, password: 'not retained' });
  assert.deepEqual(client.getState().user, user);
  const login = calls.find(call => call.path.endsWith('/login'));
  assert.equal(login.options.credentials, 'same-origin');
  assert.equal(login.options.headers['X-CSRF-Token'], 'preauth');
  await assert.rejects(client.logout());
  assert.deepEqual(client.getState().user, user, 'network failure does not falsely report revocation');
  logoutFails = false; await client.logout();
  assert.equal(client.getState().user, null);
  assert.equal(calls.at(-1).options.headers['X-CSRF-Token'], 'authenticated');
});

test('a delayed initial refresh cannot replace a newly authenticated profile', async () => {
  let release;
  const client = createAuthClient({ fetchImpl: async path => {
    if (path.endsWith('/session')) return new Promise(resolve => { release = resolve; });
    if (path.endsWith('/csrf')) return response({ csrfToken: 'preauth' });
    return response({ user, csrfToken: 'authenticated' });
  } });
  const refresh = client.refresh();
  await client.login({});
  release(response({ user: null, csrfToken: null }));
  await refresh;
  assert.deepEqual(client.getState().user, user);
});

test('API 401 removes stale profile; stale CSRF is re-bootstrapped on the next attempt', async () => {
  let fail = '';
  let bootstraps = 0;
  const client = createAuthClient({ fetchImpl: async path => {
    if (path.endsWith('/csrf')) { bootstraps++; return response({ csrfToken: 'fresh' }); }
    if (fail) return response({ error: fail }, fail === 'csrf_failed' ? 403 : 401);
    return response({ user, csrfToken: 'known' });
  } });
  await client.refresh();
  fail = 'csrf_failed'; await assert.rejects(client.updateProfile('Another'));
  fail = ''; await client.updateProfile('Another'); assert.equal(bootstraps, 1);
  fail = 'authentication_required'; await assert.rejects(client.updateProfile('Another'));
  assert.equal(client.getState().user, null);
});

test('non-user mutation responses preserve identity and rotated CSRF is used for the next operation', async () => {
  const calls = [];
  const client = createAuthClient({ fetchImpl: async (path, options) => {
    calls.push({ path, options });
    if (path.endsWith('/session')) return response({ user, csrfToken: 'initial', capabilities: { passwordReset: false } });
    if (path.endsWith('/password')) return response({ user, csrfToken: 'rotated' });
    return response({ revoked: 2 });
  } });
  await client.refresh();
  await client.changePassword({ currentPassword: 'old long phrase', newPassword: 'new long phrase' });
  await client.revokeOthers();
  assert.equal(client.getState().user.id, user.id);
  assert.equal(client.getState().status, 'authenticated');
  assert.equal(calls.at(-1).options.headers['X-CSRF-Token'], 'rotated');
  assert.equal(client.getState().capabilities.passwordReset, false);
});

test('security reads survive ordinary refresh but cannot restore data after logout', async () => {
  let release;
  const client = createAuthClient({ fetchImpl: async path => {
    if (path.endsWith('/security')) return new Promise(resolve => { release = resolve; });
    if (path.endsWith('/logout')) return response({ user: null, csrfToken: null });
    return response({ user, csrfToken: 'session' });
  } });
  await client.refresh();
  let pending = client.loadSecurity();
  await client.refresh();
  release(response({ sessions: [{ id: 'a' }], events: [] })); await pending;
  assert.equal(client.getState().securityStatus, 'ready');
  pending = client.loadSecurity(); await client.logout();
  release(response({ sessions: [{ id: 'private' }], events: [] })); await pending;
  assert.equal(client.getState().security, null);
  assert.equal(client.getState().user, null);
});

test('security 401 expires identity; recovery response cannot auto-sign-in a guest', async () => {
  const client = createAuthClient({ fetchImpl: async path => {
    if (path.endsWith('/security')) return response({ error: 'authentication_required' }, 401);
    if (path.endsWith('/forgot-password')) return response({ accepted: true });
    if (path.endsWith('/csrf')) return response({ csrfToken: 'guest' });
    return response({ user, csrfToken: 'session' });
  } });
  await client.refresh(); await client.loadSecurity();
  assert.equal(client.getState().status, 'guest');
  await client.forgotPassword('test@example.com');
  assert.equal(client.getState().user, null);
  assert.equal(client.getState().status, 'guest');
});

test('expired export updates the visible identity immediately', async () => {
  const client = createAuthClient({ fetchImpl: async path => path.endsWith('/export')
    ? response({ error: 'authentication_required' }, 401) : response({ user, csrfToken: 'session' }) });
  await client.refresh(); await assert.rejects(client.exportAccount());
  assert.equal(client.getState().user, null);
  assert.equal(client.getState().status, 'guest');
});

test('failed revocation interrupts a pending security read without leaving a permanent spinner', async () => {
  let release;
  let reads = 0;
  const client = createAuthClient({ fetchImpl: async path => {
    if (path.endsWith('/security')) {
      if (++reads === 1) return new Promise(resolve => { release = resolve; });
      return response({ sessions: [], events: [] });
    }
    if (path.endsWith('/revoke')) return response({ error: 'session_not_found' }, 404);
    return response({ user, csrfToken: 'session' });
  } });
  await client.refresh(); const pending = client.loadSecurity();
  await assert.rejects(client.revokeSession('ended-session'));
  release(response({ sessions: [{ id: 'obsolete' }], events: [] })); await pending;
  assert.equal(client.getState().securityStatus, 'error');
  assert.equal(client.getState().busy, false);
  await client.loadSecurity();
  assert.equal(client.getState().securityStatus, 'ready');
  assert.deepEqual(client.getState().security.sessions, []);
});

test('late export 401 cannot invalidate a newer login or leave a mutation busy', async () => {
  let release;
  const client = createAuthClient({ fetchImpl: async path => {
    if (path.endsWith('/export')) return new Promise(resolve => { release = resolve; });
    return response({ user, csrfToken: 'session' });
  } });
  await client.refresh(); const pending = client.exportAccount();
  await client.login({ email: user.email, password: 'new session phrase' });
  release(response({ error: 'authentication_required' }, 401)); await assert.rejects(pending);
  assert.equal(client.getState().user.id, user.id);
  assert.equal(client.getState().status, 'authenticated');
  assert.equal(client.getState().busy, false);
});
