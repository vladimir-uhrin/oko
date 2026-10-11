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
 * Výpočet je lokálny (bez siete, bez kľúča), ~10–50 ms; pamäťová cache
 * podľa bodov zaokrúhlených na 0,05°. Knižnica sa načíta lenivo.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const SEA_ROUTE_MAX_POINTS = 12;
const CACHE_MAX = 500;

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

const point = ([lon, lat]) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon, lat] } });

/**
 * Trasa po mori cez body (úseky za sebou). Úsek, ktorý sieť nenájde (vnútrozemie,
 * jazero), ostane priamkou — nikdy nezlyhá celé. Vstupné body sú na koncoch
 * zachované (loď a prístav nie sú presne na sieti).
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
    const path = line?.geometry?.coordinates;
    const seg = Array.isArray(path) && path.length >= 2 ? [a, ...path, b] : [a, b];
    for (const c of seg) {
      const prev = coordinates[coordinates.length - 1];
      if (!prev || Math.abs(prev[0] - c[0]) > 1e-6 || Math.abs(prev[1] - c[1]) > 1e-6) coordinates.push([Math.round(c[0] * 1e4) / 1e4, Math.round(c[1] * 1e4) / 1e4]);
    }
    legs.push(Number.isFinite(line?.properties?.length) ? Math.round(line.properties.length) : null);
  }
  const lengthKm = legs.every(Number.isFinite) ? legs.reduce((s, v) => s + v, 0) : null;
  return { coordinates, lengthKm, legs };
}

export function seaRouteProxy() {
  const cache = new Map();
  function handler(req, res) {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=86400' }); res.end(JSON.stringify(body)); };
    if (req.method !== 'GET' && req.method !== 'HEAD') { send(405, { error: 'method_not_allowed' }); return; }
    const url = new URL(req.url || '/', 'http://localhost');
    const pts = parseRoutePoints(url.searchParams.get('points'));
    if (!pts) { send(400, { error: 'bad_points' }); return; }
    const key = pts.map(([lon, lat]) => `${Math.round(lon * 20)},${Math.round(lat * 20)}`).join(';');
    let out = cache.get(key);
    if (!out) {
      try { out = computeSeaRoute(pts); } catch (error) { send(500, { error: 'route_failed', detail: String(error?.message || error) }); return; }
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(key, out);
    }
    send(200, out);
  }
  function install(server) { server.middlewares.use('/api/searoute', handler); }
  return { name: 'oko-sea-route', configureServer: install, configurePreviewServer: install, _handler: handler };
}
