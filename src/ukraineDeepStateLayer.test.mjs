// src/ukraineDeepStateLayer.test.mjs — DeepState vrstva: pozície kruhu, inertná bez viewera.
import test from 'node:test';
import assert from 'node:assert/strict';

import { DEEPSTATE_STYLES, buildPolyIndex, createUkraineDeepStateLayer, ringPositions, sideFromPolygons } from './ukraineDeepStateLayer.js';

test('ringPositions prevedie [lon,lat] na Cartesian3 (bez výšky = primknuté)', () => {
  const pos = ringPositions([[37.8, 48.99], [37.9, 49.0]]);
  assert.equal(pos.length, 2);
  assert.ok(Number.isFinite(pos[0].x) && Number.isFinite(pos[0].y) && Number.isFinite(pos[0].z));
});

test('bez viewera je vrstva inertná', async () => {
  const inert = createUkraineDeepStateLayer({ viewer: null });
  assert.equal(inert.isShown(), false);
  assert.equal(await inert.show(), false);
  inert.setSnapshot({ features: [] });
  assert.equal(inert.getState().features, 0);
  assert.equal(inert.getState().stampText, '');
});

test('K3: index polygónov a strana bodu — okupované = ru, sivá zóna = contested, inak null; body mimo bboxu rýchlo von', () => {
  const sq = (lon, lat, d) => [[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]];
  const features = [
    { type: 'Polygon', kind: 'occupied', rings: [sq(38, 48, 1)] },
    { type: 'Polygon', kind: 'grey', rings: [sq(37.5, 48.5, 0.6)] },
    { type: 'Polygon', kind: 'liberated', rings: [sq(36, 48, 1)] },
    { type: 'Point', kind: 'attack', lat: 48.5, lon: 37.9 },
    { type: 'Polygon', kind: 'occupied', rings: [[[0, 0], [1, 1]]] },
  ];
  const index = buildPolyIndex(features);
  assert.equal(index.length, 3, 'body a degenerované prstence sa vynechajú');
  assert.deepEqual(index[0].bbox, [38, 48, 39, 49]);
  assert.equal(sideFromPolygons(index, 38.5, 48.5), 'ru');
  assert.equal(sideFromPolygons(index, 37.7, 48.7), 'contested');
  assert.equal(sideFromPolygons(index, 38.05, 48.6), 'ru', 'prekryv sivej a okupovanej = ru');
  assert.equal(sideFromPolygons(index, 36.5, 48.5), null, 'oslobodené nehovorí o strane (bez fallbacku)');
  assert.equal(sideFromPolygons(index, 30, 50), null);
  assert.equal(sideFromPolygons(index, 30, 50, { fallback: 'ua' }), 'ua', 'mimo polygónov = fallback (vrstva dá ua pri načítanej snímke)');
  assert.equal(sideFromPolygons(index, 38.5, 48.5, { fallback: 'ua' }), 'ru');
  assert.equal(sideFromPolygons(index, NaN, 50), null);
  assert.deepEqual(Object.keys(DEEPSTATE_STYLES), ['default', 'karta']);
  assert.ok(DEEPSTATE_STYLES.karta.width < DEEPSTATE_STYLES.default.width && DEEPSTATE_STYLES.karta.hatch === true);
  const inert = createUkraineDeepStateLayer({ viewer: null });
  assert.equal(inert.sideAt(38.5, 48.5), null);
  assert.equal(inert.getStyle(), 'default');
});

test('sivá zóna DeepState je šrafovaná v každom štýle — inak po skrytí rastra Wikipédie nezostane šrafované nič', () => {
  // Používateľ 2026-09-23: „to šrafované mi zmizlo". Kým DeepState kreslí, žltá
  // zóna bojov z Wikipédie sa skryje; plná sivá zóna ju nenahradila.
  for (const [name, style] of Object.entries(DEEPSTATE_STYLES)) {
    assert.equal(style.hatch, true, `štýl ${name} šrafuje sivú zónu`);
  }
});
