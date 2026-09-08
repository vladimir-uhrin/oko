// src/data/meteoField.js
// Meteorológia sveta — čisté pomôcky (2026-09-08, prototyp „Windy štýl"):
// katalóg krokov predpovede, kvantizácia polí do PNG, farebné rampy v identite
// OKO (azúrová → jantárová → červená), popisky. Žiadny DOM, žiadne Cesium.
//
// Zdroj: NOAA/NCEP GFS 0,25° (verejná doména USA) cez NSF Unidata THREDDS
// NetCDF Subset Service (server proxy /api/meteo, DATA_SOURCES.md). Sú to
// MODELOVÉ dáta (predpoveď), nikdy nie pozorovanie — UI to musí hovoriť.

export const METEO_LAYER_ID = 'meteo-gfs';
/** Krok predpovede v hodinách a horizont prototypu. */
export const METEO_STEP_HOURS = 3;
export const METEO_HORIZON_HOURS = 48;
/** Rozsah kvantizácie zložiek vetra v PNG (R = u, G = v), m/s. */
export const WIND_COMPONENT_RANGE = Object.freeze([-60, 60]);
/** Rozsah kvantizácie rýchlosti vetra (B), m/s. */
export const WIND_SPEED_RANGE = Object.freeze([0, 60]);
/** Rozsah kvantizácie teploty 2 m (R), °C. */
export const TEMP_RANGE = Object.freeze([-60, 60]);

/** Polia prototypu: id → THREDDS premenné, popis, rozsah rampy. */
export const METEO_FIELDS = Object.freeze({
  wind: Object.freeze({
    id: 'wind',
    vars: ['u-component_of_wind_height_above_ground', 'v-component_of_wind_height_above_ground'],
    vertCoord: 10,
    unit: 'm/s',
    rampRange: [0, 45],
    /** Kanál PNG s hodnotou pre farebnú drapériu (B = rýchlosť). */
    channel: 2,
    decode: [WIND_SPEED_RANGE[0], WIND_SPEED_RANGE[1]],
  }),
  temp: Object.freeze({
    id: 'temp',
    vars: ['Temperature_height_above_ground'],
    vertCoord: 2,
    unit: '°C',
    rampRange: [-40, 45],
    channel: 0,
    decode: [TEMP_RANGE[0], TEMP_RANGE[1]],
  }),
});

/**
 * Rampy v identite OKO: tmavá noc → azúrová (--accent #39d0ff) → jantárová → červená.
 * Zastávky [hodnota, hex]. Vietor v m/s, teplota v °C.
 */
export const METEO_RAMPS = Object.freeze({
  wind: Object.freeze([
    [0, '#0a1622'], [3, '#0f3a52'], [6, '#12708f'], [10, '#1fb0d8'], [14, '#39d0ff'],
    [19, '#9be6ff'], [24, '#ffd15c'], [30, '#ff9a2b'], [37, '#ff4a3b'], [45, '#ffffff'],
  ]),
  temp: Object.freeze([
    [-40, '#3b1c6e'], [-25, '#2c4aa8'], [-12, '#1f8fc4'], [-4, '#39d0ff'], [4, '#7fe2c8'],
    [12, '#e8e77a'], [20, '#ffc04a'], [28, '#ff7a2b'], [36, '#ff3b3b'], [45, '#8a0c1e'],
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
  const pts = stops.map(([v, hex]) => [v, hexToRgb(hex)]);
  for (let i = 0; i < n; i += 1) {
    const v = lo + ((hi - lo) * i) / (n - 1);
    let a = pts[0];
    let b = pts[pts.length - 1];
    for (let k = 0; k < pts.length - 1; k += 1) {
      if (v >= pts[k][0] && v <= pts[k + 1][0]) { a = pts[k]; b = pts[k + 1]; break; }
    }
    const span = b[0] - a[0];
    const f = span > 0 ? Math.min(1, Math.max(0, (v - a[0]) / span)) : 0;
    out[i * 4] = a[1][0] + (b[1][0] - a[1][0]) * f;
    out[i * 4 + 1] = a[1][1] + (b[1][1] - a[1][1]) * f;
    out[i * 4 + 2] = a[1][2] + (b[1][2] - a[1][2]) * f;
    out[i * 4 + 3] = 255;
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
 * @returns {{steps: string[], run: string|null, model: string, attribution: string, stale: boolean}|null}
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
  };
}
