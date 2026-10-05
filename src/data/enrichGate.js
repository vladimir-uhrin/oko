// src/data/enrichGate.js — brána doťahovania údajov o lietadle z adsbdb (typ, trasa) (2026-09-30).
//
// Predtým si vrstva kľúč (napr. `r:AUA555`) zapamätala pri PRVOM dopyte navždy — aj keď dopyt
// zlyhal (HTTP 500 z proxy, výpadok siete). Stroj potom do obnovenia stránky nemal typ, trasu ani
// ETA. Brána rozlišuje výsledky:
//   - odpoveď prišla (aj „nenájdené") → hotovo, znova sa nepýta,
//   - dopyt zlyhal → po `retryMs × pokus` sa smie skúsiť znova, najviac `maxAttempts`-krát.
// Čistý modul s vloženými hodinami — testovateľný bez prehliadača.

export const ENRICH_RETRY_MS = 60_000;
// 6 pokusov (2026-10-05): po 1, 2, 3, 4, 5 min = ~15 min. adsbdb pri preťažení blokuje na 5 min a
// server vtedy odpovie 503 — 3 pokusy (6 min) sa minuli skôr, než blokovanie skončilo.
export const ENRICH_MAX_ATTEMPTS = 6;

/**
 * @param {{retryMs?: number, maxAttempts?: number, now?: () => number}} [options]
 */
export function createEnrichGate({ retryMs = ENRICH_RETRY_MS, maxAttempts = ENRICH_MAX_ATTEMPTS, now = () => Date.now() } = {}) {
  /** @type {Map<string, {status: 'pending'|'done'|'failed', attempts: number, retryAt: number}>} */
  const state = new Map();

  const allowed = (entry) => !entry
    || (entry.status === 'failed' && entry.attempts < maxAttempts && now() >= entry.retryAt);

  return {
    /** Smie sa kľúč pýtať? (nič nemení) */
    canBegin(key) { return allowed(state.get(key)); },
    /** Začni dopyt: true = pýtaj sa, false = už vybavené, prebieha alebo čaká na ďalší pokus. */
    begin(key) {
      const entry = state.get(key);
      if (!allowed(entry)) return false;
      state.set(key, { status: 'pending', attempts: (entry?.attempts || 0) + 1, retryAt: 0 });
      return true;
    },
    /** Odpoveď prišla (aj „nenájdené") — kľúč je vybavený. */
    succeed(key) {
      const entry = state.get(key);
      if (entry) entry.status = 'done';
    },
    /** Dopyt zlyhal — ďalší pokus najskôr o `retryMs × počet pokusov`. */
    fail(key) {
      const entry = state.get(key);
      if (!entry) return;
      entry.status = 'failed';
      entry.retryAt = now() + retryMs * entry.attempts;
    },
    /** Stav kľúča pre diagnostiku a testy. */
    status(key) {
      const entry = state.get(key);
      return entry ? { ...entry } : null;
    },
    clear() { state.clear(); },
    get size() { return state.size; },
  };
}
