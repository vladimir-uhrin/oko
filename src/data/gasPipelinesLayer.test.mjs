// src/data/gasPipelinesLayer.test.mjs
// Vrstva „Plynovody“ (2026-09-13): lenivé načítanie snímku, entity podľa stavu,
// klik = zvýraznenie + karta, znova/prázdno zbalí, disable/destroy upracú,
// chýbajúci snímok sa prizná; register, kredit, i18n.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GAS_PIPELINES_LAYER_ID, GAS_PIPELINES_OVERLAY_SOURCE_ID, createGasPipelinesLayer, pipelineCard } from './gasPipelinesLayer.js';
import { GAS_PIPELINE_COLORS, OIL_PIPELINE_COLORS } from './gasPipelines.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';
import { LAYER_STATE_REGISTRY } from './layerState.js';
import { DATA_CREDITS } from './dataCredits.js';

const NOW = Date.UTC(2026, 8, 13, 10);
const tKey = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);
const feature = (id, props, coords) => JSON.stringify({ type: 'Feature', id, properties: props, geometry: { type: 'LineString', coordinates: coords } });
const TEXT = [
  feature('osm-way-1', { name: 'Transgas', operator: 'eustream', diameterMm: 1400, lengthKm: 120.4, status: 'operating', osm: 1 }, [[17, 48], [18, 48.5], [19, 48.7]]),
  feature('osm-way-2', { nameEn: 'Nord Stream 2', diameterMm: 1153, lengthKm: 1230, status: 'planned', osm: 2 }, [[13.6, 54.1], [20, 55.5]]),
  feature('osm-way-3', { ref: 'DN300', diameterMm: 300, lengthKm: 0.8, status: 'disused', osm: 3 }, [[20, 49], [20.1, 49]]),
].join('\n');
const META = { snapshot: '2026-09-13T20:00:00Z', features: 3, lengthKm: 1351.2 };

function fakeDataSource(id) {
  const values = [];
  return { id, show: true, entities: { values, add(e) { values.push(e); return e; }, removeAll() { values.length = 0; } } };
}
function fakeHandler() { return { fn: null, destroyed: false, setInputAction(fn) { this.fn = fn; }, destroy() { this.destroyed = true; } }; }
function fakeHost() {
  return {
    entries: null, visible: null, cleared: 0, hit: null,
    setEntries(src, entries, options) { this.src = src; this.entries = entries; this.options = options; },
    setVisible(src, v) { this.visible = v; },
    clearSource() { this.cleared += 1; this.entries = null; },
    hitTest() { return this.hit; },
  };
}
function fakeViewer(pick = { value: null }) {
  return {
    dataSources: { added: [], removed: [], add(ds) { this.added.push(ds); }, remove(ds) { this.removed.push(ds); } },
    scene: { canvas: {}, pick: () => pick.value, requestRender() {} },
    selectedEntity: undefined,
  };
}
// Ropa (etapa 2) sa ťahá z vlastnej trasy /api/oil/pipelines. Tento stub ju
// nemá, takže testy nižšie zároveň overujú to dôležité: keď ropný snímok
// chýba (404 no_snapshot, build ešte nebežal), plyn sa MUSÍ nakresliť aj tak.
const noOil = { ok: false, status: 404, json: async () => ({ error: 'no_snapshot' }) };
const fetcherOk = async (url) => {
  if (String(url).includes('/api/oil/')) return noOil;
  return url.endsWith('/meta') ? { ok: true, json: async () => META } : { ok: true, text: async () => TEXT };
};

test('pipelineCard: vybraná karta s menom, riadkami a zdrojom v päte', () => {
  const card = pipelineCard({ id: 'osm-way-1', properties: { name: 'Transgas', operator: 'eustream', diameterMm: 1400, lengthKm: 120.4, osm: 1 } }, { x: 1, y: 2, z: 3 }, tKey, 'sk', { source: 'zdroj X' });
  assert.equal(card.id, 'gas-pipelines:osm-way-1');
  assert.equal(card.variant, 'selected');
  assert.equal(card.protected, true);
  assert.equal(card.title, 'Transgas');
  assert.deepEqual(card.details, ['gas.pipeline-kind-gas', 'eustream', 'gas.pipeline-diameter {"mm":"1 400"} · gas.pipeline-length {"km":"120"}', 'gas.pipeline-status-operating', 'OSM way 1', 'zdroj X']);
  assert.equal(card.interactive, true);
});

