// src/data/gibsOverlays.test.mjs
// Prekryvné vrstvy NASA GIBS nad podkladom (2026-09-06, „urob 2").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GIBS_OVERLAYS,
  GIBS_OVERLAY_LAYER_IDS,
  GIBS_OVERLAY_MAX_DAYS_BACK,
  GIBS_OVERLAY_OPACITY_STEPS,
  createGibsOverlayLayer,
  gibsOverlayFade,
  gibsOverlayProbeUrl,
  gibsOverlayUrl,
  normalizeOverlayOpacity,
} from './gibsOverlays.js';
import { gibsImageryDay, gibsImageryDayOffset } from '../gibsTime.js';
import { gibsImageryDay as fromController } from '../mapStackController.js';
import { IMAGERY_ROLE, insertOverlayLayer, tagImageryRole } from '../imageryOrder.js';
import {
  _resetActiveMapStackForTest,
  bindActiveMapStackToEvents,
  getActiveMapStack,
  isGlobeHiddenForStack,
  onActiveMapStackChange,
  setActiveMapStack,
} from './activeMapStack.js';
import { REGISTERED_LAYER_IDS } from './layerState.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';

const NOW = Date.UTC(2026, 8, 6, 15, 0); // 2026-09-06 15:00 UTC

/** Kolekcia imagery vrstiev ako v Cesiu: length/get/add(index)/remove. */
function fakeImageryCollection() {
  const layers = [];
  return {
    layers,
    get length() { return layers.length; },
    get: (i) => layers[i],
    add: (layer, index) => { if (index == null) layers.push(layer); else layers.splice(index, 0, layer); },
    remove: (layer) => { const i = layers.indexOf(layer); if (i >= 0) layers.splice(i, 1); return i >= 0; },
  };
}

function fakeFetch(statusByDay) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const day = (url.match(/\/default\/(\d{4}-\d{2}-\d{2})\//) || [])[1];
    const status = statusByDay[day] ?? 200;
    return { ok: status === 200, status };
  };
  impl.calls = calls;
  return impl;
}

function makeLayer(def, { statusByDay = {}, now = NOW, heightM = 12_000_000 } = {}) {
  const fetchImpl = fakeFetch(statusByDay);
  const built = [];
  const layer = createGibsOverlayLayer(def, {
    fetchImpl,
    now: () => now,
    providerFactory: (d, day) => ({ url: gibsOverlayUrl(d, day), day }),
    layerFactory: (provider) => { const l = { provider, alpha: 1 }; built.push(l); return l; },
  });
  const collection = fakeImageryCollection();
  const scene = {
    camera: { positionCartographic: { height: heightM } },
    preRender: { listeners: [], addEventListener(fn) { this.listeners.push(fn); return () => { this.listeners.splice(this.listeners.indexOf(fn), 1); }; } },
  };
  const viewer = { imageryLayers: collection, scene };
  layer.init(viewer);
  return { layer, fetchImpl, built, collection, scene };
}

test('deň snímky: jeden zdroj pravdy (gibsTime.js), controller ho re-exportuje', () => {
  assert.equal(gibsImageryDay(NOW), '2026-09-05');
  assert.equal(gibsImageryDayOffset(1, NOW), '2026-09-05');
  assert.equal(gibsImageryDayOffset(3, NOW), '2026-09-03');
  assert.equal(gibsImageryDayOffset(0, NOW), '2026-09-06');
  assert.equal(fromController, gibsImageryDay, 'mapStackController musí re-exportovať TÚ ISTÚ funkciu');
  assert.equal(gibsImageryDay(Date.UTC(2026, 0, 1, 0, 30)), '2025-12-31', 'prechod cez rok');
});

