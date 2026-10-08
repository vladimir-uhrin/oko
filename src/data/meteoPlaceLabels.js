// src/data/meteoPlaceLabels.js
/**
 * @module meteoPlaceLabels
 * @description Mená miest a dedín nad meteo poľom, ktoré pribúdajú s priblížením ako na Windy
 * (2026-10-07, vlastník: „pri zoomovaní aby sa objavovali viac miest a dedín až po maximum").
 *
 * Tri vrstvy údajov:
 *   - veľké mestá z Natural Earth (places.json, ≥ 100 000, tie majú aj bodku s kartou) — vždy,
 *   - GeoNames 15 000 – 99 999 obyvateľov (public/meteo-towns/a.json) — načíta sa raz pod 2 500 km,
 *   - GeoNames menšie sídla v dlaždiciach 2° × 2° (public/meteo-towns/b/) — len viditeľné dlaždice
 *     pod 400 km; Slovensko celé (všetky obce), inde sídla nad 500 obyvateľov.
 * Meno sa ukáže, keď je kamera bližšie než prah podľa počtu obyvateľov (veľké z diaľky, dediny až
 * zblízka), a mená sa neprekrývajú: väčšie sídlo vyhrá miesto na obrazovke (ako Windy). Popiskov
 * je naraz najviac LABEL_MAX — LabelCollection drží len to, čo je práve vidieť.
 */
import * as Cesium from 'cesium';

export const PLACE_CELL_DEG = 2;
export const PLACE_TIER_A_MIN = 15_000;
export const PLACE_TIER_A_MAX = 99_999;
export const TIER_A_LOAD_BELOW_M = 2_500_000;
export const TIER_B_LOAD_BELOW_M = 400_000;
export const LABEL_MAX = 260;
export const LABEL_HEIGHT_M = 13_000;
export const TOWNS_BASE_URL = '/meteo-towns';
/** Najviac dlaždíc naraz (pri šikmom pohľade je výrez veľký — vzdialené aj tak nevidno). */
export const MAX_CELLS = 36;

/** Kľúč dlaždice 2° × 2° (rovnaký v skripte aj v prehliadači). Pure. */
export function placeCellKey(lat, lon) {
  const r = Math.floor((Math.max(-90, Math.min(89.999, lat)) + 90) / PLACE_CELL_DEG);
  const c = Math.floor((((lon + 180) % 360 + 360) % 360) / PLACE_CELL_DEG);
  return `${r}_${c}`;
}

/** Dlaždice pokrývajúce výrez v stupňoch (aj cez 180. poludník), najviac `max`, od stredu. Pure. */
export function cellsForView({ west, south, east, north }, max = MAX_CELLS) {
  if (![west, south, east, north].every(Number.isFinite)) return [];
  const width = east >= west ? east - west : east + 360 - west;
  const keys = [];
  const cLat = (south + north) / 2;
  const cLon = west + width / 2;
  for (let lat = Math.floor(south / PLACE_CELL_DEG) * PLACE_CELL_DEG; lat <= north; lat += PLACE_CELL_DEG) {
    for (let d = 0; d <= width + PLACE_CELL_DEG; d += PLACE_CELL_DEG) {
      const lon = west + Math.min(d, width);
      const key = placeCellKey(lat + 0.001, lon);
      if (!keys.some((k) => k.key === key)) keys.push({ key, dist: Math.hypot(lat + 1 - cLat, lon + 1 - cLon) });
    }
  }
  return keys.sort((a, b) => a.dist - b.dist).slice(0, max).map((k) => k.key);
}

/** Do akej vzdialenosti kamery (m) je meno vidieť — podľa počtu obyvateľov. Pure. */
export function townVisibleUntilM(pop) {
  if (pop >= 50_000) return 900_000;
  if (pop >= PLACE_TIER_A_MIN) return 450_000;
  if (pop >= 5_000) return 220_000;
  if (pop >= 1_000) return 120_000;
  return 70_000;
}

