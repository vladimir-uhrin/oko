// src/data/vesselTrackSources.js
/**
 * @module vesselTrackSources
 * @description Neoficiálne zdroje polohy, trasy a plavby lodí (2026-10-10,
 * vlastník: „skús nájsť aj iné zdroje aj keď neoficiálne" → „všetko zapoj").
 *
 *  • MarineTraffic (verejné JSON endpointy ich vlastnej stránky):
 *      /en/search/searchAsset?what=vessel&term=<MMSI>  → shipId
 *      /en/vessels/<shipId>/position                   → posledná poloha
 *        (aj „Roaming" = prijímač na inej lodi, teda aj otvorený oceán)
 *      /en/vessels/<shipId>/voyage                     → ATD/ATA, posledný prístav
 *      /en/ports/<portId>/general                      → meno, LOCODE, štát
 *      /map/gettrackjson/shipid:<shipId>               → trasa ~24 h
 *    Cloudflare odmieta TLS odtlačok Node `fetch` (403); Windows curl.exe
 *    (Schannel) prejde → volá sa cez podproces. Hlavička X-Requested-With je
 *    povinná (inak 400).
 *  • VesselFinder /api/pub/track/<MMSI> → binárna trasa 24 h pred posledným
 *    pozemným fixom (16 B na bod, XOR 0x55555555), Node fetch prejde.
 *
 * Zdroje sa v rozhraní nemenujú (pravidlo o konkurencii); poctivý záznam je
 * v DATA_SOURCES.md. Parsovanie sú čisté funkcie (testy), sieť je vložená.
 */
import { execFile } from 'node:child_process';

export const MT_BASE = 'https://www.marinetraffic.com';
export const VF_TRACK = 'https://www.vesselfinder.com/api/pub/track/';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const CURL = process.platform === 'win32' ? 'C:\\Windows\\System32\\curl.exe' : 'curl';

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** shipId MarineTraffic pre MMSI z vyhľadávania (presná zhoda MMSI). Pure. */
export function parseMtSearch(json, mmsi) {
  const hit = (Array.isArray(json) ? json : []).find((x) => String(x?.type) === 'Vessel' && String(x?.value) === String(mmsi));
  return hit?.id ? String(hit.id) : null;
}

/** Posledná poloha. Pure. */
export function parseMtPosition(json) {
  const lat = finite(json?.lat);
  const lon = finite(json?.lon);
  const ts = finite(json?.timestamp);
  if (lat === null || lon === null || ts === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return {
    lat, lon,
    t: ts * 1000,
    speedKn: finite(json.speed),
    course: finite(json.course),
    heading: finite(json.heading),
    navStatus: json.navigationalStatus ? String(json.navigationalStatus) : null,
    station: json.stationType ? String(json.stationType) : null,
    area: json.areaName ? String(json.areaName) : null,
    newerSatellite: json.hasNewerSatellitePosition === true,
  };
}

/** Plavba: odchod/príchod + port id. Pure. */
export function parseMtVoyage(json) {
  if (!json || typeof json !== 'object') return null;
  return {
    departurePortId: json.departurePortId != null ? String(json.departurePortId) : null,
    departedAt: finite(json.departureTimestamp) ? json.departureTimestamp * 1000 : null,
    arrivalPortId: json.arrivalPortId != null ? String(json.arrivalPortId) : null,
    arrivedAt: finite(json.arrivalTimestamp) ? json.arrivalTimestamp * 1000 : null,
    destination: json.reportedDestination ? String(json.reportedDestination).trim() || null : null,
    etaMs: finite(json.eta) ? json.eta * 1000 : null,
  };
}

function titleCase(text) {
  return String(text || '').toLowerCase().replace(/(^|[\s-])([a-zà-ž])/g, (m, a, b) => a + b.toUpperCase());
}

/** Prístav. Pure. */
export function parseMtPort(json) {
  if (!json?.name) return null;
  return {
    name: titleCase(json.name),
    locode: json.unlocode ? String(json.unlocode) : null,
    lat: finite(json.lat),
    lon: finite(json.lon),
    countryIso2: json.country?.code ? String(json.country.code).toLowerCase() : null,
    country: json.country?.name ? titleCase(json.country.name) : null,
  };
}

/** Trasa MT: [lon, lat, speed×10, course, heading, "YYYY-MM-DD HH:MM:SS", unix, station, …]. Chronologicky. Pure. */
export function parseMtTrack(json) {
  const out = [];
  for (const row of Array.isArray(json) ? json : []) {
    const lon = finite(row?.[0]);
    const lat = finite(row?.[1]);
    const t = finite(row?.[6]);
    if (lat === null || lon === null || t === null) continue;
    out.push({ lat, lon, t: t * 1000, speedKn: finite(row[2]) !== null ? finite(row[2]) / 10 : null, course: finite(row[3]), station: row[7] ? String(row[7]) : null });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Binárna trasa VesselFinder (16 B na bod). Pure. */
export function decodeVfTrack(buf) {
  const out = [];
  if (!buf || typeof buf.readUInt32BE !== 'function') return out;
  for (let i = 0; i + 16 <= buf.length; i += 16) {
    const t = buf.readUInt32BE(i);
    const lon = ((buf.readUInt32BE(i + 4) ^ 0x55555555) | 0) / 6e5;
    const lat = ((buf.readUInt32BE(i + 8) ^ 0x55555555) | 0) / 6e5;
    const course = (buf.readUInt16BE(i + 12) ^ 0x5555) / 10;
    const speedKn = (buf.readUInt16BE(i + 14) ^ 0x5555) / 10;
    if (!t || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    out.push({ lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, t: t * 1000, speedKn, course, station: null });
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * GET cez Windows curl.exe (Schannel prejde cez Cloudflare MT). Vráti text
 * tela alebo vyhodí pri chybe / nie-2xx.
 * @param {string} url
 * @param {{timeoutMs?: number}} [o]
 */
export function curlGet(url, { timeoutMs = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(CURL, [
      '-s', '-S', '--compressed', '-m', String(Math.ceil(timeoutMs / 1000)),
      '-A', BROWSER_UA,
      '-H', 'X-Requested-With: XMLHttpRequest',
      '-H', 'Accept: application/json, text/plain, */*',
      '-w', '\n%{http_code}',
      url,
    ], { maxBuffer: 8 * 1024 * 1024, timeout: timeoutMs + 2000, windowsHide: true }, (error, stdout) => {
      if (error) { reject(error); return; }
      const text = String(stdout || '');
      const cut = text.lastIndexOf('\n');
      const status = Number(text.slice(cut + 1));
      if (!(status >= 200 && status < 300)) { reject(new Error(`HTTP ${status}`)); return; }
      resolve(text.slice(0, cut));
    });
  });
}

export { BROWSER_UA };
