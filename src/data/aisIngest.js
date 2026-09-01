/**
 * @module aisIngest
 * @description Pure AIS sanitization and sticky-merge helpers for the
 * server-side AISStream ingest (`/api/ais-live`). Kept out of vite.config.js
 * for the same reason as adsbLolFallback.js: the decode rules are product
 * logic and deserve tests, the proxy is plumbing.
 *
 * ITU-R M.1371 encodes "not available" as in-range NUMBERS, not nulls, so a
 * plain `Number.isFinite` check accepts every one of them. That is exactly how
 * a stationary vessel ended up reported at 102.3 knots and how positionless
 * contacts landed at latitude 91.
 */

/** SOG sentinel: raw 1023 (0.1 kn units) = speed not available. */
export const AIS_SOG_UNAVAILABLE_KN = 102.3;
/** COG sentinel: raw 3600 (0.1° units) = course not available. */
export const AIS_COG_UNAVAILABLE_DEG = 360;
/** True heading sentinel: 511 = heading not available. */
export const AIS_HEADING_UNAVAILABLE = 511;

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function trimmed(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

/**
 * Speed over ground in knots, or null when unavailable.
 * 102.2 is deliberately KEPT — the standard defines it as "102.2 knots or
 * higher", a real (if saturated) measurement. Only 102.3 means "no data".
 * @param {*} value Raw Sog from the feed.
 * @returns {number|null}
 */
export function aisSpeedKnots(value) {
  const speed = finite(value);
  if (speed === null) return null;
  if (speed < 0) return null;
  if (speed >= AIS_SOG_UNAVAILABLE_KN) return null;
  return speed;
}

/**
 * Course over ground in degrees [0, 360), or null when unavailable.
 * @param {*} value Raw Cog from the feed.
 * @returns {number|null}
 */
export function aisCourseDeg(value) {
  const course = finite(value);
  if (course === null) return null;
  if (course < 0 || course >= AIS_COG_UNAVAILABLE_DEG) return null;
  return course;
}

/**
 * True heading in degrees [0, 359], or null when unavailable. Note the range
 * differs from course: a heading of exactly 360 is not a legal AIS value.
 * @param {*} value Raw TrueHeading from the feed.
 * @returns {number|null}
 */
export function aisHeadingDeg(value) {
  const heading = finite(value);
  if (heading === null) return null;
  if (heading < 0 || heading > 359) return null;
  return heading;
}

/**
 * Whether a decoded lat/lon pair is a real fix. AIS sends latitude 91 /
 * longitude 181 for "position not available", and both are finite numbers, so
 * the range check — not a finiteness check — is what rejects them.
 * @param {*} lat Latitude in degrees.
 * @param {*} lon Longitude in degrees.
 * @returns {boolean}
 */
export function aisPositionUsable(lat, lon) {
  const latitude = finite(lat);
  const longitude = finite(lon);
  if (latitude === null || longitude === null) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  return true;
}

/**
 * Merge kinematics from one AIS message over the last known values.
 *
 * Static messages (ShipStaticData msg 5, StaticDataReport msg 24) carry no
 * Sog/Cog/TrueHeading at all, yet AISStream attaches lat/lon metadata to every
 * envelope — so without this merge a static report overwrote a moving vessel's
 * row and blanked its speed and course. Sentinels are treated the same as
 * absent: hold last-known-good rather than publish "no data" as a number.
 * Zero is a measurement (a vessel at anchor) and always wins.
 * @param {{sog?:*, cog?:*, trueHeading?:*}} incoming Raw fields from this message.
 * @param {{speed?:number|null, course?:number|null, heading?:number|null}|null} previous Last stored row.
 * @returns {{speed:number|null, course:number|null, heading:number|null}}
 */
export function mergeAisKinematics(incoming, previous) {
  const speed = aisSpeedKnots(incoming?.sog);
  const course = aisCourseDeg(incoming?.cog);
  const heading = aisHeadingDeg(incoming?.trueHeading);
  return {
    speed: speed ?? finite(previous?.speed),
    course: course ?? finite(previous?.course),
    heading: heading ?? finite(previous?.heading),
  };
}

/**
 * Merge static identity fields over the cached ones. Every field is sticky:
 * msg 24 carries no Destination and no IMO, so a Class B static report used to
 * wipe both after a msg 5 had supplied them.
 * @param {{name?:*, type?:*, destination?:*, imo?:*}} incoming Fields from this message.
 * @param {{name?:*, type?:*, destination?:*, imo?:*}|null} previous Cached static data.
 * @returns {{name:string|null, type:string|null, destination:string|null, imo:string|null}}
 */
export function mergeAisStaticFields(incoming, previous) {
  return {
    name: trimmed(incoming?.name) ?? trimmed(previous?.name),
    type: trimmed(incoming?.type) ?? trimmed(previous?.type),
    destination: trimmed(incoming?.destination) ?? trimmed(previous?.destination),
    imo: trimmed(incoming?.imo) ?? trimmed(previous?.imo),
  };
}

/**
 * Whether the retention sweep is due. The sweep walks the whole vessel cache
 * (up to 50 000 rows) and used to run on EVERY accepted positional message —
 * with the worldwide bounding box that is tens to hundreds of full-cache scans
 * per second, synchronously inside the websocket message handler.
 *
 * A clock that jumps backwards must not wedge the sweep shut, so any
 * non-positive elapsed time also prunes.
 * @param {number} lastPruneAt Epoch ms of the previous sweep (0 = never).
 * @param {number} now Epoch ms now.
 * @param {number} intervalMs Minimum gap between sweeps.
 * @returns {boolean}
 */
export function shouldPruneAisCache(lastPruneAt, now, intervalMs) {
  if (!lastPruneAt) return true;
  const elapsed = now - lastPruneAt;
  if (!(elapsed > 0)) return true;
  return elapsed >= intervalMs;
}
