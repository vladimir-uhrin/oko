// src/data/gfwPresenceCore.js
// Global Fishing Watch — satelitná prítomnosť lodí (4Wings, dataset
// public-global-presence), čisté pomôcky zdieľané proxy vo vite.config.js a
// vrstvou gfwPresence.js (2026-09-12, používateľ: „potrebujem aktuálne dáta
// alebo len trochu staré" pre Perzský záliv, kde terestriálne AIS nič nevidí).
//
// Čo to JE: mriežka prítomnosti 0,1° (LOW) z AIS prijatého satelitmi aj zo
// zeme, po lodiach (group-by MMSI), s oneskorením ~72 h („Dynamic, near real
// time data (72 hour delay)" — dostupnosť dát GFW). Čo to NIE JE: živé
// polohy. Preto každý riadok nesie stred bunky, nie fix, a vrstva to musí
// hlásiť ako ONESKORENÉ.
//
// Licencia: CC BY-NC 4.0, „The Services are available for noncommercial use
// only in accordance with the CC BY-NC 4.0 license"; atribúcia „Powered by
// Global Fishing Watch." s odkazom. Limity 50 000 volaní/deň, 1 500 000/mesiac
// na používateľa (License & rate limits). Token výhradne na serveri.
// Bez DOM, bez Cesia — testovateľné v Node.

export const GFW_API_BASE = 'https://gateway.api.globalfishingwatch.org/v3';
export const GFW_PRESENCE_DATASET = 'public-global-presence:latest';
/** Oneskorenie dát podľa dokumentácie dostupnosti GFW (h). */
export const GFW_DELAY_HOURS = 72;
/** Rozlíšenie LOW = 0,1° (~11 km); stred bunky je najlepšia dostupná poloha. */
export const GFW_CELL_DEG = 0.1;
/** Výrez sa zaokrúhľuje na celé stupne, aby cache trafila aj pri malom pohybe kamery. */
export const GFW_BBOX_QUANT_DEG = 1;
/** Najväčšia hrana výrezu (°): nad ňou by odpoveď rástla do MB a limit by tiekol. */
export const GFW_MAX_BBOX_SPAN_DEG = 40;
/** Okno dní končiace pred oneskorením: 2 dni = jedna „posledná známa bunka" na loď bez staroby. */
export const GFW_WINDOW_DAYS = 2;

/**
 * Prečíta `bbox=west,south,east,north` (°). Pure. Antimeridián (west > east)
 * v prvej verzii odmietame — polygón by sa musel deliť.
 * @param {string|null|undefined} value
 * @returns {{west:number, south:number, east:number, north:number}|null}
 */
export function parseGfwBbox(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parts = value.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  const [west, south, east, north] = parts;
  if (Math.abs(west) > 180 || Math.abs(east) > 180 || Math.abs(south) > 90 || Math.abs(north) > 90) return null;
  if (!(west < east) || !(south < north)) return null;
  return { west, south, east, north };
}

/**
 * Roztiahne výrez na násobky `step` (von, nikdy dnu) a oreže na svet. Pure.
 * @param {{west:number, south:number, east:number, north:number}} b
 * @param {number} [step]
 */
export function quantizeGfwBbox(b, step = GFW_BBOX_QUANT_DEG) {
  const down = (v) => Math.floor(v / step) * step;
  const up = (v) => Math.ceil(v / step) * step;
  const west = Math.max(-180, down(b.west));
  const east = Math.min(180, up(b.east));
  const south = Math.max(-90, down(b.south));
  const north = Math.min(90, up(b.north));
  return {
    west,
    south,
    east: east > west ? east : Math.min(180, west + step),
    north: north > south ? north : Math.min(90, south + step),
  };
}

/**
 * Dôvod odmietnutia výrezu, alebo null. Pure.
 * @param {{west:number, south:number, east:number, north:number}|null} b
 * @param {number} [maxSpanDeg]
 * @returns {string|null}
 */
export function gfwBboxError(b, maxSpanDeg = GFW_MAX_BBOX_SPAN_DEG) {
  if (!b) return 'bbox required: west,south,east,north';
  if (b.east - b.west > maxSpanDeg || b.north - b.south > maxSpanDeg) {
    return `bbox too large: max ${maxSpanDeg}° per side (zoom in)`;
  }
  return null;
}

/** GeoJSON polygón výrezu pre telo POST /4wings/report. Pure. */
export function gfwBboxPolygon(b) {
  const { west: w, south: s, east: e, north: n } = b;
  return { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] };
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Dátumové okno `date-range` končiace pred oneskorením dát. Deň, v ktorom
 * oneskorenie práve končí, môže byť ešte neúplný, preto `to` je deň PRED ním.
 * Pure.
 * @param {number} nowMs
 * @param {{delayHours?:number, windowDays?:number}} [opts]
 * @returns {{from:string, to:string, delayHours:number}}
 */
export function gfwPresenceDateRange(nowMs, { delayHours = GFW_DELAY_HOURS, windowDays = GFW_WINDOW_DAYS } = {}) {
  const day = 86_400_000;
  const toMs = nowMs - delayHours * 3_600_000 - day;
  const fromMs = toMs - (Math.max(1, windowDays) - 1) * day;
  return { from: isoDay(fromMs), to: isoDay(toMs), delayHours };
}

