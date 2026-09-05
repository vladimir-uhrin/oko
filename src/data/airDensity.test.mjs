// src/data/airDensity.test.mjs
// Historická hustota letov (adsb.lol globe_history, jeden deň) — 2026-09-05.
// Druhá inštancia spoločnej továrne densityDrape.js. Testy: dekódovanie readsb
// heatmap záznamov (vrátane regresie „záporná šírka nie je info-záznam"),
// agregácia, farebná rampa, riadok zdroja, lifecycle, tripwires registrácie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AIR_DENSITY_LAYER_ID,
  AIR_DENSITY_ALPHA_LIGHT,
  AIR_DENSITY_ALPHA_DARK,
  airDensitySourceLabel,
  createAirDensityLayer,
} from './airDensity.js';
import {
  HEAT_RECORD_BYTES,
  HEAT_SEPARATOR_HEX,
  HEAT_INFO_LAT_MIN,
  HEAT_DEG_SCALE,
  classifyHeatRecord,
  accumulateHeatSlice,
  paintAmberRgba,
  HEAT_ALT_FT_PER_UNIT,
  BRIDGE_MIN_KM,
  BRIDGE_MIN_KMH,
  BRIDGE_MAX_KMH,
  BRIDGE_MIN_ALT_UNITS,
  heatSeparatorTimeMs,
  haversineKm,
  gapBridgeDecision,
  greatCirclePoints,
  createGapTracker,
} from '../../scripts/build-air-density.mjs';

const META = {
  built: '2026-09-05',
  period: '2026-09-04',
  grid: { cols: 1440, rows: 720, cellDeg: 0.25 },
  bounds: { west: -180, east: 180, north: 90, south: -90 },
  stats: { cellsNonzero: 88851 },
};

function rec(hex, latDeg, lonDeg, alt = 350, gs = 450) {
  const b = Buffer.alloc(HEAT_RECORD_BYTES);
  b.writeUInt32LE(hex >>> 0, 0);
  b.writeInt32LE(Math.round(latDeg * HEAT_DEG_SCALE), 4);
  b.writeInt32LE(Math.round(lonDeg * HEAT_DEG_SCALE), 8);
  b.writeInt16LE(alt, 12);
  b.writeInt16LE(gs, 14);
  return b;
}
function rawRec(hex, latRaw, lonRaw) {
  const b = Buffer.alloc(HEAT_RECORD_BYTES);
  b.writeUInt32LE(hex >>> 0, 0); b.writeInt32LE(latRaw, 4); b.writeInt32LE(lonRaw, 8);
  return b;
}

test('lety: klasifikácia readsb záznamov — oddeľovač, info, placeholder, mimo rozsahu, pozícia', () => {
  assert.equal(classifyHeatRecord(HEAT_SEPARATOR_HEX, 416, 1795204864), 'separator');
  assert.equal(classifyHeatRecord(0x4b1234, HEAT_INFO_LAT_MIN | 7000, 0x41424344), 'info', 'lat ≥ 2^30 = squawk/callsign');
  assert.equal(classifyHeatRecord(0x4b1234, 0, 0), 'placeholder');
  assert.equal(classifyHeatRecord(0x4b1234, 95 * 1e6, 0), 'bad');
  assert.equal(classifyHeatRecord(0x4b1234, 48.1 * 1e6, 17.1 * 1e6), 'position');
  // REGRESIA (nález 2026-09-05): záporná šírka má v dvojkovom doplnku bit 30
  // nastavený — naivná maska `lat & (1<<30)` zmazala celú južnú pologuľu.
  assert.equal(classifyHeatRecord(0x7c6b1a, -33.9 * 1e6, 151.2 * 1e6), 'position', 'Sydney je pozícia, nie info');
  assert.equal(classifyHeatRecord(0x7c6b1a, -46.45 * 1e6, 168.3 * 1e6), 'position');
});

