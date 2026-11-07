// src/data/powerGridLayer.test.mjs
// Vrstva „Elektrická sieť · ≥ 220 kV" (ELEKTRINA, 2026-11-06): snímok
// Eurázie z /api/power/lines, tri druhy v troch zdrojoch, čipy, bez plotov,
// výber celej trasy podľa ref, núdzový slovenský extrakt pri 404, prednačítanie
// tokov, karta s tokom cez hranicu; register, kredit, i18n, proxy a build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { POWER_GRID_LAYER_ID, POWER_GRID_PROFILE, createPowerGridLayer, loadPowerFallback } from './powerGridLayer.js';
import { POWER_COLORS } from './powerGrid.js';
import { createPipelineHoverCard } from './pipelineHoverCard.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';
import { LAYER_STATE_REGISTRY } from './layerState.js';
import { DATA_CREDITS } from './dataCredits.js';

const tKey = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);
const feature = (id, props, coords) => JSON.stringify({ type: 'Feature', id, properties: props, geometry: { type: 'LineString', coordinates: coords } });
const TEXT = [
  feature('osm-way-1', { ref: 'V499', operator: 'SEPS', voltageV: 400000, voltages: [400000], frequency: 50, lengthKm: 40, status: 'operating', osm: 1, countries: ['SK', 'HU'] }, [[18, 48], [18.5, 47.7]]),
  feature('osm-way-2', { ref: 'V499', operator: 'SEPS', voltageV: 400000, voltages: [400000], lengthKm: 12, status: 'operating', osm: 2, countries: ['SK'] }, [[17.8, 48.1], [18, 48]]),
  feature('osm-way-3', { name: 'Lemešany – Voľa', voltageV: 220000, voltages: [220000], lengthKm: 0.6, status: 'operating', osm: 3, countries: ['SK'] }, [[21.2, 48.9], [21.21, 48.9]]),
  feature('osm-way-4', { name: 'NordLink', power: 'cable', voltageV: 525000, voltages: [525000], frequency: 0, lengthKm: 623, status: 'operating', osm: 4, countries: ['NO', 'DE'] }, [[7, 58], [9, 54]]),
].join('\n');
const META = { snapshot: '2026-11-06T22:00:00Z', features: 4, lengthKm: 675.6 };

function fakeDataSource(id) {
  const values = [];
  return { id, show: true, entities: { values, add(e) { values.push(e); return e; }, remove(e) { const i = values.indexOf(e); if (i >= 0) values.splice(i, 1); return i >= 0; }, removeAll() { values.length = 0; } } };
}
function fakeHandler() { return { fn: null, setInputAction(fn) { this.fn = fn; }, destroy() { this.destroyed = true; } }; }
function fakeHost() {
  return { entries: null, setEntries(src, entries) { this.src = src; this.entries = entries; }, setVisible(src, v) { this.visible = v; }, clearSource() { this.entries = null; }, hitTest() { return null; } };
}
function fakeViewer(pick) {
  return { dataSources: { added: [], add(ds) { this.added.push(ds); }, remove() {} }, scene: { canvas: {}, pick: () => pick.value, requestRender() {} }, selectedEntity: undefined };
}
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

test('profil: id a token vrstvy ostávajú (local-energy / y), tri čipy v odkaze, bez plotov', () => {
  assert.equal(POWER_GRID_LAYER_ID, 'local-energy');
  assert.deepEqual(LAYER_STATE_REGISTRY.find((e) => e.id === 'local-energy'), { id: 'local-energy', token: 'y', disposition: 'enabled+options', optionOwner: 'local-energy' });
  assert.deepEqual([...POWER_GRID_PROFILE.kinds], ['ehv', 'hv', 'dc']);
  assert.equal(POWER_GRID_PROFILE.fenceSpecFor({ voltageV: 750000 }), null, 'stožiare sú v realite, stena by klamala');
  assert.equal(POWER_GRID_PROFILE.sources[0].url, '/api/power/lines');
  assert.equal(typeof POWER_GRID_PROFILE.sources[0].fallback, 'function');
});

