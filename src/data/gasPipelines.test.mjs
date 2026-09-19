// src/data/gasPipelines.test.mjs
// Plynovody (2026-09-13): parser geojsonl, štýl podľa priemeru a stavu, texty
// karty, stred úseku, popis zdroja, fetch snímku z proxy (404 = bez snímku).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GAS_PIPELINES_API, GAS_PIPELINES_META_API, GAS_PIPELINE_ATTRIBUTION, GAS_PIPELINE_COLORS, OIL_PIPELINE_COLORS,
  fetchGasPipelines, parsePipelinesGeojsonl, pipelineDetails, pipelineDetailsRows, pipelineDisplayName, pipelineKind, pipelineLocationText, pipelineMidpoint,
  pipelineOperator, pipelineRoute, pipelineSourceLabel, pipelineStatus, pipelineStyle, pipelineTitle,
} from './gasPipelines.js';

const tKey = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);
const feature = (id, props, coords) => JSON.stringify({ type: 'Feature', id, properties: props, geometry: { type: 'LineString', coordinates: coords } });
const TEXT = [
  feature('osm-way-1', { name: 'Transgas', operator: 'eustream', diameterMm: 1400, lengthKm: 120.4, status: 'operating', osm: 1 }, [[17, 48], [18, 48.5], [19, 48.7]]),
  feature('osm-way-2', { name: null, nameEn: 'Urengoy – Pomary – Uzhhorod', diameterMm: 1420, lengthKm: 4.2, status: 'planned', osm: 2 }, [[35, 51], [35.1, 51.1]]),
  'nezmysel',
  JSON.stringify({ type: 'Feature', id: 'bod', properties: {}, geometry: { type: 'Point', coordinates: [1, 2] } }),
  feature('osm-way-3', { ref: 'DN300', diameterMm: 300, lengthKm: 0.8, status: 'disused', osm: 3 }, [[20, 49], [20.1, 49]]),
  '',
].join('\n');

test('parsePipelinesGeojsonl: LineStringy s ≥ 2 bodmi, smetie a body preč', () => {
  const f = parsePipelinesGeojsonl(TEXT);
  assert.deepEqual(f.map((x) => x.id), ['osm-way-1', 'osm-way-2', 'osm-way-3']);
  assert.deepEqual(parsePipelinesGeojsonl(''), []);
});

test('pipelineStatus a pipelineStyle: hrúbka podľa DN, plánované čiarkované, odstavené stlmené', () => {
  assert.equal(pipelineStatus({}), 'operating');
  assert.equal(pipelineStatus({ status: 'planned' }), 'planned');
  assert.equal(pipelineStatus({ status: 'nezmysel' }), 'operating');
  // 2026-09-19 (etapa 2): pribudlo `kind` a odstavené sa zdvihlo z alfa 0,40 na
  // 0,45 — pri 0,40 malo nad nočným oceánom kontrast 1,55, teda na hranici
  // neviditeľnosti.
  assert.deepEqual(pipelineStyle({ diameterMm: 1400 }), { width: 2.8, alpha: 0.85, dashed: false, color: GAS_PIPELINE_COLORS.operating, kind: 'gas', status: 'operating' });
  assert.deepEqual(pipelineStyle({ diameterMm: 700, status: 'planned' }), { width: 2.0, alpha: 0.7, dashed: true, color: GAS_PIPELINE_COLORS.planned, kind: 'gas', status: 'planned' });
  assert.deepEqual(pipelineStyle({ status: 'disused' }), { width: 1.4, alpha: 0.45, dashed: false, color: GAS_PIPELINE_COLORS.disused, kind: 'gas', status: 'disused' });
});

