import { gibsImageryDayOffset } from '../gibsTime.js';

/**
 * Zdieľaný „deň mozaiky" pre satelitné prekryvy NASA GIBS (2026-09-06, bod 5
 * z návrhu: „časový posuvník"). Jedno číslo — koľko dní dozadu od najnovšej
 * mozaiky — ktoré čítajú VŠETKY prekryvy naraz: hurikán deň po dni, sneh cez
 * zimu, tepelná vlna v mori. GIBS má tie isté vrstvy pre každý deň dozadu
 * (SST od 2002, zrážky od 2000), takže je to len iný dátum v URL dlaždice.
 *
 * 0 = najnovší deň (včera UTC — dnešná mozaika je ešte deravá, viď gibsTime.js);
 * n = n dní pred ním. Session-only, bez share-link kľúča (ako priezor).
 */

/** Strop posuvníka: dva mesiace dozadu stačia na „čo sa dialo", ďalej je to archív. */
export const GIBS_DAY_MAX_BACK = 60;

let _offset = 0;
/** @type {Set<function(number): void>} */
const _listeners = new Set();

/** @returns {number} 0..GIBS_DAY_MAX_BACK */
export function getGibsDayOffset() {
  return _offset;
}

/**
 * Normalizuj vstup z posuvníka: celé číslo 0..MAX; nečíslo = 0 (najnovší).
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeGibsDayOffset(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.min(GIBS_DAY_MAX_BACK, Math.max(0, n));
}

/**
 * Nastav posun; poslucháči sa volajú LEN pri zmene (posuvník strieľa
 * `input` pri každom pixeli — vrstvy nesmú prestavovať dlaždice nadarmo).
 * @param {unknown} value
 * @returns {boolean} zmenilo sa niečo?
 */
export function setGibsDayOffset(value) {
  const next = normalizeGibsDayOffset(value);
  if (next === _offset) return false;
  _offset = next;
  for (const fn of [..._listeners]) {
    try { fn(next); } catch (error) { console.warn('[gibsDay] listener', error); }
  }
  return true;
}

/**
 * @param {function(number): void} fn
 * @returns {() => void} odhlásenie
 */
export function onGibsDayChange(fn) {
  if (typeof fn !== 'function') return () => {};
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

/**
 * Deň mozaiky pre posun: 0 = včera, n = n dní pred včerajškom. Pure.
 * @param {number} offset
 * @param {number} [nowMs]
 * @returns {string} YYYY-MM-DD
 */
export function gibsDayForOffset(offset, nowMs = Date.now()) {
  return gibsImageryDayOffset(normalizeGibsDayOffset(offset) + 1, nowMs);
}

/** Test-only: späť na najnovší deň a bez poslucháčov. */
export function _resetGibsDayForTest() {
  _offset = 0;
  _listeners.clear();
}