test('lifecycle: snímok Eurázie, tri zdroje podľa druhu, šírky, čipy, výber celej trasy podľa ref, prednačítanie tokov', async () => {
  const pick = { value: null };
  const handlers = [];
  let flowsCalls = 0;
  const fetcher = async (url) => (String(url).split('?')[0].endsWith('/meta') ? { ok: true, json: async () => META } : { ok: true, text: async () => TEXT });
  const host = fakeHost();
  const layer = createPowerGridLayer({
    fetchImpl: fetcher, dataSourceFactory: fakeDataSource, handlerFactory: () => { const h = fakeHandler(); handlers.push(h); return h; }, overlayHost: host,
    translate: tKey, lang: () => 'sk', terrainSampler: null, flowsFetcher: async () => { flowsCalls += 1; return { pairs: {} }; },
    hoverFactory: () => ({ show: () => [], setFlows() {}, hide() {}, destroy() {}, isHovered: () => false }),
  });
  const viewer = fakeViewer(pick);
  layer.init(viewer);
  assert.deepEqual(viewer.dataSources.added.map((d) => d.id), ['local-energy', 'local-energy-hv', 'local-energy-dc', 'local-energy-selected', 'local-energy-ghost']);
  layer.enable();
  await tick();
  const st = layer._getStateForTest();
  assert.equal(st.loaded, true);
  assert.deepEqual(st.kinds, { ehv: 2, hv: 1, dc: 1 });
  assert.equal(st.fences, 0);
  assert.equal(flowsCalls, 1, 'toky sa pýtajú hneď po načítaní');
  const [ehvDs, hvDs, dcDs] = viewer.dataSources.added;
  assert.equal(ehvDs.entities.values.length, 2);
  assert.equal(ehvDs.entities.values[0].polyline.width, 5, '400 kV = hlavná trieda');
  assert.equal(hvDs.entities.values[0].polyline.width, 3, '0,6 km 220 kV pahýľ');
  assert.equal(hvDs.entities.values[0].polyline.distanceDisplayCondition.far, 300_000);
  assert.equal(dcDs.entities.values[0].polyline.material.color.getValue().toCssHexString().slice(0, 7), POWER_COLORS.dc.operating);
  assert.equal(ehvDs.entities.values[0].wall, undefined);
  assert.match(layer.getStats().source, /OpenStreetMap contributors · ODbL · gas\.pipeline-snapshot \{"date":"2026-11-06"\}/);
  assert.doesNotMatch(layer.getStats().source, /power\.fallback-sk/);
  // Čipy a legenda
  const rc = layer.getRowControls();
  assert.deepEqual(rc.chips.map((c) => c.label), ['power.chip-ehv', 'power.chip-hv', 'power.chip-dc']);
  assert.deepEqual(rc.legend.map((l) => [l.count, l.color]), [[2, POWER_COLORS.ehv.operating], [1, POWER_COLORS.hv.operating], [1, POWER_COLORS.dc.operating]]);
  layer.setParams({ dc: false });
  assert.equal(dcDs.show, false);
  assert.equal(ehvDs.show, true);
  assert.deepEqual(layer.getParams(), { ehv: true, hv: true, dc: false });
  // Klik na úsek V499 vyberie obidva úseky trasy (ref + prevádzkovateľ)
  pick.value = { id: ehvDs.entities.values[0] };
  handlers[0].fn({ position: { x: 1, y: 2 } });
  assert.equal(layer._getStateForTest().selected, 'osm-way-1');
  assert.equal(layer._getStateForTest().selectionEntities, 2);
  assert.equal(host.entries[0].id, 'local-energy:osm-way-1');
  assert.equal(host.entries[0].title, 'V499');
  assert.equal(host.entries[0].details[0], 'power.kind-line {"kv":"400"}');
  assert.ok(host.entries[0].details.some((l) => l.startsWith('gas.pipeline-group:')));
  // Entita inej vrstvy s rovnakým id úseku sa nevyberie (dve vrstvy, jedno telo).
  pick.value = { id: { __gasPipeline: 'osm-way-2', __pipelineLayer: 'gas-pipelines' } };
  handlers[0].fn({ position: { x: 1, y: 2 } });
  assert.equal(layer._getStateForTest().selected, 'osm-way-1', 'cudzia entita výber nemení');
  layer.disable();
  layer.destroy(viewer);
});

