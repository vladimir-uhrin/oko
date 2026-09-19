// src/ukraineDamageLayer.test.mjs — vrstva škôd: inertná bez viewera, stav kurzora.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createUkraineDamageLayer } from './ukraineDamageLayer.js';

test('bez viewera je vrstva inertná', async () => {
  const inert = createUkraineDamageLayer({ viewer: null });
  assert.equal(inert.isShown(), false);
  assert.equal(await inert.show(), false);
  inert.setCursor(Date.UTC(2022, 5, 1));
  const s = inert.getState();
  assert.equal(s.adm3, 0);
  assert.equal(s.unosat, 0);
  assert.deepEqual(s.period, { from: '2022-02-24', to: '2024-02-29' });
});
