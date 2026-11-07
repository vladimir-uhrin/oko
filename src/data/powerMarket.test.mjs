// src/data/powerMarket.test.mjs
// Karta ELEKTRINA (2026-11-07): URL Energy-Charts v miestnom dni, odpoveď
// proxy (ceny zón, výroba SR, bilancia hraníc), model karty (cena teraz,
// priemer, rozpätie, zajtrajšok, laik ct/kWh, mix, výmena, licencie).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  POWER_MARKET_ZONES, POWER_MIX_GROUPS, borderBalance, buildPowerMarketModel, buildPowerMarketPayload, energyChartsPriceUrl, energyChartsPublicPowerUrl,
  fetchPowerMarket, isOpenLicense, marketDay, shiftDay,
} from './powerMarket.js';

const tKey = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);
// 2026-11-07 05:05 SEČ (04:05 UTC).
const NOW = Date.UTC(2026, 10, 7, 4, 5);
const CC = 'CC BY 4.0 (creativecommons.org/licenses/by/4.0) from Bundesnetzagentur | SMARD.de';
const PRIVATE = 'The data provided herein is for private and internal use only.';

/** 15-min rad dňa v miestnom čase (SEČ = UTC+1 v novembri). */
function priceJson(day, values, license) {
  const start = Date.parse(`${day}T00:00:00+01:00`);
  return {
    unit: 'EUR / MWh', license, interval_minutes: 15, series: [{ id: 'day_ahead_price' }],
    data: values.map((v, i) => ({ timestamp: new Date(start + i * 15 * 60_000).toISOString().replace('.000Z', 'Z'), values: { day_ahead_price: v } })),
  };
}
const flat = (n, v) => Array.from({ length: n }, (_, i) => (typeof v === 'function' ? v(i) : v));

test('miestny deň a posun kalendára; URL dnes+zajtra pre ceny, včera+dnes pre výrobu', () => {
  assert.equal(marketDay(Date.UTC(2026, 10, 6, 23, 30)), '2026-11-07', '00:30 SEČ je už 7. 11.');
  assert.equal(shiftDay('2026-11-07', 1), '2026-11-08');
  assert.equal(shiftDay('2026-03-29', -1), '2026-03-28', 'prechod času nemení kalendár');
  assert.equal(energyChartsPriceUrl('DE-LU', NOW), 'https://api.energy-charts.info/v2/price?bzn=DE-LU&start=2026-11-07&end=2026-11-08');
  assert.equal(energyChartsPublicPowerUrl('sk', NOW), 'https://api.energy-charts.info/v2/public_power?country=sk&start=2026-11-06&end=2026-11-07');
  assert.deepEqual(POWER_MARKET_ZONES.map((z) => z.bzn), ['SK', 'CZ', 'HU', 'AT', 'PL', 'DE-LU']);
  assert.ok(isOpenLicense(CC));
  assert.ok(!isOpenLicense(PRIVATE));
});

test('bilancia hraníc SR: tok DO Slovenska kladný, poradie podľa suseda', () => {
  const flows = { pairs: {
    'HU-SK': { a: 'HU', b: 'SK', latestGw: -1.612, latestAt: '2026-11-06T19:00:00.000Z' },
    'CZ-SK': { a: 'CZ', b: 'SK', latestGw: 1.759, latestAt: '2026-11-06T18:45:00.000Z' },
    'SK-UA': { a: 'SK', b: 'UA', latestGw: 0.444, latestAt: '2026-11-06T18:45:00.000Z' },
    'PL-SK': { a: 'PL', b: 'SK', latestGw: null, latestAt: null },
    'AT-DE': { a: 'AT', b: 'DE', latestGw: 0.1, latestAt: null },
  } };
  assert.deepEqual(borderBalance(flows), [
    { iso: 'CZ', gw: 1.759, at: '2026-11-06T18:45:00.000Z' },
    { iso: 'HU', gw: -1.612, at: '2026-11-06T19:00:00.000Z' },
    { iso: 'PL', gw: null, at: null },
    { iso: 'UA', gw: -0.444, at: '2026-11-06T18:45:00.000Z' },
  ]);
  assert.deepEqual(borderBalance(null), []);
});

