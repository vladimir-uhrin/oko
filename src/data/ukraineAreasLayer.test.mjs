// src/data/ukraineAreasLayer.test.mjs — plochy K2: meta, výber dlaždíc podľa kamery,
// dávkové primitívy (polygóny s dierami, lesný materiál, železnica na teréne, bez
// pickingu), prahy výšky a plochy, fotoreál = nič, čip, LRU, destroy.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';

import { FOREST_MATERIAL_TYPE, ForestDotsMaterialProperty, UKRAINE_AREAS_ID, buildTilePrimitives, createUkraineAreasLayer, ensureForestMaterial } from './ukraineAreasLayer.js';

// Node nemá WebGL kontext: šírky čiar sú 0..0 a PolylineColorAppearance by padla
// na „lineWidth is out of range" — nasadíme bežné limity prehliadača.
Cesium.ContextLimits._minimumAliasedLineWidth = 1;
Cesium.ContextLimits._maximumAliasedLineWidth = 8;

const META = { snapshot: '2026-09-20T00:10:00.000Z', tiles: { N48E037: { bbox: [37, 48, 38, 49] }, N49E037: { bbox: [37, 49, 38, 50] }, N47E036: { bbox: [36, 47, 37, 48] } } };
const sq = (lon, lat, d) => [[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]];
const TILES = {
  N48E037: { key: 'N48E037', built: [[sq(37.2, 48.2, 0.02)], [sq(37.5, 48.6, 0.01)], [sq(37.6, 48.6, 0.001)]], forest: [[sq(37.4, 48.4, 0.1), sq(37.44, 48.44, 0.02)]], water: [[sq(37.7, 48.7, 0.03)]], rail: [[[37.0, 48.5], [37.9, 48.55]]] },
  N49E037: { key: 'N49E037', built: [[sq(37.3, 49.3, 0.02)]], forest: [], water: [], rail: [] },
  N47E036: { key: 'N47E036', built: [[sq(36.3, 47.3, 0.02)]], forest: [], water: [], rail: [] },
};
function fakeViewer({ height = 120_000, lat = 48.9, lon = 37.8, rect = [37.2, 48.6, 38.4, 49.3] } = {}) {
  const listeners = [];
  const camera = {
    positionCartographic: { height, latitude: Cesium.Math.toRadians(lat), longitude: Cesium.Math.toRadians(lon) },
    computeViewRectangle: () => (rect ? Cesium.Rectangle.fromDegrees(...rect) : undefined),
    moveEnd: { listeners, addEventListener(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; } },
  };
  const groundPrimitives = { items: [], removed: [], add(p) { this.items.push(p); return p; }, remove(p) { const i = this.items.indexOf(p); if (i >= 0) this.items.splice(i, 1); this.removed.push(p); return i >= 0; } };
  return { camera, scene: { requestRender() {}, groundPrimitives } };
}
const timers = () => { const pending = []; return { setTimer: (fn) => { pending.push(fn); return pending.length; }, clearTimer: (id) => { pending[id - 1] = null; }, flush() { for (const fn of pending.splice(0)) if (fn) fn(); } }; };
// Material.fromType v Node padá na HTMLCanvasElement → falošný materiál s typom (Appearance ho len drží).
const fakeMaterial = (type, uniforms) => ({ type, uniforms: uniforms || {}, isFake: true });
const settle = () => new Promise((r) => setTimeout(r, 0));

function make(overrides = {}) {
  const viewer = overrides.viewer || fakeViewer(overrides.camera);
  const calls = [];
  const clock = timers();
  let stack = overrides.stack || { id: 'osm', kind: 'osm' };
  const stackListeners = [];
  const layer = createUkraineAreasLayer({
    viewer,
    fetchImpl: async (url) => { calls.push(String(url)); const key = String(url).split('/').pop(); if (key === 'meta') return { ok: true, json: async () => overrides.meta || META }; const t = TILES[key]; return t ? { ok: true, json: async () => t } : { ok: false, status: 404, json: async () => ({}) }; },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    activeStack: () => stack,
    onStackChange: (fn) => { stackListeners.push(fn); return () => {}; },
    maxTiles: overrides.maxTiles ?? 6,
    cacheTiles: overrides.cacheTiles ?? 12,
    now: () => calls.length,
    materialFactory: fakeMaterial,
  });
  return { layer, viewer, calls, clock, setStack: (s) => { stack = s; for (const fn of stackListeners) fn(s); } };
}

