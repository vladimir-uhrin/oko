// src/data/ukraineAreasLayer.js
/**
 * @module ukraineAreasLayer
 * @description Plochy OSM pre kartografický režim KARTA (etapa K2, 2026-09-20):
 * zástavba (svetlosivá), lesy (tmavozelené s bielymi bodkami v obrazovkových
 * pixeloch — vlastný Fabric materiál cez gl_FragCoord), vodné plochy a železnice
 * (čiarkovaná čiara na teréne). Dáta po dlaždiciach 1°×1° z
 * `/api/ukraine/base/areas/<N48E037>` (scripts/build-ukraine-areas.mjs, ODbL).
 *
 * Správanie: kreslí len pod AREAS_MAX_HEIGHT_M (420 km) a len na glóbusových
 * podkladoch (na Google 3D by sivé polygóny prekryli skutočné budovy — fotoreál
 * skrýva glóbus, takže ich nekreslíme vôbec). Po ustálení kamery vyberie
 * najviac 6 dlaždíc pretínajúcich pohľad (najbližšie k stredu), načíta chýbajúce,
 * skryje ostatné a nad 12 dlaždíc v pamäti uvoľní najstaršie (LRU). Každá
 * dlaždica = štyri dávkové primitívy (GroundPrimitive na triedu polygónov,
 * GroundPolylinePrimitive na železnice) v `scene.groundPrimitives`, bez
 * pickingu — entity boli primalé: 27 000 polygónov na 4 dlaždice zablokovalo
 * hlavné vlákno a glóbus ostal čierny (meranie 2026-09-20). Polygóny sú na
 * teréne (classificationType BOTH), bez výšky — netreba zdvíhať; pred kreslením
 * sa ešte prefiltrujú prahom plochy (ukraineAreas.filterAreasForDraw).
 *
 * Čip PLOCHY v paneli UKRAJINA je len vypínač (`setEnabled`); zobrazenie
 * sleduje podklad UKRAJINA (main.js: base.onChange → show/hide).
 */
import * as Cesium from 'cesium';
import { AREAS_CACHE_TILES, AREAS_MAX_HEIGHT_M, AREAS_MAX_TILES, AREAS_STYLE, UKRAINE_AREAS_API, areasWanted, fallbackRect, filterAreasForDraw, pickAreaTiles } from './ukraineAreas.js';
import { getActiveMapStack, isGlobeHiddenForStack, onActiveMapStackChange } from './activeMapStack.js';

export const UKRAINE_AREAS_ID = 'ukraine-areas';
export const AREAS_SETTLE_MS = 350;
export const FOREST_MATERIAL_TYPE = 'OkoForestDots';

/**
 * Zaregistruje materiál lesných bodiek (raz na proces). Bodky sú v obrazovkových
 * pixeloch (gl_FragCoord), takže hustota nezávisí od priblíženia — ako v Rybarovej
 * mape. Vracia false, keď Cesium nemá cache materiálov (testy bez GL).
 */
export function ensureForestMaterial(CesiumRef = Cesium) {
  const cache = CesiumRef?.Material?._materialCache;
  if (!cache?.addMaterial) return false;
  if (cache.getMaterial?.(FOREST_MATERIAL_TYPE)) return true;
  const f = AREAS_STYLE.forest;
  cache.addMaterial(FOREST_MATERIAL_TYPE, {
    fabric: {
      type: FOREST_MATERIAL_TYPE,
      uniforms: {
        color: CesiumRef.Color.fromCssColorString(f.color).withAlpha(f.alpha),
        dotColor: CesiumRef.Color.fromCssColorString(f.dotColor).withAlpha(f.dotAlpha),
        spacing: f.spacingPx,
        radius: f.radius,
      },
      source: `czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material m = czm_getDefaultMaterial(materialInput);
  vec2 p = gl_FragCoord.xy / spacing;
  float d = length(fract(p) - 0.5);
  float dot = 1.0 - smoothstep(radius - 0.06, radius + 0.06, d);
  float a = mix(color.a, max(color.a, dotColor.a), dot);
  vec3 rgb = mix(color.rgb, dotColor.rgb, dot * dotColor.a / max(a, 0.001));
  m.diffuse = rgb;
  m.alpha = a;
  return m;
}`,
    },
    translucent: true,
  });
  return true;
}

