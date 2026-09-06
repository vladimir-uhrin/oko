/**
 * Aktívny mapový podklad ako zdieľaný stav pre dátové vrstvy (2026-09-06).
 *
 * MapStackController nesmie poznať moduly vrstiev (vzor Task 5), takže main.js
 * rozhlasuje zmenu podkladu udalosťou `gev:map-stack-changed` a tento modul
 * ju — rovnako ako contactPalette.js — prekladá na obyčajný getter + poslucháčov.
 * Prvý `setStack` pri štarte je tichý, preto sa počiatočný stav seeduje priamo
 * z `getActiveStack()`.
 *
 * Kto to potrebuje: prekryvné vrstvy NASA GIBS (`viewer.imageryLayers`), ktoré
 * na Google 3D fotoreáli nemajú čo kresliť — glóbus je skrytý. Riadok panelu to
 * musí povedať (pravidlo 2), nie potichu nič neukázať.
 */
import { MAP_STACK_CHANGED_EVENT } from './contactPalette.js';

/** @type {object|null} descriptor podkladu (MAP_STACKS položka) */
let _stack = null;
/** @type {Set<function(object|null): void>} */
const _listeners = new Set();

/** @returns {object|null} */
export function getActiveMapStack() {
  return _stack;
}

/**
 * Je skrytý glóbus? Fotoreál kreslí Google 3D Tiles a `globe.show = false`,
 * takže imagery vrstvy nemajú povrch. Bez údaju (pred prvým setStack) sa
 * predpokladá glóbus — vrstva sa má kresliť, kým sa nedokáže opak.
 * @param {object|null} [stack]
 * @returns {boolean}
 */
export function isGlobeHiddenForStack(stack = _stack) {
  return stack?.kind === 'photoreal';
}

/**
 * Nastav podklad; poslucháči sa volajú LEN pri zmene identity stacku
 * (`switching`/`ready` tej istej mapy nič nemení).
 * @param {object|null} next
 * @returns {boolean} zmenilo sa niečo?
 */
export function setActiveMapStack(next) {
  const value = next && typeof next === 'object' ? next : null;
  if ((value?.id ?? null) === (_stack?.id ?? null)) return false;
  _stack = value;
  for (const fn of [..._listeners]) {
    try { fn(value); } catch (error) { console.warn('[activeMapStack] listener', error); }
  }
  return true;
}

/**
 * @param {function(object|null): void} fn
 * @returns {() => void} odhlásenie
 */
export function onActiveMapStackChange(fn) {
  if (typeof fn !== 'function') return () => {};
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

/**
 * Napoj sa na udalosť main.js; `initialStack` = seed z tichého prvého setStack.
 * @param {EventTarget|null} target spravidla `window`
 * @param {object|null} [initialStack]
 * @returns {() => void} odpojenie
 */
export function bindActiveMapStackToEvents(target, initialStack = null) {
  if (initialStack) setActiveMapStack(initialStack);
  if (!target || typeof target.addEventListener !== 'function') return () => {};
  const handler = (event) => { setActiveMapStack(event?.detail?.activeStack ?? null); };
  target.addEventListener(MAP_STACK_CHANGED_EVENT, handler);
  return () => target.removeEventListener(MAP_STACK_CHANGED_EVENT, handler);
}

/** Test-only: späť na default a bez poslucháčov. */
export function _resetActiveMapStackForTest() {
  _stack = null;
  _listeners.clear();
}