test('pipelineKind a ropná paleta: látka z tagu substance, neznáme = plyn', () => {
  assert.equal(pipelineKind({ substance: 'oil' }), 'oil');
  assert.equal(pipelineKind({ substance: 'crude_oil' }), 'oil');
  assert.equal(pipelineKind({ substance: 'petroleum' }), 'oil');
  assert.equal(pipelineKind({ substance: 'gas' }), 'gas');
  // substance=fuel sú rafinované produkty a do ropnej vrstvy sa vôbec
  // nesťahujú; keby sa tam niekedy dostali, NESMÚ vyzerať ako ropa.
  assert.equal(pipelineKind({ substance: 'fuel' }), 'gas');
  assert.equal(pipelineKind({}), 'gas', 'neznáme = plyn, plynový snímok má substance vždy');

  // Šírka znamená priemer rovnako pri oboch látkach — používateľ sa nemá učiť
  // dve protirečivé pravidlá.
  const oil = pipelineStyle({ substance: 'oil', diameterMm: 1400 });
  assert.equal(oil.kind, 'oil');
  assert.equal(oil.color, OIL_PIPELINE_COLORS.operating);
  assert.equal(oil.width, 2.8);
  assert.notEqual(OIL_PIPELINE_COLORS.operating, GAS_PIPELINE_COLORS.operating, 'ropa a plyn nesmú mať tú istú farbu');
});

test('pipelineTitle a pipelineDetails: meno → name:en → ref → bez mena; riadky karty s DN, km, stavom a OSM id', () => {
  const f = parsePipelinesGeojsonl(TEXT);
  assert.equal(pipelineTitle(f[0].properties, tKey), 'Transgas');
  assert.equal(pipelineTitle(f[1].properties, tKey), 'Urengoy – Pomary – Uzhhorod');
  assert.equal(pipelineTitle(f[2].properties, tKey), 'DN300');
  assert.equal(pipelineTitle({}, tKey), 'gas.pipeline-unnamed');
  assert.equal(pipelineTitle({ substance: 'oil' }, tKey), 'gas.pipeline-unnamed-oil');
  // 2026-09-19 (etapa 2): látka je PRVÝ riadok karty, a to pri OBOCH vrstvách.
  // Bez nej dá pomenovaný ropovod a pomenovaný plynovod textovo nerozlíšiteľnú
  // kartu a jediným rozdielom ostane farba — čo pri červeno-zelenej
  // farbosleposti nestačí. Keby hlavičku mala len ropa, používateľ by sa naučil
  // „karta bez hlavičky = plyn". Tieto fixtúry nemajú substance, takže riadok
  // substance= v nich chýba.
  assert.deepEqual(pipelineDetails(f[0].properties, tKey, 'sk'), [
    'gas.pipeline-kind-gas',
    'eustream',
    'gas.pipeline-diameter {"mm":"1 400"} · gas.pipeline-length {"km":"120"}',
    'gas.pipeline-status-operating',
    'OSM way 1',
  ]);
  assert.deepEqual(pipelineDetails(f[1].properties, tKey, 'en'), ['gas.pipeline-kind-gas', 'gas.pipeline-diameter {"mm":"1,420"} · gas.pipeline-length {"km":"4.2"}', 'gas.pipeline-status-planned', 'OSM way 2']);
  assert.deepEqual(pipelineDetails({}, tKey), ['gas.pipeline-kind-gas', 'gas.pipeline-status-operating']);
  // S tagom substance pribudne surový dôkaz z OSM — vidno PREČO je úsek ropa,
  // a že substance=fuel (rafinované produkty) sme z ropnej vrstvy vylúčili.
  assert.deepEqual(pipelineDetails({ substance: 'oil', osm: 9 }, tKey), [
    'gas.pipeline-kind-oil',
    'substance=oil (OSM)',
    'gas.pipeline-status-operating',
    'OSM way 9',
  ]);
});

