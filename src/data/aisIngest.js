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
 * wipe both after a msg 5 had supplied them. The same asymmetry applies to the
 * physicals — msg 19 brings Dimension but no callsign, msg 24 ReportB brings
 * CallSign+Dimension but no draught/ETA — so the fields alternate sources and
 * none may erase what another supplied.
 * @param {{name?:*, type?:*, destination?:*, imo?:*, callSign?:*, lengthM?:*, beamM?:*, draughtM?:*, eta?:*}} incoming Fields from this message.
 * @param {object|null} previous Cached static data.
 * @returns {{name:string|null, type:string|null, destination:string|null, imo:string|null,
 *   callSign:string|null, lengthM:number|null, beamM:number|null, draughtM:number|null, eta:string|null}}
 */
export function mergeAisStaticFields(incoming, previous) {
  return {
    name: trimmed(incoming?.name) ?? trimmed(previous?.name),
    type: trimmed(incoming?.type) ?? trimmed(previous?.type),
    destination: trimmed(incoming?.destination) ?? trimmed(previous?.destination),
    imo: trimmed(incoming?.imo) ?? trimmed(previous?.imo),
    callSign: trimmed(incoming?.callSign) ?? trimmed(previous?.callSign),
    lengthM: finite(incoming?.lengthM) ?? finite(previous?.lengthM),
    beamM: finite(incoming?.beamM) ?? finite(previous?.beamM),
    draughtM: finite(incoming?.draughtM) ?? finite(previous?.draughtM),
    eta: trimmed(incoming?.eta) ?? trimmed(previous?.eta),
  };
}

/**
 * Navigational status code 0..14, or null. 15 means "not defined" (the
 * transponder default) and must never render as a state; reserved codes
 * (9/10/13) pass through as numbers — the LABEL table decides they have no
 * display text, but the raw code stays available to analysts.
 * @param {*} value Raw NavigationalStatus from a Class A position report.
 * @returns {number|null}
 */
export function aisNavStatusCode(value) {
  const code = finite(value);
  if (code === null || !Number.isInteger(code)) return null;
  if (code < 0 || code > 14) return null;
  return code;
}

/**
 * Hull dimensions from the AIS Dimension block: A+B = length, C+D = beam
 * (distances from the GPS antenna to bow/stern/port/starboard). A zero pair
 * means "not available", not a zero-length vessel.
 * @param {{A?:*, B?:*, C?:*, D?:*}|null} dimension Raw Dimension block.
 * @returns {{lengthM:number|null, beamM:number|null}}
 */
export function aisDimensionsMeters(dimension) {
  const a = finite(dimension?.A);
  const b = finite(dimension?.B);
  const c = finite(dimension?.C);
  const d = finite(dimension?.D);
  const length = a !== null && b !== null && a >= 0 && b >= 0 ? a + b : null;
  const beam = c !== null && d !== null && c >= 0 && d >= 0 ? c + d : null;
  return {
    lengthM: length > 0 ? length : null,
    beamM: beam > 0 ? beam : null,
  };
}

/**
 * Maximum static draught in metres; 0 means "not available".
 * @param {*} value Raw MaximumStaticDraught.
 * @returns {number|null}
 */
export function aisDraughtMeters(value) {
  const draught = finite(value);
  return draught !== null && draught > 0 ? draught : null;
}

/**
 * ETA from the msg 5 Eta block as a compact "MM-DD HH:MM" label (UTC).
 * Month 0 / day 0 mean "not available"; hour 24 / minute 60 mean "date only".
 * No year field exists in AIS, so the label stays month-day.
 * @param {{Month?:*, Day?:*, Hour?:*, Minute?:*}|null} eta Raw Eta block.
 * @returns {string|null}
 */
export function aisEtaLabel(eta) {
  const month = finite(eta?.Month);
  const day = finite(eta?.Day);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const pad = (n) => String(n).padStart(2, '0');
  const hour = finite(eta?.Hour);
  const minute = finite(eta?.Minute);
  const hasTime = Number.isInteger(hour) && hour >= 0 && hour <= 23
    && Number.isInteger(minute) && minute >= 0 && minute <= 59;
  return hasTime
    ? `${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}`
    : `${pad(month)}-${pad(day)}`;
}

/**
 * Track-ring sample decision for one incoming fix versus the last stored one.
 * A NEGATIVE time delta used to silently drop samples until wall-clock caught
 * up (`epoch - last < minGap` is true for every regressed timestamp): common
 * on multiplexed feeds with out-of-order reports, after a receiver clock fix,
 * and when the report-time parser falls back to Date.now().
 *  - delta >= minGap        → 'append' (normálny postup stopy)
 *  - 0 <= delta < minGap    → 'skip'   (hustejšie než mriežka)
 *  - -minGap < delta < 0    → 'skip'   (jitter poradia — drž poradie ringu)
 *  - delta <= -minGap       → 'reset'  (hodiny skočili — poctivý reštart
 *                                       stopy namiesto večného čakania)
 * @param {number} epochSec Incoming fix epoch (s).
 * @param {number} lastEpochSec Last stored fix epoch (s).
 * @param {number} minGapSec Ring thinning gap (s).
 * @returns {'append'|'skip'|'reset'}
 */
export function aisTrackSampleDecision(epochSec, lastEpochSec, minGapSec) {
  const delta = epochSec - lastEpochSec;
  if (delta >= minGapSec) return 'append';
  if (delta <= -minGapSec) return 'reset';
  return 'skip';
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
