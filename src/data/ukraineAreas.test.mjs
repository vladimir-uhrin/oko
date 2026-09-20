// src/data/ukraineAreas.test.mjs — výber dlaždíc plôch podľa pohľadu, prahy, štýl.
import test from 'node:test';
import assert from 'node:assert/strict';

import { AREAS_MAX_HEIGHT_M, AREAS_STYLE, areasWanted, cssToRgb01, fallbackRect, filterAreasForDraw, pickAreaTiles, tileBbox, tileKeyFor, tilesInRect } from './ukraineAreas.js';

test('kľúč a bbox dlaždice', () => {
  assert.equal(tileKeyFor(48.99, 37.8), 'N48E037');
  assert.deepEqual(tileBbox('N48E037'), [37, 48, 38, 49]);
  assert.equal(tileBbox('x'), null);
});

test('prah výšky: pod 420 km áno, nad nie, NaN nie', () => {
  assert.equal(areasWanted(100_000), true);
  assert.equal(areasWanted(AREAS_MAX_HEIGHT_M), false);
  assert.equal(areasWanted(NaN), false);
});

test('dlaždice v obdĺžniku a výber najbližších dostupných so stropom', () => {
  assert.deepEqual(tilesInRect([37.2, 48.6, 38.4, 49.3]), ['N48E037', 'N48E038', 'N49E037', 'N49E038']);
  assert.deepEqual(tilesInRect([37.2, 48.6, NaN, 49.3]), []);
  const picked = pickAreaTiles({ rect: [36.2, 47.6, 39.4, 50.3], center: { lat: 49.1, lon: 37.85 }, available: ['N48E037', 'N49E037', 'N47E036', 'N49E038', 'N50E039'], max: 3 });
  assert.deepEqual(picked, ['N49E037', 'N49E038', 'N48E037'], 'najbližšie k stredu (49,1° N: severné dlaždice bližšie), len dostupné, max 3');
  assert.deepEqual(pickAreaTiles({ rect: [0, 0, 1, 1], center: { lat: 0.5, lon: 0.5 }, available: new Set() }), []);
  assert.deepEqual(fallbackRect({ lat: 49, lon: 37 }, 1), [36, 48.3, 38, 49.7]);
});

test('filterAreasForDraw: lesy sa nekreslia (rozhodnutie používateľa po dvoch pohľadoch), prah plochy, výber tried a strop na triedu', () => {
  const sq = (lon, lat, d) => [[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]];
  const data = { built: [[sq(37, 48, 0.02)], [sq(37, 48, 0.001)]], forest: [[sq(37, 48, 0.2)], [sq(37, 48, 0.002)]], water: [[sq(37, 48, 0.03)]], rail: [[[37, 48], [37.1, 48]]] };
  const out = filterAreasForDraw(data);
  assert.deepEqual(out.counts, { built: 1, forest: 0, water: 1, rail: 1 }, 'drobná zástavba vypadla prahom, lesy vôbec');
  assert.deepEqual(filterAreasForDraw(data, { classes: ['built', 'forest', 'water', 'rail'] }).counts, { built: 1, forest: 1, water: 1, rail: 1 }, 's lesmi na požiadanie (drobný les vypadol prahom)');
  assert.deepEqual(filterAreasForDraw(data, { max: { built: 0, forest: 0, water: 0, rail: 0 } }).counts, { built: 0, forest: 0, water: 0, rail: 0 });
});

test('štýl a farby', () => {
  assert.deepEqual(cssToRgb01('#ffffff'), [1, 1, 1]);
  assert.deepEqual(cssToRgb01('#000000'), [0, 0, 0]);
  assert.ok(Math.abs(cssToRgb01(AREAS_STYLE.built.color)[0] - 205 / 255) < 1e-9);
  assert.ok(AREAS_STYLE.forest.alpha > 0 && AREAS_STYLE.forest.spacingPx > 0);
});
