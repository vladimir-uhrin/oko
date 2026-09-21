// src/data/meteoRasterize.js
// Meteorológia sveta — NetCDF-3 → RGBA raster pre PNG „slice" (2026-09-17).
// Vyťažené z closure meteoProxy vo vite.config.js, aby tú istú kvantizáciu
// zdieľala proxy aj scripts/meteo-bake.mjs (offline pečenie do cache).
// Čistý JS, žiadny DOM, žiadne Cesium, žiadny sharp — len Buffer a pole.
//
// Výstup: { data: Buffer (RGBA), width, height } so stĺpcom 0 = −180°
// (Cesium obdĺžnik), riadok 0 = sever. Vietor: R = u, G = v, B = rýchlosť;
// skalárne polia: R = G = B = kvantizovaná hodnota po field.convert.

import { METEO_FIELDS, WIND_COMPONENT_RANGE, WIND_SPEED_RANGE, quantize } from './meteoField.js';
import { gridOf } from './netcdf3.js';

/**
 * Beh modelu z reftime („Hour since 2026-09-01T00:00:00Z"). Pure.
 * @param {ReturnType<import('./netcdf3.js').parseNetcdf3>} nc
 * @returns {string|null} ISO čas behu (UTC)
 */
export function runIsoOf(nc) {
  const v = nc.vars.reftime || nc.vars.time;
  if (!v) return null;
  const m = String(v.attrs?.units || '').match(/since\s+(\S+)/i);
  const base = m ? Date.parse(m[1]) : NaN;
  const hours = Number(nc.read(v.name)[0]);
  if (!Number.isFinite(base) || !Number.isFinite(hours)) return null;
  const unit = /^hour/i.test(String(v.attrs.units)) ? 3600_000 : (/^minute/i.test(String(v.attrs.units)) ? 60_000 : 1000);
  return new Date(base + hours * unit).toISOString();
}

/**
 * NetCDF → RGBA raster so stĺpcom 0 = −180°. Pure (vracia nový Buffer).
 * @param {string} fieldId kľúč z METEO_FIELDS ('wind' | 'temp' | ...)
 * @param {ReturnType<import('./netcdf3.js').parseNetcdf3>} nc
 * @returns {{data: Buffer, width: number, height: number}}
 */
export function rasterizeMeteoField(fieldId, nc) {
  const field = METEO_FIELDS[fieldId];
  if (!field) throw new Error(`meteoRasterize: neznáme pole ${fieldId}`);
  const grids = field.vars.map((name) => gridOf(nc, name));
  const { rows, cols, lat, lon } = grids[0];
  const northUp = lat[0] > lat[lat.length - 1];
  // Posun stĺpcov: nájdi stĺpec s lon ≥ 180 (alebo −180) a otoč polovice.
  let shift = 0;
  for (let c = 0; c < cols; c += 1) { if (lon[c] >= 180 || (lon[c] < 0 && c === 0)) { shift = c; break; } }
  if (lon[0] < 0) shift = 0; // NCSS už vrátil −180..180
  const out = Buffer.alloc(rows * cols * 4);
  for (let r = 0; r < rows; r += 1) {
    const srcRow = northUp ? r : rows - 1 - r;
    for (let c = 0; c < cols; c += 1) {
      const srcCol = (c + shift) % cols;
      const i = srcRow * cols + srcCol;
      const o = (r * cols + c) * 4;
      if (fieldId === 'wind') {
        const u = grids[0].values[i];
        const v = grids[1].values[i];
        out[o] = quantize(u, WIND_COMPONENT_RANGE);
        out[o + 1] = quantize(v, WIND_COMPONENT_RANGE);
        out[o + 2] = quantize(Math.hypot(u, v), WIND_SPEED_RANGE);
      } else {
        // Skalárne pole: prevod jednotiek podľa field.convert (K → °C, Pa → hPa,
        // kg/m²/s → mm/h) a kvantizácia do field.decode; R = G = B.
        const value = grids[0].values[i] * field.convert.scale + field.convert.offset;
        const q = quantize(value, field.decode);
        out[o] = q; out[o + 1] = q; out[o + 2] = q;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: cols, height: rows };
}
