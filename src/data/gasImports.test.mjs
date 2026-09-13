// src/data/gasImports.test.mjs
// Dovoz plynu podľa pôvodu (2026-09-13): parser JSON-stat, zoskupenie v proxy
// (mimo EÚ, tranzit zvlášť, LNG vs potrubie), model karty (titulok, podiely
// Ruska a tranzitu vs 2021, vrstvy, legenda, čerstvosť), URL a fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EU27, EUROSTAT_DATASET, GAS_IMPORTS_API, GAS_IMPORT_GROUPS, buildImportsModel, buildImportsPayload, eurostatImportsUrl, fetchGasImports,
  formatBcm, formatMonthLabel, formatSharePct, formatSignedPct, mioM3ToTwh, monthsBetween, parseEurostatJsonStat,
} from './gasImports.js';

import { EUROSTAT_IMPORTS_JSON_STAT as JSON_STAT } from './fixtures/eurostatImportsFixture.mjs';

const tKey = (key, vars) => (vars && Object.keys(vars).length ? `${key} ${JSON.stringify(vars)}` : key);
const NOW = Date.UTC(2026, 8, 13, 10);

test('eurostatImportsUrl: JSON-stat, mesačne, mil. m³, EÚ27 od 2021, obe položky siec', () => {
  const url = eurostatImportsUrl();
  assert.match(url, /^https:\/\/ec\.europa\.eu\/eurostat\/api\/dissemination\/statistics\/1\.0\/data\/nrg_ti_gasm\?/);
  assert.match(url, /format=JSON/);
  assert.match(url, /freq=M/);
  assert.match(url, /unit=MIO_M3/);
  assert.match(url, /geo=EU27_2020/);
  assert.match(url, /sinceTimePeriod=2021-01/);
  assert.ok(!/siec=/.test(url), 'bez filtra siec = plyn spolu aj LNG');
  assert.equal(EUROSTAT_DATASET, 'nrg_ti_gasm');
  assert.equal(EU27.length, 27);
  assert.deepEqual(GAS_IMPORT_GROUPS.map((g) => g.key), ['no', 'ru', 'transit', 'dz', 'az', 'us', 'qa', 'lng-other', 'other']);
});

test('parseEurostatJsonStat: mesiace v poradí, partneri s radmi spolu/LNG, null = chýba; prázdny vstup bez pádu', () => {
  const parsed = parseEurostatJsonStat(JSON_STAT);
  assert.equal(parsed.months.length, 68);
  assert.equal(parsed.months[0], '2021-01');
  assert.equal(parsed.months[65], '2026-06');
  assert.equal(parsed.updated, '2026-09-08T23:00:00+0200');
  assert.equal(parsed.partners.RU.total[0], 7000);
  assert.equal(parsed.partners.RU.total[65], 2500);
  assert.equal(parsed.partners.RU.lng[65], 1400);
  assert.equal(parsed.partners.TOTAL.total[66], null, 'júl 2026 ešte bez hodnoty');
  assert.deepEqual(parseEurostatJsonStat({}), { months: [], updated: null, label: null, partners: {} });
});

