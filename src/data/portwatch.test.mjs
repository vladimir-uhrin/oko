// src/data/portwatch.test.mjs — IMF PortWatch: dotaz, parser, zlúčenie, priemery, súhrn úžiny, klient.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PORTWATCH_CHOKEPOINTS,
  PORTWATCH_KEYS,
  PW,
  fetchPortwatch,
  meanOver,
  mergePortwatchRows,
  parsePortwatchFeatures,
  portwatchChokepoint,
  portwatchKeyForTheatre,
  portwatchQueryUrl,
  portwatchSummary,
} from './portwatch.js';

// Skutočné riadky Hormuzu z ArcGIS (zachytené 26. 9. 2026, posledných 10 dní série).
const LIVE_HORMUZ = { features: [
  ['2026-09-11', 8, 3, 0, 3, 81604, 96001], ['2026-09-12', 2, 1, 0, 1, 4771, 84568], ['2026-09-13', 8, 1, 2, 2, 0, 71701],
  ['2026-09-14', 2, 0, 0, 2, 0, 0], ['2026-09-15', 2, 1, 0, 1, 0, 53291], ['2026-09-16', 1, 0, 0, 1, 0, 51573],
  ['2026-09-17', 3, 0, 1, 2, 0, 66754], ['2026-09-18', 7, 2, 0, 4, 6821, 144871], ['2026-09-19', 6, 1, 2, 0, 3149, 30815],
  ['2026-09-20', 1, 0, 0, 1, 0, 48165],
].map(([date, total, tanker, container, dry, capTanker, cap]) => ({ attributes: { date, n_total: total, n_tanker: tanker, n_container: container, n_dry_bulk: dry, n_general_cargo: 0, n_roro: 0, capacity: cap, capacity_tanker: capTanker } })) };

const NOW = Date.UTC(2026, 8, 26, 12);

test('katalóg: štyri úžiny karty, vlastné okno „pred krízou", kľúče a PortWatch id', () => {
  assert.deepEqual(PORTWATCH_KEYS, ['hormuz', 'bab-el-mandeb', 'suez', 'cape']);
  assert.equal(portwatchChokepoint('hormuz').portid, 'chokepoint6');
  assert.equal(portwatchChokepoint('cape').portid, 'chokepoint7', 'Mys dobrej nádeje = obchádzka Červeného mora');
  assert.deepEqual(portwatchChokepoint('hormuz').baseline, { id: 'iran-war', from: '2025-02-28', to: '2026-02-27' });
  for (const k of ['bab-el-mandeb', 'suez', 'cape']) assert.deepEqual(portwatchChokepoint(k).baseline, { id: 'red-sea', from: '2023-01-01', to: '2023-11-15' });
  assert.equal(portwatchChokepoint('nope'), null);
  assert.equal(new Set(PORTWATCH_CHOKEPOINTS.map((c) => c.portid)).size, 4);
});

test('dejisko → zvýraznená úžina', () => {
  assert.equal(portwatchKeyForTheatre('hormuz'), 'hormuz');
  assert.equal(portwatchKeyForTheatre('gulf'), 'hormuz');
  assert.equal(portwatchKeyForTheatre('red-sea'), 'bab-el-mandeb');
  assert.equal(portwatchKeyForTheatre('yemen'), 'bab-el-mandeb');
  assert.equal(portwatchKeyForTheatre('gaza'), null);
  assert.equal(portwatchKeyForTheatre(null), null);
});

test('URL dotazu: úžina, dátumový filter DATE, vzostupne, stránka; zlé vstupy hodia', () => {
  const u = new URL(portwatchQueryUrl('chokepoint6', { fromDay: '2026-08-01', offset: 1000 }));
  assert.equal(u.searchParams.get('where'), "portid='chokepoint6' AND date >= DATE '2026-08-01'");
  assert.equal(u.searchParams.get('orderByFields'), 'date ASC');
  assert.equal(u.searchParams.get('resultOffset'), '1000');
  assert.equal(u.searchParams.get('resultRecordCount'), '1000');
  assert.equal(u.searchParams.get('f'), 'json');
  assert.match(u.searchParams.get('outFields'), /^date,n_total,n_tanker,/);
  assert.equal(new URL(portwatchQueryUrl('chokepoint1')).searchParams.get('where'), "portid='chokepoint1'");
  assert.throws(() => portwatchQueryUrl("chokepoint6' OR 1=1 --"), /bad portid/, 'žiadna injekcia do where');
  assert.throws(() => portwatchQueryUrl('chokepoint6', { fromDay: "2026-01-01' OR 1=1" }), /bad fromDay/);
});

test('parser: kompaktné riadky, zlý deň preč, záporné/chýbajúce = 0, chyba ArcGIS hodí', () => {
  const rows = parsePortwatchFeatures(LIVE_HORMUZ);
  assert.equal(rows.length, 10);
  assert.deepEqual(rows[0], ['2026-09-11', 8, 3, 0, 3, 0, 0, 96001, 81604]);
  assert.equal(rows[9][PW.total], 1);
  const odd = parsePortwatchFeatures({ features: [{ attributes: { date: '2026-13-01', n_total: 5 } }, { attributes: { date: '2026-09-01', n_total: -3, n_tanker: null } }, null] });
  assert.deepEqual(odd, [['2026-09-01', 0, 0, 0, 0, 0, 0, 0, 0]]);
  assert.throws(() => parsePortwatchFeatures({ error: { code: 400, message: 'Invalid query' } }), /PortWatch error 400: Invalid query/);
  assert.throws(() => parsePortwatchFeatures(null), /no features/);
  assert.deepEqual(parsePortwatchFeatures({ features: [] }), []);
});