test('katalóg: päť vrstiev, WMTS REST z/y/x, png, úrovne podľa GetCapabilities', () => {
  assert.deepEqual([...GIBS_OVERLAY_LAYER_IDS], ['gibs-sst', 'gibs-precip', 'gibs-snow', 'gibs-aerosol', 'gibs-sea-ice']);
  const levels = Object.fromEntries(GIBS_OVERLAYS.map((d) => [d.layer, d.level]));
  // Overené 2026-09-06 z WMTSCapabilities epsg3857/best — vyššia úroveň = 404.
  assert.deepEqual(levels, {
    GHRSST_L4_MUR_Sea_Surface_Temperature: 7,
    IMERG_Precipitation_Rate: 6,
    MODIS_Terra_NDSI_Snow_Cover: 8,
    MODIS_Combined_Value_Added_AOD: 6,
    GHRSST_L4_MUR_Sea_Ice_Concentration: 7,
  });
  for (const def of GIBS_OVERLAYS) {
    const url = gibsOverlayUrl(def, '2026-09-05');
    // GIBS je WMTS REST: TileMatrix/TileRow/TileCol = z/y/x. Prehodené indexy
    // vrátia 200 s cudzou dlaždicou — rozhádzaná mapa, nie chyba.
    assert.ok(url.endsWith('/{z}/{y}/{x}.png'), url);
    assert.ok(url.startsWith('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/'));
    assert.match(url, new RegExp(`/${def.layer}/default/2026-09-05/GoogleMapsCompatible_Level${def.level}/`));
    assert.equal(gibsOverlayProbeUrl(def, '2026-09-05'), url.replace('{z}/{y}/{x}', '2/1/1'));
    assert.equal(def.legend.length, 5, 'legenda = päť kotiev colormapy');
    assert.ok(def.legend.every((e) => /^rgb\(\d+,\d+,\d+\)$/.test(e.color)));
    assert.ok(def.legend[0].label && def.legend[4].label, 'krajné kotvy majú hodnotu s jednotkou');
    assert.match(def.colormap, /^https:\/\/gibs\.earthdata\.nasa\.gov\/colormaps\/v1\.3\/.+\.xml$/);
    assert.ok(def.opacity > 0 && def.opacity <= 1);
    assert.doesNotMatch(def.icon, /[\u{1F300}-\u{1FAFF}]/u, 'monochromatický glyf, nie emoji');
    assert.ok(REGISTERED_LAYER_IDS.includes(def.id), `${def.id} musí byť v share-link registri`);
    for (const strings of [EN_STRINGS, SK_STRINGS]) {
      assert.ok(strings[`layer.${def.id}.name`], `chýba názov ${def.id}`);
      assert.ok(strings[`gibs.short.${def.id}`], `chýba krátky názov ${def.id}`);
    }
  }
});

test('poradie imagery vrstiev: prekryv sadne POD nočné svetlá, inak navrch', () => {
  const c = fakeImageryCollection();
  const base = tagImageryRole({ name: 'base' }, IMAGERY_ROLE.base);
  const lights = tagImageryRole({ name: 'lights' }, IMAGERY_ROLE.nightLights);
  c.add(base); c.add(lights);
  const overlay = { name: 'sst' };
  assert.equal(insertOverlayLayer(c, overlay), 1);
  assert.deepEqual(c.layers.map((l) => l.name), ['base', 'sst', 'lights']);
  assert.equal(overlay.gevImageryRole, IMAGERY_ROLE.overlay);
  // Bez svetiel: navrch.
  const c2 = fakeImageryCollection(); c2.add(base);
  assert.equal(insertOverlayLayer(c2, { name: 'rain' }), 1);
  assert.deepEqual(c2.layers.map((l) => l.name), ['base', 'rain']);
  // Dvojník bez get/length (mapStackController testy): stále funguje.
  const bare = { added: [], add(l) { this.added.push(l); } };
  insertOverlayLayer(bare, { name: 'x' });
  assert.equal(bare.added.length, 1);
  assert.equal(tagImageryRole(null, 'base'), null);
});

test('aktívny podklad: udalosť main.js, seed, zmena len pri inej identite, fotoreál = skrytý glóbus', () => {
  _resetActiveMapStackForTest();
  const listeners = new Map();
  const target = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  let changes = 0;
  const off = onActiveMapStackChange(() => { changes += 1; });
  const unbind = bindActiveMapStackToEvents(target, { id: 'photoreal', kind: 'photoreal' });
  assert.equal(getActiveMapStack().id, 'photoreal');
  assert.equal(isGlobeHiddenForStack(), true);
  assert.equal(changes, 1);
  listeners.get('gev:map-stack-changed')({ detail: { activeStack: { id: 'photoreal', kind: 'photoreal' } } });
  assert.equal(changes, 1, '„ready" tej istej mapy nič nemení');
  listeners.get('gev:map-stack-changed')({ detail: { activeStack: { id: 'osm', kind: 'osm' } } });
  assert.equal(changes, 2);
  assert.equal(isGlobeHiddenForStack(), false);
  assert.equal(isGlobeHiddenForStack(null), false, 'bez údaju sa predpokladá glóbus');
  unbind(); off();
  assert.equal(listeners.size, 0);
  assert.equal(setActiveMapStack(null), true);
  _resetActiveMapStackForTest();
});

