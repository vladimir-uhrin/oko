// src/data/gasPrices.test.mjs
// Ceny plynu (2026-09-13): ACER CSV → denné riadky + odvodený TTF, FRED CSV →
// mesačný rad v €/MWh, výrezy, zmena, formáty, model karty, fetch cez proxy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACER_HISTORICAL_URL, FRED_EU_GAS_SERIES, GAS_PRICES_API, GAS_PRICES_STALE_DAYS, MWH_PER_MMBTU,
  buildPricesModel, dateToMs, fetchGasPrices, formatCtKwh, formatDateLabel, formatEurMwh, formatPct, fredCsvUrl,
  latestWithChange, monthlyAverage, monthlyEurPerMwh, parseAcerCsv, parseCsvLine, parseFredCsv, sliceByRange,
} from './gasPrices.js';

// Vzorka stiahnutá 2026-09-13 z ACER TERMINAL (historical_data), skrátená.
const ACER_CSV = [
  '"DATE","NORTH-WEST EUROPE PRICE (EUR/MWh)","SOUTH EUROPE PRICE (EUR/MWh)","EU PRICE (EUR/MWh)","LNG BENCHMARK (EUR/MWh)"',
  '"2026-09-11","75.475","78.047","77.150","-2.370"',
  '"2026-09-10","73.549","73.932","73.180","-8.867"',
  '"2026-09-09","72.291","72.625","72.140","-"',
  '"2026-09-08","71.037","71.437","71.115","-4.726"',
  '"2026-08-01","60.000","61.000","60.500","-1.000"',
  '"nezmysel","x","y","z","w"',
].join('\r\n');
const FRED_GAS = 'observation_date,PNGASEUUSDM\n1992-01-01,2.5\n2026-07-01,12.0\n2026-08-01,.\n2026-09-01,13.2\n';
const FRED_FX = 'observation_date,DEXUSEU\n2026-07-01,1.0\n2026-07-02,1.2\n2026-09-01,1.1\n2026-09-02,.\n';
const NOW = Date.UTC(2026, 8, 13, 10, 0, 0);
const tKey = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);

test('parseCsvLine: úvodzovky, čiarky v poli, zdvojené úvodzovky, orezanie', () => {
  assert.deepEqual(parseCsvLine('"a","b, c","d ""e"""'), ['a', 'b, c', 'd "e"']);
  assert.deepEqual(parseCsvLine(' x ,y,'), ['x', 'y', '']);
});