test('lifecycle: lenivé načítanie pri enable, entity podľa stavu (čiarkované plánované, stlmené odstavené), klik vyberie a zvýrazní, karta v overlay, klik znova/prázdno zbalí, disable a destroy', async () => {
  const pick = { value: null };
  const handlers = [];
  const host = fakeHost();
  const layer = createGasPipelinesLayer({ fetchImpl: fetcherOk, dataSourceFactory: fakeDataSource, handlerFactory: () => { const h = fakeHandler(); handlers.push(h); return h; }, overlayHost: host, translate: tKey, lang: () => 'sk', now: () => NOW });
  assert.equal(layer.id, GAS_PIPELINES_LAYER_ID);
  const viewer = fakeViewer(pick);
  layer.init(viewer);
  assert.equal(viewer.dataSources.added[0].show, false);
  layer.enable();
  assert.equal(handlers.length, 1);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  const st = layer._getStateForTest();
  assert.equal(st.loaded, true);
  assert.equal(st.count, 3);
  assert.deepEqual(st.counts, { operating: 1, planned: 1, disused: 1 });
  assert.deepEqual(st.kinds, { gas: 3, oil: 0 }, 'ropný snímok chýbal (404), plyn sa nakreslil aj tak');
  assert.equal(st.oilMeta, null);
  assert.equal(st.lengthKm, 1351);
  assert.equal(st.meta.features, 3);
  const ds = viewer.dataSources.added[0];
  const [transgas, ns2, dn300] = ds.entities.values;
  assert.equal(transgas.polyline.width, 2.8);
  assert.equal(transgas.polyline.clampToGround, true);
  assert.equal(transgas.__gasPipeline, 'osm-way-1');
  assert.equal(ns2.polyline.material.constructor.name, 'PolylineDashMaterialProperty', 'plánované sú čiarkované');
  assert.equal(dn300.polyline.material.color.getValue().alpha.toFixed(2), '0.45', 'odstavené sú stlmené');
  assert.equal(layer.getStats().count, 3);
  assert.equal(layer.getStats().source, '© OpenStreetMap contributors · ODbL · gas.pipeline-snapshot {"date":"2026-09-13"} · 1 351 km');
  assert.equal(layer.source, layer.getStats().source);
  assert.equal(layer.hasContact('gas-pipelines:osm-way-1'), true);
  // klik na čiaru
  pick.value = { id: transgas };
  handlers[0].fn({ position: { x: 1, y: 1 } });
  assert.equal(layer._getStateForTest().selected, 'osm-way-1');
  assert.equal(transgas.polyline.width, 4.8, 'zvýraznenie = širšia biela čiara');
  assert.equal(transgas.polyline.material.color.getValue().withAlpha(1).toCssHexString().toLowerCase(), GAS_PIPELINE_COLORS.selected);
  assert.equal(viewer.selectedEntity, transgas);
  assert.equal(host.src, GAS_PIPELINES_OVERLAY_SOURCE_ID);
  assert.equal(host.entries.length, 1);
  assert.equal(host.entries[0].title, 'Transgas');
  assert.equal(host.entries[0].variant, 'selected');
  assert.match(host.entries[0].details[host.entries[0].details.length - 1], /OpenStreetMap contributors/);
  assert.equal(host.visible, true);
  // druhý klik na tú istú čiaru zbalí a vráti štýl
  handlers[0].fn({ position: { x: 1, y: 1 } });
  assert.equal(layer._getStateForTest().selected, null);
  assert.equal(transgas.polyline.width, 2.8);
  // klik na kartu zbalí; cudzí objekt nechá; prázdno zbalí
  pick.value = { id: ns2 };
  handlers[0].fn({ position: { x: 1, y: 1 } });
  assert.equal(layer._getStateForTest().selected, 'osm-way-2');
  host.hit = { entryId: 'gas-pipelines:osm-way-2' };
  handlers[0].fn({ position: { x: 2, y: 2 } });
  assert.equal(layer._getStateForTest().selected, null);
  host.hit = null;
  pick.value = { id: dn300 };
  handlers[0].fn({ position: { x: 1, y: 1 } });
  pick.value = { id: { cudzi: true } };
  handlers[0].fn({ position: { x: 1, y: 1 } });
  assert.equal(layer._getStateForTest().selected, 'osm-way-3', 'cudzí objekt nechá výber');
  pick.value = null;
  handlers[0].fn({ position: { x: 1, y: 1 } });
  assert.equal(layer._getStateForTest().selected, null);
  assert.equal(await layer.update(), true, 'po načítaní je update lacný no-op');
  assert.equal(ds.entities.values.length, 3, 'žiadne zdvojenie');
  layer.disable();
  assert.equal(handlers[0].destroyed, true);
  assert.equal(host.visible, false);
  assert.equal(ds.show, false);
  layer.destroy(viewer);
  assert.equal(viewer.dataSources.removed.length, 1);
  assert.equal(layer._getStateForTest().entities, null);
});

