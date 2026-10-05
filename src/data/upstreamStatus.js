// src/data/upstreamStatus.js
/**
 * @module upstreamStatus
 * @description Spoločný register externých zdrojov (2026-10-05, po výpadku ETA na kartách: odhady polôh
 * zahltili adsbdb a ten nás blokoval). Každé volanie adsbdb / adsb.lol / Nominatim sem nahlási výsledok;
 * register drží počty po hodinách (dopyty, 429, chyby) a pauzu po zablokovaní. Menej dôležité volania
 * (hľadanie lietadla, záložný typ) sa počas pauzy zdroja zdržia, aby si zdroj nevzal karty lietadiel
 * a vrstvy. Admin z neho ukazuje „adsbdb zablokovaný do 22:15" v páse „čo horí" a tabuľku v Prevádzke.
 * Len pamäť procesu (oko-api); jediná inštancia cez globalThis — config Vite aj admin ju zdieľajú.
 */
const HOUR = 3600_000;
const KEEP_HOURS = 48;

export function createUpstreamRegistry({ now = Date.now } = {}) {
  const sources = new Map(); // meno → { hours: Map(hodina → {n, limited, errors}), pausedUntil, lastLimitedAt }
  const entry = name => {
    if (!sources.has(name)) sources.set(name, { hours: new Map(), pausedUntil: 0, lastLimitedAt: 0 });
    return sources.get(name);
  };
  return {
    /**
     * Výsledok jedného volania zdroja.
     * @param {string} name 'adsbdb' | 'adsb.lol' | 'nominatim' | …
     * @param {{status?: number, error?: boolean, pauseMs?: number}} result
     */
    record(name, { status = 0, error = false, pauseMs = 0 } = {}) {
      const e = entry(name);
      const hour = Math.floor(now() / HOUR);
      const bucket = e.hours.get(hour) || { n: 0, limited: 0, errors: 0 };
      bucket.n++;
      if (status === 429) {
        bucket.limited++;
        e.lastLimitedAt = now();
        if (pauseMs > 0) e.pausedUntil = Math.max(e.pausedUntil, now() + pauseMs);
      } else if (error || status === 0 || status >= 500) bucket.errors++;
      e.hours.set(hour, bucket);
      for (const h of e.hours.keys()) if (h < hour - KEEP_HOURS) e.hours.delete(h);
    },
    /** Je zdroj práve zablokovaný (nevolať menej dôležité veci)? */
    paused(name) { return now() < (sources.get(name)?.pausedUntil || 0); },
    /** Prehľad pre admin: posledná hodina, 24 h a pauza. */
    snapshot() {
      const hour = Math.floor(now() / HOUR);
      return [...sources].map(([name, e]) => {
        const sum = from => [...e.hours].filter(([h]) => h >= from).reduce((a, [, b]) => ({ n: a.n + b.n, limited: a.limited + b.limited, errors: a.errors + b.errors }), { n: 0, limited: 0, errors: 0 });
        return { name, lastHour: sum(hour), last24h: sum(hour - 23), pausedUntil: e.pausedUntil > now() ? e.pausedUntil : null,
          lastLimitedAt: e.lastLimitedAt || null };
      }).sort((a, b) => a.name.localeCompare(b.name));
    },
  };
}

const KEY = Symbol.for('oko.upstreamRegistry');
/** Spoločná inštancia procesu. */
export const upstream = globalThis[KEY] || (globalThis[KEY] = createUpstreamRegistry());
