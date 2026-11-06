// src/data/powerGrid.test.mjs
// Elektrická sieť ≥ 220 kV (ELEKTRINA, 2026-11-06): druh, štýl podľa napätia,
// skupiny trás, texty karty, hover model, núdzový slovenský snímok.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  POWER_COLORS, POWER_KINDS, parsePowerFallback, powerDetails, powerDetailsRows, powerFallbackMeta, powerFrequencyText, powerGroupKey, powerHoverModel,
  powerKind, powerKindText, powerSelectedStyle, powerStyle, powerTitle, powerVoltageText, powerWidthClass,
} from './powerGrid.js';
import { GAS_PIPELINE_COLORS, OIL_PIPELINE_COLORS } from './gasPipelines.js';

const tKey = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);

test('powerKind: HVDC podľa frequency=0, inak ≥ 380 kV chrbtica a 220–330 kV', () => {
  assert.deepEqual([...POWER_KINDS], ['ehv', 'hv', 'dc']);
  assert.equal(powerKind({ voltageV: 400000, frequency: 50 }), 'ehv');
  assert.equal(powerKind({ voltageV: 380000 }), 'ehv');
  assert.equal(powerKind({ voltageV: 330000 }), 'hv');
  assert.equal(powerKind({ voltageV: 220000 }), 'hv');
  assert.equal(powerKind({ voltageV: 525000, frequency: 0 }), 'dc');
  assert.equal(powerKind({ voltageV: 400000, frequency: null }), 'ehv', 'chýbajúca frekvencia nie je jednosmerné');
});

test('farby: tri druhy odlíšené navzájom aj od plynu a ropy', () => {
  const ops = [POWER_COLORS.ehv.operating, POWER_COLORS.hv.operating, POWER_COLORS.dc.operating];
  assert.equal(new Set(ops).size, 3);
  for (const c of ops) {
    assert.notEqual(c, GAS_PIPELINE_COLORS.operating);
    assert.notEqual(c, OIL_PIPELINE_COLORS.operating);
  }
});

test('šírka podľa napätia; pahýle najtenšie; plánované čiarkované; výber biely a vždy viditeľný', () => {
  assert.equal(powerWidthClass({ voltageV: 750000 }), 'trunk');
  assert.equal(powerWidthClass({ voltageV: 400000, lengthKm: 0.5 }), 'main', 'chrbtica nikdy nie je pahýľ');
  assert.equal(powerWidthClass({ voltageV: 220000, lengthKm: 0.5 }), 'stub');
  assert.equal(powerWidthClass({ voltageV: 220000, lengthKm: 30 }), 'minor');
  const s = powerStyle({ voltageV: 400000, lengthKm: 30, status: 'operating' });
  assert.equal(s.kind, 'ehv');
  assert.equal(s.color, POWER_COLORS.ehv.operating);
  assert.equal(s.width, 5);
  assert.ok(s.outline, 'plná čiara má tmavý obrys');
  const planned = powerStyle({ voltageV: 220000, status: 'planned' });
  assert.equal(planned.dashed, true);
  assert.equal(planned.outline, null);
  const sel = powerSelectedStyle({ voltageV: 220000, lengthKm: 0.4 });
  assert.equal(sel.color, '#ffffff');
  assert.equal(sel.displayCondition, null);
  assert.equal(sel.width, powerStyle({ voltageV: 220000, lengthKm: 0.4 }).width + 3);
});

test('skupiny trás: relácia → meno → ref s prevádzkovateľom; všeobecné mená nič nespájajú', () => {
  assert.equal(powerGroupKey({ relation: 77, name: 'X' }), 'rel:77');
  assert.equal(powerGroupKey({ name: 'Lemešany – Moldava', operator: 'SEPS' }), 'name:lemešany – moldava|seps');
  assert.equal(powerGroupKey({ ref: 'V499', operator: 'SEPS' }), 'ref:v499|seps');
  assert.equal(powerGroupKey({ ref: 'II' }), null, 'krátke ref bez prevádzkovateľa');
  assert.equal(powerGroupKey({ name: 'Freileitung' }), null);
  assert.equal(powerGroupKey({ name: '400 kV' }), null);
  assert.equal(powerGroupKey({}), null);
});