test('materiál lesných bodiek je registrovaný raz; MaterialProperty ho menuje; bez cache = false', () => {
  assert.equal(ensureForestMaterial(Cesium), true);
  assert.equal(ensureForestMaterial(Cesium), true, 'druhé volanie nič nerozbije');
  assert.ok(Cesium.Material._materialCache.getMaterial(FOREST_MATERIAL_TYPE));
  const p = new ForestDotsMaterialProperty();
  assert.equal(p.getType(), FOREST_MATERIAL_TYPE);
  assert.equal(p.getValue().spacing, 7);
  assert.equal(ensureForestMaterial({}), false);
});

test('buildTilePrimitives: voda + zástavba farebné (PerInstanceColor), les s materiálom bodiek, železnica čiarkovaná na teréne; všetko bez pickingu, BOTH', () => {
  ensureForestMaterial(Cesium);
  const prims = buildTilePrimitives('N48E037', TILES.N48E037, { materialFactory: fakeMaterial });
  assert.equal(prims.length, 4);
  const [water, built, forest, rail] = prims;
  assert.ok(water instanceof Cesium.GroundPrimitive && built instanceof Cesium.GroundPrimitive && forest instanceof Cesium.GroundPrimitive);
  assert.ok(rail instanceof Cesium.GroundPolylinePrimitive);
  assert.equal(built.geometryInstances.length, 3);
  assert.ok(built.appearance instanceof Cesium.PerInstanceColorAppearance);
  assert.ok(forest.appearance instanceof Cesium.MaterialAppearance);
  assert.equal(forest.appearance.material.type, FOREST_MATERIAL_TYPE);
  assert.equal(forest.geometryInstances[0].geometry._polygonHierarchy.holes.length, 1, 'diera v lese');
  assert.equal(rail.appearance.material.type, 'PolylineDash');
  for (const p of prims) { assert.equal(p.allowPicking, false); assert.equal(p.classificationType, Cesium.ClassificationType.BOTH); }
  const fallback = buildTilePrimitives('N48E037', TILES.N48E037, { forestMaterialOk: false, materialFactory: fakeMaterial });
  assert.ok(fallback[2].appearance instanceof Cesium.PerInstanceColorAppearance, 'bez cache materiálov = farba');
  const broken = buildTilePrimitives('N48E037', TILES.N48E037, { materialFactory: () => { throw new Error('no DOM'); } });
  assert.ok(broken[2].appearance instanceof Cesium.PerInstanceColorAppearance, 'materiál nedostupný → farba');
  assert.ok(broken[3].appearance instanceof Cesium.PolylineColorAppearance, 'čiarkovanie nedostupné → farebná čiara');
  assert.equal(buildTilePrimitives('x', { built: [], forest: [], water: [], rail: [] }, { materialFactory: fakeMaterial }).length, 0);
});

test('bez viewera neškodné', async () => {
  const layer = createUkraineAreasLayer({});
  assert.equal(await layer.show(), false);
  assert.equal(layer.getState().error, 'no-viewer');
});

test('show: meta, výber dlaždíc podľa pohľadu (2 z 3), primitívy v scene.groundPrimitives, prah plochy vyhodí drobnú zástavbu, počty v stave', async () => {
  const { layer, viewer, calls } = make();
  assert.equal(await layer.show(), true);
  await settle();
  const state = layer.getState();
  assert.deepEqual(state.visibleKeys.sort(), ['N48E037', 'N49E037'], 'N47E036 nepretína pohľad');
  assert.equal(state.tilesAvailable, 3);
  assert.equal(calls.filter((u) => u.endsWith('/meta')).length, 1);
  assert.deepEqual(state.counts, { built: 3, forest: 1, water: 1, rail: 1 }, '0,001° štvorec (0,008 km²) vypadol');
  const { tiles } = layer._getStateForTest();
  const t = tiles.get('N48E037');
  assert.equal(t.loaded, true);
  assert.equal(t.prims.length, 4);
  assert.equal(viewer.scene.groundPrimitives.items.length, 5, '4 + 1 primitív');
  assert.ok(t.prims.every((p) => p.show === true));
});