test('ropa: vlastný snímok z /api/oil, počty na látku, zlúčený popis zdroja, ropná karta', async () => {
  const OIL_TEXT = [
    feature('osm-way-77', { name: 'Družba', substance: 'oil', diameterMm: 1220, lengthKm: 300, status: 'operating', osm: 77 }, [[22, 48.5], [19, 48.6]]),
    feature('osm-way-78', { substance: 'crude_oil', diameterMm: 700, lengthKm: 40, status: 'operating', osm: 78 }, [[54, 27], [56, 26]]),
  ].join('\n');
  const OIL_META = { snapshot: '2026-09-19T06:00:00Z', features: 2, lengthKm: 340 };
  const urls = [];
  const fetcher = async (url) => {
    const path = String(url).split('?')[0];
    urls.push(path);
    const oil = path.startsWith('/api/oil/');
    if (path.endsWith('/meta')) return { ok: true, json: async () => (oil ? OIL_META : META) };
    return { ok: true, text: async () => (oil ? OIL_TEXT : TEXT) };
  };
  const pick = { value: null };
  const handlers = [];
  const host = fakeHost();
  const layer = createGasPipelinesLayer({ fetchImpl: fetcher, dataSourceFactory: fakeDataSource, handlerFactory: () => { const h = fakeHandler(); handlers.push(h); return h; }, overlayHost: host, translate: tKey, lang: () => 'sk', now: () => NOW });
  const viewer = fakeViewer(pick);
  layer.init(viewer);
  layer.enable();
  assert.equal(await layer.update(), true);
  // Plyn sa ťahá PRVÝ a ropa až po ňom — zlyhanie ropy tak nikdy nezablokuje plyn.
  assert.deepEqual(urls, ['/api/gas/pipelines/meta', '/api/gas/pipelines', '/api/oil/pipelines/meta', '/api/oil/pipelines']);
  const st = layer._getStateForTest();
  assert.equal(st.count, 5);
  assert.deepEqual(st.kinds, { gas: 3, oil: 2 });
  assert.equal(st.oilMeta.features, 2);
  assert.equal(st.entities, 5);
  // Chip hlási SÚČET oboch snímkov (1351,2 + 340 km) a ten STARŠÍ z dvoch
  // dátumov — inak by tvrdil menej kilometrov, než je nakreslených, a čerstvosť
  // ropy by vydával za čerstvosť plynu.
  const source = layer.getStats().source;
  assert.match(source, /OpenStreetMap contributors/);
  assert.match(source, /"date":"2026-09-13"/, 'dátum je ten STARŠÍ z dvoch snímkov');
  // Pozor na medzery: oddeľovač tisícov je U+00A0 a pred „km“ je U+202F,
  // takže doslovné porovnanie reťazca tu vyzerá správne a pritom padá.
  const flat = (x) => x.replace(/\s/g, ' ');
  assert.ok(flat(source).endsWith(flat(new Intl.NumberFormat('sk-SK').format(1691)) + ' km'), source);
  assert.deepEqual(layer.getStats().kinds, { gas: 3, oil: 2 });
  const ds = viewer.dataSources.added[0];
  const druzba = ds.entities.values.find((e) => e.id === 'gas-pipelines:osm-way-77');
  const bezMena = ds.entities.values.find((e) => e.id === 'gas-pipelines:osm-way-78');
  assert.equal(druzba.properties.kind, 'oil');
  assert.equal(druzba.polyline.material.color.getValue().withAlpha(1).toCssHexString().toLowerCase(), OIL_PIPELINE_COLORS.operating);
  assert.equal(druzba.polyline.width, 2.8, 'DN 1220 = chrbtica, šírka znamená priemer rovnako ako pri plyne');
  assert.equal(ds.entities.values.find((e) => e.id === 'gas-pipelines:osm-way-1').polyline.material.color.getValue().withAlpha(1).toCssHexString().toLowerCase(), GAS_PIPELINE_COLORS.operating, 'plyn si drží svoju farbu');
  // Karta ropovodu: látka slovom v prvom riadku + surový tag z OSM. Farba je
  // druhý kanál, nie jediný.
  pick.value = { id: druzba };
  handlers[0].fn({ position: { x: 1, y: 1 } });
  assert.equal(host.entries[0].title, 'Družba');
  assert.equal(host.entries[0].details[0], 'gas.pipeline-kind-oil');
  assert.equal(host.entries[0].details[1], 'substance=oil (OSM)');
  pick.value = { id: bezMena };
  handlers[0].fn({ position: { x: 1, y: 1 } });
  assert.equal(host.entries[0].title, 'gas.pipeline-unnamed-oil', 'bezmenný ropovod sa nesmie volať „plynovod“');
  layer.destroy(viewer);
  assert.deepEqual(layer._getStateForTest().kinds, { gas: 0, oil: 0 }, 'destroy upratal aj ropný stav');
});

