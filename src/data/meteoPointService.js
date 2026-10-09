// src/data/meteoPointService.js
// Server: predpoveď pre bod z Open-Meteo (modely GFS a od 2026-10-09 aj ECMWF IFS v tom istom dopyte) pre /api/meteo/point (2026-10-08, meteogram
// „ako Windy"). Bez kľúča a zadarmo; aj tak cache, spájanie súbežných dopytov a strop:
//   - bunka 0,1° (meteogram.js), čerstvé 30 min (GFS beží každých 6 h), staré podržané do 6 h,
//   - najviac UPSTREAM_PER_HOUR dopytov na Open-Meteo za hodinu z celej aplikácie
//     (bezplatný limit Open-Meteo je 5 000/h a 10 000/deň — držíme sa hlboko pod ním),
//   - timeout 10 s, strop odpovede 1 MB.
// Žiadny DOM; fetch a hodiny sa dajú podvrhnúť v testoch.

import { meteogramCell, normalizeOpenMeteoModels, openMeteoPointUrl } from './meteogram.js';

export const METEO_POINT_FRESH_MS = 30 * 60_000;
export const METEO_POINT_STALE_MS = 6 * 3600_000;
export const METEO_POINT_MAX_CACHE = 400;
export const METEO_POINT_UPSTREAM_PER_HOUR = 600;
export const METEO_POINT_TIMEOUT_MS = 10_000;
export const METEO_POINT_MAX_BYTES = 1024 * 1024;

export function createMeteoPointService({
  fetchImpl = (...args) => fetch(...args),
  now = () => Date.now(),
  upstreamPerHour = METEO_POINT_UPSTREAM_PER_HOUR,
} = {}) {
  const cache = new Map(); // key → { payload, at }
  const inflight = new Map(); // key → Promise
  let windowStart = 0;
  let windowCount = 0;
  let upstreamRequests = 0;

  function budgetOk() {
    const t = now();
    if (t - windowStart >= 3600_000) { windowStart = t; windowCount = 0; }
    return windowCount < upstreamPerHour;
  }

  function remember(key, payload) {
    cache.delete(key);
    cache.set(key, { payload, at: now() });
    while (cache.size > METEO_POINT_MAX_CACHE) cache.delete(cache.keys().next().value);
  }

  async function fetchUpstream(cell) {
    windowCount += 1;
    upstreamRequests += 1;
    const res = await fetchImpl(openMeteoPointUrl(cell), {
      signal: AbortSignal.timeout(METEO_POINT_TIMEOUT_MS),
      headers: { 'User-Agent': 'OKO (okolive.sk; cached 30 min)' },
    });
    if (!res?.ok) throw new Error(`Open-Meteo HTTP ${res?.status}`);
    const text = await res.text();
    if (text.length > METEO_POINT_MAX_BYTES) throw new Error('Open-Meteo: oversized');
    const models = normalizeOpenMeteoModels(JSON.parse(text));
    if (!models) throw new Error('Open-Meteo: no hourly data');
    // Vrch odpovede = prvý dostupný model (GFS) ako doteraz — starší klient číta rady priamo; nový berie `models`.
    const first = models.gfs || Object.values(models)[0];
    return {
      source: 'Open-Meteo',
      attribution: 'Weather data by Open-Meteo.com (CC BY 4.0) · NOAA/NCEP GFS · ECMWF IFS open data (CC BY 4.0)',
      retrievedAt: new Date(now()).toISOString(),
      ...first,
      models,
    };
  }

  /**
   * @returns {Promise<{status:number, payload?:object, cache?:string, error?:string}>}
   */
  async function get(lat, lon) {
    const cell = meteogramCell(lat, lon);
    if (!cell) return { status: 400, error: 'valid lat and lon are required' };
    const hit = cache.get(cell.key);
    const age = hit ? now() - hit.at : Infinity;
    if (hit && age < METEO_POINT_FRESH_MS) return { status: 200, payload: hit.payload, cache: 'HIT' };
    if (inflight.has(cell.key)) {
      try { return { status: 200, payload: await inflight.get(cell.key), cache: 'INFLIGHT' }; } catch { /* nižšie */ }
    }
    if (!budgetOk()) {
      if (hit && age < METEO_POINT_STALE_MS) return { status: 200, payload: { ...hit.payload, stale: true }, cache: 'STALE' };
      return { status: 429, error: 'meteo point: hourly upstream budget exhausted' };
    }
    const job = fetchUpstream(cell);
    inflight.set(cell.key, job);
    try {
      const payload = await job;
      remember(cell.key, payload);
      return { status: 200, payload, cache: 'MISS' };
    } catch (error) {
      if (hit && age < METEO_POINT_STALE_MS) return { status: 200, payload: { ...hit.payload, stale: true }, cache: 'STALE' };
      return { status: 502, error: String(error?.message || error) };
    } finally {
      inflight.delete(cell.key);
    }
  }

  return {
    get,
    stats: () => ({ cached: cache.size, upstreamRequests, windowCount, upstreamPerHour }),
  };
}