test('lety: agregácia počíta pozície do 0,25° mriežky a preskakuje ostatné druhy', () => {
  const buf = Buffer.concat([
    rawRec(HEAT_SEPARATOR_HEX, 416, 1795204864),
    rawRec(0xabc, 0, 0),
    rawRec(0xabc, HEAT_INFO_LAT_MIN | 1200, 0),
    rec(0xabc, 48.1, 17.1), rec(0xabd, 48.2, 17.2), rec(0xabe, 48.05, 17.05), // tá istá bunka? 48.0–48.25 × 17.0–17.25 → 48.2/17.2 áno, 48.05 áno
    rec(0x7c6b1a, -33.9, 151.2), // Sydney (južná pologuľa)
    rec(0xdead, 89.999, 179.999), // hrana → posledná bunka riadka 0
    rec(0xbeef, -89.999, -179.999), // hrana → prvá bunka posledného riadka
  ]);
  const cols = 1440, rows = 720, sum = new Float64Array(cols * rows), tally = {};
  accumulateHeatSlice(buf, sum, tally, cols, rows, 0.25);
  assert.equal(tally.separator, 1);
  assert.equal(tally.placeholder, 1);
  assert.equal(tally.info, 1);
  assert.equal(tally.position, 6);
  const cell = (lat, lon) => sum[Math.floor((90 - lat) / 0.25) * cols + Math.floor((lon + 180) / 0.25)];
  assert.equal(cell(48.1, 17.1), 3, 'tri vzorky v bratislavskej bunke');
  assert.equal(cell(-33.9, 151.2), 1, 'Sydney sa počíta');
  assert.equal(sum[0 * cols + (cols - 1)], 1, 'severovýchodná hrana orezaná do mriežky');
  assert.equal(sum[(rows - 1) * cols + 0], 1, 'juhozápadná hrana orezaná do mriežky');
  let total = 0; for (const v of sum) total += v;
  assert.equal(total, 6);
});

test('lety: jantárová rampa — nula priehľadná, alfa rastie s intenzitou, plná = bledé zlato', () => {
  const rgba = paintAmberRgba(new Float32Array([0, 0.3, 1]));
  assert.equal(rgba[3], 0);
  assert.ok(rgba[4 + 3] > 0 && rgba[4 + 3] < rgba[8 + 3]);
  assert.equal(rgba[8 + 3], 255);
  assert.deepEqual([rgba[8], rgba[9], rgba[10]], [255, 225, 150], 'plná intenzita = bledé zlato (iná farba než lodná azúrová)');
  assert.ok(rgba[4] >= 150 && rgba[4 + 2] < 100, 'stredná intenzita je jantárová, nie modrá');
});

test('lety: premostenie — rozhodnutie o medzere (transatlantik áno; pomalé, rýchle, nízke, krátke nie)', () => {
  const H = 3.6e6;
  const shannon = { lat: 52.7, lon: -9.0, alt: 1440, t: 0 };
  const gander = { lat: 48.9, lon: -54.6, alt: 1440, t: 4 * H };
  const km = haversineKm(shannon.lat, shannon.lon, gander.lat, gander.lon);
  assert.ok(km > 3000 && km < 3400, `Shannon–Gander ≈ 3 200 km, got ${km}`);
  const d = gapBridgeDecision(shannon, gander);
  assert.equal(d.bridge, true);
  assert.ok(d.kmh > 750 && d.kmh < 850, `cestovná rýchlosť, got ${d.kmh}`);
  assert.equal(gapBridgeDecision(shannon, { ...gander, t: 9 * H }).reason, 'slow', 'pristátie + neskorší odlet nie je jeden let');
  assert.equal(gapBridgeDecision(shannon, { ...gander, t: 2 * H }).reason, 'fast');
  assert.equal(gapBridgeDecision(shannon, { ...gander, alt: 200 }).reason, 'low', '5 000 ft na konci = klesanie do nepokrytého letiska');
  assert.equal(gapBridgeDecision(shannon, { lat: 53.4, lon: -6.2, alt: 1440, t: 0.3 * H }).reason, 'short', 'Shannon–Dublin ≈ 200 km = bežné odovzdanie medzi prijímačmi');
  assert.equal(gapBridgeDecision(null, gander).reason, 'notime');
  assert.equal(gapBridgeDecision({ ...shannon, t: null }, gander).reason, 'notime');
  assert.equal(BRIDGE_MIN_ALT_UNITS * HEAT_ALT_FT_PER_UNIT, 10_000, 'readsb alt = ft / 25');
  assert.ok(BRIDGE_MIN_KM >= 400 && BRIDGE_MIN_KMH >= 400 && BRIDGE_MAX_KMH <= 1200);
});

