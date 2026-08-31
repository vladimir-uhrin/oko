import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as Cesium from 'cesium';
import {
  ZMAX_DBZ_PALETTE,
  ZMAX_MIN_DISPLAY_DBZ,
  dbzColor,
  despeckleZmax,
  mercatorRowLut,
  normalizeOdimComposite,
  odimTimestampIso,
  radarLegendStops,
  rasterizeZmax,
  renderZmax,
  softenRgba,
} from './shmuRadarGrid.js';
import {
  SHMU_RADAR_DRAPE_HEIGHT_M,
  createRadarFrameAnimator,
  createShmuRadarLayer,
} from './shmuRadar.js';

const require = createRequire(import.meta.url);

// Real /where + /dataset1/what attrs of the committed fixture (see
// fixtures/README.md) — the contract the decode pins itself to.
const FIXTURE_WHERE = {
  LL_lat: 46.04688049237037, LL_lon: 13.6,
  LR_lat: 46.05, LR_lon: 23.8,
  UL_lat: 50.7, UL_lon: 13.6,
  UR_lat: 50.7, UR_lon: 23.804495372410756,
  xsize: 2270, ysize: 1560,
};
const FIXTURE_DATASET_WHAT = {
  gain: 0.5019685039370079,
  offset: -32.50196850393701,
  nodata: -1,
  undetect: 0,
};

test('normalizeOdimComposite pins the fixture contract and masks sentinels to bytes', () => {
  const meta = normalizeOdimComposite({ where: FIXTURE_WHERE, datasetWhat: FIXTURE_DATASET_WHAT });
  assert.equal(meta.width, 2270);
  assert.equal(meta.height, 1560);
  // nodata is declared -1 but the payload is <u1 — the mask must land on 255,
  // otherwise out-of-domain corners render as maximum-reflectivity echoes.
  assert.equal(meta.nodataRaw, 255);
  assert.equal(meta.undetectRaw, 0);
  assert.ok(meta.bounds.west === 13.6 && meta.bounds.north === 50.7);
  assert.ok(meta.bounds.east > 23.8 && meta.bounds.south < 46.05);
  assert.throws(() => normalizeOdimComposite({ where: {}, datasetWhat: FIXTURE_DATASET_WHAT }));
});

test('mercatorRowLut is monotone, clamped, and stretches the north half', () => {
  const height = 1560;
  const lut = mercatorRowLut(height, 46.047, 50.7);
  assert.equal(lut[0], 0);
  assert.equal(lut[height - 1], height - 1);
  for (let i = 1; i < height; i++) assert.ok(lut[i] >= lut[i - 1], `non-monotone at ${i}`);
  // Mercator stretches high latitudes: the linear-latitude midpoint lies
  // SOUTH of the Mercator midpoint, so it must map into the southern half of
  // the source grid. If this flips, the drape is vertically mirrored.
  assert.ok(lut[Math.floor(height / 2)] > height / 2, 'midpoint must map south of centre');
});

test('dbzColor thresholds: transparent below display floor, ramp is ordered', () => {
  assert.equal(dbzColor(ZMAX_MIN_DISPLAY_DBZ - 0.1), null);
  assert.equal(dbzColor(Number.NaN), null);
  assert.deepEqual(dbzColor(ZMAX_MIN_DISPLAY_DBZ), ZMAX_DBZ_PALETTE[0].rgba);
  assert.deepEqual(dbzColor(200), ZMAX_DBZ_PALETTE[ZMAX_DBZ_PALETTE.length - 1].rgba);
  for (let i = 1; i < ZMAX_DBZ_PALETTE.length; i++) {
    assert.ok(ZMAX_DBZ_PALETTE[i].min > ZMAX_DBZ_PALETTE[i - 1].min, 'palette stops must ascend');
  }
});

