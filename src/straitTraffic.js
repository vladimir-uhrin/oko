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

/**
 * Counts of AIS-tracked vessels inside a strait rectangle.
 * @param {{live?: Array<object>, delayed?: Array<object>}} sources
 * @param {ReadonlyArray<number>} rect
 * @param {{dedupe?: boolean}} [opts] dedupe delayed against live by MMSI (default true)
 * @returns {{total: number, live: number, delayed: number}}
 */
export function buildStraitTrafficModel({ live = [], delayed = [] } = {}, rect, { dedupe = true } = {}) {
  const liveIn = (Array.isArray(live) ? live : []).filter((p) => isInRect(lonOf(p), latOf(p), rect));
  const liveIds = new Set(liveIn.map(idOf));
  const delayedIn = (Array.isArray(delayed) ? delayed : [])
    .filter((p) => isInRect(lonOf(p), latOf(p), rect))
    .filter((p) => !(dedupe && liveIds.has(idOf(p))));
  const live_ = liveIn.length;
  const delayed_ = delayedIn.length;
  return { total: live_ + delayed_, live: live_, delayed: delayed_ };
}
