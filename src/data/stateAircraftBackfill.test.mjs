// src/data/stateAircraftBackfill.test.mjs — štátne lietadlá: zoznam, najbližšie letisko, spätný
// import po dňoch (2026-09-30). Testy SPRÁVANIA: zoznam prijme len stroje so zdrojom, plánovač ide
// od včerajška dopredu a potom do minulosti po hranicu archívu (alebo služby štátu), pri blokovaní
// si dá pauzu, pamätá si pozíciu cez reštart a importuje do skutočného úložiska.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { airportsFromIndex, distanceKm, nearestAirport } from './airportNearest.js';
import { parseAirportIndex } from './airportLookup.js';
import { openFlightHistory } from './flightHistoryStore.js';
import { parseStateAircraftList, stateAircraftFor, stateAircraftHexes, stateAircraftLabel } from './stateAircraft.js';
import {
  STATE_BACKFILL_BLOCK_PAUSE_MS,
  STATE_BACKFILL_FLOOR_DAY,
  advanceCursor,
  createStateBackfill,
  fetchGlobeTrace,
  fileCursorStore,
  latestCompleteDay,
  nextBackfillJob,
} from './stateAircraftBackfill.js';

const LIST = {
  country: 'SK',
  updated: '2026-09-30',
  aircraft: [
    { hex: '505ABC', reg: 'OM-TST', typeCode: 'A319', typeName: 'Airbus A319', operator: { sk: 'Test útvar', en: 'Test unit' }, role: 'government', since: '2024-01-01', sources: ['https://example.gov.sk/a'], verified: '2026-09-30' },
    { hex: '505abd', reg: 'OM-BEZ', role: 'government', sources: [] }, // bez zdroja — nesmie prejsť
    { hex: 'xyz', role: 'government', sources: ['https://x.sk'] },
    { hex: '505abe', reg: 'OM-OLD', role: 'government', until: '2022-12-31', sources: ['https://example.gov.sk/b'] },
  ],
};

test('zoznam štátnych strojov: len so zdrojom a platným hexom, vyhľadanie bez ohľadu na veľkosť, štítok SK/EN', () => {
  const list = parseStateAircraftList(LIST);
  assert.deepEqual(list.aircraft.map((a) => a.hex), ['505abc', '505abe'], 'stroj bez zdroja ani zlý hex nevojde');
  const a = stateAircraftFor(list, '505ABC');
  assert.equal(a.reg, 'OM-TST');
  assert.deepEqual(a.operator, { sk: 'Test útvar', en: 'Test unit' });
  assert.equal(stateAircraftFor(list, '3c6444'), null);
  assert.deepEqual(stateAircraftHexes(list, { role: 'government' }), ['505abc', '505abe']);
  assert.equal(stateAircraftLabel(a, 'sk'), 'Vládne lietadlo SR');
  assert.equal(stateAircraftLabel(a, 'en'), 'Government aircraft · Slovakia');
});

test('najbližšie letisko: do hranice km, väčšie letisko pri podobnej vzdialenosti, inak nič', () => {
  const geojsonl = [
    { id: 'LZIB', geometry: { coordinates: [17.2127, 48.1702] }, properties: { ident: 'LZIB', icao: 'LZIB', iata: 'BTS', name: 'Bratislava', type: 'large' } },
    { id: 'LZVB', geometry: { coordinates: [17.1520, 48.2210] }, properties: { ident: 'LZVB', icao: 'LZVB', name: 'Vajnory', type: 'small' } },
    { id: 'EBBR', geometry: { coordinates: [4.4844, 50.9014] }, properties: { ident: 'EBBR', icao: 'EBBR', iata: 'BRU', name: 'Brussels', type: 'large' } },
  ].map((f) => JSON.stringify({ type: 'Feature', ...f })).join('\n');
  const airports = airportsFromIndex(parseAirportIndex(geojsonl));
  assert.equal(airports.length, 3, 'každé letisko raz (index ho má pod ICAO aj IATA)');
  assert.equal(nearestAirport(airports, 48.171, 17.21)?.icao, 'LZIB');
  assert.equal(nearestAirport(airports, 50.90, 4.48)?.iata, 'BRU');
  assert.equal(nearestAirport(airports, 49.5, 12.0), null, 'ďaleko od letiska = neznáme, nie vymyslené');
  assert.equal(nearestAirport(airports, 48.2205, 17.153)?.icao, 'LZVB', 'pri malom letisku blízko je to malé letisko');
  assert.ok(Math.abs(distanceKm(48.1702, 17.2127, 50.9014, 4.4844) - 973) < 10);
});

