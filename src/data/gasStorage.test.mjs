// src/data/gasStorage.test.mjs
// Zásobníky (AGSI+) a LNG (ALSI), 2026-09-13: URL a plán dopytov, normalizácia
// reťazcových čísel, zostava proxy, hodnota spred roka, modely kariet, fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGSI_API, ALSI_API, GAS_LNG_API, GAS_LNG_LATEST_COUNTRIES, GAS_STORAGE_API, GAS_STORAGE_HISTORY_COUNTRIES, GAS_STORAGE_LATEST_COUNTRIES,
  GIE_ATTRIBUTION, GIE_STALE_DAYS, agsiPlan, alsiPlan, buildGiePayload, buildLngModel, buildStorageModel, countryName, fetchGasLng, fetchGasStorage,
  formatGwh, formatPctFull, formatTwh, gieUrl, normalizeAgsiRows, normalizeAlsiRows, num, yearAgoValue,
} from './gasStorage.js';

const NOW = Date.UTC(2026, 8, 13, 10);
const tKey = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);
// Riadky v tvare GIE API (stiahnuté 2026-09-13), čísla ako reťazce.
const agsi = (name, code, day, full, gis, wgv, inj, wd, status = 'C', extra = {}) => ({ name, code, url: code, updatedAt: `${day} 08:20:38`, gasDayStart: day, gasDayEnd: day, gasInStorage: gis, consumption: '3519', consumptionFull: '21.79', injection: inj, withdrawal: wd, netWithdrawal: '-', workingGasVolume: wgv, injectionCapacity: '12247.02', withdrawalCapacity: '20019.67', status, trend: '0.12', full, info: [], ...extra });
const alsi = (name, code, day, inventory, dtmi, sendOut, status = 'E') => ({ name, code, url: code, updatedAt: `${day} 18:50:02`, gasDayStart: day, gasDayEnd: day, inventory: { lng: '4530.71', gwh: inventory }, sendOut, dtmi: { lng: '9321.97', gwh: dtmi }, dtrs: '7940', status, info: [] });

test('num, gieUrl, plány dopytov: EÚ 5 rokov jedným dopytom, SK/UA 400 dní, ostatné posledné dni; ALSI EÚ + krajiny', () => {
  assert.equal(num('766.9528'), 766.9528);
  assert.equal(num('-'), null);
  assert.equal(num(''), null);
  assert.equal(num('12,5'), 12.5);
  assert.equal(gieUrl(AGSI_API, { continent: 'EU', from: '2021-09-01', to: '2026-09-13', size: 2000 }), 'https://agsi.gie.eu/api?continent=EU&from=2021-09-01&to=2026-09-13&size=2000');
  const plan = agsiPlan(NOW);
  assert.equal(plan.length, 1 + GAS_STORAGE_HISTORY_COUNTRIES.length + GAS_STORAGE_LATEST_COUNTRIES.length);
  assert.equal(plan[0].key, 'eu');
  assert.match(plan[0].url, /continent=EU&from=2021-09-\d\d&to=2026-09-13&size=2000/);
  assert.match(plan.find((p) => p.key === 'SK').url, /country=SK&from=2025-08-0\d&to=2026-09-13&size=500/);
  assert.match(plan.find((p) => p.key === 'DE').url, /country=DE&size=3$/);
  const lng = alsiPlan(NOW);
  assert.equal(lng.length, 1 + GAS_LNG_LATEST_COUNTRIES.length);
  assert.match(lng[0].url, new RegExp('^' + ALSI_API.replace(/[.]/g, '\\.') + '\\?continent=EU&from='));
});

test('normalizeAgsiRows: vzostupne, reťazce → čísla, „-" → null, full dopočítané z TWh, čisté vtláčanie, dedupe dňa', () => {
  const rows = normalizeAgsiRows([
    agsi('EU', 'eu', '2026-09-11', '67.78', '766.9528', '1131.5658', '2020.25', '652.4', 'E'),
    agsi('EU', 'eu', '2026-09-10', '67.66', '765.5823', '1131.5658', '2036.83', '-', 'C'),
    agsi('EU', 'eu', '2026-09-09', '-', '764.0', '1131.5658', '1000', '500', 'C'),
    agsi('EU', 'eu', '2026-09-11', '67.79', '766.99', '1131.5658', '2020.25', '652.4', 'C'),
    { gasDayStart: 'zle' },
  ]);
  assert.deepEqual(rows.map((r) => r.date), ['2026-09-09', '2026-09-10', '2026-09-11']);
  assert.equal(rows[2].full, 67.79, 'duplicitný deň: posledný vyhráva');
  assert.equal(rows[2].status, 'C');
  assert.equal(rows[2].net, Math.round((2020.25 - 652.4) * 100) / 100);
  assert.equal(rows[1].withdrawal, null);
  assert.equal(rows[1].net, null, 'bez ťažby sa čistý tok nevymýšľa');
  assert.equal(rows[0].full, Math.round((764 / 1131.5658) * 10000) / 100, 'chýbajúce % sa dopočíta z TWh');
  assert.equal(rows[0].consumptionFull, 21.79);
  assert.equal(rows[0].trend, 0.12);
});