test('despeckle drops isolated cells and keeps coherent echo clusters', () => {
  const meta = normalizeOdimComposite({
    where: { ...FIXTURE_WHERE, xsize: 8, ysize: 8 },
    datasetWhat: FIXTURE_DATASET_WHAT,
  });
  const echo = Math.ceil((ZMAX_MIN_DISPLAY_DBZ - meta.offset) / meta.gain) + 10;
  const raw = new Uint8Array(64); // all undetect
  raw[1 * 8 + 1] = echo; // izolovaná bodka — musí zmiznúť
  // 2×2 chuchvalec (typický biologický clutter), mimo 5×5 okna zhluku nižšie
  raw[0 * 8 + 5] = echo;
  raw[0 * 8 + 6] = echo;
  raw[1 * 8 + 5] = echo;
  raw[1 * 8 + 6] = echo;
  // súvislý 3×3 zhluk (~1 km jadro prehánky) — musí prežiť celý
  const cluster = [];
  for (let r = 4; r <= 6; r++) for (let c = 4; c <= 6; c++) cluster.push(r * 8 + c);
  for (const at of cluster) raw[at] = echo;
  const cleaned = despeckleZmax(raw, meta);
  assert.equal(cleaned[1 * 8 + 1], meta.undetectRaw, 'isolated speckle must be removed');
  for (const at of [0 * 8 + 5, 0 * 8 + 6, 1 * 8 + 5, 1 * 8 + 6]) {
    assert.equal(cleaned[at], meta.undetectRaw, '2×2 clutter clump must be removed');
  }
  for (const at of cluster) {
    assert.equal(cleaned[at], echo, '3×3 shower core must survive intact');
  }
  assert.notEqual(raw[1 * 8 + 1], meta.undetectRaw, 'input must stay untouched');
});

test('softenRgba spreads echoes without dark fringes (premultiplied blur)', () => {
  const w = 21; const h = 21;
  const rgba = new Uint8ClampedArray(w * h * 4);
  const center = (10 * w + 10) * 4;
  rgba[center] = 250; rgba[center + 1] = 220; rgba[center + 2] = 70; rgba[center + 3] = 200;
  const soft = softenRgba(rgba, w, h);
  let covered = 0;
  for (let i = 0; i < w * h; i++) {
    const a = soft[i * 4 + 3];
    if (a === 0) continue;
    covered++;
    // Unpremultiplied naive blur would drag RGB toward transparent BLACK —
    // every visible pixel must keep the source hue (yellow: R>B, G>B).
    assert.ok(soft[i * 4] > soft[i * 4 + 2], `hue lost at px ${i} (R ${soft[i * 4]} vs B ${soft[i * 4 + 2]})`);
    assert.ok(soft[i * 4 + 1] > soft[i * 4 + 2], `hue lost at px ${i}`);
  }
  assert.ok(covered > 20, `single cell must spread into a visible blob (got ${covered}px)`);
  assert.ok(soft[center + 3] > 0, 'centre must stay visible');
});

test('fixture decodes end-to-end: real echoes, sentinels transparent', () => {
  const hdf5 = require('jsfive');
  const buf = readFileSync(new URL('./fixtures/shmu-zmax-20260830T181000Z.hdf', import.meta.url));
  const file = new hdf5.File(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'fixture');

  const meta = normalizeOdimComposite({
    where: file.get('where').attrs,
    datasetWhat: file.get('dataset1/what').attrs,
  });
  assert.equal(meta.width, 2270);
  assert.equal(meta.height, 1560);

  const what = file.get('what').attrs;
  assert.equal(odimTimestampIso(what.date, what.time), '2026-08-30T18:10:00Z');

  const value = file.get('dataset1/data1/data').value;
  const raw = value instanceof Uint8Array ? value : Uint8Array.from(value);
  const rawPass = rasterizeZmax(raw, meta);
  assert.equal(rawPass.rgba.length, meta.width * meta.height * 4);
  assert.ok(rawPass.echoPixels > 0, 'fixture day had real precipitation echoes');
  // Sentinel cells (undetect fill + out-of-domain corners) must be transparent:
  // echo pixels are a small minority of the 3.54M-cell grid.
  assert.ok(rawPass.echoPixels < raw.length * 0.25, `echoPixels ${rawPass.echoPixels} suspiciously high`);
  // Top-left corner of the composite is outside the radar domain (nodata).
  assert.equal(rawPass.rgba[3], 0, 'nodata corner must stay transparent');

  // The presentation pipeline (what the proxy actually serves): despeckle
  // removes part of the dry-day clutter but real cells survive, and softening
  // must not leak color into the out-of-domain corner.
  const presented = renderZmax(raw, meta);
  assert.ok(presented.echoPixels > 0, 'coherent echoes must survive despeckle');
  assert.ok(
    presented.echoPixels < rawPass.echoPixels,
    `despeckle should remove some clutter (${presented.echoPixels} vs ${rawPass.echoPixels})`,
  );
  assert.equal(presented.rgba[3], 0, 'softened corner must stay transparent');
});

