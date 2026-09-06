// src/data/gibsDay.test.mjs
// Zdieľaný deň mozaiky pre NASA prekryvy — časový posuvník (2026-09-06, bod 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GIBS_DAY_MAX_BACK,
  _resetGibsDayForTest,
  getGibsDayOffset,
  gibsDayForOffset,
  normalizeGibsDayOffset,
  onGibsDayChange,
  setGibsDayOffset,
} from './gibsDay.js';

const NOW = Date.UTC(2026, 8, 6, 15, 0);

test('posun: 0 = včera, n = n dní pred včerajškom, normalizácia na 0..MAX', () => {
  assert.equal(gibsDayForOffset(0, NOW), '2026-09-05');
  assert.equal(gibsDayForOffset(1, NOW), '2026-09-04');
  assert.equal(gibsDayForOffset(16, NOW), '2026-08-20');
  assert.equal(normalizeGibsDayOffset('7'), 7);
  assert.equal(normalizeGibsDayOffset(3.6), 4);
  assert.equal(normalizeGibsDayOffset(-5), 0);
  assert.equal(normalizeGibsDayOffset(GIBS_DAY_MAX_BACK + 100), GIBS_DAY_MAX_BACK);
  assert.equal(normalizeGibsDayOffset('x'), 0, 'nečíslo = najnovší, nie NaN');
  assert.ok(GIBS_DAY_MAX_BACK >= 30 && GIBS_DAY_MAX_BACK <= 120);
});

test('stav: zmena volá poslucháčov len pri inej hodnote, odhlásenie funguje', () => {
  _resetGibsDayForTest();
  const seen = [];
  const off = onGibsDayChange((n) => seen.push(n));
  assert.equal(getGibsDayOffset(), 0);
  assert.equal(setGibsDayOffset(5), true);
  assert.equal(setGibsDayOffset('5'), false, 'posuvník strieľa input pri každom pixeli — rovnaká hodnota nič nerobí');
  assert.equal(setGibsDayOffset(999), true);
  assert.equal(getGibsDayOffset(), GIBS_DAY_MAX_BACK);
  assert.deepEqual(seen, [5, GIBS_DAY_MAX_BACK]);
  off();
  setGibsDayOffset(0);
  assert.deepEqual(seen, [5, GIBS_DAY_MAX_BACK], 'po odhlásení už nič');
  assert.equal(onGibsDayChange(null)(), undefined, 'bez funkcie = no-op odhlásenie');
  _resetGibsDayForTest();
});