/** MaterialProperty entity → registrovaný materiál (vzor ColorMaterialProperty). */
export class ForestDotsMaterialProperty {
  constructor(uniforms = {}) {
    const f = AREAS_STYLE.forest;
    this._uniforms = {
      color: Cesium.Color.fromCssColorString(f.color).withAlpha(f.alpha),
      dotColor: Cesium.Color.fromCssColorString(f.dotColor).withAlpha(f.dotAlpha),
      spacing: f.spacingPx,
      radius: f.radius,
      ...uniforms,
    };
    this._definitionChanged = new Cesium.Event();
  }
  get isConstant() { return true; }
  get definitionChanged() { return this._definitionChanged; }
  getType() { return FOREST_MATERIAL_TYPE; }
  getValue(time, result) { const r = result || {}; Object.assign(r, this._uniforms); return r; }
  equals(other) { return other === this; }
}

const color = (css, alpha) => Cesium.Color.fromCssColorString(css).withAlpha(alpha);
const positions = (ring) => Cesium.Cartesian3.fromDegreesArray(ring.flat());

/** Geometrické inštancie polygónov jednej triedy (diery ako PolygonHierarchy). */
function polygonInstances(key, cls, polygons, colorValue) {
  const out = [];
  polygons.forEach((rings, i) => {
    const [outer, ...holes] = rings;
    if (!outer || outer.length < 4) return;
    try {
      out.push(new Cesium.GeometryInstance({
        id: `${UKRAINE_AREAS_ID}:${key}:${cls}:${i}`,
        geometry: new Cesium.PolygonGeometry({
          polygonHierarchy: new Cesium.PolygonHierarchy(positions(outer), holes.filter((h) => h.length >= 4).map((h) => new Cesium.PolygonHierarchy(positions(h)))),
          arcType: Cesium.ArcType.GEODESIC,
        }),
        attributes: colorValue ? { color: Cesium.ColorGeometryInstanceAttribute.fromColor(colorValue) } : undefined,
      }));
    } catch { /* degenerovaný prstenec */ }
  });
  return out;
}
/** Predvolená továreň materiálov (v Node bez DOM Material.fromType padá — testy si dajú vlastnú). */
export const defaultMaterialFactory = (type, uniforms, CesiumRef = Cesium) => CesiumRef.Material.fromType(type, uniforms);

/** Dávkové primitívy dlaždice: [water, built] farebné, forest s materiálom bodiek, rail čiarkovaný. */
export function buildTilePrimitives(key, data, { forestMaterialOk = true, CesiumRef = Cesium, materialFactory = defaultMaterialFactory } = {}) {
  const prims = [];
  const material = (type, uniforms) => { try { return materialFactory(type, uniforms, CesiumRef); } catch (error) { console.warn(`[UkraineAreas] material ${type} unavailable:`, error?.message || error); return null; } };
  const solid = (cls) => {
    const st = AREAS_STYLE[cls];
    const instances = polygonInstances(key, cls, data[cls] || [], color(st.color, st.alpha));
    if (!instances.length) return;
    prims.push(new CesiumRef.GroundPrimitive({ geometryInstances: instances, appearance: new CesiumRef.PerInstanceColorAppearance({ flat: true, translucent: true }), classificationType: CesiumRef.ClassificationType.BOTH, allowPicking: false, asynchronous: true }));
  };
  solid('water');
  solid('built');
  // Les: bodkový materiál; bez neho (Node, chýbajúca cache) farba na inštanciu.
  const forestMaterial = forestMaterialOk ? material(FOREST_MATERIAL_TYPE) : null;
  const forest = polygonInstances(key, 'forest', data.forest || [], color(AREAS_STYLE.forest.color, AREAS_STYLE.forest.alpha));
  if (forest.length) {
    const appearance = forestMaterial
      ? new CesiumRef.MaterialAppearance({ material: forestMaterial, translucent: true, flat: true })
      : new CesiumRef.PerInstanceColorAppearance({ flat: true, translucent: true });
    prims.push(new CesiumRef.GroundPrimitive({ geometryInstances: forest, appearance, classificationType: CesiumRef.ClassificationType.BOTH, allowPicking: false, asynchronous: true }));
  }
  const railColor = color(AREAS_STYLE.rail.color, 0.85);
  const rail = [];
  (data.rail || []).forEach((line, i) => {
    if (!Array.isArray(line) || line.length < 2) return;
    try {
      rail.push(new CesiumRef.GeometryInstance({
        id: `${UKRAINE_AREAS_ID}:${key}:rail:${i}`,
        geometry: new CesiumRef.GroundPolylineGeometry({ positions: positions(line), width: AREAS_STYLE.rail.widthPx, arcType: CesiumRef.ArcType.GEODESIC }),
        attributes: { color: CesiumRef.ColorGeometryInstanceAttribute.fromColor(railColor) },
      }));
    } catch { /* degenerovaná čiara */ }
  });
  if (rail.length) {
    const dash = material('PolylineDash', { color: railColor, gapColor: color(AREAS_STYLE.rail.gapColor, 0.85), dashLength: AREAS_STYLE.rail.dashLength });
    const appearance = dash ? new CesiumRef.PolylineMaterialAppearance({ material: dash, translucent: true }) : new CesiumRef.PolylineColorAppearance({ translucent: true });
    prims.push(new CesiumRef.GroundPolylinePrimitive({ geometryInstances: rail, appearance, classificationType: CesiumRef.ClassificationType.BOTH, allowPicking: false, asynchronous: true }));
  }
  return prims;
}

