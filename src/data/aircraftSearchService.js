// src/data/aircraftSearchService.js
/**
 * @module aircraftSearchService
 * @description GET /api/aircraft-search?q= — celosvetové hľadanie živého lietadla (2026-10-04).
 * Lietadlá v prehliadači väčšinou nemajú typ ani registráciu (OpenSky ich neposiela), preto
 * „Ruslan" / „UR-82072" hľadá server priamo v adsb.lol (readsb, ODbL, bez kľúča):
 * /v2/type/<ICAO>, /v2/reg/<reg>, /v2/callsign/<cs>, /v2/hex/<hex>.
 *
 * Ohľaduplnosť k adsb.lol (zdieľa ho aj vrstva vojenských lietadiel): jedna požiadavka naraz,
 * ≥ 1,1 s odstup, výsledok cesty 20 s v cache, po 429 pauza 60 s; najviac 4 cesty na dopyt
 * a 20 dopytov za minútu z jednej IP.
 */
import { aircraftTypeName, operatorFromCallsign, parseAircraftQuery, scoreAircraft } from './aircraftSearch.js';
import { upstream } from './upstreamStatus.js';

export const AIRCRAFT_SEARCH_PATH = '/api/aircraft-search';
const UPSTREAM = 'https://api.adsb.lol';
const MAX_PATHS = 4;
const MAX_RESULTS = 60;

/** Cesty adsb.lol pre rozložený dopyt (bez duplicít, najviac MAX_PATHS). Pure. */
export function upstreamPaths(parsed) {
  const paths = [];
  const add = path => { if (!paths.includes(path) && paths.length < MAX_PATHS) paths.push(path); };
  if (parsed.hex) add(`/v2/hex/${parsed.hex}`);
  if (parsed.registration) add(`/v2/reg/${encodeURIComponent(parsed.registration)}`);
  if (parsed.callsign) add(`/v2/callsign/${encodeURIComponent(parsed.callsign)}`);
  for (const type of parsed.types) add(`/v2/type/${encodeURIComponent(type.code)}`);
  return paths;
}

