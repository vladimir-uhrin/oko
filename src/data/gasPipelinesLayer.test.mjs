// src/data/gasPipelinesLayer.test.mjs
// Vrstva „Plynovody“ (2026-09-13): lenivé načítanie snímku, entity podľa stavu,
// klik = zvýraznenie + karta, znova/prázdno zbalí, disable/destroy upracú,
// chýbajúci snímok sa prizná; register, kredit, i18n.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import { GAS_PIPELINES_LAYER_ID, GAS_PIPELINES_OVERLAY_SOURCE_ID, createGasPipelinesLayer, defaultGroundSupport, pipelineCard } from './gasPipelinesLayer.js';
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
  return { id, show: true, entities: { values, add(e) { values.push(e); return e; }, remove(e) { const i = values.indexOf(e); if (i >= 0) values.splice(i, 1); return i >= 0; }, removeAll() { values.length = 0; } } };
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
  assert.equal(transgas.polyline.width, 6, 'chrbtica DN 1400 = 6 px (etapa 4)');
  assert.equal(transgas.polyline.clampToGround, true);
  assert.equal(transgas.polyline.classificationType, Cesium.ClassificationType.BOTH);
  assert.equal(transgas.polyline.material.constructor.name, 'PolylineOutlineMaterialProperty', 'plná čiara má tmavý obrys');
  assert.equal(transgas.polyline.material.outlineWidth.getValue(), 1);
  assert.equal(transgas.polyline.distanceDisplayCondition, undefined, '120 km úsek je vidieť vždy');
  assert.equal(dn300.polyline.distanceDisplayCondition.far, 300_000, '0,8 km pahýľ mizne od 300 km');
  assert.equal(dn300.polyline.width, 3, 'pahýľ bez chrbtice = 3 px');
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
  // Etapa 4: výber je JEDNA entita vo vlastnom zdroji, základná dávka sa nemení.
  assert.equal(transgas.polyline.width, 6, 'základná entita sa výberom nemení');
  const selection = viewer.dataSources.added[2];
  assert.equal(selection.id, 'gas-pipelines-selected');
  assert.equal(selection.show, true);
  assert.equal(selection.entities.values.length, 1);
  assert.equal(selection.entities.values[0].polyline.width, 9, 'zvýraznenie = +3 px');
  assert.equal(selection.entities.values[0].polyline.material.color.getValue().withAlpha(1).toCssHexString().toLowerCase(), GAS_PIPELINE_COLORS.selected);
  assert.equal(selection.entities.values[0].polyline.distanceDisplayCondition, undefined, 'výber sa nikdy neskrýva');
  assert.equal(selection.entities.values[0].__gasPipelineSelection, 'osm-way-1');
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
  assert.equal(transgas.polyline.width, 6);
  assert.equal(selection.entities.values.length, 0, 'zbalenie odstráni zvýraznenie');
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
  assert.equal(viewer.dataSources.removed.length, 4, 'plyn, ropa, výber aj duch majú vlastný zdroj (etapy 3–5), destroy odstráni všetky');
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
  const oilDs = viewer.dataSources.added[1];
  assert.equal(oilDs.id, 'gas-pipelines-oil');
  assert.deepEqual([ds.entities.values.length, oilDs.entities.values.length], [3, 2], 'každá látka vo vlastnom zdroji');
  const druzba = oilDs.entities.values.find((e) => e.id === 'gas-pipelines:osm-way-77');
  const bezMena = oilDs.entities.values.find((e) => e.id === 'gas-pipelines:osm-way-78');
  assert.equal(druzba.properties.kind, 'oil');
  assert.equal(druzba.polyline.material.color.getValue().withAlpha(1).toCssHexString().toLowerCase(), OIL_PIPELINE_COLORS.operating);
  assert.equal(druzba.polyline.width, 6, 'DN 1220 = chrbtica, šírka znamená priemer rovnako ako pri plyne');
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