test('vrstva: enable kreslí hneď včerajšok s krytím, disable odoberie, poradie pod svetlami', async () => {
  _resetActiveMapStackForTest();
  const { layer, built, collection } = makeLayer(GIBS_OVERLAYS[0]);
  const lights = tagImageryRole({ name: 'lights' }, IMAGERY_ROLE.nightLights);
  collection.add(tagImageryRole({ name: 'base' }, IMAGERY_ROLE.base));
  collection.add(lights);

  layer.enable();
  assert.equal(built.length, 1);
  assert.equal(built[0].provider.day, '2026-09-05', 'bez čakania na sondu kreslí včerajšok');
  assert.equal(built[0].alpha, GIBS_OVERLAYS[0].opacity);
  assert.deepEqual(collection.layers.map((l) => l.name || l.provider.day), ['base', '2026-09-05', 'lights']);
  assert.match(layer.source, /NASA GIBS · GHRSST MUR L4 · 2026-09-05 UTC/);

  layer.disable();
  assert.equal(collection.layers.length, 2, 'prekryv preč, podklad a svetlá ostávajú');
  assert.equal(layer.getStats().error, null);
});

test('vrstva: update overí deň, pri 400 ustúpi o deň a hlási STALE; nad limit = nedostupné', async () => {
  _resetActiveMapStackForTest();
  const def = GIBS_OVERLAYS[1];
  const { layer, fetchImpl, built } = makeLayer(def, { statusByDay: { '2026-09-05': 400 } });
  layer.enable();
  assert.equal(await layer.update(), true);
  assert.equal(fetchImpl.calls.length, 2, 'včera 400 → predvčerom 200');
  assert.equal(built.at(-1).provider.day, '2026-09-04', 'vrstva sa prestavala na dostupný deň');
  const stats = layer.getStats();
  assert.equal(stats.stale, true);
  assert.equal(stats.day, '2026-09-04');
  assert.equal(stats.lastUpdate, Date.UTC(2026, 8, 4), 'vek = deň mozaiky, nie čas sondy');
  assert.equal(stats.error, null);

  // Ďalší update s tým istým dňom vrstvu neprestavuje (žiadne blikanie).
  const before = built.length;
  await layer.update();
  assert.equal(built.length, before);

  // Všetky dni 400 → nedostupné, vrstva ostáva na poslednom dobrom dni.
  const all400 = Object.fromEntries(Array.from({ length: GIBS_OVERLAY_MAX_DAYS_BACK + 1 }, (_, i) => [gibsImageryDayOffset(i, NOW), 400]));
  const failing = makeLayer(def, { statusByDay: all400 });
  failing.layer.enable();
  assert.equal(await failing.layer.update(), false);
  assert.equal(failing.fetchImpl.calls.length, GIBS_OVERLAY_MAX_DAYS_BACK);
  assert.match(failing.layer.getStats().error, /GIBS/);
  // 5xx nie je „chýbajúci deň" — neskúša sa ďalej do minulosti.
  const down = makeLayer(def, { statusByDay: { '2026-09-05': 503 } });
  down.layer.enable();
  assert.equal(await down.layer.update(), false);
  assert.equal(down.fetchImpl.calls.length, 1);
});

test('vrstva: krytie cez params + čipy, legenda bez počtov, odmietnutie nečísla', () => {
  _resetActiveMapStackForTest();
  const def = GIBS_OVERLAYS[2];
  const { layer, built } = makeLayer(def);
  layer.enable();
  assert.deepEqual(layer.getParams(), { opacity: def.opacity });
  assert.equal(layer.setParams({ opacity: 0.4 }), true);
  assert.equal(built[0].alpha, 0.4);
  assert.equal(layer.setParams({ opacity: 'x' }), false, 'manažér to hlási ako odmietnuté');
  assert.equal(layer.setParams({}), true, 'bez opacity = no-op');
  assert.equal(normalizeOverlayOpacity(1.7), 1);
  assert.equal(normalizeOverlayOpacity(-1), 0);
  assert.equal(normalizeOverlayOpacity(null), null);

  const controls = layer.getRowControls();
  assert.equal(controls.chips.length, GIBS_OVERLAY_OPACITY_STEPS.length);
  assert.deepEqual(controls.chips.map((c) => c.label), ['40 %', '70 %', '100 %']);
  assert.deepEqual(controls.chips.map((c) => c.active), [true, false, false]);
  assert.deepEqual(controls.chips[1].params, { opacity: 0.7 });
  assert.equal(controls.legend.length, 5);
  // Manažér kreslí `${label} ${count}` — undefined by vypísal „undefined".
  assert.ok(controls.legend.every((e) => e.count === ''));
});