test('duplicitné id (úsek cez hranicu dlaždice) dostane príponu namiesto výnimky; po zlyhaní sa pri ďalšom pokuse zdroj vyprázdni, nič sa nezdvojí', async () => {
  const dupText = `${TEXT}\n${feature('osm-way-1', { name: 'Transgas', diameterMm: 1400, lengthKm: 3.5, status: 'operating', osm: 1 }, [[19, 48.7], [19.5, 48.9]])}`;
  let calls = 0;
  const fetcher = async (url) => {
    if (String(url).includes('/api/oil/')) return noOil;
    if (url.endsWith('/meta')) return { ok: true, json: async () => META };
    calls += 1;
    if (calls === 1) return { ok: false, status: 502, json: async () => ({ error: 'upstream' }) };
    return { ok: true, text: async () => dupText };
  };
  const layer = createGasPipelinesLayer({ fetchImpl: fetcher, dataSourceFactory: fakeDataSource, handlerFactory: fakeHandler, overlayHost: fakeHost(), translate: tKey, lang: () => 'sk', now: () => NOW });
  const viewer = fakeViewer();
  layer.init(viewer);
  assert.equal(await layer.update(), false);
  assert.equal(layer.getStats().error, 'upstream');
  assert.equal(await layer.update(), true, 'po chybe sa skúsi znova');
  const st = layer._getStateForTest();
  assert.equal(st.count, 4);
  assert.equal(st.entities, 4, 'žiadne zdvojenie entít');
  assert.deepEqual(st.counts, { operating: 2, planned: 1, disused: 1 });
  assert.equal(layer.hasContact('gas-pipelines:osm-way-1'), true);
  assert.equal(layer.hasContact('gas-pipelines:osm-way-1#2'), true);
  const ids = viewer.dataSources.added[0].entities.values.map((e) => e.id);
  assert.equal(new Set(ids).size, 4, ids.join(','));
  assert.equal(layer.getStats().error, null);
  layer.destroy(viewer);
});

test('bez snímku: 404 no_snapshot sa prizná zrozumiteľne; iná chyba pôvodnou správou', async () => {
  const host = fakeHost();
  const none = createGasPipelinesLayer({ fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({ error: 'no_snapshot' }) }), dataSourceFactory: fakeDataSource, handlerFactory: fakeHandler, overlayHost: host, translate: tKey, lang: () => 'sk', now: () => NOW });
  const v = fakeViewer();
  none.init(v);
  assert.equal(await none.update(), false);
  assert.equal(none.getStats().error, 'gas.pipeline-no-snapshot');
  assert.equal(none.getStats().count, 0);
  none.destroy(v);
  const broken = createGasPipelinesLayer({ fetchImpl: async () => ({ ok: false, status: 502, json: async () => ({ error: 'upstream' }) }), dataSourceFactory: fakeDataSource, handlerFactory: fakeHandler, overlayHost: host, translate: tKey, lang: () => 'sk', now: () => NOW });
  const v2 = fakeViewer();
  broken.init(v2);
  assert.equal(await broken.update(), false);
  assert.equal(broken.getStats().error, 'upstream');
  broken.destroy(v2);
});

