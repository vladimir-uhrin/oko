// src/data/gfwPresenceCore.js
// Global Fishing Watch — satelitná prítomnosť lodí (4Wings, dataset
// public-global-presence), čisté pomôcky zdieľané proxy vo vite.config.js a
// vrstvou gfwPresence.js (2026-09-12, používateľ: „potrebujem aktuálne dáta
// alebo len trochu staré" pre Perzský záliv, kde terestriálne AIS nič nevidí).
//
// Čo to JE: prítomnosť lode v bunkách mriežky — za hodinu (HOURLY) alebo za
// celé okno (ENTIRE) — z AIS prijatého satelitmi aj zo zeme, s oneskorením.
// Posledný ÚPLNÝ deň je D−4 (overené 2026-09-12 16:00 Z: rozsah 4.–12. 9.
// vrátil dni 4.–8. 9.). Čo to NIE JE: živé polohy ani fixy. Každý riadok nesie
// bunku, nie fix, a vrstva to hlási ako ONESKORENÉ s dňom dát.
//
// Režimy správy (2026-09-12, „prečo nemajú pozície?": v LOW mriežke 0,1° stáli
// lode v stĺpcoch a pri ENTIRE majú všetky bunky lode tie isté pečiatky, takže
// „posledná bunka" bola náhodná bunka z trasy):
//   hourly  = HIGH 0,01° + HOURLY + CSV (ZIP): riadok = bunka v jednej hodine,
//             posledná hodina lode = skutočná posledná poloha (~1 km);
//             celý záliv 7,3 MB zip / 103 k riadkov / 19 s (JSON by mal 50 MB).
//   dayCell = LOW 0,1° + ENTIRE + JSON: záloha pre rušné moria, kde by zip
//             prekročil strop; bunka s najviac hodinami za deň.
// Koniec `date-range` je EXKLUZÍVNY (`07,07` → 0 riadkov, `06,07` → len 6.).
//
// Licencia: CC BY-NC 4.0, „The Services are available for noncommercial use
// only in accordance with the CC BY-NC 4.0 license"; atribúcia „Powered by
// Global Fishing Watch." s odkazom. Limity 50 000 volaní/deň, 1 500 000/mesiac
// na používateľa (License & rate limits). Token výhradne na serveri.
// Bez DOM, bez Cesia, bez Node API — testovateľné v Node aj v prehliadači.

export const GFW_API_BASE = 'https://gateway.api.globalfishingwatch.org/v3';
export const GFW_PRESENCE_DATASET = 'public-global-presence:latest';
/** Dokumentované oneskorenie dát GFW (h); v praxi je posledný úplný deň D−4. */
export const GFW_DELAY_HOURS = 72;
/** Rozlíšenie LOW = 0,1° (~11 km) — záložný režim denných buniek. */
export const GFW_CELL_DEG = 0.1;
/** Rozlíšenie HIGH = 0,01° (~1 km) — hodinové bunky, hlavný režim. */
export const GFW_HIGH_CELL_DEG = 0.01;
/** Výrez sa zaokrúhľuje na celé stupne, aby cache trafila aj pri malom pohybe kamery. */
export const GFW_BBOX_QUANT_DEG = 1;
/** Najväčšia hrana výrezu (°): nad ňou by odpoveď rástla do desiatok MB a limit by tiekol. */
export const GFW_MAX_BBOX_SPAN_DEG = 40;
/** Koľko dní dozadu skúsiť, keď je posledný úplný deň ešte prázdny (spracovanie mešká). */
export const GFW_DAY_STEP_BACK_MAX = 2;

/** Režimy správy 4Wings; `cellDeg` ide do meta odpovede a do popisiek. */
export const GFW_MODES = Object.freeze({
  hourly: Object.freeze({ id: 'hourly', resolution: 'HIGH', temporal: 'HOURLY', format: 'CSV', cellDeg: GFW_HIGH_CELL_DEG }),
  dayCell: Object.freeze({ id: 'dayCell', resolution: 'LOW', temporal: 'ENTIRE', format: 'JSON', cellDeg: GFW_CELL_DEG }),
});

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

const DAY_MS = 86_400_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const shiftIsoDay = (day, days) => isoDay(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS);

/**
 * Okno = posledný ÚPLNÝ deň. Deň, v ktorom oneskorenie práve končí, môže byť
 * ešte neúplný, preto deň PRED ním. `to` je exkluzívny koniec (deň + 1) —
 * s `from === to` API vráti prázdno. Pure.
 * @param {number} nowMs
 * @param {{delayHours?:number}} [opts]
 * @returns {{day:string, from:string, to:string, delayHours:number}}
 */
