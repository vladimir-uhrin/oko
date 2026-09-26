import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthClient } from '../client.js';
import { fixture, credentials, newPassword, messageToken } from './account-test-helpers.mjs';

function browserClient(f) {
  let cookie = '';
  return createAuthClient({ fetchImpl: async (route, options) => {
    const response = await fetch(f.base + route, { ...options, headers: { ...options.headers, Cookie: cookie, Origin: f.base } });
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return response;
  } });
}

test('current UI client contract works against actual HTTP profile/security/mail/reset handlers', async t => {
  const f = await fixture(t), a = browserClient(f), b = browserClient(f), guest = browserClient(f);
  await a.refresh(); assert.equal(a.getState().capabilities.emailVerification, true);
  await a.register(credentials); await b.login(credentials);
  await a.updateProfile({ displayName: 'Changed Member', bio: 'Account bio', avatar: 'map', avatarColor: 'amber' });
  assert.equal(a.getState().user.avatar, 'map');
  await a.loadSecurity();
  const other = a.getState().security.sessions.find(session => !session.current);
  await a.revokeSession(other.id); await b.refresh(); assert.equal(b.getState().user, null);
  await b.login(credentials); assert.deepEqual(await a.revokeOthers(), { revoked: 1 });
  await a.changePassword({ currentPassword: credentials.password, newPassword });
  await a.requestVerification();
  assert.deepEqual(await guest.verifyEmail(messageToken(f.messages.at(-1)).token), { verified: true });
  await a.refresh(); assert.equal(a.getState().user.emailVerified, true);
  await a.requestEmailChange({ email: 'changed@example.com', currentPassword: newPassword });
  assert.deepEqual(await guest.confirmEmailChange(messageToken(f.messages.at(-1)).token), { changed: true, user: null, csrfToken: null });
  await guest.forgotPassword('changed@example.com');
  assert.deepEqual(await guest.resetPassword({ token: messageToken(f.messages.at(-1)).token, password: credentials.password }),
    { reset: true, user: null, csrfToken: null });
  await guest.login({ ...credentials, email: 'changed@example.com' });
  const exported = await guest.exportAccount();
  assert.equal(exported.user.email, 'changed@example.com'); assert.equal(exported.user.bio, 'Account bio');
  assert.ok(exported.events.some(event => event.type === 'password_reset'));
  assert.equal(exported.sessions.length, 1);
});
