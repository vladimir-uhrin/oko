// src/data/ukraineFreshness.test.mjs — vek zdrojov UKRAJINY: počítanie dní,
// prah zastarania podľa zdroja, slovenské tvary „pred … dňom/dňami".
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTROL_STALE_DAYS, DEEPSTATE_STALE_DAYS, ageDays, ageText, ageTextKey, freshnessOf,
} from './ukraineFreshness.js';

const NOW = Date.parse('2026-09-21T22:00:00Z');
const DAY = 86_400_000;

test('vek v celých dňoch nadol', () => {
  assert.equal(ageDays('2026-09-21T21:00:00Z', NOW), 0, 'hodinu staré je dnešné');
  assert.equal(ageDays('2026-09-20T21:00:00Z', NOW), 1);
  assert.equal(ageDays('2026-09-20T23:00:00Z', NOW), 0, '23 hodín ešte nie je deň');
  // Skutočný prípad, ktorý si toto vyžiadal: revízia modulu Wikipédie z 13. 8. 2026.
  assert.equal(ageDays('2026-08-13T09:28:11Z', NOW), 39);
});

test('chýbajúci a nečitateľný dátum nie sú nula', () => {
  assert.equal(ageDays(null, NOW), null);
  assert.equal(ageDays('', NOW), null);
  assert.equal(ageDays('zajtra', NOW), null);
  assert.equal(ageDays('2026-09-20T21:00:00Z', Number.NaN), null, 'bez času niet veku');
});

test('budúci dátum dá nulu, nie záporné dni', () => {
  // Posunuté pásmo alebo hodiny servera inak vyrobia „pred −1 dňami".
  assert.equal(ageDays('2026-09-23T00:00:00Z', NOW), 0);
});

test('zastarané je až NAD prahom zdroja', () => {
  const at = (days) => new Date(NOW - days * DAY).toISOString();
  assert.deepEqual(freshnessOf(at(CONTROL_STALE_DAYS), NOW, CONTROL_STALE_DAYS), { ageDays: 14, stale: false }, 'presne na prahu ešte nie');
  assert.deepEqual(freshnessOf(at(CONTROL_STALE_DAYS + 1), NOW, CONTROL_STALE_DAYS), { ageDays: 15, stale: true });
  assert.equal(freshnessOf('2026-08-13T09:28:11Z', NOW, CONTROL_STALE_DAYS).stale, true, 'revízia Wikipédie z 13. 8. je zastaraná');
});

test('DeepState má vlastný prah — zámerné oneskorenie 2–3 dni je v poriadku', () => {
  const at = (days) => new Date(NOW - days * DAY).toISOString();
  assert.equal(freshnessOf(at(3), NOW, DEEPSTATE_STALE_DAYS).stale, false, 'tri dni sú náš vlastný odklad');
  assert.equal(freshnessOf(at(5), NOW, DEEPSTATE_STALE_DAYS).stale, true, 'piaty deň už stojí zdroj alebo archivár');
  assert.ok(DEEPSTATE_STALE_DAYS < CONTROL_STALE_DAYS, 'čerstvejší zdroj musí mať prísnejší prah');
});

test('neznámy dátum nie je zastaraný, je neznámy', () => {
  assert.deepEqual(freshnessOf(null, NOW, CONTROL_STALE_DAYS), { ageDays: null, stale: false });
});

test('slovenské tvary: dnes · pred 1 dňom · pred 2 dňami', () => {
  assert.equal(ageTextKey(0), 'ukraine.age.today');
  assert.equal(ageTextKey(1), 'ukraine.age.one');
  assert.equal(ageTextKey(2), 'ukraine.age.many');
  assert.equal(ageTextKey(39), 'ukraine.age.many');
  assert.equal(ageTextKey(null), null);
  assert.equal(ageTextKey(-1), null);
});

test('ageText skladá text cez odovzdaný prekladač', () => {
  const translate = (key, vars) => `${key}:${vars?.n}`;
  assert.equal(ageText(0, translate), 'ukraine.age.today:0');
  assert.equal(ageText(1, translate), 'ukraine.age.one:1');
  assert.equal(ageText(39, translate), 'ukraine.age.many:39');
  assert.equal(ageText(null, translate), '', 'bez veku nič nepíšeme');
});
