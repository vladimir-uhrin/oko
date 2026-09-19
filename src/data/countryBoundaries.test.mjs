import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createCountryBoundaries, parseBoundariesGeojsonl } from './countryBoundaries.js';

test('parseBoundariesGeojsonl keeps LineStrings, drops malformed / non-lines / too-short', () => {
  const good = JSON.stringify({ type: 'Feature', id: 1, geometry: { type: 'LineString', coordinates: [[55, 25], [56, 26]] }, properties: {} });
  const shortLine = JSON.stringify({ type: 'Feature', id: 2, geometry: { type: 'LineString', coordinates: [[55, 25]] } });
  const point = JSON.stringify({ type: 'Feature', id: 3, geometry: { type: 'Point', coordinates: [55, 25] } });
  const feats = parseBoundariesGeojsonl([good, shortLine, point, 'not json', ''].join('\n'));
  assert.equal(feats.length, 1);
  assert.equal(feats[0].geometry.coordinates.length, 2);
});

test('overlay: lazy-loads once on show, hides without reload, safe without a viewer', async () => {
  const added = [];
  const viewer = { dataSources: { add: (ds) => added.push(ds), remove: () => true }, scene: { requestRender() {} } };
  let fetchCalls = 0;
  const geojsonl = [
    JSON.stringify({ type: 'Feature', id: 1, geometry: { type: 'LineString', coordinates: [[55, 25], [56, 26], [57, 27]] } }),
    JSON.stringify({ type: 'Feature', id: 2, geometry: { type: 'LineString', coordinates: [[10, 10], [11, 11]] } }),
  ].join('\n');
  const fetch = async () => { fetchCalls += 1; return { ok: true, text: async () => geojsonl }; };

  const layer = createCountryBoundaries({ viewer, fetch });
  assert.equal(await layer.show(), 2, 'loads and draws both border lines');
  assert.equal(layer.count, 2);
  assert.equal(fetchCalls, 1);
  assert.equal(added.length, 1, 'one CustomDataSource added to the viewer');
  assert.equal(added[0].show, true);

  layer.hide();
  assert.equal(added[0].show, false);
  await layer.show(); // already loaded → no second fetch
  assert.equal(fetchCalls, 1);

  const noop = createCountryBoundaries({});
  assert.equal(await noop.show(), 0, 'no viewer → safe no-op');
});

test('držitelia (2026-09-19): scéna aj vrstva potrubí; hranice ostanú, kým ich drží aspoň jeden', async () => {
  const added = [];
  const viewer = { dataSources: { add: (ds) => added.push(ds), remove: () => true }, scene: { requestRender() {} } };
  const geojsonl = JSON.stringify({ type: 'Feature', id: 1, geometry: { type: 'LineString', coordinates: [[17, 48], [18, 48.5]] } });
  const fetch = async () => ({ ok: true, text: async () => geojsonl });
  const layer = createCountryBoundaries({ viewer, fetch });
  assert.equal(await layer.retain('gas-pipelines'), 1, 'vrstva potrubí si vyžiada hranice');
  assert.equal(added[0].show, true);
  assert.deepEqual(layer.holders, ['gas-pipelines']);
  await layer.show(); // scéna úžiny
  assert.deepEqual(layer.holders, ['gas-pipelines', 'scene']);
  layer.hide(); // scéna skončila — potrubia hranice stále držia
  assert.equal(added[0].show, true, 'uvoľnenie scény nezoberie hranice vrstve potrubí');
  layer.release('gas-pipelines');
  assert.equal(added[0].show, false, 'posledný držiteľ preč = hranice preč');
  assert.deepEqual(layer.holders, []);
  layer.release('gas-pipelines');
  assert.equal(added[0].show, false, 'opakované uvoľnenie je neškodné');
  const noop = createCountryBoundaries({});
  assert.equal(await noop.retain('x'), 0);
  assert.deepEqual(noop.holders, []);
});

test('the bundled boundaries dataset exists and parses to real border lines', () => {
  const text = readFileSync(new URL('./local_data/boundaries/boundaries.geojsonl', import.meta.url), 'utf8');
  const feats = parseBoundariesGeojsonl(text);
  assert.ok(feats.length > 100, 'bundled world borders present');
  assert.ok(feats.every((f) => f.geometry.coordinates.every(([lon, lat]) => Math.abs(lon) <= 180 && Math.abs(lat) <= 90)));
});
