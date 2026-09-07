// src/data/shipDensity.test.mjs
// Historická hustota lodí (World Bank / IMF 2015–2021) — 2026-09-05.
// Vrstva pre „hluchý oceán": modelovaná, nikdy živá. Testy kryjú čisté
// funkcie modulu, DOM-less lifecycle s injektovanými závislosťami, čítačku
// BigTIFF + agregáciu build skriptu na syntetických dátach, a tripwires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, openSync, closeSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SHIP_DENSITY_LAYER_ID,
  SHIP_DENSITY_ALPHA,
  shipDensityBounds,
  shipDensitySourceLabel,
  createShipDensityLayer,
} from './shipDensity.js';
import {
  readBigTiffLayout,
  aggregateToGrid,
  normaliseGrid,
  paintRgba,
} from '../../scripts/build-ship-density.mjs';

const META = {
  built: '2026-09-05',
  period: '2015-01 to 2021-02',
  grid: { cols: 1440, rows: 680, cellDeg: 0.25 },
  bounds: { west: -180.015311275, east: 179.984688725, north: 85.002647937, south: -84.997352063 },
  stats: { cellsNonzero: 595623 },
};

test('hustota: hranice sa validujú a orezú do [−180,180]×[−90,90] (Cesium Rectangle chce [−π,π])', () => {
  const b = shipDensityBounds(META);
  assert.equal(b.west, -180, 'západ orezaný o 0,015° sliver, nie prewrapnutý');
  assert.ok(b.east < 180 && b.east > 179.98);
  assert.ok(b.north < 85.01 && b.south > -85.0);
  assert.throws(() => shipDensityBounds({}), /bounds missing/);
  assert.throws(() => shipDensityBounds({ bounds: { west: 10, east: 0, south: 0, north: 1 } }), /inverted/);
  assert.throws(() => shipDensityBounds({ bounds: { west: -200, east: 0, south: 0, north: 1 } }), /out of range/);
});

test('hustota: riadok zdroja nesie obdobie, licenciu aj slovo HISTORICKÉ (pravidlo 2)', () => {
  const label = shipDensitySourceLabel(META);
  assert.match(label, /World Bank \/ IMF/);
  assert.match(label, /2015-01 – 2021-02/);
  assert.match(label, /CC BY 4\.0/);
  assert.match(label, /HISTORICK|HISTORICAL/i, 'operátor nesmie vrstvu považovať za živú');
  assert.match(shipDensitySourceLabel(null), /2015 – 2021/, 'bez meta ostáva poctivé obdobie');
});

test('hustota: lifecycle bez DOM — primitív vzniká po načítaní, show sleduje enable/disable, destroy uprace', async () => {
  const removed = [];
  const added = [];
  const viewer = { scene: { primitives: { add: (p) => added.push(p), remove: (p) => removed.push(p) } } };
  const fetchImpl = async (url) => ({ ok: true, json: async () => META, url });
  const images = [];
  const layer = createShipDensityLayer({
    metaUrl: 'meta.json',
    pngUrl: 'density.png',
    fetchImpl,
    imageLoader: async (url) => { images.push(url); return { testImage: url }; },
    primitiveFactory: ({ rectangle, image }) => ({ show: false, rectangle, image }),
  });
  layer.init(viewer);
  assert.equal(layer.getStatus().state, 'idle');
  await layer.enable();
  const s = layer._getStateForTest();
  assert.equal(s.loaded, true);
  assert.equal(s.hasPrimitive, true);
  assert.equal(s.shown, true, 'po enable je drape viditeľný');
  assert.equal(added.length, 1, 'jeden primitív v scéne');
  assert.deepEqual(images, ['density.png']);
  assert.ok(added[0].rectangle, 'primitív dostal obdĺžnik');
  assert.equal(layer.getStatus().state, 'ready');
  assert.equal(layer.getStatus().count, 595623);
  assert.equal(layer.getStats().lastUpdate, Date.parse('2026-09-05'), 'vek = dátum snímky, nie fetch');

  layer.disable();
  assert.equal(layer._getStateForTest().shown, false);
  await layer.enable();
  assert.equal(layer._getStateForTest().shown, true, 're-enable nezakladá druhý primitív');
  assert.equal(added.length, 1);

  await layer.update();
  assert.equal(added.length, 1, 'update po načítaní je no-op');

  layer.destroy(viewer);
  assert.equal(removed.length, 1);
  assert.equal(layer._getStateForTest().hasPrimitive, false);
  assert.equal(layer.getStatus().state, 'idle');
});