/** Odhad rámčeka popisku na obrazovke (12 px tučné písmo, odsadenie 7 px vpravo od bodu; s hodnotou dva riadky). Pure. */
export function labelBox(x, y, name, twoLines = false) {
  const w = 8 + String(name).length * 7.2;
  return twoLines ? { x0: x + 5, y0: y - 17, x1: x + 9 + w, y1: y + 17 } : { x0: x + 5, y0: y - 9, x1: x + 9 + w, y1: y + 9 };
}

/** Text popisku: meno, pod ním hodnota (teplota) ako na Windy. Pure. */
export function labelText(name, value) {
  return value ? `${name}
${value}` : String(name);
}

/**
 * Mená, ktoré sa neprekrývajú: zoradené podľa priority (väčšie sídlo prvé), každé ďalšie sa vezme
 * len ak jeho rámček nezasahuje do už vybraného. Pure.
 * @param {Array<{id: string, x: number, y: number, name: string, priority: number}>} items
 * @returns {Set<string>} id vybraných
 */
export function declutterLabels(items, max = LABEL_MAX) {
  const kept = [];
  const out = new Set();
  for (const item of [...items].sort((a, b) => b.priority - a.priority)) {
    if (out.size >= max) break;
    const box = labelBox(item.x, item.y, item.name, Boolean(item.value));
    if (kept.some((k) => box.x0 < k.x1 && box.x1 > k.x0 && box.y0 < k.y1 && box.y1 > k.y0)) continue;
    kept.push(box);
    out.add(item.id);
  }
  return out;
}

/**
 * Správca popiskov nad poľom. Prepočíta sa po pohybe kamery (najviac raz za 250 ms).
 * @param {{ viewer: object, doFetch: Function, bigPlaces?: Array<{id: string, name: string, lat: number, lon: number, pop: number, capital?: boolean}>, bigVisibleUntilM: Function, requestRender?: Function, baseUrl?: string }} input
 */