test('bez snímku Eurázie (404 no_snapshot): kreslí sa bundlovaný extrakt Slovenska a zdroj to prizná', async () => {
  const skText = readFileSync(new URL('./local_data/sk_energy/sk-energy.geojsonl', import.meta.url), 'utf8');
  const fetcher = async (url) => {
    if (String(url).includes('sk-energy.geojsonl')) return { ok: true, text: async () => skText };
    return { ok: false, status: 404, json: async () => ({ error: 'no_snapshot' }) };
  };
  const layer = createPowerGridLayer({ fetchImpl: fetcher, dataSourceFactory: fakeDataSource, handlerFactory: fakeHandler, overlayHost: fakeHost(), translate: tKey, lang: () => 'sk', terrainSampler: null, flowsFetcher: null, hoverFactory: () => ({ show: () => [], setFlows() {}, hide() {}, destroy() {}, isHovered: () => false }) });
  const viewer = fakeViewer({ value: null });
  layer.init(viewer);
  layer.enable();
  await tick();
  const st = layer._getStateForTest();
  assert.equal(st.loaded, true);
  assert.ok(st.count > 400, `${st.count} úsekov`);
  assert.equal(st.kinds.dc, 0);
  assert.ok(st.kinds.ehv > 0 && st.kinds.hv > 0);
  assert.match(layer.getStats().source, /2026-08-30/);
  assert.match(layer.getStats().source, /power\.fallback-sk/);
  await assert.rejects(loadPowerFallback(async () => ({ ok: false, status: 500 })), /HTTP 500/);
});

test('hover karta vedenia: druh v hlavičke, napätie, hranica → tok cez hranicu z Energy-Charts; úsek v jednej krajine povie „bez toku"', () => {
  const listeners = new Map();
  const makeEl = (tag) => {
    const el = {
      tag, children: [], textContent: '', hidden: false, style: {}, dataset: {}, attrs: {}, className: '',
      appendChild(c) { el.children.push(c); c.parent = el; return c; }, replaceChildren(...cs) { el.children = []; cs.forEach((c) => el.appendChild(c)); },
      remove() {}, addEventListener() {}, setAttribute(k, v) { el.attrs[k] = v; }, contains: () => false, get offsetWidth() { return 300; }, get offsetHeight() { return 200; },
    };
    return el;
  };
  const doc = { body: makeEl('body'), documentElement: { clientWidth: 1000, clientHeight: 700 }, activeElement: null, createElement: makeEl, addEventListener(t, fn) { listeners.set(t, fn); }, removeEventListener() {} };
  const text = (el) => [el.textContent, ...el.children.map(text)].filter(Boolean).join(' ');
  const card = POWER_GRID_PROFILE.hoverFactory({ document: doc, translate: tKey, lang: () => 'sk', flagUrl: () => null, regionName: (iso) => iso, drawSpark: () => true, snapshotDate: () => '2026-11-06' });
  const line = { id: 'osm-way-1', properties: { ref: 'V499', operator: 'SEPS', voltageV: 400000, voltages: [400000], circuits: 2, lengthKm: 40, status: 'operating', osm: 1, countries: ['SK', 'HU'] } };
  const ids = card.show(line, { x: 10, y: 10 });
  assert.deepEqual(ids, ['HU-SK']);
  const root = doc.body.children[0];
  assert.equal(root.className, 'pipeline-hover-card power-hover-card');
  assert.equal(root.dataset.kind, 'ehv');
  let t = text(root);
  assert.match(t, /power\.kind-line \{"kv":"400"\}/);
  assert.match(t, /V499/);
  assert.match(t, /power\.voltage 400 kV/);
  assert.match(t, /power\.flow-title/);
  assert.match(t, /gas\.pipeline-flow-loading/);
  const payload = { citation: 'Energy-Charts.info (Fraunhofer ISE), ENTSO-E · CC BY 4.0', pairs: { 'HU-SK': { id: 'HU-SK', a: 'HU', b: 'SK', latestGw: -1.612, latestAt: '2026-11-06T19:00:00.000Z', series: [{ t: 1, gw: -1.6 }, { t: 2, gw: -1.612 }] } } };
  assert.equal(card.setFlows(line, payload), true);
  t = text(root);
  assert.match(t, /SK → .*power\.flow-border/);
  assert.match(t, /1,61 GW/);
  assert.match(t, /power\.flow-note/);
  assert.match(t, /power\.hover-hint/, 'päta hovorí o vedení, nie o rúre');
  assert.match(t, /CC BY 4\.0/);
  const inland = { id: 'osm-way-3', properties: { voltageV: 220000, voltages: [220000], status: 'operating', osm: 3, countries: ['SK'] } };
  assert.deepEqual(card.show(inland, { x: 10, y: 10 }), []);
  assert.match(text(root), /power\.flow-none/);
  card.destroy();
  // Plynová karta ostáva plynová (predvolené vstupy továrne).
  const gas = createPipelineHoverCard({ document: doc, translate: tKey, flagUrl: () => null });
  gas.show({ id: 'g', properties: { name: 'Družba', substance: 'oil', osm: 7 } }, { x: 1, y: 1 });
  assert.match(text(doc.body.children.at(-1)), /gas\.pipeline-flow-oil-none/);
});