test('hustota: zlyhanie sidecaru je chyba stavu, nie výnimka v enable', async () => {
  const layer = createShipDensityLayer({
    fetchImpl: async () => ({ ok: false, status: 404 }),
    imageLoader: async () => { throw new Error('should not be reached'); },
    primitiveFactory: () => { throw new Error('should not be reached'); },
  });
  layer.init({ scene: { primitives: { add() {}, remove() {} } } });
  await layer.enable();
  assert.equal(layer.getStatus().state, 'error');
  assert.match(layer.getStatus().message, /HTTP 404/);
  assert.equal(layer._getStateForTest().hasPrimitive, false);
});

// ── build skript: čítačka BigTIFF na syntetickom súbore ─────────────────────

/** Postav malý LE BigTIFF: 4×4 px, int32, dlaždice 2×2 (4 dlaždice po 16 B). */
function writeSyntheticBigTiff(path) {
  const W = 4, H = 4, TW = 2, TH = 2, tiles = 4;
  const entries = [
    [256, 4, 1, W], [257, 4, 1, H], [258, 3, 1, 32], [259, 3, 1, 1], [277, 3, 1, 1],
    [322, 4, 1, TW], [323, 4, 1, TH],
    [324, 16, tiles, null], // TileOffsets LONG8 → external
    [325, 4, tiles, null],  // TileByteCounts LONG → external (rôzna veľkosť prvku!)
    [339, 3, 1, 2],
  ];
  const ifdOff = 16;
  const ifdLen = 8 + entries.length * 20 + 8;
  const offsArr = ifdOff + ifdLen;
  const cntArr = offsArr + tiles * 8;
  const dataOff = cntArr + tiles * 4;
  const buf = Buffer.alloc(dataOff + tiles * 16);
  buf.write('II', 0, 'ascii'); buf.writeUInt16LE(43, 2); buf.writeUInt16LE(8, 4); buf.writeUInt16LE(0, 6);
  buf.writeBigUInt64LE(BigInt(ifdOff), 8);
  buf.writeBigUInt64LE(BigInt(entries.length), ifdOff);
  entries.forEach(([tag, typ, count, val], i) => {
    const o = ifdOff + 8 + i * 20;
    buf.writeUInt16LE(tag, o); buf.writeUInt16LE(typ, o + 2); buf.writeBigUInt64LE(BigInt(count), o + 4);
    if (val !== null) buf.writeBigUInt64LE(BigInt(val), o + 12);
    else buf.writeBigUInt64LE(BigInt(tag === 324 ? offsArr : cntArr), o + 12);
  });
  buf.writeBigUInt64LE(0n, ifdOff + 8 + entries.length * 20);
  for (let k = 0; k < tiles; k++) {
    buf.writeBigUInt64LE(BigInt(dataOff + k * 16), offsArr + k * 8);
    buf.writeUInt32LE(16, cntArr + k * 4);
    for (let p = 0; p < 4; p++) buf.writeInt32LE(k + 1, dataOff + k * 16 + p * 4);
  }
  writeFileSync(path, buf);
  return { W, H, TW, TH, tiles, dataOff };
}

