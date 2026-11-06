// src/data/lazyLayers.test.mjs — lenivé zástupcovia vrstiev (2026-10-31, lenivý štart).
// 1) STRÁŽ: každý zápis v lazyLayers.js sa zhoduje so skutočným modulom (metadáta, zmluva metód, predvolené
//    parametre, čipy pred init) — po zmene vrstvy test povie, čo prepísať.
// 2) Správanie lazyLayer.js: pred dotiahnutím tvary a podržané volania, init dotiahne a deleguje, chyba siete.
// 3) Zapojenie v main.js: registrácia cez zástupcov, žiadny statický import modulov vrstiev.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { LAZY_DEFAULTS, createLazyLayer } from './lazyLayer.js';
import * as lazy from './lazyLayers.js';
import { createLocalGeoJsonLayer } from './localGeojson.js';
import { createFirmsHeatmapLayer } from './firmsHeatmap.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const META = ['id', 'name', 'icon', 'source', 'updateInterval', 'refreshInterval', 'statsRefreshInterval', 'showInTogglePanel'];
const describe = (layer) => ({
  meta: Object.fromEntries(META.filter((k) => k in layer).map((k) => [k, layer[k]])),
  contract: Object.keys(layer).filter((k) => typeof layer[k] === 'function' && !k.startsWith('_')).sort(),
  params: typeof layer.getParams === 'function' ? layer.getParams() : null,
  rowControls: typeof layer.getRowControls === 'function' ? layer.getRowControls() : null,
});
const describeLazy = (layer) => ({
  meta: Object.fromEntries(META.filter((k) => k in layer).map((k) => [k, layer[k]])),
  contract: Object.keys(layer).filter((k) => typeof layer[k] === 'function').sort(),
  params: typeof layer.getParams === 'function' ? layer.getParams() : null,
  rowControls: typeof layer.getRowControls === 'function' ? layer.getRowControls() : null,
});

/** Geojson vrstvy z localLayers.js sa v Node nedajú importovať (?url) — id/name/icon/source sa čítajú zo zdroja. */
function localGeoOpts(varName) {
  const src = read('./localLayers.js');
  const start = src.indexOf(`const ${varName} = createLocalGeoJsonLayer({`);
  assert.ok(start > 0, `localLayers.js: ${varName}`);
  const block = src.slice(start, src.indexOf('\n});', start));
  const pick = (key) => { const m = new RegExp(`\\n\\s*${key}: ('([^']*)'|([A-Z_]+)),`).exec(block); assert.ok(m, `${varName}.${key}`); return m[2] ?? m[3]; };
  const idRaw = pick('id');
  const id = idRaw === 'AIRPORTS_LAYER_ID' ? 'local-airports' : idRaw === 'PORTS_LAYER_ID' ? 'local-ports' : idRaw;
  return { id, name: pick('name'), icon: pick('icon'), source: pick('source') };
}

