// src/data/operaRadarService.js
// Server: kruh posledných snímok radaru OPERA pre /api/opera/radar (2026-10-08). Tvar odpovede je ten istý
// ako pri radare SHMÚ (shmuRadar.js ju prehráva ako slučku), takže klient je spoločný.
//   - novú snímku hľadá najviac raz za 2 min, kandidáti = 10-min časy od „teraz − 10 min" dozadu,
//   - 404 (snímka ešte nie je) sa pamätá 5 min, aby sa ten istý súbor nepýtal stále,
//   - pri studenom štarte doplní kruh až do RING_SIZE snímok (~3,4 MB každá), potom 1 nová za 10 min,
//   - dekódovanie ide cez `decode` (na serveri vlákno operaRadarWorker.js), jedna obnova naraz.
// Žiadny DOM; fetch, dekódovanie, úložisko a hodiny sa dajú podvrhnúť v testoch.

import { operaCandidateTimes, operaFileUrl } from './operaRadar.js';

export const OPERA_RING_SIZE = 6;
export const OPERA_CHECK_EVERY_MS = 2 * 60_000;
export const OPERA_MISS_TTL_MS = 5 * 60_000;
export const OPERA_STALE_AFTER_MS = 45 * 60_000;
export const OPERA_ATTRIBUTION = 'EUMETNET OPERA radar composite (CC BY 4.0) via MeteoGate Open Radar Data';

/**
 * @param {{
 *   fetchBuffer: (url: string) => Promise<{status: number, buffer?: ArrayBuffer}>,
 *   decode: (buffer: ArrayBuffer) => Promise<{png: Buffer, bounds: object, echoPixels: number, iso?: string}>,
 *   store?: {load: () => Promise<Array<object>>, save: (frame: object, ring: Array<object>) => Promise<void>},
 *   now?: () => number,
 * }} deps
 */
export function createOperaRadarService({ fetchBuffer, decode, store = null, now = () => Date.now(), ringSize = OPERA_RING_SIZE }) {
  let frames = []; // { iso, png, bounds, echoPixels }, staré → nové
  let lastCheck = 0;
  let inflight = null;
  let loaded = false;
  const misses = new Map(); // iso → kedy 404
  let upstreamRequests = 0;
  let lastError = null;
  let frameWaiters = []; // čakajú na prvú snímku (studený štart odpovie hneď po nej, zvyšok kruhu sa doplní)
  const wakeWaiters = () => { const w = frameWaiters; frameWaiters = []; for (const fn of w) fn(true); };

  async function loadStore() {
    if (loaded || !store) { loaded = true; return; }
    loaded = true;
    try {
      const saved = await store.load();
      if (Array.isArray(saved)) frames = saved.filter((f) => f?.iso && f?.png).sort((a, b) => a.iso.localeCompare(b.iso)).slice(-ringSize);
    } catch { /* prázdny disk */ }
  }

  async function refresh() {
    await loadStore();
    lastCheck = now();
    const have = new Set(frames.map((f) => f.iso));
    const candidates = operaCandidateTimes(now(), ringSize + 2).map((ms) => operaFileUrl(ms));
    // Najnovšia chýbajúca prvá; studený štart doplní kruh smerom dozadu.
    const wanted = frames.length ? candidates.filter((c) => c.iso > (frames.at(-1)?.iso || '')) : candidates;
    for (const c of wanted) {
      if (have.has(c.iso)) continue;
      const missAt = misses.get(c.iso);
      if (missAt && now() - missAt < OPERA_MISS_TTL_MS) continue;
      upstreamRequests += 1;
      const res = await fetchBuffer(c.url);
      if (res.status === 404 || res.status === 403) { misses.set(c.iso, now()); continue; }
      if (res.status !== 200 || !res.buffer) throw new Error(`OPERA HTTP ${res.status}`);
      const frame = await decode(res.buffer);
      const entry = { iso: c.iso, png: frame.png, bounds: frame.bounds, echoPixels: frame.echoPixels };
      frames = [...frames.filter((f) => f.iso !== c.iso), entry].sort((a, b) => a.iso.localeCompare(b.iso)).slice(-ringSize);
      have.add(c.iso);
      wakeWaiters();
      try { await store?.save(entry, frames); } catch { /* disk je bonus */ }
      if (frames.length >= ringSize) break;
    }
    for (const [iso, at] of misses) if (now() - at > OPERA_MISS_TTL_MS * 4) misses.delete(iso);
  }

  async function ensureFresh() {
    if (inflight) return inflight;
    if (loaded && now() - lastCheck < OPERA_CHECK_EVERY_MS) return undefined;
    inflight = refresh().finally(wakeWaiters).then(() => { lastError = null; }, (error) => { lastError = String(error?.message || error); }).finally(() => { inflight = null; });
    return inflight;
  }

  const frameUrl = (iso) => `/api/opera/radar/frame/${encodeURIComponent(iso)}.png`;

  return {
    ensureFresh,
    hasFrames: () => frames.length > 0,
    /** Studený štart: vyrieši sa hneď po prvej snímke (alebo po skončení obnovy, ak žiadna nepríde). */
    whenAnyFrame() {
      if (frames.length) return Promise.resolve(true);
      const pending = new Promise((resolve) => frameWaiters.push(resolve));
      // Čakanie sa skončí najneskôr s obnovou, na ktorú sa naviazalo — aj keď práve dobieha alebo sa
      // nespustila (nedávno sa pýtalo a nič nebolo); inak by požiadavka visela naveky (odhalil test).
      Promise.resolve(ensureFresh()).finally(wakeWaiters);
      return pending;
    },
    /** Meta v tvare radaru SHMÚ; null, keď nie je ani jedna snímka. */
    meta() {
      const latest = frames.at(-1);
      if (!latest) return null;
      return {
        ok: true,
        product: 'OPERA DBZH',
        iso: latest.iso,
        bounds: latest.bounds,
        echoPixels: latest.echoPixels,
        stale: now() - Date.parse(latest.iso) > OPERA_STALE_AFTER_MS,
        png: frameUrl(latest.iso),
        attribution: OPERA_ATTRIBUTION,
        frames: frames.map((f) => ({ iso: f.iso, echoPixels: f.echoPixels, png: frameUrl(f.iso) })),
      };
    },
    frame(iso) { return frames.find((f) => f.iso === iso) || null; },
    stats: () => ({ frames: frames.length, upstreamRequests, lastError, misses: misses.size }),
  };
}