test('build: BigTIFF hlavička — rozmery, dlaždice, a rôzne veľkosti prvkov offsetov (LONG8) vs. počtov (LONG)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oko-shipdensity-'));
  const path = join(dir, 'synthetic.tif');
  const exp = writeSyntheticBigTiff(path);
  const fd = openSync(path, 'r');
  try {
    const layout = readBigTiffLayout(fd);
    assert.equal(layout.width, exp.W);
    assert.equal(layout.height, exp.H);
    assert.equal(layout.tileW, exp.TW);
    assert.equal(layout.tileH, exp.TH);
    assert.equal(layout.compression, 1);
    assert.equal(layout.bitsPerSample, 32);
    assert.equal(layout.sampleFormat, 2);
    assert.equal(layout.tileOffsets.length, 4);
    assert.equal(layout.tileByteCounts.length, 4);
    // Toto je presne chyba, ktorá pri prvom pokuse dala 281 biliónov B/dlaždicu:
    // TileByteCounts je 4-bajtový LONG, TileOffsets 8-bajtový LONG8.
    assert.deepEqual(Array.from(layout.tileByteCounts), [16, 16, 16, 16]);
    assert.equal(layout.tileOffsets[0], exp.dataOff);
    assert.equal(layout.tileOffsets[3], exp.dataOff + 48);
  } finally {
    closeSync(fd);
  }
});

test('build: agregácia SČÍTA bloky (nie priemer), maskuje nodata a záporné, rešpektuje čiastočný posledný riadok', () => {
  // 100×75 px, dlaždice 50×50 → 2 stĺpce × 2 riadky dlaždíc; výstup 2×2 bunky
  // po 50 px (posledný riadok buniek má len 25 px).
  const layout = { width: 100, height: 75, tileW: 50, tileH: 50, tileOffsets: new Float64Array(4) };
  const NODATA = 2147483647;
  const readTile = (i, into) => {
    for (let p = 0; p < 50 * 50; p++) {
      let v = 1;                 // každý px = 1 → bunka 50×50 = 2500
      if (i === 1) v = 3;        // pravá horná dlaždica: 3/px → 7500
      if (i === 0 && p < 10) v = NODATA;   // 10 nodata px v ľavej hornej
      if (i === 0 && p >= 10 && p < 15) v = -5; // záporné sa ignorujú
      into.writeInt32LE(v, p * 4);
    }
  };
  const { cols, rows, sum } = aggregateToGrid(layout, readTile);
  assert.equal(cols, 2);
  assert.equal(rows, 2);
  assert.equal(sum[0], 2500 - 15, 'ľavá horná: 2500 px mínus 10 nodata mínus 5 záporných');
  assert.equal(sum[1], 7500, 'pravá horná: súčet, nie priemer (3 × 2500)');
  assert.equal(sum[2], 25 * 50, 'ľavá dolná: len 25 riadkov px existuje');
  assert.equal(sum[3], 25 * 50);
});

test('build: log-normalizácia medzi podlahou a stropom — bežné more priehľadné, prístav neprepáli trasu', () => {
  // Nález 2026-09-05: normalizácia od nuly namaľovala celý oceán nepriehľadnou
  // azúrovou (61 % buniek má ≥1 pozíciu, bežné more 10⁵–10⁷). Podlaha = bežné
  // more → 0; nad ňou trasy, strop oreže prístavy.
  const sum = new Float64Array([0, 1, 10, 100, 1000, 1e6, 1e9]);
  const { norm, ceiling, floor, cellsNonzero, max } = normaliseGrid(sum, 0.5, 0.2);
  assert.equal(cellsNonzero, 6);
  assert.equal(max, 1e9);
  assert.equal(ceiling, 1000, '50. percentil nenulových = 1000');
  assert.equal(floor, 10, '20. percentil nenulových = 10');
  assert.equal(norm[0], 0, 'nula = 0');
  assert.equal(norm[1], 0, 'pod podlahou = priehľadné (bežné more)');
  assert.equal(norm[2], 0, 'NA podlahe = priehľadné');
  assert.ok(norm[3] > 0.4 && norm[3] < 0.6, `medzi podlahou a stropom log-lineárne (${norm[3]})`);
  assert.ok(Math.abs(norm[4] - 1) < 1e-6, 'strop = 1');
  assert.equal(norm[6], 1, 'nad stropom sa oreže na 1 — prístav nezatieni trasy');
  const rgba = paintRgba(norm);
  assert.equal(rgba[3], 0, 'nulová bunka je úplne priehľadná');
  assert.equal(rgba[4 * 2 + 3], 0, 'bunka na podlahe je úplne priehľadná');
  assert.ok(rgba[4 * 3 + 3] > 0 && rgba[4 * 3 + 3] < rgba[4 * 4 + 3], 'alfa rastie s intenzitou');
  assert.ok(rgba[4 * 3 + 3] < 128, 'stredná intenzita ostáva slabý opar (gama > 1)');
  assert.equal(rgba[4 * 4 + 3], 255);
  assert.equal(rgba[4 * 4 + 2], 255, 'plná intenzita = bledá azúrová');
});

