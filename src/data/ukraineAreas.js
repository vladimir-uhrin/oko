// src/data/ukraineAreas.js
/**
 * @module ukraineAreas
 * @description Čisté pomocné funkcie a štýl pre plochy OSM v režime KARTA
 * (etapa K2, 2026-09-20): dlaždice 1°×1° (`N48E037`, build
 * scripts/build-ukraine-areas.mjs → `/api/ukraine/base/areas/<key>`), výber
 * dlaždíc podľa pohľadu kamery, prahy výšky, farby v štýle vzorky
 * docs/drafts/karta-vzorka. Bez Cesia, bez DOM.
 */

export const UKRAINE_AREAS_API = '/api/ukraine/base/areas';
/** Nad touto výškou kamery sa plochy nekreslia (obce podkladu majú 260 km). */
export const AREAS_MAX_HEIGHT_M = 420_000;
/** Naraz viditeľné dlaždice a koľko ich ostáva v pamäti po odlete. */
export const AREAS_MAX_TILES = 6;
export const AREAS_CACHE_TILES = 12;
/** Štýl plôch (vzorka KARTA): zástavba svetlosivá, les tmavozelený s bodkami, voda modrá, železnica čiarkovaná. */
export const AREAS_STYLE = Object.freeze({
  built: Object.freeze({ color: '#cdd5de', alpha: 0.34 }),
  forest: Object.freeze({ color: '#1f3a30', alpha: 0.45, dotColor: '#e8f0f6', dotAlpha: 0.42, spacingPx: 7, radius: 0.16 }),
  water: Object.freeze({ color: '#5f93c4', alpha: 0.5 }),
  rail: Object.freeze({ color: '#e8f0f6', gapColor: '#08101a', widthPx: 1.4, dashLength: 12 }),
});

const pad = (n, w) => String(Math.abs(n)).padStart(w, '0');
/** Kľúč dlaždice 1°×1° pre bod. Pure. */
export function tileKeyFor(lat, lon) {
  const s = Math.floor(lat), w = Math.floor(lon);
  return `${s < 0 ? 'S' : 'N'}${pad(s, 2)}${w < 0 ? 'W' : 'E'}${pad(w, 3)}`;
}
/** Kľúč → bbox [W, S, E, N] alebo null. Pure. */
export function tileBbox(key) {
  const m = /^([NS])(\d{2})([EW])(\d{3})$/.exec(String(key || ''));
  if (!m) return null;
  const s = (m[1] === 'S' ? -1 : 1) * Number(m[2]);
  const w = (m[3] === 'W' ? -1 : 1) * Number(m[4]);
  return [w, s, w + 1, s + 1];
}
/** Kreslia sa plochy pri tejto výške kamery? Pure. */
export function areasWanted(cameraHeightM, maxHeightM = AREAS_MAX_HEIGHT_M) {
  return Number.isFinite(cameraHeightM) && cameraHeightM < maxHeightM;
}
/** Kľúče dlaždíc pretínajúcich obdĺžnik [W, S, E, N] (stupne). Pure. */
export function tilesInRect(rect) {
  if (!Array.isArray(rect) || rect.length !== 4 || rect.some((v) => !Number.isFinite(v))) return [];
  const [w, s, e, n] = rect;
  const out = [];
  for (let lat = Math.floor(s); lat < n; lat += 1) for (let lon = Math.floor(w); lon < e; lon += 1) out.push(tileKeyFor(lat, lon));
  return out;
}
/**
 * Výber dlaždíc na kreslenie: pretínajúce pohľad, dostupné v snímku, najbližšie
 * k stredu pohľadu prvé, najviac `max`. Pure.
 * @param {{ rect: number[], center: {lat:number, lon:number}, available: Set<string>|string[], max?: number }} o
 */
export function pickAreaTiles({ rect, center, available, max = AREAS_MAX_TILES }) {
  const avail = available instanceof Set ? available : new Set(available || []);
  const keys = tilesInRect(rect).filter((k) => avail.has(k));
  const dist = (key) => { const b = tileBbox(key); return Math.hypot((b[1] + 0.5 - center.lat) * 111, (b[0] + 0.5 - center.lon) * 111 * Math.cos((center.lat * Math.PI) / 180)); };
  return keys.sort((a, b) => dist(a) - dist(b)).slice(0, max);
}
/** Pohľadový obdĺžnik: ak Cesium nevie (kamera pod obzorom), okno ±`halfDeg` okolo stredu. Pure. */
export function fallbackRect(center, halfDeg = 1.2) {
  return [center.lon - halfDeg, center.lat - halfDeg * 0.7, center.lon + halfDeg, center.lat + halfDeg * 0.7];
}
/** Prahy plochy (km²) a stropy na dlaždicu pri kreslení — 27 000 polygónov na 4 dlaždice zablokovalo hlavné vlákno (meranie 2026-09-20). */
export const AREAS_DRAW_MIN_KM2 = Object.freeze({ built: 0.02, forest: 0.08, water: 0.03 });
export const AREAS_DRAW_MAX = Object.freeze({ built: 2500, forest: 2000, water: 800, rail: 1500 });
/**
 * Triedy, ktoré sa kreslia. Lesy NIE — rozhodnutie používateľa 2026-09-20 po dvoch
 * pohľadoch na KARTU („skús zapnúť tie lesy" → „nie, lesy vypni"). Dáta v dlaždiciach
 * ostávajú aj materiál bodiek; zapnutie = pridať 'forest' do tohto zoznamu.
 */
export const AREAS_DRAW_CLASSES = Object.freeze(['built', 'water', 'rail']);
/** Plocha prstenca (km², lokálna rovina). Pure. */
export function ringAreaKm2(ring) {
  if (!ring || ring.length < 3) return 0;
  const lat0 = (ring[0][1] * Math.PI) / 180;
  const kx = 111.32 * Math.cos(lat0), ky = 111.32;
  let s = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    s += a[0] * kx * (b[1] * ky) - b[0] * kx * (a[1] * ky);
  }
  return Math.abs(s) / 2;
}
/**
 * Výber polygónov dlaždice na kreslenie: prah plochy a strop na triedu (najväčšie
 * prvé, snímok ich už tak radí). Pure.
 * @param {{ built?: number[][][][], forest?: number[][][][], water?: number[][][][], rail?: number[][][] }} data
 */
export function filterAreasForDraw(data, { minKm2 = AREAS_DRAW_MIN_KM2, max = AREAS_DRAW_MAX, classes = AREAS_DRAW_CLASSES } = {}) {
  const out = { counts: {} };
  const on = new Set(classes);
  for (const cls of ['built', 'forest', 'water']) {
    const kept = on.has(cls) ? (data?.[cls] || []).filter((rings) => Array.isArray(rings?.[0]) && ringAreaKm2(rings[0]) >= minKm2[cls]) : [];
    out[cls] = kept.slice(0, max[cls]);
    out.counts[cls] = out[cls].length;
  }
  out.rail = on.has('rail') ? (data?.rail || []).slice(0, max.rail) : [];
  out.counts.rail = out.rail.length;
  return out;
}
/** CSS farba → [r, g, b] 0..1 (pre uniformy). Pure. */
export function cssToRgb01(css) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(css || '').trim());
  if (!m) return [1, 1, 1];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
