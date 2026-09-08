// src/data/meteoPlaces.test.mjs
// Popisky miest nad meteorologickým polom (2026-09-08): vzorkovanie mriežky, texty, viditeľnosť.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPlaceLabels, normalizePlaces, placeValueText, placeVisibleUntilM, sampleGrid, updatePlaceLabelTexts } from './meteoPlaces.js';

test('sampleGrid: bilineárne z mriežky sever hore, −180 vľavo; mimo = NaN', () => {
  // 3 × 3: riadok 0 = 90° N, stĺpec 0 = −180°
  const grid = { cols: 3, rows: 3, values: new Float32Array([0, 10, 20, 30, 40, 50, 60, 70, 80]) };
  assert.equal(sampleGrid(grid, 90, -180), 0);
  assert.equal(sampleGrid(grid, -90, 180), 80);
  assert.equal(sampleGrid(grid, 0, 0), 40, 'stred');
  assert.equal(sampleGrid(grid, 45, -90), 20, 'medzi 0,10,30,40 → (0+10+30+40)/4');
  assert.ok(Number.isNaN(sampleGrid(null, 0, 0)));
});

test('placeValueText: teplota °, tlak hPa, zrážky mm len keď prší, oblačnosť %, vietor m/s', () => {
  assert.equal(placeValueText(21.4, 'temp'), '21°');
  assert.equal(placeValueText(1013.2, 'pressure'), '1013');
  assert.equal(placeValueText(0.04, 'precip'), '');
  assert.equal(placeValueText(0.6, 'precip'), '0.6 mm');
  assert.equal(placeValueText(4.2, 'precip'), '4 mm');
  assert.equal(placeValueText(87, 'clouds'), '87 %');
  assert.equal(placeValueText(7.6, 'wind'), '8 m/s');
  assert.equal(placeValueText(NaN, 'temp'), '');
});

test('viditeľnosť podľa populácie a bundle miest (verejná doména, ≥ 100 k alebo hlavné mesto)', () => {
  assert.equal(placeVisibleUntilM(9000), Number.POSITIVE_INFINITY);
  assert.equal(placeVisibleUntilM(6000), 9_000_000);
  assert.equal(placeVisibleUntilM(424, true), 9_000_000, 'hlavné mesto ako 3 M+');
  assert.equal(placeVisibleUntilM(1200), 3_500_000);
  assert.equal(placeVisibleUntilM(424, false), 1_500_000);
  assert.equal(placeVisibleUntilM(120), 600_000);
  const json = JSON.parse(readFileSync(new URL('./local_data/natural_earth/places.json', import.meta.url), 'utf8'));
  assert.match(json.meta.license, /public domain/);
  const places = normalizePlaces(json);
  assert.ok(places.length >= 1000 && places.length <= 1400);
  const ba = json.places.find((r) => r[0] === 'Bratislava');
  assert.deepEqual(ba, ['Bratislava', 48.15, 17.117, 424, 4, 'SK', 1]);
  assert.equal(places[0].name, 'Tokyo', 'zoradené podľa populácie');
});

test('LabelCollection: text = meno + hodnota, prázdna hodnota = len meno; aktualizácia textov bez prestavby', () => {
  const places = normalizePlaces({ places: [['Praha', 50.08, 14.42, 1300, 2, 'CZ', 1], ['Nitra', 48.31, 18.09, 77, 8, 'SK', 0]] });
  // Cesium LabelCollection meria text cez canvas (document) — v Node ide dvojník s rovnakým API.
  const fakeCollection = () => { const items = []; return { add(o) { items.push({ ...o }); return items.at(-1); }, get: (i) => items[i], get length() { return items.length; } }; };
  const labels = createPlaceLabels(places, { valueText: (p) => (p.name === 'Praha' ? '21°' : ''), collectionFactory: fakeCollection });
  assert.equal(labels.length, 2);
  assert.equal(labels.get(0).text, 'Praha  21°');
  assert.equal(labels.get(1).text, 'Nitra');
  updatePlaceLabelTexts(labels, places, () => '1013');
  assert.equal(labels.get(1).text, 'Nitra  1013');
});