test('plánovač: nový stroj od posledného celého dňa, potom dopredu, potom do minulosti po začiatok služby', () => {
  const aircraft = [{ hex: '505abc', since: '2026-09-20' }, { hex: '505abd' }];
  let cursors = {};
  const latest = '2026-09-29';
  const order = [];
  for (let i = 0; i < 12; i += 1) {
    const job = nextBackfillJob({ aircraft, cursors, latestDay: latest, floorDay: '2026-09-25' });
    if (!job) break;
    order.push(`${job.hex}:${job.day}:${job.direction}`);
    cursors = advanceCursor(cursors, job);
  }
  assert.deepEqual(order.slice(0, 2), ['505abc:2026-09-29:start', '505abd:2026-09-29:start']);
  assert.deepEqual(order.slice(2), [
    '505abc:2026-09-28:back', '505abd:2026-09-28:back', '505abc:2026-09-27:back', '505abd:2026-09-27:back',
    '505abc:2026-09-26:back', '505abd:2026-09-26:back', '505abc:2026-09-25:back', '505abd:2026-09-25:back',
  ], 'do minulosti po hranicu archívu, stroje striedavo (všetky majú najprv nedávne lety)');
  // Ďalší deň: najprv nový deň dopredu, až potom (nič) do minulosti.
  const next = nextBackfillJob({ aircraft, cursors, latestDay: '2026-09-30', floorDay: '2026-09-25' });
  assert.deepEqual(next, { hex: '505abc', day: '2026-09-30', direction: 'forward' });
  // Služba štátu skončila pred archívom → stroj sa preskočí, ostatné pokračujú.
  const retired = nextBackfillJob({ aircraft: [{ hex: '505abe', until: '2022-12-31' }, { hex: '505abc' }], cursors: {}, latestDay: latest });
  assert.equal(retired.hex, '505abc');
  assert.equal(STATE_BACKFILL_FLOOR_DAY, '2023-02-20');
  assert.equal(latestCompleteDay(Date.UTC(2026, 8, 30, 1, 0)), '2026-09-28', 'o 01:00 ešte nie je hotový včerajšok');
  assert.equal(latestCompleteDay(Date.UTC(2026, 8, 30, 3, 0)), '2026-09-29');
});

const traceJson = (day) => ({
  icao: '505abc', r: 'OM-TST', t: 'A319', timestamp: Date.parse(`${day}T00:00:00Z`) / 1000,
  trace: [
    [36000, 48.17, 17.21, 'ground', 5, 90, 2, 0, { flight: 'SSG1', category: 'A3' }, 'adsb_icao', null, null, null, null],
    [36600, 48.5, 18.0, 20000, 300, 90, 0, 0, null, 'adsb_icao', 20100, 0, null, null],
    [39600, 50.9, 4.48, 'ground', 10, 270, 0, 0, null, 'adsb_icao', null, null, null, null],
  ],
});

test('stiahnutie dňa: gzip aj už rozbalený JSON, 404 bez chyby', async () => {
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(traceJson('2026-09-25'))));
  const seen = [];
  const fake = (body, status = 200) => async (url, init) => {
    seen.push({ url, ua: init.headers['User-Agent'] });
    return { ok: status === 200, status, arrayBuffer: async () => body };
  };
  const a = await fetchGlobeTrace('505abc', '2026-09-25', { fetchImpl: fake(gz) });
  assert.equal(a.status, 200);
  assert.equal(a.flight.points.length, 3);
  assert.equal(seen[0].url, 'https://adsb.lol/globe_history/2026/09/25/traces/bc/trace_full_505abc.json');
  assert.match(seen[0].ua, /OKO/);
  const b = await fetchGlobeTrace('505abc', '2026-09-25', { fetchImpl: fake(Buffer.from(JSON.stringify(traceJson('2026-09-25')))) });
  assert.equal(b.flight.points.length, 3);
  assert.deepEqual(await fetchGlobeTrace('505abc', '2026-09-24', { fetchImpl: fake(Buffer.alloc(0), 404) }), { status: 404 });
});

test('beh plánovača do skutočného úložiska: import, 404, pauza pri 403, pozícia prežije reštart', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-sab-'));
  const cursorFile = path.join(dir, 'state-aircraft-backfill.json');
  const store = openFlightHistory(':memory:');
  let nowMs = Date.UTC(2026, 8, 30, 12, 0);
  const calls = [];
  let block = false;
  const fetchTrace = async (hex, day) => {
    calls.push(day);
    if (block) return { status: 403 };
    if (day === '2026-09-29' || day === '2026-09-27') return { status: 200, flight: (await import('./adsblolTrace.js')).traceToFlight(traceJson(day)) };
    return { status: 404 };
  };
  const logs = [];
  const make = () => createStateBackfill({
    aircraft: () => [{ hex: '505abc', since: '2026-09-26' }],
    fetchTrace,
    importFlight: async (flight) => store.importFlight(flight),
    cursorStore: fileCursorStore(cursorFile),
    now: () => nowMs,
    log: (m) => logs.push(m),
  });
  try {
    let backfill = make();
    await backfill.tick(); // 29. (let)
    await backfill.tick(); // 28. (404)
    assert.deepEqual(calls, ['2026-09-29', '2026-09-28']);
    assert.equal(store.flightsOf('505abc').length, 1);
    assert.equal(backfill.status().found, 1);
    assert.equal(backfill.status().notFound, 1);

    block = true;
    const before403 = backfill.status().intervalMs;
    await backfill.tick(); // 27. → 403 → pauza
    assert.ok(backfill.status().pausedUntil > nowMs);
    assert.equal(backfill.status().intervalMs, before403 * 2, 'po zablokovaní pomalšie tempo');
    await backfill.tick();
    assert.equal(calls.length, 3, 'počas pauzy žiadny dopyt');
    assert.ok(logs.some((m) => m.includes('403')));

    // Reštart servera: nový plánovač pokračuje tam, kde skončil (27. sa zopakuje, 29./28. nie).
    block = false;
    nowMs += STATE_BACKFILL_BLOCK_PAUSE_MS + 1000;
    backfill = make();
    await backfill.tick(); // 27. (let)
    await backfill.tick(); // 26. (404) — deň začiatku služby
    assert.equal(await backfill.tick(), null, 'po začiatok služby hotovo');
    assert.deepEqual(calls.slice(3), ['2026-09-27', '2026-09-26']);
    assert.equal(store.flightsOf('505abc').length, 2, 'lety z 29. aj 27.');
    assert.ok(logs.some((m) => m.includes('hotový')));
    assert.deepEqual(fileCursorStore(cursorFile).load(), { '505abc': { newest: '2026-09-29', oldest: '2026-09-26' } });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