test('texty karty: napätie, druh, obvody, frekvencia, mená v latinke, bez mena podľa kV', () => {
  assert.equal(powerVoltageText({ voltages: [400000, 110000] }), '400');
  assert.equal(powerVoltageText({ voltages: [400000, 110000] }, { all: true }), '400 / 110');
  assert.equal(powerVoltageText({}), '');
  assert.equal(powerTitle({ voltageV: 400000, voltages: [400000] }, tKey), 'power.unnamed {"kv":"400"}');
  assert.equal(powerTitle({ ref: 'V499' }, tKey), 'V499');
  assert.equal(powerTitle({ name: 'ВЛ 750 кВ Хмельницкая АЭС — Жешув' }, tKey), 'VL 750 kV Khmelnitskaya AES — Zheshuv');
  assert.equal(powerKindText({ voltageV: 525000, voltages: [525000], frequency: 0 }, tKey), 'power.kind-dc {"kv":"525"}');
  assert.equal(powerKindText({ voltageV: 220000, voltages: [220000], power: 'cable' }, tKey), 'power.kind-cable {"kv":"220"}');
  assert.equal(powerFrequencyText({ frequency: 0 }, tKey), 'power.frequency-dc');
  assert.equal(powerFrequencyText({ frequency: 50 }, tKey, 'sk'), '50 Hz');
  assert.equal(powerFrequencyText({ frequency: 16.7 }, tKey, 'sk'), 'power.frequency-rail {"hz":"16,7 Hz"}');
  const p = { voltageV: 400000, voltages: [400000, 110000], circuits: 2, cables: 6, frequency: 50, lengthKm: 42.3, operator: 'SEPS', countries: ['SK', 'HU'], from: 'Gabčíkovo', to: 'Gönyű', status: 'operating', osm: 9 };
  const details = powerDetails(p, tKey, 'sk', { regionName: (iso) => ({ SK: 'Slovensko', HU: 'Maďarsko' })[iso] });
  assert.equal(details[0], 'power.kind-line {"kv":"400"}');
  assert.ok(details.includes('SEPS'));
  assert.ok(details.includes('gas.pipeline-countries: Slovensko · Maďarsko'));
  assert.ok(details.includes('gas.pipeline-route: Gabčíkovo → Gönyű'));
  assert.ok(details.some((l) => l.startsWith('400 / 110 kV · power.circuits {"n":2}')));
  assert.ok(details.includes('power.frequency: 50 Hz'));
  assert.equal(details.at(-1), 'OSM way 9');
  const rows = powerDetailsRows(p, tKey, 'sk');
  assert.deepEqual(rows[0], ['power.voltage', '400 / 110 kV']);
  assert.deepEqual(rows[1], ['power.type', 'power.type-line']);
  assert.ok(rows.some(([k, v]) => k === 'power.circuits-label' && v === '2'));
  assert.ok(rows.some(([k, v]) => k === 'power.cables-label' && v === '6'));
});

test('hover model: tvar karty potrubí, druh, hranice z krajín úseku, OSM odkaz', () => {
  const m = powerHoverModel({ id: 'osm-way-5', properties: { voltageV: 400000, voltages: [400000], countries: ['SK', 'HU', 'SK'], osm: 5, operator: 'SEPS' } }, { translate: tKey, lang: 'sk' });
  assert.equal(m.kind, 'ehv');
  assert.equal(m.kindText, 'power.kind-line {"kv":"400"}');
  assert.deepEqual(m.countries, ['SK', 'HU', 'SK']);
  assert.deepEqual(m.flowIds, ['HU-SK'], 'dvojica sa zjednotí');
  assert.equal(m.osmUrl, 'https://www.openstreetmap.org/way/5');
  assert.equal(m.flowNoneKey, null);
  assert.equal(m.operator.text, 'SEPS');
  assert.deepEqual(powerHoverModel({ properties: { voltageV: 220000, countries: ['DE'] } }).flowIds, []);
  assert.equal(powerHoverModel(null), null);
});