/**
 * @param {object} o
 * @param {Cesium.Viewer} o.viewer
 */
export function createUkraineAreasLayer({
  viewer,
  api = UKRAINE_AREAS_API,
  fetchImpl = null,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  activeStack = getActiveMapStack,
  onStackChange = onActiveMapStackChange,
  maxTiles = AREAS_MAX_TILES,
  cacheTiles = AREAS_CACHE_TILES,
  maxHeightM = AREAS_MAX_HEIGHT_M,
  now = () => Date.now(),
  materialFactory = defaultMaterialFactory,
} = {}) {
  const inert = {
    id: UKRAINE_AREAS_ID, show: async () => false, hide() {}, setEnabled() {}, isEnabled: () => true, isShown: () => false, refresh() {},
    getState: () => ({ shown: false, enabled: true, loading: false, error: 'no-viewer', tilesAvailable: 0, tilesLoaded: 0, tilesVisible: 0, counts: { built: 0, forest: 0, water: 0, rail: 0 } }),
    onChange: () => () => {}, destroy() {},
  };
  if (!viewer?.scene) return inert;
  const scene = viewer.scene;
  const camera = viewer.camera || null;
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  const forestOk = ensureForestMaterial(Cesium);
  const groundPrimitives = scene?.groundPrimitives || null;

  let _shown = false;
  let _enabled = true;
  let _meta = null;
  let _metaPromise = null;
  let _error = null;
  let _destroyed = false;
  let _timer = null;
  let _removeMoveEnd = null;
  let _removeStack = null;
  const _tiles = new Map(); // key → { key, prims, show, loaded, loading, error, counts, lastUsed }
  const _listeners = new Set();

  const requestRender = () => { try { scene?.requestRender?.(); } catch { /* headless */ } };
  function getState() {
    const visible = [..._tiles.values()].filter((t) => t.show);
    const counts = { built: 0, forest: 0, water: 0, rail: 0 };
    for (const t of visible) for (const k of Object.keys(counts)) counts[k] += t.counts?.[k] || 0;
    return {
      shown: _shown, enabled: _enabled, loading: Boolean(_metaPromise) || [..._tiles.values()].some((t) => t.loading), error: _error,
      tilesAvailable: _meta ? Object.keys(_meta.tiles || {}).length : 0, tilesLoaded: [..._tiles.values()].filter((t) => t.loaded).length,
      tilesVisible: visible.length, visibleKeys: visible.map((t) => t.key), counts, snapshot: _meta?.snapshot || null,
    };
  }
  function emit() {
    const state = getState();
    for (const fn of _listeners) { try { fn(state); } catch (error) { console.warn('[UkraineAreas] listener error:', error); } }
  }

  async function fetchJson(url) {
    const res = await doFetch(url, { cache: 'default' });
    if (!res.ok) { const error = new Error(`HTTP ${res.status}`); error.status = res.status; throw error; }
    return res.json();
  }
  function loadMeta() {
    if (_meta) return Promise.resolve(_meta);
    if (!_metaPromise) {
      _metaPromise = fetchJson(`${api}/meta`)
        .then((meta) => { _meta = meta && typeof meta === 'object' && meta.tiles ? meta : { tiles: {} }; _error = null; return _meta; })
        .catch((error) => { _error = error?.status === 404 ? 'no_snapshot' : (error?.message || String(error)); _meta = { tiles: {} }; return _meta; })
        .finally(() => { _metaPromise = null; emit(); });
    }
    return _metaPromise;
  }

  function setTileShow(record, on) {
    record.show = Boolean(on);
    for (const p of record.prims) p.show = record.show;
  }
  function buildTile(record, data) {
    const drawn = filterAreasForDraw(data);
    record.prims = buildTilePrimitives(record.key, drawn, { forestMaterialOk: forestOk, materialFactory });
    for (const p of record.prims) { p.show = record.show; try { groundPrimitives?.add(p); } catch { /* headless */ } }
    record.counts = drawn.counts;
    record.sourceCounts = data.counts || null;
  }

  function ensureTile(key) {
    let record = _tiles.get(key);
    if (!record) {
      record = { key, prims: [], show: true, loaded: false, loading: true, error: null, counts: null, lastUsed: now() };
      _tiles.set(key, record);
      fetchJson(`${api}/${key}`)
        .then((data) => { if (_destroyed || !_tiles.has(key)) return; buildTile(record, data); record.loaded = true; })
        .catch((error) => { record.error = error?.message || String(error); console.warn(`[UkraineAreas] ${key} failed:`, record.error); })
        .finally(() => { record.loading = false; if (!_destroyed) { requestRender(); emit(); } });
    }
    record.lastUsed = now();
    return record;
  }
  function removeTile(key) {
    const record = _tiles.get(key);
    if (!record) return;
    for (const p of record.prims) { try { groundPrimitives?.remove(p); } catch { /* */ } }
    record.prims = [];
    _tiles.delete(key);
  }
  function hideAll() {
    let changed = false;
    for (const t of _tiles.values()) if (t.show) { setTileShow(t, false); changed = true; }
    if (changed) requestRender();
  }

  function cameraInfo() {
    const carto = camera?.positionCartographic;
    if (!carto) return null;
    const center = { lat: Cesium.Math.toDegrees(carto.latitude), lon: Cesium.Math.toDegrees(carto.longitude) };
    let rect = null;
    try {
      const r = camera.computeViewRectangle?.(Cesium.Ellipsoid.WGS84);
      if (r) rect = [Cesium.Math.toDegrees(r.west), Cesium.Math.toDegrees(r.south), Cesium.Math.toDegrees(r.east), Cesium.Math.toDegrees(r.north)];
    } catch { rect = null; }
    if (!rect || rect[2] - rect[0] > 12 || rect[3] - rect[1] > 12) rect = fallbackRect(center);
    return { center, rect, height: carto.height };
  }

  /** Prepočet viditeľných dlaždíc pre aktuálnu kameru (po ustálení; testy priamo). */
  function refresh() {
    if (_destroyed) return;
    const info = cameraInfo();
    const wanted = _shown && _enabled && _meta && info && areasWanted(info.height, maxHeightM) && !isGlobeHiddenForStack(activeStack());
    if (!wanted) { hideAll(); emit(); return; }
    const keys = pickAreaTiles({ rect: info.rect, center: info.center, available: Object.keys(_meta.tiles || {}), max: maxTiles });
    const keep = new Set(keys);
    for (const key of keys) { const rec = ensureTile(key); if (!rec.show) setTileShow(rec, true); }
    for (const [key, rec] of _tiles) if (!keep.has(key) && rec.show) setTileShow(rec, false);
    // LRU: nad strop pamäte uvoľniť najstaršie neviditeľné
    if (_tiles.size > cacheTiles) {
      const idle = [..._tiles.values()].filter((t) => !keep.has(t.key)).sort((a, b) => a.lastUsed - b.lastUsed);
      for (const t of idle) { if (_tiles.size <= cacheTiles) break; removeTile(t.key); }
    }
    requestRender();
    emit();
  }
  function schedule() {
    if (_timer) clearTimer(_timer);
    _timer = setTimer(() => { _timer = null; refresh(); }, AREAS_SETTLE_MS);
  }
  function installListeners() {
    if (!_removeMoveEnd && camera?.moveEnd?.addEventListener) _removeMoveEnd = camera.moveEnd.addEventListener(schedule);
    if (!_removeStack && typeof onStackChange === 'function') _removeStack = onStackChange(() => schedule());
  }

  async function show() {
    if (_destroyed) return false;
    _shown = true;
    installListeners();
    await loadMeta();
    if (_destroyed) return false;
    refresh();
    return Boolean(_meta && Object.keys(_meta.tiles || {}).length);
  }
  function hide() {
    _shown = false;
    if (_timer) { clearTimer(_timer); _timer = null; }
    hideAll();
    emit();
  }
  function setEnabled(on) {
    _enabled = Boolean(on);
    if (_enabled && _shown) refresh(); else { hideAll(); emit(); }
  }
  function destroy() {
    _destroyed = true;
    if (_timer) clearTimer(_timer);
    _removeMoveEnd?.(); _removeMoveEnd = null;
    _removeStack?.(); _removeStack = null;
    for (const key of [..._tiles.keys()]) removeTile(key);
    _listeners.clear();
  }

  return {
    id: UKRAINE_AREAS_ID,
    show,
    hide,
    setEnabled,
    isEnabled: () => _enabled,
    isShown: () => _shown,
    refresh,
    loadMeta,
    getState,
    onChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn); },
    destroy,
    _getStateForTest: () => ({ tiles: _tiles, meta: _meta, forestOk }),
  };
}