test('ropa prítomná, ale prázdna: nakreslí sa len plyn a chip nepripočíta kilometre, ktoré na mape nie sú', async () => {
  // Súbor existuje, meta existuje, ale build nenašiel ani jeden úsek. Bez
  // ohľadu na to, prečo, chip nesmie hlásiť ropné km z meta — kreslí sa nič.
  const fetcher = async (url) => {
    const path = String(url).split('?')[0];
    const oil = path.startsWith('/api/oil/');
    if (path.endsWith('/meta')) return { ok: true, json: async () => (oil ? { snapshot: '2026-09-01T00:00:00Z', features: 0, lengthKm: 999 } : META) };
    return { ok: true, text: async () => (oil ? '' : TEXT) };
  };
  const layer = createGasPipelinesLayer({ fetchImpl: fetcher, dataSourceFactory: fakeDataSource, handlerFactory: fakeHandler, overlayHost: fakeHost(), translate: tKey, lang: () => 'sk', now: () => NOW });
  const viewer = fakeViewer();
  layer.init(viewer);
  assert.equal(await layer.update(), true);
  const st = layer._getStateForTest();
  assert.deepEqual(st.kinds, { gas: 3, oil: 0 });
  assert.equal(st.oilMeta, null, 'prázdny ropný snímok nemá meta');
  // Medzery v popise sú U+00A0 a U+202F, preto sa porovnáva po normalizácii.
  const source = layer.getStats().source.replace(/\s/g, ' ');
  assert.equal(source, '© OpenStreetMap contributors · ODbL · gas.pipeline-snapshot {"date":"2026-09-13"} · 1 351 km', 'starší dátum 2026-09-01 ani 999 km sa do chipu nedostanú');
  layer.destroy(viewer);
});

test('etapa 3 — čipy PLYN/ROPA: setParams prepína zdroj látky, zbalí výber, ktorý jej patril, legenda nesie počty a farby', async () => {
  const host = fakeHost();
  const pick = { value: null };
  const handlers = [];
  let repaints = 0;
  const OIL_TEXT = feature('osm-way-77', { name: 'Družba', substance: 'oil', diameterMm: 1220, lengthKm: 300, status: 'operating', osm: 77 }, [[22, 48.5], [19, 48.6]]);
  const fetcher = async (url) => {
    const path = String(url).split('?')[0];
    const oil = path.startsWith('/api/oil/');
    if (path.endsWith('/meta')) return { ok: true, json: async () => (oil ? { snapshot: '2026-09-19T06:00:00Z', features: 1, lengthKm: 300 } : META) };
    return { ok: true, text: async () => (oil ? OIL_TEXT : TEXT) };
  };
  const layer = createGasPipelinesLayer({ fetchImpl: fetcher, dataSourceFactory: fakeDataSource, handlerFactory: () => { const h = fakeHandler(); handlers.push(h); return h; }, overlayHost: host, translate: tKey, lang: () => 'sk', now: () => NOW });
  layer.setRowControlsListener(() => { repaints += 1; });
  const viewer = fakeViewer(pick);
  layer.init(viewer);
  assert.deepEqual(layer.getParams(), { gas: true, oil: true }, 'predvolene obe látky');
  layer.enable();
  assert.equal(await layer.update(), true);
  assert.equal(repaints, 1, 'po načítaní sa riadok prekreslí — legenda dostala počty');
  const [gasDs, oilDs] = viewer.dataSources.added;
  assert.deepEqual([gasDs.show, oilDs.show], [true, true]);
  const controls = layer.getRowControls();
  assert.deepEqual(controls.chips.map((c) => [c.id, c.label, c.active, c.params]), [
    ['kind-gas', 'gas.pipeline-chip-gas', true, { gas: false }],
    ['kind-oil', 'gas.pipeline-chip-oil', true, { oil: false }],
  ]);
  assert.deepEqual(controls.legend.map((l) => [l.label, l.count, l.color]), [
    ['gas.pipeline-chip-gas', 3, GAS_PIPELINE_COLORS.operating],
    ['gas.pipeline-chip-oil', 1, OIL_PIPELINE_COLORS.operating],
  ]);
  // Vyber ropovod, potom vypni ropu: zdroj sa skryje a výber padne.
  const druzba = oilDs.entities.values[0];
  pick.value = { id: druzba };
  handlers[0].fn({ position: { x: 1, y: 1 } });
  assert.equal(layer._getStateForTest().selected, 'osm-way-77');
  assert.equal(layer.setParams({ oil: false }), true);
  assert.deepEqual(layer.getParams(), { gas: true, oil: false });
  assert.deepEqual([gasDs.show, oilDs.show], [true, false]);
  assert.equal(layer._getStateForTest().selected, null, 'vypnutá látka nemôže ostať vybraná');
  assert.equal(layer.getRowControls().chips[1].active, false);
  assert.deepEqual(layer.getRowControls().chips[1].params, { oil: true }, 'čip prepína na opak');
  assert.equal(repaints, 2);
  // Vypnutie plynu s vybraným plynovodom; neznáme kľúče a nezmysly sa ignorujú.
  pick.value = { id: gasDs.entities.values[0] };
  handlers[0].fn({ position: { x: 1, y: 1 } });
  assert.equal(layer._getStateForTest().selected, 'osm-way-1');
  assert.equal(layer.setParams({ gas: '0', nezmysel: true, oil: 'x' }), true);
  assert.deepEqual(layer.getParams(), { gas: false, oil: false });
  assert.equal(layer._getStateForTest().selected, null);
  assert.deepEqual([gasDs.show, oilDs.show], [false, false]);
  assert.equal(layer.setParams({ gas: 'true', oil: 1 }), true);
  assert.deepEqual([gasDs.show, oilDs.show], [true, true]);
  // Vypnutá vrstva = obe skryté bez ohľadu na voľby; zapnutie ich vráti podľa volieb.
  layer.disable();
  assert.deepEqual([gasDs.show, oilDs.show], [false, false]);
  layer.setParams({ oil: false });
  layer.enable();
  assert.deepEqual([gasDs.show, oilDs.show], [true, false], 'voľba prežije vypnutie vrstvy');
  layer.destroy(viewer);
});