test('pipelineRoute a riadky karty s trasou, kapacitou a tlakom z OSM (etapa 3)', () => {
  assert.equal(pipelineRoute({}), null);
  assert.equal(pipelineRoute({ from: 'Lubmin', to: 'Rehden' }), 'Lubmin → Rehden');
  assert.equal(pipelineRoute({ from: 'Yamal' }), 'Yamal → ?', 'polovičná trasa nesmie vyzerať ako celá');
  assert.equal(pipelineRoute({ to: ' Rehden ' }), '? → Rehden');
  assert.equal(pipelineRoute({ from: 'Уренгойское месторождение', to: 'Ужгород' }), 'Urengoyskoe mestorozhdenie → Uzhgorod', 'konce trasy v latinke (3b)');
  // Trasa je v detailoch hneď za prevádzkovateľom.
  assert.deepEqual(pipelineDetails({ operator: 'GASCADE', from: 'Lubmin', to: 'Olbernhau', osm: 5 }, tKey), [
    'gas.pipeline-kind-gas', 'GASCADE', 'gas.pipeline-route: Lubmin → Olbernhau', 'gas.pipeline-status-operating', 'OSM way 5',
  ]);
  // Riadky [popis, hodnota] pre hover kartu: len to, čo úsek naozaj má.
  assert.deepEqual(pipelineDetailsRows({ substance: 'oil', operator: 'MERO', diameterMm: 700, lengthKm: 12.3, from: 'Lobau', to: 'St. Valentin', capacity: '10 Mt/a', pressure: '60 bar', status: 'operating', osm: 9 }, tKey, 'en'), [
    ['gas.pipeline-operator', 'MERO'],
    ['gas.pipeline-diameter-label', 'gas.pipeline-diameter {"mm":"700"}'],
    ['gas.pipeline-segment', 'gas.pipeline-length {"km":"12"}'],
    ['gas.pipeline-route', 'Lobau → St. Valentin'],
    ['gas.pipeline-capacity', '10 Mt/a'],
    ['gas.pipeline-pressure', '60 bar'],
    ['gas.pipeline-status-label', 'gas.pipeline-status-operating'],
  ]);
  assert.deepEqual(pipelineDetailsRows({}, tKey), [['gas.pipeline-status-label', 'gas.pipeline-status-operating']]);
  // Holé číslo v `pressure` je podľa OSM wiki v baroch — jednotka sa dopíše; text ostáva.
  assert.deepEqual(pipelineDetailsRows({ pressure: '95' }, tKey)[0], ['gas.pipeline-pressure', '95 bar']);
  assert.deepEqual(pipelineDetailsRows({ pressure: '7.5' }, tKey)[0], ['gas.pipeline-pressure', '7.5 bar']);
  assert.deepEqual(pipelineDetailsRows({ pressure: '100 psi' }, tKey)[0], ['gas.pipeline-pressure', '100 psi']);
});