const REAL = [
  ['earthquakesLazy', () => import('./earthquakes.js').then((m) => m.default)],
  ['volcanoesLazy', () => import('./volcanoes.js').then((m) => m.default)],
  ['naturalEventsLazy', () => import('./naturalEvents.js').then((m) => m.default)],
  ['shmuRadarLazy', () => import('./shmuRadar.js').then((m) => m.default)],
  ['shmuWarningsLazy', () => import('./shmuWarningsLayer.js').then((m) => m.default)],
  ['shmuStationsLazy', () => import('./shmuStationsLayer.js').then((m) => m.default)],
  ['operaRadarLazy', () => import('./operaRadarLayer.js').then((m) => m.default)],
  ['gasFlowsLazy', () => import('./gasFlowsLayer.js').then((m) => m.default)],
  ['gasPipelinesLazy', () => import('./gasPipelinesLayer.js').then((m) => m.default)],
  ['gfwPresenceLazy', () => import('./gfwPresence.js').then((m) => m.default)],
  ['gfwSarDetectionsLazy', () => import('./gfwSarDetections.js').then((m) => m.default)],
  ['volbyObceLazy', () => import('./volbyObceLayer.js').then((m) => m.default)],
  ['trafficLazy', () => import('./traffic.js').then((m) => m.default)],
  ['bikeshareLazy', () => import('./bikeshare.js').then((m) => m.default)],
  ['satellitesLazy', () => import('./satellites.js').then((m) => m.default)],
  ['rocketLaunchesLazy', () => import('./rocketLaunches.js').then((m) => m.default)],
  ['shippingLanesLazy', () => import('./shippingLanes.js').then((m) => m.default)],
  ['shipDensityLazy', () => import('./shipDensity.js').then((m) => m.default)],
  ['airDensityLazy', () => import('./airDensity.js').then((m) => m.default)],
  ['skEnergyLazy', () => import('./powerGridLayer.js').then((m) => m.default)],
  ['submarineCablesLazy', () => import('./telegeographySubmarineCables.js').then((m) => m.default)],
  ['airportsLazy', async () => createLocalGeoJsonLayer({ ...localGeoOpts('airports'), url: '/lazy', color: '#fff', labels: true })],
  ['portsLazy', async () => createLocalGeoJsonLayer({ ...localGeoOpts('ports'), url: '/lazy', color: '#fff', labels: true })],
  ['datacentersLazy', async () => createLocalGeoJsonLayer({ ...localGeoOpts('datacenters'), url: '/lazy', color: '#fff', labels: true })],
  ['damsLazy', async () => createLocalGeoJsonLayer({ ...localGeoOpts('dams'), url: '/lazy', color: '#fff', labels: true })],
  ['firesLazy', async () => {
    const src = read('./localLayers.js');
    const start = src.indexOf('const fires = createFirmsHeatmapLayer({');
    const block = src.slice(start, src.indexOf('\n});', start));
    const pick = (key) => new RegExp(`\\n\\s*${key}: '([^']*)',`).exec(block)[1];
    return createFirmsHeatmapLayer({ id: pick('id'), name: pick('name'), icon: pick('icon'), source: pick('source') });
  }],
];

test('stráž: každý zástupca sa zhoduje so skutočným modulom (metadáta, zmluva, parametre, čipy pred init)', async () => {
  for (const [name, loadReal] of REAL) {
    const real = await loadReal();
    const proxy = lazy[name];
    assert.ok(proxy, `lazyLayers.js: chýba ${name}`);
    assert.deepEqual(describeLazy(proxy), describe(real), `${name} sa rozišiel so skutočným modulom — prepíš zápis v lazyLayers.js`);
    assert.equal(proxy._lazyLoaded, false, `${name}: samotné porovnanie modul nedotiahlo`);
  }
  const { createAishubVesselsLayer } = await import('./aishubVessels.js');
  assert.deepEqual(describeLazy(lazy.createAishubVesselsLazy({ isLive: () => false })), describe(createAishubVesselsLayer({ isLive: () => false })));
  // poradie lokálnych vrstiev = poradie v localLayers.js
  const src = read('./localLayers.js');
  const order = src.slice(src.indexOf('export default [')).match(/\n\s+([a-zA-Z]+),/g).map((m) => m.trim().replace(',', ''));
  const expected = { airports: 'local-airports', ports: 'local-ports', shippingLanesLayer: 'local-shipping-lanes', shipDensityLayer: 'local-ship-density', airDensityLayer: 'local-air-density', datacenters: 'local-datacenters', dams: 'local-dams', skEnergyLayer: 'local-energy', submarineCablesLayer: 'telegeography-submarine-cables', fires: 'local-firms' };
  assert.deepEqual(lazy.localDataLayersLazy.map((l) => l.id), order.map((v) => expected[v]));
});