test('etapa 3 — hover: pick 7×7 po 80 ms, karta pri kurzore, živý tok ENTSOG len pre napojený plynovod, odchod/klik/kamera zbalia', async () => {
  const pick = { value: null };
  const HOVER_TEXT = [
    feature('osm-way-1', { name: 'Nord Stream 1', operator: 'Nord Stream AG', diameterMm: 1153, lengthKm: 1220, status: 'operating', osm: 1, substance: 'gas' }, [[13.6, 54.1], [20, 55.5]]),
    feature('osm-way-2', { name: 'Anbindungsleitung', diameterMm: 300, lengthKm: 4, status: 'operating', osm: 2, substance: 'gas' }, [[9, 50], [9.1, 50.1]]),
  ].join('\n');
  const OIL_TEXT = feature('osm-way-77', { name: 'Družba', substance: 'oil', diameterMm: 1220, lengthKm: 300, status: 'operating', osm: 77 }, [[22, 48.5], [19, 48.6]]);
  const fetcher = async (url) => {
    const path = String(url).split('?')[0];
    const oil = path.startsWith('/api/oil/');
    if (path.endsWith('/meta')) return { ok: true, json: async () => (oil ? { snapshot: '2026-09-19T06:00:00Z', features: 1, lengthKm: 300 } : META) };
    return { ok: true, text: async () => (oil ? OIL_TEXT : HOVER_TEXT) };
  };
  const shown = []; let hidden = 0; const flowsSet = []; let hoveredInside = false;
  const hover = {
    show(f, at) { shown.push([f.id, at]); this._current = f; return f.properties.name === 'Nord Stream 1' ? ['greifswald-opal', 'greifswald-nel'] : []; },
    setFlows(f, payload) { flowsSet.push([f.id, payload ? payload.citation : null]); return true; },
    hide() { hidden += 1; this._current = null; }, destroy() { this.destroyed = true; }, isHovered: () => hoveredInside, current() { return this._current; },
  };
  let flowsCalls = 0;
  const flowsFetcher = async () => { flowsCalls += 1; return { points: [], citation: 'ENTSOG TP 19-09-2026 https://transparency.entsog.eu/' }; };
  const timers = [];
  const setTimer = (fn) => { timers.push(fn); return timers.length; };
  const clearTimer = (id) => { timers[id - 1] = null; };
  const runTimers = () => { const pending = timers.splice(0).filter(Boolean); for (const fn of pending) fn(); };
  const canvas = { listeners: {}, addEventListener(t, fn) { this.listeners[t] = fn; }, removeEventListener(t) { delete this.listeners[t]; } };
  const camera = { moveStart: { listener: null, addEventListener(fn) { this.listener = fn; return () => { this.listener = null; }; } } };
  const viewer = { ...fakeViewer(pick), scene: { canvas, pick: (pos, w, h) => { viewer.lastPick = [pos.x, pos.y, w, h]; return pick.value; }, requestRender() {} }, camera };
  let clock = NOW;
  const layer = createGasPipelinesLayer({ fetchImpl: fetcher, dataSourceFactory: fakeDataSource, handlerFactory: fakeHandler, overlayHost: fakeHost(), translate: tKey, lang: () => 'sk', now: () => clock, hoverFactory: () => hover, flowsFetcher, setTimer, clearTimer });
  layer.init(viewer);
  layer.enable();
  assert.equal(await layer.update(), true);
  assert.equal(layer._getStateForTest().hover.installed, true);
  assert.deepEqual(Object.keys(canvas.listeners).sort(), ['pointerdown', 'pointerleave', 'pointermove']);
  const [gasDs, oilDs] = viewer.dataSources.added;
  // Pohyb nad Nord Stream 1 → po tiku pick 7×7 → karta + živý tok.
  pick.value = { id: gasDs.entities.values[0] };
  canvas.listeners.pointermove({ clientX: 120, clientY: 80, buttons: 0 });
  assert.equal(shown.length, 0, 'karta až po pauze, nie pri každom pixeli');
  runTimers();
  assert.deepEqual(viewer.lastPick, [120, 80, 7, 7]);
  assert.deepEqual(shown, [['osm-way-1', { x: 120, y: 80 }]]);
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  assert.deepEqual(flowsSet, [['osm-way-1', 'ENTSOG TP 19-09-2026 https://transparency.entsog.eu/']]);
  assert.equal(flowsCalls, 1);
  // Druhý plynovod bez bodu ENTSOG: karta áno, tok sa nesťahuje.
  pick.value = { id: gasDs.entities.values[1] };
  canvas.listeners.pointermove({ clientX: 10, clientY: 10, buttons: 0 });
  runTimers();
  await new Promise((r) => setImmediate(r));
  assert.equal(shown.length, 2);
  assert.equal(flowsSet.length, 1, 'bez napojenia sa tok nesťahuje');
  // Ropovod: karta áno (látku a „nie je verejné" povie karta sama), tok nie.
  pick.value = { id: oilDs.entities.values[0] };
  canvas.listeners.pointermove({ clientX: 11, clientY: 11, buttons: 0 });
  runTimers();
  await new Promise((r) => setImmediate(r));
  assert.equal(shown[2][0], 'osm-way-77');
  assert.equal(flowsSet.length, 1);
  // Späť na NS1 v rámci 30 min: tok z cache, nie druhý request.
  pick.value = { id: gasDs.entities.values[0] };
  canvas.listeners.pointermove({ clientX: 120, clientY: 80, buttons: 0 });
  runTimers();
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  assert.equal(flowsCalls, 1, 'cache 30 min');
  assert.equal(flowsSet.length, 2);
  clock = NOW + 31 * 60 * 1000;
  pick.value = { id: gasDs.entities.values[1] };
  canvas.listeners.pointermove({ clientX: 1, clientY: 1, buttons: 0 }); runTimers();
  pick.value = { id: gasDs.entities.values[0] };
  canvas.listeners.pointermove({ clientX: 120, clientY: 80, buttons: 0 }); runTimers();
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  assert.equal(flowsCalls, 2, 'po 30 min nový request');
  // Prázdno pod kurzorom → karta sa schová (ak kurzor nie je v nej).
  const hiddenBefore = hidden;
  pick.value = null;
  canvas.listeners.pointermove({ clientX: 5, clientY: 5, buttons: 0 }); runTimers();
  assert.equal(hidden, hiddenBefore + 1);
  hoveredInside = true;
  canvas.listeners.pointermove({ clientX: 6, clientY: 6, buttons: 0 }); runTimers();
  assert.equal(hidden, hiddenBefore + 1, 'kurzor v karte ju drží');
  hoveredInside = false;
  // Ťahanie / dotyk / klik / pohyb kamery zbalia.
  canvas.listeners.pointermove({ clientX: 6, clientY: 6, buttons: 1 });
  assert.equal(hidden, hiddenBefore + 2);
  canvas.listeners.pointerdown({});
  assert.equal(hidden, hiddenBefore + 3);
  camera.moveStart.listener();
  assert.equal(hidden, hiddenBefore + 4);
  // Odchod z plátna: až po 220 ms, a len keď kurzor nie je v karte.
  canvas.listeners.pointerleave({});
  assert.equal(hidden, hiddenBefore + 4);
  runTimers();
  assert.equal(hidden, hiddenBefore + 5);
  // Vypnutie vrstvy odpojí listenery aj kameru; destroy zničí kartu.
  layer.disable();
  assert.deepEqual(Object.keys(canvas.listeners), []);
  assert.equal(camera.moveStart.listener, null);
  assert.equal(layer._getStateForTest().hover.installed, false);
  layer.destroy(viewer);
  assert.equal(hover.destroyed, true);
});