test('normalizeAlsiRows: inventár a maximum v GWh z objektov, % kapacity, vyskladnenie', () => {
  const rows = normalizeAlsiRows([alsi('EU', 'eu', '2026-09-11', '30579.26', '62917.06', '3119'), alsi('EU', 'eu', '2026-09-10', '30400', '62917.06', '3195', 'C')]);
  assert.deepEqual(rows.map((r) => r.date), ['2026-09-10', '2026-09-11']);
  assert.equal(rows[1].inventoryGwh, 30579.26);
  assert.equal(rows[1].dtmiGwh, 62917.06);
  assert.equal(rows[1].fullPct, Math.round((30579.26 / 62917.06) * 1000) / 10);
  assert.equal(rows[1].sendOut, 3119);
  assert.equal(rows[1].status, 'E');
  assert.equal(rows[0].status, 'C');
});

test('buildGiePayload a yearAgoValue: EÚ + krajiny v poradí plánu, chyby po krajinách, hodnota pred rokom ±3 dni', () => {
  const eu = [];
  for (let d = 0; d < 400; d += 1) {
    const day = new Date(NOW - d * 86_400_000).toISOString().slice(0, 10);
    eu.push(agsi('EU', 'eu', day, String(60 + (d % 30) / 10), '700', '1131', '100', '50'));
  }
  const payload = buildGiePayload('agsi', { eu, SK: [agsi('Slovakia', 'SK', '2026-09-11', '52.09', '19.1879', '36.839', '54.71', '34.8')], UA: [] }, { fetchedAt: NOW, errors: { UA: 'upstream HTTP 500' } });
  assert.equal(payload.kind, 'agsi');
  assert.equal(payload.eu.series.length, 400);
  assert.deepEqual(payload.countries.map((c) => c.code), [...GAS_STORAGE_HISTORY_COUNTRIES, ...GAS_STORAGE_LATEST_COUNTRIES]);
  assert.equal(payload.countries[0].series[0].full, 52.09);
  assert.equal(payload.countries[1].error, 'upstream HTTP 500');
  assert.deepEqual(payload.countries[2].series, [], 'krajina bez výsledku má prázdny rad');
  assert.equal(payload.attribution, GIE_ATTRIBUTION);
  const series = payload.eu.series;
  const last = series[series.length - 1];
  assert.equal(yearAgoValue(series, last.date), series.find((r) => r.date === new Date(NOW - 365 * 86_400_000).toISOString().slice(0, 10)).full);
  assert.equal(yearAgoValue(series.slice(-10), last.date), null, 'bez dát spred roka null');
});

test('formáty a názvy krajín', () => {
  assert.equal(formatPctFull(67.78, 'sk'), '67,8 %');
  assert.equal(formatPctFull(null), '—');
  assert.equal(formatTwh(766.95, 'sk'), '767 TWh');
  assert.equal(formatTwh(19.19, 'sk'), '19,2 TWh');
  assert.equal(formatGwh(30579.26, 'en'), '30,579 GWh');
  assert.equal(countryName('eu', 'sk'), 'EÚ');
  assert.equal(countryName('SK', 'sk'), 'Slovensko');
  assert.equal(countryName('UA', 'en'), 'Ukraine');
});

