// src/cockpitApproach.js
/**
 * @module cockpitApproach
 * @description Priblíženie na cieľové letisko a METAR cieľa v kokpite
 * (2026-09-07, používateľ zvolil návrhy 7 a 9).
 *
 * Všetko je ODHAD z dát, ktoré už tečú (pravidlo 2 — poctivosť):
 *  - poloha/výška/klesanie stroja z feedu (OpenSky / adsb.lol),
 *  - cieľové letisko z adsbdb trasy (kód → airportLookup: poloha,
 *    nadmorská výška, dráhy z OurAirports),
 *  - vietor z METAR (aviationweather.gov, `/api/metar` proxy s cache),
 *  - aktívna dráha = najväčší protivietor (runwayWind.js), nie hlásenie
 *    riadenia; sklon = atan(výška nad letiskom / vzdialenosť), teda
 *    priamočiary geometrický odhad, nie ILS.
 *
 * Čisté funkcie bez DOM a bez Cesia; ui.js ich len volá a píše text.
 */
import { greatCircleKm } from './data/flightProgress.js';
import { activeRunwayFromWind, activeRunwayLabel } from './data/runwayWind.js';
import { METAR_STALE_MIN, flightCategory, metarHeadline } from './data/metarSummary.js';
import { formatHeightAgl } from './units.js';

/** Priblíženie sa ukazuje do tejto vzdialenosti od cieľa (km). */
export const APPROACH_RANGE_KM = 50;
/** Klesanie rýchlejšie než toto (m/s, záporné) = „na priblížení" aj vysoko. */
export const APPROACH_DESCENT_MPS = -0.5;
/** Pod touto výškou nad letiskom (m) je stroj na priblížení aj bez klesania. */
export const APPROACH_MAX_AGL_M = 4000;
/** Pod touto rýchlosťou (m/s) sa čas do letiska nepočíta. */
export const APPROACH_MIN_SPEED_MPS = 25;
const FT_TO_M = 0.3048;

/**
 * Stav priblíženia alebo null (ďaleko, na zemi, stúpa vysoko, chýbajú dáta).
 * @param {object} p
 * @param {number} p.latitude
 * @param {number} p.longitude
 * @param {number} p.altitudeM barometrická/MSL výška
 * @param {number|null} [p.verticalRateMps]
 * @param {number|null} [p.speedMps]
 * @param {boolean} [p.onGround]
 * @param {{lat: number, lon: number}|null} p.destination
 * @param {{elevFt?: number|null, rwy?: Array}|null} [p.airport]
 * @param {{dirDeg: number|null, speedKt: number|null, variable?: boolean}|null} [p.wind]
 * @returns {?{distanceKm: number, aglM: number, elevationKnown: boolean, glideDeg: number|null, etaMin: number|null, runway: object|null, runwaysKnown: boolean}}
 */
export function approachState({
  latitude, longitude, altitudeM, verticalRateMps = null, speedMps = null, onGround = false,
  destination, airport = null, wind = null,
} = {}) {
  if (onGround) return null;
  if (![latitude, longitude, altitudeM].every(Number.isFinite)) return null;
  if (!Number.isFinite(destination?.lat) || !Number.isFinite(destination?.lon)) return null;
  const distanceKm = greatCircleKm(latitude, longitude, destination.lat, destination.lon);
  if (!Number.isFinite(distanceKm) || distanceKm > APPROACH_RANGE_KM) return null;
  const elevationKnown = Number.isFinite(airport?.elevFt);
  const elevM = elevationKnown ? airport.elevFt * FT_TO_M : 0;
  const aglM = altitudeM - elevM;
  const descending = Number.isFinite(verticalRateMps) && verticalRateMps <= APPROACH_DESCENT_MPS;
  if (!descending && aglM > APPROACH_MAX_AGL_M) return null;
  const distanceM = distanceKm * 1000;
  const glideDeg = distanceM > 300 && aglM > 0 ? (Math.atan2(aglM, distanceM) * 180) / Math.PI : null;
  const etaMin = Number.isFinite(speedMps) && speedMps >= APPROACH_MIN_SPEED_MPS ? distanceM / speedMps / 60 : null;
  const runways = Array.isArray(airport?.rwy) ? airport.rwy : [];
  const runway = runways.length && wind ? activeRunwayFromWind(runways, wind) : null;
  return {
    distanceKm,
    aglM: Math.max(0, aglM),
    elevationKnown,
    glideDeg,
    etaMin,
    runway,
    runwaysKnown: runways.length > 0,
  };
}

