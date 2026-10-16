// scripts/lib/boundaries.test.mjs — build hraníc a popisiek štátov (2026-10-16): triedy čiar (postoj OSN
// pre Ukrajinu), body po stranách čiary, bod v polygóne, záznam popisky.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyBoundary, countryLabelRecord, pointInMultiPolygon, pointInRing, sideSamples } from './boundaries.mjs';

test('trieda čiary: medzinárodná, sporná (vrátane ISO neuznanej), vnútorná odpadá', () => {
  assert.equal(classifyBoundary({ FEATURECLA: 'International boundary (verify)' }), 'international');
  assert.equal(classifyBoundary({ FEATURECLA: 'Disputed (please verify)' }), 'disputed');
  assert.equal(classifyBoundary({ FEATURECLA: 'Line of control (please verify)' }), 'disputed');
  assert.equal(classifyBoundary({ FEATURECLA: 'Indefinite (please verify)' }), 'disputed');
  assert.equal(classifyBoundary({ FEATURECLA: 'Indeterminant frontier' }), 'disputed');
  assert.equal(classifyBoundary({ FEATURECLA: 'International boundary (verify)', FCLASS_ISO: 'Unrecognized' }), 'disputed', 'Kosovo–Srbsko: podľa ISO neuznaná → čiarkovane');
  assert.equal(classifyBoundary({ FEATURECLA: 'Admin-1 boundary' }), null);
  assert.equal(classifyBoundary({}), 'disputed', 'bez triedy radšej čiarkovane');
});

test('Ukrajina podľa postoja OSN: Perekop (UA vnútorná, RU medzinárodná) odpadá; Kerč (UA medzinárodná) je medzinárodná', () => {
  assert.equal(classifyBoundary({ FEATURECLA: 'Disputed (please verify)', FCLASS_UA: 'Admin-1 boundary', FCLASS_RU: 'International boundary (verify)' }), null, 'Krym nie je oddelený od Ukrajiny');
  assert.equal(classifyBoundary({ FEATURECLA: 'Disputed (please verify)', FCLASS_UA: 'International boundary (verify)', FCLASS_RU: 'Admin-1 boundary' }), 'international', 'hranica Ukrajina–Rusko pri Kerči');
});

test('body po stranách: kolmo od stredu segmentov, vľavo v smere čiary', () => {
  const { left, right } = sideSamples([[0, 0], [1, 0]], 0.1);
  assert.deepEqual(left, [[0.5, 0.1]], 'čiara na východ: vľavo je sever');
  assert.deepEqual(right, [[0.5, -0.1]]);
  const many = sideSamples([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], 0.1);
  assert.equal(many.left.length, 3, 'tri vzorky (1/4, 1/2, 3/4)');
  assert.deepEqual(sideSamples([[0, 0]]), { left: [], right: [] });
});

test('bod v polygóne: even-odd s dierou, MultiPolygon, bbox mimo', () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
  assert.equal(pointInRing(5, 5, square), true);
  assert.equal(pointInRing(15, 5, square), false);
  assert.equal(pointInMultiPolygon(2, 2, [[square, hole]]), true);
  assert.equal(pointInMultiPolygon(5, 5, [[square, hole]]), false, 'v diere nie');
  assert.equal(pointInMultiPolygon(25, 25, [[square], [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]]]), true, 'druhý polygón');
});

test('záznam popisky: ISO2, poloha na 3 desatinné miesta, úrovne priblíženia; bez platného ISO null', () => {
  const rec = countryLabelRecord({ ISO_A2_EH: 'SK', ADM0_A3: 'SVK', LABEL_X: 19.049868, LABEL_Y: 48.734044, LABELRANK: 6, MIN_LABEL: 4, MAX_LABEL: 9, TINY: -99, POP_EST: 5454073, NAME_EN: 'Slovakia' });
  assert.deepEqual(rec, { iso2: 'SK', a3: 'SVK', lon: 19.05, lat: 48.734, rank: 6, minLabel: 4, maxLabel: 9, tiny: 0, pop: 5454073, nameEn: 'Slovakia' });
  assert.equal(countryLabelRecord({ ISO_A2_EH: '-99', ADM0_A3: 'SOL', LABEL_X: 46, LABEL_Y: 9 }), null, 'Somaliland bez ISO');
  assert.equal(countryLabelRecord({ ISO_A2_EH: 'XK', ADM0_A3: 'KOS', LABEL_X: 20.9, LABEL_Y: 42.6, TINY: 5 }).tiny, 5);
});
