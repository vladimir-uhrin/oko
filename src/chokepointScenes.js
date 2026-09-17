// src/chokepointScenes.js — curated "maritime chokepoint" scenes.
//
// A chokepoint scene is a one-shot PRESET, not a cinematic clip: it enables the
// maritime-intelligence layers OKO already ships, frames the camera on a strait,
// and drops one labelled annotation. It deliberately does NOT hijack the
// cinematic scene director (src/scenes/) — that engine hides every panel and
// bakes in post-processing for social-clip capture, which fights the
// interactive vessel cards + reticle this app is built around. The intent is the
// same "reveal" the upstream author demonstrated over the Strait of Hormuz
// (ccZzOGnT4Cg), assembled from layers we can already show honestly.
//
// This module is PURE (no Cesium, no DOM). The impure edges — enabling a layer,
// flying the Cesium camera, calling the annotation engine — are injected into
// applyChokepointScene() as functions, so the catalog, the layer plan, the
// annotation spec and the framing are all unit-testable in Node without a
// bundler. main.js wires the real dependencies and the URL / window triggers.

import { t } from './i18n.js';
import { REGISTERED_LAYER_IDS } from './data/layerState.js';

/**
 * Maritime-intelligence layer set a chokepoint scene turns on, in enable order.
 *
 * Chosen to match the upstream "chokehold on oil" story using ONLY layers OKO
 * already has, and to stay clear of a known failure mode: GFW returns 429 when
 * satellite AIS (`gfw-presence`) and SAR (`gfw-sar`) are pulled at once (see the
 * OKO "lode" memory), so a scene enables the SAR half — the dark-vessel radar —
 * and leaves presence for a manual switch-on.
 *
 * - ais-live-vessels   — live terrestrial AIS (the vessels actually moving now)
 * - aishub-vessels     — delayed AIS via AISHub (fills gaps, always labelled late)
 * - gfw-sar            — Sentinel-1 radar detections: ships with AIS switched off
 * - gas-pipelines      — pipeline infrastructure near the strait (OSM snapshot)
 * - local-shipping-lanes — the maritime corridors that DEFINE the chokepoint
 * - local-ports        — ports framing the trade either side of the strait
 *
 * @constant {ReadonlyArray<string>}
 */
export const CHOKEPOINT_SCENE_LAYERS = Object.freeze([
  'ais-live-vessels',
  'aishub-vessels',
  'gfw-sar',
  'gas-pipelines',
  'local-shipping-lanes',
  'local-ports',
]);

/** Palette token understood by the annotation renderer (worldAnnotationRenderer PALETTE). */
const CHOKEPOINT_MARK_COLOR = 'amber';

/**
 * The curated straits. `center` is [lon, lat]-free on purpose — it uses named
 * fields to avoid the lon/lat vs lat/lon confusion that has bitten the vessel
 * layers. `rectDegrees` is [west, south, east, north] in degrees, the exact
 * shape Cesium.Rectangle.fromDegrees and the first-run missions already consume.
 * `name` is the stable English identity (used by tests and as the honest
 * fallback when a translation is missing); the shown label/subtitle come from
 * i18n `chokepoint.<id>.*`.
 *
 * @constant {ReadonlyArray<{id:string,name:string,center:{lat:number,lon:number},rectDegrees:ReadonlyArray<number>}>}
 */
