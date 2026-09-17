import assert from 'node:assert/strict';
import test from 'node:test';

import { OIL_RANGE_DAYS, OIL_SERIES_COLORS, nearestIndex, sliceSeriesPoints } from './oilChart.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const pts = Array.from({ length: 400 }, (_, i) => ({ t: T0 + i * DAY, v: 100 + i }));

test('sliceSeriesPoints keeps only the last N days and preserves the tail', () => {
  const m = sliceSeriesPoints(pts, '1M');
  assert.ok(m.length >= 30 && m.length <= 33);
  assert.equal(m.at(-1).t, pts.at(-1).t);
  const y = sliceSeriesPoints(pts, '1Y');
  assert.ok(y.length >= 368 && y.length <= 371);
  assert.deepEqual(sliceSeriesPoints([{ t: 1, v: 1 }], '6M'), [{ t: 1, v: 1 }]); // < 2 points → as-is
  assert.deepEqual(sliceSeriesPoints(null, '6M'), []);
});

test('nearestIndex finds the closest timestamp', () => {
  const ts = [0, 10, 20, 30];
  assert.equal(nearestIndex(ts, 12), 1);
  assert.equal(nearestIndex(ts, 26), 3);
  assert.equal(nearestIndex(ts, -5), 0);
  assert.equal(nearestIndex([], 5), -1);
});

test('every series key has a colour and the three ranges exist', () => {
  for (const key of ['brent', 'wti', 'natgas', 'gasoline', 'diesel']) {
    assert.match(OIL_SERIES_COLORS[key], /^#[0-9a-f]{6}$/i);
  }
  assert.deepEqual(Object.keys(OIL_RANGE_DAYS).sort(), ['1M', '1Y', '6M']);
});
