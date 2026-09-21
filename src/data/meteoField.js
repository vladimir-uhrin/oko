// src/data/meteoField.js
// Meteorológia sveta — čisté pomôcky (2026-09-08, prototyp „Windy štýl"):
// katalóg krokov predpovede, kvantizácia polí do PNG, farebné rampy v identite
// OKO (azúrová → jantárová → červená), popisky. Žiadny DOM, žiadne Cesium.
//
// Zdroj: NOAA/NCEP GFS 0,25° (verejná doména USA) cez NSF Unidata THREDDS
// NetCDF Subset Service (server proxy /api/meteo, DATA_SOURCES.md). Sú to
// MODELOVÉ dáta (predpoveď), nikdy nie pozorovanie — UI to musí hovoriť.

export const METEO_LAYER_ID = 'meteo-gfs';
/** Krok predpovede v hodinách a horizont (fáza 1 krok 3: 48 → 72 h). */
export const METEO_STEP_HOURS = 3;
export const METEO_HORIZON_HOURS = 72;
/** Rozsah kvantizácie zložiek vetra v PNG (R = u, G = v), m/s. */
export const WIND_COMPONENT_RANGE = Object.freeze([-60, 60]);
/** Rozsah kvantizácie rýchlosti vetra (B), m/s. */
export const WIND_SPEED_RANGE = Object.freeze([0, 60]);
/** Rozsah kvantizácie teploty 2 m (R), °C. */
export const TEMP_RANGE = Object.freeze([-60, 60]);

/**
 * Polia: id → THREDDS premenné, prevod jednotiek (`convert`: hodnota × scale + offset),
 * rozsah kvantizácie do PNG (`decode`), rozsah rampy, kanál PNG, alfa drapérie.
 * Fáza „polia" (2026-09-08 večer): tlak MSL s izobarami, zrážky, oblačnosť, nárazy.
 */
export const METEO_FIELDS = Object.freeze({
  // Farebná VÝPLŇ ako na Windy (používateľ 2026-09-17), ale mapa musí ostať
  // čitateľná: alfu nesie RAMPA (pokoj priehľadný → búrka plná), nie konštanta.
  // Plná drapéria 0,92 bez alfy v rampe zaliala celú planétu jednou farbou —
  // nebolo vidieť pobrežia ani popisy, čo je presne to, čo Windy NEROBÍ.
  wind: Object.freeze({
    id: 'wind',
    vars: ['u-component_of_wind_height_above_ground', 'v-component_of_wind_height_above_ground'],
    vertCoord: 10,
    unit: 'm/s',
    convert: { scale: 1, offset: 0 },
    rampRange: [0, 45],
    /** Kanál PNG s hodnotou pre farebnú drapériu (B = rýchlosť). */
    channel: 2,
    decode: [WIND_SPEED_RANGE[0], WIND_SPEED_RANGE[1]],
    alpha: 0.82,
  }),
  temp: Object.freeze({
    id: 'temp',
    vars: ['Temperature_height_above_ground'],
    vertCoord: 2,
    unit: '°C',
    convert: { scale: 1, offset: -273.15 },
    rampRange: [-40, 45],
    channel: 0,
    decode: [TEMP_RANGE[0], TEMP_RANGE[1]],
    alpha: 0.82,
  }),
  pressure: Object.freeze({
    id: 'pressure',
    vars: ['Pressure_reduced_to_MSL_msl'],
    unit: 'hPa',
    convert: { scale: 0.01, offset: 0 },
    rampRange: [960, 1050],
    channel: 0,
    decode: [940, 1060],
    alpha: 0.78,
    /** Izobary každé 4 hPa, 1013 zvýraznená. */
    isolines: { step: 4, emphasis: 1013 },
  }),
  precip: Object.freeze({
    id: 'precip',
    vars: ['Precipitation_rate_surface'],
    unit: 'mm/h',
    convert: { scale: 3600, offset: 0 },
    rampRange: [0, 20],
    channel: 0,
    decode: [0, 30],
    alpha: 0.96,
  }),
  clouds: Object.freeze({
    id: 'clouds',
    vars: ['Total_cloud_cover_entire_atmosphere'],
    unit: '%',
    convert: { scale: 1, offset: 0 },
    rampRange: [0, 100],
    channel: 0,
    decode: [0, 100],
    alpha: 0.92,
  }),
  // Výškové hladiny vetra — definície nižšie pri WIND_LEVELS.
  wind850: isobaricWind('wind850', 85000, 60),
  wind700: isobaricWind('wind700', 70000, 60),
  wind500: isobaricWind('wind500', 50000, 90),
  wind250: isobaricWind('wind250', 25000, 130),
  gust: Object.freeze({
    id: 'gust',
    vars: ['Wind_speed_gust_surface'],
    unit: 'm/s',
    convert: { scale: 1, offset: 0 },
    rampRange: [0, 45],
    channel: 0,
    decode: [0, 60],
    alpha: 0.82,
  }),
});