export const CHOKEPOINT_SCENES = Object.freeze([
  Object.freeze({
    id: 'hormuz',
    name: 'Strait of Hormuz',
    center: Object.freeze({ lat: 26.57, lon: 56.25 }),
    rectDegrees: Object.freeze([54.0, 24.2, 58.6, 28.2]),
  }),
  Object.freeze({
    id: 'malacca',
    name: 'Strait of Malacca',
    center: Object.freeze({ lat: 2.9, lon: 101.3 }),
    rectDegrees: Object.freeze([98.5, 1.0, 104.5, 5.5]),
  }),
  Object.freeze({
    id: 'bab-el-mandeb',
    name: 'Bab-el-Mandeb',
    center: Object.freeze({ lat: 12.6, lon: 43.4 }),
    rectDegrees: Object.freeze([41.8, 11.4, 44.6, 14.0]),
  }),
  Object.freeze({
    id: 'suez',
    name: 'Suez Canal',
    center: Object.freeze({ lat: 30.6, lon: 32.35 }),
    rectDegrees: Object.freeze([31.5, 29.3, 33.2, 31.6]),
  }),
  Object.freeze({
    id: 'bosphorus',
    name: 'Bosphorus',
    center: Object.freeze({ lat: 41.1, lon: 29.05 }),
    rectDegrees: Object.freeze([28.4, 40.5, 29.6, 41.5]),
  }),
  Object.freeze({
    id: 'panama',
    name: 'Panama Canal',
    center: Object.freeze({ lat: 9.1, lon: -79.7 }),
    rectDegrees: Object.freeze([-80.6, 8.5, -78.8, 9.6]),
  }),
  Object.freeze({
    id: 'gibraltar',
    name: 'Strait of Gibraltar',
    center: Object.freeze({ lat: 35.97, lon: -5.5 }),
    rectDegrees: Object.freeze([-6.3, 35.6, -4.7, 36.4]),
  }),
  Object.freeze({
    id: 'dover',
    name: 'Strait of Dover',
    center: Object.freeze({ lat: 51.0, lon: 1.45 }),
    rectDegrees: Object.freeze([0.7, 50.6, 2.2, 51.4]),
  }),
]);

/**
 * Fail loudly at module load if the catalog drifts from reality: every scene
 * layer must be a registered layer id, and every rectangle must be a sane
 * [W,S,E,N] box that actually contains the scene's own centre. A typo here would
 * otherwise surface as a silently dead tile or a camera flight to the ocean.
 *
 * @param {ReadonlyArray} [scenes]
 * @param {ReadonlyArray<string>} [layers]
 * @returns {true}
 */
export function validateChokepointScenes(scenes = CHOKEPOINT_SCENES, layers = CHOKEPOINT_SCENE_LAYERS) {
  const registered = new Set(REGISTERED_LAYER_IDS);
  for (const layerId of layers) {
    if (!registered.has(layerId)) throw new Error(`Chokepoint scene layer not registered: ${layerId}`);
  }
  const ids = new Set();
  for (const scene of scenes) {
    if (!scene || typeof scene.id !== 'string' || !scene.id) throw new Error('Chokepoint scene missing id');
    if (ids.has(scene.id)) throw new Error(`Duplicate chokepoint scene id: ${scene.id}`);
    ids.add(scene.id);
    const { lat, lon } = scene.center || {};
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`Chokepoint scene bad center: ${scene.id}`);
    const rect = scene.rectDegrees || [];
    if (rect.length !== 4 || !rect.every(Number.isFinite)) throw new Error(`Chokepoint scene bad rect: ${scene.id}`);
    const [west, south, east, north] = rect;
    if (!(west < east) || !(south < north)) throw new Error(`Chokepoint scene inverted rect: ${scene.id}`);
    if (lon < west || lon > east || lat < south || lat > north) {
      throw new Error(`Chokepoint scene center outside rect: ${scene.id}`);
    }
    const sceneLayers = scene.layerIds || layers;
    for (const layerId of sceneLayers) {
      if (!registered.has(layerId)) throw new Error(`Chokepoint scene ${scene.id} layer not registered: ${layerId}`);
    }
  }
  return true;
}

validateChokepointScenes();

/** All curated chokepoint scenes. */
export function listChokepointScenes() {
  return CHOKEPOINT_SCENES;
}

/** One scene by id, or null. Case/space-insensitive on the id. */
export function chokepointSceneById(id) {
  const key = String(id ?? '').trim().toLowerCase();
  if (!key) return null;
  return CHOKEPOINT_SCENES.find((scene) => scene.id === key) || null;
}

/** Layer ids a scene enables (per-scene override, else the shared set). */
export function chokepointSceneLayerIds(scene) {
  return scene?.layerIds ? scene.layerIds : CHOKEPOINT_SCENE_LAYERS;
}

/** [W,S,E,N] framing rectangle for a scene. */
export function chokepointSceneRectangle(scene) {
  return scene?.rectDegrees || null;
}

