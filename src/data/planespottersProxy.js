// src/data/planespottersProxy.js
/**
 * @module planespottersProxy
 * @description Fotky lietadiel z Planespotters Photo API cez server (2026-10-11, prechod
 * tlačidiel: prehliadač volal api.planespotters.net priamo a pri neznámom hexe dostal odpoveď
 * bez CORS hlavičky → chyba v konzole pri každej karte bez fotky).
 *
 *   GET /api/planespotters/hex/<icao24>  → tá istá JSON odpoveď ako upstream ({photos: [...]});
 *   neznámy hex (404 upstream) → 200 {photos: []} (klient to číta ako „bez fotky").
 *
 * Cache v pamäti: fotka 24 h, „bez fotky" 6 h; per-IP strop 120/min; User-Agent s menom
 * projektu (podmienka Planespotters API). Atribúcia fotografa ostáva na karte (trackedPhoto.js).
 */

export const PLANESPOTTERS_UPSTREAM = 'https://api.planespotters.net/pub/photos/hex/';
export const PLANESPOTTERS_TTL_MS = 24 * 3600_000;
export const PLANESPOTTERS_NEGATIVE_TTL_MS = 6 * 3600_000;
const CACHE_MAX = 5000;
const HEX_RE = /^[0-9a-f]{6}$/;

/** Hex z cesty „/hex/3c6444" (malé písmená) alebo null. Pure. */
export function hexFromPath(pathname) {
  const m = /^\/hex\/([0-9a-fA-F]{6})\/?$/.exec(String(pathname || ''));
  return m ? m[1].toLowerCase() : null;
}

/**
 * @param {{fetchImpl?: typeof fetch, now?: () => number, userAgent?: string}} [o]
 */
export function planespottersProxy({ fetchImpl = (...a) => fetch(...a), now = Date.now, userAgent = 'OKO okolive.sk (info@okolive.sk)' } = {}) {
  const cache = new Map(); // hex → {at, ttl, status, body}
  const inflight = new Map();
  const hits = new Map(); // ip → [timestamps]
  const clientKey = (req) => (typeof req?.headers?.['cf-connecting-ip'] === 'string' && req.headers['cf-connecting-ip'].trim()) || req?.socket?.remoteAddress || 'local';
  const allowed = (key) => {
    const t = now();
    const arr = (hits.get(key) || []).filter((x) => t - x < 60_000);
    arr.push(t);
    hits.set(key, arr);
    return arr.length <= 120;
  };

  async function lookup(hex) {
    const hit = cache.get(hex);
    if (hit && now() - hit.at < hit.ttl) return hit;
    const job = inflight.get(hex);
    if (job) return job;
    const run = (async () => {
      let entry;
      try {
        const res = await fetchImpl(`${PLANESPOTTERS_UPSTREAM}${hex}`, { headers: { Accept: 'application/json', 'User-Agent': userAgent }, signal: AbortSignal.timeout(8_000) });
        if (res.status === 404) entry = { at: now(), ttl: PLANESPOTTERS_NEGATIVE_TTL_MS, status: 200, body: '{"photos":[]}' };
        else if (!res.ok) entry = { at: now(), ttl: 0, status: 502, body: JSON.stringify({ error: `upstream ${res.status}` }) };
        else {
          const json = await res.json();
          const photos = Array.isArray(json?.photos) ? json.photos : [];
          entry = { at: now(), ttl: photos.length ? PLANESPOTTERS_TTL_MS : PLANESPOTTERS_NEGATIVE_TTL_MS, status: 200, body: JSON.stringify({ photos }) };
        }
      } catch (error) {
        entry = { at: now(), ttl: 0, status: 502, body: JSON.stringify({ error: String(error?.message || error) }) };
      }
      if (entry.ttl > 0) {
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
        cache.set(hex, entry);
      }
      return entry;
    })().finally(() => inflight.delete(hex));
    inflight.set(hex, run);
    return run;
  }

  async function handler(req, res) {
    const send = (status, body, extra = {}) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra }); res.end(body); };
    if (req.method !== 'GET' && req.method !== 'HEAD') { send(405, '{"error":"method_not_allowed"}'); return; }
    const url = new URL(req.url || '/', 'http://localhost');
    const hex = hexFromPath(url.pathname);
    if (!hex || !HEX_RE.test(hex)) { send(400, '{"error":"bad_hex"}'); return; }
    if (!allowed(clientKey(req))) { send(429, '{"error":"rate_limited"}', { 'Retry-After': '30' }); return; }
    const entry = await lookup(hex);
    send(entry.status, entry.body, entry.status === 200 ? { 'Cache-Control': 'public, max-age=3600' } : { 'Cache-Control': 'no-store' });
  }
  function install(server) { server.middlewares.use('/api/planespotters', (req, res) => { void handler(req, res); }); }
  return { name: 'oko-planespotters', configureServer: install, configurePreviewServer: install, _handler: handler, _cache: cache };
}
