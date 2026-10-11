// src/auth/server/push.test.mjs — Web Push pre sledované lode (2026-10-11): validácia predplatného,
// endpoint /api/account/push, strážca na serveri (prechody → push, mŕtve predplatné preč).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openAuthStore } from './store.js';
import { createAuthService } from './http.js';
import { createFollowWatch, vapidFromEnv } from './pushWatch.js';
import { PUSH_MAX, sanitizePushSubscription, vesselPushPayload } from '../push.js';

const fastPasswords = { hash: async p => `test:${p}`, verify: async (p, h) => h === `test:${p}` };
const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } };

async function fixture(t, push = null) {
  const store = openAuthStore(':memory:');
  const service = createAuthService({ store, passwords: fastPasswords, push });
  const server = http.createServer((req, res) => { void service.middleware(req, res, () => { res.statusCode = 200; res.end('public'); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await service.close(); store.close(); });
  const client = () => {
    let cookie = ''; let csrf = '';
    async function request(route, { method = 'GET', body } = {}) {
      const payload = body ? JSON.stringify(body) : undefined;
      const response = await new Promise((resolve, reject) => {
        const outgoing = http.request(base + route, { method, headers: { Cookie: cookie, Origin: base, ...(payload ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Content-Length': Buffer.byteLength(payload) } : {}) } }, incoming => {
          const chunks = []; incoming.on('data', c => chunks.push(c)); incoming.on('end', () => resolve({ status: incoming.statusCode, headers: incoming.headers, text: Buffer.concat(chunks).toString('utf8') })); incoming.on('error', reject);
        });
        outgoing.on('error', reject); outgoing.end(payload);
      });
      let data; try { data = JSON.parse(response.text); } catch { data = response.text; }
      const set = response.headers['set-cookie']?.[0]; if (set) cookie = set.split(';')[0];
      if (data?.csrfToken) csrf = data.csrfToken;
      return { status: response.status, data };
    }
    return { request, async signUp(email) { await request('/api/auth/csrf'); return request('/api/auth/register', { method: 'POST', body: { email, password: 'correct horse battery staple', displayName: 'Pilot' } }); } };
  };
  return { store, client };
}

test('validácia predplatného: https adresa a dva base64url kľúče; text upozornenia', () => {
  assert.deepEqual(sanitizePushSubscription(SUB), { endpoint: SUB.endpoint, p256dh: SUB.keys.p256dh, auth: SUB.keys.auth });
  assert.equal(sanitizePushSubscription({ ...SUB, endpoint: 'http://x' }), null);
  assert.equal(sanitizePushSubscription({ endpoint: SUB.endpoint, keys: { p256dh: 'short', auth: SUB.keys.auth } }), null);
  assert.equal(sanitizePushSubscription(null), null);
  assert.deepEqual(vesselPushPayload({ type: 'departed' }, { label: 'MINERVA ZEN', mmsi: '241190000' }, { status: 'underway', port: null, to: 'Wilmington NC USA' }, { port: 'Newport News' }),
    { title: 'MINERVA ZEN vyplávala', body: 'z prístavu Newport News · na ceste do Wilmington NC USA', tag: 'vessel:241190000', url: '/?ship=241190000' });
  assert.equal(vesselPushPayload({ type: 'arrived' }, { label: 'X', mmsi: '1' }, { port: 'Rotterdam' }).body, 'do prístavu Rotterdam');
  assert.equal(vapidFromEnv({}), null);
  assert.equal(vapidFromEnv({ PUSH_VAPID_PUBLIC_KEY: 'a', PUSH_VAPID_PRIVATE_KEY: 'b' }).subject, 'mailto:info@okolive.sk');
});

test('/api/account/push: host 401; bez kľúčov enabled=false a zápis 503; s kľúčmi pridanie, strop, odobratie; capabilities.push', async t => {
  const off = await fixture(t);
  const guest = off.client();
  assert.equal((await guest.request('/api/account/push')).status, 401);
  const u = off.client();
  await u.signUp('a@example.com');
  assert.deepEqual((await u.request('/api/account/push')).data, { enabled: false, publicKey: null, subscriptions: 0, max: PUSH_MAX });
  assert.equal((await u.request('/api/account/push', { method: 'POST', body: { subscription: SUB } })).status, 503);
  const on = await fixture(t, { enabled: () => true, publicKey: () => 'PUB' });
  const a = on.client();
  await a.signUp('b@example.com');
  assert.equal((await a.request('/api/auth/session')).data.capabilities.push, true);
  let r = await a.request('/api/account/push', { method: 'POST', body: { subscription: SUB } });
  assert.deepEqual(r.data, { enabled: true, subscriptions: 1, max: PUSH_MAX });
  r = await a.request('/api/account/push', { method: 'POST', body: { subscription: SUB } });
  assert.equal(r.data.subscriptions, 1, 'tá istá adresa sa neduplikuje');
  assert.equal((await a.request('/api/account/push', { method: 'POST', body: { subscription: { endpoint: 'ftp://x', keys: SUB.keys } } })).status, 400);
  assert.equal((await a.request('/api/account/push', { method: 'POST', body: { subscription: SUB, extra: 1 } })).status, 400);
  for (let i = 1; i < PUSH_MAX; i += 1) await a.request('/api/account/push', { method: 'POST', body: { subscription: { ...SUB, endpoint: `${SUB.endpoint}/${i}` } } });
  assert.equal((await a.request('/api/account/push', { method: 'POST', body: { subscription: { ...SUB, endpoint: `${SUB.endpoint}/over` } } })).status, 409);
  const user = on.store.userByEmail('b@example.com');
  assert.equal(on.store.pushSubscriptions(user.id).length, PUSH_MAX);
  r = await a.request('/api/account/push', { method: 'DELETE', body: { endpoint: SUB.endpoint } });
  assert.equal(r.data.subscriptions, PUSH_MAX - 1);
  const b = on.client();
  await b.signUp('c@example.com');
  assert.equal((await b.request('/api/account/push')).data.subscriptions, 0, 'cudzí účet nič nevidí');
  assert.equal((await b.request('/api/account/push', { method: 'DELETE', body: { endpoint: `${SUB.endpoint}/1` } })).status, 200);
  assert.equal(on.store.pushSubscriptions(user.id).length, PUSH_MAX - 1, 'cudzí účet nemôže odobrať');
});

test('strážca: základ bez hlásenia, vyplávanie → push každému zariadeniu sledovateľa, 410 zmaže predplatné; bez kľúčov nič', async t => {
  const { store, client } = await fixture(t);
  await client().signUp('a@example.com');
  await client().signUp('b@example.com');
  const id1 = store.userByEmail('a@example.com').id;
  const id2 = store.userByEmail('b@example.com').id;
  const now = Date.now();
  store.addFollow(id1, { key: 'mmsi:241190000', hex: null, callsign: null, label: 'MINERVA ZEN' }, now, 50);
  store.addFollow(id2, { key: 'mmsi:241190000', hex: null, callsign: null, label: 'MINERVA ZEN' }, now, 50);
  store.addPush(id1, { endpoint: 'https://p/1', p256dh: 'k', auth: 'a' }, now, 10);
  store.addPush(id1, { endpoint: 'https://p/dead', p256dh: 'k', auth: 'a' }, now, 10);
  store.addPush(id2, { endpoint: 'https://p/2', p256dh: 'k', auth: 'a' }, now, 10);
  let live = null;
  let info = { voyage: { lastPort: 'Newport News', arrivedAt: 5, departedAt: null } };
  const fetchImpl = async (url) => ({ ok: true, json: async () => (url.includes('/contact') ? { contact: live } : info) });
  const sent = [];
  const webpush = { setVapidDetails() {}, async sendNotification(sub, payload) { if (sub.endpoint.endsWith('/dead')) { const e = new Error('gone'); e.statusCode = 410; throw e; } sent.push([sub.endpoint, JSON.parse(payload)]); } };
  const watch = createFollowWatch({ store, env: { PUSH_VAPID_PUBLIC_KEY: 'pub', PUSH_VAPID_PRIVATE_KEY: 'prv' }, port: () => 4175, fetchImpl, webpush, log: () => {} });
  assert.equal(watch.enabled(), true);
  assert.deepEqual(await watch.tick(), { checked: 1, events: 0, sent: 0 }, 'základ');
  live = { sog: 12.3, navStatus: 0 };
  info = { voyage: { lastPort: 'Newport News', departedAt: 9 }, destination: 'WILMINGTON.NC.USA' };
  const out = await watch.tick();
  assert.deepEqual(out, { checked: 1, events: 1, sent: 2 });
  assert.deepEqual(sent.map(([e]) => e).sort(), ['https://p/1', 'https://p/2']);
  assert.equal(sent[0][1].title, 'MINERVA ZEN vyplávala');
  assert.match(sent[0][1].body, /z prístavu Newport News · na ceste do Wilmington NC USA/);
  assert.deepEqual(store.pushSubscriptions(id1).map(s => s.endpoint), ['https://p/1'], 'mŕtve predplatné preč');
  assert.deepEqual(await watch.tick(), { checked: 1, events: 0, sent: 0 }, 'bez zmeny nič');
  const off = createFollowWatch({ store, env: {}, port: () => 4175, fetchImpl, webpush });
  assert.equal(off.enabled(), false);
  assert.deepEqual(await off.tick(), { skipped: true });
});
