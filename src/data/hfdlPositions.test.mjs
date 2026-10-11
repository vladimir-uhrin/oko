// HFDL polohy (2026-10-11): čítanie dávok adsb.lol, filter veku, ADS-C, sťahovač, preukotvenie odhadov.
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {
  HFDL_MAX_REPORT_AGE_MS, HFDL_POS_SRC, alignClock, alignHourSeconds, createHfdlFeed, hfdlBatchWindow, hfdlReleaseTag,
  hfdlRepoForYear, parseHfdlBatch, parseHfdlLine,
} from './hfdlPositions.js';
import { POS_SRC, continuesInAir, openFlightHistory } from './flightHistoryStore.js';
import { anchorFromExternalFix, createEstimateTracker } from './flightEstimate.js';

const RECV = Date.UTC(2026, 9, 11, 18, 10, 0); // 18:10:00 UTC
const sec = (ms) => Math.floor(ms / 1000);
const line = (npdu, { recv = RECV, icao = '4CA123', dst = 'Shannon, Ireland' } = {}) => JSON.stringify({
  hfdl: {
    station: 'X', t: { sec: sec(recv), usec: 0 },
    lpdu: { err: false, src: { type: 'Aircraft', id: 3 }, dst: { type: 'Ground station', name: dst }, ...(icao ? { ac_info: { icao } } : {}), hfnpdu: { err: false, ...npdu } },
  },
});
const freq = (lat, lon, clock = { hour: 18, min: 9, sec: 50 }, flight = 'EIN105') => ({ type: { id: 213, name: 'Frequency data' }, flight_id: flight, pos: { lat, lon }, utc_time: clock });
const perf = (lat, lon, clock, flight = 'AVA927') => ({ type: { id: 209, name: 'Performance data' }, flight_id: flight, pos: { lat, lon }, time: clock });

test('poloha z Frequency data: hex, volací znak, čas hlásenia (nie príjmu), zdroj HFDL', () => {
  const [f] = parseHfdlLine(line(freq(52.1, -30.2)));
  assert.equal(f.hex, '4ca123');
  assert.equal(f.cs, 'EIN105');
  assert.equal(f.tMs, Date.UTC(2026, 9, 11, 18, 9, 50), 'čas polohy z utc_time');
  assert.equal(f.recvMs, RECV);
  assert.deepEqual([f.lat, f.lon, f.kind, f.altM, f.ground], [52.1, -30.2, 'hfdl', null, 'Shannon, Ireland']);
});

test('prázdna poloha 180/180 a 0/0 sa zahodí; bez hexu aj volacieho znaku tiež', () => {
  assert.deepEqual(parseHfdlLine(line(freq(180, 180))), []);
  assert.deepEqual(parseHfdlLine(line(freq(0, 0))), []);
  assert.deepEqual(parseHfdlLine(line(freq(50, -20, undefined, ''), { icao: null })), []);
  assert.equal(parseHfdlLine(line(freq(50, -20), { icao: null }))[0].hex, '', 'bez hexu, ale s volacím znakom ostáva');
});

test('Performance data so starou polohou (hodiny pred príjmom) sa zahodí — overené na dátach 2026-10-11', () => {
  assert.deepEqual(parseHfdlLine(line(perf(5.31, -75.26, { hour: 15, min: 7, sec: 24 }))), [], 'AVA927: poloha z 15:07, prijatá 18:10');
  const ok = parseHfdlLine(line(perf(5.31, -75.26, { hour: 18, min: 5, sec: 0 })));
  assert.equal(ok.length, 1, '5 min stará poloha je v poriadku');
  assert.equal(HFDL_MAX_REPORT_AGE_MS, 10 * 60_000);
});

test('čas cez polnoc: hlásenie 23:59 prijaté 00:01 je včerajšie', () => {
  const recv = Date.UTC(2026, 9, 12, 0, 1, 0);
  assert.equal(alignClock({ hour: 23, min: 59, sec: 0 }, recv), Date.UTC(2026, 9, 11, 23, 59, 0));
  assert.equal(alignHourSeconds(3590, Date.UTC(2026, 9, 11, 19, 0, 20)), Date.UTC(2026, 9, 11, 18, 59, 50), 'ADS-C ts_sec z predošlej hodiny');
});