test('etapa 4 — bez podpory pozemných čiar: núdzovka 200 m nad elipsoidom, bez clampToGround, priznaná v zdroji', async () => {
  const layer = createGasPipelinesLayer({ fetchImpl: fetcherOk, dataSourceFactory: fakeDataSource, handlerFactory: fakeHandler, overlayHost: fakeHost(), translate: tKey, lang: () => 'sk', now: () => NOW, groundSupport: () => false });
  const viewer = fakeViewer();
  layer.init(viewer);
  assert.equal(layer._getStateForTest().groundSupported, false);
  assert.equal(await layer.update(), true);
  const [transgas] = viewer.dataSources.added[0].entities.values;
  assert.equal(transgas.polyline.clampToGround, false);
  assert.equal(transgas.polyline.classificationType, undefined, 'bez prikladania niet čo klasifikovať');
  const carto = Cesium.Cartographic.fromCartesian(transgas.polyline.positions[0]);
  assert.ok(Math.abs(carto.height - 200) < 1, 'výška 200 m nad elipsoidom');
  assert.match(layer.getStats().source, /gas\.pipeline-no-ground$/, 'chip prizná núdzovku (pravidlo 2)');
  assert.equal(defaultGroundSupport({}), true, 'falošná scéna bez kontextu = predpokladaj podporu, nie výnimku');
  layer.destroy(viewer);
});