test('radar legend: model tracks the palette, markup and clean-view hooks pinned', () => {
  const stops = radarLegendStops();
  assert.equal(stops.length, ZMAX_DBZ_PALETTE.length);
  assert.equal(stops[0].min, ZMAX_MIN_DISPLAY_DBZ, 'legend must start at the display floor');
  for (const [i, stop] of stops.entries()) {
    const [r, g, b] = ZMAX_DBZ_PALETTE[i].rgba;
    assert.ok(stop.css.startsWith(`rgba(${r}, ${g}, ${b},`), `stop ${i} color drifted from the palette`);
  }

  // Legenda žije v markup/ui/css — pinni háčiky, nech ju refactor nezhodí.
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="radar-legend"[^>]*hidden/);
  const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
  assert.ok(ui.includes("import { radarLegendStops } from './data/shmuRadarGrid.js'"), 'legend must be built from the palette, not hand-copied colors');
  assert.ok(ui.includes('this._syncRadarLegend(change);'), 'legend must ride the data-manager subscription');
  const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
  assert.match(css, /body\.ui-clean-view #radar-legend/);
  assert.match(css, /body\.recording-mode #radar-legend/);
});

test('frame animator: steps through frames, holds on newest, inert for ≤1 frame', () => {
  const shown = [];
  const pending = [];
  const animator = createRadarFrameAnimator({
    getFrameCount: () => 3,
    onShowFrame: (i) => shown.push(i),
    stepMs: 10,
    holdMs: 99,
    schedule: (fn, ms) => { pending.push({ fn, ms }); return pending.length; },
    cancel: () => { pending.length = 0; },
  });
  animator.start();
  // start → frame 0 hneď, potom krokuj cez pending timery
  const runNext = () => { const t = pending.shift(); t.fn(); return t.ms; };
  assert.deepEqual(shown, [0]);
  assert.equal(runNext(), 10); // 0 → 1
  assert.deepEqual(shown, [0, 1]);
  assert.equal(runNext(), 10); // 1 → 2 (najnovší)
  assert.deepEqual(shown, [0, 1, 2]);
  assert.equal(pending[0].ms, 99, 'newest frame must hold longer');
  runNext(); // wrap → 0
  assert.deepEqual(shown, [0, 1, 2, 0]);
  assert.ok(animator.running());
  animator.stop();
  assert.equal(animator.running(), false);

  // ≤1 frame: nič nebliká, ale slučka sa lenivo re-armuje pre neskorší ring.
  const single = [];
  const singlePending = [];
  const one = createRadarFrameAnimator({
    getFrameCount: () => 1,
    onShowFrame: (i) => single.push(i),
    schedule: (fn, ms) => { singlePending.push({ fn, ms }); return 1; },
    cancel: () => {},
  });
  one.start();
  assert.deepEqual(single, [0]);
  assert.equal(singlePending.length, 1, 'single frame keeps one lazy re-arm timer');
  one.stop();
});

test('layer contract: entity drape, stats, stale surfaced, id/cadence pinned', async () => {
  const meta = {
    ok: true,
    product: 'zmax',
    iso: '2026-08-30T18:10:00Z',
    bounds: { west: 13.6, south: 46.047, east: 23.804, north: 50.7 },
    echoPixels: 1234,
    stale: false,
    ttlMs: 300000,
    png: '/api/shmu/radar/frame/f3.png',
    frames: [
      { iso: '2026-08-30T18:00:00Z', echoPixels: 1100, png: '/api/shmu/radar/frame/f1.png' },
      { iso: '2026-08-30T18:05:00Z', echoPixels: 1180, png: '/api/shmu/radar/frame/f2.png' },
      { iso: '2026-08-30T18:10:00Z', echoPixels: 1234, png: '/api/shmu/radar/frame/f3.png' },
    ],
  };
  let served = meta;
  const built = [];
  const scenePrimitives = new Set();
  // update() hands the factory a PRELOADED image (DOM-less sentinel carries
  // the source URL) — never a URL string, so Cesium can't re-fetch and crash.
  const stubFactory = ({ rectangle, image }) => {
    const primitive = { show: false, rectangle, imageUrl: image?.testImage };
    built.push(primitive);
    return primitive;
  };
  const viewer = {
    scene: {
      primitives: {
        add: (p) => { scenePrimitives.add(p); return p; },
        remove: (p) => scenePrimitives.delete(p),
      },
    },
  };
  const layer = createShmuRadarLayer({
    fetchImpl: async () => ({ ok: true, json: async () => served }),
    primitiveFactory: stubFactory,
  });

  assert.equal(layer.id, 'shmu-radar');
  assert.equal(layer.updateInterval, 5 * 60 * 1000);
  assert.match(layer.source, /SHMÚ/);

  // Vždy uprac timery animátora — visiaci timer po páde assertu inak drží
  // celý node --test proces pri živote.
  try {
  layer.init(viewer);
  assert.equal(await layer.update(viewer), true);

  // Jeden skrytý primitív na frame; textúry ostávajú rezidentné.
  assert.equal(built.length, 3);
  assert.equal(scenePrimitives.size, 3);
  assert.deepEqual(built.map((p) => p.imageUrl), [
    '/api/shmu/radar/frame/f1.png',
    '/api/shmu/radar/frame/f2.png',
    '/api/shmu/radar/frame/f3.png',
  ]);
  assert.ok(built.every((p) => p.show === false), 'disabled layer keeps every frame hidden');
  assert.ok(Math.abs(Cesium.Math.toDegrees(built[0].rectangle.west) - 13.6) < 1e-6);
  assert.ok(Math.abs(Cesium.Math.toDegrees(built[0].rectangle.north) - 50.7) < 1e-6);

  // Enable spustí slučku okamžite od najstaršieho frame-u.
  layer.enable(viewer);
  assert.equal(built[0].show, true, 'enable must start the loop at the oldest frame');
  assert.equal(built[2].show, false);

  assert.deepEqual(layer.getStats().error, null);
  assert.equal(layer.getStats().stale, false);
  assert.equal(layer.getStats().count, 1234);
  // Freshness is the PRODUCT's valid time, and the row label carries it too.
  assert.equal(layer.getStats().lastUpdate, Date.parse(meta.iso));
  assert.match(layer.source, /18:10 UTC/);

  // Nový slot v ringu: pribudne len JEDEN primitív, staré sa zrecyklujú,
  // vypadnutý slot sa odstráni zo scény.
  served = {
    ...meta,
    iso: '2026-08-30T18:15:00Z',
    frames: [
      meta.frames[1],
      meta.frames[2],
      { iso: '2026-08-30T18:15:00Z', echoPixels: 1300, png: '/api/shmu/radar/frame/f4.png' },
    ],
  };
  assert.equal(await layer.update(viewer), true);
  assert.equal(built.length, 4, 'only the genuinely new slot builds a primitive');
  assert.equal(scenePrimitives.size, 3, 'pruned slot must leave the scene');
  assert.ok(!scenePrimitives.has(built[0]), 'oldest frame primitive removed');

  // A stale frame is a first-class feed state — never silently current,
  // never disguised as a transport error.
  served = { ...served, stale: true, echoPixels: 99 };
  assert.equal(await layer.update(viewer), true);
  assert.equal(layer.getStats().stale, true);
  assert.equal(layer.getStats().error, null);
  assert.equal(layer.getStats().count, 99);

  // Transport failure keeps the layer honest too.
  const failing = createShmuRadarLayer({
    fetchImpl: async () => ({ ok: false, status: 503 }),
    primitiveFactory: stubFactory,
  });
  failing.init(viewer);
  assert.equal(await failing.update(viewer), false);
  assert.match(failing.getStats().error, /503/);

  layer.disable(viewer);
  assert.ok(built.every((p) => p.show === false), 'disable hides the visible frame');
  layer.destroy(viewer);
  assert.equal(scenePrimitives.size, 0, 'destroy removes every frame primitive');
  assert.equal(layer.getStats().count, 0);
  } finally {
    layer.disable(viewer);
    layer.destroy(viewer);
  }
});
