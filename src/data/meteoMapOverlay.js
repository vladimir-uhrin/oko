// src/data/meteoMapOverlay.js
/**
 * @module meteoMapOverlay
 * @description Mapa NAD meteo poľom ako na Windy (2026-10-07, vlastník: „chcem to ako na štýl Windy"):
 * pobrežia, hranice štátov a mená miest ležia nad farebnou drapériou, takže aj pri plne zafarbenom
 * svete človek vie, kde je. Drapéria (meteoLayer.createFieldPrimitive) je 10 km nad elipsoidom bez
 * hĺbkového testu a podklad pod ňou zmizne — preto vlastné čiary a popisky 11 km nad elipsoidom
 * (nad drapériou, pod izobarami 12 km). Sú priesvitné, takže idú v priesvitnom prechode zoradené
 * podľa vzdialenosti — za drapériou celého sveta, teda navrch; odvrátenú pologuľu zakryje glóbus.
 *
 * Dáta: Natural Earth 1:50m pobrežia (`land.json`) a hranice na pevnine (`borders.json`), mestá
 * z `places.json` — verejná doména, už v repe (local_data/natural_earth/README.md).
 */
import * as Cesium from 'cesium';
import { PLACE_POINT_HEIGHT_M, placeVisibleUntilM } from './meteoPlaces.js';

export const METEO_OVERLAY_HEIGHT_M = 11_000;
export const BORDERS_URL = new URL('./local_data/natural_earth/borders.json', import.meta.url).href;
export const COAST_URL = new URL('./local_data/natural_earth/land.json', import.meta.url).href;

/** Farby ako na Windy: tenké svetlé čiary, pobrežie výraznejšie než hranice. */
export const COAST_STYLE = Object.freeze({ color: 'rgba(255,255,255,0.62)', width: 1.1 });
export const BORDER_STYLE = Object.freeze({ color: 'rgba(255,255,255,0.42)', width: 1.0 });

/**
 * Mestá → popisky. Meno sa ukáže presne tam, kde bodka mesta (meteoPlaces: placeVisibleUntilM,
 * výška PLACE_POINT_HEIGHT_M) — veľké mestá z diaľky, malé až zblízka. Pure.
 * @param {Array<{name: string, lat: number, lon: number, pop?: number, capital?: boolean}>} places normalizované (loadPlaces)
 */
export function cityLabelPlan(places) {
  const out = [];
  for (const p of Array.isArray(places) ? places : []) {
    if (!p?.name || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    out.push({ name: String(p.name), lat: p.lat, lon: p.lon, maxDistance: placeVisibleUntilM(Number(p.pop) || 0, p.capital === true) });
  }
  return out;
}

/** Krúžok pobrežia → uzavretá čiara (prvý bod na koniec), plochý zoznam lon,lat,h. Pure. */
export function ringToFlat(ring, height = METEO_OVERLAY_HEIGHT_M, close = true) {
  const flat = [];
  if (!Array.isArray(ring) || ring.length < 2) return flat;
  for (const [lon, lat] of ring) flat.push(lon, lat, height);
  if (close) { const [lon, lat] = ring[0]; flat.push(lon, lat, height); }
  return flat;
}

/** Načítaj pobrežia a hranice (raz, lenivo pri prvom zapnutí meteo). Nehádže — chyba = prázdne. */
export async function loadMeteoMapData(doFetch) {
  const get = async (url, key) => {
    try {
      const response = await doFetch(url);
      if (!response?.ok) return [];
      const json = await response.json();
      return Array.isArray(json?.[key]) ? json[key] : [];
    } catch { return []; }
  };
  const [coast, borders] = await Promise.all([get(COAST_URL, 'rings'), get(BORDERS_URL, 'lines')]);
  return { coast, borders };
}

/**
 * Pobrežia, hranice a mená miest ako jedna PrimitiveCollection.
 * @param {{coast: Array, borders: Array, places: Array}} data places = normalizované mestá (loadPlaces)
 */
export function createMeteoMapOverlay({ coast = [], borders = [], places = [] } = {}) {
  const root = new Cesium.PrimitiveCollection();
  const lines = new Cesium.PolylineCollection();
  const coastMaterial = Cesium.Material.fromType('Color', { color: Cesium.Color.fromCssColorString(COAST_STYLE.color) });
  const borderMaterial = Cesium.Material.fromType('Color', { color: Cesium.Color.fromCssColorString(BORDER_STYLE.color) });
  for (const ring of coast) {
    const flat = ringToFlat(ring);
    if (flat.length >= 6) lines.add({ positions: Cesium.Cartesian3.fromDegreesArrayHeights(flat), width: COAST_STYLE.width, material: coastMaterial });
  }
  for (const line of borders) {
    const flat = ringToFlat(line, METEO_OVERLAY_HEIGHT_M, false);
    if (flat.length >= 6) lines.add({ positions: Cesium.Cartesian3.fromDegreesArrayHeights(flat), width: BORDER_STYLE.width, material: borderMaterial });
  }
  const labels = new Cesium.LabelCollection();
  for (const city of cityLabelPlan(places)) {
    labels.add({
      position: Cesium.Cartesian3.fromDegrees(city.lon, city.lat, PLACE_POINT_HEIGHT_M),
      text: city.name,
      font: '500 12px Inter, "Segoe UI", system-ui, sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.78)'),
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      pixelOffset: new Cesium.Cartesian2(7, 0),
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, city.maxDistance),
    });
  }
  root.add(lines);
  root.add(labels);
  root.show = true;
  return root;
}