test('ADS-C basic_report: poloha s výškou (ft → m) a časom ts_sec', () => {
  const npdu = { type: { id: 255 }, acars: { flight: 'MCH332', arinc622: { adsc: { tags: [{ basic_report: { alt: 37012, lat: 43.59, lon: -42.5, ts_sec: 580 } }] } } } };
  const [f] = parseHfdlLine(line(npdu, { icao: null }));
  assert.equal(f.kind, 'adsc');
  assert.equal(f.cs, 'MCH332');
  assert.equal(f.altM, Math.round(37012 * 0.3048));
  assert.equal(f.tMs, Date.UTC(2026, 9, 11, 18, 9, 40));
});

test('dávka: dva prijímače počujú tú istú správu → jeden fix; zoradené podľa času; poškodený riadok nevadí', () => {
  const a = line(freq(52, -30, { hour: 18, min: 9, sec: 50 }));
  const b = line(freq(51, -28, { hour: 18, min: 5, sec: 0 }));
  const fixes = parseHfdlBatch([a, '{nie json', a, b, ''].join('\n'));
  assert.equal(fixes.length, 2);
  assert.ok(fixes[0].tMs < fixes[1].tMs);
});

test('názvy: repozitár podľa roka, tag dňa, okno dávky z názvu súboru', () => {
  assert.equal(hfdlRepoForYear(2026), 'adsblol/aircraft-data-links-2026');
  assert.equal(hfdlReleaseTag(RECV), 'adsblol-adl-2026-10-11');
  assert.deepEqual(hfdlBatchWindow('adsblol-adl-hfdl_20261011-175425_20261011-185429.jsonl.zst'),
    { fromMs: Date.UTC(2026, 9, 11, 17, 54, 25), toMs: Date.UTC(2026, 9, 11, 18, 54, 29) });
  assert.equal(hfdlBatchWindow('adsblol-adl-vdl2_20261011-175425_20261011-185429.jsonl.zst'), null, 'VDL2 nie');
});

test('sťahovač: stiahne nové HFDL dávky (nie VDL2, nie staré, nie už stiahnuté), rozbalí zstd, pošle fixy', async () => {
  if (typeof zlib.zstdCompressSync !== 'function') return; // Node bez zstd
  const now = Date.UTC(2026, 9, 11, 19, 5, 0);
  const text = line(freq(52, -30, { hour: 18, min: 50, sec: 0 }), { recv: Date.UTC(2026, 9, 11, 18, 50, 5) });
  const zst = zlib.zstdCompressSync(Buffer.from(text));
  const assets = [
    { name: 'adsblol-adl-hfdl_20261011-180051_20261011-190053.jsonl.zst', browser_download_url: 'https://dl/new' },
    { name: 'adsblol-adl-vdl2_20261011-180051_20261011-190053.jsonl.zst', browser_download_url: 'https://dl/vdl2' },
    { name: 'adsblol-adl-hfdl_20261011-080051_20261011-090053.jsonl.zst', browser_download_url: 'https://dl/old' },
  ];
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('/releases/tags/adsblol-adl-2026-10-11')) return { ok: true, status: 200, json: async () => ({ assets }) };
    if (url === 'https://dl/new') return { ok: true, status: 200, arrayBuffer: async () => zst.buffer.slice(zst.byteOffset, zst.byteOffset + zst.byteLength) };
    throw new Error(`unexpected ${url}`);
  };
  const got = [];
  const feed = createHfdlFeed({ fetchImpl, now: () => now, onFixes: (fixes, meta) => got.push({ n: fixes.length, file: meta.file }) });
  assert.deepEqual(await feed.pollOnce(), { files: 1, fixes: 1 });
  assert.ok(calls[0].startsWith('https://api.github.com/repos/adsblol/aircraft-data-links-2026/releases/tags/'));
  assert.deepEqual(got, [{ n: 1, file: assets[0].name }]);
  assert.ok(!calls.includes('https://dl/vdl2') && !calls.includes('https://dl/old'));
  assert.deepEqual(await feed.pollOnce(), { files: 0, fixes: 0 }, 'druhýkrát ten istý súbor nie');
  assert.equal(feed.status().files, 1);
  assert.equal(feed.status().lastError, null);
});