test('register, kredit, i18n, hlas a proxy: všetko na mieste', () => {
  for (const key of ['layer.local-energy.name', 'power.chip-ehv', 'power.chip-hv', 'power.chip-dc', 'power.chip-ehv-hint', 'power.chip-hv-hint', 'power.chip-dc-hint', 'power.unnamed', 'power.kind-line', 'power.kind-cable', 'power.kind-dc', 'power.voltage', 'power.flow-title', 'power.flow-none', 'power.flow-note', 'power.flow-unavailable', 'power.no-snapshot', 'power.fallback-sk']) {
    assert.ok(EN_STRINGS[key] && SK_STRINGS[key], key);
  }
  const grid = DATA_CREDITS.find((c) => c.key === 'power-grid');
  assert.match(grid.html, /OpenStreetMap contributors/);
  assert.match(grid.html, /snapshot/);
  const flows = DATA_CREDITS.find((c) => c.key === 'power-flows');
  assert.match(flows.html, /Energy-Charts/);
  assert.match(flows.html, /CC BY 4\.0/);
  assert.match(flows.html, /not per line/);
  const voice = readFileSync(new URL('../voice/gevActions.js', import.meta.url), 'utf8');
  assert.ok(voice.includes("['power grid', 'local-energy']"));
  const vite = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
  const metaAt = vite.indexOf("middlewares.use('/api/power/lines/meta'");
  const fileAt = vite.indexOf("middlewares.use('/api/power/lines',");
  assert.ok(metaAt > 0 && fileAt > metaAt, 'connect páruje prefixom — /meta pred súborom');
  assert.ok(vite.includes("middlewares.use('/api/power/flows'"));
  assert.match(vite, /POWER_FLOW_REQUEST_GAP_MS/, 'rozostup dopytov kvôli 429');
  assert.match(vite, /powerProxy\(\),/);
  const script = readFileSync(new URL('../../scripts/build-power-lines.mjs', import.meta.url), 'utf8');
  assert.match(script, /overpass/i);
  assert.ok(!/process\.env\.[A-Z_]*KEY/.test(script), 'OSM/Overpass nepotrebuje kľúč');
  assert.match(script, /ODbL/);
  const local = readFileSync(new URL('./localLayers.js', import.meta.url), 'utf8');
  assert.match(local, /from '\.\/powerGridLayer\.js'/);
});