function payload({ withTomorrow = false, mixRows = null } = {}) {
  const skValues = flat(96, (i) => (i <= 20 ? 200 : 260)); // 00:00–05:15 lacnejšie
  const sk = priceJson('2026-11-07', withTomorrow ? [...skValues, ...flat(96, 150)] : skValues, PRIVATE);
  return buildPowerMarketPayload({
    prices: [
      { bzn: 'SK', json: sk },
      { bzn: 'CZ', json: priceJson('2026-11-07', flat(96, 231.84), CC) },
      { bzn: 'HU', json: null, error: 'HTTP 429' },
      { bzn: 'AT', json: priceJson('2026-11-07', flat(96, 231.84), CC) },
      { bzn: 'PL', json: priceJson('2026-11-07', flat(96, 180), PRIVATE) },
      { bzn: 'DE-LU', json: priceJson('2026-11-07', flat(96, 231.84), CC) },
    ],
    mix: { json: {
      unit: 'MW', interval_minutes: 60, license: 'CC BY 4.0 (creativecommons.org/licenses/by/4.0), attribution: energy-charts.info',
      series: ['nuclear', 'hydro_run_of_river', 'fossil_gas', 'fossil_oil', 'biomass', 'solar', 'wind_onshore', 'others', 'load', 'renewable_share_of_load', 'cross_border_electricity_trading', 'hydro_pumped_storage_consumption'].map((id) => ({ id })),
      data: mixRows || [
        { timestamp: '2026-11-07T01:00:00+01:00', values: { nuclear: 1960, hydro_run_of_river: 90, fossil_gas: 500, fossil_oil: 50, biomass: 105, solar: 0.1, wind_onshore: 1.6, others: 134, load: 2711, renewable_share_of_load: 9.2, cross_border_electricity_trading: -170.6, hydro_pumped_storage_consumption: -21 } },
        { timestamp: '2026-11-07T02:00:00+01:00', values: { nuclear: 1957.5, hydro_run_of_river: 91.8, fossil_gas: 483.8, fossil_oil: 50.3, biomass: 105.3, solar: 0.1, wind_onshore: 1.6, others: 134, load: 2711, renewable_share_of_load: 9.2, cross_border_electricity_trading: -170.6, hydro_pumped_storage_consumption: null } },
        { timestamp: '2026-11-07T03:00:00+01:00', values: { nuclear: null, load: null } },
      ],
    } },
    flows: { fetchedAt: NOW - 600_000, pairs: { 'HU-SK': { a: 'HU', b: 'SK', latestGw: -1.612, latestAt: '2026-11-07T01:00:00.000Z' }, 'CZ-SK': { a: 'CZ', b: 'SK', latestGw: 1.2, latestAt: '2026-11-07T01:00:00.000Z' } } },
  }, { fetchedAt: NOW });
}

test('payload: zóny v poradí, chybná zóna s error, licencie z odpovede, výroba bez prázdnych riadkov, hranice SR', () => {
  const p = payload();
  assert.deepEqual(p.zones.map((z) => [z.bzn, z.points.length, z.error]), [['SK', 96, null], ['CZ', 96, null], ['HU', 0, 'HTTP 429'], ['AT', 96, null], ['PL', 96, null], ['DE-LU', 96, null]]);
  assert.equal(p.zones[0].license, PRIVATE);
  assert.equal(p.mix.rows.length, 2, 'riadok bez hodnôt (03:00) vypadne');
  assert.equal(p.mix.intervalMinutes, 60);
  assert.match(p.mix.license, /CC BY 4\.0/);
  assert.deepEqual(p.borders.map((b) => [b.iso, b.gw]), [['CZ', 1.2], ['HU', -1.612]]);
  assert.match(p.citation, /Energy-Charts/);
});

