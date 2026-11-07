// scripts/lib/pipelineSnapshotCells.test.mjs
// Bunky v engine snímkov (2026-11-07): writeCells zapíše index a súbory buniek
// atómovo (najprv `<dir>.next`, potom výmena — ostrý server číta zdieľanú
// .gev-cache), každý úsek v práve jednej bunke, súčty druhov, meta snímku.
// Spoločný modul buniek: id, bbox, výber, URL bunky, strop podľa zariadenia.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeCells } from './pipelineSnapshot.mjs';
import { CELL_MAX_RESIDENT, buildCellIndex, cellBbox, cellId, cellUrlFor, defaultMaxResident, selectCells } from '../../src/data/snapshotCells.js';

const f = (id, coords, props = {}) => ({ type: 'Feature', id, properties: { lengthKm: 10, ...props }, geometry: { type: 'LineString', coordinates: coords } });

test('writeCells: index + súbory buniek, každý úsek raz, súčty druhov, meta, stará bunka zmizne, žiadny .next', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oko-cells-')), 'cells');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '0_0.geojsonl'), 'stará bunka\n');
  const features = [
    f('a', [[17, 48], [18, 48.5], [19, 48.7]], { substance: 'gas' }),
    f('b', [[-97, 29], [-96, 29.5]], { substance: 'gas' }),
    f('c', [[17.2, 48.1], [17.4, 48.2]], { substance: 'gas' }),
  ];
  const index = writeCells(features, { snapshot: '2026-11-07T08:00:00Z', features: 3, lengthKm: 30, source: 'OSM', license: 'ODbL' }, { dir, kinds: ['gas'], kindOf: () => 'gas' });
  assert.deepEqual(index.cells.map((c) => [c.id, c.count]), [['25_-100', 1], ['45_15', 2]]);
  assert.deepEqual(index.totals, { gas: 3 });
  assert.equal(index.meta.snapshot, '2026-11-07T08:00:00Z');
  const files = fs.readdirSync(dir).sort();
  assert.deepEqual(files, ['25_-100.geojsonl', '45_15.geojsonl', 'index.json'], 'stará bunka 0_0 je preč');
  assert.ok(!fs.existsSync(`${dir}.next`), 'dočasný adresár sa po výmene nezostane');
  const lines = fs.readFileSync(path.join(dir, '45_15.geojsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).id);
  assert.deepEqual(lines, ['a', 'c']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).cells.length, 2);
});

test('snapshotCells: id a bbox, index s kindOf, výber kruhom od stredu, URL bunky s verziou, strop podľa zariadenia', () => {
  assert.equal(cellId(-0.1, 51.5), '50_-5');
  assert.deepEqual(cellBbox('-35_150'), [-35, 150, -30, 155]);
  const { index } = buildCellIndex([{ feature: f('x', [[1, 1], [2, 2]], { voltageV: 400000 }), line: 'x' }, { feature: f('y', [[1, 1], [1.1, 1.1]], { voltageV: 220000 }), line: 'y' }], { kinds: ['ehv', 'hv'], kindOf: (p) => (p.voltageV >= 380000 ? 'ehv' : 'hv') });
  assert.deepEqual(index.totals, { ehv: 1, hv: 1 });
  assert.deepEqual(selectCells([{ id: 'a', bbox: [0, 0, 5, 5], count: 3 }, { id: 'b', bbox: [40, 0, 45, 5], count: 3 }], { lon: 2, lat: 2 }, { maxResident: 10 }), ['a', 'b']);
  assert.equal(cellUrlFor('/api/gas/cell/')('45_-5', '2026-11-07T08:00:00Z'), '/api/gas/cell/45_-5?v=2026-11-07T08%3A00%3A00Z');
  assert.equal(cellUrlFor('/api/gas/cell/')('45_15', null), '/api/gas/cell/45_15');
  assert.equal(defaultMaxResident(), CELL_MAX_RESIDENT.desktop, 'v Node (bez window) = počítač');
  assert.deepEqual(CELL_MAX_RESIDENT, { desktop: 16_000, touch: 6_000 });
});
