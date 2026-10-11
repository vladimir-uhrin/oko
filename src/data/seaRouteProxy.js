// src/data/seaRouteProxy.js
/**
 * @module seaRouteProxy
 * @description Plavebná trasa po mori namiesto priamky (2026-10-11, bod 5 zo
 * zoznamu vylepšení: „čiary plavby … cez Suez/Gibraltár, nie cez Irán").
 *
 *   GET /api/searoute?points=lon,lat;lon,lat;…
 *   → { coordinates: [[lon,lat],…], lengthKm, legs: [km,…] }
 *
 * Najkratšia cesta po námornej sieti (searoute-js, MIT, sieť „marnet" od
 * Eurostatu/ORNL v balíku). Body sa prichytia k sieti, úseky idú za sebou.
 *
 * Zrýchlenie (2026-10-11 večer, bod 5): knižnica sa načítava ~4 s a jedna trasa trvá
 * ~45 ms — v hlavnom vlákne to blokovalo všetky odpovede servera. Výpočet beží vo
 * vlákne (seaRouteWorker.js, zahriate pri štarte), výsledky sú v pamäti (5 000) aj
 * na disku (.gev-cache/searoute, prežijú reštart) podľa bodov zaokrúhlených na 0,05°.
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

const require = createRequire(import.meta.url);
export const SEA_ROUTE_MAX_POINTS = 12;
export const SEA_ROUTE_MEMORY_MAX = 5000;

let _searoute = null;
function searoute() {
  if (!_searoute) _searoute = require('searoute-js');
  return _searoute;
}

/** „lon,lat;lon,lat" → [[lon, lat], …] (2–12 platných bodov) alebo null. Pure. */
export function parseRoutePoints(text) {
  const pts = String(text || '').split(';').map((pair) => pair.split(',').map(Number))
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90);
  if (pts.length < 2 || pts.length > SEA_ROUTE_MAX_POINTS) return null;
  return pts;
}

/** Kľúč cache: body na 0,05°. Pure. */
export function seaRouteCacheKey(pts) {
  return pts.map(([lon, lat]) => `${Math.round(lon * 20)},${Math.round(lat * 20)}`).join(';');
}

const point = ([lon, lat]) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon, lat] } });

/**
 * Trasa po mori cez body (úseky za sebou). Úsek, ktorý sieť nenájde (vnútrozemie,
 * jazero), ostane priamkou — nikdy nezlyhá celé. Vstupné body sú na koncoch
 * zachované (loď a prístav nie sú presne na sieti). Synchrónne (vlákno / testy).
 * @param {number[][]} pts
 * @param {(origin:object, dest:object, units:string) => object|null} [route]
 */
export function computeSeaRoute(pts, route = (o, d, u) => searoute()(o, d, u)) {
  const coordinates = [];
  const legs = [];
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    let line = null;
    const log = console.log;
    try {
      console.log = () => {}; // knižnica vypisuje index najbližšej hrany
      line = route(point(a), point(b), 'kilometers');
    } catch { line = null; } finally { console.log = log; }
    const path_ = line?.geometry?.coordinates;
    const seg = Array.isArray(path_) && path_.length >= 2 ? [a, ...path_, b] : [a, b];
    for (const c of seg) {
      const prev = coordinates[coordinates.length - 1];
      if (!prev || Math.abs(prev[0] - c[0]) > 1e-6 || Math.abs(prev[1] - c[1]) > 1e-6) coordinates.push([Math.round(c[0] * 1e4) / 1e4, Math.round(c[1] * 1e4) / 1e4]);
    }
    legs.push(Number.isFinite(line?.properties?.length) ? Math.round(line.properties.length) : null);
  }
  const lengthKm = legs.every(Number.isFinite) ? legs.reduce((s, v) => s + v, 0) : null;
  return { coordinates, lengthKm, legs };
}

/**
 * Služba trás: pamäť → disk → vlákno (alebo synchrónne bez vlákna).
 * @param {{cacheDir?: string|null, useWorker?: boolean, compute?: Function}} [o]
 */
