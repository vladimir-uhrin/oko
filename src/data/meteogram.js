// src/data/meteogram.js
// Predpoveď pre miesto po kliknutí na mapu (2026-10-08, vlastník: „čo by sme pridali" → „začni",
// krok „klik na miesto ukáže predpoveď ako na Windy"). Čisté pomôcky bez DOM a Cesia:
//   - adresa Open-Meteo pre bod (server, vite.config.js /api/meteo/point),
//   - normalizácia odpovede na hodinové rady,
//   - zoskupenie do 3-hodinových stĺpcov (rovnaký krok ako časová os mapy, METEO_STEP_HOURS),
//   - dni pre hlavičku, farby buniek z rámp mapy, meno najbližšieho sídla.
//
// Zdroj: Open-Meteo (CC BY 4.0, https://open-meteo.com/en/licence), model `gfs_global` = ten istý
// NOAA/NCEP GFS 0,25°, ktorý kreslí mapa. Je to PREDPOVEĎ modelu, nie pozorovanie.

import { METEO_STEP_HOURS, rampStopsFor } from './meteoField.js';

export const METEOGRAM_URL = '/api/meteo/point';
export const METEOGRAM_DAYS = 5;
export const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
/** Hodinové premenné Open-Meteo → kľúč v modeli. */
export const METEOGRAM_VARS = Object.freeze({
  temperature_2m: 'temp',
  precipitation: 'precip',
  cloud_cover: 'clouds',
  wind_speed_10m: 'wind',
  wind_direction_10m: 'windDir',
  wind_gusts_10m: 'gust',
  pressure_msl: 'pressure',
});
/** Bunka cache na serveri: 0,1° (~11 km) — GFS má 0,25°, jemnejšie by len míňalo dopyty. */
export const METEOGRAM_CELL_DEG = 0.1;

/** Bod zaokrúhlený na bunku cache; null pre neplatné súradnice. Pure. */
export function meteogramCell(lat, lon, cellDeg = METEOGRAM_CELL_DEG) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) return null;
  const round = (v) => Math.round(Math.round(v / cellDeg) * cellDeg * 1000) / 1000;
  return { lat: round(la), lon: round(lo), key: `${round(la).toFixed(2)},${round(lo).toFixed(2)}` };
}

