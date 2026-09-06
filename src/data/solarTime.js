// src/data/solarTime.js
/**
 * @module solarTime
 * @description Miestny čas, východ a západ slnka pre bod na Zemi (2026-09-05,
 * karta letiska). Čisté funkcie, žiadny DOM, žiadna sieť.
 *
 * POCTIVOSŤ (pravidlo 2): časové pásmo z polohy sa bez tabuľky hraníc pásiem
 * (~1 MB) zistiť nedá, takže miestny čas je ODHAD z poludníka — offset =
 * round(lon/15) hodín. Pre väčšinu letísk sedí; Čína (jedno pásmo cez 60°
 * dĺžky), Španielsko či India (pol hodiny) sa budú líšiť. Karta preto píše
 * `≈` a hovorí „miestny (odhad)". UTC čas je presný a je vedľa neho.
 *
 * Východ/západ počíta štandardný NOAA postup (deklinácia + rovnica času +
 * hodinový uhol pri −0,833°, čo zahŕňa refrakciu a polomer disku). Polárny
 * deň/noc sa hlási zvlášť — nie ako chýbajúci údaj.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const MS_PER_DAY = 86_400_000;
/** Stred slnka pri východe/západe: −0,833° (refrakcia + polomer disku). */
export const SUNRISE_ALTITUDE_DEG = -0.833;
/** Nad týmto uhlom je „deň" (rovnaký prah ako východ/západ). */
export const DAY_ALTITUDE_DEG = SUNRISE_ALTITUDE_DEG;

function julianCenturies(epochMs) {
  return (epochMs / MS_PER_DAY + 2440587.5 - 2451545.0) / 36525;
}

/**
 * Poloha Slnka: deklinácia a rovnica času (NOAA postup, presnosť ~1 min).
 *
 * Zjednodušená verzia (len prvé dva členy rovnice stredu) dávala v zime na
 * 48° severnej šírky východ o ~12 minút neskôr než skutočnosť — pri plytkom
 * uhle dopadu sa malá chyba deklinácie prepíše do veľkej chyby v čase.
 * Pure.
 * @param {number} epochMs
 * @returns {{declinationDeg: number, equationOfTimeMin: number}}
 */
export function solarPosition(epochMs) {
  const t = julianCenturies(epochMs);
  const meanLongDeg = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const meanAnomDeg = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const m = meanAnomDeg * RAD;
  const equationOfCentre = Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * m) * (0.019993 - 0.000101 * t)
    + Math.sin(3 * m) * 0.000289;
  const trueLongDeg = meanLongDeg + equationOfCentre;
  const omegaDeg = 125.04 - 1934.136 * t;
  const apparentLongDeg = trueLongDeg - 0.00569 - 0.00478 * Math.sin(omegaDeg * RAD);
  const meanObliquityDeg = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquityDeg = meanObliquityDeg + 0.00256 * Math.cos(omegaDeg * RAD);
  const declinationDeg = Math.asin(
    Math.sin(obliquityDeg * RAD) * Math.sin(apparentLongDeg * RAD),
  ) * DEG;
  const varY = Math.tan(obliquityDeg * RAD / 2) ** 2;
  const l0 = meanLongDeg * RAD;
  const equationOfTimeMin = 4 * DEG * (
    varY * Math.sin(2 * l0)
    - 2 * eccentricity * Math.sin(m)
    + 4 * eccentricity * varY * Math.sin(m) * Math.cos(2 * l0)
    - 0.5 * varY * varY * Math.sin(4 * l0)
    - 1.25 * eccentricity * eccentricity * Math.sin(2 * m)
  );
  return { declinationDeg, equationOfTimeMin };
}

/**
 * Výška Slnka nad obzorom (stupne). Pure.
 * @param {number} latDeg
 * @param {number} lonDeg
 * @param {number} epochMs
 * @returns {number|null} null pre nečíselný vstup
 */
