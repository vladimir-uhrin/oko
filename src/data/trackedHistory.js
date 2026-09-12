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
export async function requestTrackedHistory(icao24, { fetcher = globalThis.fetch, onDone = () => {}, nowMs = Date.now() } = {}) {
  const key = String(icao24 || '').trim().toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(key) || _disabled || typeof fetcher !== 'function') return false;
  const existing = _cache.get(key);
  if (existing && (existing.pending || nowMs - existing.at < existing.ttl)) return false;
  _cache.set(key, { fixes: existing?.fixes || [], at: nowMs, ttl: TRACKED_HISTORY_FAILURE_TTL_MS, pending: true });
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