test('etapa 5 — plot na chrbtici v strednom pásme; duch: kohorta pri kamere, výšky navzorkované raz, depthFail čiara len zblízka, pohyb kamery/čip/vypnutie', async () => {
  const timers = [];
  const setTimer = (fn) => { timers.push(fn); return timers.length; };
  const clearTimer = (id) => { timers[id - 1] = null; };
  const runTimers = () => { const pending = timers.splice(0).filter(Boolean); for (const fn of pending) fn(); };
  const tick = async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setImmediate(r)); };
  const samplings = [];
  const camera = {
    positionWC: Cesium.Cartesian3.fromDegrees(18, 48.5, 50_000),
    positionCartographic: { height: 50_000 },
    moveEnd: { listener: null, addEventListener(fn) { this.listener = fn; return () => { this.listener = null; }; } },
  };
  const base = fakeViewer();
  const viewer = { ...base, camera, scene: { ...base.scene, camera } };
  // Výšky zo spoločného resolvera (/api/terrain/heights), nie z 3D dlaždíc — viď PIPELINE_GHOST.
  const terrainSampler = async (points) => { samplings.push({ n: points.length, first: points[0] }); return points.map(() => 100); };
  const layer = createGasPipelinesLayer({ fetchImpl: fetcherOk, dataSourceFactory: fakeDataSource, handlerFactory: fakeHandler, overlayHost: fakeHost(), translate: tKey, lang: () => 'sk', now: () => NOW, setTimer, clearTimer, terrainSampler });
  layer.init(viewer);
  assert.deepEqual(viewer.dataSources.added.map((d) => d.id), ['gas-pipelines', 'gas-pipelines-oil', 'gas-pipelines-selected', 'gas-pipelines-ghost']);
  layer.enable();
  assert.equal(await layer.update(), true);
  const [transgas, ns2, dn300] = viewer.dataSources.added[0].entities.values;
  // Plot: len prevádzkovaná chrbtica (DN 1400, 120 km); plánovaná a pahýľ nie.
  assert.equal(layer._getStateForTest().fences, 1);
  assert.equal(transgas.wall.maximumHeights[0], 7000);
  assert.equal(transgas.wall.minimumHeights[0], 0);
  assert.equal(transgas.wall.distanceDisplayCondition.near, 200_000);
  assert.equal(transgas.wall.distanceDisplayCondition.far, 1_100_000);
  assert.equal(transgas.wall.outline, true);
  assert.equal(transgas.wall.material.color.getValue().alpha.toFixed(2), '0.18');
  assert.equal(ns2.wall, undefined, 'plánovaná rúra ešte nestojí');
  assert.equal(dn300.wall, undefined, 'pahýľ bez plotu');
  // Duch: po načítaní sa naplánuje kohorta; kamera 50 km nad Transgasom → jeho 3 vrcholy sa navzorkujú raz.
  const ghost = viewer.dataSources.added[3];
  assert.equal(ghost.show, true);
  assert.equal(layer._getStateForTest().ghost.listening, true);
  runTimers(); await tick();
  assert.deepEqual(samplings, [{ n: 3, first: [17, 48] }], 'vzorkuje sa raz, body [lon, lat] úseku');
  assert.equal(ghost.entities.values.length, 1);
  const g = ghost.entities.values[0];
  assert.equal(g.__gasPipelineGhost, 'osm-way-1');
  assert.equal(g.polyline.positions.length, 3);
  assert.ok(Math.abs(Cesium.Cartographic.fromCartesian(g.polyline.positions[1]).height - 103) < 0.5, 'navzorkovaná výška + 3 m');
  assert.equal(g.polyline.width, 5, 'o 1 px tenší než pozemná čiara');
  assert.equal(g.polyline.arcType, Cesium.ArcType.NONE);
  assert.equal(g.polyline.material, Cesium.Color.TRANSPARENT, 'viditeľnú časť kreslí pozemná čiara');
  assert.equal(g.polyline.depthFailMaterial.constructor.name, 'PolylineDashMaterialProperty', 'za terénom čiarkovaná');
  assert.equal(g.polyline.depthFailMaterial.color.getValue().alpha.toFixed(2), '0.55');
  assert.equal(g.polyline.distanceDisplayCondition.far, 250_000);
  // Pohyb kamery na tom istom mieste: z cache, žiadne nové vzorkovanie.
  camera.moveEnd.listener(); runTimers(); await tick();
  assert.equal(samplings.length, 1, 'výšky sú v cache');
  assert.equal(ghost.entities.values.length, 1);
  // Kamera vysoko → kohorta prázdna → duchovia preč; späť dole → z cache naspäť.
  camera.positionCartographic.height = 600_000;
  camera.moveEnd.listener(); runTimers(); await tick();
  assert.equal(ghost.entities.values.length, 0, 'nad 250 km bez duchov');
  camera.positionCartographic.height = 50_000;
  camera.moveEnd.listener(); runTimers(); await tick();
  assert.equal(ghost.entities.values.length, 1);
  assert.equal(samplings.length, 1);
  // Čip vypne plyn → duch plynovodu zmizne, ropa by ostala.
  layer.setParams({ gas: false }); runTimers(); await tick();
  assert.equal(ghost.entities.values.length, 0);
  layer.setParams({ gas: true }); runTimers(); await tick();
  assert.equal(ghost.entities.values.length, 1);
  // Vypnutie odpojí kameru a schová ducha; destroy odstráni štyri zdroje.
  layer.disable();
  assert.equal(camera.moveEnd.listener, null);
  assert.equal(ghost.show, false);
  assert.equal(layer._getStateForTest().ghost.listening, false);
  layer.destroy(viewer);
  assert.equal(viewer.dataSources.removed.length, 4);
  // Bez resolvera výšok niet ducha, ale plot a čiary áno.
  const plain = createGasPipelinesLayer({ fetchImpl: fetcherOk, dataSourceFactory: fakeDataSource, handlerFactory: fakeHandler, overlayHost: fakeHost(), translate: tKey, lang: () => 'sk', now: () => NOW, setTimer, clearTimer, terrainSampler: null });
  const v2 = fakeViewer();
  plain.init(v2); plain.enable();
  assert.equal(await plain.update(), true);
  runTimers(); await tick();
  assert.equal(plain._getStateForTest().ghost.supported, false);
  assert.equal(v2.dataSources.added[3].entities.values.length, 0);
  assert.equal(plain._getStateForTest().fences, 1);
  plain.destroy(v2);
});

