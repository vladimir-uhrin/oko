// src/data/mideastInternet.test.mjs — INTERNET · OONI (BLÍZKY VÝCHOD etapa 6, 2026-11-06): agregácia po
// dňoch zo skutočnej odpovede pre Irán, zlúčenie s archívom, podiel blokovaných s prahom meraní, ukazovateľ
// 7 d proti 30 d so stupňami (zhoršenie / zlepšenie / bez zmeny / ticho = možný výpadok).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INTERNET_THEATRES, OONI_COUNTRIES, OONI_MIN_MEASUREMENTS, blockedShare, fetchMideastInternet, internetCountriesForTheatre, internetIndicator, mergeOoniDays,
  ooniAggregationUrl, parseOoniAggregation,
} from './mideastInternet.js';
import { OONI_IR_AGGREGATION } from './fixtures/mideastStage6Fixtures.mjs';

const NOW = Date.parse('2026-11-06T12:00:00Z');
const day = (d, ok, anomaly = 0, confirmed = 0, failure = 0) => ({ day: d, ok, anomaly, confirmed, failure, total: ok + anomaly + confirmed + failure });

test('URL agregácie a rozbor skutočnej odpovede: dni zoradené, počty celé čísla, nečitateľné riadky preč', () => {
  assert.equal(ooniAggregationUrl('IR', '2026-10-01', '2026-11-07'), 'https://api.ooni.io/api/v1/aggregation?probe_cc=IR&test_name=web_connectivity&since=2026-10-01&until=2026-11-07&axis_x=measurement_start_day&time_grain=day');
  const rows = parseOoniAggregation(OONI_IR_AGGREGATION);
  assert.equal(rows.length, 46);
  assert.deepEqual(rows[0], { day: '2026-09-22', ok: 14194, anomaly: 2651, confirmed: 7830, failure: 658, total: 25333 });
  assert.equal(rows.at(-1).day, '2026-11-06');
  assert.ok(rows.every((r, i) => i === 0 || r.day > rows[i - 1].day));
  assert.throws(() => parseOoniAggregation({}), /result missing/);
  assert.deepEqual(parseOoniAggregation({ result: [{ measurement_start_day: 'x' }, { measurement_start_day: '2026-01-02T00:00:00Z', ok_count: '3.7', anomaly_count: -1 }] }), [{ day: '2026-01-02', ok: 3, anomaly: 0, confirmed: 0, failure: 0, total: 3 }]);
});

test('zlúčenie: nové dni vyhrávajú (OONI dopĺňa spätne), poradie, orez na keepDays', () => {
  const merged = mergeOoniDays([day('2026-01-01', 10), day('2026-01-02', 10)], [day('2026-01-02', 99), day('2026-01-03', 5)]);
  assert.deepEqual(merged.map((r) => [r.day, r.ok]), [['2026-01-01', 10], ['2026-01-02', 99], ['2026-01-03', 5]]);
  assert.deepEqual(mergeOoniDays(merged, [], { keepDays: 2 }).map((r) => r.day), ['2026-01-02', '2026-01-03']);
  assert.deepEqual(mergeOoniDays(null, [{ day: 'bad' }]), []);
});

test('podiel blokovaných: (anomálie + potvrdené) zo všetkých bez zlyhaní; pod prahom meraní null', () => {
  assert.equal(blockedShare(day('d', 60, 20, 20, 500)), 40, 'zlyhania sa nerátajú');
  assert.equal(blockedShare(day('d', 10, 10)), null, `pod ${OONI_MIN_MEASUREMENTS}`);
  assert.equal(blockedShare(day('d', 97, 1, 2)), 3);
  assert.equal(blockedShare(day('d', 1000, 1)), 0.1, 'na desatinu');
});

test('ukazovateľ: Irán zo skutočných dát = bez zmeny; syntetické zhoršenie, zlepšenie, ticho a bez dát', () => {
  const ir = internetIndicator(parseOoniAggregation(OONI_IR_AGGREGATION), NOW);
  assert.equal(ir.recent, 41.3);
  assert.equal(ir.baseline, 44.7);
  assert.equal(ir.delta, -3.4);
  assert.equal(ir.level, 'same');
  assert.equal(ir.days, 7);
  assert.equal(ir.lastDay, '2026-11-06');
  assert.equal(ir.measurements, 129025);
  assert.equal(ir.sparkline.length, 37, '30 + 7 dní');
  assert.ok(ir.sparkline.every((d) => d.day >= '2026-10-01' && d.day <= '2026-11-06'));
  const rows = [];
  for (let i = 36; i >= 0; i -= 1) { const d = new Date(NOW - i * 86_400_000).toISOString().slice(0, 10); rows.push(i < 7 ? day(d, 50, 50) : day(d, 90, 10)); }
  const worse = internetIndicator(rows, NOW);
  assert.deepEqual([worse.recent, worse.baseline, worse.delta, worse.level], [50, 10, 40, 'worse']);
  const better = internetIndicator(rows.map((r) => (r.day >= '2026-10-31' ? day(r.day, 100, 0) : day(r.day, 70, 30))), NOW);
  assert.equal(better.level, 'better');
  const quiet = internetIndicator(rows.map((r) => (r.day >= '2026-10-31' ? day(r.day, 3, 1) : r)), NOW);
  assert.equal(quiet.level, 'quiet', 'posledných 7 dní pod prahom meraní = možný výpadok');
  assert.equal(quiet.recent, null);
  assert.equal(internetIndicator([], NOW).level, 'none');
  assert.equal(internetIndicator(rows.filter((r) => r.day >= '2026-10-31'), NOW).level, 'same', 'bez základne len „bez zmeny"');
});

test('krajiny dejísk: prehľad všetky, Irán len IR, Gaza/Západný breh/Izrael IL, úžiny nič', () => {
  assert.deepEqual([...OONI_COUNTRIES], ['IR', 'IQ', 'YE', 'LB', 'SY', 'IL']);
  assert.deepEqual([...internetCountriesForTheatre('overview')], [...OONI_COUNTRIES]);
  assert.deepEqual(internetCountriesForTheatre('iran'), ['IR']);
  assert.deepEqual(internetCountriesForTheatre('south-lebanon'), ['LB', 'IL']);
  assert.equal(internetCountriesForTheatre('hormuz'), null);
  for (const list of Object.values(INTERNET_THEATRES)) for (const cc of list) assert.ok(OONI_COUNTRIES.includes(cc), cc);
});

test('klient: trasa /internet, 404 nesie stav, chybný tvar je chyba', async () => {
  const calls = [];
  await fetchMideastInternet({ fetcher: async (url) => { calls.push(url); return new Response(JSON.stringify({ countries: {} }), { status: 200 }); } });
  assert.deepEqual(calls, ['/api/mideast/events/internet']);
  await assert.rejects(fetchMideastInternet({ fetcher: async () => new Response(JSON.stringify({ error: 'no_internet_snapshot' }), { status: 404 }) }), (e) => e.status === 404);
  await assert.rejects(fetchMideastInternet({ fetcher: async () => new Response('{}', { status: 200 }) }), /bad_internet_payload/);
});
