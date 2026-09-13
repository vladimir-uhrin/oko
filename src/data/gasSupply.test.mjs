// src/data/gasSupply.test.mjs
// Denný mix dodávok EÚ (2026-09-13): body mixu z katalógu, os dní, dopĺňanie
// chýbajúcich dní, úplný deň, vrstvy, riadky, titulok, bez LNG, bez dát.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPLY_COMPLETE_SHARE, SUPPLY_DAYS, SUPPLY_FILL_DAYS, SUPPLY_ORIGINS, alignSeries, buildSupplyModel, supplyDays, supplyPoints,
} from './gasSupply.js';
import { GAS_FLOW_POINTS, buildFlowsPayload, formatGwhDay } from './gasFlows.js';
import { buildGiePayload } from './gasStorage.js';

const tKey = (key, vars) => (vars && Object.keys(vars).length ? `${key} ${JSON.stringify(vars)}` : key);
const NOW = Date.UTC(2026, 8, 13, 10);
const day = (i) => new Date(Date.UTC(2026, 8, 11) - i * 86_400_000).toISOString().slice(0, 10);
const row = (operatorKey, pointKey, directionKey, d, gwh) => ({ periodFrom: `${d}T06:00:00+02:00`, operatorKey, pointKey, directionKey, unit: 'kWh/d', value: gwh * 1e6, flowStatus: 'Provisional' });
const daily = (operatorKey, pointKey, gwh, n = 5, skipLatest = false) => Array.from({ length: n }, (_, i) => row(operatorKey, pointKey, 'entry', day(i), gwh)).filter((_, i) => !(skipLatest && i === 0));
const FLOWS = buildFlowsPayload([
  ...daily('FR-TSO-0003', 'ITP-00045', 500),            // Dunkerque (NO)
  ...daily('DE-TSO-0009', 'ITP-00126', 700, 5, true),   // Dornum (NO) — posledný deň chýba → doplní sa
  ...daily('ES-TSO-0006', 'ITP-00048', 330),            // Almería (DZ)
  ...daily('BG-TSO-0001', 'ITP-00549', 380),            // Strandža 2 (RU)
  ...daily('UK-TSO-0004', 'ITP-00207', 150),            // Bacton BBL (UK)
  ...daily('SK-TSO-0001', 'ITP-00117', 0),              // Veľké Kapušany UA→SK (RU-UA) = 0
  ...daily('SK-TSO-0001', 'ITP-00051', 20),             // Lanžhot CZ→SK — vnútro EÚ, do mixu nepatrí
], { fetchedAt: NOW });
const LNG = buildGiePayload('alsi', {
  eu: Array.from({ length: 5 }, (_, i) => ({ name: 'EU', code: 'eu', gasDayStart: day(i), inventory: { gwh: '30000' }, dtmi: { gwh: '60000' }, sendOut: '3000', status: 'E' })),
}, { fetchedAt: NOW });

test('supplyPoints: len body s pôvodom (z payloadu alebo katalógu); katalóg má 22 bodov mixu v 8 pôvodoch', () => {
  const inCatalogue = GAS_FLOW_POINTS.filter((p) => p.origin);
  assert.equal(inCatalogue.length, 22);
  assert.deepEqual([...new Set(inCatalogue.map((p) => p.origin))].sort(), ['AZ', 'DZ', 'LY', 'NO', 'RU', 'RU-UA', 'UK']);
  assert.ok(inCatalogue.every((p) => SUPPLY_ORIGINS.some((o) => o.key === p.origin)), 'každý pôvod má vrstvu');
  assert.ok(!inCatalogue.some((p) => p.dir === 'exit'), 'do mixu idú len vstupy');
  const pts = supplyPoints(FLOWS.points.map((p) => ({ ...p, origin: undefined })));
  assert.equal(pts.length, 22, 'pôvod sa doplní z katalógu, keď ho payload nenesie');
  assert.equal(supplyPoints([{ id: 'nezmysel' }]).length, 0);
  assert.equal(SUPPLY_ORIGINS.map((o) => o.key).join(','), 'NO,RU,RU-UA,DZ,LY,AZ,UK,LNG');
});

