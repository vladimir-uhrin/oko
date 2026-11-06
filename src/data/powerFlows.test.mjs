// src/data/powerFlows.test.mjs
// Toky elektriny cez hranice (ELEKTRINA, 2026-11-06): katalóg Energy-Charts,
// URL, zostavenie odpovede proxy (znamienka, obe strany hranice), riadky karty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  POWER_FLOW_COUNTRIES, POWER_FLOW_SERIES_ISO, buildPowerFlowsPayload, energyChartsCbpfUrl, fetchPowerFlows, formatGw, powerFlowPairId, powerFlowPairIds, powerFlowRows,
} from './powerFlows.js';

const tKey = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);

// Tvar odpovede /v2/cbpf overený naostro 2026-11-06 (country=sk).
const sk = {
  country: 'sk', interval_minutes: 15, unit: 'GW', license: 'CC BY 4.0 (creativecommons.org/licenses/by/4.0), attribution: energy-charts.info',
  series: [{ id: 'czech_republic' }, { id: 'hungary' }, { id: 'poland' }, { id: 'ukraine' }, { id: 'sum' }, { id: 'atlantis' }],
  data: [
    { timestamp: '2026-11-06T19:45:00+01:00', values: { czech_republic: 0.5, hungary: -1.6, poland: 0.6, ukraine: null, sum: -0.5 } },
    { timestamp: '2026-11-06T20:00:00+01:00', values: { czech_republic: 0.4, hungary: -1.612, poland: 0.613, ukraine: null, sum: -0.6 } },
  ],
};
const hu = {
  country: 'hu', interval_minutes: 15,
  series: [{ id: 'slovakia' }, { id: 'austria' }],
  data: [{ timestamp: '2026-11-06T19:45:00+01:00', values: { slovakia: 1.5, austria: 0.2 } }],
};

test('katalóg: krajiny API a rady susedov; UK = GB', () => {
  assert.equal(POWER_FLOW_COUNTRIES.SK, 'sk');
  assert.equal(POWER_FLOW_COUNTRIES.GB, 'uk');
  assert.ok(!('EU' in POWER_FLOW_COUNTRIES));
  assert.ok(!('CY' in POWER_FLOW_COUNTRIES), 'Cyprus: cbpf 404, nemá cezhraničné vedenia');
  assert.equal(POWER_FLOW_SERIES_ISO.bosnia_herzegovina, 'BA', 'id radu tak, ako ho API naozaj posiela');
  assert.equal(POWER_FLOW_SERIES_ISO.czech_republic, 'CZ');
  assert.equal(POWER_FLOW_SERIES_ISO.northern_ireland, 'GB');
  const url = energyChartsCbpfUrl('sk', Date.UTC(2026, 10, 6, 20));
  assert.match(url, /^https:\/\/api\.energy-charts\.info\/v2\/cbpf\?country=sk&start=\d+&end=\d+$/);
  const [, start, end] = url.match(/start=(\d+)&end=(\d+)/);
  assert.equal(Number(end) - Number(start), 36 * 3600);
});

test('pairId: abecedne, ISO2, nie sama so sebou', () => {
  assert.equal(powerFlowPairId('SK', 'HU'), 'HU-SK');
  assert.equal(powerFlowPairId('hu', 'sk'), 'HU-SK');
  assert.equal(powerFlowPairId('SK', 'SK'), null);
  assert.equal(powerFlowPairId('SK', 'zásobník'), null);
  assert.deepEqual(powerFlowPairIds({ countries: ['SK', 'HU', 'SK', 'AT'] }), ['HU-SK', 'AT-SK']);
  assert.deepEqual(powerFlowPairIds({ countries: ['SK'] }), []);
  assert.deepEqual(powerFlowPairIds({}), []);
});

test('payload: znamienko = tok A → B, posledná známa hodnota, novšia strana vyhrá, chyby a neznáme rady', () => {
  const p = buildPowerFlowsPayload([{ iso: 'SK', json: sk }, { iso: 'HU', json: hu }, { iso: 'PL', json: null, error: 'HTTP 429' }], { fetchedAt: 1 });
  // SK ← CZ dovoz 0,4 GW → tok CZ → SK kladný.
  assert.equal(p.pairs['CZ-SK'].latestGw, 0.4);
  // SK vyváža 1,612 GW do HU: zo SK strany (novší interval 20:00) HU-SK = tok HU → SK = −1,612.
  assert.equal(p.pairs['HU-SK'].latestGw, -1.612);
  assert.equal(p.pairs['HU-SK'].via, 'SK', 'novší interval zo slovenskej strany');
  // Rad bez hodnôt (UA) — dvojica existuje, posledná známa nie je.
  assert.equal(p.pairs['SK-UA'].latestGw, null);
  // HU dováža 0,2 GW z AT → tok AT → HU kladný.
  assert.equal(p.pairs['AT-HU'].latestGw, 0.2);
  assert.deepEqual(p.countries, ['HU', 'SK']);
  assert.deepEqual(p.errors, { PL: 'HTTP 429' });
  assert.deepEqual(p.unknownSeries, ['atlantis']);
  assert.equal(p.intervalMinutes, 15);
  assert.match(p.license, /CC BY 4\.0/);
  assert.match(p.citation, /Energy-Charts/);
  assert.equal(p.pairs['CZ-SK'].series.length, 2);
});