test('buildImportsPayload: orezané na posledný mesiac s TOTAL, obchod vnútri EÚ zvlášť, skupiny potrubie/LNG, spolu mimo EÚ', () => {
  const payload = buildImportsPayload(JSON_STAT, { fetchedAt: NOW });
  assert.equal(payload.months.length, 66);
  assert.equal(payload.months[65], '2026-06');
  assert.equal(payload.total[65], 24700, 'spolu mimo EÚ = bez DE');
  assert.equal(payload.intra[65], 2400);
  assert.equal(payload.reported[65], 27100, 'Eurostat TOTAL vrátane vnútri EÚ');
  assert.equal(payload.lng[65], 11000);
  assert.deepEqual(payload.groups.map((g) => g.key), ['no', 'ru', 'transit', 'dz', 'az', 'us', 'qa', 'lng-other', 'other']);
  const g = Object.fromEntries(payload.groups.map((x) => [x.key, x]));
  assert.deepEqual([g.no.pipe[65], g.no.lng[65]], [8000, 0]);
  assert.deepEqual([g.ru.pipe[65], g.ru.lng[65]], [1100, 1400], 'potrubie = spolu − LNG');
  assert.deepEqual([g.ru.pipe[0], g.ru.lng[0]], [5600, 1400]);
  assert.deepEqual([g.transit.pipe[0], g.transit.pipe[65]], [3000, 0], 'Ukrajina 2021 áno, 2026 nie');
  assert.deepEqual([g.dz.pipe[65], g.dz.lng[65]], [2500, 1800], 'Alžírsko + Tunisko');
  assert.deepEqual([g.us.pipe[65], g.us.lng[65]], [0, 4000]);
  assert.deepEqual([g['lng-other'].pipe[65], g['lng-other'].lng[65]], [0, 2300], 'Nigéria + neurčené LNG');
  assert.deepEqual([g.other.pipe[65], g.other.lng[65]], [2100, 0], 'UK + neurčené potrubie');
  assert.deepEqual(g.az.codes, [], 'chýbajúci partner v dátach = prázdna skupina');
  const sum = payload.groups.reduce((n, x) => n + x.pipe[65] + x.lng[65], 0);
  assert.equal(sum, payload.total[65], 'skupiny sa sčítajú na spolu');
  assert.equal(payload.updated, '2026-09-08T23:00:00+0200');
  assert.equal(payload.fetchedAt, NOW);
  assert.match(payload.url, /nrg_ti_gasm/);
  assert.equal(buildImportsPayload({}).months.length, 0);
});

test('formáty: mld m³ / bcm, TWh, podiely, mesiac, vek mesiaca', () => {
  assert.equal(formatBcm(27454, 'sk'), '27,5 mld m³');
  assert.equal(formatBcm(27454, 'en'), '27.5 bcm');
  assert.equal(formatBcm(null), '—');
  assert.ok(Math.abs(mioM3ToTwh(24700) - 260.585) < 1e-9);
  assert.equal(formatSharePct(0.1012, 'sk'), '10 %');
  assert.equal(formatSharePct(0.0932, 'sk'), '9,3 %');
  assert.equal(formatSharePct(0, 'sk'), '0 %');
  assert.equal(formatSharePct(null), '—');
  assert.equal(formatSignedPct(-0.031, 'sk'), '−3,1 %');
  assert.equal(formatSignedPct(0.2, 'en'), '+20.0 %');
  assert.equal(formatMonthLabel('2026-06', 'sk'), 'jún 2026');
  assert.equal(formatMonthLabel('2026-06', 'en'), 'June 2026');
  assert.equal(monthsBetween('2026-06', NOW), 3);
  assert.equal(monthsBetween('2025-11', NOW), 10);
});