test('pred dotiahnutím: tvary bez vymýšľania, podržané nastavenia; init dotiahne, odovzdá a deleguje', async () => {
  const calls = [];
  const realLayer = {
    id: 'x', name: 'X', icon: '•', updateInterval: 1000, onSelect: null,
    init: async (v, o) => { calls.push(['init', v, o]); return true; },
    enable: (v) => calls.push(['enable', v]), disable: () => calls.push(['disable']), update: () => calls.push(['update']), destroy: () => calls.push(['destroy']),
    getStats: () => ({ count: 7 }), getParams: () => ({ a: 1, b: 2 }), setParams: (p) => { calls.push(['setParams', p]); return true; },
    getRowControls: () => ({ chips: [{ id: 'c' }], legend: [] }), setRowControlsListener: (fn) => calls.push(['listener', typeof fn]),
    getAllPositions: () => [1, 2], setDarkOnly: (v) => calls.push(['setDarkOnly', v]), isDarkOnly: () => true, select: (c) => calls.push(['select', c]), hasContact: () => true,
  };
  let loads = 0;
  const layer = createLazyLayer({
    meta: { id: 'x', name: 'X', icon: '•', updateInterval: 1000 },
    contract: ['init', 'enable', 'disable', 'update', 'destroy', 'getStats', 'getParams', 'setParams', 'getRowControls', 'setRowControlsListener', 'getAllPositions', 'setDarkOnly', 'isDarkOnly', 'select', 'hasContact'],
    params: { a: 1, b: 2 }, rowControls: { chips: [{ id: 'c' }], legend: [] },
    replay: ['setDarkOnly', 'select'], defaults: { isDarkOnly: (p) => Boolean(p.setDarkOnly?.[0] ?? false) }, props: ['onSelect'],
    load: async () => { loads += 1; return realLayer; },
  });
  assert.equal(layer.id, 'x'); assert.equal(layer.name, 'X'); assert.equal(layer.updateInterval, 1000);
  assert.equal(layer._lazyLoaded, false);
  assert.deepEqual(layer.getStats(), { count: 0, lastUpdate: null, loading: false, error: null });
  assert.deepEqual(layer.getParams(), { a: 1, b: 2 });
  assert.deepEqual(layer.getRowControls(), { chips: [{ id: 'c' }], legend: [] });
  assert.deepEqual(layer.getAllPositions(), []); assert.equal(layer.hasContact('1'), false);
  assert.equal(layer.isDarkOnly(), false);
  assert.doesNotThrow(() => { layer.enable({}); layer.disable({}); layer.update({}); });
  assert.equal(layer.setParams({ b: 3 }), true, 'správca berie podržané parametre ako prijaté');
  assert.deepEqual(layer.getParams(), { a: 1, b: 3 }, 'podržané parametre vidieť hneď');
  layer.setRowControlsListener(() => {});
  layer.setDarkOnly(true); layer.select('503');
  assert.equal(layer.isDarkOnly(), true, 'podržané setDarkOnly sa odráža v isDarkOnly');
  const onSelect = () => {};
  layer.onSelect = onSelect;
  assert.equal(layer.onSelect, onSelect);
  assert.deepEqual(calls, [], 'pred init sa skutočného modulu nič nedotkne (ani nevznikol)');
  assert.equal(loads, 0);
  assert.equal(await layer.init('viewer', { signal: null }), true);
  assert.equal(loads, 1);
  assert.deepEqual(calls, [['setParams', { b: 3 }], ['listener', 'function'], ['setDarkOnly', true], ['select', '503'], ['init', 'viewer', { signal: null }]], 'podržané nastavenia idú pred init, v poradí');
  assert.equal(realLayer.onSelect, onSelect, 'vlastnosť odovzdaná');
  assert.equal(layer._lazyLoaded, true);
  assert.deepEqual(layer.getStats(), { count: 7 }); assert.deepEqual(layer.getAllPositions(), [1, 2]); assert.equal(layer.isDarkOnly(), true);
  layer.enable('v'); assert.deepEqual(calls.at(-1), ['enable', 'v']);
  await layer.init('viewer'); assert.equal(loads, 1, 'druhý init nedotiahne znova');
  layer.destroy(); assert.deepEqual(calls.at(-1), ['destroy']); assert.equal(layer._lazyLoaded, false);
});

