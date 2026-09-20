// src/data/reliefTilesProxy.js
/**
 * @module reliefTilesProxy
 * @description Vite plugin `/api/relief/{z}/{x}/{y}.png` → Mapzen/Nextzen
 * „normal" dlaždice (AWS Open Data `elevation-tiles-prod/normal`). Prečo
 * proxy: bucket nemá CORS, takže prehliadač z dlaždice nevie čítať pixely
 * (tieňovanie v hillshadeImagery.js ich potrebuje). Dlaždice sú statické →
 * disková cache navždy (`.gev-cache/relief-normal/`, junction na D:),
 * odpoveď `immutable`. Bez kľúča, bez kvóty; limiter len proti slučke.
 * Vlastný modul ako earthquakeFeedProxy.js — vite.config.js ho len registruje.
 */
import path from 'node:path';
import { promises as fsp } from 'node:fs';

export const RELIEF_UPSTREAM = 'https://s3.amazonaws.com/elevation-tiles-prod/normal';
export const RELIEF_MAX_LEVEL = 15;
export const RELIEF_MAX_BYTES = 2 * 1024 * 1024;
export const RELIEF_ATTRIBUTION = 'Mapzen/Nextzen terrain tiles (AWS Open Data) · SRTM (NASA/USGS), EU-DEM (Copernicus), GMTED2010, ETOPO1 — attribution required';
const USER_AGENT = 'OKO/0.1 (https://github.com/vladouh76; vladouh76@gmail.com)';
const UPSTREAM_TIMEOUT_MS = 25_000;

/** `/12/2478/1406.png` → { z, x, y } alebo null (mimo rozsahu, iný tvar). Pure. */
export function parseReliefPath(pathname) {
  const m = /^\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.png$/.exec(String(pathname || '').split('?')[0]);
  if (!m) return null;
  const z = Number(m[1]), x = Number(m[2]), y = Number(m[3]);
  if (z > RELIEF_MAX_LEVEL) return null;
  const n = 2 ** z;
  if (x >= n || y >= n) return null;
  return { z, x, y };
}

/** URL upstream dlaždice. Pure. */
export function reliefUpstreamUrl({ z, x, y }) {
  return `${RELIEF_UPSTREAM}/${z}/${x}/${y}.png`;
}

/** Kľúč klienta: za tunelom CF-Connecting-IP, inak socket. */
export function reliefClientKey(req) {
  const cf = req?.headers?.['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return cf.trim();
  return req?.socket?.remoteAddress || 'local';
}

function simpleLimiter({ windowMs, max, now = Date.now }) {
  const hits = new Map();
  return (key) => {
    const t = now();
    let arr = hits.get(key);
    if (!arr) { arr = []; hits.set(key, arr); }
    while (arr.length && t - arr[0] > windowMs) arr.shift();
    if (arr.length >= max) return false;
    arr.push(t);
    return true;
  };
}

/**
 * @param {object} [o]
 * @param {string} [o.root] koreň projektu (cache pod `.gev-cache/relief-normal`)
 * @param {Function} [o.fetchImpl]
 * @param {Function} [o.now]
 * @param {Function} [o.log]
 */
export function reliefTilesProxy({ root = process.cwd(), fetchImpl = (...a) => fetch(...a), now = Date.now, log = (m) => console.log(m) } = {}) {
  const dir = path.join(root, '.gev-cache', 'relief-normal');
  const limiter = simpleLimiter({ windowMs: 60_000, max: 900, now });
  const inflight = new Map();
  const cachePath = ({ z, x, y }) => path.join(dir, String(z), String(x), `${y}.png`);

  async function readCached(tile) {
    try { return await fsp.readFile(cachePath(tile)); } catch { return null; }
  }
  async function fetchTile(tile) {
    const key = `${tile.z}/${tile.x}/${tile.y}`;
    if (inflight.has(key)) return inflight.get(key);
    const job = (async () => {
      const res = await fetchImpl(reliefUpstreamUrl(tile), { headers: { 'User-Agent': USER_AGENT, Accept: 'image/png' }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
      if (res.status === 404 || res.status === 403) return { status: 404 };
      if (!res.ok) return { status: 502, error: `upstream ${res.status}` };
      const type = String(res.headers.get('content-type') || '').split(';')[0].trim();
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > RELIEF_MAX_BYTES || (type && type !== 'image/png')) return { status: 502, error: 'bad tile' };
      const file = cachePath(tile);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, buf);
      await fsp.rename(tmp, file);
      return { status: 200, buf };
    })().finally(() => inflight.delete(key));
    inflight.set(key, job);
    return job;
  }
  const send = (res, status, body, type = 'application/json; charset=utf-8', extra = {}) => {
    res.writeHead(status, { 'Content-Type': type, ...extra });
    res.end(body);
  };
  const sendPng = (res, buf, source) => send(res, 200, buf, 'image/png', {
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Length': String(buf.length),
    'X-OKO-Source': source,
  });

  async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { send(res, 405, JSON.stringify({ error: 'method_not_allowed' })); return; }
    const tile = parseReliefPath(req.url || '');
    if (!tile) { send(res, 400, JSON.stringify({ error: 'bad_tile' })); return; }
    const cached = await readCached(tile);
    if (cached) { sendPng(res, cached, 'cache'); return; }
    if (!limiter(reliefClientKey(req))) { send(res, 429, JSON.stringify({ error: 'rate_limited' }), 'application/json; charset=utf-8', { 'Retry-After': '30' }); return; }
    try {
      const out = await fetchTile(tile);
      if (out.status === 200) { sendPng(res, out.buf, 'upstream'); return; }
      if (out.status === 404) { send(res, 404, JSON.stringify({ error: 'no_tile' }), 'application/json; charset=utf-8', { 'Cache-Control': 'public, max-age=86400' }); return; }
      send(res, 502, JSON.stringify({ error: out.error || 'upstream' }));
    } catch (error) {
      log(`[relief] ${tile.z}/${tile.x}/${tile.y} failed: ${error?.message || error}`);
      send(res, 502, JSON.stringify({ error: 'upstream_failed' }));
    }
  }
  function install(server) { server.middlewares.use('/api/relief', handler); }
  return {
    name: 'oko-relief-tiles',
    configureServer(server) { install(server); },
    configurePreviewServer(server) { install(server); },
    _handler: handler,
    _dir: dir,
  };
}