/**
 * Tri riadky pre HUD. Pure.
 * @param {ReturnType<typeof approachState>} state
 * @param {(key: string, vars?: object) => string} translate
 * @returns {?{runway: string, distance: string, height: string}}
 */
export function approachLines(state, translate) {
  if (!state) return null;
  const t = typeof translate === 'function' ? translate : (k) => k;
  let runway;
  if (!state.runwaysKnown) runway = t('cockpit.approach-runway-none');
  else if (!state.runway) runway = t('cockpit.approach-runway-unknown');
  else runway = activeRunwayLabel(state.runway, t) || t('cockpit.approach-runway-unknown');
  const km = state.distanceKm < 10 ? state.distanceKm.toFixed(1) : String(Math.round(state.distanceKm));
  const distance = Number.isFinite(state.etaMin)
    ? t('cockpit.approach-distance', { km, min: Math.max(1, Math.round(state.etaMin)) })
    : t('cockpit.approach-distance-nomin', { km });
  // Výška v aktuálnych jednotkách (units.js): „2 775 ft" alebo „846 m".
  const h = formatHeightAgl(state.aglM);
  const deg = Number.isFinite(state.glideDeg) ? state.glideDeg.toFixed(1) : null;
  const height = state.elevationKnown
    ? (deg !== null ? t('cockpit.approach-height', { h, deg }) : t('cockpit.approach-height-nodeg', { h }))
    : t('cockpit.approach-height-msl', { h });
  return { runway, distance, height };
}

/**
 * Riadok METAR cieľa: `LZIB · VFR · Cloudy · 18 °C · wind 12 kt from SW · 25 min ago`.
 * Pure. `report` null = stav podľa `pending`.
 * @param {object|null} report surový záznam aviationweather (cache airportWeather.js)
 * @param {string|null} station
 * @param {number} nowMs
 * @param {(key: string, vars?: object) => string} translate
 * @param {{pending?: boolean}} [flags]
 * @returns {string}
 */
export function destinationWeatherLine(report, station, nowMs, translate, { pending = false } = {}) {
  const t = typeof translate === 'function' ? translate : (k) => k;
  if (!station) return '';
  if (!report) return `${station} · ${t(pending ? 'cockpit.route-metar-pending' : 'cockpit.route-metar-unavailable')}`;
  const parts = [station];
  const category = flightCategory(report);
  if (category) parts.push(category);
  const headline = metarHeadline(report, t);
  if (headline) parts.push(headline);
  const obs = Number(report.obsTime);
  if (Number.isFinite(obs) && Number.isFinite(nowMs)) {
    const ageMin = Math.max(0, Math.round((nowMs - obs * 1000) / 60_000));
    parts.push(t(ageMin > METAR_STALE_MIN ? 'cockpit.route-metar-stale' : 'cockpit.route-metar-age', { min: ageMin }));
  }
  return parts.join(' · ');
}

/**
 * Kód, ktorým sa cieľ hľadá v airportLookup: ICAO (ak ho proxy dodala),
 * inak `code` (adsbdb dáva IATA, index pozná oboje). Pure.
 * @param {{icao?: string|null, code?: string|null}|null} destination
 * @returns {string}
 */
export function destinationLookupCode(destination) {
  for (const candidate of [destination?.icao, destination?.code]) {
    const text = String(candidate ?? '').trim().toUpperCase();
    if (/^[A-Z0-9]{3,4}$/.test(text)) return text;
  }
  return '';
}