test('chyba siete pri init: správca ju vidí (init hodí), ďalší init skúsi znova', async () => {
  let fail = true;
  const layer = createLazyLayer({ meta: { id: 'y', name: 'Y', icon: '•', updateInterval: 0 }, contract: ['init', 'enable', 'getStats'], load: async () => { if (fail) throw new Error('offline'); return { init: async () => true, getStats: () => ({ count: 1 }) }; } });
  await assert.rejects(layer.init({}), /offline/);
  assert.equal(layer._lazyLoaded, false);
  fail = false;
  assert.equal(await layer.init({}), true);
  assert.deepEqual(layer.getStats(), { count: 1 });
  assert.equal(typeof LAZY_DEFAULTS.getAllPositions, 'function');
});

test('zapojenie: main.js registruje zástupcov, moduly vrstiev staticky neimportuje; lazyLayers.js ich tiež nie', () => {
  const main = read('../main.js');
  assert.match(main, /\} from '\.\/data\/lazyLayers\.js';/);
  for (const f of ['earthquakes', 'volcanoes', 'naturalEvents', 'shmuRadar', 'shmuWarningsLayer', 'shmuStationsLayer', 'operaRadarLayer', 'gasFlowsLayer', 'gasPipelinesLayer', 'gfwPresence', 'gfwSarDetections', 'aishubVessels', 'volbyObceLayer', 'localLayers', 'traffic', 'bikeshare', 'satellites', 'rocketLaunches']) {
    assert.doesNotMatch(main, new RegExp(`from '\\./data/${f}\\.js'`), `main.js: ${f}.js už nie je v hlavnom balíku`);
  }
  for (const name of ['earthquakesLayer', 'volcanoesLayer', 'naturalEventsLayer', 'shmuRadarLayer', 'shmuWarningsLayer', 'shmuStationsLayer', 'operaRadarLayer', 'gfwPresenceLayer', 'gfwSarDetectionsLayer', 'gasFlowsLayer', 'gasPipelinesLayer', 'volbyObceLayer', 'satellitesLayer', 'rocketLaunchesLayer', 'trafficLayer', 'bikeshareLayer']) {
    assert.match(main, new RegExp(`dataManager\\.register\\(${name}\\);`), `registrácia ${name}`);
  }
  assert.match(main, /for \(const layer of localDataLayers\) \{\s*dataManager\.register\(layer\);/);
  assert.match(main, /const aishubVesselsLayer = createAishubVesselsLayer\(\{\s*isLive: \(mmsi\) => aisLiveVesselsLayer\.hasContact\(mmsi\),/);
  assert.match(main, /rocketLaunchesLayer\.attachDataManager\(dataManager\);/, 'správca sa odovzdá cez zástupcu (replay po dotiahnutí)');
  // ui.js berie tie isté zástupce (detekcia, kamera misií, svetový skok dopravy) — modul vrstvy sa tam staticky neimportuje.
  const ui = read('../ui.js');
  assert.match(ui, /import \{ trafficLazy as trafficLayer, satellitesLazy as satellitesLayer, bikeshareLazy as bikeshareLayer, rocketLaunchesLazy as rocketLaunchesLayer \} from '\.\/data\/lazyLayers\.js';/);
  for (const f of ['traffic', 'satellites', 'bikeshare', 'rocketLaunches']) assert.doesNotMatch(ui, new RegExp(`from '\\./data/${f}\\.js'`), `ui.js: ${f}.js už nie je v hlavnom balíku`);
  const src = read('./lazyLayers.js');
  assert.doesNotMatch(src, /^import .* from '\.\/(?!lazyLayer\.js)/m, 'lazyLayers.js importuje len lazyLayer.js — všetko ostatné dynamicky');
  assert.equal((src.match(/import\('\.\//g) || []).length >= 13, true);
});