test('lety: veľkokružnica — body medzi koncami, cez antimeridián bez skoku, správny počet, bez NaN', () => {
  const pts = greatCirclePoints(35.5, 139.8, 37.6, -122.4, 9); // Tokio → San Francisco
  assert.equal(pts.length, 18);
  for (let i = 0; i < 9; i++) {
    const la = pts[i * 2], lo = pts[i * 2 + 1];
    assert.ok(la > 35 && la < 60, `severný oblúk, lat ${la}`);
    assert.ok(Math.abs(lo) <= 180);
    assert.ok(lo > 139.8 || lo < -122.4, `vnútorný bod je v Pacifiku, lon ${lo}`);
  }
  const mid = greatCirclePoints(0, 10, 40, 10, 1);
  assert.ok(Math.abs(mid[0] - 20) < 1e-9 && Math.abs(mid[1] - 10) < 1e-9, 'stred poludníkového oblúka');
  const same = greatCirclePoints(10, 10, 10, 10, 2);
  assert.ok(Number.isFinite(same[0]) && Number.isFinite(same[1]), 'degenerovaný oblúk nedá NaN');
});

test('lety: tracker premostí dieru v pokrytí syntetickými 10-s vzorkami, pozorovaná mriežka ostáva čistá', () => {
  const sepAt = (ms) => { const b = Buffer.alloc(HEAT_RECORD_BYTES); b.writeUInt32LE(HEAT_SEPARATOR_HEX, 0); b.writeUInt32LE(Math.floor(ms / 4294967296), 4); b.writeUInt32LE(ms % 4294967296, 8); return b; };
  const T0 = Date.UTC(2026, 8, 4, 12, 0, 0);
  const H = 3.6e6;
  assert.equal(heatSeparatorTimeMs(sepAt(T0), 0), T0, 'oddeľovač nesie Unix ms (hi/lo 32 bit)');
  const buf = Buffer.concat([
    sepAt(T0), rec(0xabc, 52.7, -9.0, 1440), rec(0xdef, 52.7, -9.0, 1440),
    sepAt(T0 + 4 * H), rec(0xabc, 48.9, -54.6, 1440), rec(0xdef, 48.9, -54.6, 100), // druhý klesá → 'low', nepremostený
  ]);
  const cols = 1440, rows = 720, sum = new Float64Array(cols * rows), tally = {};
  const tracker = createGapTracker(cols, rows, 0.25);
  accumulateHeatSlice(buf, sum, tally, cols, rows, 0.25, tracker);
  assert.equal(tally.position, 4);
  assert.equal(tally.separator, 2);
  assert.equal(tracker.stats.gaps, 1);
  assert.equal(tracker.stats.samples, 4 * 360 - 1, 'jedna vzorka na 10 s, bez koncových bodov');
  assert.equal(tracker.stats.rejected.low, 1);
  let observedTotal = 0; for (const v of sum) observedTotal += v;
  assert.equal(observedTotal, 4, 'pozorovaná mriežka nesie len skutočné body');
  const idx = (la, lo) => Math.floor((90 - la) / 0.25) * cols + Math.floor((lo + 180) / 0.25);
  const mid = greatCirclePoints(52.7, -9.0, 48.9, -54.6, 1);
  assert.ok(tracker.sum[idx(mid[0], mid[1])] > 0, 'stred Atlantiku je premostený');
  assert.equal(tracker.sum[idx(10, -30)], 0, 'mimo oblúka nič');
  assert.ok(Math.round(tracker.stats.maxKm) > 3000);
  assert.equal(tracker.last.size, 2);
});

test('lety: riadok zdroja hlási interpoláciu len keď bake premostil medzery (pravidlo 2)', () => {
  assert.doesNotMatch(airDensitySourceLabel(META), /interpol/i);
  const label = airDensitySourceLabel({ ...META, stats: { ...META.stats, bridged: { gaps: 19169 } } });
  assert.match(label, /medzery nad oceánom interpolované|ocean gaps interpolated/);
  assert.ok(label.indexOf('interpol') < label.indexOf('ODbL'), 'poznámka o interpolácii pred licenciou');
  assert.match(label, /HISTORICK|HISTORICAL/i);
});

test('lety: riadok zdroja nesie sieť, deň, licenciu a HISTORICKÉ (pravidlo 2)', () => {
  const label = airDensitySourceLabel(META);
  assert.match(label, /adsb\.lol/);
  assert.match(label, /2026-09-04/);
  assert.match(label, /ODbL 1\.0 \/ CC0/);
  assert.match(label, /HISTORICK|HISTORICAL/i);
  assert.match(airDensitySourceLabel(null), /adsb\.lol/);
});

