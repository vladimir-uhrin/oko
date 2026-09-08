// src/data/meteoPlaces.js
// Mestá nad meteorologickým polom (2026-09-08, „ako Windy"; od noci 09-08 podľa
// používateľa „cez kartičky mouse over ako pri lietadlách a zemetraseniach"):
// malé azúrové BODY (PointPrimitiveCollection, hĺbkovo testované — za obzorom
// zmiznú) a pri prejdení myšou DOM karta s menom, štátom a hodnotami všetkých
// polí v tom bode (teplota, vietor so smerom, tlak, zrážky, oblačnosť, nárazy),
// vzorkovanými z mriežok aktuálneho kroku. Karta je pripravená na ďalšie dáta.
// Mestá: Natural Earth (verejná doména, local_data/natural_earth/places.json,
// build-meteo-places.mjs). Čisté pomôcky bez DOM okrem createPlaceHoverCard.

import * as Cesium from 'cesium';
import { t } from '../i18n.js';

export const PLACES_URL = new URL('./local_data/natural_earth/places.json', import.meta.url).href;
/** Výška bodov nad elipsoidom (nad drapériou a izobarami). */
export const PLACE_POINT_HEIGHT_M = 6_000;
/** Najviac bodov v kolekcii (najväčšie mestá). */
export const PLACE_POINT_MAX = 1_400;
export const PLACE_ID_PREFIX = 'place:';

/**
 * Dokedy (m od kamery) je mesto viditeľné podľa populácie (tis.). Pure.
 * Prahy sprísnené 2026-09-08: pri pohľade na kontinent sa v Číne a Indii
 * prekrývali desiatky 1 M+ miest — Windy pri oddialení ukazuje len najväčšie.
 */
