// src/data/operaRadar.js
// Zrážkový radar celej Európy — kompozit EUMETNET OPERA (2026-10-08, sekcia POČASIE). Čisté pomôcky bez DOM
// a Cesia (server aj worker): adresa súboru, projekcia LAEA z `where/projdef`, prepočet mriežky do zemepisnej
// (lon/lat) mriežky pre obdĺžnik na glóbuse, farbenie dBZ rovnakou paletou ako radar SHMÚ.
//
// Zdroj: verejné úložisko MeteoGate / Open Radar Data, bez kľúča, CC BY 4.0 (licencia je priamo v súbore):
//   https://s3.waw3-1.cloudferro.com/openradar-24h/YYYY/MM/DD/OPERA/COMP/OPERA@YYYYMMDDTHHMM@0@DBZH.h5
// ODIM HDF5, „OPERA CIRRUS maximum reflectivity composite", 3800 × 4400 px po 1 km, každých 10 min (overené
// 2026-10-08: posledný súbor ~15 min za reálnym časom, ~3,4 MB).

import { dbzColor, ZMAX_MIN_DISPLAY_DBZ } from './shmuRadarGrid.js';

export const OPERA_BASE = 'https://s3.waw3-1.cloudferro.com/openradar-24h';
export const OPERA_STEP_MIN = 10;
/** Výstupná zemepisná mriežka (stupne/px): ~2,5 km — prehľad Európy; detail SR dáva radar SHMÚ. */
export const OPERA_OUT_DEG = 0.025;