test('buildStorageModel: titulok EÚ (%, TWh, čisté vtláčanie, pred rokom, dni spotreby), rozsah grafu 1R/5R, riadky krajín, čerstvosť', () => {
  const eu = [];
  for (let d = 0; d < 5 * 366; d += 1) {
    const day = new Date(Date.UTC(2026, 8, 11) - d * 86_400_000).toISOString().slice(0, 10);
    eu.push(agsi('EU', 'eu', day, String(50 + (d % 40)), '766.9528', '1131.5658', '2020.25', '652.4', d === 0 ? 'E' : 'C'));
  }
  const payload = buildGiePayload('agsi', {
    eu,
    SK: [agsi('Slovakia', 'SK', '2026-09-11', '52.09', '19.1879', '36.839', '54.71', '34.8'), agsi('Slovakia', 'SK', '2025-09-11', '80.5', '29', '36.8', '10', '5')],
    UA: [agsi('Ukraine', 'UA', '2026-09-11', '34.75', '111.5264', '320.9532', '374.94', '0')],
    AT: [agsi('Austria', 'AT', '2026-09-11', '75.2', '72', '95.8', '100', '300')],
  }, { fetchedAt: NOW, errors: { DE: 'upstream HTTP 429' } });
  const m = buildStorageModel(payload, { lang: 'sk', translate: tKey, nowMs: NOW, range: '1y' });
  assert.equal(m.ok, true);
  assert.equal(m.headline.fullText, '50,0 %');
  assert.equal(m.headline.twhText, 'gas.storage-twh {"a":"767 TWh","b":"1 132 TWh"}');
  assert.equal(m.headline.netText, 'gas.storage-net-in {"v":"1 368 GWh/d"}', 'od 100 GWh/d bez desatiny');
  assert.equal(m.headline.dir, 'up');
  assert.equal(m.headline.yearAgoText, 'gas.storage-year-ago {"v":"55,0 %"}', '365 dní späť = 50 + (365 % 40)');
  assert.equal(m.headline.daysText, 'gas.storage-days {"d":"80"}', '21,79 % ročnej spotreby ≈ 80 dní');
  assert.equal(m.headline.dateText, '11. 9. 2026');
  assert.equal(m.headline.statusText, 'gas.status-estimated');
  assert.equal(m.chart.series[0].key, 'eu-full');
  assert.ok(m.chart.series[0].points.length >= 364 && m.chart.series[0].points.length <= 367, '1R = rok bodov');
  const m5 = buildStorageModel(payload, { lang: 'sk', translate: tKey, nowMs: NOW, range: '5y' });
  assert.ok(m5.chart.series[0].points.length > 1800, '5R = celá história');
  assert.deepEqual(m.rows.map((r) => [r.code, r.level, r.fullText]).slice(0, 4), [['SK', 'ok', '52,1 %'], ['UA', 'ok', '34,8 %'], ['AT', 'ok', '75,2 %'], ['CZ', 'nodata', 'gas.flow-nodata']]);
  assert.equal(m.rows[0].name, 'Slovensko');
  assert.match(m.rows[0].sub, /^gas\.storage-twh .* · gas\.storage-net-in .* · gas\.storage-year-ago \{"v":"80,5 %"\} · 11\. 9\.$/);
  assert.equal(m.rows[1].sub.includes('gas.storage-net-in {"v":"375 GWh/d"}'), true, 'Ukrajina: čisté vtláčanie 375 GWh/d');
  assert.equal(m.rows.find((r) => r.code === 'DE').sub, 'upstream HTTP 429', 'chyba krajiny sa priznáva v riadku');
  assert.equal(m.note, 'gas.storage-note');
  assert.equal(m.sourceLine, 'gas.gie-source');
  assert.equal(m.freshness.ageDays, 2);
  assert.equal(m.freshness.stale, false);
  assert.equal(buildStorageModel(payload, { translate: tKey, nowMs: NOW + (GIE_STALE_DAYS + 1) * 86_400_000 }).freshness.stale, true);
  assert.deepEqual(buildStorageModel(null), { ok: false, reason: 'empty' });
});

test('buildLngModel: vyskladnenie EÚ, nádrže voči maximu, graf roka, riadky krajín s úrovňou', () => {
  const eu = [];
  for (let d = 0; d < 400; d += 1) eu.push(alsi('EU', 'eu', new Date(Date.UTC(2026, 8, 11) - d * 86_400_000).toISOString().slice(0, 10), '30579.26', '62917.06', String(3000 + (d % 7) * 10)));
  const payload = buildGiePayload('alsi', { eu, PL: [alsi('Poland', 'PL', '2026-09-11', '3289.03', '3289.03', '179', 'C')], DE: [alsi('Germany', 'DE', '2026-09-11', '100', '1000', '0.2')] }, { fetchedAt: NOW });
  const m = buildLngModel(payload, { lang: 'sk', translate: tKey, nowMs: NOW });
  assert.equal(m.ok, true);
  assert.equal(m.headline.sendOutText, '3 000 GWh/d');
  assert.equal(m.headline.inventoryText, 'gas.lng-inventory {"v":"30 579 GWh","b":"62 917 GWh","p":"48,6 %"}');
  assert.equal(m.headline.statusText, 'gas.status-estimated');
  assert.equal(m.chart.series[0].key, 'eu-sendout');
  assert.ok(m.chart.series[0].points.length >= 364);
  assert.deepEqual(m.rows.slice(0, 3).map((r) => [r.code, r.level, r.sendOutText]), [['PL', 'ok', '179 GWh/d'], ['DE', 'zero', '0,2 GWh/d'], ['NL', 'nodata', 'gas.flow-nodata']], 'pod 0,5 GWh/d je riadok stlmený, ale hodnota ostáva pravdivá');
  assert.equal(m.rows[0].sub, 'gas.lng-tanks {"p":"100,0 %"} · 11. 9.');
  assert.equal(m.note, 'gas.lng-note');
  assert.deepEqual(buildLngModel({ eu: { series: [] } }), { ok: false, reason: 'empty' });
});

test('fetchGasStorage / fetchGasLng: JSON z proxy; 503 no_key nesie kód pre hlášku o chýbajúcom kľúči', async () => {
  const calls = [];
  const ok = async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ kind: 'agsi' }) }; };
  assert.deepEqual(await fetchGasStorage({ fetcher: ok }), { kind: 'agsi' });
  assert.deepEqual(await fetchGasLng({ fetcher: ok }), { kind: 'agsi' });
  assert.deepEqual(calls, [GAS_STORAGE_API, GAS_LNG_API]);
  await assert.rejects(fetchGasStorage({ fetcher: async () => ({ ok: false, status: 503, json: async () => ({ error: 'no_key' }) }) }), (e) => e.status === 503 && e.code === 'no_key');
});
