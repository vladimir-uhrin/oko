// src/ukraineEventsLayer.test.mjs — čisté časti vrstvy udalostí: kandidáti a
// rozmiestnenie bez prekrytia, úrovne priblíženia, veľkosť bunky zhluku, glyfy;
// bez Cesium viewera vracia továreň inertný objekt.
import test from 'node:test';
import assert from 'node:assert/strict';

import { EVENT_TYPES } from './data/ukraineEvents.js';
import { LOD_CHIPS_ABOVE_M, LOD_CLUSTER_ABOVE_M, TYPE_GLYPH, clusterCellDeg, createUkraineEventsLayer, lodForHeight, placeBox, placementCandidates } from './ukraineEventsLayer.js';

test('kandidáti: 8 polôh okolo kotvy v poradí hore, vpravo, vľavo, dole, rohy', () => {
  const c = placementCandidates(100, 100, 40, 20, 10);
  assert.equal(c.length, 8);
  assert.deepEqual(c[0], { x: 80, y: 70 });
  assert.deepEqual(c[1], { x: 110, y: 90 });
  assert.deepEqual(c[2], { x: 50, y: 90 });
  assert.deepEqual(c[3], { x: 80, y: 110 });
});

test('placeBox: prvé voľné miesto v okne; pri kolízii ďalší kandidát; mimo okna sa posunie', () => {
  const viewport = { w: 400, h: 300 };
  const a = placeBox({ x: 200, y: 150 }, { w: 40, h: 20 }, [], viewport, 10);
  assert.deepEqual(a, { x: 180, y: 120, w: 40, h: 20, free: true }, 'hore');
  const b = placeBox({ x: 200, y: 150 }, { w: 40, h: 20 }, [a], viewport, 10);
  assert.deepEqual([b.x, b.y, b.free], [180, 160, true], 'hore obsadené, vpravo a vľavo sa dotýkajú v ochrannom páse → dole');
  const top = placeBox({ x: 200, y: 10 }, { w: 40, h: 20 }, [], viewport, 10);
  assert.equal(top.free, true);
  assert.ok(top.y >= 6, 'nad kotvou pri hornom okraji niet miesta → iný kandidát v okne');
  const crowded = [a, b, { x: 140, y: 140, w: 50, h: 20 }, { x: 180, y: 160, w: 40, h: 20 }, { x: 210, y: 120, w: 40, h: 20 }, { x: 150, y: 120, w: 40, h: 20 }, { x: 210, y: 160, w: 40, h: 20 }, { x: 150, y: 160, w: 40, h: 20 }];
  const c = placeBox({ x: 200, y: 150 }, { w: 40, h: 20 }, crowded, viewport, 10);
  assert.equal(c.free, false, 'všetko obsadené = núdzové miesto');
  assert.ok(c.x >= 6 && c.y >= 6 && c.x + c.w <= viewport.w - 6);
});

test('LOD, bunky zhlukov, glyfy pre všetky typy', () => {
  assert.equal(lodForHeight(LOD_CLUSTER_ABOVE_M + 1), 'cluster');
  assert.equal(lodForHeight(LOD_CLUSTER_ABOVE_M), 'chips');
  assert.equal(lodForHeight(LOD_CHIPS_ABOVE_M), 'cards');
  assert.equal(lodForHeight(NaN), 'cluster');
  assert.equal(clusterCellDeg(4_000_000), 1.0);
  assert.equal(clusterCellDeg(2_000_000), 0.5);
  assert.equal(clusterCellDeg(800_000), 0.25);
  for (const type of EVENT_TYPES) assert.ok(TYPE_GLYPH[type], `glyf pre ${type}`);
  assert.ok(!/\p{Emoji_Presentation}/u.test(Object.values(TYPE_GLYPH).join('').replace(/︎/g, '')), 'glyfy sú monochromatické znaky, nie emoji');
});

test('bez viewera je vrstva inertná', () => {
  const inert = createUkraineEventsLayer({ viewer: null });
  assert.equal(inert.isShown(), false);
  inert.setEvents([{ id: 'x' }]);
  assert.equal(inert.getState().total, 0);
});
