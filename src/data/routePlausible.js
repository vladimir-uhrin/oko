// src/data/routePlausible.js
/**
 * Is an adsbdb scheduled route consistent with where the plane actually is and
 * what it is doing? adsbdb returns the scheduled route for a callsign, which
 * is sometimes the wrong leg — reject a route rather than display a wrong one.
 * Adapted from skylight (MIT) web/src/display/renderer.ts routePlausible(),
 * with the vertical-trend check made observer-free (skylight anchors it to a
 * fixed ground station; GEV has no observer, so the check is anchored to the
 * PLANE: climbing hard + low → its origin should be nearby; descending hard +
 * low → its destination should be nearby).
 */

const D2R = Math.PI / 180;
const R_KM = 6371;

/** Haversine great-circle distance in km. */
export function greatCircleKm(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D2R;
  const p2 = lat2 * D2R;
  const dp = (lat2 - lat1) * D2R;
  const dl = (lon2 - lon1) * D2R;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingRad(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D2R;
  const p2 = lat2 * D2R;
  const dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return Math.atan2(y, x);
}

/** Signed cross-track distance (km) of point from the great circle p1→p2. */
export function crossTrackKm(lat, lon, lat1, lon1, lat2, lon2) {
  const d13 = greatCircleKm(lat1, lon1, lat, lon) / R_KM;
  const b13 = bearingRad(lat1, lon1, lat, lon);
  const b12 = bearingRad(lat1, lon1, lat2, lon2);
  return Math.asin(Math.sin(d13) * Math.sin(b13 - b12)) * R_KM;
}

const NEAR_ENDPOINT_KM = 130;
/**
 * Geometry (2026-10-01): the path origin → plane → destination may be at most 25 % longer than
 * the direct route. The former test (≤ 200 km from the great circle) hid real long-haul detours —
 * SQ324 Singapore → Amsterdam over Slovakia (airspace closures), card without route and ETA — and
 * accepted planes already PAST the destination on the extended circle. Measured: real routes incl.
 * detours 1.00–1.04 (SQ324 1.010, FZ1073 Dubai → Tel Aviv over Saudi Arabia 1.022), wrong routes
 * ≥ 1.48 (LHR → JFK for a plane over Slovakia).
 */
export const DETOUR_MAX = 1.25;
const LOW_ALT_M = 3700;        // ~12 000 ft
const VERT_TREND_MPS = 2;      // ~400 fpm
const LOCAL_AIRPORT_KM = 150;
/** Heading is judged only far from the airports (vectoring, holding and SIDs near them). */
const HEADING_FAR_KM = 300;
/**
 * Far from the airports the destination must lie ahead: within ±60° of the track (airways,
 * weather and airspace detours stay well inside — SQ324 over Slovakia 6°; a wrong leg flown
 * west over Germany would have Copenhagen 79° off its track).
 */
export const DESTINATION_AHEAD_DEG = 60;

const RAD_TO_DEG = 180 / Math.PI;
const finitePt = (pt) => Number.isFinite(pt?.lat) && Number.isFinite(pt?.lon);
/** Smallest absolute difference of two bearings, 0–180°. Pure. */
export function angleDiffDeg(a, b) {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

/**
 * @param {object} p
 * @param {number} p.latDeg / p.lonDeg — plane's current position
 * @param {number|null} [p.altitudeM]
 * @param {number|null} [p.verticalRateMps] — positive = climbing
 * @param {number|null} [p.trackDeg] — track over ground, degrees (2026-10-01)
 * @param {boolean} [p.onGround]
 * @param {{lat:number|null, lon:number|null}|null} [p.origin]
 * @param {{lat:number|null, lon:number|null}|null} [p.destination]
 * @returns {boolean} false ONLY when the route is confidently wrong.
 */
export function routePlausible({ latDeg, lonDeg, altitudeM = null, verticalRateMps = null, trackDeg = null, onGround = false, origin = null, destination = null }) {
  const haveO = finitePt(origin);
  const haveD = finitePt(destination);
  if (!haveO && !haveD) return true; // no coordinates — cannot judge, do not hide
  const distO = haveO ? greatCircleKm(latDeg, lonDeg, origin.lat, origin.lon) : Infinity;
  const distD = haveD ? greatCircleKm(latDeg, lonDeg, destination.lat, destination.lon) : Infinity;

  // (a) Geographic consistency: near an endpoint, or the detour via the plane is small.
  if (distO >= NEAR_ENDPOINT_KM && distD >= NEAR_ENDPOINT_KM && haveO && haveD) {
    const direct = greatCircleKm(origin.lat, origin.lon, destination.lat, destination.lon);
    if (direct > 0 && (distO + distD) / direct > DETOUR_MAX) return false;
  }

  // (b) Vertical-trend consistency for low traffic (observer-free adaptation).
  if (
    Number.isFinite(altitudeM) && altitudeM < LOW_ALT_M &&
    Number.isFinite(verticalRateMps) && Math.abs(verticalRateMps) > VERT_TREND_MPS
  ) {
    if (verticalRateMps > 0) {
      if (distO > LOCAL_AIRPORT_KM && haveO) return false; // departing — origin should be local
    } else if (distD > LOCAL_AIRPORT_KM && haveD) {
      return false; // arriving — destination should be local
    }
  }

  // (c) Heading (2026-10-01): far from both airports the destination must lie ahead. Live: SunExpress
  // XQ3RB has Copenhagen → Antalya in adsbdb, but flew west over Germany (track 290°) — neither
  // airport ahead, the callsign flew a different leg. Shown as is, the card claimed a wrong route
  // and ETA; reversing it by the heading would be a guess (it was not going to Copenhagen either).
  if (haveD && !onGround && Number.isFinite(trackDeg) && distD >= HEADING_FAR_KM && distO >= HEADING_FAR_KM) {
    const toDestination = bearingRad(latDeg, lonDeg, destination.lat, destination.lon) * RAD_TO_DEG;
    if (angleDiffDeg(trackDeg, toDestination) > DESTINATION_AHEAD_DEG) return false;
  }
  return true;
}