/**
 * URL správy 4Wings. Pure.
 * @param {{from:string, to:string}} range
 * @param {{base?:string, dataset?:string}} [opts]
 */
export function gfwReportUrl(range, { base = GFW_API_BASE, dataset = GFW_PRESENCE_DATASET } = {}) {
  const url = new URL(`${base}/4wings/report`);
  url.searchParams.set('spatial-resolution', 'LOW');
  url.searchParams.set('temporal-resolution', 'ENTIRE');
  // VESSEL_ID (2026-09-12, „doplň mená"): zoskupenie po MMSI nenesie meno, typ
  // ani vlajku; po ID lode ich správa nesie priamo (overené: 2 790 z 2 795
  // riadkov s menom), takže netreba ďalšie dopyty na Vessels API. Jedna bunka
  // na loď sa aj tak skladá po MMSI (latestGfwCellPerVessel).
  url.searchParams.set('group-by', 'VESSEL_ID');
  url.searchParams.set('datasets[0]', dataset);
  url.searchParams.set('date-range', `${range.from},${range.to}`);
  url.searchParams.set('format', 'JSON');
  return url.toString();
}

/** Kľúč cache: výrez + okno. Pure. */
export function gfwPresenceCacheKey(b, range) {
  return `${b.west},${b.south},${b.east},${b.north}@${range.from}_${range.to}`;
}

const finite = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
const epochMs = (v) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : null; };

/**
 * Sploští odpoveď 4Wings (`entries[i][datasetKey] = [rows]`) na jednotný tvar.
 * Toleruje neznáme kľúče datasetu aj chýbajúce polia. Pure.
 * @param {object} json
 * @returns {Array<{mmsi:string, name:string, type:string, flag:string, callsign:string, imo:string, lat:number, lon:number, hours:number, firstSeen:number|null, lastSeen:number|null, vesselId:string}>}
 */
export function normalizeGfwPresence(json) {
  const out = [];
  const entries = Array.isArray(json?.entries) ? json.entries : [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    for (const rows of Object.values(entry)) {
      if (!Array.isArray(rows)) continue;
      for (const r of rows) {
        const lat = finite(r?.lat);
        const lon = finite(r?.lon);
        if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
        const mmsi = String(r?.mmsi ?? '').trim();
        out.push({
          mmsi,
          name: String(r?.shipName ?? r?.shipname ?? '').trim(),
          type: String(r?.vesselType ?? r?.vessel_type ?? '').trim(),
          flag: String(r?.flag ?? '').trim(),
          callsign: String(r?.callsign ?? r?.callSign ?? '').trim(),
          imo: String(r?.imo ?? '').trim(),
          lat,
          lon,
          hours: finite(r?.hours) ?? 0,
          firstSeen: epochMs(r?.entryTimestamp),
          lastSeen: epochMs(r?.exitTimestamp ?? r?.entryTimestamp),
          vesselId: String(r?.vesselId ?? r?.vessel_id ?? '').trim(),
        });
      }
    }
  }
  return out;
}

/** Polia identity, ktoré sa po MMSI dopĺňajú z ktoréhokoľvek riadku tej istej lode. */
const GFW_IDENTITY_FIELDS = ['name', 'type', 'flag', 'callsign', 'imo'];

/**
 * Jedna bunka na loď: naposledy videná (najneskorší lastSeen), pri zhode s
 * viac hodinami. Riadky bez MMSI ostávajú každý sám (nedajú sa zlúčiť).
 *
 * Identita (meno, typ, vlajka, volací znak, IMO) sa dopĺňa z ostatných riadkov
 * toho istého MMSI: po VESSEL_ID má jedna loď aj viac ID a víťazná (najnovšia)
 * bunka môže byť práve tá bez mena — naživo tak TASNIM (620999679) v širokom
 * výreze vyšla ako holé MMSI (2026-09-12, „doplň mená"). Pure.
 * @param {ReturnType<typeof normalizeGfwPresence>} rows
 */
export function latestGfwCellPerVessel(rows) {
  const best = new Map();
  const identity = new Map();
  const loose = [];
  for (const r of rows) {
    if (!r.mmsi) { loose.push(r); continue; }
    let known = identity.get(r.mmsi);
    if (!known) { known = {}; identity.set(r.mmsi, known); }
    for (const field of GFW_IDENTITY_FIELDS) if (!known[field] && r[field]) known[field] = r[field];
    const prev = best.get(r.mmsi);
    if (!prev) { best.set(r.mmsi, r); continue; }
    const a = r.lastSeen ?? -Infinity;
    const b = prev.lastSeen ?? -Infinity;
    if (a > b || (a === b && r.hours > prev.hours)) best.set(r.mmsi, r);
  }
  const merged = [];
  for (const r of best.values()) {
    const known = identity.get(r.mmsi);
    const out = { ...r };
    for (const field of GFW_IDENTITY_FIELDS) if (!out[field] && known[field]) out[field] = known[field];
    merged.push(out);
  }
  return [...merged, ...loose];
}
