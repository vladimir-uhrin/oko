/**
 * @module flightProgress
 * @description FR24-štýl obohatenie karty letu (OKO) — čistá matematika
 * a formátovanie bez Cesium/DOM závislostí, aby sa všetko dalo unit-testovať
 * izolovane (flightProgress.test.mjs, vrátane chybových ciest).
 *
 * Dátový kontrakt: VŠETKO tu je odvodené z polí, ktoré už tečú — adsbdb
 * route (letiská s mestami a súradnicami, cez routePlausible bránu vo
 * flights.js), OpenSky/adsb.lol state vektor (rýchlosť, vertikálna
 * rýchlosť, squawk na indexe 14). Žiadne nové API, žiadne odhady vydávané
 * za dáta: keď vstup chýba, funkcia vráti null/'' a riadok karty sa
 * jednoducho nevykreslí (CLAUDE.md pravidlo 2 — živé vs. odhadované).
 *
 * Štýl: monochromatické glyfy z existujúcej rodiny (▰▱ ↑ ↓ → ·) — žiadne
 * emoji (pokyn používateľa; rovnaká direktíva ako ikony vrstiev).
 */

/** Polomer Zeme pre haversine (stredný, km). */
const EARTH_RADIUS_KM = 6371.0088;
/** Vertikálna rýchlosť, od ktorej sa hlási stúpanie/klesanie (~500 ft/min). */
export const VERTICAL_TREND_THRESHOLD_MPS = 2.5;
/** Počet segmentov textového progress baru. */
export const PROGRESS_BAR_SEGMENTS = 8;
/** Pod touto rýchlosťou (≈50 kt) je ETA veštenie — nezobrazuje sa. */
export const ETA_MIN_SPEED_MPS = 25;
/** Trasa kratšia než toto je degenerovaná (rovnaké letisko) — bez progresu. */
const MIN_ROUTE_KM = 5;
/** Tvrdý strop dĺžky mesta v riadku trasy (vrátane výpustky). */
const ROUTE_NAME_MAX_CHARS = 14;

const RAD = Math.PI / 180;

/**
 * Ortodromická vzdialenosť (haversine) v km. Antimeridián aj póly rieši
 * trigonometria sama — žiadne špeciálne vetvy.
 * @param {number} lat1 @param {number} lon1
 * @param {number} lat2 @param {number} lon2
 * @returns {number|null} km, alebo null pri nevalidnom vstupe.
 */
