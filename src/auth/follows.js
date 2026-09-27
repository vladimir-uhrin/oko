// src/auth/follows.js
/**
 * Sledované lety (2026-09-27, vlastník: „pridaj možnosť aj sledovanie letov, ale len pre
 * prihlásených … pre neprihlásených ich presmeruj na prihlásenie"). Spoločná validácia pre
 * server (src/auth/server/http.js) aj prehliadač (src/followedFlights.js) — server ju vždy
 * zopakuje, klientovi sa neverí.
 *
 * ČO SA SLEDUJE: pravidelný let dopravcu (volací znak „AUA40H" — každý deň iný stroj) má kľúč
 * `cs:<volací znak>`; všetko ostatné (súkromné, bez volacieho znaku, registrácia ako znak) sa
 * sleduje ako stroj `hex:<ICAO24>`. Ukladá sa len kľúč, hex, znak a krátky popis letu — nič
 * o používateľovi ani jeho polohe.
 */

/** Najviac sledovaných letov na účet. */
export const FOLLOW_MAX = 50;
/** Dĺžka popisu (napr. „AUA40H · BCN → VIE"). */
export const FOLLOW_LABEL_MAX = 80;

const HEX_RE = /^[0-9a-f]{6}$/;
const CALLSIGN_RE = /^[A-Z0-9]{2,8}$/;
/** Volací znak dopravcu: ICAO kód (3 písmená) + číslo letu. */
const AIRLINE_CALLSIGN_RE = /^[A-Z]{3}\d[A-Z0-9]{0,4}$/;

/** @param {unknown} value @returns {string|null} */
export function normalizeHex(value) {
  const hex = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return HEX_RE.test(hex) ? hex : null;
}

/** @param {unknown} value @returns {string|null} */
export function normalizeCallsign(value) {
  const cs = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return CALLSIGN_RE.test(cs) ? cs : null;
}

/**
 * Kľúč sledovania: let dopravcu podľa volacieho znaku, inak stroj podľa hexu.
 * @param {{hex?: unknown, callsign?: unknown}} flight
 * @returns {string|null}
 */
export function followKey({ hex, callsign } = {}) {
  const cs = normalizeCallsign(callsign);
  if (cs && AIRLINE_CALLSIGN_RE.test(cs)) return `cs:${cs}`;
  const h = normalizeHex(hex);
  return h ? `hex:${h}` : null;
}

/** @param {unknown} key @returns {boolean} */
export function validFollowKey(key) {
  if (typeof key !== 'string') return false;
  if (key.startsWith('cs:')) return AIRLINE_CALLSIGN_RE.test(key.slice(3));
  if (key.startsWith('hex:')) return HEX_RE.test(key.slice(4));
  return false;
}

/** Popis bez riadiacich znakov, orezaný (zobrazuje sa cez textContent, aj tak ho čistíme). */
export function cleanFollowLabel(value) {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  return [...text].slice(0, FOLLOW_LABEL_MAX).join('');
}

/**
 * Z požiadavky na sledovanie spraví čistý záznam, alebo null.
 * @param {{hex?: unknown, callsign?: unknown, label?: unknown}} input
 * @returns {{key: string, hex: string|null, callsign: string|null, label: string}|null}
 */
export function sanitizeFollow(input) {
  if (!input || typeof input !== 'object') return null;
  const key = followKey(input);
  if (!key) return null;
  const hex = normalizeHex(input.hex);
  const callsign = normalizeCallsign(input.callsign);
  const label = cleanFollowLabel(input.label) || callsign || hex || '';
  return { key, hex, callsign, label };
}

/**
 * Patrí živý kontakt k sledovanému záznamu? Let dopravcu podľa volacieho znaku, stroj podľa hexu.
 * @param {{key: string}} entry
 * @param {{hex?: unknown, callsign?: unknown}} contact
 */
export function followMatches(entry, contact) {
  if (!entry || !contact) return false;
  if (entry.key.startsWith('cs:')) return normalizeCallsign(contact.callsign) === entry.key.slice(3);
  return normalizeHex(contact.hex) === entry.key.slice(4);
}