/** Poradie čipov v riadku vrstvy. */
export const METEO_FIELD_ORDER = Object.freeze(['wind', 'temp', 'pressure', 'precip', 'clouds', 'gust']);

/**
 * VÝŠKOVÉ HLADINY VETRA (2026-09-21). GFS ich má ako `*_isobaric` s vertikálnou
 * osou `isobaric` v PASCALOCH (nie hPa — overené v dataset.xml: units="Pa",
 * 41 hladín, 25000 = 250 hPa). Zámena Pa/hPa by ticho vrátila inú hladinu.
 *
 * KAŽDÁ HLADINA MÁ VLASTNÝ ROZSAH KVANTIZÁCIE. Namerané globálne maximá
 * (stride 4, skutočné špičky sú vyššie): 850 hPa 51,7 · 700 hPa 51,3 ·
 * 500 hPa 71,3 · 250 hPa 94,0 m/s. Pri pôvodnom [0, 60] by sa jadro tryskového
 * prúdenia OREZALO — vyšla by plochá presýtená škvrna a častice by sa hýbali
 * nesprávnou rýchlosťou, lebo aj |u| presahuje 60. Rozsahy nesú headroom.
 *
 * Hladiny sa zámerne NEpečú (`bake: false`): sú to štyri polia navyše, teda
 * ~+130 MB na beh. Proxy ich stiahne a nacachuje pri prvom použití.
 */
export const WIND_LEVELS = Object.freeze([
  Object.freeze({ id: 'wind', levelPa: null, label: '10 m' }),
  Object.freeze({ id: 'wind850', levelPa: 85000, label: '850 hPa' }),
  Object.freeze({ id: 'wind700', levelPa: 70000, label: '700 hPa' }),
  Object.freeze({ id: 'wind500', levelPa: 50000, label: '500 hPa' }),
  Object.freeze({ id: 'wind250', levelPa: 25000, label: '250 hPa' }),
]);

/** Je pole vetrom (prízemným alebo výškovým)? Pure. */
export function isWindField(fieldId) {
  return WIND_LEVELS.some((l) => l.id === fieldId);
}

/**
 * Zastávky rampy pre pole. Výškové hladiny vetra zdieľajú paletu prízemného
 * vetra — líšia sa ROZSAHOM (METEO_FIELDS[id].rampRange), nie farbami, takže
 * na 250 hPa sa tá istá škála roztiahne až k tryskovému prúdeniu. Pure.
 */
export function rampStopsFor(fieldId) {
  if (METEO_RAMPS[fieldId]) return METEO_RAMPS[fieldId];
  if (!isWindField(fieldId)) return null;
  // Zastávky vetra sú v m/s (0…45). Na výškovej hladine treba tú istú paletu
  // ROZTIAHNUŤ na jej rozsah — inak by všetko nad 45 m/s spadlo na poslednú
  // zastávku a celé jadro tryskového prúdenia by splynulo do jednej bielej
  // plochy. Zároveň tým legenda ukáže čísla, ktoré na tej hladine platia.
  const range = METEO_FIELDS[fieldId]?.rampRange;
  const base = METEO_RAMPS.wind;
  if (!range) return base;
  const top = base[base.length - 1][0];
  const k = range[1] / top;
  if (!Number.isFinite(k) || k <= 0) return base;
  return Object.freeze(base.map(([v, hex, alpha]) => Object.freeze(
    alpha === undefined ? [Math.round(v * k), hex] : [Math.round(v * k), hex, alpha],
  )));
}

/** Popis hladiny pre dané pole; null pre nevietor. Pure. */
export function windLevelOf(fieldId) {
  return WIND_LEVELS.find((l) => l.id === fieldId) || null;
}

/** Definícia jedného výškového poľa vetra. Pure. */
function isobaricWind(id, levelPa, speedMax) {
  return Object.freeze({
    id,
    vars: ['u-component_of_wind_isobaric', 'v-component_of_wind_isobaric'],
    vertCoord: levelPa,
    unit: 'm/s',
    convert: { scale: 1, offset: 0 },
    rampRange: [0, Math.round(speedMax * 0.75)],
    channel: 2,
    decode: [0, speedMax],
    componentRange: [-speedMax, speedMax],
    alpha: 0.82,
    bake: false,
  });
}

/**
 * Rampy v identite OKO: tmavá noc → azúrová (--accent #39d0ff) → jantárová → červená.
 * Zastávky [hodnota, hex]. Vietor v m/s, teplota v °C.
 */
