import assert from 'node:assert/strict';
import test from 'node:test';

import { buildStraitTrafficModel, countInRect, isInRect } from './straitTraffic.js';

// Hormuz-ish rectangle [west, south, east, north].
const RECT = [54.0, 24.2, 58.6, 28.2];

test('isInRect is inclusive and rejects points outside or malformed input', () => {
  assert.equal(isInRect(56.25, 26.57, RECT), true); // strait centre
  assert.equal(isInRect(54.0, 24.2, RECT), true); // corner (inclusive)
  assert.equal(isInRect(53.9, 26, RECT), false); // west of box
  assert.equal(isInRect(56, 29, RECT), false); // north of box
  assert.equal(isInRect(Number.NaN, 26, RECT), false);
  assert.equal(isInRect(56, 26, [1, 2, 3]), false); // bad rect
});

test('countInRect accepts both {lon,lat} and {longitude,latitude} shapes', () => {
  const pts = [
    { longitude: 56.25, latitude: 26.5 }, // in
    { lon: 55, lat: 25 }, // in
    { longitude: 40, latitude: 26 }, // out
    { lon: 56, lat: 40 }, // out
  ];
  assert.equal(countInRect(pts, RECT), 2);
  assert.equal(countInRect(null, RECT), 0);
  assert.equal(countInRect(pts, null), 0);
});

test('the model counts live + delayed in view and dedupes delayed against live by MMSI', () => {
  const live = [
    { id: '111', longitude: 56.2, latitude: 26.4 },
    { id: '222', longitude: 55.5, latitude: 25.5 },
    { id: '333', longitude: 10, latitude: 10 }, // outside
  ];
  const delayed = [
    { id: '222', longitude: 55.5, latitude: 25.5 }, // dup of a live one → not counted
    { id: '444', longitude: 57, latitude: 27 }, // unique delayed in view
    { id: '555', longitude: 0, latitude: 0 }, // outside
  ];
  const model = buildStraitTrafficModel({ live, delayed }, RECT);
  assert.equal(model.live, 2);
  assert.equal(model.delayed, 1); // 444 only; 222 deduped, 555 outside
  assert.equal(model.total, 3);
});

test('dedupe can be disabled and empty sources yield zero', () => {
  const live = [{ id: '1', lon: 56, lat: 26 }];
  const delayed = [{ id: '1', lon: 56, lat: 26 }];
  assert.equal(buildStraitTrafficModel({ live, delayed }, RECT, { dedupe: false }).total, 2);
  assert.equal(buildStraitTrafficModel({ live, delayed }, RECT, { dedupe: true }).total, 1);
  assert.deepEqual(buildStraitTrafficModel({}, RECT), { total: 0, live: 0, delayed: 0 });
});