test('lety: lifecycle cez spoločnú továreň — primitív, alfa podľa kontrastu, destroy', async () => {
  let prim = null;
  const viewer = { scene: { primitives: { add() {}, remove() {} } } };
  const layer = createAirDensityLayer({
    fetchImpl: async () => ({ ok: true, json: async () => META }),
    imageLoader: async (url) => ({ testImage: url }),
    primitiveFactory: ({ alpha }) => { prim = { show: false, appearance: { material: { uniforms: { color: { alpha } } } } }; return prim; },
  });
  assert.equal(layer.id, AIR_DENSITY_LAYER_ID);
  layer.init(viewer);
  await layer.enable();
  assert.ok(prim && layer._getStateForTest().loaded);
  assert.equal(layer.getStatus().state, 'ready');
  assert.equal(layer.getStatus().count, 88851);
  assert.ok([AIR_DENSITY_ALPHA_LIGHT, AIR_DENSITY_ALPHA_DARK].some((a) => Math.abs(prim.appearance.material.uniforms.color.alpha - a) < 1e-9), 'alfa z palety podkladu');
  layer.destroy(viewer);
  assert.equal(layer._getStateForTest().hasPrimitive, false);
});

test('lety: tripwire — register (token j pred letiskami), localLayers, i18n EN+SK, kredit, bundle s licenciami', () => {
  const registry = readFileSync(new URL('./layerState.js', import.meta.url), 'utf8');
  assert.match(registry, /id: 'local-air-density', token: 'j', disposition: 'enabled-only'/);
  assert.ok(registry.indexOf("id: 'local-air-density'") < registry.indexOf("id: 'local-airports'"), 'abecedne pred local-airports (register pinuje poradie)');

  const local = readFileSync(new URL('./localLayers.js', import.meta.url), 'utf8');
  assert.match(local, /import airDensityLayer from '\.\/airDensity\.js';/);
  assert.match(local, /\n\s*airDensityLayer,\n/);

  const i18n = readFileSync(new URL('../i18nStrings.js', import.meta.url), 'utf8');
  assert.match(i18n, /'layer\.local-air-density\.name': 'Historical Air Traffic Density'/);
  assert.match(i18n, /'layer\.local-air-density\.name': 'Historická hustota letov'/);
  assert.match(i18n, /'airdensity\.historical': 'HISTORICAL, not live'/);
  assert.match(i18n, /'airdensity\.historical': 'HISTORICKÉ, nie živé'/);
  assert.match(i18n, /'airdensity\.bridged': 'ocean gaps interpolated'/);
  assert.match(i18n, /'airdensity\.bridged': 'medzery nad oceánom interpolované'/);

  const credits = readFileSync(new URL('./dataCredits.js', import.meta.url), 'utf8');
  assert.match(credits, /key: 'air-density'/);
  assert.match(credits, /adsb\.lol globe_history/);
  assert.match(credits, /ODbL 1\.0/);
  assert.match(credits, /modelled, not live/);
  assert.match(credits, /bridged along great circles/, 'kredit priznáva interpoláciu');

  const src = readFileSync(new URL('./airDensity.js', import.meta.url), 'utf8');
  assert.match(src, /createDensityDrapeLayer\(\{/, 'tenký obal nad spoločnou továrňou');

  const meta = JSON.parse(readFileSync(new URL('./local_data/air_density/air-density.json', import.meta.url), 'utf8'));
  assert.equal(meta.license, 'ODbL 1.0 + CC0 1.0');
  assert.equal(meta.grid.cols, 1440);
  assert.equal(meta.grid.rows, 720);
  assert.equal(meta.stats.badRecords, 0);
  assert.ok(meta.stats.positions > 10_000_000, 'desiatky miliónov 10-s vzoriek za deň');
  assert.ok(meta.stats.bridged.gaps > 1000, 'oceán premostený');
  assert.ok(meta.stats.bridged.shareOfSamples > 0 && meta.stats.bridged.shareOfSamples < 0.5, 'interpolácia ostáva menšinou vzoriek');
  assert.equal(meta.stats.bridged.rules.minGapKm, BRIDGE_MIN_KM);
  assert.equal(meta.stats.bridged.rules.minAltFt, BRIDGE_MIN_ALT_UNITS * HEAT_ALT_FT_PER_UNIT);
  assert.match(meta.valueMeaning, /INTERPOLATED/);
  const png = readFileSync(new URL('./local_data/air_density/air-density.png', import.meta.url));
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.ok(png.length < 1.5 * 1024 * 1024);
  for (const f of ['LICENSE-ODbL.txt', 'LICENSE-cc0.txt', 'README-adsblol.txt']) {
    assert.ok(readFileSync(new URL(`./local_data/air_density/${f}`, import.meta.url)).length > 100, `${f} je v bundli (ODbL notice retention)`);
  }
});
