// Celosvetové hľadanie lietadla cez adsb.lol (2026-10-04): cesty, fronta s odstupom, cache, pauza po 429, limit IP.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createAircraftSearchService, normalizeReadsb, upstreamPaths } from './aircraftSearchService.js';
import { parseAircraftQuery } from './aircraftSearch.js';

const RUSLAN = { hex: '508035', flight: 'ADB3017 ', r: 'UR-82072', t: 'A124', desc: 'ANTONOV An-124 Ruslan', ownOp: 'Antonov Airlines',
  lat: 48.17, lon: 17.21, alt_baro: 'ground', gs: 0, track: 220, seen_pos: 2, dbFlags: 0 };

function fakeUpstream(clock) {
  const calls = [];
  let status = 200;
  const fetchImpl = async url => {
    calls.push({ url, at: clock.time });
    if (status !== 200) return { ok: false, status, json: async () => ({}) };
    const ac = url.includes('/v2/type/A124') || url.includes('/v2/reg/UR-82072') ? [RUSLAN] : [];
    return { ok: true, status: 200, json: async () => ({ ac }) };
  };
  return { calls, fetchImpl, setStatus: s => { status = s; } };
}

test('cesty adsb.lol: hex, registrácia, volací znak, typy — najviac 4, bez duplicít; miesto nič', () => {
  assert.deepEqual(upstreamPaths(parseAircraftQuery('Ruslan')), ['/v2/type/A124']);
  assert.deepEqual(upstreamPaths(parseAircraftQuery('UR-82072')), ['/v2/reg/UR-82072']);
  assert.deepEqual(upstreamPaths(parseAircraftQuery('ADB3017')), ['/v2/callsign/ADB3017']);
  assert.equal(upstreamPaths(parseAircraftQuery('Antonov')).length, 4);
  assert.deepEqual(upstreamPaths(parseAircraftQuery('Bratislava')), []);
});

test('readsb záznam → OKO: meno typu zo slovníka, na zemi, prevádzkovateľ', () => {
  const ac = normalizeReadsb(RUSLAN, 1_000_000);
  assert.deepEqual([ac.hex, ac.callsign, ac.registration, ac.typeCode, ac.typeName, ac.operator, ac.onGround, ac.altitudeFt, ac.seenAt],
    ['508035', 'ADB3017', 'UR-82072', 'A124', 'Antonov An-124 Ruslan', 'Antonov Airlines', true, 0, 998_000]);
  assert.equal(normalizeReadsb({ hex: '508035' }, 0), null, 'bez polohy nič');
  assert.equal(normalizeReadsb({ hex: '~2a0b1c', lat: 1, lon: 2, flight: 'ADB1', dbFlags: 1 }, 0).operator, 'Antonov Airlines', 'prevádzkovateľ z volacieho znaku');
});

test('fronta: po jednej požiadavke s odstupom ≥ 1,1 s, cache 20 s, po 429 pauza 60 s', async () => {
  const clock = { time: 1_000_000 };
  const up = fakeUpstream(clock);
  const service = createAircraftSearchService({ fetchImpl: up.fetchImpl, now: () => clock.time, sleep: async ms => { clock.time += ms; } });
  const found = await service.search('Antonov');
  assert.equal(up.calls.length, 4);
  for (let i = 1; i < up.calls.length; i++) assert.ok(up.calls[i].at - up.calls[i - 1].at >= 1100, 'odstup');
  assert.equal(found.aircraft[0].registration, 'UR-82072');
  assert.ok(found.meaning.includes('Antonov An-124 Ruslan') && found.meaning.includes('Antonov Airlines'));
  await service.search('Ruslan');
  assert.equal(up.calls.length, 4, '/v2/type/A124 je ešte v cache');
  clock.time += 21_000;
  up.setStatus(429);
  const limited = await service.search('Ruslan');
  assert.equal(limited.limited, true);
  const before = up.calls.length;
  up.setStatus(200);
  clock.time += 30_000;
  assert.equal((await service.search('UR-82072')).limited, true, 'počas pauzy sa adsb.lol nevolá');
  assert.equal(up.calls.length, before);
  clock.time += 31_000;
  assert.equal((await service.search('UR-82072')).aircraft.length, 1, 'po pauze znova');
});

test('HTTP: krátky dopyt 400, limit dopytov z jednej IP, miesto bez volania upstreamu', async t => {
  const clock = { time: 0 };
  const up = fakeUpstream(clock);
  const service = createAircraftSearchService({ fetchImpl: up.fetchImpl, now: () => clock.time, sleep: async () => {}, perIpPerMin: 3 });
  const server = http.createServer((req, res) => service.middleware(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/aircraft-search?q=x`)).status, 400);
  const place = await (await fetch(`${base}/api/aircraft-search?q=Bratislava`)).json();
  assert.deepEqual([place.aircraft.length, place.searched, up.calls.length], [0, 0, 0]);
  assert.equal((await fetch(`${base}/api/aircraft-search?q=Ruslan`)).status, 200);
  assert.equal((await fetch(`${base}/api/aircraft-search?q=Ruslan`)).status, 200);
  assert.equal((await fetch(`${base}/api/aircraft-search?q=Ruslan`)).status, 429, 'štvrtý dopyt za minútu');
  assert.equal((await fetch(`${base}/api/other`)).status, 404, 'iné cesty idú ďalej');
});