/** Adresa Open-Meteo pre bunku (len server). Pure. */
export function openMeteoPointUrl(cell, days = METEOGRAM_DAYS) {
  const params = new URLSearchParams({
    latitude: String(cell.lat),
    longitude: String(cell.lon),
    hourly: Object.keys(METEOGRAM_VARS).join(','),
    models: 'gfs_global',
    forecast_days: String(days),
    wind_speed_unit: 'ms',
    timeformat: 'unixtime',
    timezone: 'auto',
  });
  return `${OPEN_METEO_FORECAST_URL}?${params}`;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Odpoveď Open-Meteo → { lat, lon, elevation, utcOffsetSec, timezone, times[ms], temp[], … }.
 * Chýbajúce hodnoty sú null. Null, ak odpoveď nemá časy. Pure.
 */
export function normalizeOpenMeteoPoint(json) {
  const hourly = json?.hourly;
  if (!hourly || !Array.isArray(hourly.time) || !hourly.time.length) return null;
  const times = hourly.time.map((s) => (Number.isFinite(Number(s)) ? Number(s) * 1000 : NaN));
  if (times.some((t) => !Number.isFinite(t))) return null;
  const out = {
    lat: num(json.latitude),
    lon: num(json.longitude),
    elevation: num(json.elevation),
    utcOffsetSec: num(json.utc_offset_seconds) ?? 0,
    timezone: typeof json.timezone_abbreviation === 'string' ? json.timezone_abbreviation : (typeof json.timezone === 'string' ? json.timezone : 'UTC'),
    times,
  };
  for (const [src, key] of Object.entries(METEOGRAM_VARS)) {
    const arr = Array.isArray(hourly[src]) ? hourly[src] : [];
    out[key] = times.map((_, i) => num(arr[i]));
  }
  return out;
}

const HOUR_MS = 3600_000;

/**
 * Hodinové rady → 3-hodinové stĺpce zarovnané na UTC krok mapy (00, 03, 06 … Z), od kroku
 * najbližšieho k `nowMs`. Teplota, vietor, smer, oblačnosť a tlak sú v čase stĺpca; zrážky sú
 * SÚČET za nasledujúce 3 h a nárazy MAXIMUM za ne (ako Windy). Pure.
 */
export function meteogramColumns(series, { nowMs = Date.now(), stepHours = METEO_STEP_HOURS } = {}) {
  if (!series?.times?.length) return [];
  const stepMs = stepHours * HOUR_MS;
  const index = new Map(series.times.map((t, i) => [t, i]));
  const start = Math.round(nowMs / stepMs) * stepMs;
  const last = series.times[series.times.length - 1];
  const cols = [];
  for (let t = start; t <= last; t += stepMs) {
    const i = index.get(t);
    if (i === undefined) continue;
    let precip = null;
    let gust = null;
    for (let h = 0; h < stepHours; h += 1) {
      const j = index.get(t + h * HOUR_MS);
      if (j === undefined) continue;
      const p = series.precip?.[j];
      if (p !== null && p !== undefined) precip = (precip ?? 0) + p;
      const g = series.gust?.[j];
      if (g !== null && g !== undefined) gust = Math.max(gust ?? 0, g);
    }
    cols.push({
      t,
      temp: series.temp?.[i] ?? null,
      wind: series.wind?.[i] ?? null,
      windDir: series.windDir?.[i] ?? null,
      clouds: series.clouds?.[i] ?? null,
      pressure: series.pressure?.[i] ?? null,
      precip: precip === null ? null : Math.round(precip * 10) / 10,
      gust,
    });
  }
  return cols;
}

const DAY_SK = ['Ne', 'Po', 'Ut', 'St', 'Št', 'Pi', 'So'];
const DAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Dni pre hlavičku v miestnom čase miesta: [{ label, span }]. Pure. */
export function meteogramDays(columns, utcOffsetSec = 0, lang = 'sk') {
  const days = [];
  for (const c of columns) {
    const d = new Date(c.t + utcOffsetSec * 1000);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
    const names = lang === 'en' ? DAY_EN : DAY_SK;
    const label = lang === 'en'
      ? `${names[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`
      : `${names[d.getUTCDay()]} ${d.getUTCDate()}. ${d.getUTCMonth() + 1}.`;
    const lastDay = days[days.length - 1];
    if (lastDay && lastDay.key === key) lastDay.span += 1;
    else days.push({ key, label, span: 1 });
  }
  return days.map(({ label, span }) => ({ label, span }));
}

/** Hodina stĺpca v miestnom čase („05"). Pure. */
export function meteogramHour(t, utcOffsetSec = 0) {
  return String(new Date(t + utcOffsetSec * 1000).getUTCHours()).padStart(2, '0');
}

/** Posun od UTC ako text („UTC+2", „UTC−3:30"). Pure. */
export function utcOffsetLabel(utcOffsetSec = 0) {
  if (!utcOffsetSec) return 'UTC';
  const sign = utcOffsetSec > 0 ? '+' : '−';
  const abs = Math.abs(utcOffsetSec);
  const h = Math.floor(abs / 3600);
  const m = Math.round((abs % 3600) / 60);
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Farba hodnoty z rampy mapy (rovnaké farby ako pole) ako `rgb(r, g, b)`; null bez hodnoty. Pure. */
export function rampCssColor(fieldId, value) {
  const stops = rampStopsFor(fieldId);
  if (!stops?.length || value === null || value === undefined || !Number.isFinite(value)) return null;
  let rgb;
  if (value <= stops[0][0]) rgb = hexToRgb(stops[0][1]);
  else if (value >= stops[stops.length - 1][0]) rgb = hexToRgb(stops[stops.length - 1][1]);
  else {
    let k = 1;
    while (k < stops.length && stops[k][0] < value) k += 1;
    const [v0, h0] = stops[k - 1];
    const [v1, h1] = stops[k];
    const f = v1 === v0 ? 0 : (value - v0) / (v1 - v0);
    const a = hexToRgb(h0);
    const b = hexToRgb(h1);
    rgb = a.map((c, i) => Math.round(c + (b[i] - c) * f));
  }
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/**
 * Otočenie šípky smeru v stupňoch: šípka ukazuje, KAM vietor fúka (ako Windy) —
 * meteorologický smer je odkiaľ, takže +180°. Null bez smeru. Pure.
 */
export function windArrowRotation(dirFromDeg) {
  if (dirFromDeg === null || dirFromDeg === undefined || !Number.isFinite(dirFromDeg)) return null;
  return ((dirFromDeg + 180) % 360 + 360) % 360;
}

/** Index stĺpca, ktorý zodpovedá času mapy (ISO kroku); −1 ak nie je. Pure. */
export function columnIndexForTime(columns, iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return -1;
  return columns.findIndex((c) => c.t === t);
}

/** Vzdialenosť v km (rovinná aproximácia, stačí do desiatok km). Pure. */
function distanceKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * 111.2;
  const dLon = (lon2 - lon1) * 111.2 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.hypot(dLat, dLon);
}

/**
 * Meno sídla pri kliknutom bode: najbližšie do `maxKm`, veľké mesto (≥ 100 000) má trojnásobný
 * dosah — klik do Bratislavy je „Bratislava", nie jej najbližšia mestská časť. Null, ak nič. Pure.
 * @param {Array<{lat:number, lon:number, pop?:number, name:string}>} places
 */
export function nearestPlaceName(places, lat, lon, maxKm = 8) {
  let best = null;
  let bestScore = Infinity;
  for (const p of places || []) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || !p.name) continue;
    if (Math.abs(p.lat - lat) > 1) continue;
    const d = distanceKm(lat, lon, p.lat, p.lon);
    const reach = (p.pop || 0) >= 100_000 ? 3 : 1;
    if (d > maxKm * reach) continue;
    const score = d / reach;
    if (score < bestScore) { bestScore = score; best = p; }
  }
  return best ? best.name : null;
}

/** Súradnice ako text pre hlavičku, keď pri bode nie je sídlo („48,15° S · 17,11° V"). Pure. */
export function coordinateLabel(lat, lon, lang = 'sk') {
  const f = (v) => (lang === 'en' ? Math.abs(v).toFixed(2) : Math.abs(v).toFixed(2).replace('.', ','));
  const ns = lat >= 0 ? (lang === 'en' ? 'N' : 'S') : (lang === 'en' ? 'S' : 'J');
  const ew = lon >= 0 ? (lang === 'en' ? 'E' : 'V') : (lang === 'en' ? 'W' : 'Z');
  return `${f(lat)}° ${ns} · ${f(lon)}° ${ew}`;
}
