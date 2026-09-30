// src/data/stateAircraftService.js — serverová časť štátnych lietadiel (2026-09-30).
//
//   GET /api/state-aircraft                 overený zoznam strojov (so zdrojmi)
//   GET /api/state-aircraft/live            ich živé polohy z adsb.lol (jeden dopyt pre všetky, cache 15 s)
//   GET /api/state-aircraft/flights?hex=…   lety stroja z histórie (aj spätne importované), najnovšie prvé,
//                                           s letiskom odletu/príletu ODVODENÝM z koncov stopy
// Obsluhuje LEN stroje zo zoznamu — nie je to všeobecné vyhľadávanie ľubovoľného lietadla.
// Živá odpoveď sa zapisuje do histórie tým istým obalom ako ostatné zdroje (vite.config.js), takže
// vládny let sa zaznamená celý aj vtedy, keď dôjdu kredity OpenSky.

import fs from 'node:fs';
import { TRACE_SRC } from './adsblolTrace.js';
import { airportsFromIndex, nearestAirport } from './airportNearest.js';
import { parseAirportIndex } from './airportLookup.js';
import { parseStateAircraftList, stateAircraftFor } from './stateAircraft.js';
import { STATE_BACKFILL_UA, createStateBackfill, fetchGlobeTrace, fileCursorStore } from './stateAircraftBackfill.js';

export const STATE_LIVE_CACHE_MS = 15_000;
export const STATE_LIVE_URL = 'https://api.adsb.lol/v2/hex/';
/** Koniec stopy pod touto výškou (alebo na zemi) sa smie priradiť letisku. */
export const AIRPORT_END_MAX_ALT_M = 1500;
/** … a len do tejto vzdialenosti od vzťažného bodu letiska. */
export const AIRPORT_END_MAX_KM = 8;
const FLIGHTS_LIMIT_MAX = 200;

/** Letisko pre koniec letu, ak je stroj na zemi alebo nízko pri letisku; inak null. Pure. */
export function airportForEnd(airports, end) {
  if (!end || !Number.isFinite(end.lat) || !Number.isFinite(end.lon)) return null;
  const low = end.gnd || (Number.isFinite(end.altM) && end.altM <= AIRPORT_END_MAX_ALT_M);
  if (!low) return null;
  const a = nearestAirport(airports, end.lat, end.lon, AIRPORT_END_MAX_KM);
  return a ? { icao: a.icao, iata: a.iata, ident: a.ident, name: a.name, municipality: a.municipality, country: a.country } : null;
}

/** Let z histórie → položka API (trvanie, odvodené letiská). Pure. */
export function flightItem(leg, airports) {
  return {
    id: leg.id,
    callsign: leg.callsign,
    firstT: leg.firstT,
    lastT: leg.lastT,
    durationS: leg.lastT - leg.firstT,
    fixes: leg.fixes,
    maxAltM: leg.maxAltM !== null && leg.maxAltM > -1e8 ? leg.maxAltM : null,
    squawks: leg.squawks,
    origin: airportForEnd(airports, leg.first),
    destination: airportForEnd(airports, leg.last),
    src: leg.src,
  };
}

/**
 * @param {object} options
 * @param {string} options.listFile JSON zoznam (local_data/state-aircraft/sk.json)
 * @param {string} options.airportsFile airports.geojsonl
 * @param {string} options.cursorFile pozícia spätného importu
 * @param {() => object|null} options.getStore história letov (flightHistoryClient)
 */
