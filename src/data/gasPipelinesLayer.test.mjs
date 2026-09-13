// src/data/gasPipelinesLayer.test.mjs
// Vrstva „Plynovody“ (2026-09-13): lenivé načítanie snímku, entity podľa stavu,
// klik = zvýraznenie + karta, znova/prázdno zbalí, disable/destroy upracú,
// chýbajúci snímok sa prizná; register, kredit, i18n.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GAS_PIPELINES_LAYER_ID, GAS_PIPELINES_OVERLAY_SOURCE_ID, createGasPipelinesLayer, pipelineCard } from './gasPipelinesLayer.js';
import { GAS_PIPELINE_COLORS } from './gasPipelines.js';
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
const fetcherOk = async (url) => (url.endsWith('/meta') ? { ok: true, json: async () => META } : { ok: true, text: async () => TEXT });

test('pipelineCard: vybraná karta s menom, riadkami a zdrojom v päte', () => {
  const card = pipelineCard({ id: 'osm-way-1', properties: { name: 'Transgas', operator: 'eustream', diameterMm: 1400, lengthKm: 120.4, osm: 1 } }, { x: 1, y: 2, z: 3 }, tKey, 'sk', { source: 'zdroj X' });
  assert.equal(card.id, 'gas-pipelines:osm-way-1');
  assert.equal(card.variant, 'selected');
  assert.equal(card.protected, true);
  assert.equal(card.title, 'Transgas');
  assert.deepEqual(card.details, ['eustream', 'gas.pipeline-diameter {"mm":"1 400"} · gas.pipeline-length {"km":"120"}', 'gas.pipeline-status-operating', 'OSM way 1', 'zdroj X']);
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
  assert.equal(st.lengthKm, 1351);
  assert.equal(st.meta.features, 3);
  const ds = viewer.dataSources.added[0];
  const [transgas, ns2, dn300] = ds.entities.values;
  assert.equal(transgas.polyline.width, 2.8);
  assert.equal(transgas.polyline.clampToGround, true);
  assert.equal(transgas.__gasPipeline, 'osm-way-1');
  assert.equal(ns2.polyline.material.constructor.name, 'PolylineDashMaterialProperty', 'plánované sú čiarkované');
  assert.equal(dn300.polyline.material.color.getValue().alpha.toFixed(2), '0.40', 'odstavené sú stlmené');
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

test('duplicitné id (úsek cez hranicu dlaždice) dostane príponu namiesto výnimky; po zlyhaní sa pri ďalšom pokuse zdroj vyprázdni, nič sa nezdvojí', async () => {
  const dupText = `${TEXT}\n${feature('osm-way-1', { name: 'Transgas', diameterMm: 1400, lengthKm: 3.5, status: 'operating', osm: 1 }, [[19, 48.7], [19.5, 48.9]])}`;
  let calls = 0;
  const fetcher = async (url) => {
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
  const script = readFileSync(new URL('../../scripts/build-gas-pipelines.mjs', import.meta.url), 'utf8');
  assert.match(script, /overpass/i);
  assert.ok(!/process\.env\.[A-Z_]*KEY/.test(script), 'OSM/Overpass nepotrebuje kľúč');
  assert.match(script, /ODbL/, 'licencia v meta snímku');
});