test('prah výšky: nad 420 km sa všetko skryje, po zostupe a ustálení kamery sa vráti bez nového fetchu', async () => {
  const { layer, viewer, calls, clock } = make();
  await layer.show(); await settle();
  const before = calls.length;
  viewer.camera.positionCartographic.height = 600_000;
  for (const fn of viewer.camera.moveEnd.listeners) fn();
  clock.flush();
  assert.equal(layer.getState().tilesVisible, 0);
  assert.ok(layer._getStateForTest().tiles.get('N48E037').prims.every((p) => p.show === false));
  viewer.camera.positionCartographic.height = 90_000;
  for (const fn of viewer.camera.moveEnd.listeners) fn();
  clock.flush();
  assert.equal(layer.getState().tilesVisible, 2);
  assert.equal(calls.length, before, 'dlaždice ostali v pamäti');
});

test('fotoreál (glóbus skrytý) = nič; návrat na glóbusový podklad ich vráti; čip PLOCHY vypne a zapne', async () => {
  const { layer, clock, setStack } = make();
  await layer.show(); await settle();
  setStack({ id: 'photoreal', kind: 'photoreal' });
  clock.flush();
  assert.equal(layer.getState().tilesVisible, 0);
  setStack({ id: 'karta', kind: 'hillshade' });
  clock.flush();
  assert.equal(layer.getState().tilesVisible, 2);
  layer.setEnabled(false);
  assert.equal(layer.getState().tilesVisible, 0); assert.equal(layer.isEnabled(), false);
  layer.setEnabled(true);
  assert.equal(layer.getState().tilesVisible, 2);
});

test('LRU: nad strop pamäte sa neviditeľné dlaždice uvoľnia (primitívy odobraté), chýbajúca dlaždica 404 nezhodí ostatné', async () => {
  const { layer, viewer, clock } = make({ cacheTiles: 2, camera: { rect: [36.2, 47.2, 38.4, 49.9], lat: 48.9, lon: 37.8 } });
  await layer.show(); await settle();
  assert.equal(layer.getState().tilesVisible, 3);
  viewer.camera.computeViewRectangle = () => Cesium.Rectangle.fromDegrees(36.2, 47.2, 36.9, 47.9);
  viewer.camera.positionCartographic.latitude = Cesium.Math.toRadians(47.5);
  viewer.camera.positionCartographic.longitude = Cesium.Math.toRadians(36.5);
  for (const fn of viewer.camera.moveEnd.listeners) fn();
  clock.flush();
  assert.deepEqual(layer.getState().visibleKeys, ['N47E036']);
  assert.equal(layer._getStateForTest().tiles.size, 2, 'strop 2: jedna neviditeľná uvoľnená');
  assert.ok(viewer.scene.groundPrimitives.removed.length >= 1);
  const { layer: l2 } = make({ meta: { tiles: { N48E037: META.tiles.N48E037, N48E038: { bbox: [38, 48, 39, 49] } } }, camera: { rect: [37.2, 48.2, 38.9, 48.9], lat: 48.5, lon: 38 } });
  await l2.show(); await settle();
  const st = l2.getState();
  assert.equal(st.tilesVisible, 2);
  assert.equal(l2._getStateForTest().tiles.get('N48E038').error, 'HTTP 404');
  assert.equal(l2._getStateForTest().tiles.get('N48E037').loaded, true);
});

test('meta 404 = no_snapshot, show false; destroy odoberie primitívy a poslucháčov', async () => {
  const viewer = fakeViewer();
  const layer = createUkraineAreasLayer({ viewer, fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }), activeStack: () => ({ kind: 'osm' }), onStackChange: () => () => {} });
  assert.equal(await layer.show(), false);
  assert.equal(layer.getState().error, 'no_snapshot');
  const { layer: l, viewer: v } = make();
  await l.show(); await settle();
  l.destroy();
  assert.equal(l._getStateForTest().tiles.size, 0);
  assert.equal(v.scene.groundPrimitives.items.length, 0);
  assert.equal(v.camera.moveEnd.listeners.length, 0);
  assert.equal(await l.show(), false);
});
