// src/layerCategories.test.mjs — rozdelenie vrstiev do ľudských tém.
import test from 'node:test';
import assert from 'node:assert/strict';

import { LAYER_CATEGORY, LAYER_GROUP_ORDER, LAYER_KEYWORDS, isCatalogLayer, layerGroup, layerKeywords } from './layerCategories.js';

test('layerGroup: známe id → jeho téma, neznáme → „more"', () => {
  assert.equal(layerGroup('flights'), 'air');
  assert.equal(layerGroup('ais-live-vessels'), 'sea');
  assert.equal(layerGroup('gas-pipelines'), 'energy');
  assert.equal(layerGroup('military'), 'defense');
  assert.equal(layerGroup('nieco-nove'), 'more');
  assert.equal(layerGroup(undefined), 'more');
});

test('LAYER_GROUP_ORDER pokrýva všetky použité témy a končí „more"', () => {
  for (const g of Object.values(LAYER_CATEGORY)) {
    assert.ok(LAYER_GROUP_ORDER.includes(g), `téma ${g} musí byť v poradí`);
  }
  assert.equal(LAYER_GROUP_ORDER[LAYER_GROUP_ORDER.length - 1], 'more', '„more" je posledná');
});

test('layerKeywords: prirodzené slová tam, kde názov nesedí; neznáme → []', () => {
  assert.ok(layerKeywords('flights').includes('lietadlá'), 'názov „Živé lety" ale ľudia píšu „lietadlá"');
  assert.ok(layerKeywords('ais-live-vessels').includes('lode'));
  assert.ok(layerKeywords('volcanoes').includes('sopka'));
  assert.deepEqual(layerKeywords('nieco-nove'), []);
  // každé synonymum patrí vrstve, ktorá je v katalógu (má tému)
  for (const id of Object.keys(LAYER_KEYWORDS)) {
    assert.ok(LAYER_CATEGORY[id], `synonymá pre ${id} musia patriť zaradenej vrstve`);
  }
});

test('isCatalogLayer: skryje obrazové prekryvy NASA a pomocné vrstvy', () => {
  assert.equal(isCatalogLayer({ id: 'flights', showInTogglePanel: true }), true);
  assert.equal(isCatalogLayer({ id: 'gibs-sst', showInTogglePanel: true }), false, 'gibs má vlastné ovládanie');
  assert.equal(isCatalogLayer({ id: 'military-awareness', showInTogglePanel: false }), false, 'skrytá');
  assert.equal(isCatalogLayer({ id: '' }), false);
  assert.equal(isCatalogLayer(null), false);
});
