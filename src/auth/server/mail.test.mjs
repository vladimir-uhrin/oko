import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWebhookMailer, accountMail } from './mail.js';

const env = { AUTH_MAIL_ENDPOINT: 'https://mail.example.com/hooks/oko', AUTH_MAIL_TOKEN: 'test-secret',
  AUTH_MAIL_FROM: 'accounts@example.com', AUTH_PUBLIC_URL: 'https://oko.example.com' };
const origins = ['https://oko.example.com'];

test('mail adapter is unavailable for missing/unsafe configuration and performs no initialization requests', () => {
  let calls = 0;
  const options = { origins, fetchImpl: async () => { calls++; throw new Error('unexpected'); } };
  assert.equal(createWebhookMailer({}, options).configured, false);
  for (const key of Object.keys(env)) assert.equal(createWebhookMailer({ ...env, [key]: '' }, options).configured, false, key);
  for (const endpoint of ['http://mail.example.com/send', 'https://127.0.0.1/send', 'https://[::1]/send',
    'https://localhost/send', 'https://foo.local/send', 'https://foo.internal/send', 'https://user:secret@mail.example.com/send',
    'https://mail.example.com/send#fragment', 'file:///etc/passwd']) {
    assert.equal(createWebhookMailer({ ...env, AUTH_MAIL_ENDPOINT: endpoint }, options).configured, false);
  }
  for (const publicUrl of ['http://oko.example.com', 'https://evil.example.com', 'https://oko.example.com/path',
    'https://oko.example.com?extra=1', 'https://user:secret@oko.example.com', 'https://oko.example.com/#fragment']) {
    assert.equal(createWebhookMailer({ ...env, AUTH_PUBLIC_URL: publicUrl }, options).configured, false);
  }
  assert.equal(createWebhookMailer({ ...env, AUTH_MAIL_TOKEN: 'token\r\ninjected: header' }, options).configured, false);
  assert.equal(createWebhookMailer({ ...env, AUTH_MAIL_FROM: 'bad\r\n@example.com' }, options).configured, false);
  assert.equal(createWebhookMailer(env, options).configured, true);
  assert.equal(calls, 0);
});

test('webhook sends to fixed HTTPS endpoint with server-only sender/auth and bounded nonredirecting request', async () => {
  const calls = []; let cancelled = 0;
  const mailer = createWebhookMailer(env, { origins, fetchImpl: async (url, options) => {
    calls.push({ url, options }); return { ok: true, body: { cancel: async () => { cancelled++; } } };
  } });
  const message = accountMail(mailer.publicUrl, 'recipient@example.com', 'reset', 'test-token');
  await mailer.send({ ...message, url: 'https://attacker.example/collect', from: 'evil@example.com' });
  assert.equal(calls.length, 1); assert.equal(calls[0].url, env.AUTH_MAIL_ENDPOINT);
  assert.equal(calls[0].options.redirect, 'error'); assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-secret');
  assert.deepEqual(JSON.parse(calls[0].options.body), { from: env.AUTH_MAIL_FROM, ...message });
  assert.equal(cancelled, 1);
});

test('provider errors and responses cannot disclose token-bearing messages or credentials', async () => {
  for (const fetchImpl of [async () => { throw new Error('private reset token / bearer secret'); },
    async () => ({ ok: false, body: { cancel: async () => {} } }),
    async () => { throw new DOMException('redirect contains token', 'TypeError'); }]) {
    const mailer = createWebhookMailer(env, { origins, fetchImpl });
    await assert.rejects(mailer.send(accountMail(mailer.publicUrl, 'recipient@example.com', 'reset', 'secret-token')),
      { message: 'mail_delivery_failed' });
  }
});

test('action links only use configured public origin and standalone fragment-only explicit actions', () => {
  for (const action of ['verify', 'reset', 'email']) {
    const mail = accountMail('https://oko.example.com', 'member@example.com', action, 'a'.repeat(43));
    const url = new URL(mail.text.match(/https:\/\/\S+/)[0]);
    assert.equal(url.origin, 'https://oko.example.com'); assert.equal(url.pathname, '/account.html');
    assert.equal(url.search, ''); assert.equal(new URLSearchParams(url.hash.slice(1)).get('action'), action);
    assert.match(mail.text, /explicitly confirm/);
    assert.ok(mail.text.includes(action === 'verify' ? '24 hours' : '30 minutes'));
  }
});
