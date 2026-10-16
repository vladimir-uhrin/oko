// HFDL polohy (2026-10-11): čítanie dávok adsb.lol, filter veku, ADS-C, sťahovač, preukotvenie odhadov.
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  HFDL_BATCH_HOLD_MS, HFDL_BATCH_MAX_ATTEMPTS, HFDL_MAX_BATCH_AGE_MS, HFDL_MAX_REPORT_AGE_MS, HFDL_POS_SRC, alignClock, alignHourSeconds, createHfdlFeed, hfdlBatchWindow, hfdlReleaseTag,
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

test('sťahovač: poškodená alebo nedostupná dávka podrží novšie (poradie ostáva); nečitateľná sa po HFDL_BATCH_MAX_ATTEMPTS vynechá aj po reštarte, dočasná chyba stiahnutia nie (2026-10-15, 2026-10-16)', async () => {
  if (typeof zlib.zstdCompressSync !== 'function') return; // Node bez zstd
  let now = Date.UTC(2026, 9, 11, 19, 5, 0);
  const zst = zlib.zstdCompressSync(Buffer.from(line(freq(52, -30, { hour: 18, min: 50, sec: 0 }), { recv: Date.UTC(2026, 9, 11, 18, 50, 5) })));
  const body = (buf) => ({ ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
  const name = (from, to) => `adsblol-adl-hfdl_20261011-${from}_20261011-${to}.jsonl.zst`;
  const assets = [
    { name: name('160051', '170053'), browser_download_url: 'https://dl/corrupt' },
    { name: name('170051', '180053'), browser_download_url: 'https://dl/flaky' },
    { name: name('180051', '190053'), browser_download_url: 'https://dl/new' },
  ];
  const downloads = [];
  // Výpadok úložiska dávok dlhší než HFDL_BATCH_MAX_ATTEMPTS prieskumov: 503, časový limit, 429, 502.
  const flakyErrors = [{ ok: false, status: 503 }, new DOMException('The operation was aborted due to timeout', 'TimeoutError'), { ok: false, status: 429 }, { ok: false, status: 502 }];
  const fetchImpl = async (url) => {
    if (url.includes('/releases/tags/')) return { ok: true, status: 200, json: async () => ({ assets }) };
    downloads.push(url);
    if (url === 'https://dl/corrupt') return body(zst.subarray(0, zst.length - 6)); // useknutý zstd
    if (url === 'https://dl/flaky') {
      const err = flakyErrors[downloads.filter((u) => u === url).length - 1];
      if (err instanceof Error) throw err;
      if (err) return err;
    }
    return body(zst);
  };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oko-hfdl-'));
  try {
    const stateFile = path.join(dir, 'hfdl-state.json');
    const got = [];
    const feed = createHfdlFeed({ fetchImpl, now: () => now, stateFile, onFixes: (fixes, meta) => got.push(meta.file) });
    // Prieskumy 1–2: poškodená dávka (pokus 1, 2) podrží novšie — tie sa ani nesťahujú.
    for (let i = 0; i < HFDL_BATCH_MAX_ATTEMPTS - 1; i += 1) {
      assert.deepEqual(await feed.pollOnce(), { files: 0, fixes: 0 }, `prieskum ${i + 1}: novšie čakajú na poškodenú`);
      now += 10 * 60_000;
    }
    assert.deepEqual(downloads, ['https://dl/corrupt', 'https://dl/corrupt']);
    assert.match(feed.status().lastError, /hfdl_20261011-160051/);
    // Prieskum 3: poškodená vynechaná, nasledujúca nedostupná (503) zase podrží najnovšiu.
    assert.deepEqual(await feed.pollOnce(), { files: 0, fixes: 0 });
    assert.equal(feed.status().filesSkipped, 1, 'poškodená dávka po 3 pokusoch vynechaná');
    assert.match(feed.status().lastError, /hfdl_20261011-170051.*HTTP 503/);
    const saved = JSON.parse(await fs.readFile(stateFile, 'utf8')).seen;
    assert.ok(saved.includes(assets[0].name) && !saved.includes(assets[1].name), 'na disku je len vynechaná poškodená dávka');
    // Prieskumy 4–6: časový limit, 429, 502 — nedostupná sa nevynechá, najnovšia stále čaká (< HFDL_BATCH_HOLD_MS).
    for (let i = 0; i < 3; i += 1) {
      now += 10 * 60_000;
      assert.deepEqual(await feed.pollOnce(), { files: 0, fixes: 0 }, `prieskum ${i + 4}: dávka stále nedostupná`);
    }
    assert.equal(feed.status().filesSkipped, 1, 'nedostupná dávka sa nevynecháva');
    assert.equal(downloads.filter((u) => u === 'https://dl/new').length, 0, 'najnovšia sa počas podržania nesťahuje');
    assert.deepEqual(got, []);
    now += 10 * 60_000;
    assert.deepEqual(await feed.pollOnce(), { files: 2, fixes: 2 }, 'po výpadku (5. pokus) dávka prišla a za ňou najnovšia');
    assert.deepEqual(got, [assets[1].name, assets[2].name], 'v poradí — polohy tej hodiny nie sú pre ukotvenie zastarané');
    assert.equal(feed.status().lastError, null);
    const before = downloads.length;
    assert.deepEqual(await feed.pollOnce(), { files: 0, fixes: 0 });
    assert.equal(downloads.length, before, 'vynechaná ani doručená dávka sa už nesťahuje');
    const restarted = createHfdlFeed({ fetchImpl, now: () => now, stateFile });
    assert.deepEqual(await restarted.pollOnce(), { files: 0, fixes: 0 });
    assert.equal(downloads.length, before, 'ani po reštarte (stav na disku)');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('sťahovač: trvalo nedostupná dávka podrží novšie len HFDL_BATCH_HOLD_MS, skúša sa pri každom prieskume, kým nie je staršia než HFDL_MAX_BATCH_AGE_MS; do stavu sa nezapíše (2026-10-16)', async () => {
  if (typeof zlib.zstdCompressSync !== 'function') return; // Node bez zstd
  const start = Date.UTC(2026, 9, 11, 19, 5, 0);
  let now = start;
  const zst = zlib.zstdCompressSync(Buffer.from(line(freq(52, -30, { hour: 18, min: 50, sec: 0 }), { recv: Date.UTC(2026, 9, 11, 18, 50, 5) })));
  const down = { name: 'adsblol-adl-hfdl_20261011-170051_20261011-180053.jsonl.zst', browser_download_url: 'https://dl/down' };
  const ok = { name: 'adsblol-adl-hfdl_20261011-180051_20261011-190053.jsonl.zst', browser_download_url: 'https://dl/ok' };
  const downloads = [];
  const fetchImpl = async (url) => {
    if (url.includes('/releases/tags/')) return { ok: true, status: 200, json: async () => ({ assets: [down, ok] }) };
    downloads.push(url);
    if (url === 'https://dl/down') throw new TypeError('fetch failed');
    return { ok: true, status: 200, arrayBuffer: async () => zst.buffer.slice(zst.byteOffset, zst.byteOffset + zst.byteLength) };
  };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oko-hfdl-'));
  try {
    const stateFile = path.join(dir, 'hfdl-state.json');
    const delivered = [];
    const feed = createHfdlFeed({ fetchImpl, now: () => now, stateFile, onFixes: (fixes, meta) => delivered.push({ file: meta.file, afterMs: now - start }) });
    const ageOut = hfdlBatchWindow(down.name).toMs + HFDL_MAX_BATCH_AGE_MS;
    let polls = 0;
    for (; now <= ageOut; now += 10 * 60_000) { await feed.pollOnce(); polls += 1; }
    assert.ok(polls > HFDL_BATCH_MAX_ATTEMPTS);
    assert.deepEqual(delivered, [{ file: ok.name, afterMs: HFDL_BATCH_HOLD_MS }], 'novšia čaká presne HFDL_BATCH_HOLD_MS, potom príde raz');
    assert.equal(downloads.filter((u) => u === 'https://dl/down').length, polls, 'pri každom prieskume až do 6 h');
    assert.equal(feed.status().filesSkipped, 0);
    assert.match(feed.status().lastError, /fetch failed/);
    assert.ok(!JSON.parse(await fs.readFile(stateFile, 'utf8')).seen.includes(down.name));
    await feed.pollOnce();
    assert.equal(downloads.filter((u) => u === 'https://dl/down').length, polls, 'po HFDL_MAX_BATCH_AGE_MS už nie');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
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

/** Downlink od lietadla v tvare z dávok 2026-10-11: hex v `lpdu.src.ac_info`, nie v `lpdu.ac_info`. */
const downlink = (npdu, acInfo) => JSON.stringify({
  hfdl: {
    station: 'X', t: { sec: sec(RECV), usec: 0 },
    lpdu: {
      err: false, dst: { type: 'Ground station', id: 1, name: 'San Francisco, California' },
      src: { type: 'Aircraft', id: 207, ...(acInfo ? { ac_info: acInfo } : {}) }, type: { name: 'Unnumbered data', id: 13 },
      hfnpdu: { err: false, ...npdu },
    },
  },
});

test('hex z lpdu.src.ac_info (Performance data, ADS-C) — odhad s iným tvarom znaku sa preukotví, cudzí stroj s rovnakým znakom nie (2026-10-15)', () => {
  const perfLine = downlink(perf(53.0, -29.5, { hour: 18, min: 5, sec: 0 }, 'AS0506'), { icao: 'A5E29A', regnr: 'N506AS', typecode: 'B738' });
  const [p] = parseHfdlLine(perfLine);
  assert.deepEqual([p.hex, p.cs, p.kind], ['a5e29a', 'AS0506', 'hfdl']);
  const adscNpdu = { type: { id: 255 }, acars: { flight: 'MCH332', arinc622: { adsc: { tags: [{ basic_report: { alt: 37012, lat: 43.59, lon: -42.5, ts_sec: 580 } }] } } } };
  const [a] = parseHfdlLine(downlink(adscNpdu, { icao: 'AF4EE7' }));
  assert.deepEqual([a.hex, a.kind], ['af4ee7', 'adsc']);
  assert.equal(parseHfdlLine(downlink(perf(53.0, -29.5, { hour: 18, min: 5, sec: 0 }, 'AS0506'), null))[0].hex, '', 'bez ac_info ostáva len znak');

  const at = T0 + 75 * 60_000;
  // ADS-B znak ASA506, HFDL znak AS0506 (IATA) — páruje sa len cez hex.
  const { tracker } = trackerWith({ ...baseFix, hex: 'a5e29a', cs: 'ASA506' });
  assert.equal(tracker.applyExternalFixes([p], at).applied.length, 1);
  // Iný stroj (hex zo src) s rovnakým znakom ako odhad — nepárovať.
  const { tracker: other } = trackerWith({ ...baseFix, hex: 'abcdef', cs: 'AS0506' });
  assert.equal(other.applyExternalFixes([p], at).unmatched, 1);
});

test('dávka: tá istá správa raz s hexom (src.ac_info), raz len so znakom → jeden fix s hexom v oboch poradiach; dva hexy s jedným znakom ostanú (2026-10-16)', () => {
  const msg = perf(53.0, -29.5, { hour: 18, min: 5, sec: 0 }, 'AS0506');
  const withHex = downlink(msg, { icao: 'A5E29A' });
  const noHex = downlink(msg, null);
  for (const lines of [[noHex, withHex], [withHex, noHex], [noHex, withHex, noHex]]) {
    const fixes = parseHfdlBatch(lines.join('\n'));
    assert.deepEqual(fixes.map((f) => [f.hex, f.cs]), [['a5e29a', 'AS0506']], 'duplikát podľa znaku a času, ostáva kópia s hexom');
  }
  const other = downlink(msg, { icao: 'ABCDEF' });
  assert.deepEqual(parseHfdlBatch([withHex, noHex, other].join('\n')).map((f) => f.hex).sort(), ['a5e29a', 'abcdef'], 'iný stroj s rovnakým znakom');
  // Kópia bez hexu by inak preukotvila cudzí odhad s rovnakým znakom (obišla by stráž hexu).
  const { tracker } = trackerWith({ ...baseFix, hex: 'abcdef', cs: 'AS0506' });
  const r = tracker.applyExternalFixes(parseHfdlBatch([withHex, noHex].join('\n')), T0 + 75 * 60_000);
  assert.deepEqual([r.applied.length, r.unmatched], [0, 1]);
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

// ── reštart servera: odhady z Histórie aj po preukotvení z HFDL (2026-10-15) ─────────
/** Ten istý tvar bodu ako vite.config.js _hfdlRecordHistory (len prijaté hodnoty, výška len z ADS-C). */
const historyPoints = (applied) => applied.map((a) => ({
  t: Math.round(a.fix.tMs / 1000), lat: a.fix.lat, lon: a.fix.lon,
  alt: a.fix.via === 'adsc' ? a.fix.altM : null, posSrc: HFDL_POS_SRC, callsign: a.cs || '',
}));
const RESTART_MS = T0 + 90 * 60_000;
const seedAfterRestart = (store) => {
  const ends = store.lastAirborneFixes({ sinceS: sec(T0) - 14 * 3600, untilS: sec(RESTART_MS) });
  const tracker = createEstimateTracker({ now: () => RESTART_MS });
  const seeded = tracker.seed(ends.filter((f) => !f.onGround), RESTART_MS);
  return { ends, seeded, listed: tracker.list(RESTART_MS), tracker };
};

test('reštart: let preukotvený z HFDL (aj ADS-C) sa znova odhaduje z poslednej HFDL polohy, História ostáva bez dopočítaných hodnôt', () => {
  const store = openFlightHistory(':memory:', { now: () => RESTART_MS });
  try {
    const t0 = sec(T0);
    for (const dt of [-120, -60, 0]) {
      const f = { ...baseFix, lon: baseFix.lon - (dt * 250) / 66_900 };
      store.recordOpenSkyBody(JSON.stringify({ time: t0 + dt, states: [state(f, t0 + dt)] }));
    }
    // Za behu: odhad sa preukotví dvakrát (dve hodinové dávky) a body idú do Histórie.
    const { tracker: live } = trackerWith(baseFix);
    const hfdl = { hex: '4ca123', cs: 'EIN105', tMs: T0 + 40 * 60_000, lat: 53.0, lon: -24.0, altM: null, kind: 'hfdl' };
    const adsc = { hex: '4ca123', cs: 'EIN105', tMs: T0 + 80 * 60_000, lat: 53.3, lon: -33.0, altM: 11278, kind: 'adsc' };
    for (const ext of [hfdl, adsc]) {
      const r = live.applyExternalFixes([ext], RESTART_MS);
      assert.equal(r.applied.length, 1);
      store.importFlight({ icao24: '4ca123', points: historyPoints(r.applied) }, 'adsb.lol/hfdl');
    }
    const [runtime] = live.list(RESTART_MS);
    assert.equal(runtime.via, 'adsc');
    const track = store.track('4ca123');
    assert.deepEqual(track.slice(-2).map((r) => [r[3], r[4], r[5], r[10]]), [[null, null, null, POS_SRC.HFDL], [11278, null, null, POS_SRC.HFDL]],
      'História: výška len z ADS-C, rýchlosť a kurz nie');

    const { ends, seeded, listed, tracker } = seedAfterRestart(store);
    assert.equal(ends.length, 1);
    assert.equal(ends[0].tMs, T0, 'základ = posledný fix ADS-B s rýchlosťou a kurzom');
    assert.deepEqual(ends[0].external.map((e) => [e.tMs, e.kind]), [[hfdl.tMs, 'hfdl'], [adsc.tMs, 'adsc']]);
    assert.equal(seeded, 1, 'odhad po reštarte nezmizne');
    const [est] = listed;
    assert.equal(est.tMs, adsc.tMs, 'ukotvený v poslednej skutočnej polohe');
    assert.ok(Math.abs(est.lat - adsc.lat) < 1e-4 && Math.abs(est.lon - adsc.lon) < 1e-4);
    assert.equal(est.via, 'adsc');
    assert.equal(est.altM, 11278);
    assert.ok(Math.abs(est.gsMps - runtime.gsMps) < 0.5, `rýchlosť ako za behu: ${est.gsMps} vs ${runtime.gsMps}`);
    assert.ok(Math.abs(est.trkDeg - runtime.trkDeg) < 0.5, `kurz ako za behu: ${est.trkDeg} vs ${runtime.trkDeg}`);
    assert.equal(tracker.status().anchoredExternal, 1);
    assert.equal(tracker.status().externalApplied, 0, 'nie je to nové meranie (presnosť sa nezapisuje znova)');
  } finally {
    store.close();
  }
});

test('reštart: HFDL bod v samostatnom úseku (pod cestovnou výškou sa nespojí) sa ukotví na predošlom úseku s rovnakým znakom; iný znak nie', () => {
  for (const [callsign, expected] of [['EIN105', 1], ['BAW117', 0]]) {
    const store = openFlightHistory(':memory:', { now: () => RESTART_MS });
    try {
      const t0 = sec(T0);
      const low = { ...baseFix, altM: 4500 };
      store.recordOpenSkyBody(JSON.stringify({ time: t0, states: [state(low, t0)] }));
      const r = store.importFlight({ icao24: '4ca123', points: [{ t: t0 + 2700, lat: 53.0, lon: -25.1, alt: null, posSrc: HFDL_POS_SRC, callsign }] }, 'adsb.lol/hfdl');
      assert.deepEqual([r.legsInserted, r.legsMerged], [1, 0], 'samostatný úsek');
      const { ends, seeded, listed } = seedAfterRestart(store);
      assert.equal(ends.length, 1);
      assert.equal(seeded, expected, callsign);
      if (expected) {
        assert.equal(listed[0].tMs, T0 + 2700_000);
        assert.equal(listed[0].lon, -25.1);
        assert.equal(listed[0].altM, 4500, 'výška z posledného merania (HFDL ju nenesie)');
        assert.equal(listed[0].country, 'Ireland', 'krajina z úseku ADS-B (HFDL úsek ju nemá) — 2026-10-16');
      } else {
        assert.equal(ends[0].external, undefined, 'iný let — bez základu ostáva koniec bez kinematiky');
      }
    } finally {
      store.close();
    }
  }
});

test('reštart: samostatný HFDL úsek bez volacieho znaku — odhad dostane znak aj krajinu z úseku ADS-B, HFDL bez hexu ho potom nájde (2026-10-16)', () => {
  const store = openFlightHistory(':memory:', { now: () => RESTART_MS });
  try {
    const t0 = sec(T0);
    store.recordOpenSkyBody(JSON.stringify({ time: t0, states: [state({ ...baseFix, altM: 4500 }, t0)] }));
    const r = store.importFlight({ icao24: '4ca123', points: [{ t: t0 + 2700, lat: 53.0, lon: -25.1, alt: null, posSrc: HFDL_POS_SRC, callsign: '' }] }, 'adsb.lol/hfdl');
    assert.deepEqual([r.legsInserted, r.legsMerged], [1, 0], 'samostatný úsek');
    const { ends, seeded, listed, tracker } = seedAfterRestart(store);
    assert.equal(ends.length, 1);
    assert.deepEqual([ends[0].cs, ends[0].country], ['EIN105', 'Ireland']);
    assert.equal(seeded, 1);
    assert.deepEqual([listed[0].cs, listed[0].country], ['EIN105', 'Ireland']);
    const next = { hex: '', cs: 'EIN105', tMs: T0 + 3300_000, lat: 53.0, lon: -27.2, altM: null, kind: 'hfdl' };
    assert.equal(tracker.applyExternalFixes([next], RESTART_MS).applied.length, 1, 'párovanie podľa znaku funguje aj po reštarte');
  } finally {
    store.close();
  }
});

test('sťahovač + preukotvenie + História: staršia dávka s jedným HTTP 503 sa neoneskorí za novšiu — polohy oboch hodín sú v Histórii (2026-10-16)', async () => {
  if (typeof zlib.zstdCompressSync !== 'function') return; // Node bez zstd
  let now = Date.UTC(2026, 9, 11, 19, 5, 0);
  const { tracker } = trackerWith(baseFix, { now: () => now });
  const store = openFlightHistory(':memory:', { now: () => now });
  try {
    store.recordOpenSkyBody(JSON.stringify({ time: sec(T0), states: [state(baseFix, sec(T0))] }));
    const zst = (lon, hour, min) => zlib.zstdCompressSync(Buffer.from(line(freq(53.0, lon, { hour, min, sec: 0 }), { recv: Date.UTC(2026, 9, 11, hour, min, 5) })));
    const older = { name: 'adsblol-adl-hfdl_20261011-170051_20261011-180053.jsonl.zst', browser_download_url: 'https://dl/older', zst: zst(-21.5, 17, 30) };
    const newer = { name: 'adsblol-adl-hfdl_20261011-180051_20261011-190053.jsonl.zst', browser_download_url: 'https://dl/newer', zst: zst(-28.0, 18, 30) };
    let olderFails = 1;
    const fetchImpl = async (url) => {
      if (url.includes('/releases/tags/')) return { ok: true, status: 200, json: async () => ({ assets: [older, newer] }) };
      if (url === older.browser_download_url && olderFails-- > 0) return { ok: false, status: 503 };
      const { zst: buf } = url === older.browser_download_url ? older : newer;
      return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    };
    // To isté zapojenie ako vite.config.js onFixes: zásobník → applyExternalFixes(celý zásobník) → História.
    let buffer = [];
    const feed = createHfdlFeed({
      fetchImpl, now: () => now,
      onFixes: (fixes) => {
        buffer = buffer.concat(fixes);
        const r = tracker.applyExternalFixes(buffer, now);
        if (r.applied.length) store.importFlight({ icao24: '4ca123', points: historyPoints(r.applied) }, 'adsb.lol/hfdl');
      },
    });
    await feed.pollOnce();
    now += 10 * 60_000;
    await feed.pollOnce();
    const hfdlTimes = store.track('4ca123').filter((r) => r[10] === POS_SRC.HFDL).map((r) => new Date(r[0] * 1000).toISOString().slice(11, 16));
    assert.deepEqual(hfdlTimes, ['17:30', '18:30'], 'poloha neskôr doručenej hodiny nesmie prepadnúť ako zastaraná');
    assert.equal(tracker.list(now)[0].lon, -28.0, 'ukotvenie v najnovšej polohe');
  } finally {
    store.close();
  }
});