test('parseAcerCsv: stĺpce podľa názvu, vzostupne, ttf = eu − benchmark, chýbajúci benchmark → ttf null, smetie preč', () => {
  const rows = parseAcerCsv(ACER_CSV);
  assert.deepEqual(rows.map((r) => r.date), ['2026-08-01', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']);
  const last = rows[rows.length - 1];
  assert.deepEqual(last, { date: '2026-09-11', nwe: 75.475, south: 78.047, eu: 77.15, benchmark: -2.37, ttf: 79.52 }, 'benchmark je rozdiel LNG − TTF, takže TTF = LNG − benchmark');
  assert.equal(rows[2].ttf, null, 'bez benchmarku sa TTF nevymýšľa');
  assert.deepEqual(parseAcerCsv(''), []);
  assert.deepEqual(parseAcerCsv('"DATE","X"\n"2026-01-01","1"'), [], 'bez EU PRICE stĺpca nič');
});

test('parseFredCsv a monthlyEurPerMwh: bodka = chýba, mesačný priemer kurzu, USD/MMBtu → €/MWh', () => {
  const gas = parseFredCsv(FRED_GAS);
  assert.deepEqual(gas.map((r) => r.date), ['1992-01-01', '2026-07-01', '2026-09-01']);
  const fx = parseFredCsv(FRED_FX);
  assert.equal(monthlyAverage(fx).get('2026-07'), 1.1, 'priemer 1,0 a 1,2');
  const monthly = monthlyEurPerMwh(gas, fx);
  assert.deepEqual(monthly.map((r) => r.month), ['1992-01', '2026-07', '2026-09']);
  assert.equal(monthly[0].eurMwh, null, 'bez kurzu pre mesiac null');
  assert.equal(monthly[1].eurMwh, Math.round((12 / MWH_PER_MMBTU / 1.1) * 100) / 100);
  assert.ok(Math.abs(monthly[1].eurMwh - 37.22) < 0.01, '12 USD/MMBtu pri 1,10 USD/EUR ≈ 37,22 €/MWh');
  assert.equal(monthly[2].eurMwh, Math.round((13.2 / MWH_PER_MMBTU / 1.1) * 100) / 100);
  assert.equal(fredCsvUrl(FRED_EU_GAS_SERIES), 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=PNGASEUUSDM');
});

test('sliceByRange, dateToMs a latestWithChange', () => {
  const rows = parseAcerCsv(ACER_CSV);
  assert.equal(sliceByRange(rows, '1m', NOW).length, 4, '31 dní: august vypadne');
  assert.equal(sliceByRange(rows, '1y', NOW).length, 5);
  assert.equal(sliceByRange(rows, 'max', NOW).length, 5);
  assert.equal(dateToMs('2026-09'), Date.UTC(2026, 8, 1));
  assert.ok(Number.isNaN(dateToMs('')));
  const ttf = latestWithChange(rows, 'ttf');
  assert.equal(ttf.row.date, '2026-09-11');
  assert.equal(ttf.prev.date, '2026-09-10', 'deň bez benchmarku sa preskočí');
  assert.equal(ttf.delta, Math.round((79.52 - 82.047) * 1000) / 1000);
  assert.equal(ttf.pct, Math.round(((79.52 - 82.047) / 82.047) * 1000) / 10);
  assert.equal(latestWithChange([{ date: 'x', ttf: 1 }], 'ttf').prev, null);
  assert.equal(latestWithChange([], 'ttf'), null);
});

test('formáty: €/MWh, ct/kWh, percentá so znamienkom, dátumy SK/EN', () => {
  assert.equal(formatEurMwh(79.52, 'sk'), '79,5 €/MWh');
  assert.equal(formatEurMwh(79.52, 'en'), '79.5 €/MWh');
  assert.equal(formatEurMwh(null), '—');
  assert.equal(formatCtKwh(79.52, 'sk'), '7,95 ct/kWh', '€/MWh delené 10 = ct/kWh');
  assert.equal(formatPct(3.08, 'sk'), '+3,1 %');
  assert.equal(formatPct(-3.08, 'en'), '−3.1 %');
  assert.equal(formatPct(0), '0,0 %');
  assert.equal(formatPct(null), '—');
  assert.equal(formatDateLabel('2026-09-11', 'sk'), '11. 9. 2026');
  assert.equal(formatDateLabel('2026-09-11', 'sk', { year: false }), '11. 9.');
  assert.equal(formatDateLabel('2026-09-11', 'en'), '11 Sep 2026');
  assert.equal(formatDateLabel('2026-09', 'sk'), '9/2026');
  assert.equal(formatDateLabel('2026-09', 'en'), 'Sep 2026');
});

test('buildPricesModel: titulok = odvodený TTF so zmenou, riadky LNG, rady podľa rozsahu, čerstvosť, vysvetlivky', () => {
  const payload = { acer: { rows: parseAcerCsv(ACER_CSV) }, monthly: { rows: monthlyEurPerMwh(parseFredCsv(FRED_GAS), parseFredCsv(FRED_FX)) }, fetchedAt: NOW };
  const m = buildPricesModel(payload, { range: '1m', nowMs: NOW, lang: 'sk', translate: tKey });
  assert.equal(m.ok, true);
  assert.equal(m.headline.key, 'ttf');
  assert.equal(m.headline.text, '79,5 €/MWh');
  assert.equal(m.headline.dir, 'down');
  assert.equal(m.headline.label, 'gas.ttf-derived');
  assert.equal(m.headline.dateText, '11. 9. 2026');
  assert.deepEqual(m.rows.map((r) => [r.key, r.text]), [['eu', '77,2 €/MWh'], ['nwe', '75,5 €/MWh'], ['south', '78,0 €/MWh']]);
  assert.deepEqual(m.chart.series.map((s) => [s.key, s.points.length]), [['ttf', 3], ['eu', 4]], '1M: TTF bez dňa bez benchmarku, LNG všetky 4 dni');
  assert.equal(m.chart.series[0].points[2].t, Date.UTC(2026, 8, 11));
  assert.equal(m.freshness.ageDays, 2);
  assert.equal(m.freshness.stale, false);
  assert.equal(m.laic, 'gas.per-kwh {"ct":"7,95 ct/kWh"}');
  assert.equal(m.note, 'gas.ttf-derived-note');
  assert.deepEqual(m.sourceLines, ['gas.source-acer {"date":"11. 9. 2026"}']);

  const mx = buildPricesModel(payload, { range: 'max', nowMs: NOW, lang: 'en', translate: tKey });
  assert.deepEqual(mx.chart.series.map((s) => [s.key, s.points.length]), [['monthly', 2], ['ttf', 4]], 'MAX: mesačný rad (len mesiace s kurzom) + celý denný TTF');
  assert.equal(mx.chart.series[0].points[0].t, Date.UTC(2026, 6, 1));
  assert.deepEqual(mx.sourceLines, ['gas.source-acer {"date":"11 Sep 2026"}', 'gas.source-monthly']);

  const old = buildPricesModel(payload, { range: '1m', nowMs: NOW + (GAS_PRICES_STALE_DAYS + 1) * 86_400_000, translate: tKey });
  assert.equal(old.freshness.stale, true, 'po viac než 5 dňoch bez nového dňa je rad zastaraný');

  const noBench = buildPricesModel({ acer: { rows: parseAcerCsv(ACER_CSV).map((r) => ({ ...r, ttf: null, benchmark: null })) } }, { nowMs: NOW, translate: tKey });
  assert.equal(noBench.headline.key, 'eu', 'bez benchmarku sa v titulku ukáže cena LNG, nie vymyslený TTF');
  assert.deepEqual(buildPricesModel(null), { ok: false, reason: 'empty' });
  assert.deepEqual(buildPricesModel({ acer: { rows: [] }, monthly: { rows: [] } }), { ok: false, reason: 'empty' });
});

test('fetchGasPrices: JSON z proxy; chyba proxy = výnimka so statusom a vysvetlením', async () => {
  const calls = [];
  const okFetch = async (url, init) => { calls.push([url, init]); return { ok: true, status: 200, json: async () => ({ acer: { rows: [] } }) }; };
  assert.deepEqual(await fetchGasPrices({ fetcher: okFetch }), { acer: { rows: [] } });
  assert.equal(calls[0][0], GAS_PRICES_API);
  assert.equal(calls[0][1].cache, 'no-store');
  await assert.rejects(
    fetchGasPrices({ fetcher: async () => ({ ok: false, status: 502, json: async () => ({ error: 'upstream' }) }) }),
    (err) => err.status === 502 && err.message === 'upstream',
  );
  assert.equal(ACER_HISTORICAL_URL, 'https://aegis.acer.europa.eu/terminal/price_assessments/historical_data');
});