export const METEO_RAMPS = Object.freeze({
  // Vietor v identite OKO: modrá → azúrová (--accent #39d0ff) → jantárová → biela.
  // TRETÍ prvok je ALFA — v pokoji takmer priehľadná, aby bolo vidieť podklad
  // (pobrežia, popisy miest), pri búrke plná. Rovnaký princíp ako zrážky nižšie.
  wind: Object.freeze([
    [0, '#155e86', 0.18], [3, '#1a8ab0', 0.38], [6, '#25b6dc', 0.55], [10, '#39d0ff', 0.70],
    [14, '#9be6ff', 0.80], [19, '#ffd15c', 0.88], [24, '#ff9a2b', 0.94], [30, '#ff4a3b', 1],
    [37, '#ff2f6b', 1], [45, '#ffffff', 1],
  ]),
  temp: Object.freeze([
    [-40, '#3b1c6e'], [-25, '#2c4aa8'], [-12, '#1f8fc4'], [-4, '#39d0ff'], [4, '#7fe2c8'],
    [12, '#e8e77a'], [20, '#ffc04a'], [28, '#ff7a2b'], [36, '#ff3b3b'], [45, '#8a0c1e'],
  ]),
  // Tlak: tlakové níže fialovo-modré, výše jantárovo-červené, 1013 tyrkysová.
  pressure: Object.freeze([
    [960, '#3b1c6e'], [980, '#2c4aa8'], [995, '#1f8fc4'], [1005, '#39d0ff'], [1013, '#7fe2c8'],
    [1020, '#e8e77a'], [1030, '#ffc04a'], [1040, '#ff7a2b'], [1050, '#ff3b3b'],
  ]),
  // Zrážky a oblačnosť majú ALFU (tretí prvok): bez zrážok je mapa priehľadná.
  precip: Object.freeze([
    [0, '#0a1622', 0], [0.2, '#12708f', 0.35], [1, '#1fb0d8', 0.7], [3, '#39d0ff', 0.85],
    [6, '#9be6ff', 0.9], [10, '#ffd15c', 0.95], [15, '#ff9a2b', 1], [20, '#ff4a3b', 1],
  ]),
  clouds: Object.freeze([
    [0, '#0a1622', 0], [20, '#5d7383', 0.25], [50, '#9fb1bd', 0.55], [80, '#dbe4ea', 0.8], [100, '#ffffff', 0.92],
  ]),
  gust: Object.freeze([
    [0, '#123c5a'], [5, '#155e86'], [10, '#1a8ab0'], [15, '#25b6dc'], [20, '#39d0ff'],
    [25, '#9be6ff'], [30, '#ffd15c'], [36, '#ff9a2b'], [42, '#ff4a3b'], [45, '#ffffff'],
  ]),
});

/** '#rrggbb' → [r,g,b]. Pure. */
export function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Tabuľka RGBA (n × 4) pre 1D textúru rampy nad `range`. Lineárne v RGB. Pure.
 * @param {ReadonlyArray<[number, string]>} stops
 * @param {[number, number]} range
 * @param {number} [n]
 * @returns {Uint8ClampedArray}
 */
export function rampRgbaTable(stops, range, n = 256) {
  const out = new Uint8ClampedArray(n * 4);
  const [lo, hi] = range;
  // Zastávka = [hodnota, hex, alfa?]; alfa default 1 (zrážky/oblačnosť ju znižujú k nule).
  const pts = stops.map(([v, hex, alpha]) => [v, hexToRgb(hex), Number.isFinite(alpha) ? alpha : 1]);
  for (let i = 0; i < n; i += 1) {
    const v = lo + ((hi - lo) * i) / (n - 1);
    let a = pts[0];
    let b = pts[pts.length - 1];
    if (v <= pts[0][0]) b = pts[0];
    else if (v >= pts[pts.length - 1][0]) a = pts[pts.length - 1];
    else {
      for (let k = 0; k < pts.length - 1; k += 1) {
        if (v >= pts[k][0] && v <= pts[k + 1][0]) { a = pts[k]; b = pts[k + 1]; break; }
      }
    }
    const span = b[0] - a[0];
    const f = span > 0 ? Math.min(1, Math.max(0, (v - a[0]) / span)) : 0;
    out[i * 4] = a[1][0] + (b[1][0] - a[1][0]) * f;
    out[i * 4 + 1] = a[1][1] + (b[1][1] - a[1][1]) * f;
    out[i * 4 + 2] = a[1][2] + (b[1][2] - a[1][2]) * f;
    out[i * 4 + 3] = Math.round(255 * (a[2] + (b[2] - a[2]) * f));
  }
  return out;
}