test('bunky: index → bunky vo výhľade, pohyb kamery načíta ďalšie a nad stropom uvoľní vzdialené; legenda hlási celý snímok', async () => {
  const lines = (prefix, n, lon, lat) => Array.from({ length: n }, (_, i) => feature(`${prefix}-${i}`, { voltageV: 400000, voltages: [400000], lengthKm: 5, status: 'operating', osm: i + 1, countries: ['SK'] }, [[lon + i * 0.01, lat], [lon + i * 0.01 + 0.02, lat + 0.01]])).join('\n');
  const INDEX = {
    cellDeg: 5, features: 9, totals: { ehv: 9, hv: 0, dc: 0 }, meta: { snapshot: '2026-11-06T22:00:00Z', lengthKm: 45 },
    cells: [{ id: '45_15', bbox: [45, 15, 50, 20], count: 3 }, { id: '45_20', bbox: [45, 20, 50, 25], count: 3 }, { id: '40_-5', bbox: [40, -5, 45, 0], count: 3 }],
  };
  const requested = [];
  const fetcher = async (url) => {
    requested.push(String(url));
    if (url === '/api/power/cells') return { ok: true, json: async () => INDEX };
    const id = decodeURIComponent(String(url).split('/api/power/cell/')[1].split('?')[0]);
    const [s, w] = id.split('_').map(Number);
    return { ok: true, text: async () => lines(id, 3, w + 1, s + 1) };
  };
  const timers = [];
  let view = { lon: 17, lat: 48, west: 14, south: 46, east: 21, north: 50 };
  const camera = {
    get positionCartographic() { return { longitude: view.lon * Math.PI / 180, latitude: view.lat * Math.PI / 180, height: 500_000 }; },
    computeViewRectangle: () => ({ west: view.west * Math.PI / 180, south: view.south * Math.PI / 180, east: view.east * Math.PI / 180, north: view.north * Math.PI / 180 }),
    moveEnd: { fn: null, addEventListener(fn) { this.fn = fn; return () => { this.fn = null; }; } },
  };
  const viewer = { dataSources: { added: [], add(ds) { this.added.push(ds); }, remove() {} }, scene: { canvas: {}, camera, globe: {}, pick: () => null, requestRender() {} }, camera };
  const profile = { ...POWER_GRID_PROFILE, cells: { ...POWER_GRID_PROFILE.cells, maxResident: () => 6 } };
  const { createGasPipelinesLayer } = await import('./gasPipelinesLayer.js');
  const layer = createGasPipelinesLayer({
    profile, fetchImpl: fetcher, dataSourceFactory: fakeDataSource, handlerFactory: fakeHandler, overlayHost: fakeHost(), translate: tKey, lang: () => 'sk', terrainSampler: null,
    flowsFetcher: async () => ({ pairs: {} }), hoverFactory: () => ({ show: () => [], setFlows() {}, hide() {}, destroy() {}, isHovered: () => false }),
    setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: (id) => { timers[id - 1] = null; },
  });
  layer.init(viewer);
  layer.enable();
  await tick();
  let st = layer._getStateForTest();
  assert.deepEqual(st.cells.resident, ['power:45_15', 'power:45_20'], 'dve bunky vo výhľade, Španielsko nie');
  assert.equal(st.count, 6);
  assert.equal(st.cells.listening, true);
  assert.deepEqual(layer.getRowControls().legend.map((l) => l.count), [9, 0, 0], 'legenda = celý snímok z indexu');
  assert.ok(requested.some((u) => u.startsWith('/api/power/cell/45_15?v=')), 'bunka verziovaná dátumom snímku');
  // Pohyb nad Španielsko: nová bunka sa načíta, nad stropom 6 sa uvoľní najstaršia mimo výhľadu.
  view = { lon: -3, lat: 42, west: -6, south: 40, east: 0, north: 44 };
  camera.moveEnd.fn();
  timers.splice(0).filter(Boolean).forEach((fn) => fn());
  await tick();
  st = layer._getStateForTest();
  assert.deepEqual(st.cells.resident, ['power:45_20', 'power:40_-5'], 'najstaršia bunka 45_15 uvoľnená');
  assert.equal(st.count, 6);
  assert.equal(viewer.dataSources.added[0].entities.values.length, 6, 'entity uvoľnenej bunky zmizli zo zdroja');
  layer.disable();
  assert.equal(layer._getStateForTest().cells.listening, false);
  layer.destroy(viewer);
});

test('úsek v jednej krajine si berie hranicu svojej trasy (Győr–Bős leží v HU, trasa prekračuje SK–HU)', async () => {
  assert.deepEqual(POWER_GRID_PROFILE.groupFlowIdsFor([{ properties: { countries: ['HU'] } }, { properties: { countries: ['HU', 'SK'] } }, { properties: { countries: ['SK'] } }]), ['HU-SK']);
  const makeEl = () => {
    const el = { children: [], textContent: '', hidden: false, style: {}, dataset: {}, className: '', appendChild(c) { el.children.push(c); return c; }, replaceChildren() { el.children = []; }, remove() {}, addEventListener() {}, setAttribute() {}, contains: () => false, offsetWidth: 300, offsetHeight: 200 };
    return el;
  };
  const doc = { body: makeEl(), documentElement: { clientWidth: 1000, clientHeight: 700 }, activeElement: null, createElement: makeEl, addEventListener() {}, removeEventListener() {} };
  const text = (el) => [el.textContent, ...el.children.map(text)].filter(Boolean).join(' ');
  const card = POWER_GRID_PROFILE.hoverFactory({ document: doc, translate: tKey, lang: () => 'sk', flagUrl: () => null, regionName: (iso) => iso, drawSpark: () => true });
  const seg = { id: 'osm-way-142108055', properties: { name: 'Győr OVIT–Bős', voltageV: 400000, voltages: [400000], status: 'operating', osm: 142108055, countries: ['HU'] } };
  assert.deepEqual(card.show(seg, { x: 1, y: 1 }, { group: { count: 11, lengthKm: 46, flowIds: ['HU-SK'] } }), ['HU-SK']);
  card.setFlows(seg, { pairs: { 'HU-SK': { a: 'HU', b: 'SK', latestGw: -1.6, latestAt: '2026-11-06T19:00:00.000Z', series: [] } }, citation: 'CC BY 4.0' });
  assert.match(text(doc.body.children[0]), /1,6 GW/);
  assert.deepEqual(card.show({ ...seg, id: 'x' }, { x: 1, y: 1 }), [], 'bez trasy ostáva „bez toku"');
});

