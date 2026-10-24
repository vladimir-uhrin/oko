// src/data/militaryFeedService.js — živé vojenské lety pre /api/adsblol/mil (2026-10-23, vlastník: „oprav všetko").
//
// PREČO: adsb.lol má 500 dopytov denne na IP (adsbLolBudget.js). Minútové sťahovanie vojenských letov je 1 440
// dopytov denne — adsb.lol ho neunesie ani samo, nieto spolu s hľadaním a štátnymi lietadlami. Pred opravou
// bolo /api/adsblol/mil od rána do polnoci UTC prázdne 429.
//
// AKO: adsb.fi (opendata.adsb.fi, rovnaký readsb tvar {ac:[…], now}; fair use, 1 dopyt/s, chyby sa počítajú)
// je HLAVNÝ zdroj v minútovom takte; adsb.lol je záloha, keď adsb.fi zlyhá — a len ak to rozpočet dovolí
// (druh `mil`, najmenej 5 min odstup). Jedna cache pre všetkých návštevníkov (60 s), jeden pokus reťazca na
// okno cache (žiadne slučky), zlúčenie súbežných dopytov. Keď nič nové nepríde, odpoveď je posledný známy
// stav s X-ADS-B-Cache: STALE a vekom (X-ADS-B-Age-S) — vrstva ukáže ZASTARANÉ a odkedy, nie prázdno; bez
// akéhokoľvek stavu 503 s Retry-After. Zdroj, ktorý odpoveď dal, nesie X-Flight-Source (panel aj história).
// Čistý modul: fetch, čas, rozpočet aj register sú vstupy (testy).
import { adsbLolBudget } from './adsbLolBudget.js';
import { upstream as upstreamRegistry } from './upstreamStatus.js';

/** Jedna odpoveď pre všetkých návštevníkov; 12 s bolo pri 500/deň neudržateľných. */
export const MIL_FEED_CACHE_MS = 60_000;
export const MIL_FEED_TIMEOUT_MS = 15_000;
/** Strop tela (adsb.fi ~200 kB, adsb.lol ~400 kB). */
export const MIL_FEED_MAX_BYTES = 8 * 1024 * 1024;
/** adsb.fi: 1 dopyt za sekundu, chyby sa počítajú → po chybe minúta pokoja. */
export const ADSBFI_MIN_GAP_MS = 1_100;
export const ADSBFI_ERROR_PAUSE_MS = 60_000;
export const MIL_FEED_USER_AGENT = 'OKO-okolive.sk/1.0 (military feed)';
/** Poradie zdrojov: adsb.fi hlavný, adsb.lol záloha s rozpočtom. */
export const MIL_FEED_PROVIDERS = Object.freeze([
  Object.freeze({ name: 'adsb.fi', url: 'https://opendata.adsb.fi/api/v2/mil', budgeted: false }),
  Object.freeze({ name: 'adsb.lol', url: 'https://api.adsb.lol/v2/mil', budgeted: true }),
]);

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {() => number} [options.now]
 * @param {object} [options.budget] rozpočet adsb.lol (adsbLolBudget)
 * @param {{ record: Function }} [options.registry] register zdrojov (adsb.fi)
 * @param {number} [options.cacheMs]
 * @param {ReadonlyArray<{name: string, url: string, budgeted: boolean}>} [options.providers]
 * @param {(msg: string) => void} [options.log]
 */
