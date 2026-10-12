// src/data/vrsRoutes.js
// Trasy letov podľa volacieho znaku z Virtual Radar Server standing-data (2026-10-12).
//
// Prečo: odhady polôh bez signálu (flightEstimate.js) sú s cieľom 2× presnejšie (60–120 min bez
// signálu: medián 111 km s cieľom vs. 202 km len v poslednom smere — /api/flights/estimated/accuracy),
// no cieľ sa dohľadával len cez adsbdb, a ten smie pozadie volať 2× za minútu (adsbdbGuard — adsbdb
// nás 2026-10-05 blokoval). Výsledok 2026-10-12: cieľ malo 60 z 2 389 odhadov, rada stála na 3 000.
//
// Zdroj: github.com/vradarserver/standing-data (CC0-1.0, denné výpisy SDM databázy Virtual Radar
// Servera — tú istú databázu trás používa adsb.lol). Celý repozitár ako tar.gz má ~6 MB; stiahne sa
// raz za deň (ETag), uloží na disk a trasy sa hľadajú lokálne — žiadny dopyt navonok na lietadlo.
//   routes/schema-01/<A>/<ICAO>-all.csv   Callsign,Code,Number,AirlineCode,AirportCodes (WSSS-ZBAD, aj s medzipristátím A-B-C)
//   airports/schema-01/<A>/<AB>.csv       Code,Name,ICAO,IATA,Location,CountryISO2,Latitude,Longitude,AltitudeFeet

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const VRS_ROUTES_URL = 'https://codeload.github.com/vradarserver/standing-data/tar.gz/refs/heads/main';
export const VRS_REFRESH_MS = 24 * 3600 * 1000;
export const VRS_SOURCE = 'vradarserver/standing-data';
export const VRS_ATTRIBUTION = 'Trasy: Virtual Radar Server standing-data (CC0)';
const CALLSIGN_RE = /^[A-Z]{3}[0-9][0-9A-Z]{0,4}$/;

const R_KM = 6371;
const toRad = (d) => (d * Math.PI) / 180;
function gcKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Prejdi súbory v tar archíve (ustar, aj s pax hlavičkami GitHubu). Pure nad bufferom.
 * @param {Buffer} buf rozbalený tar
 * @param {(name: string, data: Buffer) => void} onFile
 */
export function walkTar(buf, onFile) {
  let offset = 0;
  let paxPath = null;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const field = (start, len) => header.subarray(start, start + len).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(field(124, 12).trim() || '0', 8) || 0;
    const type = field(156, 1) || '0';
    const prefix = field(345, 155);
    const name = paxPath || (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    const dataStart = offset + 512;
    const data = buf.subarray(dataStart, dataStart + size);
    if (type === 'x') {
      const m = /\d+ path=([^\n]+)\n/.exec(data.toString('utf8'));
      paxPath = m ? m[1] : null;
    } else {
      if (type === '0' || type === '') onFile(name, data);
      if (type !== 'g') paxPath = null;
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
}

function csvRows(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  const head = (lines.shift() || '').split(',');
  const rows = [];
  for (const line of lines) {
    if (!line) continue;
    // Názvy letísk môžu mať čiarky v úvodzovkách.
    const cells = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = !quoted; }
      else if (ch === ',' && !quoted) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    const row = {};
    head.forEach((h, i) => { row[h.trim()] = (cells[i] ?? '').trim(); });
    rows.push(row);
  }
  return rows;
}

/**
 * Z rozbaleného tar archívu postav databázu: callsign → kódy letísk, kód → letisko. Pure.
 * @returns {{ routes: Map<string,string>, airports: Map<string,object> }}
 */
export function buildVrsDb(tarBuf) {
  const routes = new Map();
  const airports = new Map();
  walkTar(tarBuf, (name, data) => {
    if (!name.endsWith('.csv')) return;
    if (/\/routes\/schema-01\//.test(name)) {
      for (const row of csvRows(data.toString('utf8'))) {
        const cs = String(row.Callsign || '').toUpperCase();
        const codes = String(row.AirportCodes || '').toUpperCase();
        if (cs && /^[A-Z0-9]{4}(-[A-Z0-9]{4})+$/.test(codes)) routes.set(cs, codes);
      }
    } else if (/\/airports\/schema-01\//.test(name)) {
      for (const row of csvRows(data.toString('utf8'))) {
        const lat = Number(row.Latitude);
        const lon = Number(row.Longitude);
        const code = String(row.Code || row.ICAO || '').toUpperCase();
        if (!code || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        airports.set(code, {
          code: row.IATA || row.ICAO || code,
          icao: /^[A-Z0-9]{4}$/.test(row.ICAO || '') ? row.ICAO.toUpperCase() : (/^[A-Z0-9]{4}$/.test(code) ? code : null),
          name: row.Location || row.Name || '',
          lat,
          lon,
          country: /^[A-Z]{2}$/.test(row.CountryISO2 || '') ? row.CountryISO2 : null,
        });
      }
    }
  });
  return { routes, airports };
}

/**
 * Úsek trasy, na ktorom lietadlo je (pri medzipristátí A-B-C): najmenšia obchádzka
 * |A→poloha| + |poloha→B| − |A→B|. Bez polohy prvý úsek. Pure.
 * @param {object[]} legs pole letísk v poradí
 * @param {{lat:number, lon:number}|null} at
 */
export function pickLeg(stops, at) {
  if (stops.length < 2) return null;
  if (stops.length === 2 || !at || !Number.isFinite(at.lat) || !Number.isFinite(at.lon)) return [stops[0], stops[1]];
  let best = null;
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i];
    const b = stops[i + 1];
    const detour = gcKm(a.lat, a.lon, at.lat, at.lon) + gcKm(at.lat, at.lon, b.lat, b.lon) - gcKm(a.lat, a.lon, b.lat, b.lon);
    if (!best || detour < best.detour) best = { detour, leg: [a, b] };
  }
  return best.leg;
}

