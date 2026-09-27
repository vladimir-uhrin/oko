// src/data/trackedHistory.js
/**
 * @module trackedHistory
 * @description História sledovaného letu pre grafy karty (2026-09-12): fixy
 * z lokálnej histórie letov (/api/history/track, 24 h surové), cache s TTL,
 * jeden dopyt naraz, `onDone` LEN po skutočnom fetchi — rovnaký vzor ako
 * ACARS správy (acarsMessages.js), aby sa karta po doručení prebudovala raz a
 * netočila sa. Keď proxy históriu nemá (503 history_disabled/unavailable),
 * ďalšie dopyty sa nerobia. Injektovateľný fetcher — testovateľné v Node.
 */
import { fetchFlightTrack } from './flightHistory.js';
import { currentLegFixes } from './flightCharts.js';

/** Čerstvé fixy sa nepýtajú znova skôr než po minúte (poll beží každých pár sekúnd). */
export const TRACKED_HISTORY_TTL_MS = 60_000;
/** Po chybe počkať 5 min, nech sa proxy nezahltí. */
export const TRACKED_HISTORY_FAILURE_TTL_MS = 5 * 60_000;
/** Okno histórie (s): dnešný let nikdy nezačal skôr než pred 24 h. */
export const TRACKED_HISTORY_WINDOW_S = 24 * 3600;

const _cache = new Map();
let _disabled = false;

/** Fixy z cache (prázdne pole, keď nič nemáme). */
export function cachedTrackedHistory(icao24) {
  const entry = _cache.get(String(icao24 || '').trim().toLowerCase());
  return entry?.fixes || [];
}

/** Stav pre UI/testy: či je história na proxy vypnutá. */
export function trackedHistoryDisabled() {
  return _disabled;
}

/**
 * Vyžiada históriu sledovaného stroja. Vráti true, keď prebehol skutočný fetch.
 * @param {string} icao24
 * @param {{fetcher?: Function, onDone?: Function, nowMs?: number}} [options]
 */
export function requestTrackedHistory(icao24, { fetcher = globalThis.fetch, onDone = () => {}, nowMs = Date.now() } = {}) {
  const key = String(icao24 || '').trim().toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(key) || _disabled || typeof fetcher !== 'function') return Promise.resolve(false);
  const existing = _cache.get(key);
  if (existing && (existing.pending || nowMs - existing.at < existing.ttl)) return Promise.resolve(false);
  // Rozpracovaný dopyt nesie svoj promise — trasa (loadTrackedHistory) naň počká namiesto druhého dopytu.
  const entry = { fixes: existing?.fixes || [], at: nowMs, ttl: TRACKED_HISTORY_FAILURE_TTL_MS, pending: true, promise: null };
  _cache.set(key, entry);
  entry.promise = (async () => {
    try {
      const nowS = Math.floor(nowMs / 1000);
      const fixes = await fetchFlightTrack(key, { fromS: nowS - TRACKED_HISTORY_WINDOW_S, toS: nowS + 60, fetcher });
      _cache.set(key, { fixes: Array.isArray(fixes) ? fixes : [], at: nowMs, ttl: TRACKED_HISTORY_TTL_MS, pending: false });
      try { onDone(); } catch { /* prebudovanie karty je best effort */ }
      return true;
    } catch (error) {
      // 503 = história na proxy nebeží — nepýtať sa dookola.
      if (/HTTP 503/.test(String(error?.message || ''))) _disabled = true;
      _cache.set(key, { fixes: existing?.fixes || [], at: nowMs, ttl: TRACKED_HISTORY_FAILURE_TTL_MS, pending: false });
      return false;
    }
  })();
  return entry.promise;
}

/**
 * História stroja „teraz" — počká na rozpracovaný dopyt alebo spustí nový (TTL platí).
 * @returns {Promise<Array<object>>} fixy (prázdne, keď nič nemáme)
 */
export async function loadTrackedHistory(icao24, options = {}) {
  const key = String(icao24 || '').trim().toLowerCase();
  const pending = _cache.get(key);
  if (pending?.pending && pending.promise) await pending.promise;
  else await requestTrackedHistory(key, options);
  return cachedTrackedHistory(key);
}

/** Najviac bodov trasy z archívu (trail drží TRAIL_MAX_POINTS = 400 aj so živými fixmi). */
export const TRAIL_HISTORY_MAX_POINTS = 300;

/**
 * Body staršej časti trasy z lokálneho archívu (2026-09-27, vlastník: „vykresľovanie trasy
 * lietadla sa niekedy objaví a niekedy nie"): OpenSky /tracks vracia 404 po pristátí a
 * pri limite nič — archív má posledných 24 h bez kvóty. Len AKTUÁLNY úsek letu (medzera
 * > 30 min = iný let), len body staršie než prvý živý fix, rovnomerne preriedené so
 * zachovaným začiatkom a koncom. Tvar ako OpenSky waypointy: baro výška v m, na zemi null. Pure.
 * @param {Array<{t:number, lat:number, lon:number, alt:number|null, gnd?:boolean}>} fixes
 * @param {{nowS: number, beforeS?: number, max?: number}} options
 * @returns {Array<{lat:number, lon:number, baroAlt:number|null}>}
 */
export function trailWaypointsFromHistory(fixes, { nowS, beforeS = Infinity, max = TRAIL_HISTORY_MAX_POINTS } = {}) {
  const leg = currentLegFixes(fixes, nowS)
    .filter((f) => f.t < beforeS && Number.isFinite(f.lat) && Number.isFinite(f.lon));
  const pick = (f) => ({ lat: f.lat, lon: f.lon, baroAlt: f.gnd ? null : (Number.isFinite(f.alt) ? f.alt : null) });
  if (leg.length <= max) return leg.map(pick);
  const out = [];
  const step = (leg.length - 1) / (max - 1);
  for (let i = 0; i < max; i += 1) out.push(pick(leg[Math.round(i * step)]));
  return out;
}

/** Zabudni históriu stroja (koniec sledovania). */
export function forgetTrackedHistory(icao24) {
  _cache.delete(String(icao24 || '').trim().toLowerCase());
}

/** Iba pre testy. */
export function _resetTrackedHistoryForTest() {
  _cache.clear();
  _disabled = false;
}