/** Adresa súboru kompozitu pre čas (UTC, zaokrúhlený nadol na 10 min). Pure. */
export function operaFileUrl(ms, quantity = 'DBZH') {
  const step = OPERA_STEP_MIN * 60_000;
  const d = new Date(Math.floor(ms / step) * step);
  const p = (n) => String(n).padStart(2, '0');
  const y = d.getUTCFullYear();
  const mo = p(d.getUTCMonth() + 1);
  const da = p(d.getUTCDate());
  const stamp = `${y}${mo}${da}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
  return { url: `${OPERA_BASE}/${y}/${mo}/${da}/OPERA/COMP/OPERA@${stamp}@0@${quantity}.h5`, iso: d.toISOString() };
}

/** Kandidátske časy od najnovšieho dozadu (oneskorenie zdroja ~15 min). Pure. */
export function operaCandidateTimes(nowMs, count = 8, minLagMin = 10) {
  const step = OPERA_STEP_MIN * 60_000;
  const newest = Math.floor((nowMs - minLagMin * 60_000) / step) * step;
  return Array.from({ length: count }, (_, i) => newest - i * step);
}

/** `+proj=laea +lat_0=55.0 +lon_0=10.0 +x_0=… +y_0=… +ellps=WGS84` → čísla. Pure. */
export function parseLaeaProjdef(text) {
  const get = (k) => { const m = new RegExp(`\\+${k}=([-0-9.eE+]+)`).exec(String(text || '')); return m ? Number(m[1]) : NaN; };
  if (!/\+proj=laea/.test(String(text || ''))) return null;
  const p = { lat0: get('lat_0'), lon0: get('lon_0'), x0: get('x_0') || 0, y0: get('y_0') || 0 };
  return Number.isFinite(p.lat0) && Number.isFinite(p.lon0) ? p : null;
}

const A = 6378137;
const F = 1 / 298.257223563;
const E2 = 2 * F - F * F;
const E = Math.sqrt(E2);
const RAD = Math.PI / 180;

function qOf(sinPhi) {
  return (1 - E2) * (sinPhi / (1 - E2 * sinPhi * sinPhi) - (1 / (2 * E)) * Math.log((1 - E * sinPhi) / (1 + E * sinPhi)));
}

/**
 * Lambertova azimutálna rovnoplošná projekcia na elipsoide WGS84 (Snyder 1987, šikmá poloha) —
 * vracia funkciu (lat, lon) → [x, y] v metroch vrátane x_0 / y_0. Pure.
 */
export function laeaForward({ lat0, lon0, x0 = 0, y0 = 0 }) {
  const qp = qOf(1);
  const Rq = A * Math.sqrt(qp / 2);
  const sin1 = Math.sin(lat0 * RAD);
  const beta1 = Math.asin(qOf(sin1) / qp);
  const m1 = Math.cos(lat0 * RAD) / Math.sqrt(1 - E2 * sin1 * sin1);
  const D = (A * m1) / (Rq * Math.cos(beta1));
  const sb1 = Math.sin(beta1);
  const cb1 = Math.cos(beta1);
  return (lat, lon) => {
    const beta = Math.asin(qOf(Math.sin(lat * RAD)) / qp);
    const dl = (lon - lon0) * RAD;
    const sb = Math.sin(beta);
    const cb = Math.cos(beta);
    const B = Rq * Math.sqrt(2 / (1 + sb1 * sb + cb1 * cb * Math.cos(dl)));
    return [B * D * cb * Math.sin(dl) + x0, (B / D) * (cb1 * sb - sb1 * cb * Math.cos(dl)) + y0];
  };
}

/**
 * Geometria mriežky z `where`: projekcia + ľavý dolný roh v metroch. Pure.
 * @returns {{forward: Function, xll: number, yll: number, xsize: number, ysize: number, xscale: number, yscale: number}|null}
 */
export function operaGrid(where) {
  const proj = parseLaeaProjdef(where?.projdef);
  if (!proj) return null;
  const forward = laeaForward(proj);
  const [xll, yll] = forward(where.LL_lat, where.LL_lon);
  return { forward, xll, yll, xsize: where.xsize, ysize: where.ysize, xscale: where.xscale, yscale: where.yscale };
}

/** Zemepisný obdĺžnik pokrytia (z rohov, zaokrúhlený von na celé stupne). Pure. */
export function operaBounds(where) {
  const lons = [where.LL_lon, where.UL_lon, where.UR_lon, where.LR_lon];
  const lats = [where.LL_lat, where.UL_lat, where.UR_lat, where.LR_lat];
  // Horný okraj LAEA sa v strede vydúva na sever nad rohy — rezerva 6°.
  return { west: Math.floor(Math.min(...lons)), east: Math.ceil(Math.max(...lons)), south: Math.floor(Math.min(...lats)), north: Math.min(85, Math.ceil(Math.max(...lats)) + 6) };
}

/**
 * Prepočet kompozitu do zemepisnej mriežky (riadok 0 = sever) a farbenie dBZ: každý výstupný bod vezme
 * MAXIMUM zo zdrojových bodov okolo (±radius), aby sa malé búrkové bunky pri zmenšení nestratili.
 * nodata / undetect / slabé ozveny sú priehľadné. Pure.
 * @param {Float64Array|number[]} values riadky zhora (ODIM), stĺpce zľava
 */
export function reprojectOpera(values, where, dataWhat, { deg = OPERA_OUT_DEG, radius = 1, minDisplayDbz = ZMAX_MIN_DISPLAY_DBZ } = {}) {
  const g = operaGrid(where);
  if (!g) throw new Error('OPERA: neznáma projekcia');
  const bounds = operaBounds(where);
  const width = Math.round((bounds.east - bounds.west) / deg);
  const height = Math.round((bounds.north - bounds.south) / deg);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const gain = Number(dataWhat?.gain ?? 1);
  const offset = Number(dataWhat?.offset ?? 0);
  const nodata = Number(dataWhat?.nodata);
  const undetect = Number(dataWhat?.undetect);
  const top = g.yll + g.ysize * g.yscale;
  let echoPixels = 0;
  for (let r = 0; r < height; r += 1) {
    const lat = bounds.north - (r + 0.5) * deg;
    for (let c = 0; c < width; c += 1) {
      const lon = bounds.west + (c + 0.5) * deg;
      const [x, y] = g.forward(lat, lon);
      const col = Math.floor((x - g.xll) / g.xscale);
      const row = Math.floor((top - y) / g.yscale);
      if (col < 0 || row < 0 || col >= g.xsize || row >= g.ysize) continue;
      let best = -Infinity;
      for (let dr = -radius; dr <= radius; dr += 1) {
        const rr = row + dr;
        if (rr < 0 || rr >= g.ysize) continue;
        for (let dc = -radius; dc <= radius; dc += 1) {
          const cc = col + dc;
          if (cc < 0 || cc >= g.xsize) continue;
          const raw = values[rr * g.xsize + cc];
          if (raw === nodata || raw === undetect || !Number.isFinite(raw)) continue;
          const dbz = raw * gain + offset;
          if (dbz > best) best = dbz;
        }
      }
      if (best === -Infinity) continue;
      const color = dbzColor(best, minDisplayDbz);
      if (!color) continue;
      const o = (r * width + c) * 4;
      rgba[o] = color[0]; rgba[o + 1] = color[1]; rgba[o + 2] = color[2]; rgba[o + 3] = color[3];
      echoPixels += 1;
    }
  }
  return { rgba, width, height, bounds, echoPixels };
}