test('riadky karty: smer podľa znamienka, GW/MW, vlajky, sparkline bez znamienka, chýbajúce dáta', () => {
  const p = buildPowerFlowsPayload([{ iso: 'SK', json: sk }], { fetchedAt: 1 });
  const { rows, citation } = powerFlowRows(p, ['HU-SK', 'CZ-SK', 'SK-UA', 'DE-FR'], { lang: 'sk', translate: tKey });
  assert.equal(rows.length, 3, 'dvojica bez dát v payloade sa vynechá');
  const [hu, cz, ua] = rows;
  assert.equal(hu.route, 'SK → HU', 'záporné HU → SK = vývoz zo SK');
  assert.equal(hu.fromIso, 'SK');
  assert.equal(hu.toIso, 'HU');
  assert.equal(hu.text, '1,61 GW');
  assert.equal(hu.level, 'flow');
  assert.deepEqual(hu.spark, [1.6, 1.612]);
  assert.equal(cz.route, 'CZ → SK');
  assert.equal(cz.text, '400 MW');
  assert.equal(ua.level, 'nodata');
  assert.equal(ua.text, 'gas.flow-nodata');
  assert.match(citation, /CC BY 4\.0/);
  assert.equal(formatGw(0, 'sk'), '0 MW');
  assert.equal(formatGw(null), '');
  assert.deepEqual(powerFlowRows(null, ['HU-SK']).rows, []);
});

test('fetchPowerFlows: JSON z proxy, chyba ako výnimka', async () => {
  assert.deepEqual(await fetchPowerFlows({ fetcher: async () => ({ ok: true, json: async () => ({ pairs: {} }) }) }), { pairs: {} });
  await assert.rejects(fetchPowerFlows({ fetcher: async () => ({ ok: false, status: 502 }) }), /HTTP 502/);
});

test('Retry-After a neúplný posledný interval (2026-11-06 naostro: 429 s Retry-After, CZ 1,759 → 0)', async () => {
  const { retryAfterMs, dropTrailingPlaceholderZeros, POWER_FLOW_REQUEST_GAP_MS, POWER_FLOW_MAX_ATTEMPTS } = await import('./powerFlows.js');
  assert.equal(retryAfterMs('16'), 16_500);
  assert.equal(retryAfterMs('0'), 1_000);
  assert.equal(retryAfterMs('600'), 60_000, 'strop');
  assert.equal(retryAfterMs(null), 20_500);
  assert.equal(retryAfterMs('Fri, 06 Nov 2026 21:00:10 GMT', Date.parse('Fri, 06 Nov 2026 21:00:00 GMT')), 10_500);
  assert.ok(POWER_FLOW_REQUEST_GAP_MS >= 6_000 && POWER_FLOW_MAX_ATTEMPTS >= 3);
  const pts = (arr) => arr.map((gw, t) => ({ t, gw }));
  assert.deepEqual(dropTrailingPlaceholderZeros(pts([1.749, 1.759, 0])).map((p) => p.gw), [1.749, 1.759, null]);
  assert.deepEqual(dropTrailingPlaceholderZeros(pts([-0.444, 0, 0])).map((p) => p.gw), [-0.444, null, null]);
  assert.deepEqual(dropTrailingPlaceholderZeros(pts([0, 0, 0])).map((p) => p.gw), [0, 0, 0], 'zavretá hranica ostáva nulou');
  assert.deepEqual(dropTrailingPlaceholderZeros(pts([0.01, 0])).map((p) => p.gw), [0.01, 0], 'malý tok pod 50 MW môže naozaj klesnúť na nulu');
  assert.deepEqual(dropTrailingPlaceholderZeros(pts([1.2, null])).map((p) => p.gw), [1.2, null]);
  // V payloade: posledná ZNÁMA hodnota je tá pred neúplným intervalom.
  const json = { series: [{ id: 'czech_republic' }], data: [{ timestamp: '2026-11-06T19:45:00+01:00', values: { czech_republic: 1.759 } }, { timestamp: '2026-11-06T20:00:00+01:00', values: { czech_republic: 0 } }] };
  const p = buildPowerFlowsPayload([{ iso: 'SK', json }]);
  assert.equal(p.pairs['CZ-SK'].latestGw, 1.759);
  assert.equal(p.pairs['CZ-SK'].latestAt, '2026-11-06T18:45:00.000Z');
});
