/**
 * @module airportsData
 * @description Pure helpers for the bundled global airports dataset
 * (OurAirports, public domain — provenance in src/data/local_data/airports/).
 * The build script (scripts/build-airports.mjs) uses the filter + feature
 * mapper to produce the geojsonl snapshot; the localGeojson layer uses the
 * card copy + importance. One contract, tested once, consumed twice.
 */

export const AIRPORTS_LAYER_ID = 'local-airports';

function cleanText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Bundle filter: large + medium airports always, small only with scheduled
 * service — 86k rows shrink to ~6k that matter on a globe. `closed` is
 * excluded EXPLICITLY: the live CSV uses the value "closed" (the data
 * dictionary's "closed_airport" is out of sync — guard both), and 8 closed
 * airports still carry scheduled_service=yes, so the flag alone is no guard.
 * Heliports, seaplane bases and balloonports are out of scope.
 * @param {object} row Parsed airports.csv row.
 * @returns {boolean}
 */
export function airportRowAccepted(row) {
  const type = cleanText(row?.type);
  if (!type || type === 'closed' || type === 'closed_airport') return false;
  if (type === 'large_airport' || type === 'medium_airport') return true;
  return type === 'small_airport' && cleanText(row?.scheduled_service) === 'yes';
}

/**
 * One airports.csv row → one bundled GeoJSON feature (or null when the row
 * has no usable identity/position). `ident` is the only always-present key
 * (812 filtered rows lack IATA, 667 ICAO, 201 elevation) — every other field
 * degrades to null and the UI tolerates the blanks.
 * @param {object} row Parsed airports.csv row.
 * @returns {object|null}
 */
export function airportFeatureFromRow(row) {
  const ident = cleanText(row?.ident);
  const lat = finite(row?.latitude_deg);
  const lon = finite(row?.longitude_deg);
  if (!ident || lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const elevFt = finite(row?.elevation_ft);
  return {
    id: ident,
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
      name: cleanText(row?.name) || ident,
      icao: cleanText(row?.icao_code),
      iata: cleanText(row?.iata_code),
      // 'large_airport' → 'large' — the bundle spells the tier once.
      type: cleanText(row?.type)?.replace('_airport', '') ?? null,
      municipality: cleanText(row?.municipality),
      country: cleanText(row?.iso_country),
      elevFt: elevFt === null ? null : Math.round(elevFt),
      scheduled: cleanText(row?.scheduled_service) === 'yes',
    },
  };
}

/**
 * Card detail lines for an airport feature: codes + tier, then locality +
 * field elevation (feet — the aviation convention the flight card already
 * uses). Every part is optional; empty lines are not emitted.
 * @param {object} props Bundled feature properties.
 * @returns {string[]}
 */
export function airportOverlayCopy(props) {
  const details = [];
  const codesLine = [
    cleanText(props?.iata),
    cleanText(props?.icao),
    cleanText(props?.type)?.toUpperCase(),
  ].filter(Boolean).join(' · ');
  if (codesLine) details.push(codesLine);
  const locality = [cleanText(props?.municipality), cleanText(props?.country)]
    .filter(Boolean).join(', ');
  const elevFt = finite(props?.elevFt);
  const placeLine = [locality, elevFt === null ? null : `ELEV ${Math.round(elevFt)} FT`]
    .filter(Boolean).join(' · ');
  if (placeLine) details.push(placeLine);
  return details;
}

/**
 * Label-cohort importance: hubs first. Feeds the shared local-layer label
 * priority so a zoomed-out view names Bratislava and Vienna, not airstrips.
 * @param {object} props Bundled feature properties.
 * @returns {number}
 */
export function airportImportance(props) {
  const type = cleanText(props?.type);
  if (type === 'large') return 300;
  if (type === 'medium') return 150;
  if (type === 'small') return 60;
  return 0;
}