export function createSeaRouteService({ cacheDir = null, useWorker = true, compute = computeSeaRoute } = {}) {
  const memory = new Map();
  const pending = new Map();
  let worker = null;
  let workerFailed = false;
  let ready = false;
  let seq = 0;

  function remember(key, out) {
    if (memory.size >= SEA_ROUTE_MEMORY_MAX) memory.delete(memory.keys().next().value);
    memory.set(key, out);
  }
  const fileFor = (key) => {
    const h = createHash('sha1').update(key).digest('hex');
    return path.join(cacheDir, h.slice(0, 2), `${h.slice(2, 26)}.json`);
  };

  function ensureWorker() {
    if (worker || workerFailed || !useWorker) return worker;
    try {
      // execArgv: [] — vlákno nededí prepínače procesu (napr. --input-type pri skriptoch), inak nenaštartuje.
      worker = new Worker(new URL('./seaRouteWorker.js', import.meta.url), { workerData: { warm: true }, execArgv: [] });
      worker.on('message', (m) => {
        if (m?.ready) { ready = true; return; }
        const p = pending.get(m?.id);
        if (!p) return;
        pending.delete(m.id);
        if (!pending.size) worker?.unref();
        if (m.error) p.reject(new Error(m.error)); else p.resolve(m.route);
      });
      worker.on('error', (error) => {
        workerFailed = true;
        worker = null;
        for (const p of pending.values()) p.reject(error);
        pending.clear();
      });
      worker.on('exit', () => { worker = null; ready = false; });
      worker.unref(); // nedrží proces nažive, kým nič nepočíta
    } catch { workerFailed = true; worker = null; }
    return worker;
  }

  function computeAsync(pts) {
    const w = ensureWorker();
    if (!w) return Promise.resolve(compute(pts));
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      w.ref();
      w.postMessage({ id, pts });
    });
  }

  /** Trasa (pamäť → disk → výpočet). Pri zlyhaní vlákna sa počíta synchrónne. */
  async function route(pts) {
    const key = seaRouteCacheKey(pts);
    const hit = memory.get(key);
    if (hit) return hit;
    if (cacheDir) {
      try {
        const cached = JSON.parse(await fsp.readFile(fileFor(key), 'utf8'));
        if (Array.isArray(cached?.coordinates)) { remember(key, cached); return cached; }
      } catch { /* nie je na disku */ }
    }
    let out;
    try { out = await computeAsync(pts); } catch { out = compute(pts); }
    remember(key, out);
    if (cacheDir) {
      const file = fileFor(key);
      fsp.mkdir(path.dirname(file), { recursive: true }).then(() => fsp.writeFile(file, JSON.stringify(out))).catch(() => {});
    }
    return out;
  }

  return {
    route,
    /** Zahriatie: spustí vlákno a načíta sieť, aby prvý dopyt nečakal 4 s. */
    warm() { ensureWorker(); },
    stats: () => ({ memory: memory.size, worker: Boolean(worker), ready, pending: pending.size, workerFailed }),
    close() { try { worker?.terminate(); } catch { /* */ } worker = null; },
  };
}

/**
 * @param {{cacheDir?: string|null, useWorker?: boolean}} [o]
 */
export function seaRouteProxy({ cacheDir = null, useWorker = true } = {}) {
  const service = createSeaRouteService({ cacheDir, useWorker });
  async function handler(req, res) {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=86400' }); res.end(JSON.stringify(body)); };
    if (req.method !== 'GET' && req.method !== 'HEAD') { send(405, { error: 'method_not_allowed' }); return; }
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/status') { send(200, service.stats()); return; }
    const pts = parseRoutePoints(url.searchParams.get('points'));
    if (!pts) { send(400, { error: 'bad_points' }); return; }
    try {
      send(200, await service.route(pts));
    } catch (error) {
      send(500, { error: 'route_failed', detail: String(error?.message || error) });
    }
  }
  function install(server) {
    server.middlewares.use('/api/searoute', (req, res) => { void handler(req, res); });
    service.warm();
    server.httpServer?.once?.('close', () => service.close());
  }
  return { name: 'oko-sea-route', configureServer: install, configurePreviewServer: install, _handler: handler, _service: service };
}
