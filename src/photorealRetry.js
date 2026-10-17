// src/photorealRetry.js — Google 3D po minútovom limite (2026-10-17, vlastník: „Google 3D: po 429 opakovať
// pokus, nie OSM na celú reláciu").
//
// PREČO: koreň Google 3D (root.json) cez kľúč, ktorý vydáva Cesium ion, občas vráti 429 RESOURCE_EXHAUSTED
// „3D Tiles root requests per minute" (zdieľaný projekt ion, zistené 2026-10-16). OKO potom bežalo celú
// návštevu na OSM, hoci o minútu by Google 3D prišiel.
//
// AKO: obmedzený počet pokusov — 3, po ~65 s, ~130 s a ~260 s s rozptylom ±15 % (návštevníci sa
// nezosynchronizujú), nikdy slučka. Každý pokus je jedno načítanie len tej cesty, ktorá padla na limit
// (photorealRetryPaths): EHP 403, zlý kľúč či token, sieť ani denný limit sa neopakujú. Po úspechu main.js
// tileset prijme a — ak od záložného štartu nikto podklad nezmenil — vráti Google 3D (shouldReturnToPhotoreal).
//
// Bez Cesia a DOM: časovač, náhoda aj načítanie sú injektované (testy).
import { photorealRetryPaths } from './photorealTileset.js';

/** Odstupy pokusov (ms) — prvý až po uplynutí minútového okna. */
export const PHOTOREAL_RETRY_DELAYS_MS = Object.freeze([65_000, 130_000, 260_000]);
/** Rozptyl odstupu (±15 %), aby sa návštevníci po spoločnom 429 neozvali naraz. */
export const PHOTOREAL_RETRY_JITTER = 0.15;
/** Podklad, na ktorý boot padne bez fotoreálu (main.js: `initialStack` 'osm'). */
export const PHOTOREAL_FALLBACK_STACK = 'osm';

/**
 * Odstup pokusu (pure). `attempt` od 0; za posledným pokusom null = koniec.
 * @param {number} attempt
 * @param {{ delays?: readonly number[], jitter?: number, random?: () => number }} [options]
 * @returns {number|null}
 */
export function photorealRetryDelayMs(attempt, { delays = PHOTOREAL_RETRY_DELAYS_MS, jitter = PHOTOREAL_RETRY_JITTER, random = Math.random } = {}) {
  if (!Number.isInteger(attempt) || attempt < 0 || attempt >= delays.length) return null;
  const r = Number(random());
  const unit = Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0.5;
  return Math.round(delays[attempt] * (1 + (unit * 2 - 1) * jitter));
}

/**
 * Čas pokusu na hodinách (HH:MM, miestny čas) pre tooltip čipu — relatívne „o 65 s" by v tooltipe zastaralo.
 * @param {number} nowMs
 * @param {number} delayMs
 * @returns {string}
 */
export function retryClockLabel(nowMs, delayMs) {
  const at = new Date(Number(nowMs) + Math.max(0, Number(delayMs) || 0));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/**
 * Vrátiť Google 3D, keď neskôr príde (pure)? Len keď beží záložný podklad a od záložného štartu nikto
 * podklad neprepol — klik na čip, mapa podľa vrstvy, scéna frontu aj obnova z odkazu posunú generáciu
 * prepnutia (MapStackController.getSwitchGeneration) a ich voľba má prednosť. Nedostupný pokus
 * (napr. odkaz s `map=photoreal`) generáciu neposúva, takže ten Google 3D dostane.
 * @param {{ activeId?: string|null, switchGeneration?: number, fallbackGeneration?: number, fallbackId?: string }} state
 * @returns {boolean}
 */
export function shouldReturnToPhotoreal({ activeId, switchGeneration, fallbackGeneration, fallbackId = PHOTOREAL_FALLBACK_STACK } = {}) {
  return activeId === fallbackId && Number.isFinite(switchGeneration) && switchGeneration === fallbackGeneration;
}

/**
 * Naplánuj obmedzené opakovanie načítania fotoreálu po minútovom limite Google.
 * @param {object} o
 * @param {unknown} o.failure chyba z createPhotorealTileset (googleError / ionError)
 * @param {(paths: {google: boolean, ion: boolean}, lastFailure: unknown) => Promise<{tileset: object, source: string}>} o.load
 *   jeden pokus — len cesty z `paths`
 * @param {(result: {tileset: object, source: string}, attempts: number) => void} o.onSuccess
 * @param {(info: {attempt: number, delayMs: number, paths: {google: boolean, ion: boolean}}) => void} [o.onWait]
 *   pred každým čakaním (stav pre UI)
 * @param {(error: unknown, attempts: number) => void} [o.onGiveUp] pokusy sa minuli alebo prišla iná chyba
 * @returns {{ cancel(): void, readonly attempts: number, readonly state: string }|null}
 *   null = chyba nie je minútový limit, neopakuje sa nič
 */
export function schedulePhotorealRetry({
  failure,
  load,
  onSuccess,
  onWait = null,
  onGiveUp = null,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  random = Math.random,
  delays = PHOTOREAL_RETRY_DELAYS_MS,
} = {}) {
  let paths = photorealRetryPaths(failure);
  if (!paths || typeof load !== 'function' || typeof onSuccess !== 'function') return null;
  let lastFailure = failure;
  let attempts = 0;
  let timer = null;
  /** 'waiting' | 'loading' | 'done' | 'gave-up' | 'cancelled' */
  let state = 'waiting';

  const giveUp = (error) => {
    state = 'gave-up';
    onGiveUp?.(error, attempts);
  };

  const waitNext = () => {
    const delayMs = photorealRetryDelayMs(attempts, { delays, random });
    if (delayMs == null) { giveUp(lastFailure); return; }
    state = 'waiting';
    timer = setTimer(run, delayMs);
    onWait?.({ attempt: attempts + 1, delayMs, paths: { ...paths } });
  };

  async function run() {
    timer = null;
    if (state !== 'waiting') return;
    state = 'loading';
    attempts += 1;
    let result;
    try {
      result = await load({ ...paths }, lastFailure);
    } catch (error) {
      if (state === 'cancelled') return;
      lastFailure = error;
      const again = photorealRetryPaths(error);
      if (!again) { giveUp(error); return; }
      paths = again;
      waitNext();
      return;
    }
    if (state === 'cancelled') {
      // Zrušené počas načítania — tileset nikto neprevezme, uvoľniť ho.
      try { result?.tileset?.destroy?.(); } catch { /* */ }
      return;
    }
    if (!result?.tileset) { giveUp(new Error('photoreal retry: load returned no tileset')); return; }
    state = 'done';
    onSuccess(result, attempts);
  }

  waitNext();
  return {
    cancel() {
      if (timer != null) clearTimer(timer);
      timer = null;
      if (state === 'waiting' || state === 'loading') state = 'cancelled';
    },
    get attempts() { return attempts; },
    get state() { return state; },
  };
}