test('etapa 3b — mená v latinke, prevádzkovateľ, krajiny a uloženie', () => {
  assert.deepEqual(pipelineDisplayName({ name: 'Уренгой — Помары — Ужгород' }), { text: 'Urengoy — Pomary — Uzhgorod', original: 'Уренгой — Помары — Ужгород' });
  assert.deepEqual(pipelineDisplayName({ name: 'Уренгой — Помари — Ужгород', nameLang: 'uk' }), { text: 'Urenhoy — Pomary — Uzhhorod', original: 'Уренгой — Помари — Ужгород' }, 'jazyk zo snímku');
  assert.deepEqual(pipelineDisplayName({ name: 'Сила Сибири', nameEn: 'Power of Siberia' }), { text: 'Power of Siberia', original: 'Сила Сибири' }, 'name:en má prednosť pred prepisom');
  assert.deepEqual(pipelineDisplayName({ name: 'Družba', nameSk: 'Družba' }), { text: 'Družba', original: null }, 'rovnaké meno nie je originál');
  assert.deepEqual(pipelineDisplayName({ name: '西气东输' }), { text: '西气东输', original: null }, 'čínština bez name:en ostáva');
  assert.deepEqual(pipelineDisplayName({ ref: 'DN300' }), { text: 'DN300', original: null });
  assert.equal(pipelineTitle({ name: 'Дружба' }, tKey), 'Druzhba');
  assert.deepEqual(pipelineOperator({ operator: 'ООО «Газпром трансгаз Югорск»' }), { text: 'OOO «Gazprom transgaz Yugorsk»', original: 'ООО «Газпром трансгаз Югорск»' });
  assert.deepEqual(pipelineOperator({}), { text: '', original: null });
  assert.equal(pipelineLocationText({ location: 'underground' }, tKey), 'gas.pipeline-location-underground');
  assert.equal(pipelineLocationText({ location: 'in a tunnel' }, tKey), 'in a tunnel', 'neznáma hodnota doslovne');
  assert.equal(pipelineLocationText({}, tKey), '');
  // Klik-karta: krajiny menami v jazyku UI, prevádzkovateľ v latinke, uloženie.
  assert.deepEqual(pipelineDetails({ operator: 'Транснефть', countries: ['RU', 'BY'], location: 'underground', osm: 3 }, tKey, 'sk', { regionName: (iso) => ({ RU: 'Rusko', BY: 'Bielorusko' })[iso] }), [
    'gas.pipeline-kind-gas', 'Transneft', 'gas.pipeline-countries: Rusko · Bielorusko', 'gas.pipeline-location: gas.pipeline-location-underground', 'gas.pipeline-status-operating', 'OSM way 3',
  ]);
  assert.deepEqual(pipelineDetails({ countries: ['XX'] }, tKey), ['gas.pipeline-kind-gas', 'gas.pipeline-countries: XX', 'gas.pipeline-status-operating'], 'bez prekladu ostane kód');
  assert.deepEqual(pipelineDetailsRows({ operator: 'Транснефть', location: 'overhead' }, tKey), [['gas.pipeline-operator', 'Transneft'], ['gas.pipeline-location', 'gas.pipeline-location-overhead'], ['gas.pipeline-status-label', 'gas.pipeline-status-operating']]);
});

test('pipelineMidpoint a pipelineSourceLabel', () => {
  assert.deepEqual(pipelineMidpoint([[17, 48], [18, 48.5], [19, 48.7]]), { lon: 18, lat: 48.5 });
  assert.equal(pipelineMidpoint([[1, 2]]), null);
  assert.equal(pipelineSourceLabel(null, tKey), GAS_PIPELINE_ATTRIBUTION);
  assert.equal(pipelineSourceLabel({ snapshot: '2026-09-13T20:00:00Z', lengthKm: 123456.7 }, tKey, 'sk'), `${GAS_PIPELINE_ATTRIBUTION} · gas.pipeline-snapshot {"date":"2026-09-13"} · 123 457 km`);
});

test('fetchGasPipelines: meta prvé (bez cache), snímok pod URL verziovanou dátumom snímku; 404 no_snapshot nesie kód', async () => {
  const calls = [];
  const fetcher = async (url, init) => { calls.push([url, init?.cache ?? null]); return url.endsWith('/meta') ? { ok: true, json: async () => ({ snapshot: '2026-09-13T20:00:00Z', features: 3 }) } : { ok: true, text: async () => TEXT }; };
  const out = await fetchGasPipelines({ fetcher });
  assert.equal(out.features.length, 3);
  assert.equal(out.meta.features, 3);
  assert.deepEqual(calls, [[GAS_PIPELINES_META_API, 'no-store'], [`${GAS_PIPELINES_API}?v=2026-09-13T20%3A00%3A00Z`, null]]);
  await assert.rejects(fetchGasPipelines({ fetcher: async () => ({ ok: false, status: 404, json: async () => ({ error: 'no_snapshot' }) }) }), (e) => e.status === 404 && e.code === 'no_snapshot');
  const noMeta = await fetchGasPipelines({ fetcher: async (url) => (url.endsWith('/meta') ? { ok: false, status: 404, json: async () => ({}) } : { ok: true, text: async () => TEXT }) });
  assert.equal(noMeta.meta, null, 'chýbajúce meta nie je chyba');
});