export function gfwPresenceDateRange(nowMs, { delayHours = GFW_DELAY_HOURS } = {}) {
  const day = isoDay(nowMs - delayHours * 3_600_000 - DAY_MS);
  return { day, from: day, to: shiftIsoDay(day, 1), delayHours };
}

/** Okno o deň skôr (keď posledný úplný deň ešte nie je spracovaný). Pure. */
export function gfwPreviousDayRange(range) {
  const day = shiftIsoDay(range.day, -1);
  return { ...range, day, from: day, to: range.day };
}

/**
 * URL správy 4Wings. Pure.
 * @param {{from:string, to:string}} range
 * @param {{base?:string, dataset?:string, mode?:{resolution:string, temporal:string, format:string}}} [opts]
 */
export function gfwReportUrl(range, { base = GFW_API_BASE, dataset = GFW_PRESENCE_DATASET, mode = GFW_MODES.hourly } = {}) {
  const url = new URL(`${base}/4wings/report`);
  url.searchParams.set('spatial-resolution', mode.resolution);
  url.searchParams.set('temporal-resolution', mode.temporal);
  // VESSEL_ID (2026-09-12, „doplň mená"): zoskupenie po MMSI nenesie meno, typ
  // ani vlajku; po ID lode ich správa nesie priamo (overené: 2 790 z 2 795
  // riadkov s menom). Jedna bunka na loď sa aj tak skladá po MMSI.
  url.searchParams.set('group-by', 'VESSEL_ID');
  url.searchParams.set('datasets[0]', dataset);
  url.searchParams.set('date-range', `${range.from},${range.to}`);
  url.searchParams.set('format', mode.format);
  return url.toString();
}

/** Kľúč cache: výrez + deň dát. Pure. */
export function gfwPresenceCacheKey(b, range) {
  return `${b.west},${b.south},${b.east},${b.north}@${range.day}`;
}

const finite = (v) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const epochMs = (v) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : null; };

/**
 * Sploští JSON odpoveď 4Wings (`entries[i][datasetKey] = [rows]`) na jednotný
 * tvar. Toleruje neznáme kľúče datasetu aj chýbajúce polia. Pure.
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
        out.push({
          mmsi: String(r?.mmsi ?? '').trim(),
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

/**
 * Rozloží CSV na záznamy: úvodzovky, zdvojené úvodzovky, čiarky a nové riadky
 * v poli, CRLF aj LF, prázdne riadky sa vynechajú. Pure.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsvRecords(text) {
  const src = String(text || '');
  const n = src.length;
  const records = [];
  let row = [];
  let i = 0;
  while (i < n) {
    let field = '';
    if (src[i] === '"') {
      let j = i + 1;
      for (;;) {
        const q = src.indexOf('"', j);
        if (q < 0) { field += src.slice(j); j = n; break; }
        field += src.slice(j, q);
        if (src[q + 1] === '"') { field += '"'; j = q + 2; continue; }
        j = q + 1;
        break;
      }
      i = j;
    }
    let j = i;
    while (j < n && src[j] !== ',' && src[j] !== '\n' && src[j] !== '\r') j++;
    field += src.slice(i, j);
    i = j;
    row.push(field);
    if (i >= n) break;
    if (src[i] === ',') { i++; if (i >= n) row.push(''); continue; }
    if (src[i] === '\r') i++;
    if (src[i] === '\n') i++;
    records.push(row);
    row = [];
  }
  if (row.length) records.push(row);
  return records.filter((r) => r.length > 1 || r[0] !== '');
}

/** Hlavička CSV 4Wings → naše kľúče (bez medzier, malé písmená). */
const CSV_COLUMNS = Object.freeze({
  lat: 'lat', lon: 'lon', timerange: 'timeRange', vesselid: 'vesselId', flag: 'flag', vesselname: 'name', shipname: 'name',
  entrytimestamp: 'entry', exittimestamp: 'exit', vesseltype: 'type', mmsi: 'mmsi', imo: 'imo', callsign: 'callsign',
  vesselpresencehours: 'hours', hours: 'hours',
});