export function createStateAircraftService({
  listFile,
  airportsFile,
  cursorFile,
  getStore,
  fetchImpl = fetch,
  now = Date.now,
  log = (msg) => console.log(msg),
  backfillIntervalMs,
}) {
  let list = null;
  let listMtime = -1;
  let airports = null;
  let live = null; // { body, at }
  let liveInFlight = null;

  function currentList() {
    try {
      const mtime = fs.statSync(listFile).mtimeMs;
      if (!list || mtime !== listMtime) {
        list = parseStateAircraftList(JSON.parse(fs.readFileSync(listFile, 'utf8')));
        listMtime = mtime;
      }
    } catch (error) {
      if (!list) log(`[state-aircraft] zoznam sa nedá načítať: ${error?.message || error}`);
      list = list || parseStateAircraftList({});
    }
    return list;
  }

  function currentAirports() {
    if (!airports) {
      try { airports = airportsFromIndex(parseAirportIndex(fs.readFileSync(airportsFile, 'utf8'))); } catch { airports = []; }
    }
    return airports;
  }

  const send = (res, status, payload, cache = 'no-store') => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': cache });
    res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
  };

  async function liveBody() {
    const hexes = currentList().aircraft.map((a) => a.hex);
    if (!hexes.length) return JSON.stringify({ ac: [], now: now(), total: 0 });
    if (live && now() - live.at < STATE_LIVE_CACHE_MS) return live.body;
    if (!liveInFlight) {
      liveInFlight = (async () => {
        const res = await fetchImpl(`${STATE_LIVE_URL}${hexes.join(',')}`, {
          headers: { 'User-Agent': STATE_BACKFILL_UA, Accept: 'application/json' },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`adsb.lol HTTP ${res.status}`);
        const body = await res.text();
        JSON.parse(body); // len platný JSON do cache
        live = { body, at: now() };
        return body;
      })().finally(() => { liveInFlight = null; });
    }
    return liveInFlight;
  }

  const backfill = createStateBackfill({
    aircraft: () => currentList().aircraft,
    fetchTrace: (hex, day) => fetchGlobeTrace(hex, day, { fetchImpl }),
    importFlight: (flight) => {
      const store = getStore();
      if (!store) throw new Error('história letov nie je dostupná');
      return store.importFlight(flight, TRACE_SRC);
    },
    cursorStore: fileCursorStore(cursorFile),
    now,
    log,
    ...(backfillIntervalMs ? { intervalMs: backfillIntervalMs } : {}),
  });

  async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    const route = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (route === '/') {
        const l = currentList();
        send(res, 200, { country: l.country, updated: l.updated, aircraft: l.aircraft }, 'public, max-age=300');
        return;
      }
      if (route === '/live') {
        try {
          send(res, 200, await liveBody());
        } catch (error) {
          if (live) send(res, 200, live.body);
          else send(res, 502, { error: 'state_live_unavailable', detail: String(error?.message || error) });
        }
        return;
      }
      if (route === '/flights') {
        const entry = stateAircraftFor(currentList(), url.searchParams.get('hex'));
        if (!entry) { send(res, 404, { error: 'not_state_aircraft' }); return; }
        const store = getStore();
        if (!store) { send(res, 503, { error: 'history_unavailable' }); return; }
        const beforeS = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
        const limit = Math.max(1, Math.min(FLIGHTS_LIMIT_MAX, Number(url.searchParams.get('limit')) || 50));
        const legs = await store.flightsOf(entry.hex, { beforeS, limit });
        const ap = currentAirports();
        send(res, 200, { hex: entry.hex, aircraft: entry, derived: ['origin', 'destination'], flights: legs.map((leg) => flightItem(leg, ap)) });
        return;
      }
      send(res, 404, { error: 'unknown_endpoint' });
    } catch (error) {
      log(`[state-aircraft] ${route}: ${error?.message || error}`);
      send(res, 500, { error: 'state_aircraft_error' });
    }
  }

  /**
   * Jednorazová oprava pri štarte: spoj polovice letov štátnych strojov rozdelené dierou v pokrytí
   * (lety cez Atlantik importované pred 2026-09-30 ostali rozdelené na „… → neznáme" a „neznáme → …").
   */
  async function repairAirGaps() {
    const store = getStore();
    if (!store?.mergeAirGaps) return 0;
    let merged = 0;
    for (const a of currentList().aircraft) {
      try { merged += await store.mergeAirGaps(a.hex); } catch (error) { log(`[state-aircraft] oprava letov ${a.hex}: ${error?.message || error}`); }
    }
    if (merged) log(`[state-aircraft] spojené lety cez diery v pokrytí: ${merged}`);
    return merged;
  }

  return {
    handle,
    hexes: () => currentList().aircraft.map((a) => a.hex),
    repairAirGaps,
    startBackfill: () => { void repairAirGaps(); backfill.start(); },
    stopBackfill: () => backfill.stop(),
    backfillTick: () => backfill.tick(),
    status: () => ({ aircraft: currentList().aircraft.length, backfill: backfill.status() }),
  };
}