/** CSS `linear-gradient` rampy pre legendu. Pure. */
export function rampCss(stops, range) {
  const [lo, hi] = range;
  const parts = stops.map(([v, hex]) => `${hex} ${(((v - lo) / (hi - lo)) * 100).toFixed(1)}%`);
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

/** Položky legendy pre riadok vrstvy (každá druhá zastávka, nech je to čitateľné). Pure. */
export function rampLegend(stops, unit, every = 2) {
  return stops.filter((_, i) => i % every === 0).map(([v, hex]) => ({ color: hex, label: `${v} ${unit}`, count: '' }));
}

/** Kvantizácia hodnoty do 0..255 nad rozsahom; NaN → 0. Pure. */
export function quantize(value, [lo, hi]) {
  if (!Number.isFinite(value)) return 0;
  const f = (value - lo) / (hi - lo);
  return Math.max(0, Math.min(255, Math.round(f * 255)));
}

/** Späť z 0..255 na hodnotu. Pure. */
export function dequantize(byte, [lo, hi]) {
  return lo + (byte / 255) * (hi - lo);
}

/**
 * Kroky predpovede: od „teraz" zaokrúhleného nadol na krok, po horizont. Pure.
 * @param {number} nowMs
 * @param {{stepHours?: number, horizonHours?: number}} [options]
 * @returns {string[]} ISO časy (UTC, celé hodiny)
 */
export function forecastSteps(nowMs, { stepHours = METEO_STEP_HOURS, horizonHours = METEO_HORIZON_HOURS } = {}) {
  const stepMs = stepHours * 3600_000;
  const start = Math.floor(nowMs / stepMs) * stepMs;
  const out = [];
  for (let h = 0; h <= horizonHours; h += stepHours) out.push(new Date(start + h * 3600_000).toISOString().slice(0, 13) + ':00:00Z');
  return out;
}

/** Index kroku najbližšieho k času. Pure. */
export function nearestStepIndex(steps, targetMs) {
  let best = 0;
  let bestD = Infinity;
  steps.forEach((iso, i) => {
    const d = Math.abs(Date.parse(iso) - targetMs);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

/** URL rezu z proxy. Pure. */
export function sliceUrl(fieldId, iso) {
  return `/api/meteo/slice?var=${encodeURIComponent(fieldId)}&time=${encodeURIComponent(iso)}`;
}

const DAY_SK = ['Ne', 'Po', 'Ut', 'St', 'Št', 'Pi', 'So'];
const DAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Popis kroku: „Ut 8. 9. 06:00 UTC · +06 h" (od behu). Pure.
 * @param {string} iso krok
 * @param {string|null} runIso beh modelu (reftime)
 * @param {'sk'|'en'} [lang]
 */
export function stepLabel(iso, runIso, lang = 'sk') {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const days = lang === 'en' ? DAY_EN : DAY_SK;
  const date = lang === 'en'
    ? `${days[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`
    : `${days[d.getUTCDay()]} ${d.getUTCDate()}. ${d.getUTCMonth() + 1}.`;
  const hhmm = iso.slice(11, 16);
  const run = Date.parse(runIso || '');
  const lead = Number.isFinite(run) ? Math.round((d.getTime() - run) / 3600_000) : null;
  const leadText = lead === null ? '' : ` · ${lead >= 0 ? '+' : '−'}${String(Math.abs(lead)).padStart(2, '0')} h`;
  return `${date} ${hhmm} UTC${leadText}`;
}

/** „GFS 0,25° · beh 08.09. 06Z" — hlavička zdroja. Pure. */
export function runLabel(runIso, lang = 'sk') {
  const d = new Date(runIso || '');
  if (Number.isNaN(d.getTime())) return lang === 'en' ? 'GFS 0.25° · run unknown' : 'GFS 0,25° · beh neznámy';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  return lang === 'en' ? `GFS 0.25° · run ${dd}/${mm} ${hh}Z` : `GFS 0,25° · beh ${dd}.${mm}. ${hh}Z`;
}

/**
 * Normalizuje katalóg z proxy. Pure.
 * @param {object|null} json
 * @returns {{steps: string[], run: string|null, model: string, attribution: string, stale: boolean, baked: number, bakedTotal: number}|null}
 */
export function normalizeCatalog(json) {
  if (!json || !Array.isArray(json.steps) || !json.steps.length) return null;
  const steps = json.steps.filter((s) => typeof s === 'string' && !Number.isNaN(Date.parse(s)));
  if (!steps.length) return null;
  return {
    steps,
    run: typeof json.run === 'string' && !Number.isNaN(Date.parse(json.run)) ? json.run : null,
    model: String(json.model || 'GFS 0.25°'),
    attribution: String(json.attribution || ''),
    stale: json.stale === true,
    baked: Number(json.baked) || 0,
    bakedTotal: Number(json.bakedTotal) || steps.length,
  };
}
