import assert from 'node:assert/strict';
import test from 'node:test';

import { buildStraitTrafficModel, countInRect, isInRect, vesselTypeBucket } from './straitTraffic.js';

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

test('dedupe can be disabled and empty sources yield a zeroed model', () => {
  const live = [{ id: '1', lon: 56, lat: 26 }];
  const delayed = [{ id: '1', lon: 56, lat: 26 }];
  assert.equal(buildStraitTrafficModel({ live, delayed }, RECT, { dedupe: false }).total, 2);
  assert.equal(buildStraitTrafficModel({ live, delayed }, RECT, { dedupe: true }).total, 1);
  const empty = buildStraitTrafficModel({}, RECT);
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.types, { tanker: 0, cargo: 0, passenger: 0, other: 0, unknown: 0 });
  assert.equal(empty.movingPct, null);
  assert.equal(empty.dark, 0);
});

test('vesselTypeBucket maps AIS numeric ranges and text labels; missing type is unknown', () => {
  assert.equal(vesselTypeBucket(80), 'tanker');
  assert.equal(vesselTypeBucket(70), 'cargo');
  assert.equal(vesselTypeBucket(69), 'passenger');
  assert.equal(vesselTypeBucket(37), 'other'); // pleasure craft
  assert.equal(vesselTypeBucket('Crude Oil Tanker'), 'tanker');
  assert.equal(vesselTypeBucket('Container Cargo'), 'cargo');
  assert.equal(vesselTypeBucket(null), 'unknown');
  assert.equal(vesselTypeBucket(''), 'unknown');
  assert.equal(vesselTypeBucket(0), 'unknown'); // AIS "not available"
});

test('the model breaks vessels down by type over the deduped in-view set', () => {
  const live = [
    { id: '1', lon: 56, lat: 26, type: 80 }, // tanker
    { id: '2', lon: 55, lat: 25, type: 70 }, // cargo
    { id: '3', lon: 0, lat: 0, type: 80 }, // outside
  ];
  const delayed = [
    { id: '1', lon: 56, lat: 26, type: 80 }, // dup of live tanker
    { id: '9', lon: 57, lat: 27, type: 60 }, // unique passenger in view
  ];
  const m = buildStraitTrafficModel({ live, delayed }, RECT);
  assert.equal(m.total, 3);
  assert.deepEqual(m.types, { tanker: 1, cargo: 1, passenger: 1, other: 0, unknown: 0 });
});

test('movement is summarized from SOG, and dark counts radar-only SAR in view', () => {
  const live = [
    { id: '1', lon: 56, lat: 26, sog: 12 }, // moving
    { id: '2', lon: 55, lat: 25, sog: 0.1 }, // stopped
  ];
  const sar = [
    { latitude: 26.5, longitude: 56.2, matched: false, detections: 3 }, // dark in view
    { latitude: 26.6, longitude: 56.3, matched: true, detections: 5 }, // matched → not dark
    { latitude: 10, longitude: 10, matched: false, detections: 9 }, // outside
  ];
  const m = buildStraitTrafficModel({ live, sar }, RECT);
  assert.equal(m.moving, 1);
  assert.equal(m.movingPct, 50);
  assert.equal(m.avgSpeedKts, 6.1); // (12 + 0.1) / 2
  assert.equal(m.hasMovement, true);
  assert.equal(m.dark, 1); // one dark cell in view (detections summed → cells counted)
});
