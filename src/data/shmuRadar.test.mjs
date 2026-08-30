import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as Cesium from 'cesium';
import {
  ZMAX_DBZ_PALETTE,
  ZMAX_MIN_DISPLAY_DBZ,
  dbzColor,
  mercatorRowLut,
  normalizeOdimComposite,
  odimTimestampIso,
  rasterizeZmax,
} from './shmuRadarGrid.js';
import { SHMU_RADAR_DRAPE_HEIGHT_M, createShmuRadarLayer } from './shmuRadar.js';

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
  const { rgba, echoPixels } = rasterizeZmax(raw, meta);
  assert.equal(rgba.length, meta.width * meta.height * 4);
  assert.ok(echoPixels > 0, 'fixture day had real precipitation echoes');
  // Sentinel cells (undetect fill + out-of-domain corners) must be transparent:
  // echo pixels are a small minority of the 3.54M-cell grid.
  assert.ok(echoPixels < raw.length * 0.25, `echoPixels ${echoPixels} suspiciously high`);
  // Top-left corner of the composite is outside the radar domain (nodata).
  assert.equal(rgba[3], 0, 'nodata corner must stay transparent');
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
    png: '/api/shmu/radar/latest.png?v=2026-08-30T18%3A10%3A00Z',
  };
  let served = meta;
  const layer = createShmuRadarLayer({
    fetchImpl: async () => ({ ok: true, json: async () => served }),
  });

  assert.equal(layer.id, 'shmu-radar');
  assert.equal(layer.updateInterval, 5 * 60 * 1000);
  assert.match(layer.source, /SHMÚ/);

  const added = [];
  const viewer = { dataSources: { add: (ds) => added.push(ds), remove: () => true } };
  layer.init(viewer);
  assert.equal(added.length, 1);
  assert.equal(added[0].show, false);

  layer.enable(viewer);
  assert.equal(added[0].show, true);

  assert.equal(await layer.update(viewer), true);
  const entity = added[0].entities.getById('shmu-radar:overlay');
  assert.ok(entity, 'update must create the drape entity');
  const now = Cesium.JulianDate.now();
  const rect = entity.rectangle.coordinates.getValue(now);
  assert.ok(Math.abs(Cesium.Math.toDegrees(rect.west) - 13.6) < 1e-6);
  assert.ok(Math.abs(Cesium.Math.toDegrees(rect.north) - 50.7) < 1e-6);
  assert.equal(entity.rectangle.height.getValue(now), SHMU_RADAR_DRAPE_HEIGHT_M);
  assert.deepEqual(layer.getStats().error, null);
  assert.equal(layer.getStats().count, 1234);

  // A stale frame must surface in stats — never presented silently as current.
  served = { ...meta, iso: '2026-08-30T17:00:00Z', stale: true, echoPixels: 99 };
  assert.equal(await layer.update(viewer), true);
  assert.match(layer.getStats().error, /stale/);
  assert.equal(layer.getStats().count, 99);

  // Transport failure keeps the layer honest too.
  served = null;
  const failing = createShmuRadarLayer({ fetchImpl: async () => ({ ok: false, status: 503 }) });
  failing.init(viewer);
  assert.equal(await failing.update(viewer), false);
  assert.match(failing.getStats().error, /503/);

  layer.disable(viewer);
  assert.equal(added[0].show, false);
  layer.destroy(viewer);
  assert.equal(layer.getStats().count, 0);
});
