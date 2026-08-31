import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  SK_ENERGY_LAYER_ID,
  createSkEnergyLayer,
  parseSkEnergyGeojsonl,
  skEnergyLabel,
  skEnergyStyle,
} from './skEnergy.js';
import { REGISTERED_LAYER_IDS } from './layerState.js';

test('legend encoding: 400 kV widest, 220 kV lighter, gas amber and distinct', () => {
  const p400 = skEnergyStyle({ kind: 'power', voltage: '400000' });
  const p400multi = skEnergyStyle({ kind: 'power', voltage: '400000;220000' });
  const p220 = skEnergyStyle({ kind: 'power', voltage: '220000' });
  const gas = skEnergyStyle({ kind: 'gas' });
  assert.ok(p400.width > p220.width, '400 kV must render wider than 220 kV');
  assert.equal(p400multi.width, p400.width, 'mixed-voltage corridors count as 400 kV');
  assert.ok(p400.color.alpha > p220.color.alpha, '400 kV must be the more solid line');
  assert.ok(gas.color.red > gas.color.blue, 'gas must be warm (amber), not the power cyan');
  assert.ok(p400.color.blue > p400.color.red, 'power must be cool (cyan), not the gas amber');
});

test('card labels double as the legend: kind and voltage are spelled out', () => {
  assert.equal(skEnergyLabel({ name: 'V499' }), 'V499');
  assert.equal(skEnergyLabel({ kind: 'gas' }), 'Plynovod (tranzit)');
  assert.equal(skEnergyLabel({ kind: 'power', voltage: '400000' }), 'Vedenie 400 kV');
  assert.equal(skEnergyLabel({ kind: 'power', voltage: '220000' }), 'Vedenie 220 kV');
});

test('geojsonl parser drops malformed lines and non-lines without failing', () => {
  const good = JSON.stringify({
    type: 'Feature', id: 'osm-way-1', properties: { kind: 'power', voltage: '400000' },
    geometry: { type: 'LineString', coordinates: [[17.1, 48.1], [17.2, 48.2]] },
  });
  const point = JSON.stringify({
    type: 'Feature', id: 'p', properties: {}, geometry: { type: 'Point', coordinates: [17, 48] },
  });
  const short = JSON.stringify({
    type: 'Feature', id: 's', properties: {}, geometry: { type: 'LineString', coordinates: [[17, 48]] },
  });
  const parsed = parseSkEnergyGeojsonl([good, '{broken', point, short, '', good].join('\n'));
  assert.equal(parsed.length, 2, 'only valid LineStrings with ≥2 points survive');
});

test('bundled snapshot parses whole: both kinds, clipped to the SK build bbox', () => {
  const text = readFileSync(new URL('./local_data/sk_energy/sk-energy.geojsonl', import.meta.url), 'utf8');
  const features = parseSkEnergyGeojsonl(text);
  // Exact counts drift with OSM edits and rebuilds; the pin is the SHAPE:
  // a few hundred lines, both kinds present, nothing outside the build bbox
  // (scripts/build-sk-energy.mjs clips there — a violation means the clip
  // regressed and neighbour-country geometry leaked into the bundle).
  assert.ok(features.length > 400 && features.length < 2000, `implausible feature count ${features.length}`);
  const kinds = new Set(features.map((f) => f.properties?.kind));
  assert.deepEqual([...kinds].sort(), ['gas', 'power']);
  for (const feature of features) {
    for (const [lon, lat] of feature.geometry.coordinates) {
      assert.ok(
        lon >= 16.79 && lon <= 22.61 && lat >= 47.69 && lat <= 49.66,
        `coordinate outside build bbox: ${lon},${lat}`,
      );
    }
  }
});

test('layer contract: registry id, lazy single load, clamped polylines, honest stats', async () => {
  assert.ok(REGISTERED_LAYER_IDS.includes(SK_ENERGY_LAYER_ID), 'layer must be in the share-link registry');
  // The context store hangs off `window`; give the contract test one so the
  // click-card registration path runs instead of being skipped.
  if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;

  const text = [
    JSON.stringify({
      type: 'Feature', id: 'osm-way-10', properties: { kind: 'power', voltage: '400000', name: 'V499' },
      geometry: { type: 'LineString', coordinates: [[17.1, 48.1], [17.3, 48.2]] },
    }),
    JSON.stringify({
      type: 'Feature', id: 'osm-way-11', properties: { kind: 'gas', substance: 'gas', operator: 'eustream' },
      geometry: { type: 'LineString', coordinates: [[17.5, 48.0], [17.9, 48.05]] },
    }),
  ].join('\n');

  let fetches = 0;
  const layer = createSkEnergyLayer({
    url: 'test://sk-energy',
    fetchImpl: async () => { fetches++; return { ok: true, text: async () => text }; },
  });
  assert.equal(layer.id, 'local-energy');
  assert.match(layer.source, /OpenStreetMap/);
  assert.match(layer.source, /snapshot/i, 'the panel label must admit this is a snapshot, not live data');

  const added = [];
  const viewer = { dataSources: { add: (ds) => added.push(ds), remove: () => true } };
  layer.init(viewer);
  assert.equal(added[0].show, false);
  layer.enable();
  assert.equal(added[0].show, true);

  assert.equal(await layer.update(), true);
  assert.equal(await layer.update(), true);
  assert.equal(fetches, 1, 'static bundle must load exactly once');
  assert.equal(layer.getStats().count, 2);
  assert.equal(layer.getStats().error, null);

  const now = Cesium.JulianDate.now();
  const power = added[0].entities.getById('local-energy:osm-way-10');
  assert.ok(power, 'power entity missing');
  assert.equal(power.polyline.clampToGround.getValue(now), true);
  // Klikateľnosť: každá línia je registrovaná v context store.
  assert.equal(power.__gevContextId, 'local-energy:osm-way-10');
  const gas = added[0].entities.getById('local-energy:osm-way-11');
  assert.ok(gas.polyline.width.getValue(now) !== power.polyline.width.getValue(now));

  const failing = createSkEnergyLayer({
    url: 'test://sk-energy',
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  failing.init({ dataSources: { add: () => {}, remove: () => true } });
  assert.equal(await failing.update(), false);
  assert.match(failing.getStats().error, /404/);

  layer.disable();
  assert.equal(added[0].show, false);
  layer.destroy(viewer);
  assert.equal(layer.getStats().count, 0);
});