test('sťahovač: chyba GitHubu sa zapíše do stavu a nič nespadne; vydanie dňa ešte neexistuje (404) = nič', async () => {
  const now = Date.UTC(2026, 9, 11, 19, 5, 0);
  const bad = createHfdlFeed({ fetchImpl: async () => ({ ok: false, status: 403 }), now: () => now });
  await bad.pollOnce();
  assert.match(bad.status().lastError, /HTTP 403/);
  const none = createHfdlFeed({ fetchImpl: async () => ({ ok: false, status: 404 }), now: () => now });
  assert.deepEqual(await none.pollOnce(), { files: 0, fixes: 0 });
  assert.equal(none.status().lastError, null);
});

// ── preukotvenie odhadov ─────────────────────────────────────────────
const T0 = Date.UTC(2026, 9, 11, 17, 0, 0);
const baseFix = { hex: '4ca123', cs: 'EIN105', tMs: T0, lat: 53.0, lon: -15.0, altM: 11000, gsMps: 250, trkDeg: 270, vrMps: 0, onGround: false, category: 4, country: 'Ireland' };
const state = (f, tSec) => [f.hex, f.cs, f.country, tSec, tSec, f.lon, f.lat, f.altM, false, f.gsMps, f.trkDeg, 0, null, f.altM, null, false, 0, 4];

function trackerWith(fix, opts = {}) {
  const samples = [];
  const tracker = createEstimateTracker({ onAccuracy: (x) => samples.push(x), now: () => T0 + 3600_000, ...opts });
  tracker.ingest({ time: sec(fix.tMs), states: [state(fix, sec(fix.tMs))] });
  tracker.ingest({ time: sec(fix.tMs) + 300, states: [state({ ...fix, hex: 'aaaaaa', cs: 'X' }, sec(fix.tMs) + 300)] });
  return { tracker, samples };
}

test('anchorFromExternalFix: nová poloha, kurz a rýchlosť z úseku; výška ostáva (HFDL ju nenesie)', () => {
  // 40 min na západ po rovnobežke ≈ 250 m/s × 2400 s = 600 km
  const ext = { tMs: T0 + 2400_000, lat: 53.0, lon: -24.0, kind: 'hfdl' };
  const a = anchorFromExternalFix(baseFix, ext);
  assert.equal(a.lat, 53.0);
  assert.equal(a.lon, -24.0);
  assert.equal(a.altM, 11000);
  assert.equal(a.via, 'hfdl');
  assert.ok(a.gsMps > 230 && a.gsMps < 260, `gs ${a.gsMps}`);
  assert.ok(a.trkDeg > 255 && a.trkDeg < 275, `kurz ${a.trkDeg} (veľká kružnica na západ sa stáča)`);
  assert.equal(anchorFromExternalFix(baseFix, { tMs: T0 + 600_000, lat: 53, lon: -40 }), null, '10 min a 1 600 km = nemožné');
  assert.equal(anchorFromExternalFix(baseFix, { tMs: T0 - 1000, lat: 53, lon: -15.1 }), null, 'staršia poloha nie');
});

test('sledovač: HFDL poloha s hexom preukotví odhad, zapíše presnosť (via hfdl) a zoznam ju pošle klientovi', () => {
  const { tracker, samples } = trackerWith(baseFix);
  assert.equal(tracker.status().estimated, 1);
  const ext = { hex: '4ca123', cs: 'EIN105', tMs: T0 + 2400_000, lat: 53.0, lon: -24.0, altM: null, kind: 'hfdl' };
  const r = tracker.applyExternalFixes([ext], T0 + 3600_000);
  assert.equal(r.applied.length, 1);
  assert.equal(r.applied[0].hex, '4ca123');
  const [listed] = tracker.list(T0 + 3600_000);
  assert.equal(listed.via, 'hfdl');
  assert.equal(listed.tMs, ext.tMs);
  assert.equal(listed.lon, -24.0);
  assert.equal(samples.length, 1);
  assert.equal(samples[0].via, 'hfdl');
  assert.equal(samples[0].elapsedMin, 40);
  assert.equal(tracker.status().anchoredExternal, 1);
});

