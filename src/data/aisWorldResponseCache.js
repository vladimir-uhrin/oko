// src/data/aisWorldResponseCache.js
// Krátka serverová cache odpovede /api/ais-live BEZ výrezu (2026-10-15, vite.config.js).
//
// Prečo: pohľad na svet (kamera nad 4 000 km) pýta lode bez výrezu — na okolive.sk ~22 MB JSON,
// ktorý server skladá 1,1–1,5 s (selectAisCoverage + JSON.stringify na hlavnom vlákne). Každý
// návštevník pri štarte pýta to isté, takže súbežní návštevníci skladali tých istých 22 MB znova
// a navzájom si predlžovali odpoveď — na telefóne až za limit klienta (NAČÍTANIE ZLYHALO).
// Hotový text odpovede sa preto drží pár sekúnd podľa (maxRows, selected). Požiadavka s výrezom
// sa NEkešuje nikdy. Klient dostáva naďalej Cache-Control: no-store — cache žije len v serveri
// a jej vek (≤ AIS_WORLD_RESPONSE_CACHE_MS) je oproti obnove vrstvy (60 s) zanedbateľný; čas
// a stav zdroja v tele zodpovedajú okamihu, keď sa telo skladalo.

/** Ako dlho sa hotová odpoveď bez výrezu použije znova. */
export const AIS_WORLD_RESPONSE_CACHE_MS = 5000;
/** Najviac toľko rôznych odpovedí naraz (strop riadkov / vybraná loď) — každá až ~22 MB. */
export const AIS_WORLD_RESPONSE_CACHE_MAX = 4;

/**
 * Kľúč cache pre požiadavku, alebo null, keď sa kešovať nesmie (požiadavka s výrezom).
 * @param {{bounds?: object|null, maxRows: number, selected?: string|null}} request
 * @returns {string|null}
 */
export function aisWorldResponseKey({ bounds = null, maxRows, selected = null } = {}) {
  if (bounds) return null;
  return `${maxRows}|${selected || ''}`;
}

/**
 * @param {{ttlMs?: number, maxEntries?: number, now?: () => number,
 *   setTimer?: (fn: () => void, ms: number) => unknown, clearTimer?: (timer: unknown) => void}} [options]
 */
export function createAisWorldResponseCache({
  ttlMs = AIS_WORLD_RESPONSE_CACHE_MS,
  maxEntries = AIS_WORLD_RESPONSE_CACHE_MAX,
  now = () => Date.now(),
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  /** @type {Map<string, {statusCode: number, body: string, at: number}>} */
  const entries = new Map();
  let sweepTimer = null;

  function prune(at) {
    for (const [key, entry] of entries) {
      if (at - entry.at >= ttlMs) entries.delete(key);
    }
  }

  /**
   * Vypršané odpovede zahodí aj bez ďalšej požiadavky (2026-10-16): bez toho ostali po poslednom
   * návštevníkovi až 4 × ~22 MB textu v pamäti služby oko-api natrvalo. Časovač je unref —
   * nedrží proces nažive. Mapa je v poradí vkladania = v poradí veku (zásah nič nepresúva).
   */
  function scheduleSweep() {
    if (sweepTimer !== null || entries.size === 0 || typeof setTimer !== 'function') return;
    const oldest = entries.values().next().value;
    const delayMs = Math.max(0, oldest.at + ttlMs - now());
    sweepTimer = setTimer(() => {
      sweepTimer = null;
      prune(now());
      scheduleSweep();
    }, delayMs);
    sweepTimer?.unref?.();
  }

  return {
    /**
     * Vráti uloženú odpoveď pre kľúč, alebo ju zloží `build()` a uloží. Chyba v `build()`
     * sa neuloží a ide ďalej (handler odpovie 502 ako doteraz).
     * @param {string} key - z aisWorldResponseKey (nie null)
     * @param {() => {statusCode: number, body: string}} build
     * @returns {{statusCode: number, body: string, cache: 'HIT'|'MISS'}}
     */
    respond(key, build) {
      const at = now();
      prune(at);
      const hit = entries.get(key);
      if (hit) return { statusCode: hit.statusCode, body: hit.body, cache: 'HIT' };
      const built = build();
      entries.set(key, { statusCode: built.statusCode, body: built.body, at });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      scheduleSweep();
      return { statusCode: built.statusCode, body: built.body, cache: 'MISS' };
    },
    clear() {
      entries.clear();
      if (sweepTimer !== null && typeof clearTimer === 'function') clearTimer(sweepTimer);
      sweepTimer = null;
    },
    get size() { return entries.size; },
  };
}

/**
 * Odpoveď /api/ais-live s lodnými riadkami (2026-10-16, vytiahnuté z vite.config.js, nech je
 * zapojenie cache overiteľné testom): svet bez výrezu ide cez krátku cache a nesie hlavičku
 * X-AIS-World-Cache: HIT|MISS; výrez sa skladá vždy nanovo a hlavičku nemá. Klient vždy no-store.
 * @param {{bounds?: object|null, maxRows: number, selected?: string|null,
 *   cache: ReturnType<typeof createAisWorldResponseCache>, build: () => {statusCode: number, body: string}}} input
 * @returns {{statusCode: number, headers: Record<string, string>, body: string}}
 */
export function answerAisLiveRequest({ bounds = null, maxRows, selected = null, cache, build }) {
  const key = aisWorldResponseKey({ bounds, maxRows, selected });
  const answer = key ? cache.respond(key, build) : { ...build(), cache: null };
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (answer.cache) headers['X-AIS-World-Cache'] = answer.cache;
  return { statusCode: answer.statusCode, headers, body: answer.body };
}
