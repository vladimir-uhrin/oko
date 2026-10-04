// src/data/gdeltGate.js
/**
 * @module gdeltGate
 * @description Spoločná brána pre dopyty na GDELT DOC 2.0 v jednom serverovom procese
 * (2026-10-03). GDELT prosí o najviac 1 dopyt za 5 s z jednej IP a inak vráti 429
 * („Please limit requests to one every 5 seconds…" — niekedy aj s HTTP 200). Situačné
 * správy (deväť regiónov Blízkeho východu, Záliv, Ukrajina) a regionálny brífing kokpitu
 * sa pýtali nezávisle, takže sa zrážali: v logu služby oko-api 23 úspechov na 165 zlyhaní
 * (128 × 429, 37 × „fetch failed"). Brána dáva dopytom poradie s odstupom 5,5 s, po 429
 * stíchne na minútu a dopyt, ktorý by čakal dlhšie než strop, radšej preskočí — volajúci
 * má záložný zdroj (Google News RSS), čakanie by len predĺžilo odpoveď.
 */

export const GDELT_MIN_GAP_MS = 5_500;
export const GDELT_BACKOFF_MS = 60_000;
/** Opakované 429 pauzu zdvojnásobia až po tento strop; prvý úspech ju vráti na minútu. */
export const GDELT_BACKOFF_MAX_MS = 15 * 60_000;
export const GDELT_MAX_WAIT_MS = 12_000;

/** Odpoveď GDELT, ktorá hovorí „pomalšie" (HTTP 429 alebo text o limite pri HTTP 200). Pure. */
export function isGdeltRateLimit(error) {
  return error?.upstreamStatus === 429 || /limit requests|\b429\b/i.test(String(error?.message || ''));
}

/**
 * @param {{now?: () => number, sleep?: (ms:number) => Promise<void>, minGapMs?: number, backoffMs?: number, maxWaitMs?: number}} [o]
 */
export function createGdeltGate({
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  minGapMs = GDELT_MIN_GAP_MS,
  backoffMs = GDELT_BACKOFF_MS,
  backoffMaxMs = GDELT_BACKOFF_MAX_MS,
  maxWaitMs = GDELT_MAX_WAIT_MS,
} = {}) {
  let nextAt = 0; // najskorší štart ďalšieho dopytu (rezervuje sa synchrónne → bez pretekov)
  let pausedUntil = 0; // po 429 nikto nepýta až do tohto času
  let streak = 0; // 429 za sebou bez úspechu → dlhšia pauza (GDELT trestá aj osamotené dopyty)
  const stats = { ran: 0, skippedBusy: 0, skippedBackoff: 0, rateLimited: 0 };

  /**
   * Spustí `task` v najbližšom voľnom okne. Preskočený dopyt vráti `{ skipped }` (nehádže),
   * výsledok úlohy `{ value }`; chyba úlohy sa prehodí ďalej (429 navyše zapne pauzu).
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<{value: T}|{skipped: 'busy'|'backoff'}>}
   */
  async function run(task) {
    const t = now();
    if (t < pausedUntil) { stats.skippedBackoff += 1; return { skipped: 'backoff' }; }
    const startAt = Math.max(t, nextAt);
    if (startAt - t > maxWaitMs) { stats.skippedBusy += 1; return { skipped: 'busy' }; }
    nextAt = startAt + minGapMs;
    if (startAt > t) await sleep(startAt - t);
    if (now() < pausedUntil) { stats.skippedBackoff += 1; return { skipped: 'backoff' }; }
    stats.ran += 1;
    try {
      const value = await task();
      streak = 0;
      return { value };
    } catch (error) {
      if (isGdeltRateLimit(error)) {
        stats.rateLimited += 1;
        const pause = Math.min(backoffMaxMs, backoffMs * 2 ** streak);
        streak += 1;
        pausedUntil = Math.max(pausedUntil, now() + pause);
      }
      throw error;
    }
  }

  return {
    run,
    /** Stav pre /status a testy. */
    state: () => ({ nextAt, pausedUntil, streak, ...stats }),
  };
}

let shared = null;
/** Jedna brána na proces — zdieľajú ju všetky serverové moduly, ktoré pýtajú GDELT. */
export function sharedGdeltGate() {
  if (!shared) shared = createGdeltGate();
  return shared;
}