/**
 * Trasa v tvare ako parseRoute z adsbdb (origin/destination s code, icao, name, lat, lon, country). Pure.
 * @param {{routes: Map, airports: Map}} db
 * @param {string} callsign
 * @param {{lat:number, lon:number}|null} [at] poloha lietadla (výber úseku)
 */
export function vrsRouteFor(db, callsign, at = null) {
  const cs = String(callsign || '').trim().toUpperCase();
  if (!db || !CALLSIGN_RE.test(cs)) return null;
  const codes = db.routes.get(cs);
  if (!codes) return null;
  const stops = codes.split('-').map((c) => db.airports.get(c)).filter(Boolean);
  if (stops.length !== codes.split('-').length) return null; // neznáme letisko = radšej nič
  const leg = pickLeg(stops, at);
  if (!leg || leg[0] === leg[1]) return null;
  return {
    airline: null,
    airlineIcao: cs.slice(0, 3),
    airlineIata: null,
    callsignIata: null,
    origin: { ...leg[0] },
    destination: { ...leg[1] },
    source: 'vrs',
  };
}

/**
 * Databáza trás so sťahovaním raz denne a kópiou na disku.
 * @param {object} [o]
 * @param {typeof fetch} [o.fetchImpl]
 * @param {string|null} [o.cacheFile] kam uložiť tar.gz (+ .json s ETagom)
 * @param {() => number} [o.now]
 * @param {(msg: string) => void} [o.log]
 * @param {() => void} [o.onLoaded] po načítaní / obnovení databázy
 */
export function createVrsRouteDb({ fetchImpl = globalThis.fetch, cacheFile = null, now = () => Date.now(), log = () => {}, onLoaded = () => {} } = {}) {
  let db = null;
  let loadedAt = 0;
  let etag = null;
  let lastError = null;
  let lastCheckAt = 0;
  let timer = null;
  let lookups = 0;
  let hits = 0;

  function load(gz, source) {
    const next = buildVrsDb(zlib.gunzipSync(gz));
    if (next.routes.size < 1000 || next.airports.size < 1000) throw new Error(`malá databáza (${next.routes.size} trás, ${next.airports.size} letísk)`);
    db = next;
    loadedAt = now();
    log(`[vrs-routes] ${source}: ${db.routes.size} trás, ${db.airports.size} letísk`);
    try { onLoaded(); } catch { /* volajúci */ }
  }

  function loadFromDisk() {
    if (!cacheFile) return false;
    try {
      const gz = fs.readFileSync(cacheFile);
      const meta = JSON.parse(fs.readFileSync(`${cacheFile}.json`, 'utf8'));
      etag = meta.etag || null;
      load(gz, 'disk');
      loadedAt = Number(meta.at) || loadedAt;
      return true;
    } catch { return false; }
  }

  async function refresh() {
    lastCheckAt = now();
    try {
      const headers = etag && db ? { 'If-None-Match': etag } : {};
      const res = await fetchImpl(VRS_ROUTES_URL, { headers, signal: AbortSignal.timeout(60_000) });
      if (res.status === 304) { loadedAt = now(); lastError = null; return 'unchanged'; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const gz = Buffer.from(await res.arrayBuffer());
      load(gz, 'stiahnuté');
      etag = res.headers?.get?.('etag') || null;
      lastError = null;
      if (cacheFile) {
        try {
          fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
          const tmp = `${cacheFile}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, gz);
          fs.renameSync(tmp, cacheFile);
          fs.writeFileSync(`${cacheFile}.json`, JSON.stringify({ at: loadedAt, etag }));
        } catch (error) { log(`[vrs-routes] zápis na disk zlyhal: ${error.message}`); }
      }
      return 'updated';
    } catch (error) {
      lastError = String(error?.message || error);
      log(`[vrs-routes] obnova zlyhala: ${lastError}`);
      return 'error';
    }
  }

  return {
    lookup(callsign, at = null) {
      if (!db) return null;
      lookups += 1;
      const route = vrsRouteFor(db, callsign, at);
      if (route) hits += 1;
      return route;
    },
    ready: () => Boolean(db),
    refresh,
    start() {
      const fromDisk = loadFromDisk();
      const due = !fromDisk || now() - loadedAt > VRS_REFRESH_MS;
      if (due) void refresh();
      timer = setInterval(() => { if (now() - loadedAt > VRS_REFRESH_MS) void refresh(); }, 3600 * 1000);
      timer.unref?.();
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
    status: () => ({
      ready: Boolean(db), routes: db?.routes.size || 0, airports: db?.airports.size || 0,
      loadedAt, lastCheckAt, lastError, lookups, hits,
    }),
    _setDbForTest(next) { db = next; },
  };
}
