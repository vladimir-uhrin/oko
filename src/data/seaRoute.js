// src/data/seaRoute.js
/**
 * @module seaRoute
 * @description Klient /api/searoute (2026-10-11, bod 5): plavebná trasa po
 * mori cez body. Synchrónny prístup k už známej trase (karty a čiary sa
 * prekresľujú často) + jeden dopyt na kľúč; kým trasa nepríde, kreslí sa
 * priamka ako doteraz.
 */
const cache = new Map(); // key → {coordinates, lengthKm, legs} | null (zlyhalo) | 'pending'
const listeners = new Map(); // key → Set<fn>
const CACHE_MAX = 300;

/** Kľúč bodov (0,05°). Pure. */
export function seaRouteKey(points) {
  return (Array.isArray(points) ? points : []).map((p) => `${Math.round(p.lon * 20)},${Math.round(p.lat * 20)}`).join(';');
}

/**
 * Trasa, ak už je známa; inak spustí dopyt a vráti null. `onReady` sa zavolá,
 * keď trasa príde (prekresli čiaru/kartu).
 * @param {Array<{lat:number, lon:number}>} points
 * @param {() => void} [onReady]
 */
export function seaRouteSync(points, onReady) {
  const pts = (Array.isArray(points) ? points : []).filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon));
  if (pts.length < 2 || pts.length > 12 || typeof fetch !== 'function') return null;
  const key = seaRouteKey(pts);
  const hit = cache.get(key);
  if (hit && hit !== 'pending') return hit;
  if (hit === null) return null;
  if (typeof onReady === 'function') {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(onReady);
  }
  if (hit === 'pending') return null;
  cache.set(key, 'pending');
  const q = pts.map((p) => `${p.lon.toFixed(4)},${p.lat.toFixed(4)}`).join(';');
  fetch(`/api/searoute?points=${encodeURIComponent(q)}`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((route) => {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(key, route && Array.isArray(route.coordinates) && route.coordinates.length >= 2 ? route : null);
      const fns = listeners.get(key);
      listeners.delete(key);
      for (const fn of fns || []) { try { fn(); } catch { /* */ } }
    });
  return null;
}

/** Trasa → body pre čiaru `[[lon, lat, 0], …]`. Pure. */
export function seaRoutePositionsDeg(route) {
  return Array.isArray(route?.coordinates) && route.coordinates.length >= 2 ? route.coordinates.map(([lon, lat]) => [lon, lat, 0]) : null;
}

/** Test seam. */
export function _setSeaRouteForTest(points, route) { cache.set(seaRouteKey(points), route); }
export function _resetSeaRouteForTest() { cache.clear(); listeners.clear(); }