/** Translated display label for the strait (honest EN fallback via the raw name). */
export function chokepointSceneLabel(scene, translate = t) {
  if (!scene) return '';
  const key = `chokepoint.${scene.id}.name`;
  const translated = translate(key);
  return translated === key ? scene.name : translated;
}

/** Translated one-line "why it matters" subtitle, or '' when none is defined. */
export function chokepointSceneSubtitle(scene, translate = t) {
  if (!scene) return '';
  const key = `chokepoint.${scene.id}.subtitle`;
  const translated = translate(key);
  return translated === key ? '' : translated;
}

/**
 * Annotation engine request(s) that mark the chokepoint: one labelled pin at the
 * strait centre, anchored by explicit coordinates so it never depends on the
 * geocoder resolving an open-water place name.
 *
 * @param {object} scene
 * @param {(key:string)=>string} [translate]
 * @returns {Array<object>}
 */
export function chokepointSceneAnnotationRequests(scene, translate = t) {
  if (!scene?.center) return [];
  return [{
    type: 'pin',
    latitude: scene.center.lat,
    longitude: scene.center.lon,
    label: chokepointSceneLabel(scene, translate),
    color: CHOKEPOINT_MARK_COLOR,
  }];
}

/**
 * Apply a chokepoint scene: enable its layers, frame the camera on the strait,
 * and mark it. Every side effect is an injected function so this is testable and
 * so main.js keeps ownership of Cesium and the data manager.
 *
 * The camera flight is framing, not the payload — a stalled or superseded flight
 * never fails the scene (same contract as the first-run missions). Layer enables
 * decide success; the annotation is best-effort. Framing is issued LAST, after
 * the mark is drawn, so the strait view is the final camera authority: the
 * annotation engine nudges the camera to keep a fresh mark on-screen, which would
 * otherwise strand the scene zoomed onto the single pin instead of the chokepoint.
 *
 * @param {string} id Scene id (e.g. 'hormuz').
 * @param {object} deps
 * @param {(layerId:string)=>Promise<boolean>|boolean} deps.setLayerEnabled
 * @param {(rectDegrees:ReadonlyArray<number>)=>any} [deps.flyToRegion]
 * @param {(requests:Array<object>)=>Promise<any>|any} [deps.annotate]
 * @param {(key:string)=>string} [deps.translate]
 * @returns {Promise<{ok:boolean,id:string,scene?:object,failedLayerIds:string[],annotated:boolean,error?:string}>}
 */
export async function applyChokepointScene(id, {
  setLayerEnabled,
  flyToRegion,
  annotate,
  translate = t,
} = {}) {
  const scene = chokepointSceneById(id);
  if (!scene) return { ok: false, id: String(id ?? ''), failedLayerIds: [], annotated: false, error: 'unknown-chokepoint' };
  if (typeof setLayerEnabled !== 'function') {
    return { ok: false, id: scene.id, scene, failedLayerIds: [], annotated: false, error: 'no-layer-enabler' };
  }

  const outcomes = await Promise.all(chokepointSceneLayerIds(scene).map(async (layerId) => {
    try {
      return { layerId, ok: (await setLayerEnabled(layerId)) !== false };
    } catch {
      return { layerId, ok: false };
    }
  }));

  let annotated = false;
  if (typeof annotate === 'function') {
    try {
      const requests = chokepointSceneAnnotationRequests(scene, translate);
      const result = await annotate(requests);
      annotated = result == null ? true : Boolean(result.ok ?? (result.drawn > 0));
    } catch {
      annotated = false;
    }
  }

  // Frame the strait LAST — see the JSDoc: this call must win over the annotation
  // engine's make-mark-visible nudge. A rejected flight never fails the scene.
  const rect = chokepointSceneRectangle(scene);
  if (rect && typeof flyToRegion === 'function') {
    try { await flyToRegion(rect); } catch { /* framing is best-effort */ }
  }

  const failedLayerIds = outcomes.filter((entry) => !entry.ok).map((entry) => entry.layerId);
  return { ok: failedLayerIds.length === 0, id: scene.id, scene, failedLayerIds, annotated };
}