export function solarElevationDeg(latDeg, lonDeg, epochMs) {
  if (![latDeg, lonDeg, epochMs].every(Number.isFinite)) return null;
  const { declinationDeg, equationOfTimeMin } = solarPosition(epochMs);
  const utcMinutes = ((epochMs % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY / 60_000;
  // Pravý slnečný čas → hodinový uhol (0 = poludnie).
  const trueSolarMin = utcMinutes + equationOfTimeMin + 4 * lonDeg;
  const hourAngle = (trueSolarMin / 4 - 180) * RAD;
  const lat = latDeg * RAD;
  const dec = declinationDeg * RAD;
  const sinAlt = Math.sin(lat) * Math.sin(dec)
    + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle);
  return Math.asin(Math.max(-1, Math.min(1, sinAlt))) * DEG;
}

/**
 * Odhadnutý posun miestneho času od UTC (hodiny) z poludníka. Pure.
 * @param {number} lonDeg
 * @returns {number|null}
 */
export function longitudeOffsetHours(lonDeg) {
  if (!Number.isFinite(lonDeg)) return null;
  return Math.round(lonDeg / 15);
}

/** `HH:MM` z epochy v danom posune (hodiny). Pure. */
export function formatClock(epochMs, offsetHours = 0) {
  if (!Number.isFinite(epochMs) || !Number.isFinite(offsetHours)) return '';
  const shifted = epochMs + offsetHours * 3_600_000;
  const minutes = Math.floor((((shifted % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY) / 60_000);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** `UTC+2`, `UTC−5`, `UTC` — znamienko mínus je typografické. Pure. */
export function formatOffset(offsetHours) {
  if (!Number.isFinite(offsetHours) || offsetHours === 0) return 'UTC';
  return `UTC${offsetHours > 0 ? '+' : '−'}${Math.abs(offsetHours)}`;
}

/**
 * Východ a západ Slnka v daný deň (epoch ms, UTC), alebo polárny stav. Pure.
 * @param {number} latDeg
 * @param {number} lonDeg
 * @param {number} epochMs ktorýkoľvek okamih dňa
 * @returns {{sunriseMs: number|null, sunsetMs: number|null, polar: 'day'|'night'|null}}
 */
export function sunTimes(latDeg, lonDeg, epochMs) {
  const none = { sunriseMs: null, sunsetMs: null, polar: null };
  if (![latDeg, lonDeg, epochMs].every(Number.isFinite)) return none;
  const midnightMs = Math.floor(epochMs / MS_PER_DAY) * MS_PER_DAY;
  const noonGuessMs = midnightMs + MS_PER_DAY / 2;
  const { declinationDeg, equationOfTimeMin } = solarPosition(noonGuessMs);
  const lat = latDeg * RAD;
  const dec = declinationDeg * RAD;
  const cosHourAngle = (Math.sin(SUNRISE_ALTITUDE_DEG * RAD) - Math.sin(lat) * Math.sin(dec))
    / (Math.cos(lat) * Math.cos(dec));
  if (!Number.isFinite(cosHourAngle) || cosHourAngle > 1) return { ...none, polar: 'night' };
  if (cosHourAngle < -1) return { ...none, polar: 'day' };
  const hourAngleDeg = Math.acos(cosHourAngle) * DEG;
  const sunriseMin = 720 - 4 * (lonDeg + hourAngleDeg) - equationOfTimeMin;
  const sunsetMin = 720 - 4 * (lonDeg - hourAngleDeg) - equationOfTimeMin;
  return {
    sunriseMs: midnightMs + sunriseMin * 60_000,
    sunsetMs: midnightMs + sunsetMin * 60_000,
    polar: null,
  };
}

/**
 * Zhrnutie pre kartu: odhadnutý miestny čas, UTC, východ/západ v miestnom
 * čase, deň/noc. Pure.
 * @param {number} latDeg
 * @param {number} lonDeg
 * @param {number} nowMs
 * @returns {?{localClock: string, utcClock: string, offsetHours: number, offsetLabel: string, sunriseClock: string, sunsetClock: string, isDay: boolean, polar: 'day'|'night'|null, elevationDeg: number}}
 */
export function localTimeSummary(latDeg, lonDeg, nowMs = Date.now()) {
  const offsetHours = longitudeOffsetHours(lonDeg);
  const elevationDeg = solarElevationDeg(latDeg, lonDeg, nowMs);
  if (offsetHours === null || elevationDeg === null) return null;
  const { sunriseMs, sunsetMs, polar } = sunTimes(latDeg, lonDeg, nowMs);
  return {
    localClock: formatClock(nowMs, offsetHours),
    utcClock: formatClock(nowMs, 0),
    offsetHours,
    offsetLabel: formatOffset(offsetHours),
    sunriseClock: sunriseMs === null ? '' : formatClock(sunriseMs, offsetHours),
    sunsetClock: sunsetMs === null ? '' : formatClock(sunsetMs, offsetHours),
    isDay: elevationDeg > DAY_ALTITUDE_DEG,
    polar,
    elevationDeg: Math.round(elevationDeg * 10) / 10,
  };
}