test('register, token a kredit: gas-pipelines má token 0, i18n mená a texty SK+EN, kredit OSM/ODbL', () => {
  const entry = LAYER_STATE_REGISTRY.find((e) => e.id === GAS_PIPELINES_LAYER_ID);
  assert.deepEqual(entry, { id: 'gas-pipelines', token: '0', disposition: 'enabled-only' });
  for (const key of ['layer.gas-pipelines.name', 'gas.pipeline-unnamed', 'gas.pipeline-diameter', 'gas.pipeline-length', 'gas.pipeline-status-operating', 'gas.pipeline-status-planned', 'gas.pipeline-status-disused', 'gas.pipeline-snapshot', 'gas.pipeline-no-snapshot']) {
    assert.ok(EN_STRINGS[key] && SK_STRINGS[key], key);
  }
  const credit = DATA_CREDITS.find((c) => c.key === 'gas-pipelines');
  assert.ok(credit);
  assert.match(credit.html, /OpenStreetMap contributors/);
  assert.match(credit.html, /odbl/i);
  assert.match(credit.html, /snapshot|static/i, 'statický snímok, nie živé');
  for (const key of ['gas.pipeline-unnamed-oil', 'gas.pipeline-kind-gas', 'gas.pipeline-kind-oil']) {
    assert.ok(EN_STRINGS[key] && SK_STRINGS[key], key);
  }
  // Ropa má VLASTNÝ kredit, nie dodatok k plynovému: sú to dve databázy vedľa
  // seba (Collective Database podľa ODbL §4.5(a)), každá s vlastnou atribúciou.
  const oilCredit = DATA_CREDITS.find((c) => c.key === 'oil-pipelines');
  assert.ok(oilCredit);
  assert.match(oilCredit.html, /OpenStreetMap contributors/);
  assert.match(oilCredit.html, /odbl/i);
  assert.match(oilCredit.html, /snapshot|static/i, 'statický snímok, nie živé');
  assert.notEqual(oilCredit.html, credit.html);
});

test('tripwires: registrácia v main.js, proxy trasy (meta pred súborom, gzip, 404 no_snapshot), skript buildu bez kľúča', () => {
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /import gasPipelinesLayer from '\.\/data\/gasPipelinesLayer\.js'/);
  assert.match(main, /dataManager\.register\(gasPipelinesLayer\)/);
  const vite = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
  const metaAt = vite.indexOf("middlewares.use('/api/gas/pipelines/meta'");
  const fileAt = vite.indexOf("middlewares.use('/api/gas/pipelines',");
  assert.ok(metaAt > 0 && fileAt > metaAt, 'connect páruje prefixom — /meta musí byť pred /api/gas/pipelines');
  assert.match(vite, /pipelines\.geojsonl/);
  assert.match(vite, /'no_snapshot'/);
  assert.match(vite, /zlib\.createGzip/);
  assert.match(vite, /max-age=86400/);
  const oilMetaAt = vite.indexOf("middlewares.use('/api/oil/pipelines/meta'");
  const oilFileAt = vite.indexOf("middlewares.use('/api/oil/pipelines',");
  assert.ok(oilMetaAt > 0 && oilFileAt > oilMetaAt, 'tá istá pasca prefixu platí aj pre ropu');
  // Ropa MUSÍ mať vlastný súbor a vlastný adresár: zlúčená s plynom by podľa
  // ODbL bola Derivative Database, kým dve databázy vedľa seba sú Collective
  // Database vyňatá §4.5(a).
  assert.match(vite, /'.gev-cache', 'oil'/, 'ropný snímok má vlastný adresár');
  const oilScript = readFileSync(new URL('../../scripts/build-oil-pipelines.mjs', import.meta.url), 'utf8');
  assert.match(oilScript, /overpass/i);
  assert.ok(!/process.env.[A-Z_]*KEY/.test(oilScript), 'OSM/Overpass nepotrebuje kľúč');
  assert.match(oilScript, /ODbL/, 'licencia v meta snímku');
  // Hlas: „ropovody" musia mieriť na TÚ ISTÚ vrstvu. Schéma nástrojov vo
  // vite.config.js je pinovaná na bajt (firstRunExperience.test.mjs), takže
  // nový enum by ju rozbil — a netreba ho, id vrstvy sa nemení.
  const voice = readFileSync(new URL('../voice/gevActions.js', import.meta.url), 'utf8');
  for (const alias of ['ropovody', 'ropovod', 'oil pipelines']) {
    assert.ok(voice.includes("['" + alias + "', 'gas-pipelines']"), alias);
  }
  const script = readFileSync(new URL('../../scripts/build-gas-pipelines.mjs', import.meta.url), 'utf8');
  assert.match(script, /overpass/i);
  assert.ok(!/process\.env\.[A-Z_]*KEY/.test(script), 'OSM/Overpass nepotrebuje kľúč');
  assert.match(script, /ODbL/, 'licencia v meta snímku');
});
