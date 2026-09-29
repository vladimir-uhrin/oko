// src/startupGate.js
// Brána štartu (2026-09-29, bod 8 „živé vrstvy až po zobrazení mapy"): čo má
// počkať, kým je mapa zobrazená a štartová kamera na mieste (preloader skrytý,
// zdieľaný pohľad obnovený). main.js ju zapne na začiatku a uvoľní pri skrytí
// preloadera; poistka ju uvoľní sama. Bez zapnutia (testy, account.html, vrstva
// zapnutá neskôr) je otvorená — správanie sa mení len počas štartu.
//
// Prečo: lode (aisLiveVessels.js) pri štarte pýtali dáta, kým kamera ešte
// stála vo vesmíre (predvolených 20 000 km) — požiadavka bez výrezu = všetkých
// ~27 000 lodí, 17,9 MB JSON (3 MB brotli), spracovanie 1,7–2,2 s na hlavnom
// vlákne, a po nálete kamery druhá rovnaká. Obnova vrstiev na ne čakala, takže
// aj preloader (verejná stránka: 11,6 s s loďami, 8,6 s bez nich).

/** @constant {number} Poistka: brána sa otvorí sama, ak ju štart neuvoľní. */
export const STARTUP_GATE_TIMEOUT_MS = 20000;

let armed = false;
let released = false;
let pending = null;
let resolvePending = null;
let timer = null;

/**
 * Zapne bránu (volá main.js na začiatku štartu). Opakované volanie nič nemení.
 * @param {{timeoutMs?: number, setTimer?: (fn: () => void, ms: number) => unknown}} [options]
 */
export function armStartupGate({ timeoutMs = STARTUP_GATE_TIMEOUT_MS, setTimer = globalThis.setTimeout } = {}) {
  if (armed || released) return;
  armed = true;
  pending = new Promise((resolve) => { resolvePending = resolve; });
  if (Number.isFinite(timeoutMs) && timeoutMs > 0 && typeof setTimer === 'function') {
    timer = setTimer(() => releaseStartupGate(), timeoutMs);
  }
}

/** Uvoľní bránu (preloader skrytý). Opakované volanie nič nemení. */
export function releaseStartupGate() {
  if (released) return;
  released = true;
  if (timer != null && typeof globalThis.clearTimeout === 'function') globalThis.clearTimeout(timer);
  timer = null;
  const resolve = resolvePending;
  resolvePending = null;
  resolve?.();
}

/** @returns {boolean} true = štart skončil alebo brána nebola zapnutá. */
export function isStartupReady() {
  return !armed || released;
}

/** @returns {Promise<void>} Splní sa, keď je štart hotový (hneď, ak brána nie je zapnutá). */
export function whenStartupReady() {
  return isStartupReady() ? Promise.resolve() : pending;
}

/** Len pre testy: vráti bránu do pôvodného (otvoreného, nezapnutého) stavu. */
export function _resetStartupGateForTest() {
  if (timer != null && typeof globalThis.clearTimeout === 'function') globalThis.clearTimeout(timer);
  armed = false;
  released = false;
  pending = null;
  resolvePending = null;
  timer = null;
}