// ── tripwires ────────────────────────────────────────────────────────────────

test('hustota: tripwire — registrácia, i18n EN+SK, kredit, primitív nie imageryLayers, sidecar+PNG zabundlované', () => {
  const src = readFileSync(new URL('./shipDensity.js', import.meta.url), 'utf8');
  assert.equal(SHIP_DENSITY_LAYER_ID, 'local-ship-density');
  // Render/lifecycle žije v spoločnej továrni densityDrape.js (lode + lety);
  // shipDensity.js je tenký obal, ktorý jej deleguje.
  assert.match(src, /createDensityDrapeLayer\(\{/, 'shipDensity deleguje továrni');
  const drape = readFileSync(new URL('./densityDrape.js', import.meta.url), 'utf8');
  assert.match(drape, /new Cesium\.RectangleGeometry\(/, 'drape ako textúrovaný primitív (vzor SHMÚ)');
  // Slovo samotné je v doc-komentári (vysvetľuje, PREČO nie) — pinujeme volanie.
  assert.doesNotMatch(drape, /\.imageryLayers\.(add|addImageryProvider)\(/, 'nikdy imageryLayers.add — s Google 3D môže byť glóbus skrytý');
  assert.match(drape, /Material\.fromType\('Image'/, 'Image materiál');
  assert.match(drape, /cache: 'no-cache'/, 'sidecar sa revaliduje po prebake');
  assert.ok(SHIP_DENSITY_ALPHA > 0 && SHIP_DENSITY_ALPHA <= 1);

  const registry = readFileSync(new URL('./layerState.js', import.meta.url), 'utf8');
  assert.match(registry, /id: 'local-ship-density', token: 'n', disposition: 'enabled-only'/, 'token n v registri');
  const local = readFileSync(new URL('./localLayers.js', import.meta.url), 'utf8');
  assert.match(local, /import shipDensityLayer from '\.\/shipDensity\.js';/);
  assert.match(local, /\n\s*shipDensityLayer,\n/, 'vrstva je v poli localDataLayers');

  const i18n = readFileSync(new URL('../i18nStrings.js', import.meta.url), 'utf8');
  assert.match(i18n, /'layer\.local-ship-density\.name': 'Historical Ship Density'/);
  assert.match(i18n, /'layer\.local-ship-density\.name': 'Historická hustota lodí'/);
  assert.match(i18n, /'shipdensity\.historical': 'HISTORICAL, not live'/);
  assert.match(i18n, /'shipdensity\.historical': 'HISTORICKÉ, nie živé'/);

  const credits = readFileSync(new URL('./dataCredits.js', import.meta.url), 'utf8');
  assert.match(credits, /key: 'ship-density'/);
  assert.match(credits, /World Bank \/ IMF Global Shipping Traffic Density/);
  assert.match(credits, /CC BY 4\.0/);
  assert.match(credits, /modelled, not live/);

  const meta = JSON.parse(readFileSync(new URL('./local_data/ship_density/ship-density.json', import.meta.url), 'utf8'));
  assert.equal(meta.license, 'CC BY 4.0');
  assert.equal(meta.grid.cols, 1440);
  assert.equal(meta.grid.rows, 680);
  assert.doesNotThrow(() => shipDensityBounds(meta), 'vypečený sidecar prejde validáciou modulu');
  const png = readFileSync(new URL('./local_data/ship_density/ship-density.png', import.meta.url));
  assert.equal(png.toString('ascii', 1, 4), 'PNG', 'zabundlované PNG');
  assert.ok(png.length < 1.5 * 1024 * 1024, 'pod stropom bundlovaných datasetov (1,5 MB)');
});

// ── Alfa podľa kontrastu podkladu (2026-09-05, „nedá sa trochu znížiť?") ─────
import { shipDensityAlpha, SHIP_DENSITY_ALPHA_LIGHT, SHIP_DENSITY_ALPHA_DARK } from './shipDensity.js';
import { setBasemapContrast, _resetContactPaletteForTest } from './contactPalette.js';

test('hustota: plášť je FLAT — bez slnečného osvetlenia, inak na nočnej strane zmizne (2026-09-07)', () => {
  const src = readFileSync(new URL('./densityDrape.js', import.meta.url), 'utf8');
  assert.match(src, /new Cesium\.EllipsoidSurfaceAppearance\(\{[\s\S]*?translucent: true,[\s\S]*?flat: true,/, 'EllipsoidSurfaceAppearance musí mať flat: true');
  const radar = readFileSync(new URL('./shmuRadar.js', import.meta.url), 'utf8');
  assert.match(radar, /new Cesium\.EllipsoidSurfaceAppearance\(\{[\s\S]*?flat: true,/, 'radarový plášť rovnako');
});

test('hustota: alfa podľa kontrastu — tmavý podklad slabšia, svetlý plná', () => {
  assert.equal(shipDensityAlpha('light'), SHIP_DENSITY_ALPHA_LIGHT);
  assert.equal(shipDensityAlpha('dark'), SHIP_DENSITY_ALPHA_DARK);
  assert.equal(shipDensityAlpha('nezmysel'), SHIP_DENSITY_ALPHA_DARK, 'neznámy kontrast = bezpečná tmavá');
  assert.ok(SHIP_DENSITY_ALPHA_DARK < SHIP_DENSITY_ALPHA_LIGHT);
  assert.ok(SHIP_DENSITY_ALPHA_DARK >= 0.3 && SHIP_DENSITY_ALPHA_DARK <= 0.6, 'na tmavom viditeľná, nie krik');
});

test('hustota: zmena podkladu prepíše alfu materiálu naživo; destroy sa odhlási', async () => {
  _resetContactPaletteForTest(); // dark
  const viewer = { scene: { primitives: { add() {}, remove() {} } } };
  // Primitív držíme cez closure factory, nech vieme čítať jeho uniformy.
  let prim = null;
  const layer2 = createShipDensityLayer({
    fetchImpl: async () => ({ ok: true, json: async () => META }),
    imageLoader: async (url) => ({ testImage: url }),
    primitiveFactory: () => { prim = { show: false, appearance: { material: { uniforms: { color: { alpha: -1 } } } } }; return prim; },
  });
  layer2.init(viewer);
  await layer2.enable();
  assert.ok(prim, 'primitív vznikol');
  setBasemapContrast('light');
  assert.ok(Math.abs(prim.appearance.material.uniforms.color.alpha - SHIP_DENSITY_ALPHA_LIGHT) < 1e-9, 'OSM → plná alfa');
  setBasemapContrast('dark');
  assert.ok(Math.abs(prim.appearance.material.uniforms.color.alpha - SHIP_DENSITY_ALPHA_DARK) < 1e-9, 'tmavý → slabšia');
  layer2.destroy(viewer);
  setBasemapContrast('light');
  assert.ok(Math.abs(prim.appearance.material.uniforms.color.alpha - SHIP_DENSITY_ALPHA_DARK) < 1e-9, 'po destroy už nepočúva');
  _resetContactPaletteForTest();
});

// ── Zoom-fade (2026-09-05, „pri zazoomovaní to bola hmlovina") ───────────────
import { shipDensityZoomFactor, SHIP_DENSITY_FADE_IN_M, SHIP_DENSITY_FADE_OUT_M } from './shipDensity.js';

test('hustota: zoom-faktor — 1 pri pohľade na svet, 0 zblízka, lineárne medzi, bez kamery 1', () => {
  assert.equal(shipDensityZoomFactor(12_000_000), 1);
  assert.equal(shipDensityZoomFactor(SHIP_DENSITY_FADE_IN_M), 1);
  assert.equal(shipDensityZoomFactor(SHIP_DENSITY_FADE_OUT_M), 0);
  assert.equal(shipDensityZoomFactor(800_000), 0, 'mesto/prieliv: hmlovina preč, hovoria živé lode');
  const mid = (SHIP_DENSITY_FADE_IN_M + SHIP_DENSITY_FADE_OUT_M) / 2;
  assert.ok(Math.abs(shipDensityZoomFactor(mid) - 0.5) < 1e-9);
  assert.equal(shipDensityZoomFactor(NaN), 1);
  assert.equal(shipDensityZoomFactor(undefined), 1);
  assert.ok(SHIP_DENSITY_FADE_OUT_M < SHIP_DENSITY_FADE_IN_M);
});

test('hustota: preRender tick škáluje alfu výškou a pri 0 skryje primitív; destroy odpojí tick', async () => {
  _resetContactPaletteForTest(); // dark → 0.45
  const ticks = new Set();
  const camera = { positionCartographic: { height: 12_000_000 } };
  const viewer = {
    camera,
    scene: {
      primitives: { add() {}, remove() {} },
      preRender: { addEventListener(fn) { ticks.add(fn); return () => ticks.delete(fn); } },
      requestRender() {},
    },
  };
  let prim = null;
  const layer = createShipDensityLayer({
    fetchImpl: async () => ({ ok: true, json: async () => META }),
    imageLoader: async (url) => ({ testImage: url }),
    primitiveFactory: () => { prim = { show: false, appearance: { material: { uniforms: { color: { alpha: -1 } } } } }; return prim; },
  });
  layer.init(viewer);
  await layer.enable();
  assert.equal(ticks.size, 1, 'preRender tick zavesený po načítaní');
  const tick = [...ticks][0];
  assert.ok(Math.abs(prim.appearance.material.uniforms.color.alpha - SHIP_DENSITY_ALPHA_DARK) < 1e-9, '12 000 km = plná (tmavá) alfa');
  assert.equal(prim.show, true);

  camera.positionCartographic.height = 800_000; tick();
  assert.equal(prim.appearance.material.uniforms.color.alpha, 0, '800 km = 0');
  assert.equal(prim.show, false, 'pri 0 sa primitív skryje');

  camera.positionCartographic.height = (SHIP_DENSITY_FADE_IN_M + SHIP_DENSITY_FADE_OUT_M) / 2; tick();
  assert.ok(Math.abs(prim.appearance.material.uniforms.color.alpha - SHIP_DENSITY_ALPHA_DARK * 0.5) < 1e-9, 'stred = polovica');
  assert.equal(prim.show, true);

  const before = prim.appearance.material.uniforms.color;
  tick();
  assert.equal(prim.appearance.material.uniforms.color, before, 'bez zmeny výšky sa uniform neprepisuje');

  layer.disable();
  assert.equal(prim.show, false);
  await layer.enable();
  assert.equal(prim.show, true, 're-enable rešpektuje zoom (stred > 0)');

  layer.destroy(viewer);
  assert.equal(ticks.size, 0, 'destroy odpojí preRender tick');
  _resetContactPaletteForTest();
});