test('zlúčenie: novšia oprava dňa vyhráva, vzostupné poradie, bez duplicít', () => {
  const merged = mergePortwatchRows([['2026-09-19', 5], ['2026-09-18', 7]], [['2026-09-19', 6], ['2026-09-20', 1]]);
  assert.deepEqual(merged, [['2026-09-18', 7], ['2026-09-19', 6], ['2026-09-20', 1]]);
  assert.deepEqual(mergePortwatchRows(null, [['bad', 1]]), []);
});

test('priemer okna: len prítomné dni, prázdne okno = null', () => {
  const rows = parsePortwatchFeatures(LIVE_HORMUZ);
  const w = meanOver(rows, '2026-09-14', '2026-09-20');
  assert.equal(w.days, 7);
  assert.equal(Math.round(w.mean * 10) / 10, 3.1, 'týždeň 14.–20. 9. = Ø 3,1 lode/deň (overené aj štatistikou ArcGIS)');
  assert.deepEqual(meanOver(rows, '2020-01-01', '2020-12-31'), { mean: null, days: 0 });
  assert.equal(meanOver(rows, '2026-09-14', '2026-09-20', PW.tanker).mean.toFixed(2), '0.57');
});

test('súhrn úžiny: posledný deň, Ø 7 dní, zmena voči oknu pred krízou zo servera, vek a zastaranie, mini séria', () => {
  const rows = parsePortwatchFeatures(LIVE_HORMUZ);
  const s = portwatchSummary(rows, portwatchChokepoint('hormuz'), { nowMs: NOW, baselineMean: 84.8, baselineTankerMean: 47.6, baselineDays: 365 });
  assert.equal(s.lastDay, '2026-09-20');
  assert.equal(s.lastTotal, 1);
  assert.equal(s.days7, 7);
  assert.equal(Math.round(s.avg7 * 10) / 10, 3.1);
  assert.equal(s.pctVsBaseline, -96, 'Ø 3,1 voči 84,8 pred vojnou');
  assert.deepEqual(s.baseline, { id: 'iran-war', from: '2025-02-28', to: '2026-02-27', mean: 84.8, meanTanker: 47.6, days: 365 });
  assert.equal(s.ageDays, 6);
  assert.equal(s.stale, false);
  assert.equal(s.spark.length, 10);
  assert.deepEqual(s.spark.at(-1), { day: '2026-09-20', total: 1 });
  // Bez hodnôt zo servera sa okno počíta z riadkov (tu v nich nie je → null a bez percent).
  const noBase = portwatchSummary(rows, portwatchChokepoint('hormuz'), { nowMs: NOW });
  assert.equal(noBase.baseline.mean, null);
  assert.equal(noBase.pctVsBaseline, null, 'bez priemeru pred krízou žiadne vymyslené percento');
  // Staré dáta = ZASTARANÉ.
  assert.equal(portwatchSummary(rows, portwatchChokepoint('hormuz'), { nowMs: Date.UTC(2026, 9, 10) }).stale, true);
  // Mys dobrej nádeje: nárast = kladné percento.
  const cape = portwatchSummary([['2026-09-20', 90, 16]], portwatchChokepoint('cape'), { nowMs: NOW, baselineMean: 48.9 });
  assert.equal(cape.pctVsBaseline, 84);
});

test('súhrn prázdnej série: nič si nevymýšľa', () => {
  const s = portwatchSummary([], portwatchChokepoint('suez'), { nowMs: NOW });
  assert.equal(s.lastDay, null);
  assert.equal(s.avg7, null);
  assert.equal(s.pctVsBaseline, null);
  assert.deepEqual(s.spark, []);
  assert.equal(s.baseline.id, 'red-sea');
});

test('klient: URL s kľúčmi a dňami, 404 so statusom, 200 bez úžin = porucha', async () => {
  const calls = [];
  const ok = await fetchPortwatch(['hormuz', 'suez'], { fetcher: async (u) => { calls.push(u); return { ok: true, status: 200, json: async () => ({ chokepoints: [] }) }; } });
  assert.deepEqual(ok, { chokepoints: [] });
  assert.equal(calls[0], '/api/mideast/events/portwatch?keys=hormuz%2Csuez&days=400');
  await assert.rejects(fetchPortwatch(['hormuz'], { fetcher: async () => ({ ok: false, status: 404, json: async () => ({ error: 'no_portwatch_snapshot' }) }) }), (e) => e.status === 404 && e.message === 'no_portwatch_snapshot');
  await assert.rejects(fetchPortwatch(['hormuz'], { fetcher: async () => ({ ok: true, status: 200, json: async () => { throw new Error('html'); } }) }), /bad_portwatch_payload/);
});
