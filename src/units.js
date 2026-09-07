// src/units.js
/**
 * @module units
 * @description Jednotky výšky a rýchlosti pre VŠETKY zobrazenia (2026-09-07,
 * používateľ: „sprav prepínač všade, kde sa zobrazuje výška a rýchlosť").
 *
 * Dva systémy:
 *  - `aviation` (predvolené): stopy, letové hladiny nad FL180, knoty, ft/min —
 *    konvencia letectva aj FR24;
 *  - `metric`: metre, km/h, m/s.
 *
 * Vnútorne beží všetko v metroch a m/s; tento modul je JEDINÉ miesto, kde sa
 * číslo premieňa na text s jednotkou. Voľba je per zariadenie (localStorage,
 * ako jazyk), ale prepína sa ŽIVO: `setUnitSystem` vyšle `gev:units-changed`
 * a spotrebitelia (kokpit, karta sledovaného stroja, detekčné štítky pri
 * ďalšej obnove) sa preformátujú bez reloadu.
 *
 * Tisícky sa oddeľujú tenkou nezalomiteľnou medzerou (U+202F), rovnako ako
 * inde na karte — nie anglickou čiarkou (kokpit predtým ukazoval „34,975").
 *
 * V Node (testy) nie je localStorage ani window → vždy `aviation`, kým test
 * nezavolá `setUnitSystem(..., { persist: false })`.
 */

export const UNITS_STORAGE_KEY = 'oko-units';
export const UNIT_SYSTEMS = Object.freeze(['aviation', 'metric']);
export const UNITS_CHANGED_EVENT = 'gev:units-changed';
/** Nad touto výškou (ft) sa v leteckom systéme hlási letová hladina. */
export const FLIGHT_LEVEL_MIN_FT = 18_000;
/** Tenká nezalomiteľná medzera ako oddeľovač tisícov (4 843 km). */
export const THIN_NBSP = ' ';

const M_TO_FT = 3.28084;
const MPS_TO_KTS = 1.94384;
const MPS_TO_KMH = 3.6;
const MPS_TO_FPM = 196.850394;
const KN_TO_KMH = 1.852;

/** @type {?string} */
let _system = null;

function readStored() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(UNITS_STORAGE_KEY);
    return UNIT_SYSTEMS.includes(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Aktuálny systém jednotiek. */
export function getUnitSystem() {
  if (!_system) _system = readStored() || 'aviation';
  return _system;
}

export function isMetric() {
  return getUnitSystem() === 'metric';
}

/**
 * Nastav systém (persist + živá udalosť). Neplatná hodnota sa ignoruje.
 * @param {string} system
 * @param {{persist?: boolean, target?: EventTarget|null}} [options]
 * @returns {string} výsledný systém
 */
export function setUnitSystem(system, { persist = true, target = globalThis.window ?? null } = {}) {
  if (!UNIT_SYSTEMS.includes(system)) return getUnitSystem();
  const previous = getUnitSystem();
  _system = system;
  if (persist) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(UNITS_STORAGE_KEY, system);
    } catch { /* súkromný režim — voľba prežije len sedenie */ }
  }
  if (previous !== system && target?.dispatchEvent && typeof CustomEvent === 'function') {
    target.dispatchEvent(new CustomEvent(UNITS_CHANGED_EVENT, { detail: { system, previous } }));
  }
  return system;
}

/** Prepni medzi systémami; vráti nový. */
export function toggleUnitSystem(options) {
  return setUnitSystem(isMetric() ? 'aviation' : 'metric', options);
}

/**
 * Počúvaj zmenu jednotiek. Vracia odhlásenie. Bez `window` (Node) no-op.
 * @param {(system: string) => void} handler
 * @param {EventTarget|null} [target]
 */
export function onUnitSystemChange(handler, target = globalThis.window ?? null) {
  if (!target?.addEventListener || typeof handler !== 'function') return () => {};
  const listener = (event) => handler(event?.detail?.system ?? getUnitSystem());
  target.addEventListener(UNITS_CHANGED_EVENT, listener);
  return () => target.removeEventListener(UNITS_CHANGED_EVENT, listener);
}

/** Celé číslo s oddelenými tisíckami (U+202F). Pure. */
export function formatThousands(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return '';
  return String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, THIN_NBSP).replace(/^/, n < 0 ? '−' : '');
}

