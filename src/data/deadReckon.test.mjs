// src/data/deadReckon.test.mjs — odhad polohy lodí z oceánu (2026-10-11).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEAD_RECKON_MAX_KM, deadReckonVessel } from './aisLiveVessels.js';

const NOW = Date.parse('2026-10-11T12:00:00Z');
const base = { feed: 'ocean', fixLat: 10, fixLon: 70, lat: 10, lon: 70, speed: 12, course: 90, lastPositionEpoch: NOW / 1000 - 1800 };

test('loď z oceánu: po 30 min pri 12 kn ~11 km na východ; označené ako odhad', () => {
  const est = deadReckonVessel(base, NOW);
  assert.ok(est, 'odhad existuje');
  assert.equal(est.ageMin, 30);
  assert.ok(Math.abs(est.km - 11.1) < 0.2, String(est.km));
  assert.ok(Math.abs(est.lat - 10) < 0.01 && est.lon > 70.09 && est.lon < 70.12, `${est.lat},${est.lon}`);
});

test('bez odhadu: pobrežný zdroj, čerstvá poloha, stojí, stará nad 3 h, bez kurzu; strop 120 km', () => {
  assert.equal(deadReckonVessel({ ...base, feed: 'aisstream' }, NOW), null);
  assert.equal(deadReckonVessel({ ...base, lastPositionEpoch: NOW / 1000 - 60 }, NOW), null, 'čerstvá');
  assert.equal(deadReckonVessel({ ...base, speed: 0.4 }, NOW), null, 'stojí');
  assert.equal(deadReckonVessel({ ...base, lastPositionEpoch: NOW / 1000 - 4 * 3600 }, NOW), null, 'stará');
  assert.equal(deadReckonVessel({ ...base, course: null }, NOW), null, 'bez kurzu');
  assert.equal(deadReckonVessel({ ...base, speed: 40, lastPositionEpoch: NOW / 1000 - 2.5 * 3600 }, NOW).km, DEAD_RECKON_MAX_KM);
});
