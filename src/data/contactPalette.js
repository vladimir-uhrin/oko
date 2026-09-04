// src/data/contactPalette.js
/**
 * @module contactPalette
 * @description Paleta ikon kontaktov podľa KONTRASTU podkladu.
 *
 * Biela silueta lietadla s vlasovým tmavým obrysom je na tmavom podklade
 * (Stadia Dark, satelit, fotoreál) dokonalá a na svetlom OSM neviditeľná —
 * pri 8 px na obrazovke je obrys 1 px a splynie s mapou (nález 2026-09-05).
 * Podklad sám vie, či je svetlý (`contactContrast` v descriptore
 * mapStackController), a tento modul to preloží na tint ikony.
 *
 * PREČO zapečený tint v SVG a NIE `billboard.color`: tint billboardu je
 * multiplikatívny a tmavomodrý tint by z červeného krídlového majáka spravil
 * čiernu bodku — presne pasca zo sledovaného stroja (aircraftIcons.js, tint
 * 'cyan'). Farba ide preto do textúry cez `aircraftIcon(kind, px, strobe,
 * tint)`, billboard ostáva biely (civil) alebo amber (vojenský) ako doteraz.
 *
 * Modul je čistý (žiadny Cesium, žiadny DOM); `bindContactPaletteToMapStack`
 * len počúva už existujúcu udalosť `gev:map-stack-changed`.
 */

/** @typedef {'light'|'dark'} BasemapContrast */

/**
 * Tint ikony pre rolu kontaktu a kontrast podkladu. `null` = bez tintu
 * (biela silueta, dnešný stav). Názvy sú kľúče `TINT_FILLS` v aircraftIcons.
 */
export const CONTACT_ICON_TINTS = Object.freeze({
  dark: Object.freeze({ civil: null, military: null }),
  light: Object.freeze({ civil: 'ink', military: 'ember' }),
});

/** Udalosť, ktorou main.js rozhlasuje zmenu podkladu (Task 5, height-datum). */
export const MAP_STACK_CHANGED_EVENT = 'gev:map-stack-changed';

/** @type {BasemapContrast} */
let _contrast = 'dark';
/** @type {Set<function(BasemapContrast): void>} */
const _listeners = new Set();

/**
 * Kontrast podkladu z jeho descriptora. Bez údaju = 'dark': biela silueta
 * je bezpečnejší default (satelit, fotoreál aj tmavé mapy ju čítajú).
 * @param {{contactContrast?: string}|null|undefined} stack
 * @returns {BasemapContrast}
 */
export function basemapContrastForStack(stack) {
  return stack?.contactContrast === 'light' ? 'light' : 'dark';
}

/** @returns {BasemapContrast} */
export function getBasemapContrast() {
  return _contrast;
}

/**
 * Nastav kontrast; poslucháči sa volajú LEN pri zmene (flotila sa
 * prerastruje, nech sa to nedeje pri každom „ready" tej istej mapy).
 * @param {BasemapContrast} next
 * @returns {boolean} Zmenilo sa niečo?
 */
export function setBasemapContrast(next) {
  const value = next === 'light' ? 'light' : 'dark';
  if (value === _contrast) return false;
  _contrast = value;
  for (const fn of [..._listeners]) {
    try { fn(value); } catch (error) { console.warn('[contactPalette] listener', error); }
  }
  return true;
}

/**
 * Tint ikony pre rolu pri aktuálnom kontraste.
 * @param {'civil'|'military'} role
 * @returns {string|null}
 */
export function contactIconTint(role) {
  const table = CONTACT_ICON_TINTS[_contrast] || CONTACT_ICON_TINTS.dark;
  return table[role === 'military' ? 'military' : 'civil'] ?? null;
}

/**
 * Prihlás sa na zmenu kontrastu.
 * @param {function(BasemapContrast): void} fn
 * @returns {function(): void} Odhlásenie.
 */
export function onContactPaletteChange(fn) {
  if (typeof fn !== 'function') return () => {};
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

/**
 * Napoj paletu na udalosť zmeny podkladu. Volá main.js raz po vzniku
 * controllera; vracia odpojenie.
 * @param {{addEventListener: Function, removeEventListener: Function}} target
 * @param {{contactContrast?: string}|null} [initialStack] Podklad pri štarte
 *   (prvý `setStack` je tichý a udalosť nevystrelí).
 * @returns {function(): void}
 */
export function bindContactPaletteToMapStack(target, initialStack = null) {
  if (initialStack) setBasemapContrast(basemapContrastForStack(initialStack));
  if (!target || typeof target.addEventListener !== 'function') return () => {};
  const handler = (event) => {
    setBasemapContrast(basemapContrastForStack(event?.detail?.activeStack));
  };
  target.addEventListener(MAP_STACK_CHANGED_EVENT, handler);
  return () => target.removeEventListener(MAP_STACK_CHANGED_EVENT, handler);
}

/** Test-only: späť na default a bez poslucháčov. */
export function _resetContactPaletteForTest() {
  _contrast = 'dark';
  _listeners.clear();
}