test('sledovač: bez hexu sa páruje podľa volacieho znaku; cudzí hex s rovnakým znakom nie; staršia a nemožná poloha nie', () => {
  const { tracker } = trackerWith(baseFix);
  const later = { hex: '', cs: 'EIN105', tMs: T0 + 1200_000, lat: 53.0, lon: -19.5, kind: 'hfdl' };
  assert.equal(tracker.applyExternalFixes([later]).applied.length, 1, 'podľa volacieho znaku');
  assert.equal(tracker.applyExternalFixes([{ ...later, hex: 'bbbbbb', tMs: T0 + 1800_000, lon: -22 }]).unmatched, 1, 'iný stroj s rovnakým znakom');
  assert.equal(tracker.applyExternalFixes([{ ...later, tMs: T0 + 600_000 }]).stale, 1, 'staršia než ukotvenie');
  assert.equal(tracker.applyExternalFixes([{ ...later, tMs: T0 + 1500_000, lon: -60 }]).rejected, 1, '5 min a 2 700 km');
  assert.equal(tracker.applyExternalFixes([{ hex: '', cs: 'NIKTO1', tMs: T0 + 1500_000, lat: 50, lon: -20 }]).unmatched, 1);
});

test('sledovač: plnenie zo zoznamu iného servera s cieľom — bez dohľadávania trasy', () => {
  const lookups = [];
  const tracker = createEstimateTracker({ lookupRoute: async (cs) => { lookups.push(cs); return null; }, now: () => T0 + 600_000 });
  const route = { origin: { code: 'DUB', lat: 53.42, lon: -6.27 }, destination: { code: 'JFK', lat: 40.64, lon: -73.78 } };
  assert.equal(tracker.seed([{ ...baseFix, route, model: { nat: 'A' } }], T0 + 600_000), 1);
  assert.deepEqual(lookups, []);
  const [listed] = tracker.list(T0 + 600_000);
  assert.equal(listed.route.destination.code, 'JFK');
});

test('História: HFDL poloha bez výšky spojí let cez dieru nad oceánom, ak rýchlosť sedí', () => {
  assert.equal(POS_SRC.HFDL, HFDL_POS_SRC);
  const a = { t: 1000, lat: 53, lon: -15, alt: 11000, gs: 250, gnd: false };
  const hfdl = { t: 1000 + 2400, lat: 53, lon: -24, alt: null, gs: null, gnd: false, posSrc: POS_SRC.HFDL };
  assert.equal(continuesInAir(a, hfdl), true);
  assert.equal(continuesInAir(a, { ...hfdl, posSrc: POS_SRC.ADSB }), false, 'bez výšky z iného zdroja nie');
  assert.equal(continuesInAir(a, { ...hfdl, lon: -16 }), false, 'priemerná rýchlosť 28 m/s = pristátie medzi');
});

test('História: import HFDL bodu predĺži živý let (nevznikne samostatný jednobodový let)', () => {
  const store = openFlightHistory(':memory:', { now: () => (T0 + 4 * 3600_000) });
  try {
    const t0 = sec(T0);
    store.recordOpenSkyBody(JSON.stringify({ time: t0, states: [state(baseFix, t0)] }));
    const r = store.importFlight({ icao24: '4ca123', points: [{ t: t0 + 2400, lat: 53.0, lon: -24.0, alt: null, posSrc: POS_SRC.HFDL, callsign: 'EIN105' }] }, 'adsb.lol/hfdl');
    assert.equal(r.inserted, 1);
    const track = store.track('4ca123');
    assert.equal(track.length, 2);
    assert.equal(track[1][10], POS_SRC.HFDL, 'pos_src HFDL v stope');
    const legs = store.search('4ca123');
    assert.equal(legs.length, 1, 'jeden let, nie dva');
    assert.equal(store.status().legs, 1, 'počítadlo úsekov sedí');
  } finally {
    store.close();
  }
});
