// src/data/aisStatePersist.js
/**
 * @module aisStatePersist
 * @description Stav živého AIS, ktorý prežije reštart servera (2026-10-10,
 * vlastník: „prečo je pri tých lodiach tak málo info odkiaľ kam" a „nenačíta
 * let lodí"). Statické údaje (cieľ, ETA, rozmery, IMO, volací znak) chodia
 * v AIS len raz za ~6 min a trasa sa skladá z polôh — každé vydanie oko-api
 * ich doteraz zmazalo, takže po vydaní mala väčšina lodí prázdny cieľ aj
 * stopu. Server stav periodicky zapíše na disk a pri štarte ho načíta.
 *
 * Čisté funkcie (serializácia / obnova) + tenký zápis cez zlib a fs. Zastarané
 * položky sa pri obnove zahodia: polohy podľa okna AIS, trasy po 24 h,
 * statika po 7 dňoch.
 */
import zlib from 'node:zlib';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

export const AIS_STATE_VERSION = 1;
export const AIS_STATE_TRACK_MAX_AGE_SEC = 24 * 3600;
export const AIS_STATE_STATIC_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

/**
 * Snímka stavu do JSON-bezpečného tvaru. Pure.
 * @param {{vessels: Map<string,object>, statics: Map<string,object>, tracks: Map<string,{lats:ArrayLike<number>,lons:ArrayLike<number>,times:ArrayLike<number>,head:number,len:number}>, nowMs?: number}} state
 */
export function serializeAisState({ vessels, statics, tracks, nowMs = Date.now() }) {
  const out = { version: AIS_STATE_VERSION, savedAt: nowMs, vessels: [], statics: [], tracks: [] };
  for (const row of vessels?.values?.() || []) out.vessels.push(row);
  for (const [mmsi, data] of statics || []) out.statics.push([mmsi, { ...data, _savedAt: data?._savedAt ?? nowMs }]);
  for (const [mmsi, track] of tracks || []) {
    const cap = track.lats.length;
    const pts = [];
    for (let i = 0; i < track.len; i += 1) {
      const idx = (track.head - track.len + i + cap) % cap;
      pts.push(Math.round(track.lats[idx] * 1e5) / 1e5, Math.round(track.lons[idx] * 1e5) / 1e5, track.times[idx]);
    }
    if (pts.length) out.tracks.push([mmsi, pts]);
  }
  return out;
}

/**
 * Obnova zo snímky — vráti len čerstvé položky. Pure.
 * @param {object} snapshot výstup serializeAisState
 * @param {{nowMs?: number, vesselMaxAgeMs: number}} options
 * @returns {{vessels: object[], statics: Array<[string, object]>, tracks: Array<[string, Array<{lat:number,lon:number,t:number}>]>}}
 */
export function restoreAisState(snapshot, { nowMs = Date.now(), vesselMaxAgeMs }) {
  const empty = { vessels: [], statics: [], tracks: [] };
  if (!snapshot || snapshot.version !== AIS_STATE_VERSION) return empty;
  const vessels = (Array.isArray(snapshot.vessels) ? snapshot.vessels : [])
    .filter((row) => row && row.mmsi && Number.isFinite(row._updatedAt) && nowMs - row._updatedAt < vesselMaxAgeMs);
  const statics = (Array.isArray(snapshot.statics) ? snapshot.statics : [])
    .filter(([mmsi, data]) => mmsi && data && nowMs - (Number(data._savedAt) || 0) < AIS_STATE_STATIC_MAX_AGE_MS);
  const minT = Math.floor(nowMs / 1000) - AIS_STATE_TRACK_MAX_AGE_SEC;
  const tracks = [];
  for (const entry of Array.isArray(snapshot.tracks) ? snapshot.tracks : []) {
    const [mmsi, flat] = entry || [];
    if (!mmsi || !Array.isArray(flat)) continue;
    const pts = [];
    for (let i = 0; i + 2 < flat.length; i += 3) {
      const [lat, lon, t] = [flat[i], flat[i + 1], flat[i + 2]];
      if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(t) && t >= minT) pts.push({ lat, lon, t });
    }
    if (pts.length) tracks.push([mmsi, pts]);
  }
  return { vessels, statics, tracks };
}

/** Zapíše snímku (gzip JSON) atomicky. */
export async function writeAisStateFile(file, snapshot) {
  const buf = zlib.gzipSync(Buffer.from(JSON.stringify(snapshot)), { level: 6 });
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, buf);
  await fsp.rename(tmp, file);
  return buf.length;
}

/** Načíta snímku; chýbajúci alebo poškodený súbor = null. */
export async function readAisStateFile(file) {
  try {
    return JSON.parse(zlib.gunzipSync(await fsp.readFile(file)).toString('utf8'));
  } catch {
    return null;
  }
}
