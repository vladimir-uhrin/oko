// src/startFlightDetail.js — hrubšie dlaždice Google 3D počas úvodného preletu (2026-10-16, štart: kvóta).
//
// Meranie (build okolive.sk, počítač 1440×900, jedno načítanie na variant, scripts v scratchpade):
// medzi skrytím úvodnej obrazovky a pristátím preletu sa pri predvolenom detaile (maximumScreenSpaceError
// 16) stiahlo 499 dlaždíc / 13,1 MB a po pristátí 0 — cieľ sa prednačíta už počas letu
// (preloadFlightDestinations). So SSE 32 počas letu 230 / 7,3 MB a po pristátí 196 / 4,2 MB
// (doostrenie): spolu 554 → 464 požiadaviek (−16 %), 15,0 → 12,8 MB. Agresívnejšie culling pri pohybe
// (cullRequestsWhileMovingMultiplier 60 → 120) nezmenilo nič. Aby pristátie nebolo pol detailu, plný
// detail sa vracia už pred koncom letu (kamera nad cieľom spomaľuje — QUADRATIC_IN_OUT), najneskôr keď
// sa kamera zastaví (moveEnd) alebo po poistke od skrytia úvodnej obrazovky.
//
// Bez vedľajších účinkov mimo volania: tileset a kamera prichádzajú zvonka (testy bez Cesia).
import { START_FLY_DURATION_S, START_GLOBE_DWELL_MS } from './camera.js';

/** Detail počas letu (Cesium predvolene 16; dvojnásobok = o úroveň hrubšie dlaždice). */
export const START_FLIGHT_SSE = 32;
/** Koľko pred plánovaným koncom letu sa vráti plný detail (cieľové dlaždice stihnú prísť). */
export const START_FLIGHT_SHARPEN_BEFORE_MS = 1500;
/** Od začiatku pohybu kamery po návrat plného detailu. */
export const START_FLIGHT_RESTORE_AFTER_MS = START_FLY_DURATION_S * 1000 - START_FLIGHT_SHARPEN_BEFORE_MS;
/** Poistka od skrytia úvodnej obrazovky: pauza na zemeguli + let + rezerva. */
export const START_FLIGHT_CAP_MS = START_GLOBE_DWELL_MS + START_FLY_DURATION_S * 1000 + 3000;

const IDLE = Object.freeze({ restore() {}, done: Promise.resolve('none'), active: false });

/**
 * Po `whenReady` (skrytie úvodnej obrazovky) čaká na prvý pohyb kamery (začiatok preletu), zhrubí
 * dlaždice na `sse` a plný detail vráti po `restoreAfterMs`, pri zastavení kamery alebo po `capMs`
 * — čo príde prvé. Všetko sa odpojí, voľba je nevratná (raz a dosť).
 * @param {object} o
 * @param {{maximumScreenSpaceError: number}|null} o.tileset Cesium3DTileset (null = nič)
 * @param {{moveStart: {addEventListener: Function}, moveEnd: {addEventListener: Function}}} o.camera
 * @param {Promise<unknown>} [o.whenReady]
 * @returns {{restore: () => void, done: Promise<'none'|'sharpened'|'stopped'|'cap'|'restored'|'error'>, active: boolean}}
 */
export function coarsenTilesDuringStartFlight({
  tileset, camera, whenReady = Promise.resolve(),
  sse = START_FLIGHT_SSE, restoreAfterMs = START_FLIGHT_RESTORE_AFTER_MS, capMs = START_FLIGHT_CAP_MS,
  setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout,
} = {}) {
  if (!tileset || typeof camera?.moveStart?.addEventListener !== 'function' || typeof camera?.moveEnd?.addEventListener !== 'function') return IDLE;
  const original = tileset.maximumScreenSpaceError;
  let active = false; let finished = false;
  let capTimer = null; let restoreTimer = null; let offStart = null; let offEnd = null;
  let resolveDone = () => {};
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const finish = (how) => {
    if (finished) return;
    finished = true;
    if (capTimer !== null) clearTimer(capTimer);
    if (restoreTimer !== null) clearTimer(restoreTimer);
    offStart?.(); offEnd?.();
    offStart = null; offEnd = null;
    if (active) { tileset.maximumScreenSpaceError = original; active = false; }
    resolveDone(how);
  };
  const onMoveStart = () => {
    if (finished || active) return;
    active = true;
    tileset.maximumScreenSpaceError = sse;
    offStart?.(); offStart = null;
    offEnd = camera.moveEnd.addEventListener(() => finish('stopped'));
    restoreTimer = setTimer(() => finish('sharpened'), restoreAfterMs);
  };
  Promise.resolve(whenReady).then(() => {
    if (finished) return;
    offStart = camera.moveStart.addEventListener(onMoveStart);
    capTimer = setTimer(() => finish('cap'), capMs);
  }).catch(() => finish('error'));
  return { restore: () => finish('restored'), done, get active() { return active; } };
}