test('núdzový snímok: bundlovaný SK extrakt → vlastnosti snímku Eurázie, plyn preskočený, meta s dátumom', () => {
  const text = readFileSync(new URL('./local_data/sk_energy/sk-energy.geojsonl', import.meta.url), 'utf8');
  const features = parsePowerFallback(text);
  assert.ok(features.length > 400 && features.length < 1000, `počet ${features.length}`);
  for (const f of features) {
    assert.ok(f.properties.voltageV >= 220000, 'len 220/400 kV');
    assert.ok(f.properties.lengthKm > 0);
    assert.deepEqual(f.properties.countries, ['SK']);
    assert.equal(f.geometry.type, 'LineString');
  }
  const kinds = new Set(features.map((f) => powerKind(f.properties)));
  assert.deepEqual([...kinds].sort(), ['ehv', 'hv']);
  const meta = powerFallbackMeta(features);
  assert.equal(meta.fallback, true);
  assert.equal(meta.snapshot, '2026-08-30');
  assert.equal(meta.features, features.length);
  assert.ok(meta.lengthKm > 1000);
  assert.deepEqual(parsePowerFallback('nie json\n'), []);
});

test('bunky: id a bbox, index (každý úsek v jednej bunke podľa stredu), súčty druhov', async () => {
  const { powerCellId, powerCellBbox, buildPowerCellIndex } = await import('./powerGrid.js');
  assert.equal(powerCellId(17.1, 48.1), '45_15');
  assert.equal(powerCellId(-3.2, 40.4), '40_-5');
  assert.deepEqual(powerCellBbox('45_15'), [45, 15, 50, 20]);
  const f = (id, coords, props) => ({ feature: { id, properties: props, geometry: { coordinates: coords } }, line: `{"id":"${id}"}` });
  const { index, linesByCell } = buildPowerCellIndex([
    f('a', [[17, 48], [18, 48.5], [19.5, 48.7]], { voltageV: 400000, lengthKm: 10 }),
    f('b', [[19.9, 48], [20.1, 48]], { voltageV: 220000, lengthKm: 2 }),
    f('c', [[8, 54], [9, 56]], { voltageV: 525000, frequency: 0, lengthKm: 200 }),
    f('bad', [], {}),
  ]);
  assert.deepEqual(index.cells.map((c) => [c.id, c.count]), [['45_15', 1], ['45_20', 1], ['55_5', 1]], 'b má stred 20,0° → bunka 45_20; c stred (9, 56) → 55_5');
  assert.deepEqual(index.totals, { ehv: 1, hv: 1, dc: 1 });
  assert.equal(index.features, 3);
  assert.deepEqual(linesByCell.get('45_15'), ['{"id":"a"}']);
  assert.ok(!('lines' in index.cells[0]), 'riadky nejdú do indexu pre klienta');
});

test('selectPowerCells: len bunky vo výhľade, od stredu, pod stropom; prvá vždy', async () => {
  const { selectPowerCells } = await import('./powerGrid.js');
  const cell = (id, count) => ({ id, bbox: [Number(id.split('_')[0]), Number(id.split('_')[1]), Number(id.split('_')[0]) + 5, Number(id.split('_')[1]) + 5], count });
  const cells = [cell('45_15', 100), cell('45_10', 300), cell('50_15', 200), cell('35_-10', 50), cell('45_20', 0)];
  const view = { west: 12, south: 46, east: 21, north: 51, lon: 17, lat: 48 };
  assert.deepEqual(selectPowerCells(cells, view, { maxResident: 10_000 }), ['45_15', '45_10', '50_15'], 'od stredu výhľadu; Španielsko mimo, prázdna bunka nie');
  assert.deepEqual(selectPowerCells(cells, view, { maxResident: 400 }), ['45_15', '45_10']);
  assert.deepEqual(selectPowerCells(cells, view, { maxResident: 350 }), ['45_15'], 'strop: 45_10 (300) sa nezmestí → koniec, vzdialenejšia 50_15 sa nepreskakuje dopredu');
  assert.deepEqual(selectPowerCells(cells, view, { maxResident: 10 }), ['45_15'], 'najbližšia bunka aj nad stropom');
  assert.deepEqual(selectPowerCells(cells, { lon: -7, lat: 37 }, { maxResident: 120 }), ['35_-10'], 'bez obdĺžnika = najbližšie k stredu');
  assert.deepEqual(selectPowerCells(cells, { west: 170, east: -170, south: 40, north: 60, lon: 180, lat: 50 }, { maxResident: 1e6 }), [], 'cez 180° poludník');
  assert.deepEqual(selectPowerCells(cells, null), []);
});
