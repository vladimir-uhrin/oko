// src/data/shipServer/portInbound.js
/**
 * @module shipServer/portInbound
 * @description Lode smerujúce do prístavu (2026-10-11, vlastník: „klik na prístav by ukázal, kto
 * doň pláva a kedy dorazí"). Čistá funkcia nad úložiskom živých lodí: cieľ z AIS (voľný text
 * posádky, „NLRTM", „ROTTERDAM", „NL RTM>DE HAM") sa porovná s LOCODE a menom prístavu;
 * vzdialenosť po veľkej kružnici, ETA z aktuálnej rýchlosti (odhad — pravidlo 2).
 */

const R_KM = 6371.0088;
export const PORT_INBOUND_MAX = 15;
export const PORT_INBOUND_MIN_SPEED_KN = 1;
/** Stojaca loď bližšie než toto (km) je v prístave, nie na ceste. */
export const PORT_INBOUND_IN_PORT_KM = 25;
/** Cieľ „A>B": berie sa B (posledný). */
const SPLIT_RE = /[>→]/;

/** Normalizovaný text: veľké písmená, len A–Z0–9 a medzery. Pure. */
export function normalizeDestinationText(text) {
  return String(text || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

/** „NL RTM" → „NLRTM"; LOCODE v texte (5 znakov, prvé 2 písmená). Pure. */
export function locodesInText(norm) {
  const out = new Set();
  const joined = norm.replace(/\b([A-Z]{2}) ([A-Z0-9]{3})\b/g, '$1$2');
  for (const w of joined.split(' ')) if (/^[A-Z]{2}[A-Z0-9]{3}$/.test(w)) out.add(w);
  return out;
}

/**
 * Sedí cieľ z AIS s prístavom? LOCODE (aj „NL RTM") alebo všetky slová mena prístavu (≥ 3 znaky,
 * bez „PORT", „OF", „DE", „THE"). Pure.
 */
export function destinationMatchesPort(destination, port) {
  const tail = String(destination || '').split(SPLIT_RE).pop();
  const norm = normalizeDestinationText(tail);
  if (!norm) return false;
  const locode = normalizeDestinationText(port?.locode).replace(/ /g, '');
  if (locode && locodesInText(norm).has(locode)) return true;
  const words = normalizeDestinationText(port?.name).split(' ').filter((w) => w.length >= 3 && !['PORT', 'THE', 'OF', 'DE', 'DEL', 'LA', 'HARBOUR', 'HARBOR'].includes(w));
  if (!words.length) return false;
  const have = new Set(norm.split(' '));
  return words.every((w) => have.has(w));
}

export function greatCircleKm(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(a));
}

/**
 * Lode na ceste do prístavu z úložiska. Pure.
 * @param {Iterable<object>} rows riadky úložiska (lat, lon, speed, destination, last_position_epoch, name, type, feed)
 * @param {{locode?: string, name?: string, lat: number, lon: number}} port
 * @param {{nowMs?: number, staleMs?: number, limit?: number}} [o]
 * @returns {{count: number, moving: number, ships: Array<object>}}
 */
export function inboundToPort(rows, port, { nowMs = Date.now(), staleMs = 6 * 3600_000, limit = PORT_INBOUND_MAX } = {}) {
  if (!port || !Number.isFinite(port.lat) || !Number.isFinite(port.lon)) return { count: 0, moving: 0, ships: [] };
  const ships = [];
  for (const row of rows) {
    if (!row || typeof row.mmsi !== 'string' || !/^\d{9}$/.test(row.mmsi)) continue;
    if (!Number.isFinite(row.last_position_epoch) || nowMs - row.last_position_epoch * 1000 > staleMs) continue;
    if (!destinationMatchesPort(row.destination, port)) continue;
    const distanceKm = greatCircleKm(row.lat, row.lon, port.lat, port.lon);
    const speed = Number(row.speed);
    const moving = Number.isFinite(speed) && speed >= PORT_INBOUND_MIN_SPEED_KN;
    // Už v prístave: blízko a stojí (Rotterdam má 40 km; 741 lodí „na ceste" boli väčšinou pri móle, 2026-10-11).
    if (distanceKm < 3 || (!moving && distanceKm < PORT_INBOUND_IN_PORT_KM)) continue;
    const etaMs = moving ? nowMs + (distanceKm / (speed * 1.852)) * 3600_000 : null;
    ships.push({ mmsi: row.mmsi, name: row.name || null, type: row.type ?? null, lat: row.lat, lon: row.lon, speed: Number.isFinite(speed) ? speed : null,
      distanceKm: Math.round(distanceKm), etaMs: etaMs ? Math.round(etaMs) : null, feed: row.feed || 'aisstream', lastPositionEpoch: row.last_position_epoch });
  }
  ships.sort((a, b) => (a.etaMs ?? Infinity) - (b.etaMs ?? Infinity) || a.distanceKm - b.distanceKm);
  return { count: ships.length, moving: ships.filter((s) => s.etaMs !== null).length, ships: ships.slice(0, limit) };
}