export function createPlaceLabelManager({ viewer, doFetch, bigPlaces = [], bigVisibleUntilM, requestRender = () => {}, baseUrl = TOWNS_BASE_URL, valueAt = () => null }) {
  const scene = viewer.scene;
  const labels = new Cesium.LabelCollection();
  scene.primitives.add(labels);
  // GeoNames je CC BY 4.0 — atribúcia v kreditoch, kým sú mená na mape.
  const credit = new Cesium.Credit('<a href="https://www.geonames.org/" target="_blank" rel="noopener">GeoNames</a> (CC BY 4.0)');
  try { viewer.creditDisplay?.addStaticCredit?.(credit); } catch { /* bez kreditov (testy) */ }
  const shown = new Map(); // id → Label
  const places = []; // { id, name, lat, lon, pop, until, pos }
  const addPlace = (id, name, lat, lon, pop, until) => {
    places.push({ id, name, lat, lon, pop, until, pos: Cesium.Cartesian3.fromDegrees(lon, lat, LABEL_HEIGHT_M) });
  };
  for (const p of bigPlaces) addPlace(p.id, p.name, p.lat, p.lon, (Number(p.pop) || 0) * 1000, bigVisibleUntilM(Number(p.pop) || 0, p.capital === true));
  let tierA = 'none'; // none | loading | done
  const cells = new Map(); // key → 'loading' | 'done'
  let visible = true;
  let destroyed = false;
  let lastAt = 0;
  let lastKey = '';
  let pending = false;

  const loadRows = async (url, prefix) => {
    try {
      const response = await doFetch(url);
      if (!response?.ok) return;
      const rows = await response.json();
      if (destroyed || !Array.isArray(rows)) return;
      rows.forEach(([name, lat, lon, pop], i) => { if (name && Number.isFinite(lat) && Number.isFinite(lon)) addPlace(`${prefix}${i}`, name, lat, lon, Number(pop) || 0, townVisibleUntilM(Number(pop) || 0)); });
      refresh(true);
    } catch { /* bez menších sídiel ostanú veľké mestá */ }
  };

  function viewRect() {
    const rect = scene.camera.computeViewRectangle?.(scene.globe?.ellipsoid || Cesium.Ellipsoid.WGS84);
    if (!rect) return null;
    return { west: Cesium.Math.toDegrees(rect.west), south: Cesium.Math.toDegrees(rect.south), east: Cesium.Math.toDegrees(rect.east), north: Cesium.Math.toDegrees(rect.north) };
  }

  function ensureData(height, rect) {
    if (height < TIER_A_LOAD_BELOW_M && tierA === 'none') { tierA = 'loading'; void loadRows(`${baseUrl}/a.json`, 'ga:').finally(() => { tierA = 'done'; }); }
    if (height < TIER_B_LOAD_BELOW_M && rect) {
      for (const key of cellsForView(rect)) {
        if (cells.has(key)) continue;
        cells.set(key, 'loading');
        void loadRows(`${baseUrl}/b/${key}.json`, `gb:${key}:`).finally(() => cells.set(key, 'done'));
      }
    }
  }

  function refresh(force = false) {
    if (destroyed) return;
    const camera = scene.camera;
    const camPos = camera.positionWC;
    const key = `${camPos.x.toFixed(0)},${camPos.y.toFixed(0)},${camPos.z.toFixed(0)},${camera.heading.toFixed(3)},${camera.pitch.toFixed(3)}`;
    if (!force && key === lastKey) return;
    lastKey = key;
    const height = camera.positionCartographic?.height ?? Infinity;
    const rect = viewRect();
    ensureData(height, rect);
    const occluder = new Cesium.EllipsoidalOccluder(scene.globe?.ellipsoid || Cesium.Ellipsoid.WGS84, camPos);
    const candidates = [];
    if (visible) {
      for (const p of places) {
        if (Cesium.Cartesian3.distance(camPos, p.pos) > p.until) continue;
        if (!occluder.isPointVisible(p.pos)) continue;
        const win = Cesium.SceneTransforms.worldToWindowCoordinates?.(scene, p.pos) || Cesium.SceneTransforms.wgs84ToWindowCoordinates?.(scene, p.pos);
        if (!win || win.x < -50 || win.y < -20 || win.x > scene.canvas.clientWidth + 10 || win.y > scene.canvas.clientHeight + 20) continue;
        let value = null;
        try { value = valueAt(p.lat, p.lon); } catch { value = null; }
        candidates.push({ id: p.id, x: win.x, y: win.y, name: p.name, value, priority: p.pop, place: p });
      }
    }
    const keep = declutterLabels(candidates);
    for (const [id, label] of shown) {
      if (!keep.has(id)) { labels.remove(label); shown.delete(id); }
    }
    for (const c of candidates) {
      if (!keep.has(c.id)) continue;
      const text = labelText(c.name, c.value);
      const existing = shown.get(c.id);
      if (existing) { if (existing.text !== text) existing.text = text; continue; }
      const big = c.place.pop >= 100_000;
      shown.set(c.id, labels.add({
        position: c.place.pos,
        text,
        // Tučné biele ako na Windy; veľké mestá o bod väčšie.
        font: big ? '700 13px Inter, "Segoe UI", system-ui, sans-serif' : '700 12px Inter, "Segoe UI", system-ui, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.78)'),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        pixelOffset: new Cesium.Cartesian2(7, 0),
      }));
    }
    requestRender();
  }

  const onPostRender = () => {
    const now = Date.now();
    if (now - lastAt < 250 || pending) return;
    lastAt = now;
    refresh(false);
  };
  scene.postRender.addEventListener(onPostRender);
  const onMoveEnd = () => { pending = false; refresh(true); };
  scene.camera.moveEnd.addEventListener(onMoveEnd);
  refresh(true);

  return {
    setVisible(on) {
      if (visible === !!on) return;
      visible = !!on;
      labels.show = visible;
      refresh(true);
    },
    refresh: () => refresh(true),
    get count() { return shown.size; },
    get loadedPlaces() { return places.length; },
    destroy() {
      destroyed = true;
      scene.postRender.removeEventListener(onPostRender);
      scene.camera.moveEnd.removeEventListener(onMoveEnd);
      try { viewer.creditDisplay?.removeStaticCredit?.(credit); } catch { /* bez kreditov */ }
      if (!labels.isDestroyed()) scene.primitives.remove(labels);
      shown.clear();
    },
  };
}