/** Jeden záznam readsb → tvar OKO. Pure. */
export function normalizeReadsb(ac, nowMs) {
  const lat = Number(ac?.lat ?? ac?.lastPosition?.lat);
  const lon = Number(ac?.lon ?? ac?.lastPosition?.lon);
  const hex = String(ac?.hex ?? '').replace(/^~/, '').toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(hex) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const callsign = String(ac?.flight ?? '').trim().toUpperCase() || null;
  const typeCode = String(ac?.t ?? '').trim().toUpperCase() || null;
  const onGround = ac?.alt_baro === 'ground';
  const seenPos = Number(ac?.seen_pos ?? ac?.seen ?? 0);
  return {
    hex, callsign, registration: String(ac?.r ?? '').trim().toUpperCase() || null, typeCode,
    typeName: aircraftTypeName(typeCode) || String(ac?.desc ?? '').trim() || typeCode,
    operator: String(ac?.ownOp ?? '').trim() || operatorFromCallsign(callsign)?.name || null,
    lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4,
    altitudeFt: onGround ? 0 : (Number.isFinite(Number(ac?.alt_baro)) ? Number(ac.alt_baro) : (Number.isFinite(Number(ac?.alt_geom)) ? Number(ac.alt_geom) : null)),
    onGround, speedKt: Number.isFinite(Number(ac?.gs)) ? Math.round(Number(ac.gs)) : null,
    track: Number.isFinite(Number(ac?.track)) ? Math.round(Number(ac.track)) : null,
    military: (Number(ac?.dbFlags) & 1) === 1,
    seenAt: Number.isFinite(seenPos) ? Math.round(nowMs - seenPos * 1000) : nowMs,
  };
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {() => number} [options.now]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 */
export function createAircraftSearchService({ fetchImpl = globalThis.fetch, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)),
  minGapMs = 1100, cacheMs = 20_000, backoffMs = 60_000, perIpPerMin = 20, registry = upstream } = {}) {
  const cache = new Map(); // path → { at, list }
  const limiter = new Map(); // ip → { minute, n }
  let chain = Promise.resolve();
  let lastAt = 0;
  let pausedUntil = 0;

  /** Jedna cesta upstreamu cez spoločnú frontu (po jednej, s odstupom). */
  function fetchPath(path) {
    const hit = cache.get(path);
    if (hit && now() - hit.at < cacheMs) return Promise.resolve({ list: hit.list, cached: true });
    const run = async () => {
      // Pauza vlastná aj spoločná (adsb.lol zablokovaný inou časťou OKO — vrstva vojenských lietadiel má prednosť).
      if (now() < pausedUntil || registry.paused('adsb.lol')) return { list: null, limited: true };
      const wait = lastAt + minGapMs - now();
      if (wait > 0) await sleep(wait);
      lastAt = now();
      let res;
      try {
        res = await fetchImpl(UPSTREAM + path, { headers: { 'User-Agent': 'OKO-okolive.sk/1.0 (aircraft search)', Accept: 'application/json' },
          signal: AbortSignal.timeout(12_000) });
      } catch { registry.record('adsb.lol', { error: true }); return { list: null, failed: true }; }
      registry.record('adsb.lol', { status: res.status, pauseMs: res.status === 429 ? backoffMs : 0 });
      if (res.status === 429) { pausedUntil = now() + backoffMs; return { list: null, limited: true }; }
      if (!res.ok) return { list: null, failed: true };
      let body;
      try { body = await res.json(); } catch { return { list: null, failed: true }; }
      const at = now();
      const list = (Array.isArray(body?.ac) ? body.ac : []).map(ac => normalizeReadsb(ac, at)).filter(Boolean);
      cache.set(path, { at, list });
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      return { list };
    };
    const result = chain.then(run, run);
    chain = result.then(() => {}, () => {});
    return result;
  }

  /** Celé hľadanie: rozloží dopyt, opýta sa adsb.lol, zoradí podľa zhody. */
  async function search(query) {
    const parsed = parseAircraftQuery(query);
    const paths = upstreamPaths(parsed);
    const meaning = [...parsed.types.map(t => t.name), ...parsed.operators.map(op => op.name),
      ...(parsed.registration ? [`registrácia ${parsed.registration}`] : []), ...(parsed.callsign ? [`volací znak ${parsed.callsign}`] : []),
      ...(parsed.hex ? [`hex ${parsed.hex}`] : [])];
    if (!paths.length) return { query: parsed.q, meaning, aircraft: [], searched: 0, source: 'adsb.lol' };
    const results = await Promise.all(paths.map(fetchPath));
    const byHex = new Map();
    for (const { list } of results) for (const ac of list || []) {
      const score = scoreAircraft(ac, parsed) || 40; // výsledok cesty typu/registrácie platí, aj keď skóre nesadne
      if (!byHex.has(ac.hex) || byHex.get(ac.hex).score < score) byHex.set(ac.hex, { ...ac, score });
    }
    const aircraft = [...byHex.values()].sort((a, b) => b.score - a.score || Number(a.onGround) - Number(b.onGround)).slice(0, MAX_RESULTS);
    return { query: parsed.q, meaning, aircraft, searched: paths.length, source: 'adsb.lol',
      limited: results.some(r => r.limited), failed: results.every(r => r.failed) };
  }

  function allow(ip) {
    const minute = Math.floor(now() / 60_000);
    const entry = limiter.get(ip);
    if (!entry || entry.minute !== minute) { if (limiter.size > 5000) limiter.clear(); limiter.set(ip, { minute, n: 1 }); return true; }
    entry.n++;
    return entry.n <= perIpPerMin;
  }

  async function middleware(req, res, next) {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== AIRCRAFT_SEARCH_PATH) return next();
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET') return send(405, { error: 'method_not_allowed' });
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 60);
    if (q.length < 2) return send(400, { error: 'query_too_short' });
    const ip = String(req.headers['cf-connecting-ip'] || req.socket?.remoteAddress || 'unknown');
    if (!allow(ip)) return send(429, { error: 'rate_limited' });
    try { return send(200, await search(q)); } catch { return send(502, { error: 'upstream' }); }
  }

  return { search, middleware, _cacheForTest: cache };
}