/** „2026-09-08 04:00" (hodinový kôš) alebo „2026-09-08" → epocha UTC; inak null. Pure. */
export function gfwTimeRangeMs(value) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(value ?? '').trim());
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2] || '00'}:${m[3] || '00'}:00Z`);
  return Number.isFinite(t) ? t : null;
}

/**
 * CSV správy 4Wings (člen ZIPu pri format=CSV) → rovnaký tvar riadkov ako
 * normalizeGfwPresence. Pri HOURLY je `Time Range` hodinový kôš bunky, ten je
 * firstSeen aj lastSeen riadku (pečiatky Entry/Exit sú za celú loď). Pure.
 * @param {string} text
 */
export function parseGfwPresenceCsv(text) {
  const records = parseCsvRecords(text);
  if (!records.length) return [];
  const idx = {};
  records[0].forEach((h, i) => {
    const key = CSV_COLUMNS[String(h).toLowerCase().replace(/[^a-z]/g, '')];
    if (key && idx[key] === undefined) idx[key] = i;
  });
  if (idx.lat === undefined || idx.lon === undefined) return [];
  const get = (rec, key) => (idx[key] === undefined ? '' : String(rec[idx[key]] ?? '').trim());
  const out = [];
  for (let r = 1; r < records.length; r++) {
    const rec = records[r];
    const lat = finite(get(rec, 'lat'));
    const lon = finite(get(rec, 'lon'));
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const bin = gfwTimeRangeMs(get(rec, 'timeRange'));
    const entry = epochMs(get(rec, 'entry'));
    const exit = epochMs(get(rec, 'exit'));
    out.push({
      mmsi: get(rec, 'mmsi'),
      name: get(rec, 'name'),
      type: get(rec, 'type'),
      flag: get(rec, 'flag'),
      callsign: get(rec, 'callsign'),
      imo: get(rec, 'imo'),
      lat,
      lon,
      hours: finite(get(rec, 'hours')) ?? 0,
      firstSeen: bin ?? entry,
      lastSeen: bin ?? exit ?? entry,
      vesselId: get(rec, 'vesselId'),
    });
  }
  return out;
}

/** Polia identity, ktoré sa po MMSI dopĺňajú z ktoréhokoľvek riadku tej istej lode. */
const GFW_IDENTITY_FIELDS = ['name', 'type', 'flag', 'callsign', 'imo'];

/**
 * Jedna bunka na loď: naposledy videná (najneskorší lastSeen — pri HOURLY
 * posledná hodina dňa), pri zhode s viac hodinami. Súčasne sa za loď skladá
 * súčet hodín za deň a prvá/posledná pečiatka, takže karta hovorí „21 h v ten
 * deň" a nie hodiny jednej bunky. Riadky bez MMSI ostávajú každý sám.
 *
 * Identita (meno, typ, vlajka, volací znak, IMO) sa dopĺňa z ostatných riadkov
 * toho istého MMSI: po VESSEL_ID má jedna loď aj viac ID a víťazná bunka môže
 * byť práve tá bez mena — naživo tak TASNIM (620999679) v širokom výreze vyšla
 * ako holé MMSI (2026-09-12, „doplň mená"). Pure.
 * @param {ReturnType<typeof normalizeGfwPresence>} rows
 */
export function latestGfwCellPerVessel(rows) {
  const best = new Map();
  const agg = new Map();
  const loose = [];
  for (const r of rows) {
    if (!r.mmsi) { loose.push(r); continue; }
    let a = agg.get(r.mmsi);
    if (!a) { a = { hours: 0, firstSeen: null, lastSeen: null }; agg.set(r.mmsi, a); }
    a.hours += Number.isFinite(r.hours) ? r.hours : 0;
    if (r.firstSeen != null && (a.firstSeen == null || r.firstSeen < a.firstSeen)) a.firstSeen = r.firstSeen;
    if (r.lastSeen != null && (a.lastSeen == null || r.lastSeen > a.lastSeen)) a.lastSeen = r.lastSeen;
    for (const field of GFW_IDENTITY_FIELDS) if (!a[field] && r[field]) a[field] = r[field];
    const prev = best.get(r.mmsi);
    if (!prev) { best.set(r.mmsi, r); continue; }
    const x = r.lastSeen ?? -Infinity;
    const y = prev.lastSeen ?? -Infinity;
    if (x > y || (x === y && r.hours > prev.hours)) best.set(r.mmsi, r);
  }
  const merged = [];
  for (const r of best.values()) {
    const a = agg.get(r.mmsi);
    const out = { ...r, hours: Math.round(a.hours * 100) / 100, firstSeen: a.firstSeen, lastSeen: a.lastSeen };
    for (const field of GFW_IDENTITY_FIELDS) if (!out[field] && a[field]) out[field] = a[field];
    merged.push(out);
  }
  return [...merged, ...loose];
}