test('etapa 6 — klik vyberie celú trasu (relácia), karta a hover hlásia úseky a km; bez skupiny len úsek', async () => {
  const GROUP_TEXT = [
    feature('osm-way-11', { name: 'Uzhhorod – Košice', relation: 900, diameterMm: 1400, lengthKm: 40, status: 'operating', osm: 11 }, [[22, 48.6], [21.5, 48.7]]),
    feature('osm-way-12', { name: 'Uzhhorod – Košice', relation: 900, diameterMm: 1400, lengthKm: 55.5, status: 'operating', osm: 12 }, [[21.5, 48.7], [21, 48.7]]),
    feature('osm-way-13', { name: 'Uzhhorod – Košice', relation: 900, diameterMm: 1400, lengthKm: 10, status: 'operating', osm: 13 }, [[21, 48.7], [20.9, 48.72]]),
    feature('osm-way-14', { name: 'Odbočka', diameterMm: 300, lengthKm: 3, status: 'operating', osm: 14 }, [[21, 49], [21.1, 49]]),
    feature('osm-way-15', { name: 'лупинг', operator: 'Газпром', diameterMm: 1400, lengthKm: 3, status: 'operating', osm: 15 }, [[40, 55], [40.1, 55]]),
    feature('osm-way-16', { name: 'лупинг', operator: 'Газпром', diameterMm: 1400, lengthKm: 3, status: 'operating', osm: 16 }, [[41, 55], [41.1, 55]]),
  ].join('\n');
  const fetcher = async (url) => (String(url).includes('/api/oil/') ? noOil : (url.endsWith('/meta') ? { ok: true, json: async () => META } : { ok: true, text: async () => GROUP_TEXT }));
  const pick = { value: null };
  const handlers = [];
  const host = fakeHost();
  const shown = [];
  const hover = { show(f, at, extra) { shown.push([f.id, extra?.group ?? null]); return []; }, setFlows() {}, hide() {}, destroy() {}, isHovered: () => false, current: () => null };
  const timers = [];
  const setTimer = (fn) => { timers.push(fn); return timers.length; };
  const clearTimer = (id) => { timers[id - 1] = null; };
  const runTimers = () => { const pending = timers.splice(0).filter(Boolean); for (const fn of pending) fn(); };
  const canvas = { listeners: {}, addEventListener(t, fn) { this.listeners[t] = fn; }, removeEventListener(t) { delete this.listeners[t]; } };
  const viewer = { ...fakeViewer(pick), scene: { canvas, pick: () => pick.value, requestRender() {} } };
  const layer = createGasPipelinesLayer({ fetchImpl: fetcher, dataSourceFactory: fakeDataSource, handlerFactory: () => { const h = fakeHandler(); handlers.push(h); return h; }, overlayHost: host, translate: tKey, lang: () => 'sk', now: () => NOW, hoverFactory: () => hover, setTimer, clearTimer, terrainSampler: null });
  layer.init(viewer);
  layer.enable();
  assert.equal(await layer.update(), true);
  assert.equal(layer._getStateForTest().groups, 1, 'relácia 900 je skupina; „лупинг" je všeobecné meno, netvorí ju');
  const gasDs = viewer.dataSources.added[0];
  const selection = viewer.dataSources.added[2];
  const seg12 = gasDs.entities.values.find((e) => e.__gasPipeline === 'osm-way-12');
  pick.value = { id: seg12 };
  handlers[0].fn({ position: { x: 1, y: 1 } });
  assert.equal(layer._getStateForTest().selected, 'osm-way-12');
  assert.deepEqual(selection.entities.values.map((e) => e.__gasPipelineSelection), ['osm-way-12', 'osm-way-11', 'osm-way-13'], 'kliknutý úsek prvý, potom zvyšok trasy');
  assert.equal(selection.entities.values.every((e) => e.polyline.width === 9), true);
  assert.ok(host.entries[0].details.includes('gas.pipeline-group: gas.pipeline-group-value {"n":3,"km":"106"}'), 'karta: celá trasa 3 úseky · 106 km (40 + 55,5 + 10 = 105,5 → 106)');
  // Úsek bez skupiny: zvýraznenie len jeho, karta bez riadku trasy.
  const seg14 = gasDs.entities.values.find((e) => e.__gasPipeline === 'osm-way-14');
  pick.value = { id: seg14 };
  handlers[0].fn({ position: { x: 1, y: 1 } });
  assert.deepEqual(selection.entities.values.map((e) => e.__gasPipelineSelection), ['osm-way-14']);
  assert.equal(host.entries[0].details.some((d) => d.startsWith('gas.pipeline-group')), false);
  // Všeobecné meno „лупинг": dva úseky nie sú trasa.
  const seg15 = gasDs.entities.values.find((e) => e.__gasPipeline === 'osm-way-15');
  pick.value = { id: seg15 };
  handlers[0].fn({ position: { x: 1, y: 1 } });
  assert.deepEqual(selection.entities.values.map((e) => e.__gasPipelineSelection), ['osm-way-15']);
  // Hover dostane súhrn skupiny (alebo null).
  pick.value = { id: seg12 };
  canvas.listeners.pointermove({ clientX: 5, clientY: 5, buttons: 0 }); runTimers();
  pick.value = { id: seg14 };
  canvas.listeners.pointermove({ clientX: 6, clientY: 6, buttons: 0 }); runTimers();
  assert.deepEqual(shown, [['osm-way-12', { count: 3, lengthKm: 106 }], ['osm-way-14', null]]);
  layer.destroy(viewer);
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
  assert.deepEqual(entry, { id: 'gas-pipelines', token: '0', disposition: 'enabled+options', optionOwner: 'gas-pipelines' });
  for (const key of ['layer.gas-pipelines.name', 'gas.pipeline-unnamed', 'gas.pipeline-diameter', 'gas.pipeline-length', 'gas.pipeline-status-operating', 'gas.pipeline-status-planned', 'gas.pipeline-status-disused', 'gas.pipeline-snapshot', 'gas.pipeline-no-snapshot']) {
    assert.ok(EN_STRINGS[key] && SK_STRINGS[key], key);
  }
  const credit = DATA_CREDITS.find((c) => c.key === 'gas-pipelines');
  assert.ok(credit);
  assert.match(credit.html, /OpenStreetMap contributors/);
  assert.match(credit.html, /odbl/i);
  assert.match(credit.html, /snapshot|static/i, 'statický snímok, nie živé');
  for (const key of ['gas.pipeline-unnamed-oil', 'gas.pipeline-kind-gas', 'gas.pipeline-kind-oil', 'gas.pipeline-chip-gas', 'gas.pipeline-chip-oil', 'gas.pipeline-chip-gas-hint', 'gas.pipeline-chip-oil-hint', 'gas.pipeline-route', 'gas.pipeline-flow-title', 'gas.pipeline-flow-none', 'gas.pipeline-flow-oil-none', 'gas.pipeline-flow-unavailable', 'gas.pipeline-hover-hint']) {
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
  // Hranice s potrubiami (2026-09-19): vrstva ich drží cez retain/release,
  // scéna úžiny je druhý držiteľ; bez tohto by mimo scény žiadne hranice neboli.
  assert.match(main, /countryBoundaries\.retain\('gas-pipelines'\)/);
  assert.match(main, /countryBoundaries\.release\('gas-pipelines'\)/);
  assert.match(main, /change\.layerId === 'gas-pipelines'/);
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
