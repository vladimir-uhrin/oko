// src/data/shipServer/supplements.js
/**
 * @module shipServer/supplements
 * @description Zdroje polôh lodí navyše — serverové slučky (2026-10-11, presunuté z vite.config.js):
 * OpenSeaFeed, Open Waters AIS (aiscast) a oceán z dlaždíc registra, zlúčené do úložiska živých
 * lodí podľa MMSI (parsery a zlúčenie: aisSupplementFeeds.js). Bežia len v službe.
 * AIS_SUPPLEMENTS=off ich vypne celé, AIS_SUPPLEMENT_OCEAN=off len oceán.
 *
 * Interval podľa návštevníkov (bod 5): s divákom plný takt, bez diváka (10 min bez požiadavky
 * z iného než loopback) redšie — OpenSeaFeed 4,7 MB každé 3 min = 2,3 GB/deň, bez návštevníkov
 * raz za 15 min. História lodí sa zapisuje ďalej, len redšie.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  AISCAST_WINDOWS, buildNameIndex, createShipIdResolver, isLoopbackAddress, matchTileRowByName, mergeSupplementRow,
  mtTileRowToVessel, oceanPseudoId, oceanTiles, parseAiscastVessels, parseMtTileRows, parseOpenSeaFeedSnapshot,
} from '../aisSupplementFeeds.js';
import { curlGet, parseMtGeneral } from '../vesselTrackSources.js';

/** Takty: [s návštevníkom, bez návštevníka] (ms). */
export const SUPPLEMENT_INTERVALS = Object.freeze({
  openseafeed: [3 * 60_000, 15 * 60_000],
  aiscast: [20_000, 2 * 60_000],
  ocean: [20_000, 90_000],
  resolve: [10_000, 30_000],
});
export const AIS_VISITOR_RECENT_MS = 10 * 60_000;
const TICK_MS = 5_000;
const UA = 'OKO (okolive.sk)';

/** Požiadavka z tohto počítača (loopback, bez hlavičky Cloudflare) — nie návštevník. Pure. */
export function isLoopbackRequest(req) {
  if (typeof req?.headers?.['cf-connecting-ip'] === 'string' && req.headers['cf-connecting-ip'].trim()) return false;
  return isLoopbackAddress(req?.socket?.remoteAddress);
}

/**
 * @param {object} o
 * @param {string} o.rootDir
 * @param {object} [o.env]
 * @param {Map<string, object>} o.vessels úložisko živých lodí (_aisStreamVessels)
 * @param {Map<string, object>} o.tracks stopy (_aisStreamTracks)
 * @param {(mmsi: string, lat: number, lon: number, epochSec: number) => void} o.appendTrack
 * @param {(mmsi: string, lat: number, lon: number, epochSec: number, speed: number|null, course: number|null) => void} [o.record] história
 * @param {number} o.cacheMax strop úložiska
 */
