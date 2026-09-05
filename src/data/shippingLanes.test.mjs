import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  SHIPPING_LANES_LAYER_ID,
  createShippingLanesLayer,
  parseShippingLanesGeojsonl,
  shippingLanesLabel,
  shippingLanesStyle,
} from './shippingLanes.js';
import { REGISTERED_LAYER_IDS } from './layerState.js';

test('shipping lanes styling: Major is widest and brightest, Minor is finest', () => {
  const major = shippingLanesStyle({ kind: 'major' });
  const middle = shippingLanesStyle({ kind: 'middle' });
  const minor = shippingLanesStyle({ kind: 'minor' });

  assert.ok(major.width > middle.width, 'Major route must render wider than Middle route');
  assert.ok(middle.width > minor.width, 'Middle route must render wider than Minor route');
  assert.ok(major.color.alpha >= middle.color.alpha, 'Major route must have high opacity');
  assert.ok(middle.color.alpha >= minor.color.alpha, 'Middle route must have higher opacity than minor');
});

test('card labels double as legend: category translated via i18n', () => {
  // In Node runtime language defaults to EN
  assert.equal(shippingLanesLabel({ name: 'Hormuz Route' }), 'Hormuz Route');
  assert.equal(shippingLanesLabel({ kind: 'major' }), 'Major Shipping Route');
  assert.equal(shippingLanesLabel({ kind: 'middle' }), 'Secondary Shipping Route');
  assert.equal(shippingLanesLabel({ kind: 'minor' }), 'Minor Shipping Route');
});

test('geojsonl parser drops malformed lines and non-lines without failing', () => {
  const good = JSON.stringify({
    type: 'Feature', id: 'lane-1', properties: { kind: 'major' },
    geometry: { type: 'LineString', coordinates: [[55.0, 25.0], [56.0, 26.0]] },
  });
  const point = JSON.stringify({
    type: 'Feature', id: 'p', properties: {}, geometry: { type: 'Point', coordinates: [55, 25] },
  });
  const short = JSON.stringify({
    type: 'Feature', id: 's', properties: {}, geometry: { type: 'LineString', coordinates: [[55, 25]] },
  });
  const parsed = parseShippingLanesGeojsonl([good, '{malformed', point, short, '', good].join('\n'));
  assert.equal(parsed.length, 2, 'only valid LineStrings with >= 2 points survive');
});

test('bundled snapshot parses whole: all 3 kinds present across global coordinates', () => {
  const text = readFileSync(new URL('./local_data/shipping_lanes/shipping-lanes.geojsonl', import.meta.url), 'utf8');
  const features = parseShippingLanesGeojsonl(text);
  assert.ok(features.length >= 200 && features.length <= 300, `unexpected count ${features.length}`);

  const kinds = new Set(features.map((f) => f.properties?.kind));
  assert.ok(kinds.has('major'));
  assert.ok(kinds.has('middle'));
  assert.ok(kinds.has('minor'));

  // Verify presence of Persian Gulf coordinates (Hormuz: lat ~25..27, lon ~54..57)
  const hormuz = features.filter((f) =>
    f.geometry.coordinates.some(([lon, lat]) => lat >= 23 && lat <= 30 && lon >= 50 && lon <= 60),
  );
  assert.ok(hormuz.length > 0, 'Shipping lanes must cover the Persian Gulf and Hormuz');
});

test('layer contract: registry id, lazy single load, clamped polylines, honest stats', async () => {
  assert.ok(REGISTERED_LAYER_IDS.includes(SHIPPING_LANES_LAYER_ID), 'layer must be in the share-link registry');
  if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;

  const mockData = [
    JSON.stringify({
      type: 'Feature', id: 'lane-major-0', properties: { kind: 'major' },
      geometry: { type: 'LineString', coordinates: [[55.0, 25.0], [56.0, 26.0]] },
    }),
    JSON.stringify({
      type: 'Feature', id: 'lane-middle-0', properties: { kind: 'middle' },
      geometry: { type: 'LineString', coordinates: [[56.0, 26.0], [57.0, 27.0]] },
    }),
  ].join('\n');

  let fetchCount = 0;
  const fakeFetch = async () => {
    fetchCount += 1;
    return { ok: true, status: 200, text: async () => mockData };
  };

  const layer = createShippingLanesLayer({ url: 'mock://lanes.geojsonl', fetchImpl: fakeFetch });
  assert.equal(layer.id, SHIPPING_LANES_LAYER_ID);

  const added = [];
  const fakeViewer = {
    dataSources: {
      add(ds) { added.push(ds); return Promise.resolve(ds); },
      remove(ds) {
        const idx = added.indexOf(ds);
        if (idx >= 0) added.splice(idx, 1);
      },
    },
  };

  layer.init(fakeViewer);
  assert.equal(added.length, 1);
  assert.equal(added[0].show, false);
  assert.equal(layer.isLoaded(), false);

  await layer.enable();
  assert.equal(added[0].show, true);
  assert.equal(layer.isLoaded(), true);
  assert.equal(fetchCount, 1);

  // Verify entities
  const major = added[0].entities.getById(`${SHIPPING_LANES_LAYER_ID}:lane-major-0`);
  assert.ok(major);
  assert.equal(major.polyline.clampToGround.getValue(), true);

  // Repeated enable must not re-fetch
  await layer.enable();
  assert.equal(fetchCount, 1);

  layer.disable();
  assert.equal(added[0].show, false);

  layer.destroy(fakeViewer);
  assert.equal(added.length, 0);
  assert.equal(layer.isLoaded(), false);
});