export function createMilitaryFeedService({
  fetchImpl = globalThis.fetch,
  now = Date.now,
  budget = adsbLolBudget,
  registry = upstreamRegistry,
  cacheMs = MIL_FEED_CACHE_MS,
  providers = MIL_FEED_PROVIDERS,
  log = (msg) => console.warn(msg),
} = {}) {
  /** Posledná dobrá odpoveď: { body, at, source, count }. */
  let last = null;
  let inFlight = null;
  let lastAttemptAt = -Infinity;
  let fiPausedUntil = 0;
  let fiLastAt = 0;
  const skipped = new Map();

  function allowed(provider) {
    if (provider.budgeted) return budget.allow('mil');
    const t = now();
    return t >= fiPausedUntil && t - fiLastAt >= ADSBFI_MIN_GAP_MS;
  }

  async function tryProvider(provider) {
    if (provider.budgeted) budget.spend('mil'); else fiLastAt = now();
    let res;
    try {
      res = await fetchImpl(provider.url, {
        headers: { 'User-Agent': MIL_FEED_USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(MIL_FEED_TIMEOUT_MS),
      });
    } catch (error) {
      if (provider.budgeted) budget.record('mil', { error: true });
      else { try { registry.record('adsb.fi', { error: true }); } catch { /* */ } fiPausedUntil = now() + ADSBFI_ERROR_PAUSE_MS; }
      return { ok: false, reason: error?.message || 'network' };
    }
    if (provider.budgeted) budget.record('mil', { status: res.status, headers: res.headers });
    else {
      try { registry.record('adsb.fi', { status: res.status, pauseMs: res.status === 429 ? ADSBFI_ERROR_PAUSE_MS : 0 }); } catch { /* */ }
      if (!res.ok) fiPausedUntil = now() + ADSBFI_ERROR_PAUSE_MS;
    }
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    let body;
    try { body = await res.text(); } catch (error) { return { ok: false, reason: error?.message || 'read' }; }
    if (body.length > MIL_FEED_MAX_BYTES) return { ok: false, reason: 'response too large' };
    let json;
    try { json = JSON.parse(body); } catch { return { ok: false, reason: 'invalid JSON' }; }
    if (!json || !Array.isArray(json.ac)) return { ok: false, reason: 'no ac[] in response' };
    return { ok: true, body, count: json.ac.length, source: provider.name };
  }

  /** Jeden prechod reťazcom zdrojov; null = nič nové (stará odpoveď ostáva). */
  async function refresh() {
    for (const provider of providers) {
      if (!allowed(provider)) { skipped.set(provider.name, (skipped.get(provider.name) || 0) + 1); continue; }
      const result = await tryProvider(provider);
      if (result.ok) {
        last = { body: result.body, at: now(), source: result.source, count: result.count };
        return last;
      }
      log(`[mil feed] ${provider.name}: ${result.reason}`);
    }
    return null;
  }

  /**
   * Odpoveď pre jeden dopyt návštevníka alebo strážcu.
   * @returns {Promise<{status: number, body: string, headers: object, stale: boolean}>}
   */
  async function snapshot() {
    const t = now();
    const headersFor = (cache, rec, extra = {}) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-ADS-B-Cache': cache,
      ...(rec ? { 'X-Flight-Source': rec.source, 'X-ADS-B-Age-S': String(Math.max(0, Math.round((now() - rec.at) / 1000))), 'X-Flight-Count': String(rec.count) } : {}),
      ...extra,
    });
    if (last && t - last.at < cacheMs) return { status: 200, body: last.body, headers: headersFor('HIT', last), stale: false };
    let fresh = null;
    let shared = false;
    if (inFlight) { shared = true; fresh = await inFlight; }
    else if (t - lastAttemptAt >= cacheMs) {
      // Jeden pokus reťazca na okno cache — zlyhanie sa do ďalšieho okna neopakuje.
      lastAttemptAt = t;
      inFlight = refresh().finally(() => { inFlight = null; });
      fresh = await inFlight;
    }
    if (fresh) return { status: 200, body: fresh.body, headers: headersFor(shared ? 'INFLIGHT' : 'MISS', fresh), stale: false };
    if (last) return { status: 200, body: last.body, headers: headersFor('STALE', last), stale: true };
    const retryS = Math.max(15, Math.ceil((lastAttemptAt + cacheMs - now()) / 1000));
    return {
      status: 503,
      body: JSON.stringify({ error: 'military_feed_unavailable', retryAfterS: retryS }),
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-ADS-B-Cache': 'NONE', 'Retry-After': String(retryS) },
      stale: false,
    };
  }

  /** Vite/Connect middleware pre /api/adsblol/mil. */
  async function middleware(req, res) {
    let snap;
    try { snap = await snapshot(); } catch (error) {
      log(`[mil feed] ${error?.message || error}`);
      snap = { status: 502, body: JSON.stringify({ error: 'military_feed_error' }), headers: { 'Content-Type': 'application/json' }, stale: false };
    }
    // Zastaraná odpoveď sa do histórie letov nezapisuje znova (vite.config.js tapResponse).
    if (snap.stale || snap.status !== 200) res.okoHistoryRecord = false;
    res.writeHead(snap.status, snap.headers);
    res.end(snap.body);
  }

  return {
    snapshot,
    middleware,
    status: () => ({
      source: last?.source ?? null,
      lastAt: last?.at ?? null,
      count: last?.count ?? null,
      cacheMs,
      adsbFiPausedUntil: now() < fiPausedUntil ? fiPausedUntil : null,
      skipped: Object.fromEntries(skipped),
    }),
  };
}
