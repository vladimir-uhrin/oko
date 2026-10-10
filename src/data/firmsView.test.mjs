// src/data/firmsView.test.mjs — menšia odpoveď /api/firms (bod 7, 2026-10-10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIRE_CELL_DEG, buildFireCells, firesInBbox, parseFireBbox } from './firmsView.js';
import { adaptFirmsRecords } from './firmsAdapt.js';
import { clusterFires } from './firmsCluster.js';

const row = (lat, lon, frp, extra = {}) => ({ lat, lon, frp, confidence: 'n', brightness: 300, daynight: 'D', acqDate: '2026-10-10', acqTime: '1200', satellite: 'N', ...extra });

test('zhrnutie: štvorec = najsilnejšie ohnisko + počet, nočné, najnovší čas, súčet FRP; zoradené podľa FRP', () => {
  const cells = buildFireCells([
    row(47.59, 36.97, 253), row(47.58, 36.98, 33, { daynight: 'N', acqTime: '1500' }), row(47.6, 36.96, 17),
    row(48.9, 37.6, 115), row(NaN, 1, 5),
  ]);
  assert.equal(FIRE_CELL_DEG, 0.25);
  assert.equal(cells.length, 2);
  assert.deepEqual({ frp: cells[0].frp, n: cells[0].n, nn: cells[0].nn, nw: cells[0].nw, sf: cells[0].sf }, { frp: 253, n: 3, nn: 1, nw: Date.UTC(2026, 9, 10, 15, 0), sf: 303 });
  assert.equal(cells[1].frp, 115);
});

test('zhrnutie → klient: váhy prejdú do zhlukov (počet ohnísk, nie počet štvorcov)', () => {
  const cells = buildFireCells([row(47.59, 36.97, 253), row(47.58, 36.98, 33), row(47.6, 36.96, 17), row(47.7, 36.7, 9)]);
  const fires = adaptFirmsRecords(cells).sort((a, b) => b.frp - a.frp);
  assert.equal(fires[0].clusterCount, 3);
  const [c] = clusterFires(fires, 0.5);
  assert.equal(c.count, 4, '3 + 1 ohnisko v jednom zhluku 0,5°');
  assert.equal(c.sumFrp, 312);
});

test('výrez: formát, rozsah, strop plochy, cez 180° poludník; najsilnejšie prvé so stropom', () => {
  assert.deepEqual(parseFireBbox('36,47,38,48.5'), { w: 36, s: 47, e: 38, n: 48.5, wraps: false });
  assert.equal(parseFireBbox('1,2,3'), null);
  assert.equal(parseFireBbox('0,0,10,10'), null, '100 °² je priveľa');
  assert.equal(parseFireBbox('0,10,1,5'), null);
  const wrap = parseFireBbox('179,0,-179,2');
  assert.equal(wrap.wraps, true);
  const fires = [row(1, 179.5, 5), row(1, -179.5, 9), row(1, 0, 99)];
  assert.deepEqual(firesInBbox(fires, wrap).map((f) => f.frp), [9, 5]);
  assert.deepEqual(firesInBbox([row(47.5, 37, 1), row(47.6, 37.1, 50), row(47.7, 37.2, 20)], parseFireBbox('36,47,38,48'), 2).map((f) => f.frp), [50, 20]);
});
