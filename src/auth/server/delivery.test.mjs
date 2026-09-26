import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fixture, credentials, newPassword, messageToken, deferred } from './account-test-helpers.mjs';
import { MAX_PENDING_RECOVERY } from './http.js';

for (const purpose of ['verify', 'reset', 'email']) test(`failed ${purpose} resend preserves the previously delivered link`, async t => {
  const f = await fixture(t), account = f.client(), guest = f.client();
  await account.register(); await guest.bootstrap();
  const request = () => purpose === 'verify' ? account.post('/api/account/verification') : purpose === 'reset'
    ? guest.post('/api/auth/forgot-password', { email: credentials.email })
    : account.post('/api/account/email', { email: 'new@example.com', currentPassword: credentials.password });
  const confirm = token => guest.post(purpose === 'verify' ? '/api/auth/verify-email'
    : purpose === 'reset' ? '/api/auth/reset-password' : '/api/auth/confirm-email',
  purpose === 'reset' ? { token, password: newPassword } : { token });
  await request(); await f.drainMail();
  const original = messageToken(f.messages[0]).token;
  let failedToken;
  f.mailer.send = async message => { failedToken = messageToken(message).token; throw new Error('failed resend'); };
  const failed = await request(); await f.drainMail();
  assert.equal(failed.status, purpose === 'reset' ? 200 : 503);
  assert.equal((await confirm(failedToken)).data.error, 'invalid_token');
  assert.equal((await confirm(original)).status, 200, 'the previously delivered token is still usable');
});

test('late failure of an older resend cannot delete a newer successfully delivered token', async t => {
  const f = await fixture(t), account = f.client(), guest = f.client();
  await account.register(); await guest.bootstrap(); await account.post('/api/account/verification');
  const original = messageToken(f.messages[0]).token;
  const entered = deferred(), release = deferred(); let count = 0;
  f.mailer.send = async message => {
    f.messages.push(message);
    if (++count === 1) { entered.resolve(); await release.promise; throw new Error('older resend failed'); }
  };
  const pending = account.post('/api/account/verification');
  await entered.promise;
  try { assert.equal((await account.post('/api/account/verification')).status, 200); }
  finally { release.resolve(); }
  assert.equal((await pending).status, 503);
  const older = messageToken(f.messages[1]).token, latest = messageToken(f.messages[2]).token;
  for (const token of [original, older]) assert.equal((await guest.post('/api/auth/verify-email', { token })).data.error, 'invalid_token');
  assert.equal((await guest.post('/api/auth/verify-email', { token: latest })).status, 200);
});

test('an older delayed success cannot supersede the active link after a newer delivery request failed', async t => {
  const f = await fixture(t), account = f.client(), guest = f.client();
  await account.register(); await guest.bootstrap(); await account.post('/api/account/verification');
  const original = messageToken(f.messages[0]).token;
  const entered = deferred(), release = deferred(); let count = 0;
  f.mailer.send = async message => {
    f.messages.push(message);
    if (++count === 1) { entered.resolve(); await release.promise; }
    else throw new Error('newer request failed');
  };
  const pending = account.post('/api/account/verification');
  await entered.promise;
  try { assert.equal((await account.post('/api/account/verification')).status, 503); }
  finally { release.resolve(); }
  assert.equal((await pending).status, 200);
  for (const message of f.messages.slice(1)) {
    assert.equal((await guest.post('/api/auth/verify-email', { token: messageToken(message).token })).data.error, 'invalid_token');
  }
  assert.equal((await guest.post('/api/auth/verify-email', { token: original })).status, 200);
});

for (const result of ['success', 'failure']) test(`late mail ${result} after password change cannot revive any old token`, async t => {
  const f = await fixture(t), account = f.client(), guest = f.client();
  await account.register(); await guest.bootstrap(); await account.post('/api/account/verification');
  const original = messageToken(f.messages[0]).token;
  const entered = deferred(), release = deferred(); let pendingToken;
  f.mailer.send = async message => {
    pendingToken = messageToken(message).token; entered.resolve(); await release.promise;
    if (result === 'failure') throw new Error('late mail failure');
  };
  const pending = account.post('/api/account/verification');
  await entered.promise;
  try {
    assert.equal((await account.post('/api/account/password', { currentPassword: credentials.password, newPassword })).status, 200);
  } finally { release.resolve(); }
  assert.equal((await pending).status, result === 'success' ? 200 : 503);
  for (const token of [original, pendingToken]) {
    assert.equal((await guest.post('/api/auth/verify-email', { token })).data.error, 'invalid_token');
  }
  assert.equal(f.store.userByEmail(credentials.email).password_hash, `test:${newPassword}`);
});

test('recovery delivery has a hard in-flight bound and saturation cannot invalidate an existing link', async t => {
  const release = deferred(); let calls = 0;
  const f = await fixture(t, { trustProxy: true, mailer: { configured: true, publicUrl: 'https://oko.example', send: async () => {
    calls++; await release.promise;
  } } });
  const guest = f.client(); await guest.bootstrap();
  const preservedHash = createHash('sha256').update('existing-valid-recovery').digest('hex');
  let saturatedUser;
  try {
    for (let index = 0; index <= MAX_PENDING_RECOVERY; index++) {
      const user = f.store.createUser(`member${index}@example.com`, 'Member', 'test:password', f.clock.time);
      if (index === MAX_PENDING_RECOVERY) {
        saturatedUser = user;
        f.store.issueToken(preservedHash, user, 'reset', user.email, f.clock.time, 60000);
      }
      assert.equal((await guest.post('/api/auth/forgot-password', { email: user.email },
        { headers: { 'CF-Connecting-IP': `198.51.100.${index + 1}` } })).status, 200);
    }
    assert.equal(calls, MAX_PENDING_RECOVERY);
    assert.equal(f.store.findToken(preservedHash, 'reset', f.clock.time).user_id, saturatedUser.id);
  } finally { release.resolve(); await f.drainMail(); }
});
