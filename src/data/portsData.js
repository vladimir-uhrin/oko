/**
 * @module portsData
 * @description Pure helpers for the bundled global ports dataset (World Port
 * Index, US NGA Pub 150 — public domain; provenance in
 * src/data/local_data/ports/). The build script uses the filter + feature
 * mapper, the localGeojson layer uses the card copy + importance — one
 * contract, tested once, consumed twice. Mirror of airportsData.js.
 *
 * WPI trap from the research pass: every depth/dimension column encodes
 * "no data" as 0.0, never as an empty cell — a raw read reports ports with
 * a zero-metre draft. All numeric fields here treat <= 0 as null.
 */

export const PORTS_LAYER_ID = 'local-ports';

function cleanText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveDepth(value) {
  const depth = finite(value);
  return depth !== null && depth > 0 ? depth : null;
}

/**
 * Bundle filter: a port needs a name and an in-range position — nothing
 * else. All 3.8k WPI rows ship (harbor size drives LABEL importance, not
 * existence: a Very Small pier is still a mapped fact on the globe).
 * @param {object} row Parsed UpdatedPub150.csv row (original headers).
 * @returns {boolean}
 */
export function portRowAccepted(row) {
  if (!cleanText(row?.['Main Port Name'])) return false;
  const lat = finite(row?.Latitude);
  const lon = finite(row?.Longitude);
  if (lat === null || lon === null) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  return true;
}

/**
 * One WPI row → one bundled GeoJSON feature. The WPI number is the stable
 * id ('31140.0' → 'wpi-31140'); rows without one fall back to a
 * name+coords id so re-builds stay deterministic.
 * @param {object} row Parsed UpdatedPub150.csv row.
 * @returns {object|null}
 */
export function portFeatureFromRow(row) {
  if (!portRowAccepted(row)) return null;
  const lat = finite(row.Latitude);
  const lon = finite(row.Longitude);
  const name = cleanText(row['Main Port Name']);
  const wpiNumber = finite(row['World Port Index Number']);
  // UN/LOCODE prichádza s medzerou ('NL RTM') — normalizuje sa na 'NLRTM',
  // formát, v ktorom kód používa zvyšok sveta.
  const locode = cleanText(row['UN/LOCODE'])?.replace(/\s+/g, '') || null;
  return {
    id: wpiNumber === null
      ? `port-${name}-${lat}-${lon}`
      : `wpi-${Math.round(wpiNumber)}`,
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
      name,
      locode,
      country: cleanText(row['Country Code']),
      size: cleanText(row['Harbor Size']),
      harborType: cleanText(row['Harbor Type']),
      chanDepthM: positiveDepth(row['Channel Depth (m)']),
      maxDraftM: positiveDepth(row['Maximum Vessel Draft (m)']),
    },
  };
}

function formatMeters(value) {
  const depth = positiveDepth(value);
  if (depth === null) return null;
  const rounded = Math.round(depth * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Card detail lines: LOCODE + size + harbor type, then depths + country.
 * Every part optional, empty lines are not emitted.
 * @param {object} props Bundled feature properties.
 * @returns {string[]}
 */
export function portOverlayCopy(props) {
  const details = [];
  const identityLine = [
    cleanText(props?.locode),
    cleanText(props?.size)?.toUpperCase(),
    cleanText(props?.harborType)?.toUpperCase(),
  ].filter(Boolean).join(' · ');
  if (identityLine) details.push(identityLine);
  const chan = formatMeters(props?.chanDepthM);
  const draft = formatMeters(props?.maxDraftM);
  const capacityLine = [
    chan === null ? null : `CH ${chan}M`,
    draft === null ? null : `DRAFT ${draft}M`,
    cleanText(props?.country),
  ].filter(Boolean).join(' · ');
  if (capacityLine) details.push(capacityLine);
  return details;
}

/**
 * Label-cohort importance: Rotterdam before a fishing pier.
 * @param {object} props Bundled feature properties.
 * @returns {number}
 */
export function portImportance(props) {
  const size = cleanText(props?.size);
  if (size === 'Large') return 300;
  if (size === 'Medium') return 150;
  if (size === 'Small') return 60;
  if (size === 'Very Small') return 20;
  return 0;
}
