// src/data/windAloft.js — vietor vo výške letu pre odhadovanú polohu (2026-10-05).
//
// Vlastník vybral z návrhov „vietor vo výške letu". Posledná nameraná rýchlosť lietadla je rýchlosť
// NAD ZEMOU — obsahuje vietor v mieste, kde signál zmizol. Ďalej nad oceánom fúka iný vietor
// (dýzový prúd tlačí lietadlá na východ o 100–200 km/h). Preto: pravá rýchlosť voči vzduchu =
// rýchlosť nad zemou − zložka vetra v smere letu v mieste fixu; ďalej sa letí touto rýchlosťou
// + priemerný vietor na trase pred lietadlom. Vietor = model GFS 0,25° (NOAA, voľné dielo) z
// meteo proxy OKO — predpoveď, nie meranie; preto sa výsledok drží v rozumných medziach.

import { pointAlongPath, pathLengthKm } from './flightPath.js';
import { levelForAltitude, windRelativeToTrack } from './flightWind.js';
import { METEO_FIELDS, forecastSteps, nearestStepIndex } from './meteoField.js';
import { decodeChannel } from './meteoIsolines.js';
import { sampleGrid } from './meteoPlaces.js';

/** Pravá rýchlosť dopravného lietadla v cestovnej hladine (m/s) — mimo = nespoľahlivý fix. */
export const TAS_MIN_MPS = 110;
export const TAS_MAX_MPS = 320;

/**
 * Efektívna rýchlosť nad zemou pre odhad (pure).
 * @param {{lat:number, lon:number, gsMps:number, trkDeg:number}} fix
 * @param {{lat:number, lon:number}[]} points trasa odhadu
 * @param {(lat:number, lon:number) => {u:number, v:number}|null} sampleUV vietor v hladine letu
 * @returns {{gsEffMps:number, tasMps:number, windHereMps:number, windAheadMps:number}|null}
 */
export function effectiveGroundSpeed(fix, points, sampleUV, { horizonKm = 3000, stepKm = 200 } = {}) {
  if (!fix || !Array.isArray(points) || points.length < 2 || typeof sampleUV !== 'function') return null;
  const here = sampleUV(fix.lat, fix.lon);
  if (!here || !Number.isFinite(here.u) || !Number.isFinite(here.v)) return null;
  const windHereMps = windRelativeToTrack(here.u, here.v, fix.trkDeg).headMps;
  if (!Number.isFinite(windHereMps)) return null;
  const tasMps = fix.gsMps - windHereMps;
  if (!(tasMps >= TAS_MIN_MPS && tasMps <= TAS_MAX_MPS)) return null;
  const lengthKm = Math.min(horizonKm, pathLengthKm(points));
  let sum = 0;
  let n = 0;
  for (let km = stepKm / 2; km < lengthKm; km += stepKm) {
    const at = pointAlongPath(points, km);
    const uv = sampleUV(at.lat, at.lon);
    if (!uv || !Number.isFinite(uv.u)) continue;
    const head = windRelativeToTrack(uv.u, uv.v, at.trackDeg).headMps;
    if (Number.isFinite(head)) { sum += head; n += 1; }
  }
  if (!n) return null;
  const windAheadMps = sum / n;
  // Model nie je meranie: odhad nesmie ujsť o viac než polovicu poslednej rýchlosti.
  const gsEffMps = Math.max(fix.gsMps * 0.6, Math.min(fix.gsMps * 1.5, tasMps + windAheadMps));
  return { gsEffMps, tasMps, windHereMps, windAheadMps };
}

/**
 * Cache dekódovaných mriežok vetra pre server (u, v pre hladinu a krok predpovede).
 * @param {{getSlice: (fieldId: string, iso: string) => Promise<{png: Buffer}>, decodePng: (png: Buffer) => Promise<{data: Uint8Array, width: number, height: number}>, now?: () => number, ttlMs?: number}} deps
 */
export function createWindGridCache({ getSlice, decodePng, now = () => Date.now(), ttlMs = 3600_000 }) {
  const grids = new Map(); // `${levelId}|${iso}` → { u, v, at }
  const loading = new Set();

  function currentIso() {
    const steps = forecastSteps(now());
    return steps[nearestStepIndex(steps, now())];
  }

  async function load(levelId, iso) {
    const key = `${levelId}|${iso}`;
    if (loading.has(key)) return;
    loading.add(key);
    try {
      const { png } = await getSlice(levelId, iso);
      const { data, width, height } = await decodePng(png);
      const range = METEO_FIELDS[levelId]?.componentRange;
      if (!range) return;
      grids.set(key, {
        u: { values: decodeChannel(data, 0, range), cols: width, rows: height },
        v: { values: decodeChannel(data, 1, range), cols: width, rows: height },
        at: now(),
      });
      // Staré kroky preč (každá mriežka ~8 MB).
      for (const [k, g] of grids) if (now() - g.at > 3 * ttlMs) grids.delete(k);
    } catch {
      /* bez vetra: odhad poletí poslednou rýchlosťou */
    } finally {
      loading.delete(key);
    }
  }

  return {
    /** Synchrónny vzorkovač pre výšku letu; null, kým mriežka nie je načítaná (načítanie sa spustí). */
    samplerFor(altitudeM) {
      const level = levelForAltitude(altitudeM);
      if (!level || !METEO_FIELDS[level.id]?.componentRange) return null;
      const iso = currentIso();
      const grid = grids.get(`${level.id}|${iso}`);
      if (!grid || now() - grid.at > ttlMs) void load(level.id, iso);
      if (!grid) return null;
      return (lat, lon) => {
        const u = sampleGrid(grid.u, lat, lon);
        const v = sampleGrid(grid.v, lat, lon);
        return Number.isFinite(u) && Number.isFinite(v) ? { u, v } : null;
      };
    },
    status() {
      return { grids: [...grids.keys()] };
    },
  };
}
