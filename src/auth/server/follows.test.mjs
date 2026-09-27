// src/auth/server/follows.test.mjs
// Sledované lety (2026-09-27, vlastník: „pridaj možnosť aj sledovanie letov, ale len pre
// prihlásených"): endpoint /api/account/follows — len vlastný účet, zápis s Origin + CSRF,
// strop počtu, validácia, export; tabuľka bez zvýšenia verzie schémy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openAuthStore } from './store.js';
import { createAuthService } from './http.js';
import { FOLLOW_MAX, followKey, followMatches, sanitizeFollow, validFollowKey, cleanFollowLabel } from '../follows.js';

const fastPasswords = { hash: async p => `test:${p}`, verify: async (p, h) => h === `test:${p}` };

async function fixture(t) {
  const store = openAuthStore(':memory:');
  const service = createAuthService({ store, passwords: fastPasswords });
  const server = http.createServer((req, res) => {
    void service.middleware(req, res, () => { res.statusCode = 200; res.end('public'); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await service.close(); store.close(); });
  const client = () => {
    let cookie = '';
    let csrf = '';
    async function request(route, { method = 'GET', body, headers } = {}) {
      const payload = body ? JSON.stringify(body) : undefined;
      const response = await new Promise((resolve, reject) => {
        // Content-Length ako prehliadač — Node pri DELETE inak telo nerámcuje (nie chunked).
        const outgoing = http.request(base + route, { method, headers: {
          Cookie: cookie, Origin: base,
          ...(payload ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers,
        } }, incoming => {
          const chunks = [];
          incoming.on('data', chunk => chunks.push(chunk));
          incoming.on('end', () => resolve({ status: incoming.statusCode, headers: incoming.headers, text: Buffer.concat(chunks).toString('utf8') }));
          incoming.on('error', reject);
        });
        outgoing.on('error', reject);
        outgoing.end(payload);
      });
      let data; try { data = JSON.parse(response.text); } catch { data = response.text; }
      const set = response.headers['set-cookie']?.[0];
      if (set) cookie = set.split(';')[0];
      if (data?.csrfToken) csrf = data.csrfToken;
      return { status: response.status, data };
    }
    return {
      request,
      async signUp(email) {
        await request('/api/auth/csrf');
        return request('/api/auth/register', { method: 'POST', body: { email, password: 'correct horse battery staple', displayName: 'Pilot' } });
      },
    };
  };
  return { store, client };
}

test('follows.js: let dopravcu podľa volacieho znaku, ostatné podľa stroja; popis bez riadiacich znakov', () => {
  assert.equal(followKey({ hex: '44003A', callsign: ' aua40h ' }), 'cs:AUA40H');
  assert.equal(followKey({ hex: '44003a', callsign: 'OEFIX' }), 'hex:44003a', 'registrácia ako znak = sleduje sa stroj');
  assert.equal(followKey({ hex: '44003a' }), 'hex:44003a');
  assert.equal(followKey({ hex: 'zz', callsign: '' }), null);
  assert.ok(validFollowKey('cs:AUA40H') && validFollowKey('hex:44003a'));
  for (const bad of ['cs:', 'hex:4400', 'cs:aua40h', 'x:1', 'hex:44003a;DROP', 42, null]) assert.equal(validFollowKey(bad), false, String(bad));
  assert.equal(cleanFollowLabel('AUA40H\n· BCN\u0007 → VIE'), 'AUA40H · BCN → VIE');
  assert.equal([...cleanFollowLabel('x'.repeat(200))].length, 80);
  assert.deepEqual(sanitizeFollow({ hex: '44003a', callsign: 'AUA40H', label: '' }), { key: 'cs:AUA40H', hex: '44003a', callsign: 'AUA40H', label: 'AUA40H' });
  assert.equal(sanitizeFollow({ label: 'bez identity' }), null);
  assert.ok(followMatches({ key: 'cs:AUA40H' }, { hex: 'aaaaaa', callsign: 'AUA40H ' }), 'let = iný stroj v iný deň');
  assert.ok(!followMatches({ key: 'cs:AUA40H' }, { hex: '44003a', callsign: 'AUA41' }));
  assert.ok(followMatches({ key: 'hex:44003a' }, { hex: '44003A', callsign: 'OEFIX' }));
});

test('sledovanie je len pre prihlásených: host dostane 401, zápis bez CSRF 403, cudzí Origin 403', async t => {
  const { client } = await fixture(t);
  const guest = client();
  assert.equal((await guest.request('/api/account/follows')).status, 401);
  await guest.request('/api/auth/csrf');
  const anonymousWrite = await guest.request('/api/account/follows', { method: 'POST', body: { hex: '44003a', callsign: 'AUA40H' } });
  assert.equal(anonymousWrite.status, 401, 'anonymná session nestačí');
  const pilot = client();
  assert.equal((await pilot.signUp('pilot@example.com')).status, 201);
  const noCsrf = await pilot.request('/api/account/follows', { method: 'POST', body: { hex: '44003a' }, headers: { 'X-CSRF-Token': 'x'.repeat(43) } });
  assert.equal(noCsrf.status, 403);
  const foreign = await pilot.request('/api/account/follows', { method: 'POST', body: { hex: '44003a' }, headers: { Origin: 'https://evil.example' } });
  assert.equal(foreign.status, 403);
  assert.deepEqual((await pilot.request('/api/account/follows')).data.follows, []);
});

test('pridanie, obnova popisu, odobratie; každý vidí len svoje; export ich nesie', async t => {
  const { client } = await fixture(t);
  const a = client();
  const b = client();
  await a.signUp('a@example.com');
  await b.signUp('b@example.com');
  let r = await a.request('/api/account/follows', { method: 'POST', body: { hex: '44003A', callsign: 'aua40h', label: 'AUA40H · BCN → VIE' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.max, FOLLOW_MAX);
  assert.deepEqual(r.data.follows.map(f => [f.key, f.hex, f.callsign, f.label]), [['cs:AUA40H', '44003a', 'AUA40H', 'AUA40H · BCN → VIE']]);
  r = await a.request('/api/account/follows', { method: 'POST', body: { hex: '440011', callsign: 'AUA40H', label: 'AUA40H · VIE → BCN' } });
  assert.equal(r.data.follows.length, 1, 'ten istý let sa neduplikuje, len obnoví');
  assert.equal(r.data.follows[0].label, 'AUA40H · VIE → BCN');
  await a.request('/api/account/follows', { method: 'POST', body: { hex: '4b1815', label: 'HB-JCA' } });
  assert.deepEqual((await b.request('/api/account/follows')).data.follows, [], 'cudzí účet nič nevidí');
  const removedByOther = await b.request('/api/account/follows', { method: 'DELETE', body: { key: 'cs:AUA40H' } });
  assert.equal(removedByOther.status, 200);
  assert.equal((await a.request('/api/account/follows')).data.follows.length, 2, 'cudzí účet nemôže odobrať');
  const exported = await a.request('/api/account/export');
  assert.deepEqual(exported.data.follows.map(f => f.key).sort(), ['cs:AUA40H', 'hex:4b1815']);
  r = await a.request('/api/account/follows', { method: 'DELETE', body: { key: 'cs:AUA40H' } });
  assert.deepEqual(r.data.follows.map(f => f.key), ['hex:4b1815']);
});

test('validácia a strop: zlé vstupy 400, navyše polia 400, nad strop 409', async t => {
  const { client, store } = await fixture(t);
  const a = client();
  await a.signUp('a@example.com');
  for (const body of [{}, { hex: 'xyz' }, { hex: '44003a', extra: 1 }, { callsign: '<script>' }]) {
    const r = await a.request('/api/account/follows', { method: 'POST', body });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal((await a.request('/api/account/follows', { method: 'DELETE', body: { key: "hex:44003a' OR 1=1" } })).status, 400);
  for (let i = 0; i < FOLLOW_MAX; i += 1) {
    const r = await a.request('/api/account/follows', { method: 'POST', body: { hex: i.toString(16).padStart(6, '0') } });
    assert.equal(r.status, 200);
  }
  const over = await a.request('/api/account/follows', { method: 'POST', body: { hex: 'ffffff' } });
  assert.equal(over.status, 409);
  assert.equal(over.data.error, 'follow_limit');
  const again = await a.request('/api/account/follows', { method: 'POST', body: { hex: '000000', label: 'nový popis' } });
  assert.equal(again.status, 200, 'obnova existujúceho pri plnom zozname prejde');
  const user = store.userByEmail('a@example.com');
  assert.equal(store.follows(user.id).length, FOLLOW_MAX);
});

test('tabuľka sledovaných letov nezvyšuje verziu schémy (staršia verzia servera DB otvorí) a maže sa s účtom', () => {
  const store = openAuthStore(':memory:');
  try {
    const user = store.createUser('x@example.com', 'X', 'test:x', 1);
    assert.equal(store.addFollow(user.id, sanitizeFollow({ hex: '44003a' }), 2, FOLLOW_MAX), true);
    assert.equal(store.follows(user.id).length, 1);
  } finally { store.close(); }
  const src = new URL('./store.js', import.meta.url);
  return import('node:fs').then(({ readFileSync }) => {
    const text = readFileSync(src, 'utf8');
    assert.match(text, /CREATE TABLE IF NOT EXISTS followed_flights \([\s\S]*?REFERENCES users\(id\) ON DELETE CASCADE/);
    assert.match(text, /PRAGMA user_version = 5; COMMIT;/);
    assert.match(text, /if \(version > 5\) throw/);
  });
});