test('buildImportsModel: titulok (mld m³, TWh, medziročne), podiel Ruska a tranzitu vs 2021, LNG, vrstvy 2R/MAX, legenda zoradená, čerstvosť', () => {
  const payload = buildImportsPayload(JSON_STAT, { fetchedAt: NOW });
  const model = buildImportsModel(payload, { lang: 'sk', translate: tKey, nowMs: NOW, range: '2y' });
  assert.equal(model.ok, true);
  assert.equal(model.months.length, 24, '2R = 24 mesiacov');
  assert.equal(model.months[0], '2024-07');
  assert.equal(model.headline.totalText, '24,7 mld m³');
  assert.equal(model.headline.twhText, 'gas.imports-twh {"v":"261 TWh"}');
  assert.equal(model.headline.dateText, 'jún 2026');
  assert.equal(model.headline.yoyText, 'gas.imports-yoy {"v":"+0,0 %"}');
  assert.equal(model.headline.dir, 'flat');
  assert.equal(model.headline.ruText, 'gas.imports-ru-share {"pct":"10 %","base":"22 %"}', 'Rusko dnes vs priemer 2021');
  assert.equal(model.headline.transitText, 'gas.imports-transit-share {"pct":"0 %","base":"9,3 %"}');
  assert.equal(model.headline.lngText, 'gas.imports-lng-share {"pct":"45 %"}');
  assert.equal(model.headline.intraText, 'gas.imports-intra {"v":"2,4 mld m³"}');
  assert.ok(Math.abs(model.shares.ru - 2500 / 24700) < 1e-9);
  assert.ok(Math.abs(model.shares.ruBase - 7000 / 32200) < 1e-9);
  assert.deepEqual(model.layers.map((l) => l.key), ['no', 'ru', 'transit', 'dz', 'az', 'us', 'qa', 'lng-other', 'other'], 'vrstvy v poradí skupín (zdola)');
  assert.equal(model.layers[0].label, 'gas.imports-group-no');
  assert.equal(model.layers[0].color, GAS_IMPORT_GROUPS[0].color);
  assert.equal(model.layers[0].values.length, 24);
  assert.equal(model.layers[0].values[23], 8, 'mld m³');
  assert.equal(model.layers[1].values[23], 2.5);
  assert.deepEqual(model.rows.map((r) => r.key), ['no', 'dz', 'us', 'ru', 'lng-other', 'other', 'qa', 'transit', 'az'], 'legenda podľa objemu, nuly na konci');
  const ru = model.rows.find((r) => r.key === 'ru');
  assert.equal(ru.name, 'gas.imports-group-ru');
  assert.equal(ru.valueText, '2,5 mld m³');
  assert.equal(ru.pctText, '10 %');
  assert.equal(ru.sub, 'gas.imports-of-which-lng {"pct":"56 %"} · gas.imports-year-ago {"v":"2,5 mld m³"}');
  assert.equal(ru.level, 'ok');
  assert.equal(ru.color, GAS_IMPORT_GROUPS[1].color);
  const transit = model.rows.find((r) => r.key === 'transit');
  assert.equal(transit.level, 'zero');
  assert.equal(transit.pctText, '0 %');
  assert.equal(model.rows.find((r) => r.key === 'no').sub, 'gas.imports-year-ago {"v":"8,0 mld m³"}', 'bez LNG podielu, keď je skupina čisto potrubná');
  assert.equal(model.note, 'gas.imports-note');
  assert.equal(model.sourceLine, 'gas.imports-source {"date":"8. 9. 2026"}');
  assert.deepEqual(model.freshness, { latestMonth: '2026-06', ageMonths: 3, stale: false });
  const max = buildImportsModel(payload, { lang: 'sk', translate: tKey, nowMs: NOW, range: 'max' });
  assert.equal(max.months.length, 66, 'MAX = od 2021');
  assert.equal(max.layers[2].values[5], 3, 'tranzit v 2021 = 3 mld m³');
  const old = buildImportsModel(payload, { lang: 'sk', translate: tKey, nowMs: Date.UTC(2027, 0, 10), range: '2y' });
  assert.equal(old.freshness.stale, true, 'nad 5 mesiacov bez nového mesiaca = zastarané');
  assert.equal(buildImportsModel({ months: ['2026-06'], total: [1], groups: [] }).ok, false, 'jeden mesiac nestačí');
  assert.equal(buildImportsModel(null).ok, false);
  const en = buildImportsModel(payload, { lang: 'en', translate: tKey, nowMs: NOW });
  assert.equal(en.headline.totalText, '24.7 bcm');
  assert.equal(en.headline.dateText, 'June 2026');
});

test('fetchGasImports: JSON z proxy bez cache; chyba nesie kód', async () => {
  const calls = [];
  const out = await fetchGasImports({ fetcher: async (url, init) => { calls.push([url, init?.cache]); return { ok: true, json: async () => ({ months: ['2026-06'] }) }; } });
  assert.deepEqual(out, { months: ['2026-06'] });
  assert.deepEqual(calls, [[GAS_IMPORTS_API, 'no-store']]);
  await assert.rejects(fetchGasImports({ fetcher: async () => ({ ok: false, status: 502, json: async () => ({ error: 'upstream' }) }) }), (e) => e.status === 502 && e.code === 'upstream' && e.message === 'upstream');
});
