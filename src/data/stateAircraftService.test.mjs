// src/data/stateAircraftService.test.mjs — API štátnych lietadiel (2026-09-30). Testy SPRÁVANIA:
// zoznam len overených strojov (a jeho zmena bez reštartu), živé polohy jedným dopytom s cache,
// lety len pre stroje zo zoznamu, letiská odvodené len z koncov na zemi / nízko pri letisku.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { traceToFlight } from './adsblolTrace.js';
import { openFlightHistory } from './flightHistoryStore.js';
import { AIRPORT_END_MAX_ALT_M, STATE_LIVE_CACHE_MS, airportForEnd, createStateAircraftService } from './stateAircraftService.js';

const AIRPORTS = [
  { id: 'LZIB', geometry: { coordinates: [17.2127, 48.1702] }, properties: { ident: 'LZIB', icao: 'LZIB', iata: 'BTS', name: 'M. R. Štefánik', municipality: 'Bratislava', country: 'SK', type: 'large' } },
  { id: 'EBBR', geometry: { coordinates: [4.4844, 50.9014] }, properties: { ident: 'EBBR', icao: 'EBBR', iata: 'BRU', name: 'Brussels', municipality: 'Brussels', country: 'BE', type: 'large' } },
].map((f) => JSON.stringify({ type: 'Feature', ...f })).join('\n');

