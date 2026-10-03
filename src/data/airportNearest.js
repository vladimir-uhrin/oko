// src/data/airportNearest.js — najbližšie letisko k bodu (odvodenie odletu/príletu z koncov stopy).
// Pure, bez siete: nad záznamami z parseAirportIndex (OurAirports, public domain).

const EARTH_KM = 6371;
const toRad = (d) => (d * Math.PI) / 180;

/** Veľkokružnicová vzdialenosť v km. Pure. */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Jedinečné letiská z indexu kód → záznam (ten istý záznam je tam pod ICAO aj IATA). Pure. */
export function airportsFromIndex(index) {
  return [...new Set(index instanceof Map ? index.values() : [])];
}

/**
 * Najbližšie letisko do `maxKm`, inak null. Väčšie letisko vyhrá pri podobnej vzdialenosti
 * (do 1 km) — dráha veľkého letiska je ďalej od jeho vzťažného bodu. Pure.
 */
export function nearestAirport(airports, lat, lon, maxKm = 8) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Array.isArray(airports)) return null;
  const rank = { large: 3, medium: 2, small: 1 };
  let best = null;
  let bestKm = Infinity;
  const latSpan = maxKm / 111;
  for (const a of airports) {
    if (Math.abs(a.lat - lat) > latSpan) continue;
    const km = distanceKm(lat, lon, a.lat, a.lon);
    if (km > maxKm) continue;
    const better = km < bestKm - 1
      || (km < bestKm + 1 && (rank[a.type] ?? 0) > (rank[best?.type] ?? 0));
    if (!best || better) {
      best = a;
      bestKm = km;
    }
  }
  return best ? { ...best, distanceKm: Math.round(bestKm * 10) / 10 } : null;
}