test('telefón: ťuknutie otvorí plnú kartu s tokom pri prste (bez malej karty), zdvihnutie prsta ju nezavrie, ťuknutie znova zbalí; myš po starom', async () => {
  const pick = { value: null };
  const handlers = [];
  const listeners = {};
  const canvas = { addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener(type) { delete listeners[type]; }, getBoundingClientRect: () => ({ left: 10, top: 20 }) };
  const viewer = { dataSources: { added: [], add(ds) { this.added.push(ds); }, remove() {} }, scene: { canvas, pick: () => pick.value, requestRender() {} }, camera: {}, selectedEntity: undefined };
  const shown = [];
  let hidden = 0;
  const flowsSet = [];
  const hover = { show(f, at) { shown.push([f.id, at]); return ['HU-SK']; }, setFlows(f, p) { flowsSet.push([f.id, Boolean(p)]); return true; }, hide() { hidden += 1; }, destroy() {}, isHovered: () => false };
  const host = fakeHost();
  const timers = [];
  const fetcher = async (url) => (String(url).split('?')[0].endsWith('/meta') ? { ok: true, json: async () => META } : (String(url).includes('/api/power/cells') ? { ok: false, status: 404, json: async () => ({ error: 'no_snapshot' }) } : { ok: true, text: async () => TEXT }));
  const layer = createPowerGridLayer({
    fetchImpl: fetcher, dataSourceFactory: fakeDataSource, handlerFactory: () => { const h = fakeHandler(); handlers.push(h); return h; }, overlayHost: host,
    translate: tKey, lang: () => 'sk', terrainSampler: null, hoverFactory: () => hover, flowsFetcher: async () => ({ pairs: {} }),
    setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {},
  });
  layer.init(viewer);
  layer.enable();
  await tick();
  const ehv = viewer.dataSources.added[0].entities.values[0];
  // Dotyk
  listeners.pointerdown({ pointerType: 'touch' });
  pick.value = { id: ehv };
  handlers[0].fn({ position: { x: 100, y: 200 } });
  await tick();
  assert.equal(layer._getStateForTest().selected, 'osm-way-1');
  assert.deepEqual(shown, [['osm-way-1', { x: 110, y: 220 }]], 'karta pri prste (súradnice plátna + jeho poloha na stránke)');
  assert.equal(host.entries, null, 'malá karta sa pri ťuknutí nekreslí');
  assert.deepEqual(flowsSet, [['osm-way-1', true]], 'tok cez hranicu sa doplní');
  const hiddenBefore = hidden;
  listeners.pointerleave({ pointerType: 'touch' });
  timers.splice(0).filter(Boolean).forEach((fn) => fn());
  assert.equal(hidden, hiddenBefore, 'zdvihnutie prsta kartu nezavrie');
  // Ťuknutie znova na to isté vedenie = zbaliť výber aj kartu.
  listeners.pointerdown({ pointerType: 'touch' });
  handlers[0].fn({ position: { x: 100, y: 200 } });
  assert.equal(layer._getStateForTest().selected, null);
  assert.ok(hidden > hiddenBefore);
  // Myš: klik = malá karta v overlay, plná karta sa neotvára klikom.
  listeners.pointerdown({ pointerType: 'mouse' });
  handlers[0].fn({ position: { x: 100, y: 200 } });
  assert.equal(layer._getStateForTest().selected, 'osm-way-1');
  assert.equal(host.entries?.[0]?.id, 'local-energy:osm-way-1', 'myš: malá karta');
  assert.equal(shown.length, 1, 'klik myšou neotvára plnú kartu (tú dáva prejdenie myšou)');
  layer.disable();
});
