// Strážca sledovaných lodí so SKUTOČNÝM spojením (2026-11-07): služba oko-api počúva na Windows len na IPv6
// [::1]; strážca sa pýtal 127.0.0.1, každý dopyt zlyhal a upozornenia na lode v produkcii nikdy neodišli.
// push.test.mjs podstrkuje falošný fetch, preto to nezachytil.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createFollowWatch } from './pushWatch.js';

const ENV = { PUSH_VAPID_PUBLIC_KEY: 'pub', PUSH_VAPID_PRIVATE_KEY: 'prv' };
const store = () => ({
  followedVessels: () => [{ userId: 1, key: 'mmsi:241190000', label: 'MINERVA ZEN' }],
  pushSubscriptions: () => [{ endpoint: 'https://p/1', p256dh: 'k', auth: 'a' }],
  removePush() {},
});
const inPort = { voyage: { lastPort: 'Newport News', arrivedAt: 5, departedAt: null } };
const underway = { voyage: { lastPort: 'Newport News', departedAt: 9 }, destination: 'WILMINGTON.NC.USA' };
const pusher = (sent) => ({ setVapidDetails() {}, async sendNotification(sub, payload) { sent.push(JSON.parse(payload)); } });

for (const host of ['::1', '127.0.0.1']) {
  test(`real loopback: ship status comes from a server listening only on ${host}; the departure reaches the device`, async (t) => {
    let phase = 'port';
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.startsWith('/api/ais-live/contact')) res.end(JSON.stringify({ contact: phase === 'port' ? null : { sog: 12.3, navStatus: 0 } }));
      else res.end(JSON.stringify(phase === 'port' ? inPort : underway));
    });
    try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, host, resolve); }); }
    catch (error) { t.skip(`${host} not available here: ${error.code}`); return; }
    const sent = []; const logs = [];
    const watch = createFollowWatch({ store: store(), env: ENV, port: () => server.address().port, webpush: pusher(sent), log: (m) => logs.push(m) });
    try {
      assert.deepEqual(await watch.tick(), { checked: 1, events: 0, sent: 0 }, 'baseline');
      phase = 'underway';
      assert.deepEqual(await watch.tick(), { checked: 1, events: 1, sent: 1 });
      assert.equal(sent[0].title, 'MINERVA ZEN vyplávala');
      assert.deepEqual(logs, []);
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
}

test('own API down: the last known state is kept, one log line, and the departure is still reported after recovery', async () => {
  let down = false; let phase = 'port';
  const fetchImpl = async (url) => {
    if (down) throw new Error('ECONNREFUSED');
    return { ok: true, json: async () => (url.includes('/contact') ? { contact: phase === 'port' ? null : { sog: 12, navStatus: 0 } } : (phase === 'port' ? inPort : underway)) };
  };
  const sent = []; const logs = [];
  const watch = createFollowWatch({ store: store(), env: ENV, port: () => 4175, fetchImpl, webpush: pusher(sent), log: (m) => logs.push(m) });
  assert.deepEqual(await watch.tick(), { checked: 1, events: 0, sent: 0 });
  down = true; phase = 'underway';
  assert.deepEqual(await watch.tick(), { checked: 1, events: 0, sent: 0, unreachable: true });
  assert.deepEqual(await watch.tick(), { checked: 1, events: 0, sent: 0, unreachable: true });
  assert.equal(logs.length, 1); assert.match(logs[0], /nedostupný/);
  down = false;
  assert.deepEqual(await watch.tick(), { checked: 1, events: 1, sent: 1 }, 'port → underway survives the outage');
  assert.equal(logs.length, 2); assert.match(logs[1], /späť/);
});
