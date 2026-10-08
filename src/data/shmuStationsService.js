// src/data/shmuStationsService.js
// Server: posledné merania automatických staníc SHMÚ pre /api/shmu-stations (2026-10-08). Bez kľúča (CC BY 4.0).
// Na SHMÚ najviac 2 dopyty za 5 min bez ohľadu na počet návštevníkov (výpis priečinka + najnovší súbor,
// ~380 kB), spojenie súbežných dopytov, pri výpadku staré dáta do 1 h so `stale`, strop 4 MB.
// Mená a polohy staníc: public/meteo-stations/shmu-aws.json (scripts/build-shmu-stations.mjs).
// Žiadny DOM; fetchText a hodiny sa dajú podvrhnúť v testoch.

import { SHMU_AWS_BASE, folderDate, joinStations, latestAwsFile, reduceAwsRecords } from './shmuStations.js';

export const STATIONS_FRESH_MS = 5 * 60_000;
export const STATIONS_STALE_MS = 3600_000;
export const STATIONS_ATTRIBUTION = 'Merania: SHMÚ — opendata.shmu.sk (CC BY 4.0); polohy WMO OSCAR / GeoNames';

/**
 * @param {{fetchText: (url: string) => Promise<string>, meta: object|(() => object), now?: () => number}} deps
 */
export function createShmuStationsService({ fetchText, meta, now = () => Date.now() }) {
  let cached = null; // { payload, at }
  let inflight = null;
  let upstreamRequests = 0;

  async function latestFileUrl() {
    // Priečinok je podľa miestneho dátumu; tesne po polnoci ešte nemusí mať súbor — vtedy včerajší.
    for (const t of [now(), now() - 86_400_000]) {
      const day = folderDate(t);
      upstreamRequests += 1;
      const listing = await fetchText(`${SHMU_AWS_BASE}/${day}/`);
      const file = latestAwsFile(listing);
      if (file) return `${SHMU_AWS_BASE}/${day}/${encodeURIComponent(file)}`;
    }
    throw new Error('SHMÚ: žiadny súbor aws1min');
  }

  async function fetchUpstream() {
    const url = await latestFileUrl();
    upstreamRequests += 1;
    const json = JSON.parse(await fetchText(url));
    const m = reduceAwsRecords(json);
    if (!m.size) throw new Error('SHMÚ: prázdne merania');
    const stations = joinStations(m, typeof meta === 'function' ? meta() : meta);
    const observedAt = Math.max(...stations.map((s) => s.at).filter(Number.isFinite));
    return {
      source: 'SHMÚ',
      attribution: STATIONS_ATTRIBUTION,
      fetchedAt: new Date(now()).toISOString(),
      observedAt: Number.isFinite(observedAt) ? new Date(observedAt).toISOString() : null,
      stations,
    };
  }

  /** @returns {Promise<{status:number, payload?:object, cache?:string, error?:string}>} */
  async function get() {
    const age = cached ? now() - cached.at : Infinity;
    if (cached && age < STATIONS_FRESH_MS) return { status: 200, payload: cached.payload, cache: 'HIT' };
    if (!inflight) inflight = fetchUpstream().finally(() => { inflight = null; });
    try {
      const payload = await inflight;
      cached = { payload, at: now() };
      return { status: 200, payload, cache: 'MISS' };
    } catch (error) {
      if (cached && age < STATIONS_STALE_MS) return { status: 200, payload: { ...cached.payload, stale: true }, cache: 'STALE' };
      return { status: 502, error: String(error?.message || error) };
    }
  }

  return { get, stats: () => ({ upstreamRequests, cachedAt: cached ? new Date(cached.at).toISOString() : null }) };
}
