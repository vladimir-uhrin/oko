// src/data/adsblolTrace.js — stopy lietadiel z archívu adsb.lol (readsb „trace_full") → história letov.
//
// Formát (readsb README-json.md, overené na archíve 2026-09-25): `{icao, r, t, desc, dbFlags,
// ownOp, year, timestamp, trace: [[sekundy od timestamp, lat, lon, výška ft | "ground" | null,
// rýchlosť kt, kurz, príznaky, vertikálna rýchlosť ft/min, detaily | null, zdroj polohy,
// geometrická výška ft, geometrická vert. rýchlosť, IAS kt, náklon], …]}`. Príznaky: 1 = stará
// poloha, 2 = začiatok nového úseku (vzlet po pristátí), 4 = vert. rýchlosť geometrická,
// 8 = výška geometrická. Detaily (volací znak, squawk, kategória, rýchlosti…) len pri časti bodov
// — prenášajú sa dopredu. Súbory sú gzip. Jeden deň jedného stroja cez web:
// https://adsb.lol/globe_history/RRRR/MM/DD/traces/<posledné 2 hex>/trace_full_<hex>.json
// (overené 2026-09-30; najstarší deň, ktorý vrátil 200, je 2023-02-20). Licencia ODbL 1.0.
//
// Majiteľ/prevádzkovateľ (`ownOp`) sa neukladá — etická čiara: stroje, nie ľudia.

import {
  ARCHIVE_SRC,
  LEG_GAP_S,
  openSkyCategoryFromReadsb,
  posSrcFromReadsbType,
  readsbExtrasJson,
} from './flightHistoryStore.js';
// Delenie na lety (splitLegs) a zápis (importFlight) sú v flightHistoryStore.js.

export const TRACE_SRC = ARCHIVE_SRC;
export const GLOBE_HISTORY_BASE = 'https://adsb.lol/globe_history';
const FT_TO_M = 0.3048;
const KT_TO_MPS = 0.514444;
const FPM_TO_MPS = 0.00508;
const DAY_MS = 86_400_000;

const finite = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const cleanText = (v) => {
  if (typeof v !== 'string') return null;
  const text = v.trim();
  return text || null;
};

/** Deň UTC `RRRR-MM-DD` z epoch ms. Pure. */
export function utcDay(ms) {
  return new Date(Math.floor(ms / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
}

/** Posun dňa `RRRR-MM-DD` o `delta` dní. Pure. */
export function shiftDay(day, delta) {
  return utcDay(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS);
}

/** URL stopy jedného stroja za jeden deň (globe_history adsb.lol). Pure; zlý hex/deň = null. */
export function globeHistoryUrl(hex, day) {
  const h = String(hex || '').trim().toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(h) || !/^\d{4}-\d{2}-\d{2}$/.test(String(day))) return null;
  const [y, m, d] = String(day).split('-');
  return `${GLOBE_HISTORY_BASE}/${y}/${m}/${d}/traces/${h.slice(-2)}/trace_full_${h}.json`;
}

/**
 * Stopa readsb (už rozbalená z gzip a JSON.parse) → stroj s chronologickými bodmi. Pure.
 * Adresy mimo ICAO (`~…`, TIS-B) sa vynechajú — nie sú jednoznačné.
 * @returns {{icao24: string, reg: string|null, acType: string|null, acDesc: string|null, points: object[]}|null}
 */
export function traceToFlight(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.trace)) return null;
  const icao24 = String(json.icao ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(icao24)) return null;
  const base = finite(json.timestamp);
  if (base === null) return null;

  let callsign = '';
  let squawk = null;
  let cat = null;
  let prevT = null;
  const points = [];
  const seen = new Set();
  for (const p of json.trace) {
    if (!Array.isArray(p)) continue;
    const offset = finite(p[0]);
    const lat = finite(p[1]);
    const lon = finite(p[2]);
    if (offset === null || lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const t = Math.round(base + offset);
    const flags = Number(p[6]) | 0;
    const newLeg = (flags & 2) !== 0;
    // Nový úsek alebo dlhá medzera: volací znak a squawk predchádzajúceho letu už neplatia.
    if (newLeg || (prevT !== null && t - prevT > LEG_GAP_S)) {
      callsign = '';
      squawk = null;
    }
    prevT = t;
    const details = p[8] && typeof p[8] === 'object' && !Array.isArray(p[8]) ? p[8] : null;
    if (details) {
      if (typeof details.flight === 'string' && details.flight.trim()) callsign = details.flight.trim().toUpperCase();
      if (details.squawk) squawk = String(details.squawk).trim();
      const c = openSkyCategoryFromReadsb(details.category);
      if (c !== null) cat = c;
    }
    if (seen.has(t)) continue; // jedna poloha za sekundu (primárny kľúč histórie je stroj + sekunda)
    seen.add(t);
    const ground = p[3] === 'ground';
    const altFt = ground ? 0 : finite(p[3]);
    let geoFt = finite(p[10]);
    if (geoFt === null && (flags & 8) && !ground && altFt !== null) geoFt = altFt;
    const gsKt = finite(p[4]);
    const vrFpm = finite(p[7]);
    const extra = details ? { ...details } : {};
    delete extra.ownOp;
    if (finite(p[11]) !== null) extra.geom_rate = finite(p[11]);
    if (finite(p[12]) !== null) extra.ias = finite(p[12]);
    if (finite(p[13]) !== null) extra.roll = finite(p[13]);
    points.push({
      t,
      lat,
      lon,
      alt: altFt === null ? null : altFt * FT_TO_M,
      gs: gsKt === null ? null : gsKt * KT_TO_MPS,
      trk: finite(p[5]),
      vr: vrFpm === null ? null : vrFpm * FPM_TO_MPS,
      squawk,
      gnd: ground ? 1 : 0,
      geoAlt: geoFt === null ? null : geoFt * FT_TO_M,
      posSrc: posSrcFromReadsbType(p[9]),
      spi: details && (details.spi === 1 || details.spi === true) ? 1 : 0,
      cat,
      callsign,
      newLeg,
      x: readsbExtrasJson(extra),
    });
  }
  points.sort((a, b) => a.t - b.t);
  return {
    icao24,
    reg: cleanText(json.r),
    acType: cleanText(json.t),
    acDesc: cleanText(json.desc),
    points,
  };
}
