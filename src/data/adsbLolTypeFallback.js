// src/data/adsbLolTypeFallback.js
/**
 * @module adsbLolTypeFallback
 * @description Typ a registrácia lietadla, keď ho adsbdb nepozná (2026-10-05, vlastník: „na kartičkách
 * nie sú všetky údaje"). adsbdb vracia 404 „unknown aircraft" aj pre bežné stroje (Wizz Air HA-LTL,
 * Austrian OE-…) — karta potom nemala typ ani registráciu. adsb.lol (readsb, ODbL, bez kľúča) ich pri
 * živom lietadle posiela v poliach `t`, `r`, `desc`, `ownOp`: /v2/hex/<hex>.
 * Šetrne: po jednom s odstupom ≥ 1,1 s (adsb.lol dáva 429 pri dávkach), cache 24 h (nenájdené 2 h),
 * po 429 pauza 60 s. Len pre kartu (prehliadač pýta typ sledovaného a viditeľných lietadiel).
 */
import { aircraftTypeName } from './aircraftSearch.js';
import { upstream } from './upstreamStatus.js';

const UPSTREAM = 'https://api.adsb.lol/v2/hex/';

/** Záznam readsb → tvar odpovede /api/adsbdb/type (null, ak typ ani registráciu nemá). Pure. */
export function typeFromReadsb(ac, hex) {
  if (!ac) return null;
  const typeCode = String(ac.t ?? '').trim().toUpperCase() || null;
  const registration = String(ac.r ?? '').trim().toUpperCase() || null;
  if (!typeCode && !registration) return null;
  return {
    typeCode,
    typeName: aircraftTypeName(typeCode) || String(ac.desc ?? '').trim() || typeCode,
    registration,
    modeS: String(hex).toLowerCase(),
    countryIso: null,
    source: 'adsb.lol',
  };
}

/**
 * @param {object} [o]
 * @param {typeof fetch} [o.fetchImpl]
 * @param {() => number} [o.now]
 * @param {(ms: number) => Promise<void>} [o.sleep]
 */
export function createAdsbLolTypeFallback({ fetchImpl = globalThis.fetch, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)),
  gapMs = 1100, hitMs = 24 * 3600_000, missMs = 2 * 3600_000, pauseMs = 60_000, maxPending = 30, registry = upstream } = {}) {
  const cache = new Map(); // hex → { at, data }
  let chain = Promise.resolve();
  let lastAt = 0;
  let pausedUntil = 0;
  let pending = 0; // čakajúce dopyty vo fronte — nad strop sa nečaká (karta skúsi neskôr)

  function lookup(hex) {
    const key = String(hex ?? '').toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(key)) return Promise.resolve(null);
    const hit = cache.get(key);
    if (hit && now() - hit.at < (hit.data ? hitMs : missMs)) return Promise.resolve(hit.data);
    const run = async () => {
      const again = cache.get(key);
      if (again && now() - again.at < (again.data ? hitMs : missMs)) return again.data;
      if (now() < pausedUntil || registry.paused('adsb.lol')) return null;
      const wait = lastAt + gapMs - now();
      if (wait > 0) await sleep(wait);
      lastAt = now();
      try {
        const res = await fetchImpl(UPSTREAM + key, { headers: { 'User-Agent': 'OKO-okolive.sk/1.0 (aircraft type)', Accept: 'application/json' },
          signal: AbortSignal.timeout(8000) });
        registry.record('adsb.lol', { status: res.status, pauseMs: res.status === 429 ? pauseMs : 0 });
        if (res.status === 429) { pausedUntil = now() + pauseMs; return null; }
        if (!res.ok) return null;
        const body = await res.json();
        const data = typeFromReadsb(Array.isArray(body?.ac) ? body.ac[0] : null, key);
        cache.set(key, { at: now(), data });
        if (cache.size > 20_000) cache.delete(cache.keys().next().value);
        return data;
      } catch { registry.record('adsb.lol', { error: true }); return null; }
    };
    if (pending >= maxPending || now() < pausedUntil || registry.paused('adsb.lol')) return Promise.resolve(null);
    pending++;
    const result = chain.then(run, run).finally(() => { pending--; });
    chain = result.then(() => {}, () => {});
    return result;
  }
  return { lookup, _cacheForTest: cache };
}
