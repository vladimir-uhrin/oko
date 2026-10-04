// src/eventVideoCapture.test.mjs — scéna 3D videa udalosti v OKO (2026-10-01). Testy SPRÁVANIA bez
// WebGL: každá snímka sa naozaj nakreslí aj pri nehybnej kamere (úsporný režim appky by ju preskočil —
// naživo FZ1073 dal spomalený pád tri rovnaké snímky), lietadlo a kamera podľa stavu snímky, preletená
// stopa a diera čiarkovane od začiatku diery, bledé lietadlo v diere bez dorovnania stopy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { installEventVideoScene } from './eventVideoCapture.js';

// Billboard v Node (bez DOM) porovnáva obrázok s triedami prehliadača — stačia prázdne triedy.
globalThis.HTMLCanvasElement ??= class {};
globalThis.HTMLImageElement ??= class {};
globalThis.HTMLVideoElement ??= class {};
globalThis.ImageBitmap ??= class {};
globalThis.OffscreenCanvas ??= class {};

function fakeViewer() {
  const calls = [];
  const prims = [];
  const viewer = {
    calls,
    prims,
    clock: {},
    scene: {
      requestRenderMode: true,
      primitives: { add: (p) => { prims.push(p); return p; }, remove: (p) => { const i = prims.indexOf(p); if (i >= 0) prims.splice(i, 1); } },
      requestRender: () => calls.push('requestRender'),
      globe: { tilesLoaded: true },
      camera: {},
    },
    camera: {
      lookAt: (target, hpr) => calls.push(['lookAt', target, hpr]),
      lookAtTransform: () => calls.push('lookAtTransform'),
      lookDown: (a) => calls.push(['lookDown', a]),
    },
    render: () => calls.push('render'),
  };
  return viewer;
}

const T0 = 1_790_000_000;
// Stopa [t, lat, lon, výška m]: tri merania, diera 10 min, dve merania.
const track = [[T0, 30, 38, 10_000], [T0 + 60, 30, 37.9, 9_800], [T0 + 120, 30, 37.8, 9_500], [T0 + 720, 30.5, 37.5, 4_600], [T0 + 780, 30.5, 37.4, 4_600]];
const sceneData = { track, focusFrom: T0, focusTo: T0 + 780, gapS: 300, moments: [] };
const state = (over = {}) => ({
  t: T0 + 90, ghost: 0, flown: 1,
  plane: { lat: 30, lon: 37.85, altM: 9_650, trk: 270, dim: false },
  moments: [],
  camera: { lat: 30.1, lon: 37.9, altM: 4_000, heading: 10, pitch: -27, range: 88_000, lookDown: 0 },
  ...over,
});

test('každá snímka sa nakreslí aj pri nehybnej kamere: úsporný režim vypnutý, prekreslenie vyžiadané pred kreslením', () => {
  const viewer = fakeViewer();
  const scene = installEventVideoScene(viewer, sceneData);
  assert.equal(viewer.scene.requestRenderMode, false);
  viewer.scene.requestRenderMode = true; // správca kreslenia appky ho medzitým zapne
  viewer.calls.length = 0;
  scene.render();
  assert.equal(viewer.scene.requestRenderMode, false);
  assert.deepEqual(viewer.calls, ['requestRender', 'render']);
});

test('stav snímky: kamera, lietadlo, preletená stopa; v diere bledé lietadlo, diera čiarkovane od jej začiatku, stopa sa nedorovnáva', () => {
  const viewer = fakeViewer();
  const scene = installEventVideoScene(viewer, sceneData);
  const lines = viewer.prims.filter((p) => p instanceof Cesium.PolylineCollection)[1];
  const bbs = viewer.prims.find((p) => p instanceof Cesium.BillboardCollection);
  const plane = bbs.get(bbs.length - 1);
  const segShow = () => Array.from({ length: track.length - 1 }, (_, i) => lines.get(i).show);
  const partial = () => lines.get(track.length - 1);

  viewer.calls.length = 0;
  scene.apply(state());
  const look = viewer.calls.find((c) => Array.isArray(c) && c[0] === 'lookAt');
  const target = Cesium.Cartographic.fromCartesian(look[1]);
  assert.ok(Math.abs(Cesium.Math.toDegrees(target.latitude) - 30.1) < 1e-6 && Math.abs(Cesium.Math.toDegrees(target.longitude) - 37.9) < 1e-6);
  assert.ok(Math.abs(look[2].heading - Cesium.Math.toRadians(10)) < 1e-9 && Math.abs(look[2].pitch - Cesium.Math.toRadians(-27)) < 1e-9 && look[2].range === 88_000);
  assert.ok(viewer.calls.includes('lookAtTransform'), 'kamera uvoľnená z cieľa');
  assert.ok(!viewer.calls.some((c) => Array.isArray(c) && c[0] === 'lookDown'), 'bez posunu záberu');
  assert.ok(Cesium.Cartesian3.equalsEpsilon(plane.position, Cesium.Cartesian3.fromDegrees(37.85, 30, 9_650), 1e-3));
  assert.equal(plane.color.alpha, 1);
  assert.deepEqual(segShow(), [true, false, false, false], 'preletený prvý úsek');
  assert.equal(partial().show, true, 'kúsok k lietadlu');
  const walls = () => viewer.prims.filter((p) => p instanceof Cesium.Primitive).length;
  assert.equal(walls(), 2, 'záves pod stopou + kúsok k lietadlu');

  // V diere: lietadlo bledé na poslednom meraní, diera čiarkovane, žiadny kúsok k lietadlu.
  scene.apply(state({ t: T0 + 400, flown: 2, plane: { lat: 30, lon: 37.8, altM: 9_500, trk: 270, dim: true }, camera: { ...state().camera, lookDown: 9 } }));
  assert.equal(plane.color.alpha, 0.5);
  assert.deepEqual(segShow(), [true, true, true, false], 'diera (3. úsek) čiarkovane od začiatku diery');
  assert.equal(partial().show, false);
  assert.equal(walls(), 1, 'kúsok závesu k lietadlu preč');
  assert.ok(viewer.calls.some((c) => Array.isArray(c) && c[0] === 'lookDown' && Math.abs(c[1] - Cesium.Math.toRadians(9)) < 1e-9), 'záber posunutý nad kartu');
  assert.ok(Cesium.JulianDate.equals(viewer.clock.currentTime, Cesium.JulianDate.fromDate(new Date((T0 + 400) * 1000))), 'čas scény = čas udalosti (obloha)');
});
