// src/data/adsbdbGuard.js
/**
 * @module adsbdbGuard
 * @description Ochrana adsbdb (2026-10-05, vlastník: „nefunguje mi znova na kartičkách pri lietadlách
 * ETA ani tam nie sú všetky údaje"). Od odhadov polôh (4. 10. večer) server dohľadával cieľ letu cez
 * adsbdb každé 3 s — 1 500 až 3 500 dopytov za hodinu — a adsbdb nás opakovane blokoval
 * („rate limited for 300 seconds", HTTP 429). Počas blokovania karty lietadiel nedostali trasu, ETA,
 * typ ani prevádzkovateľa, a odpoveď „nenájdené" si prehliadač zapamätal natrvalo.
 *
 *  • po 429 sa adsbdb nevolá vôbec, kým blokovanie nevyprší (z textu odpovede, inak 300 s),
 *  • pozaďové dopyty (odhady) majú malý prídel; karty lietadiel (prehliadač) prednosť,
 *  • blokovanie/prídel = LIMITED (server odpovie 503 → prehliadač skúsi neskôr), nie „nenájdené".
 */
export const LIMITED = Object.freeze({ limited: true });

/** Sekundy blokovania z odpovede adsbdb („rate limited for 300 seconds"); inak predvolené. Pure. */
export function rateLimitSeconds(bodyText, fallback = 300) {
  const m = /rate limited for (\d{1,7}) seconds?/i.exec(String(bodyText ?? ''));
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 3600) : fallback;
}

/**
 * @param {object} [o]
 * @param {() => number} [o.now]
 * @param {number} [o.backgroundPerMin] prídel pozaďových dopytov na adsbdb za minútu
 */
export function createAdsbdbGuard({ now = Date.now, backgroundPerMin = 2 } = {}) {
  let pausedUntil = 0;
  let tokens = backgroundPerMin;
  let refilledAt = now();
  return {
    /** Je adsbdb práve zablokovaný (nevolať)? */
    paused: () => now() < pausedUntil,
    pausedUntil: () => pausedUntil,
    /** adsbdb odpovedal 429 — nevolať, kým blokovanie nevyprší (+5 s rezerva). */
    onRateLimited(bodyText) {
      pausedUntil = Math.max(pausedUntil, now() + (rateLimitSeconds(bodyText) + 5) * 1000);
    },
    /** Smie pozaďový dopyt ísť na adsbdb? (odoberie žetón; cache hit žetón nepotrebuje) */
    takeBackground() {
      if (now() < pausedUntil) return false;
      const elapsedMin = (now() - refilledAt) / 60_000;
      if (elapsedMin > 0) { tokens = Math.min(backgroundPerMin, tokens + elapsedMin * backgroundPerMin); refilledAt = now(); }
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}