/** Krátky popis jednotky výšky pre prístroje: 'FT' | 'M'. */
export function altitudeUnitLabel(system = getUnitSystem()) {
  return system === 'metric' ? 'M' : 'FT';
}

/** Krátky popis jednotky rýchlosti pre prístroje: 'KTS' | 'KM/H'. */
export function speedUnitLabel(system = getUnitSystem()) {
  return system === 'metric' ? 'KM/H' : 'KTS';
}

/** Hodnota výšky v zobrazovacej jednotke (ft alebo m), zaokrúhlená; null bez údaja. */
export function altitudeDisplayValue(altitudeM, system = getUnitSystem()) {
  const m = Number(altitudeM);
  if (!Number.isFinite(m)) return null;
  return Math.round(system === 'metric' ? m : m * M_TO_FT);
}

/** Hodnota rýchlosti v zobrazovacej jednotke (kts alebo km/h), zaokrúhlená; null bez údaja. */
export function speedDisplayValue(speedMps, system = getUnitSystem()) {
  const v = Number(speedMps);
  if (!Number.isFinite(v)) return null;
  return Math.round(system === 'metric' ? v * MPS_TO_KMH : v * MPS_TO_KTS);
}

/**
 * Výška s jednotkou. Letecky: nad FL180 letová hladina (`FL340`), inak
 * `12 500 ft`; metricky `10 360 m`. `level:false` vypne hladiny (`34 000 ft`).
 * @param {number} altitudeM
 * @param {{level?: boolean, system?: string}} [options]
 */
export function formatAltitude(altitudeM, { level = true, system = getUnitSystem() } = {}) {
  const value = altitudeDisplayValue(altitudeM, system);
  if (value === null) return '';
  if (system === 'metric') return `${formatThousands(value)} m`;
  if (level && value >= FLIGHT_LEVEL_MIN_FT) return `FL${Math.round(value / 100)}`;
  return `${formatThousands(value)} ft`;
}

/** Rýchlosť s jednotkou: `499 kts` | `925 km/h`; '' bez údaja. */
export function formatSpeed(speedMps, { system = getUnitSystem() } = {}) {
  const value = speedDisplayValue(speedMps, system);
  if (value === null) return '';
  return `${formatThousands(value)} ${system === 'metric' ? 'km/h' : 'kts'}`;
}

/**
 * Rozsah rýchlostí s jednou jednotkou na konci: `250 → 480 kts`.
 * @param {number} fromMps
 * @param {number} toMps
 */
export function formatSpeedRange(fromMps, toMps, { system = getUnitSystem() } = {}) {
  const a = speedDisplayValue(fromMps, system);
  const b = speedDisplayValue(toMps, system);
  if (a === null || b === null) return '';
  return `${formatThousands(a)} → ${formatThousands(b)} ${system === 'metric' ? 'km/h' : 'kts'}`;
}

/**
 * Vertikálna rýchlosť bez znamienka: letecky `980 ft/min` (na 10),
 * metricky `5,0 m/s`. Volajúci pridá šípku.
 * @param {number} verticalRateMps
 */
export function formatVerticalRateMagnitude(verticalRateMps, { system = getUnitSystem() } = {}) {
  const v = Math.abs(Number(verticalRateMps));
  if (!Number.isFinite(v)) return '';
  if (system === 'metric') return `${v.toFixed(1).replace('.', ',')} m/s`;
  return `${formatThousands(Math.round(v * MPS_TO_FPM / 10) * 10)} ft/min`;
}

/** Výška nad terénom/letiskom (nikdy nie hladina): `2 775 ft` | `846 m`. */
export function formatHeightAgl(heightM, options = {}) {
  return formatAltitude(heightM, { ...options, level: false });
}

/**
 * Rýchlosť lode zadaná v uzloch: letecky/námorne `14 kn`, metricky `26 km/h`.
 * '' pre nulu alebo neznámu (kotviace lode bez šumu).
 * @param {number} knots
 */
export function formatVesselSpeedKnots(knots, { system = getUnitSystem() } = {}) {
  const kn = Number(knots);
  if (!Number.isFinite(kn) || kn <= 0) return '';
  return system === 'metric' ? `${Math.round(kn * KN_TO_KMH)} km/h` : `${Math.round(kn)} kn`;
}

/** Iba pre testy: zahoď cache voľby. */
export function _resetUnitsForTest() {
  _system = null;
}
