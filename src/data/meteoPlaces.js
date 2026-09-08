// src/data/meteoPlaces.js
// Popisky miest nad meteorologickým polom (2026-09-08, „ako Windy"): meno mesta
// + hodnota poľa v tom bode („Praha 21°", „Viedeň 1013"). Mestá z Natural Earth
// (verejná doména, local_data/natural_earth/places.json, build-meteo-places.mjs),
// kreslené ako Cesium LabelCollection NAD drapériou poľa — preto ostávajú
// čitateľné aj na sýtom poli (Windy má popisky ako samostatnú vrstvu navrch).
// Hustota: veľké mestá vidno zďaleka, menšie až pri priblížení
// (distanceDisplayCondition podľa populácie). Čisté pomôcky bez DOM.

import * as Cesium from 'cesium';

export const PLACES_URL = new URL('./local_data/natural_earth/places.json', import.meta.url).href;
/** Výška popiskov nad elipsoidom (nad izobarami). */
export const PLACE_LABEL_HEIGHT_M = 6_000;
/** Najviac popiskov v kolekcii (najväčšie mestá). */
export const PLACE_LABEL_MAX = 1_400;

/**
 * Dokedy (m od kamery) je mesto viditeľné podľa populácie (tis.). Pure.
 * Megamestá stále, 1 M+ do ~12 000 km, 300 k+ do ~4 000 km, menšie do ~1 500 km.
 */
export function placeVisibleUntilM(popThousands, capital = false) {
  // Prahy sprísnené 2026-09-08 v noci: pri pohľade na kontinent sa v Číne a Indii
  // prekrývali desiatky 1 M+ miest — Windy pri oddialení ukazuje len najväčšie.
  if (popThousands >= 8000) return Number.POSITIVE_INFINITY;
  if (popThousands >= 3000 || capital) return 9_000_000;
  if (popThousands >= 1000) return 3_500_000;
  if (popThousands >= 300) return 1_500_000;
  return 600_000;
}

/**
 * Hodnota poľa v bode (bilineárne z mriežky [rows × cols], riadok 0 = 90° N,
 * stĺpec 0 = −180°). Pure. NaN mimo mriežky.
 */
export function sampleGrid(grid, lat, lon) {
  if (!grid || !grid.values) return NaN;
  const { values, cols, rows } = grid;
  const x = ((lon + 180) / 360) * (cols - 1);
  const y = ((90 - lat) / 180) * (rows - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(cols - 1, x0 + 1);
  const y1 = Math.min(rows - 1, y0 + 1);
  if (x0 < 0 || y0 < 0 || x0 >= cols || y0 >= rows) return NaN;
  const fx = x - x0;
  const fy = y - y0;
  const v00 = values[y0 * cols + x0];
  const v10 = values[y0 * cols + x1];
  const v01 = values[y1 * cols + x0];
  const v11 = values[y1 * cols + x1];
  return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
}

/**
 * Text hodnoty pri meste podľa poľa. Pure.
 * @param {number} value
 * @param {string} fieldId
 * @returns {string} '' keď hodnota nedáva zmysel
 */
export function placeValueText(value, fieldId) {
  if (!Number.isFinite(value)) return '';
  switch (fieldId) {
    case 'temp': return `${Math.round(value)}°`;
    case 'pressure': return `${Math.round(value)}`;
    case 'precip': return value < 0.1 ? '' : `${value < 1 ? value.toFixed(1) : Math.round(value)} mm`;
    case 'clouds': return `${Math.round(value)} %`;
    case 'wind':
    case 'gust': return `${Math.round(value)} m/s`;
    default: return `${Math.round(value)}`;
  }
}

/** Načíta a normalizuje mestá. */
export async function loadPlaces(fetchImpl = globalThis.fetch, url = PLACES_URL) {
  const response = await fetchImpl(url);
  if (!response?.ok) throw new Error(`places HTTP ${response?.status}`);
  const json = await response.json();
  return normalizePlaces(json);
}

/** Pure. */
export function normalizePlaces(json) {
  const rows = Array.isArray(json?.places) ? json.places : [];
  return rows
    .filter((r) => Array.isArray(r) && typeof r[0] === 'string' && Number.isFinite(r[1]) && Number.isFinite(r[2]))
    .slice(0, PLACE_LABEL_MAX)
    .map(([name, lat, lon, pop, scalerank, iso2, capital]) => ({ name, lat, lon, pop: Number(pop) || 0, scalerank: Number(scalerank) || 10, iso2: String(iso2 || ''), capital: capital === 1 }));
}

/**
 * Postaví LabelCollection. Injektovateľné (labelFactory) pre testy.
 * @param {Array<{name: string, lat: number, lon: number, pop: number, capital: boolean}>} places
 * @param {object} [options]
 * @param {(place: object) => string} [options.valueText] hodnota poľa pre mesto ('' = len meno)
 */
export function createPlaceLabels(places, { valueText = () => '', collectionFactory = () => new Cesium.LabelCollection() } = {}) {
  const collection = collectionFactory();
  for (const place of places) {
    const value = valueText(place);
    const big = place.pop >= 1000 || place.capital;
    collection.add({
      id: `place:${place.name}`,
      position: Cesium.Cartesian3.fromDegrees(place.lon, place.lat, PLACE_LABEL_HEIGHT_M),
      text: value ? `${place.name}  ${value}` : place.name,
      font: `${big ? '600 ' : ''}${big ? 12 : 11}px "JetBrains Mono", "Consolas", monospace`,
      fillColor: Cesium.Color.fromCssColorString(big ? '#ffffff' : '#dbeef8'),
      outlineColor: Cesium.Color.fromCssColorString('rgba(3,12,18,0.95)'),
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      pixelOffset: new Cesium.Cartesian2(6, 0),
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, placeVisibleUntilM(place.pop, place.capital)),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
  }
  return collection;
}

/**
 * Aktualizuje texty existujúcej kolekcie (zmena poľa/kroku bez prestavby). Pure-ish.
 * @param {Cesium.LabelCollection} collection
 * @param {Array<object>} places rovnaké poradie ako pri stavbe
 * @param {(place: object) => string} valueText
 */
export function updatePlaceLabelTexts(collection, places, valueText) {
  const n = Math.min(collection.length, places.length);
  for (let i = 0; i < n; i += 1) {
    const label = collection.get(i);
    const value = valueText(places[i]);
    const text = value ? `${places[i].name}  ${value}` : places[i].name;
    if (label.text !== text) label.text = text;
  }
}
