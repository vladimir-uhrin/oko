// src/ukraineDeepStateLayer.test.mjs — DeepState vrstva: pozície kruhu, inertná bez viewera.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createUkraineDeepStateLayer, ringPositions } from './ukraineDeepStateLayer.js';

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
