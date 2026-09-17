// src/straitTraffic.js
//
// "Vessels in the strait right now" — the iconic figure from the upstream
// chokepoint reveal (traffic collapsing from ~130 to ~10 a day). Pure counting
// over the vessel layers' positions, filtered to a chokepoint scene's rectangle.
//
// Honesty (CLAUDE.md rule 2): the count is AIS-tracked vessels IN VIEW NOW —
// live AIS plus delayed AISHub, DEDUPED by MMSI so a ship carried by both feeds
// counts once. It is deliberately NOT "total traffic": AIS coverage is partial
// (terrestrial gaps in the Gulf), so the counter is labelled "tracked now", not
// a complete census. GFW SAR is intentionally excluded here — it is a 10-day
// radar footprint (delayed, per-pass), a different unit from a live vessel, and
// folding it into a "now" number would be dishonest; it stays its own layer.
//
// Chokepoint rectangles never straddle the antimeridian (all curated straits
// have west < east well inside ±180), so a plain bounding-box test is correct.

const lonOf = (p) => (Number.isFinite(p?.longitude) ? p.longitude : p?.lon);
const latOf = (p) => (Number.isFinite(p?.latitude) ? p.latitude : p?.lat);
const idOf = (p) => String(p?.id ?? p?.mmsi ?? '');

/**
 * Is a point inside a [west, south, east, north] rectangle (degrees, inclusive)?
 * @param {number} lon
 * @param {number} lat
 * @param {ReadonlyArray<number>} rect
 * @returns {boolean}
 */
export function isInRect(lon, lat, rect) {
  if (!Array.isArray(rect) || rect.length !== 4) return false;
  const [west, south, east, north] = rect;
  if (![west, south, east, north].every(Number.isFinite)) return false;
  return Number.isFinite(lon) && Number.isFinite(lat)
    && lon >= west && lon <= east && lat >= south && lat <= north;
}

/**
 * Count positions inside the rectangle. Accepts {longitude,latitude} or
 * {lon,lat} rows.
 * @param {Array<object>} positions
 * @param {ReadonlyArray<number>} rect
 * @returns {number}
 */
export function countInRect(positions, rect) {
  if (!Array.isArray(positions)) return 0;
  let n = 0;
  for (const p of positions) if (isInRect(lonOf(p), latOf(p), rect)) n += 1;
  return n;
}

/** Speed above which a vessel counts as under way, in knots. */
const MOVING_KTS = 0.5;

/**
 * Bucket an AIS ship type (numeric 0–99, or a text label) into a coarse class.
 * A missing type is 'unknown', kept separate from 'other' (a known-but-other
 * type) — the delayed AISHub feed often carries no ship type, and lumping those
 * into "other" would overstate how much is actually classified.
 * @param {number|string|null} type
 * @returns {'tanker'|'cargo'|'passenger'|'other'|'unknown'}
 */
export function vesselTypeBucket(type) {
  if (type === null || type === undefined || type === '') return 'unknown';
  const n = Number(type);
  if (Number.isFinite(n)) {
    if (n >= 80 && n <= 89) return 'tanker';
    if (n >= 70 && n <= 79) return 'cargo';
    if (n >= 60 && n <= 69) return 'passenger';
    if (n === 0) return 'unknown'; // AIS 0 = "not available"
    if (n >= 1) return 'other';
  }
  const s = String(type).toLowerCase();
  if (s.includes('tanker')) return 'tanker';
  if (s.includes('cargo')) return 'cargo';
  if (s.includes('passenger') || s.includes('cruise') || s.includes('ferry')) return 'passenger';
  return 'other';
}

/**
 * Counts of AIS-tracked vessels inside a strait rectangle, plus a type
 * breakdown, movement summary and the radar-only ("no AIS") count.
 *
 * `types`, `moving` and `avgSpeedKts` are over the DEDUPED live+delayed set.
 * `dark` is the sum of SAR detections in the rect with no AIS match — delayed
 * (per-pass), a different unit from a live vessel, so the card labels it as such.
 *
 * @param {{live?: Array<object>, delayed?: Array<object>, sar?: Array<object>}} sources
 * @param {ReadonlyArray<number>} rect
 * @param {{dedupe?: boolean}} [opts] dedupe delayed against live by MMSI (default true)
 */
export function buildStraitTrafficModel({ live = [], delayed = [], sar = [] } = {}, rect, { dedupe = true } = {}) {
  const inRect = (p) => isInRect(lonOf(p), latOf(p), rect);
  const liveIn = (Array.isArray(live) ? live : []).filter(inRect);
  const liveIds = new Set(liveIn.map(idOf));
  const delayedIn = (Array.isArray(delayed) ? delayed : []).filter(inRect).filter((p) => !(dedupe && liveIds.has(idOf(p))));
  const vessels = liveIn.concat(delayedIn);

  const types = { tanker: 0, cargo: 0, passenger: 0, other: 0, unknown: 0 };
  let moving = 0;
  let speedSum = 0;
  let speedN = 0;
  for (const v of vessels) {
    types[vesselTypeBucket(v.type)] += 1;
    if (Number.isFinite(v.sog)) {
      speedN += 1;
      speedSum += v.sog;
      if (v.sog > MOVING_KTS) moving += 1;
    }
  }

  // Dark = distinct SAR cells with no AIS match in the rect. Counting CELLS
  // (not summing per-cell detections over the multi-day pass window) keeps the
  // figure a sane "locations seen by radar without AIS", not an inflated total.
  let dark = 0;
  for (const d of (Array.isArray(sar) ? sar : [])) {
    if (!d || d.matched || !inRect(d)) continue;
    dark += 1;
  }

  return {
    total: vessels.length,
    live: liveIn.length,
    delayed: delayedIn.length,
    types,
    moving,
    movingPct: speedN ? Math.round((moving / speedN) * 100) : null,
    avgSpeedKts: speedN ? Math.round((speedSum / speedN) * 10) / 10 : null,
    hasMovement: speedN > 0,
    dark,
  };
}