export function createAisSupplements({ rootDir, env = process.env, vessels, tracks, appendTrack, record = () => {}, cacheMax,
  fetchImpl = (...a) => fetch(...a), curl = curlGet, now = Date.now, setIntervalImpl = setInterval }) {
  const stats = { openseafeed: { at: 0, rows: 0, merged: 0, error: null }, aiscast: { at: 0, rows: 0, merged: 0, error: null }, ocean: { at: 0, rows: 0, merged: 0, unresolved: 0, error: null } };
  let timers = null;
  let lastVisitorAt = 0;
  let resolver = null;
  const visitorsRecent = () => now() - lastVisitorAt < AIS_VISITOR_RECENT_MS;
  const oceanOff = () => String(env.AIS_SUPPLEMENT_OCEAN || '').toLowerCase() === 'off';

  /** Zlúči riadky zo zdrojov navyše do úložiska; vráti počet prijatých. */
  function applyRows(rows) {
    const t = now();
    let merged = 0;
    for (const row of rows) {
      const existing = vessels.get(row.mmsi);
      if (!existing && vessels.size >= cacheMax) continue;
      const next = mergeSupplementRow(existing, row, t);
      if (!next) continue;
      vessels.set(row.mmsi, next);
      appendTrack(row.mmsi, next.lat, next.lon, next.last_position_epoch);
      record(row.mmsi, next.lat, next.lon, next.last_position_epoch, next.speed, next.course);
      merged += 1;
    }
    return merged;
  }

  function every(key, fn) {
    const [activeMs, idleMs] = SUPPLEMENT_INTERVALS[key];
    let last = 0;
    const id = setIntervalImpl(() => {
      const gap = visitorsRecent() ? activeMs : idleMs;
      if (now() - last < gap) return;
      last = now();
      void fn();
    }, TICK_MS);
    id.unref?.();
    timers.push(id);
  }

  function start() {
    if (timers || String(env.AIS_SUPPLEMENTS || '').toLowerCase() === 'off') return;
    timers = [];
    // OpenSeaFeed: celosvetová snímka (~4,7 MB gzip), CC BY 4.0.
    every('openseafeed', async () => {
      const st = stats.openseafeed;
      try {
        const res = await fetchImpl('https://api.openseafeed.com/v1/snapshot', { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = parseOpenSeaFeedSnapshot(await res.json());
        Object.assign(st, { at: now(), rows: rows.length, merged: applyRows(rows), error: null });
      } catch (error) { st.error = String(error?.message || error); }
    });
    // Open Waters AIS: jedno okno naraz dookola (anonymne 2 spojenia na IP).
    let windowIdx = 0;
    every('aiscast', async () => {
      const st = stats.aiscast;
      const [s, w, n, e] = AISCAST_WINDOWS[windowIdx % AISCAST_WINDOWS.length];
      windowIdx += 1;
      try {
        const res = await fetchImpl(`https://ais.openwaters.io/v1/vessels?bbox=${s},${w},${n},${e}`, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = parseAiscastVessels(await res.json());
        Object.assign(st, { at: now(), rows: rows.length, merged: st.merged + applyRows(rows), error: null });
      } catch (error) { st.error = String(error?.message || error); }
    });
    if (oceanOff()) return;
    // Oceán: dlaždice registra pri malom priblížení + preklad ID → MMSI (cache 30 dní na disku).
    const mtDir = path.join(rootDir, '.gev-cache', 'vessel-info', 'mt');
    const saveId = (shipId, entry) => { try { fs.mkdirSync(mtDir, { recursive: true }); fs.writeFileSync(path.join(mtDir, `ship-${shipId}.json`), JSON.stringify(entry)); } catch { /* */ } };
    resolver = createShipIdResolver({
      resolveOne: async (shipId) => {
        const file = path.join(mtDir, `ship-${shipId}.json`);
        try {
          const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
          if (now() - cached.at < 30 * 86400_000) return { mmsi: cached.mmsi || cached.ship?.mmsi || null, name: cached.name || cached.ship?.name || null };
        } catch { /* bez cache */ }
        const info = parseMtGeneral(JSON.parse(await curl(`https://www.marinetraffic.com/en/vessels/${shipId}/general`)));
        const entry = { at: now(), mmsi: info.mmsi, name: info.name };
        saveId(shipId, entry);
        // To isté ID poslúži karte lode (vesselInfoProxy si ušetrí hľadanie).
        if (info.mmsi) { try { fs.writeFileSync(path.join(mtDir, `${info.mmsi}.id.json`), JSON.stringify({ at: now(), shipId })); } catch { /* */ } }
        return entry;
      },
    });
    // Pri štarte načítaj už preložené ID z disku (bez siete).
    try {
      for (const name of fs.readdirSync(mtDir)) {
        const m = /^ship-(\d+)\.json$/.exec(name);
        if (!m) continue;
        try { const c = JSON.parse(fs.readFileSync(path.join(mtDir, name), 'utf8')); resolver.known.set(m[1], c.mmsi || c.ship?.mmsi || null); } catch { /* */ }
      }
    } catch { /* priečinok ešte nie je */ }
    const tiles = oceanTiles();
    let tileIdx = 0;
    every('ocean', async () => {
      const st = stats.ocean;
      const { x, y } = tiles[tileIdx % tiles.length];
      tileIdx += 1;
      try {
        const parsed = parseMtTileRows(JSON.parse(await curl(`https://www.marinetraffic.com/getData/get_data_json_4/z:4/X:${x}/Y:${y}/station:0`)));
        const rows = [];
        let index = null;
        const nowS = now() / 1000;
        for (const t of parsed) {
          let mmsi = resolver.get(t.shipId);
          if (mmsi === undefined) {
            index = index || buildNameIndex(vessels.values());
            const byName = matchTileRowByName(t, index);
            if (byName) {
              resolver.learn(t.shipId, byName);
              mmsi = byName;
              // Zhoda podľa mena a polohy na disk: po reštarte sa nehľadá znova.
              saveId(t.shipId, { at: now(), mmsi: byName, name: t.name, via: 'name' });
            } else resolver.want(t.shipId, { urgent: nowS - t.epochSec < 3600 });
          }
          if (mmsi) {
            rows.push(mtTileRowToVessel(t, mmsi));
            // MMSI už známe — dočasný záznam bez neho preč (aj jeho stopa).
            if (vessels.delete(oceanPseudoId(t.shipId))) tracks.delete(oceanPseudoId(t.shipId));
          } else if (mmsi === undefined) {
            // Kým čaká na MMSI, ukáže sa s dočasným kľúčom (meno, kurz, rýchlosť, cieľ, rozmery).
            rows.push(mtTileRowToVessel(t, oceanPseudoId(t.shipId)));
          }
        }
        Object.assign(st, { at: now(), rows: parsed.length, merged: st.merged + applyRows(rows), unresolved: resolver.pending(), error: null });
      } catch (error) { st.error = String(error?.message || error); }
    });
    every('resolve', () => resolver.step());
  }

  return {
    start,
    started: () => Boolean(timers),
    stats: () => (timers ? stats : null),
    oceanActive: () => Boolean(timers) && !oceanOff(),
    visitorsRecent,
    /** Návštevník (nie loopback) — zdroje navyše idú naplno. */
    markVisitor(req) { if (!isLoopbackRequest(req)) lastVisitorAt = now(); },
    /** Loď z oceánu vo výreze diváka: jej MMSI sa prekladá prednostne. */
    wantResolve(pseudoId) {
      if (!resolver || typeof pseudoId !== 'string' || !pseudoId.startsWith('mt-')) return;
      resolver.want(pseudoId.slice(3), { urgent: true });
    },
    applyRowsForTest: applyRows,
    stop() { for (const id of timers || []) clearInterval(id); timers = null; },
  };
}
