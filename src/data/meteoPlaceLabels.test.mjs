// src/data/meteoPlaceLabels.test.mjs — mená miest a dedín nad meteo poľom (2026-10-07): dlaždice,
// prahy podľa veľkosti sídla (dediny až zblízka), mená sa neprekrývajú a väčšie sídlo vyhrá,
// skutočné dáta v public/meteo-towns majú Slovensko celé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  LABEL_MAX, PLACE_TIER_A_MAX, PLACE_TIER_A_MIN, TIER_A_LOAD_BELOW_M, TIER_B_LOAD_BELOW_M,
  cellsForView, declutterLabels, labelBox, placeCellKey, townVisibleUntilM,
} from './meteoPlaceLabels.js';

test('dlaždice 2° × 2°: kľúč, výrez aj cez 180. poludník, strop počtu, od stredu', () => {
  assert.equal(placeCellKey(48.4, 17.6), '69_98');
  assert.equal(placeCellKey(-90, -180), '0_0');
  assert.equal(placeCellKey(90, 180), '89_0', 'pól a poludník 180 sa zalomia');
  const sk = cellsForView({ west: 16.8, south: 47.7, east: 22.6, north: 49.6 });
  assert.ok(sk.includes(placeCellKey(48.15, 17.1)) && sk.includes(placeCellKey(48.7, 21.26)), 'Bratislava aj Košice');
  assert.equal(sk[0], placeCellKey(48.65, 19.7), 'najprv stred výrezu');
  const dateline = cellsForView({ west: 178, south: -18, east: -178, north: -16 });
  assert.ok(dateline.includes(placeCellKey(-17, 179)) && dateline.includes(placeCellKey(-17, -179)));
  assert.equal(cellsForView({ west: -180, south: -90, east: 180, north: 90 }).length, 36, 'strop dlaždíc');
  assert.deepEqual(cellsForView({ west: NaN, south: 0, east: 1, north: 1 }), []);
});

test('prahy: veľké sídla z diaľky, dediny až zblízka; načítanie dát podľa výšky', () => {
  assert.ok(townVisibleUntilM(80_000) > townVisibleUntilM(20_000));
  assert.ok(townVisibleUntilM(20_000) > townVisibleUntilM(6_000));
  assert.ok(townVisibleUntilM(6_000) > townVisibleUntilM(1_500));
  assert.ok(townVisibleUntilM(1_500) > townVisibleUntilM(0));
  assert.ok(townVisibleUntilM(0) >= 50_000, 'dedina bez počtu obyvateľov je vidieť pri najbližšom pohľade s poľom');
  assert.ok(TIER_A_LOAD_BELOW_M > TIER_B_LOAD_BELOW_M);
  assert.ok(TIER_B_LOAD_BELOW_M >= townVisibleUntilM(5_000), 'dlaždice sa načítajú skôr, než ich mená majú byť vidieť');
});

test('mená sa neprekrývajú: väčšie sídlo vyhrá, vzdialené ostanú, strop počtu', () => {
  const items = [
    { id: 'bratislava', x: 100, y: 100, name: 'Bratislava', priority: 475_000 },
    { id: 'vienna-overlap', x: 120, y: 104, name: 'Petržalka', priority: 100_000 },
    { id: 'trnava', x: 300, y: 60, name: 'Trnava', priority: 65_000 },
    { id: 'below', x: 100, y: 125, name: 'Rusovce', priority: 3_000 },
  ];
  const keep = declutterLabels(items);
  assert.ok(keep.has('bratislava'));
  assert.ok(!keep.has('vienna-overlap'), 'prekrývajúce sa menšie meno ustúpi');
  assert.ok(keep.has('trnava') && keep.has('below'), 'nepekrývajúce sa ostanú');
  const box = labelBox(0, 0, 'Abc');
  assert.ok(box.x0 > 0 && box.x1 > box.x0 && box.y0 < 0 && box.y1 > 0, 'rámček vpravo od bodu');
  const many = Array.from({ length: LABEL_MAX + 50 }, (_, i) => ({ id: String(i), x: (i % 30) * 200, y: Math.floor(i / 30) * 40, name: 'X', priority: i }));
  assert.equal(declutterLabels(many).size, LABEL_MAX);
});

test('dáta v public/meteo-towns: vrstva 15–100 tis. a dlaždice; Slovensko celé vrátane dedín bez počtu', () => {
  const base = new URL('../../public/meteo-towns/', import.meta.url);
  assert.ok(existsSync(new URL('a.json', base)), 'treba postaviť: node scripts/build-meteo-towns.mjs cities500.txt SK.txt');
  const a = JSON.parse(readFileSync(new URL('a.json', base), 'utf8'));
  assert.ok(a.length > 15_000);
  assert.ok(a.every(([, , , pop]) => pop >= PLACE_TIER_A_MIN && pop <= PLACE_TIER_A_MAX));
  const cell = JSON.parse(readFileSync(new URL(`b/${placeCellKey(48.4, 17.6)}.json`, base), 'utf8'));
  const names = new Set(cell.map(([n]) => n));
  for (const village of ['Šamorín', 'Hrubý Šúr', 'Kostolná pri Dunaji']) assert.ok(names.has(village), `${village} je v dlaždici`);
  assert.ok(cell.some(([, , , pop]) => pop === 0), 'slovenské obce bez počtu obyvateľov sú tiež');
  for (let i = 1; i < cell.length; i += 1) assert.ok(cell[i - 1][3] >= cell[i][3], 'zoradené od najväčšieho');
  assert.match(readFileSync(new URL('SOURCE.md', base), 'utf8'), /GeoNames.*CC BY 4\.0/s);
});

test('teplota pod menom ako na Windy: dva riadky, väčší rámček, bez hodnoty len meno', async () => {
  const { labelText } = await import('./meteoPlaceLabels.js');
  assert.equal(labelText('Trnava', '14°'), 'Trnava\n14°');
  assert.equal(labelText('Trnava', null), 'Trnava');
  const one = labelBox(0, 0, 'Trnava');
  const two = labelBox(0, 0, 'Trnava', true);
  assert.ok(two.y1 - two.y0 > one.y1 - one.y0, 'meno s hodnotou zaberie viac miesta');
  const keep = declutterLabels([
    { id: 'a', x: 100, y: 100, name: 'Trnava', value: '14°', priority: 2 },
    { id: 'b', x: 100, y: 122, name: 'Zeleneč', value: '15°', priority: 1 },
  ]);
  assert.ok(keep.has('a') && !keep.has('b'), 'druhý riadok s teplotou sa počíta do prekryvu');
});
