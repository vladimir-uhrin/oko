// src/data/ukraineDamage.test.mjs — škody na budovách: ťažiská, položky ADM3 a UNOSAT,
// súhrn, polomer/farba, viditeľnosť podľa kurzora.
import test from 'node:test';
import assert from 'node:assert/strict';

import { adm3Item, damageColor, damageRadiusPx, damageSummary, featureCentroid, ringCentroid, unosatItem, unosatVisibleAt } from './ukraineDamage.js';

test('ťažiská', () => {
  const sq = [[37, 48], [38, 48], [38, 49], [37, 49], [37, 48]];
  assert.deepEqual(ringCentroid(sq).map((v) => Math.round(v * 1000) / 1000), [37.5, 48.5]);
  assert.deepEqual(ringCentroid(sq.slice().reverse()).map((v) => Math.round(v * 1000) / 1000), [37.5, 48.5], 'orientácia nevadí');
  assert.equal(ringCentroid([[1, 1]]), null);
  const multi = { type: 'MultiPolygon', coordinates: [[[[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0, 0]]], [sq]] };
  assert.deepEqual(featureCentroid(multi).map((v) => Math.round(v * 1000) / 1000), [37.5, 48.5], 'najväčšia časť');
  assert.deepEqual(featureCentroid({ type: 'Point', coordinates: [1, 2] }), [1, 2]);
  assert.equal(featureCentroid({ type: 'LineString', coordinates: [] }), null);
});

test('položky, súhrn, polomer, farba, kurzor', () => {
  const adm = adm3Item({ properties: { adm3_id: '3_540', ADM3_EN: 'Lymanska', n_buildings_damaged: 5232, n_buildings: 30428, perc_destroyed: 17.194689 }, geometry: { type: 'Polygon', coordinates: [[[37.7, 48.9], [37.9, 48.9], [37.9, 49.1], [37.7, 49.1], [37.7, 48.9]]] } });
  assert.deepEqual(adm, { id: '3_540', name: 'Lymanska', lat: 49, lon: 37.8, damaged: 5232, buildings: 30428, pct: 17.2 });
  assert.equal(adm3Item({ properties: { n_buildings_damaged: 0 }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }), null, 'bez škôd nič');
  const u = unosatItem({ properties: { unosat_id: 1, date: '2022-03-16T00:00:00Z', damage: 2, city: 'Makariv' }, geometry: { type: 'Point', coordinates: [29.78954830612985, 50.44496620240628] } });
  assert.deepEqual(u, { lat: 50.445, lon: 29.7895, t: Date.UTC(2022, 2, 16), cls: 'severe', city: 'Makariv' });
  assert.equal(unosatItem({ properties: { date: '2022-03-16', damage: 6 }, geometry: { type: 'Point', coordinates: [1, 1] } }), null, 'bez viditeľných škôd sa nekreslí');
  assert.equal(unosatItem({ properties: { damage: 1 }, geometry: { type: 'Point', coordinates: [1, 1] } }), null, 'bez dátumu nič');
  const s = damageSummary([adm], [u, { ...u, cls: 'destroyed', city: null }]);
  assert.equal(s.damaged, 5232);
  assert.deepEqual(s.byClass, { severe: 1, destroyed: 1 });
  assert.deepEqual(s.cities, { Makariv: 1 });
  assert.equal(damageRadiusPx(0), 0);
  assert.equal(damageRadiusPx(25), 4);
  assert.equal(damageRadiusPx(13071), 22);
  assert.ok(damageRadiusPx(400) > 4 && damageRadiusPx(400) < 22);
  assert.equal(damageColor(1), '#ffe08a');
  assert.equal(damageColor(5), '#ff8a3d');
  assert.equal(damageColor(42.6), '#f87171');
  assert.equal(damageColor(NaN), '#ffb547');
  assert.equal(unosatVisibleAt([u, { ...u, t: Date.UTC(2023, 0, 1) }], Date.UTC(2022, 5, 1)).length, 1);
  assert.equal(unosatVisibleAt([u], NaN).length, 1);
});