test('model: cena SR teraz (interval 05:00–05:15), priemer, rozpätie, laik ct/kWh, smer voči priemeru; zajtrajšok až po aukcii', () => {
  const m = buildPowerMarketModel(payload(), { lang: 'sk', translate: tKey, nowMs: NOW, regionName: (iso) => ({ CZ: 'Česko', HU: 'Maďarsko', AT: 'Rakúsko', PL: 'Poľsko', DE: 'Nemecko' })[iso] });
  assert.equal(m.ok, true);
  assert.equal(m.headline.text, '200,00 €/MWh', '05:05 je ešte v lacnejšej prvej päťhodinovke');
  assert.equal(m.headline.intervalText, '05:00 – 05:15'.replace(/ /g, ''));
  assert.match(m.headline.avgText, /power\.market-avg .*246,88 €\/MWh/);
  assert.match(m.headline.rangeText, /200,00 €\/MWh.*260,00 €\/MWh/);
  assert.equal(m.headline.tomorrowText, 'power.market-tomorrow-pending');
  assert.equal(m.headline.laicText, 'power.market-laic {"ct":"20"}');
  assert.equal(m.headline.dir, 'down');
  assert.deepEqual(m.zones.map((z) => [z.key, z.name, z.nowText, z.open, z.level]), [
    ['CZ', 'Česko', '231,84 €/MWh', true, 'ok'],
    ['HU', 'Maďarsko', '—', false, 'nodata'],
    ['AT', 'Rakúsko', '231,84 €/MWh', true, 'ok'],
    ['PL', 'Poľsko', '180,00 €/MWh', false, 'ok'],
    ['DE-LU', 'Nemecko · LU', '231,84 €/MWh', true, 'ok'],
  ]);
  assert.deepEqual(m.chart.series.map((s) => [s.key, s.points.length]), [['sk-today', 96]]);
  assert.equal(m.licenseText, 'power.market-license {"zones":"SK, PL"}', 'zóny s licenciou len na súkromné použitie sa menujú');
  assert.equal(m.freshness.stale, false);
});

test('model: zajtrajšie ceny po aukcii pribudnú do hlavičky aj grafu', () => {
  const m = buildPowerMarketModel(payload({ withTomorrow: true }), { lang: 'sk', translate: tKey, nowMs: NOW });
  assert.match(m.headline.tomorrowText, /power\.market-tomorrow .*150,00 €\/MWh/);
  assert.deepEqual(m.chart.series.map((s) => [s.key, s.points.length]), [['sk-today', 96], ['sk-tomorrow', 96]]);
});

test('model: výroba SR (posledný úplný riadok), skupiny zoradené, OZE a vývoz; výmena so susedmi', () => {
  const m = buildPowerMarketModel(payload(), { lang: 'sk', translate: tKey, nowMs: NOW, regionName: (iso) => iso });
  assert.equal(m.mix.timeText, '7. 11. 02:00');
  assert.deepEqual(m.mix.rows.map((r) => r.key), ['nuclear', 'gas', 'other', 'bio', 'hydro', 'oil', 'wind'], 'slnko 0,1 MW pod prahom; zoradené podľa výkonu');
  assert.equal(m.mix.rows[0].valueText, '1,96 GW');
  assert.equal(m.mix.rows[0].color, POWER_MIX_GROUPS.find((g) => g.key === 'nuclear').color);
  assert.match(m.mix.totalText, /power\.mix-total .*2,82 GW/);
  assert.match(m.mix.loadText, /2,71 GW/);
  assert.match(m.mix.renewText, /9,2 %/);
  assert.match(m.mix.tradeText, /power\.mix-export .*171 MW/);
  assert.equal(m.mix.stale, false);
  assert.match(m.exchange.netText, /power\.exchange-net-export .*412 MW/, '1,2 dovoz z CZ − 1,612 vývoz do HU');
  assert.deepEqual(m.exchange.rows.map((r) => [r.iso, r.routeText, r.text]), [['CZ', 'CZ → SK', '1,2 GW'], ['HU', 'SK → HU', '1,61 GW']]);
});

test('model: bez cien SR nič, bez výroby a tokov len ceny; staré ceny = zastarané', () => {
  assert.deepEqual(buildPowerMarketModel(null), { ok: false });
  assert.deepEqual(buildPowerMarketModel({ zones: [{ bzn: 'SK', points: [] }] }), { ok: false });
  const p = payload();
  p.mix.rows = [];
  p.borders = [];
  const m = buildPowerMarketModel(p, { translate: tKey, nowMs: NOW });
  assert.equal(m.mix, null);
  assert.equal(m.exchange, null);
  const late = buildPowerMarketModel(payload(), { translate: tKey, nowMs: NOW + 2 * 86_400_000 });
  assert.equal(late.freshness.stale, true);
});

test('fetchPowerMarket: JSON z proxy, chyba ako výnimka', async () => {
  assert.deepEqual(await fetchPowerMarket({ fetcher: async () => ({ ok: true, json: async () => ({ zones: [] }) }) }), { zones: [] });
  await assert.rejects(fetchPowerMarket({ fetcher: async () => ({ ok: false, status: 503 }) }), /HTTP 503/);
});