export function greatCircleKm(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Priebeh letu po ortodrome odlet → cieľ.
 *
 * Frakcia = nalietané/total s clampom na [0,1]; poloha PRED odletovým
 * letiskom (zostatok > total) sa hlási ako 0. ETA len z reálnej letovej
 * rýchlosti (≥ ETA_MIN_SPEED_MPS) — rolujúcemu/pomalému stroju sa ETA
 * neveští. Akýkoľvek chýbajúci vstup → null, nikdy výnimka.
 * @param {object} input
 * @param {{lat: number, lon: number}} input.origin
 * @param {{lat: number, lon: number}} input.destination
 * @param {number} input.lat - Aktuálna poloha lietadla.
 * @param {number} input.lon
 * @param {number} [input.speedMps] - Ground speed v m/s.
 * @returns {?{fractionDone: number, remainingKm: number, totalKm: number, etaMinutes: number|null}}
 */
export function routeProgress(input) {
  // Explicitné `null` obíde default parameter — destructure až po garde.
  const { origin, destination, lat, lon, speedMps } = input || {};
  const totalKm = greatCircleKm(origin?.lat, origin?.lon, destination?.lat, destination?.lon);
  const flownKm = greatCircleKm(origin?.lat, origin?.lon, lat, lon);
  const remainingKm = greatCircleKm(lat, lon, destination?.lat, destination?.lon);
  if (totalKm === null || flownKm === null || remainingKm === null) return null;
  if (totalKm < MIN_ROUTE_KM) return null;
  const fractionDone = remainingKm > totalKm
    ? 0
    : Math.max(0, Math.min(1, flownKm / totalKm));
  const speed = Number(speedMps);
  const etaMinutes = Number.isFinite(speed) && speed >= ETA_MIN_SPEED_MPS
    ? (remainingKm * 1000) / speed / 60
    : null;
  return { fractionDone, remainingKm, totalKm, etaMinutes };
}

/**
 * ETA ako `H:MM` (zaokrúhlené na minúty, s prenosom cez hodinu).
 * @param {number} etaMinutes
 * @returns {string} napr. '1:24'; '' pre nevalidný/záporný vstup.
 */
export function formatEta(etaMinutes) {
  // Number(null) je 0 — typová garda musí prísť pred koerciou.
  if (typeof etaMinutes !== 'number' || !Number.isFinite(etaMinutes) || etaMinutes < 0) return '';
  const total = Math.round(etaMinutes);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Textový progress bar pre kartu: `▰▰▰▰▰▱▱▱ 60% · ETA 0:30`.
 * Glyfy ▰▱ sú z existujúcej ikonovej rodiny — karta ostáva monochromatický
 * mono-text, žiadne DOM/emoji prvky.
 * @param {?{fractionDone: number, etaMinutes: number|null}} progress
 * @returns {string} riadok, alebo '' keď progres nie je vypočítateľný.
 */
export function progressLine(progress) {
  const fraction = Number(progress?.fractionDone);
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) return '';
  const filled = Math.round(fraction * PROGRESS_BAR_SEGMENTS);
  const bar = '▰'.repeat(filled) + '▱'.repeat(PROGRESS_BAR_SEGMENTS - filled);
  const percent = `${Math.round(fraction * 100)}%`;
  const eta = formatEta(progress?.etaMinutes);
  return eta ? `${bar} ${percent} · ETA ${eta}` : `${bar} ${percent}`;
}

/** Tvrdé skrátenie mesta na ROUTE_NAME_MAX_CHARS vrátane výpustky. */
function truncateName(name) {
  const text = String(name || '').trim();
  if (text.length <= ROUTE_NAME_MAX_CHARS) return text;
  return `${text.slice(0, ROUTE_NAME_MAX_CHARS - 1).trimEnd()}…`;
}

/**
 * Riadok trasy s mestami: `VIE Vienna → OTP Bucharest`. Chýbajúce mesto
 * degraduje na samotný kód; keď nie je čo zobraziť na žiadnej strane, vráti ''.
 * @param {?{origin: {code?: string, name?: string}, destination: {code?: string, name?: string}}} route
 * @returns {string}
 */
export function formatRouteLine(route) {
  const side = (airport) => [String(airport?.code || '').trim(), truncateName(airport?.name)]
    .filter(Boolean).join(' ');
  const from = side(route?.origin);
  const to = side(route?.destination);
  if (!from && !to) return '';
  return `${from} → ${to}`;
}

/**
 * Glyf trendu vertikálnej rýchlosti: '↑' stúpa, '↓' klesá, '' v hladine
 * alebo pri nečitateľnom vstupe.
 * @param {number} verticalRateMps - Kladná = stúpanie (OpenSky konvencia).
 * @returns {string}
 */
export function verticalTrendGlyph(verticalRateMps) {
  const rate = Number(verticalRateMps);
  if (!Number.isFinite(rate)) return '';
  if (rate >= VERTICAL_TREND_THRESHOLD_MPS) return '↑';
  if (rate <= -VERTICAL_TREND_THRESHOLD_MPS) return '↓';
  return '';
}

/**
 * Normalizuje transpondérový squawk na 4-miestny OKTALOVÝ reťazec
 * ('0000'–'7777'); čísla sa dopĺňajú nulami zľava. Smetie → null.
 * @param {*} raw
 * @returns {?string}
 */
export function parseSquawk(raw) {
  if (raw === null || raw === undefined) return null;
  let text;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0 || !Number.isInteger(raw)) return null;
    text = String(raw).padStart(4, '0');
  } else if (typeof raw === 'string') {
    text = raw.trim();
  } else {
    return null;
  }
  return /^[0-7]{4}$/.test(text) ? text : null;
}

/** Núdzové transpondérové kódy → label pre kartu. */
const SQUAWK_ALERTS = Object.freeze({
  7500: 'HIJACK',
  7600: 'RADIO FAILURE',
  7700: 'EMERGENCY',
});

/**
 * Núdzový squawk → {code, label}, inak null. Prijíma čokoľvek — vstup ide
 * najprv cez parseSquawk.
 * @param {*} raw
 * @returns {?{code: string, label: string}}
 */
export function squawkAlert(raw) {
  const code = parseSquawk(raw);
  if (!code || !Object.hasOwn(SQUAWK_ALERTS, code)) return null;
  return { code, label: SQUAWK_ALERTS[code] };
}
