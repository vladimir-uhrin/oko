/**
 * Približná poloha návštevníka pre úvodný prelet (2026-10-15, vlastník: „na určitý čas sa zobrazí celá
 * Zem a podľa IP adresy priletí k miestu, odkiaľ sa užívateľ pripojil"). Z hlavičiek Cloudflare
 * (src/admin/server/liveGeo.js — mesto zaokrúhlené na 0,1°, inak hlavné mesto krajiny); žiadna cudzia
 * služba, nič sa neukladá ani neloguje, odpoveď ide len tomu, kto sa pýta, a nekešuje sa.
 */
import { geoFromRequest } from './admin/server/liveGeo.js';

/** Telo odpovede /api/whereami z požiadavky (pure). */
export function whereAmIPayload(req) {
  const geo = geoFromRequest(req);
  if (geo.precision === 'none') return { precision: 'none' };
  return { precision: geo.precision, lat: geo.lat, lon: geo.lon, city: geo.precision === 'city' ? geo.city : '', country: geo.country };
}

/** Middleware GET /api/whereami. */
export function whereAmIMiddleware(req, res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', '*');
  res.end(JSON.stringify(whereAmIPayload(req)));
}

/** Vite plugin (dev aj služba oko-api). */
export function whereAmIPlugin() {
  return {
    name: 'oko-whereami',
    configureServer(server) {
      server.middlewares.use('/api/whereami', whereAmIMiddleware);
    },
  };
}
