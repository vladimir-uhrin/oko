// src/data/firmsCluster.test.mjs — zhluky ohnísk a plameň (2026-10-07).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterBadge, clusterFires, flamePath } from './firmsCluster.js';

const f = (lat, lon, frp, extra = {}) => ({ lat, lon, frp, acqMs: 1000, geoSeenMs: 0, night: false, ...extra });

test('zhluky: bunka mriežky = jedna značka v mieste najsilnejšieho ohniska; počet, max a súčet FRP, najnovší čas, noc', () => {
  const fires = [f(47.588, 36.974, 253), f(47.596, 36.961, 33, { acqMs: 5000 }), f(47.579, 36.983, 17, { night: true, geoSeenMs: 9000 }), f(48.9, 37.6, 115), f(NaN, 1, 99)];
  const c = clusterFires(fires, 0.25);
  assert.equal(c.length, 2);
  assert.deepEqual({ lat: c[0].lat, lon: c[0].lon, count: c[0].count, maxFrp: c[0].maxFrp, sumFrp: c[0].sumFrp, newestMs: c[0].newestMs, night: c[0].night }, { lat: 47.588, lon: 36.974, count: 3, maxFrp: 253, sumFrp: 303, newestMs: 9000, night: 1 });
  assert.equal(c[0].strongest, fires[0], 'klik na zhluk = najsilnejšie ohnisko');
  assert.equal(c[1].count, 1);
});

test('zhluky: strop počtu značiek drží najsilnejšie bunky; ostatné ohniská už nezakladajú nové', () => {
  const fires = [f(10, 10, 50), f(20, 20, 40), f(10.01, 10.01, 30), f(30, 30, 20)];
  const c = clusterFires(fires, 0.25, 2);
  assert.deepEqual(c.map((x) => [x.maxFrp, x.count]), [[50, 2], [40, 1]]);
});

test('odznak a tvar plameňa', () => {
  assert.equal(clusterBadge(1), ''); assert.equal(clusterBadge(27), '27'); assert.equal(clusterBadge(250), '99+');
  const p = flamePath(100);
  assert.equal(p[0][0], 'M'); assert.deepEqual(p[0].slice(1), [50, 4], 'špička hore v strede');
  for (const [op, ...xy] of p) { assert.ok(op === 'M' || op === 'Q'); for (const v of xy) assert.ok(v >= 0 && v <= 100); }
});
