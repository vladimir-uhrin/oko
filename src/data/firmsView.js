// src/data/firmsView.js — menšia odpoveď /api/firms (2026-10-07/10, bod 7) — čisté funkcie.
//
// Pôvodne server posielal všetky ohniská za 24 h (~190 000, 27–34 MB JSON, 2,2 MB gzip): prehliadač ich
// spracúval niekoľko sekúnd a dlaždice mapy sa medzitým nedoťahovali (čierny glóbus). Teraz:
//  - `?view=cells` — zhrnutie po štvorcoch FIRE_CELL_DEG: v každom NAJSILNEJŠIE ohnisko (celý štíhly
//    riadok, na kartu a klik) + počet `n`, nočné `nn`, najnovší čas `nw`, súčet FRP `sf`;
//  - `?bbox=w,s,e,n` — jednotlivé ohniská len vo výreze (pri priblížení), najsilnejšie prvé, strop.
import { acquisitionMsUtc } from './firmsCsv.js';

/** Veľkosť štvorca zhrnutia (°). Zhluky klienta (0,25 / 0,5°) sú jej násobky — sčítajú sa presne. */
export const FIRE_CELL_DEG = 0.25;
/** Najviac ohnísk v odpovedi pre výrez. */
export const FIRE_BBOX_MAX = 20_000;
/** Najväčší výrez (°²), pre ktorý server pošle jednotlivé ohniská (≈ 600 × 600 km). */
export const FIRE_BBOX_MAX_AREA = 40;

/**
 * Ohniská → zhrnutie po štvorcoch. Každý štvorec = štíhly riadok najsilnejšieho ohniska + n, nn, nw, sf.
 * Výstup zoradený podľa FRP najsilnejšieho (zostupne). Pure.
 * @param {Array<object>} fires štíhle riadky (lat, lon, frp, acqDate, acqTime, daynight, …)
 * @param {number} [gridDeg]
 */
export function buildFireCells(fires, gridDeg = FIRE_CELL_DEG) {
  const cells = new Map();
  for (const f of Array.isArray(fires) ? fires : []) {
    if (!Number.isFinite(f?.lat) || !Number.isFinite(f?.lon)) continue;
    const key = `${Math.floor(f.lat / gridDeg)}:${Math.floor(f.lon / gridDeg)}`;
    const ms = acquisitionMsUtc(f.acqDate, f.acqTime);
    const seen = Math.max(Number.isFinite(ms) ? ms : 0, Number(f.geoSeenMs) || 0);
    const frp = Number(f.frp) || 0;
    let c = cells.get(key);
    if (!c) { c = { best: f, n: 0, nn: 0, nw: 0, sf: 0 }; cells.set(key, c); }
    c.n += 1;
    c.sf += frp;
    if (f.daynight === 'N') c.nn += 1;
    if (seen > c.nw) c.nw = seen;
    if (frp > (Number(c.best.frp) || 0)) c.best = f;
  }
  const out = [];
  for (const c of cells.values()) out.push({ ...c.best, n: c.n, nn: c.nn, nw: c.nw, sf: Math.round(c.sf * 10) / 10 });
  out.sort((a, b) => (b.frp || 0) - (a.frp || 0));
  return out;
}

/**
 * `bbox=w,s,e,n` → objekt výrezu, alebo null (zlý formát, mimo rozsahu, priveľký). Cez 180° poludník:
 * w > e. Pure.
 */
export function parseFireBbox(text) {
  const p = String(text || '').split(',').map(Number);
  if (p.length !== 4 || p.some((v) => !Number.isFinite(v))) return null;
  const [w, s, e, n] = p;
  if (s < -90 || n > 90 || s >= n || Math.abs(w) > 180 || Math.abs(e) > 180) return null;
  const width = w <= e ? e - w : 360 - w + e;
  if (width * (n - s) > FIRE_BBOX_MAX_AREA) return null;
  return { w, s, e, n, wraps: w > e };
}

/** Ohniská vo výreze, najsilnejšie prvé, najviac `max`. Pure. */
export function firesInBbox(fires, bbox, max = FIRE_BBOX_MAX) {
  const out = [];
  for (const f of Array.isArray(fires) ? fires : []) {
    if (!(f?.lat >= bbox.s && f.lat <= bbox.n)) continue;
    const inLon = bbox.wraps ? (f.lon >= bbox.w || f.lon <= bbox.e) : (f.lon >= bbox.w && f.lon <= bbox.e);
    if (inLon) out.push(f);
  }
  out.sort((a, b) => (b.frp || 0) - (a.frp || 0));
  return out.length > max ? out.slice(0, max) : out;
}