test('supplyDays a alignSeries: os končí posledným dňom, chýbajúci deň = posledná hodnota do 3 dní, inak 0', () => {
  const axis = supplyDays('2026-09-11', 5);
  assert.deepEqual(axis, ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']);
  assert.equal(supplyDays('2026-09-11').length, SUPPLY_DAYS);
  const a = alignSeries([{ date: '2026-09-07', gwh: 10 }, { date: '2026-09-11', gwh: 12 }], axis);
  assert.deepEqual(a.values, [10, 10, 10, 10, 12], 'doplnenie do 3 dní (08, 09, 10 z 07)');
  assert.deepEqual(a.reported, [true, false, false, false, true]);
  const b = alignSeries([{ date: '2026-09-06', gwh: 10 }], axis);
  assert.deepEqual(b.values, [10, 10, 10, 0, 0], `po ${SUPPLY_FILL_DAYS} dňoch bez hodnoty je nula`);
  const c = alignSeries([{ date: '2026-09-10', sendOut: 5 }], axis, { key: 'sendOut' });
  assert.deepEqual(c.values, [0, 0, 0, 5, 5]);
});

test('buildSupplyModel: súčty po pôvodoch, LNG vrstva, úplný deň, titulok, legenda zoradená, poznámka a zdroj', () => {
  const m = buildSupplyModel({ flows: FLOWS, lng: LNG }, { lang: 'sk', translate: tKey, nowMs: NOW });
  assert.equal(m.ok, true);
  assert.equal(m.days.length, SUPPLY_DAYS, 'úplný deň = posledný, graf ide po celom okne');
  assert.equal(m.days[SUPPLY_DAYS - 1], '2026-09-11');
  assert.deepEqual(m.layers.map((l) => l.key), ['NO', 'RU', 'RU-UA', 'DZ', 'LY', 'AZ', 'UK', 'LNG']);
  const layer = (k) => m.layers.find((l) => l.key === k);
  assert.equal(layer('NO').values[30], 1200, 'Dunkerque 500 + Dornum 700 (doplnené z 10. 9.)');
  assert.equal(layer('NO').values[25], 0, 'pred prvými dátami nula');
  assert.equal(layer('DZ').values[30], 330);
  assert.equal(layer('RU').values[30], 380);
  assert.equal(layer('UK').values[30], 150);
  assert.equal(layer('RU-UA').values[30], 0);
  assert.equal(layer('LNG').values[30], 3000);
  assert.equal(layer('NO').label, 'gas.supply-origin-NO');
  assert.equal(layer('NO').color, SUPPLY_ORIGINS[0].color);
  assert.equal(m.headline.totalText, formatGwhDay(5060, 'sk'));
  assert.equal(m.headline.mcmText, 'gas.supply-mcm {"v":"480"}');
  assert.equal(m.headline.dateText, '11. 9. 2026');
  assert.equal(m.headline.completeText, 'gas.supply-complete {"n":6,"m":7}', '5 bodov + LNG hlási z 6 aktívnych + LNG');
  assert.equal(m.headline.sharesText, 'gas.supply-origin-LNG 59 % · gas.supply-origin-NO 24 % · gas.supply-origin-RU 7,5 % · gas.supply-origin-DZ 6,5 %');
  assert.deepEqual(m.rows.map((r) => r.key), ['LNG', 'NO', 'RU', 'DZ', 'UK', 'RU-UA', 'LY', 'AZ'], 'podľa objemu, nuly a bez dát na konci');
  const gwh = (v) => formatGwhDay(v, 'sk');
  const ru = m.rows.find((r) => r.key === 'RU');
  assert.deepEqual([ru.valueText, ru.pctText, ru.level, ru.color], [gwh(380), '7,5 %', 'ok', SUPPLY_ORIGINS[1].color]);
  // Fixtúra má 5 dní dát: priemer 7 dní berie 2 dni pred prvými dátami ako nulu (5 × 380 / 7).
  assert.equal(ru.sub, `gas.supply-avg7 ${JSON.stringify({ v: gwh((5 * 380) / 7) })} · gas.supply-points {"n":1,"m":6}`, 'zo 6 ruských vstupov hlási len TurkStream');
  const no = m.rows.find((r) => r.key === 'NO');
  assert.equal(no.sub, `gas.supply-avg7 ${JSON.stringify({ v: gwh((5 * 1200) / 7) })} · gas.supply-points {"n":1,"m":5}`, 'Dornum posledný deň nehlásil (doplnený), takže 1 z 5');
  assert.equal(m.rows.find((r) => r.key === 'LNG').sub, `gas.supply-avg7 ${JSON.stringify({ v: gwh((5 * 3000) / 7) })} · gas.supply-lng-points`);
  const ly = m.rows.find((r) => r.key === 'LY');
  assert.deepEqual([ly.valueText, ly.pctText, ly.level], ['gas.flow-nodata', '', 'nodata'], 'pôvod bez jediného hlásiaceho bodu = bez dát');
  assert.equal(m.rows.find((r) => r.key === 'RU-UA').level, 'zero');
  assert.equal(m.note, 'gas.supply-note');
  assert.equal(m.sourceLine, 'ENTSOG TP 13-09-2026 https://transparency.entsog.eu/ · gas.supply-lng-source');
  assert.deepEqual(m.freshness, { latestDate: '2026-09-11', ageDays: 2, stale: false, lngMissing: false, activePoints: 6, points: 22 });
});

test('buildSupplyModel: bez LNG ide ďalej (LNG bez dát), zastarané po 4 dňoch, úplný deň sa posunie späť, bez dát ok=false', () => {
  const noLng = buildSupplyModel({ flows: FLOWS, lng: null }, { lang: 'sk', translate: tKey, nowMs: NOW });
  assert.equal(noLng.ok, true);
  assert.equal(noLng.freshness.lngMissing, true);
  assert.equal(noLng.rows.find((r) => r.key === 'LNG').level, 'nodata');
  assert.equal(noLng.headline.totalText, formatGwhDay(2060, 'sk'));
  assert.equal(noLng.sourceLine, 'ENTSOG TP 13-09-2026 https://transparency.entsog.eu/');
  const old = buildSupplyModel({ flows: FLOWS, lng: LNG }, { lang: 'sk', translate: tKey, nowMs: Date.UTC(2026, 8, 20) });
  assert.equal(old.freshness.stale, true);
  // Keď posledný deň hlási málo bodov, úplný deň je skorší a graf sa tam skončí.
  const lateOnly = buildFlowsPayload([
    ...daily('FR-TSO-0003', 'ITP-00045', 500, 5, true),
    ...daily('DE-TSO-0009', 'ITP-00126', 700, 5, true),
    ...daily('ES-TSO-0006', 'ITP-00048', 330, 5, true),
    ...daily('BG-TSO-0001', 'ITP-00549', 380),
  ], { fetchedAt: NOW });
  const partial = buildSupplyModel({ flows: lateOnly, lng: null }, { lang: 'sk', translate: tKey, nowMs: NOW, completeShare: SUPPLY_COMPLETE_SHARE });
  assert.equal(partial.freshness.latestDate, '2026-09-10', '11. 9. hlási 1 zo 4 → úplný je 10. 9.');
  assert.equal(partial.days.length, SUPPLY_DAYS - 1);
  assert.equal(partial.headline.totalText, formatGwhDay(1910, 'sk'));
  assert.equal(buildSupplyModel({ flows: null, lng: null }, { translate: tKey }).ok, false);
  assert.equal(buildSupplyModel({ flows: { points: [] }, lng: { eu: { series: [] } } }, { translate: tKey }).ok, false);
});