const LIST = (extra = []) => JSON.stringify({
  country: 'SK',
  updated: '2026-09-30',
  aircraft: [
    { hex: '505abc', reg: 'OM-TST', typeCode: 'A319', operator: { sk: 'Test útvar', en: 'Test unit' }, role: 'government', sources: ['https://example.gov.sk/a'] },
    ...extra,
  ],
});

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-sas-'));
  const listFile = path.join(dir, 'sk.json');
  const airportsFile = path.join(dir, 'airports.geojsonl');
  writeFileSync(listFile, LIST());
  writeFileSync(airportsFile, AIRPORTS);
  const store = openFlightHistory(':memory:');
  let nowMs = Date.UTC(2026, 8, 30, 12);
  const upstream = [];
  let upstreamFails = false;
  const service = createStateAircraftService({
    listFile,
    airportsFile,
    cursorFile: path.join(dir, 'cursor.json'),
    getStore: () => store,
    now: () => nowMs,
    log: () => {},
    fetchImpl: async (url) => {
      upstream.push(url);
      if (upstreamFails) return { ok: false, status: 503, text: async () => '' };
      return { ok: true, status: 200, text: async () => JSON.stringify({ ac: [{ hex: '505abc', lat: 48.2, lon: 17.3, alt_baro: 20000 }], now: nowMs }) };
    },
  });
  const call = async (url) => {
    const res = { status: 0, headers: {}, body: '', writeHead(s, h) { this.status = s; this.headers = h; }, end(b) { this.body = b; } };
    await service.handle({ url }, res);
    return { status: res.status, json: JSON.parse(res.body), headers: res.headers };
  };
  return {
    dir, listFile, store, service, call, upstream,
    advance: (ms) => { nowMs += ms; },
    failUpstream: (v) => { upstreamFails = v; },
    cleanup: () => { store.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

test('zoznam: len overené stroje so zdrojmi; úprava súboru sa prejaví bez reštartu servera', async () => {
  const s = setup();
  try {
    const a = await s.call('/');
    assert.equal(a.status, 200);
    assert.deepEqual(a.json.aircraft.map((x) => x.reg), ['OM-TST']);
    assert.deepEqual(a.json.aircraft[0].sources, ['https://example.gov.sk/a']);
    writeFileSync(s.listFile, LIST([{ hex: '505abd', reg: 'OM-TSU', role: 'government', sources: ['https://example.gov.sk/b'] }]));
    const later = new Date(Date.now() + 5000);
    utimesSync(s.listFile, later, later);
    assert.deepEqual((await s.call('/')).json.aircraft.map((x) => x.reg), ['OM-TST', 'OM-TSU']);
    assert.deepEqual(s.service.hexes(), ['505abc', '505abd']);
  } finally {
    s.cleanup();
  }
});

test('živé polohy: jeden dopyt na adsb.lol pre všetky stroje, cache 15 s, pri výpadku posledná známa odpoveď', async () => {
  const s = setup();
  try {
    const a = await s.call('/live');
    assert.equal(a.status, 200);
    assert.equal(a.json.ac[0].hex, '505abc');
    assert.deepEqual(s.upstream, ['https://api.adsb.lol/v2/hex/505abc']);
    await s.call('/live');
    assert.equal(s.upstream.length, 1, 'v cache');
    s.advance(STATE_LIVE_CACHE_MS + 1);
    s.failUpstream(true);
    const stale = await s.call('/live');
    assert.equal(stale.status, 200, 'výpadok adsb.lol: posledná známa odpoveď');
    assert.equal(s.upstream.length, 2);
  } finally {
    s.cleanup();
  }
});

test('lety: len stroje zo zoznamu; odlet a prílet odvodené z koncov na zemi, let bez pristátia bez letiska', async () => {
  const s = setup();
  try {
    assert.equal((await s.call('/flights?hex=3c6444')).status, 404, 'cudzí stroj sa tu nevyhľadá');
    const day = Date.UTC(2026, 8, 25) / 1000;
    s.store.importFlight(traceToFlight({
      icao: '505abc', r: 'OM-TST', t: 'A319', timestamp: day,
      trace: [
        [36000, 48.171, 17.213, 'ground', 5, 90, 2, 0, { flight: 'SSG1' }, 'adsb_icao', null, null, null, null],
        [37000, 49.5, 12.0, 36000, 450, 270, 0, 0, null, 'adsb_icao', null, null, null, null],
        [43000, 50.901, 4.485, 'ground', 10, 270, 0, 0, null, 'adsb_icao', null, null, null, null],
        // druhý let: záznam končí vo výške (pokrytie) — letisko príletu nie je známe
        [60000, 50.901, 4.485, 'ground', 5, 90, 2, 0, { flight: 'SSG2' }, 'adsb_icao', null, null, null, null],
        [61000, 50.2, 8.0, 30000, 450, 90, 0, 0, null, 'adsb_icao', null, null, null, null],
      ],
    }));
    const r = await s.call('/flights?hex=505ABC');
    assert.equal(r.status, 200);
    assert.equal(r.json.aircraft.reg, 'OM-TST');
    assert.deepEqual(r.json.derived, ['origin', 'destination']);
    const [second, first] = r.json.flights;
    assert.equal(first.callsign, 'SSG1');
    assert.equal(first.origin.icao, 'LZIB');
    assert.equal(first.destination.iata, 'BRU');
    assert.equal(first.durationS, 7000);
    assert.equal(second.origin.icao, 'EBBR');
    assert.equal(second.destination, null, 'koniec vo výške = neznáme letisko, nie vymyslené');
    assert.equal((await s.call('/flights?hex=505abc&limit=1')).json.flights.length, 1);
    assert.equal((await s.call(`/flights?hex=505abc&before=${first.lastT + 1}`)).json.flights[0].callsign, 'SSG1', 'stránkovanie do minulosti');
  } finally {
    s.cleanup();
  }
});

test('koniec letu a letisko: na zemi alebo nízko pri letisku áno, vo výške nie', () => {
  const airports = [{ icao: 'LZIB', iata: 'BTS', ident: 'LZIB', name: 'x', lat: 48.1702, lon: 17.2127, type: 'large' }];
  assert.equal(airportForEnd(airports, { lat: 48.17, lon: 17.21, gnd: true, altM: 0 })?.icao, 'LZIB');
  assert.equal(airportForEnd(airports, { lat: 48.17, lon: 17.21, gnd: false, altM: AIRPORT_END_MAX_ALT_M })?.icao, 'LZIB');
  assert.equal(airportForEnd(airports, { lat: 48.17, lon: 17.21, gnd: false, altM: AIRPORT_END_MAX_ALT_M + 1 }), null);
  assert.equal(airportForEnd(airports, null), null);
});

test('štart spätného importu opraví lety štátnych strojov rozdelené dierou v pokrytí (raz pre každý stroj)', async () => {
  const merged = [];
  const service = createStateAircraftService({
    listFile: 'neexistuje.json',
    airportsFile: 'neexistuje.geojsonl',
    cursorFile: path.join(tmpdir(), `oko-sas-${process.pid}.json`),
    getStore: () => ({ mergeAirGaps: async (hex) => { merged.push(hex); return hex === '505abc' ? 2 : 0; } }),
    log: () => {},
  });
  // Bez zoznamu nič; so zoznamom každý stroj raz.
  assert.equal(await service.repairAirGaps(), 0);
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-sas-r-'));
  try {
    const listFile = path.join(dir, 'sk.json');
    writeFileSync(listFile, LIST([{ hex: '505abd', reg: 'OM-TSU', role: 'government', sources: ['https://example.gov.sk/b'] }]));
    const logs = [];
    const s2 = createStateAircraftService({
      listFile, airportsFile: 'x', cursorFile: path.join(dir, 'c.json'),
      getStore: () => ({ mergeAirGaps: async (hex) => { merged.push(hex); return hex === '505abc' ? 2 : 0; } }),
      log: (m) => logs.push(m),
    });
    assert.equal(await s2.repairAirGaps(), 2);
    assert.deepEqual(merged, ['505abc', '505abd']);
    assert.ok(logs.some((m) => m.includes('spojené lety')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