export function placeVisibleUntilM(popThousands, capital = false) {
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
 * Text hodnoty podľa poľa. Pure.
 * @param {number} value
 * @param {string} fieldId
 * @returns {string} '' keď hodnota nedáva zmysel
 */
export function placeValueText(value, fieldId) {
  if (!Number.isFinite(value)) return '';
  switch (fieldId) {
    case 'temp': return `${Math.round(value)} °C`;
    case 'pressure': return `${Math.round(value)} hPa`;
    case 'precip': return value < 0.05 ? '0 mm/h' : `${value < 1 ? value.toFixed(1) : Math.round(value)} mm/h`;
    case 'clouds': return `${Math.round(value)} %`;
    case 'wind':
    case 'gust': return `${Math.round(value)} m/s`;
    default: return `${Math.round(value)}`;
  }
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/**
 * Smer vetra (odkiaľ fúka, meteorologicky) z u/v: „245° WSW". Pure.
 * @param {number} u východná zložka m/s
 * @param {number} v severná zložka m/s
 */
export function windDirectionText(u, v) {
  if (!Number.isFinite(u) || !Number.isFinite(v) || Math.hypot(u, v) < 0.3) return '';
  const deg = (270 - (Math.atan2(v, u) * 180) / Math.PI + 720) % 360;
  const idx = Math.round(deg / 22.5) % 16;
  // Meteorologicky sa sever píše 360°, nie 0°.
  const shown = Math.round(deg) % 360 || 360;
  return `${shown}° ${COMPASS[idx]}`;
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
    .slice(0, PLACE_POINT_MAX)
    .map(([name, lat, lon, pop, scalerank, iso2, capital], index) => ({
      id: `${PLACE_ID_PREFIX}${index}`, name, lat, lon, pop: Number(pop) || 0, scalerank: Number(scalerank) || 10, iso2: String(iso2 || ''), capital: capital === 1,
    }));
}

/**
 * Body miest. Injektovateľné (collectionFactory) pre testy.
 * @param {Array<{id: string, name: string, lat: number, lon: number, pop: number, capital: boolean}>} places
 */
export function createPlacePoints(places, { collectionFactory = () => new Cesium.PointPrimitiveCollection() } = {}) {
  const collection = collectionFactory();
  for (const place of places) {
    const big = place.pop >= 1000 || place.capital;
    collection.add({
      id: place.id,
      position: Cesium.Cartesian3.fromDegrees(place.lon, place.lat, PLACE_POINT_HEIGHT_M),
      pixelSize: big ? 5 : 4,
      color: Cesium.Color.fromCssColorString(big ? 'rgba(57,208,255,0.95)' : 'rgba(155,230,255,0.85)'),
      outlineColor: Cesium.Color.fromCssColorString('rgba(3,12,18,0.9)'),
      outlineWidth: 1.5,
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, placeVisibleUntilM(place.pop, place.capital)),
    });
  }
  return collection;
}

/**
 * Model karty mesta. `values` = { temp, wind: {u, v}, pressure, precip, clouds, gust }
 * (undefined = načítava sa, NaN = nedostupné). Pure.
 * @returns {{title: string, subtitle: string, rows: Array<[string, string]>, note: string}}
 */
export function placeHoverModel(place, values = {}, { stepLabel = '', translate = t } = {}) {
  const pending = translate('meteo.place.pending');
  const missing = '—';
  const row = (key, value, fieldId) => [translate(key), value === undefined ? pending : (placeValueText(value, fieldId) || missing)];
  const wind = values.wind;
  let windText = pending;
  if (wind !== undefined) {
    const speed = wind && Number.isFinite(wind.u) && Number.isFinite(wind.v) ? Math.hypot(wind.u, wind.v) : NaN;
    const dir = wind ? windDirectionText(wind.u, wind.v) : '';
    windText = Number.isFinite(speed) ? `${Math.round(speed)} m/s${dir ? ` · ${dir}` : ''}` : missing;
  }
  const popText = place.pop >= 1000 ? `${(place.pop / 1000).toFixed(1).replace('.', ',')} M` : `${place.pop} tis.`;
  return {
    title: place.name,
    subtitle: [place.iso2, popText, `${place.lat.toFixed(2)}°, ${place.lon.toFixed(2)}°`].filter(Boolean).join(' · '),
    rows: [
      row('meteo.place.temp', values.temp, 'temp'),
      [translate('meteo.place.wind'), windText],
      row('meteo.place.gust', values.gust, 'gust'),
      row('meteo.place.pressure', values.pressure, 'pressure'),
      row('meteo.place.precip', values.precip, 'precip'),
      row('meteo.place.clouds', values.clouds, 'clouds'),
    ],
    note: stepLabel ? translate('meteo.place.forecast', { label: stepLabel }) : translate('meteo.forecast'),
  };
}

/**
 * DOM karta pri myši (vzor earthquakeHoverCard.js). `show(place, at, values, stepLabel)`,
 * `update(values)` doplní hodnoty, keď dobehnú mriežky.
 */
export function createPlaceHoverCard({ document: doc = globalThis.document, translate = t } = {}) {
  if (!doc?.body) return { show() {}, update() {}, hide() {}, destroy() {}, isHovered: () => false, current: () => null };
  const root = doc.createElement('section');
  root.className = 'meteo-place-card';
  root.hidden = true;
  root.setAttribute('aria-label', translate('meteo.place.card'));
  doc.body.appendChild(root);
  let current = null;
  let hovered = false;
  let stepLabel = '';
  const el = (tag, text, parent = root) => { const node = doc.createElement(tag); if (text) node.textContent = text; parent.appendChild(node); return node; };
  function hide() { current = null; hovered = false; root.hidden = true; }
  function place(at) {
    const w = doc.documentElement.clientWidth;
    const h = doc.documentElement.clientHeight;
    const width = root.offsetWidth || 220;
    const height = root.offsetHeight || 160;
    root.style.left = `${Math.max(8, Math.min(at.x + 18, w - width - 8))}px`;
    root.style.top = `${Math.max(8, Math.min(at.y + 16, h - height - 8))}px`;
  }
  function render(values) {
    const model = placeHoverModel(current, values, { stepLabel, translate });
    root.replaceChildren();
    const close = el('button', '×');
    close.className = 'meteo-place-close';
    close.setAttribute('aria-label', translate('meteo.place.close'));
    close.addEventListener('click', hide);
    el('h3', model.title);
    el('p', model.subtitle).className = 'meteo-place-sub';
    const list = el('dl');
    for (const [label, value] of model.rows) { el('dt', label, list); el('dd', value, list); }
    el('p', model.note).className = 'meteo-place-note';
  }
  root.addEventListener('pointerenter', () => { hovered = true; });
  root.addEventListener('pointerleave', hide);
  function keydown(e) { if (e.key === 'Escape') hide(); }
  doc.addEventListener('keydown', keydown);
  return {
    isHovered: () => hovered || root.contains(doc.activeElement),
    current: () => current,
    hide,
    show(placeRecord, at, values = {}, label = '') {
      if (!placeRecord) { hide(); return; }
      stepLabel = label;
      if (current === placeRecord) { render(values); return; }
      current = placeRecord;
      hovered = false;
      root.hidden = false;
      render(values);
      place(at);
    },
    update(values) { if (current) render(values); },
    destroy() { doc.removeEventListener('keydown', keydown); root.remove(); current = null; },
  };
}
