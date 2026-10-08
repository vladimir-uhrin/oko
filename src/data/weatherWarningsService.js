// src/data/weatherWarningsService.js
// Server: výstrahy SHMÚ z MeteoAlarmu pre /api/weather-warnings (2026-10-08). Bez kľúča; jeden dopyt
// na MeteoAlarm najviac raz za 5 min bez ohľadu na počet návštevníkov (cache + spojenie súbežných
// dopytov), pri výpadku podržané staré dáta do 2 h s príznakom `stale`, timeout 15 s, strop 4 MB.
// Žiadny DOM; fetch a hodiny sa dajú podvrhnúť v testoch.

import { METEOALARM_SK_URL, normalizeMeteoalarm } from './weatherWarnings.js';

export const WARNINGS_FRESH_MS = 5 * 60_000;
export const WARNINGS_STALE_MS = 2 * 3600_000;
export const WARNINGS_TIMEOUT_MS = 15_000;
export const WARNINGS_MAX_BYTES = 4 * 1024 * 1024;
export const WARNINGS_ATTRIBUTION = 'Výstrahy: SHMÚ (CC BY 4.0) cez MeteoAlarm (EUMETNET, licencia ekvivalentná CC BY 4.0)';

export function createWeatherWarningsService({ fetchImpl = (...args) => fetch(...args), now = () => Date.now() } = {}) {
  let cached = null; // { payload, at }
  let inflight = null;
  let upstreamRequests = 0;

  async function fetchUpstream() {
    upstreamRequests += 1;
    const res = await fetchImpl(METEOALARM_SK_URL, {
      signal: AbortSignal.timeout(WARNINGS_TIMEOUT_MS),
      headers: { 'User-Agent': 'OKO (okolive.sk; cached 5 min)', Accept: 'application/json' },
    });
    if (!res?.ok) throw new Error(`MeteoAlarm HTTP ${res?.status}`);
    const body = await res.text();
    if (body.length > WARNINGS_MAX_BYTES) throw new Error('MeteoAlarm: oversized');
    const json = JSON.parse(body);
    if (!Array.isArray(json?.warnings)) throw new Error('MeteoAlarm: no warnings array');
    return {
      source: 'SHMÚ · MeteoAlarm',
      attribution: WARNINGS_ATTRIBUTION,
      fetchedAt: new Date(now()).toISOString(),
      warnings: normalizeMeteoalarm(json, now()),
    };
  }

  /** @returns {Promise<{status:number, payload?:object, cache?:string, error?:string}>} */
  async function get() {
    const age = cached ? now() - cached.at : Infinity;
    if (cached && age < WARNINGS_FRESH_MS) return { status: 200, payload: cached.payload, cache: 'HIT' };
    if (!inflight) {
      inflight = fetchUpstream().finally(() => { inflight = null; });
    }
    try {
      const payload = await inflight;
      cached = { payload, at: now() };
      return { status: 200, payload, cache: 'MISS' };
    } catch (error) {
      if (cached && age < WARNINGS_STALE_MS) return { status: 200, payload: { ...cached.payload, stale: true }, cache: 'STALE' };
      return { status: 502, error: String(error?.message || error) };
    }
  }

  return { get, stats: () => ({ upstreamRequests, cachedAt: cached ? new Date(cached.at).toISOString() : null }) };
}