test('vrstva: na fotoreáli riadok hlási skrytý glóbus, po prepnutí podkladu sa prekreslí', async () => {
  _resetActiveMapStackForTest();
  const { layer } = makeLayer(GIBS_OVERLAYS[4]);
  setActiveMapStack({ id: 'photoreal', kind: 'photoreal' });
  let repaints = 0;
  layer.setRowControlsListener(() => { repaints += 1; });
  layer.enable();
  assert.match(layer.getStats().error, /Google 3D|globe/i);
  setActiveMapStack({ id: 'osm', kind: 'osm' });
  assert.equal(repaints, 1, 'zmena podkladu musí prekresliť riadok');
  assert.equal(layer.getStats().error, null);
  layer.destroy();
  setActiveMapStack({ id: 'photoreal', kind: 'photoreal' });
  assert.equal(repaints, 1, 'po destroy už nepočúva');
  _resetActiveMapStackForTest();
});

test('tripwire: registrácia v main.js, väzba podkladu, kredit, DATA_SOURCES', () => {
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /import gibsOverlayLayers from '\.\/data\/gibsOverlays\.js';/);
  assert.match(main, /for \(const layer of gibsOverlayLayers\) \{\s*dataManager\.register\(layer\);/);
  assert.match(main, /bindActiveMapStackToEvents\(window, mapStackController\.getActiveStack\(\)\)/);
  const credits = readFileSync(new URL('./dataCredits.js', import.meta.url), 'utf8');
  assert.match(credits, /key: 'nasa-gibs-overlays'/);
  const sources = readFileSync(new URL('../../DATA_SOURCES.md', import.meta.url), 'utf8');
  assert.match(sources, /NASA GIBS \/ Worldview — science overlays/);
  // Vrstvy nie sú mapové podklady — do MAP_STACKS nepatria.
  const stacks = readFileSync(new URL('../mapStackController.js', import.meta.url), 'utf8');
  assert.doesNotMatch(stacks, /GHRSST|IMERG|NDSI|Value_Added_AOD/);
});

test('zoom-fade: prahy z úrovne dlaždíc, alfa = krytie × faktor, pod fadeOut vrstva zmizne', async () => {
  _resetActiveMapStackForTest();
  assert.deepEqual(gibsOverlayFade(6), { fadeOutM: 800_000, fadeInM: 2_400_000 });
  assert.deepEqual(gibsOverlayFade(7), { fadeOutM: 400_000, fadeInM: 1_200_000 });
  assert.deepEqual(gibsOverlayFade(8), { fadeOutM: 200_000, fadeInM: 600_000 });

  const def = GIBS_OVERLAYS[1]; // zrážky, Level 6
  const { layer, built, scene } = makeLayer(def, { heightM: 12_000_000 });
  layer.enable();
  assert.equal(scene.preRender.listeners.length, 1, 'preRender listener pripojený pri enable');
  assert.equal(built[0].alpha, def.opacity, 'pohľad na svet: plné krytie');

  scene.camera.positionCartographic.height = 700_000; // Alpy — tu boli bloky
  scene.preRender.listeners[0]();
  assert.equal(built[0].alpha, 0, 'pod fadeOut (800 km pre L6) vrstva zmizne');

  scene.camera.positionCartographic.height = 1_600_000; // stred pásma
  scene.preRender.listeners[0]();
  assert.ok(Math.abs(built[0].alpha - def.opacity * 0.5) < 1e-9, 'lineárne medzi');

  // Krytie z čipov sa násobí zoom-faktorom, neprepíše ho.
  layer.setParams({ opacity: 0.4 });
  assert.ok(Math.abs(built[0].alpha - 0.2) < 1e-9);

  layer.disable();
  assert.equal(scene.preRender.listeners.length, 0, 'disable listener odpojí');
  layer.enable();
  assert.equal(scene.preRender.listeners.length, 1, 'enable ho pripojí znova, nie dvakrát');
  layer.destroy();
  assert.equal(scene.preRender.listeners.length, 0);
});
