// src/data/portInbound.js
/**
 * @module portInbound
 * @description Klient /api/ais-live/inbound (2026-10-11): lode na ceste do prístavu pre kartu
 * prístavu. Synchrónny prístup k už známej odpovedi (karty sa prekresľujú často), jeden dopyt na
 * prístav, platnosť 2 min. Riadky do karty sú čisté funkcie (testované bez DOM).
 */

const cache = new Map(); // key → {at, data} | 'pending'
const listeners = new Map();
export const PORT_INBOUND_TTL_MS = 2 * 60_000;
const CACHE_MAX = 200;

/** Kľúč prístavu. Pure. */
export function portInboundKey(port) {
  return `${String(port?.locode || '').toUpperCase()}|${String(port?.name || '').toUpperCase()}|${Number(port?.lat).toFixed(2)},${Number(port?.lon).toFixed(2)}`;
}

/**
 * Odpoveď, ak už je známa; inak spustí dopyt a vráti null (`onReady` po príchode).
 * @param {{locode?: string, name?: string, lat: number, lon: number}} port
 * @param {() => void} [onReady]
 * @param {{nowMs?: number, fetchImpl?: typeof fetch}} [o]
 */
export function portInboundSync(port, onReady, { nowMs = Date.now(), fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
  if (!port || !Number.isFinite(port.lat) || !Number.isFinite(port.lon) || typeof fetchImpl !== 'function') return null;
  const key = portInboundKey(port);
  const hit = cache.get(key);
  if (hit && hit !== 'pending' && nowMs - hit.at < PORT_INBOUND_TTL_MS) return hit.data;
  if (typeof onReady === 'function') {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(onReady);
  }
  if (hit === 'pending') return null;
  cache.set(key, 'pending');
  const q = new URLSearchParams({ lat: port.lat.toFixed(4), lon: port.lon.toFixed(4) });
  if (port.locode) q.set('locode', port.locode);
  if (port.name) q.set('name', port.name);
  fetchImpl(`/api/ais-live/inbound?${q}`, { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((data) => {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(key, { at: nowMs, data: data && Array.isArray(data.ships) ? data : null });
      const fns = listeners.get(key);
      listeners.delete(key);
      for (const fn of fns || []) { try { fn(); } catch { /* */ } }
    });
  return hit && hit !== 'pending' ? hit.data : null;
}

/** „6 h", „2 d 4 h", „35 min". Pure. */
function etaLabel(ms, nowMs) {
  const h = Math.max(0, (ms - nowMs) / 3600_000);
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 24) return `${Math.round(h)} h`;
  const d = Math.floor(h / 24);
  const rest = Math.round(h - d * 24);
  return rest ? `${d} d ${rest} h` : `${d} d`;
}

/**
 * Riadky do karty prístavu. Pure.
 * @param {{count: number, moving: number, ships: Array<object>}|null} data
 * @param {(k: string, v?: object) => string} t
 */
export function portInboundLines(data, t, { nowMs = Date.now(), max = 3 } = {}) {
  if (!data) return [];
  if (!data.count) return [t('port.inbound.none')];
  const lines = [t('port.inbound.count', { n: data.count })];
  for (const s of data.ships.slice(0, max)) {
    const name = s.name || `MMSI ${s.mmsi}`;
    const parts = [name, `${s.distanceKm} km`, s.etaMs ? t('port.inbound.eta', { eta: etaLabel(s.etaMs, nowMs) }) : t('port.inbound.stopped')];
    lines.push(parts.join(' · '));
  }
  return lines;
}

/** Test seam. */
export function _resetPortInboundForTest() { cache.clear(); listeners.clear(); }
