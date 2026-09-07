// src/data/flightHistory.js
/**
 * @module flightHistory
 * @description Klientská strana histórie letov (2026-09-07): dopyty na
 * `/api/history/*` (flightHistoryStore.js na proxy) a ČISTÉ výpočty nad
 * trasou — súhrn, interpolácia polohy v čase, rady pre graf.
 *
 * Fix = { t (epoch s), lat, lon, alt (m), gs (m/s), trk (°), vr (m/s),
 * squawk, gnd }. Proxy posiela kompaktné polia, tu sa rozbalia raz.
 * Bez DOM a bez Cesia — všetko testovateľné v Node.
 */
import { greatCircleKm } from './flightProgress.js';

/** Ponúkané okná vyhľadávania (h). Retencia proxy je 7 dní. */
export const HISTORY_SEARCH_HOURS = Object.freeze([24, 72, 168]);
/** Počet vzoriek grafu (rovnomerne v čase). */
export const CHART_SAMPLES = 240;

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);

/** Kompaktné pole proxy → fix objekt. Pure. */
export function fixFromCompact(row) {
  if (!Array.isArray(row) || row.length < 3) return null;
  const t = num(row[0]);
  const lat = num(row[1]);
  const lon = num(row[2]);
  if (t === null || lat === null || lon === null) return null;
  return {
    t, lat, lon,
    alt: num(row[3]),
    gs: num(row[4]),
    trk: num(row[5]),
    vr: num(row[6]),
    squawk: row[7] ? String(row[7]) : null,
    gnd: row[8] === 1 || row[8] === true,
  };
}

/** Odpoveď /api/history/track → chronologické fixy bez dier. Pure. */
export function parseTrackPayload(payload) {
  const rows = Array.isArray(payload?.fixes) ? payload.fixes : [];
  const fixes = rows.map(fixFromCompact).filter(Boolean);
  fixes.sort((a, b) => a.t - b.t);
  return fixes;
}

/** Počiatočný azimut medzi dvoma bodmi (°, 0 = sever). Pure. */
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const toR = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toR(lon2 - lon1)) * Math.cos(toR(lat2));
  const x = Math.cos(toR(lat1)) * Math.sin(toR(lat2)) - Math.sin(toR(lat1)) * Math.cos(toR(lat2)) * Math.cos(toR(lon2 - lon1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Súhrn trasy: trvanie, max výška/rýchlosť, preletená vzdialenosť
 * (súčet veľkokružníc medzi fixmi), squawky. Pure; null pod 2 fixy.
 * @param {Array<object>} fixes chronologické
 */
export function trackSummary(fixes) {
  if (!Array.isArray(fixes) || fixes.length < 2) return null;
  let distanceKm = 0;
  let maxAltM = null;
  let maxGsMps = null;
  const squawks = new Set();
  for (let i = 0; i < fixes.length; i += 1) {
    const f = fixes[i];
    if (i > 0) distanceKm += greatCircleKm(fixes[i - 1].lat, fixes[i - 1].lon, f.lat, f.lon) || 0;
    if (f.alt !== null && (maxAltM === null || f.alt > maxAltM)) maxAltM = f.alt;
    if (f.gs !== null && (maxGsMps === null || f.gs > maxGsMps)) maxGsMps = f.gs;
    if (f.squawk) squawks.add(f.squawk);
  }
  const startT = fixes[0].t;
  const endT = fixes[fixes.length - 1].t;
  return { fixes: fixes.length, startT, endT, durationS: endT - startT, maxAltM, maxGsMps, distanceKm, squawks: [...squawks] };
}

/** Lineárna interpolácia s obalom zemepisnej dĺžky cez ±180°. Pure. */
export function lerpLon(a, b, f) {
  let d = b - a;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  const v = a + d * f;
  return v > 180 ? v - 360 : v < -180 ? v + 360 : v;
}

/**
 * Poloha a parametre v čase t (lineárne medzi susednými fixmi; mimo rozsahu
 * krajný fix). Kurz z fixu, ak chýba, z azimutu segmentu. Pure.
 * @param {Array<object>} fixes chronologické, ≥ 1
 * @param {number} tS
 */
export function interpolateFix(fixes, tS) {
  if (!Array.isArray(fixes) || !fixes.length) return null;
  if (tS <= fixes[0].t) return { ...fixes[0], index: 0, frac: 0 };
  const last = fixes[fixes.length - 1];
  if (tS >= last.t) return { ...last, index: fixes.length - 1, frac: 1 };
  let lo = 0;
  let hi = fixes.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (fixes[mid].t <= tS) lo = mid; else hi = mid;
  }
  const a = fixes[lo];
  const b = fixes[hi];
  const span = b.t - a.t;
  const f = span > 0 ? (tS - a.t) / span : 0;
  const mix = (x, y) => (x === null ? y : y === null ? x : x + (y - x) * f);
  const trk = a.trk !== null && b.trk !== null ? lerpLon(a.trk, b.trk, f) : (a.trk ?? b.trk ?? bearingDeg(a.lat, a.lon, b.lat, b.lon));
  return {
    t: tS,
    lat: a.lat + (b.lat - a.lat) * f,
    lon: lerpLon(a.lon, b.lon, f),
    alt: mix(a.alt, b.alt),
    gs: mix(a.gs, b.gs),
    trk: ((trk % 360) + 360) % 360,
    vr: mix(a.vr, b.vr),
    squawk: f < 0.5 ? a.squawk : b.squawk,
    gnd: f < 0.5 ? a.gnd : b.gnd,
    index: lo,
    frac: (tS - fixes[0].t) / Math.max(1, last.t - fixes[0].t),
  };
}

/**
 * Rady pre graf: `samples` bodov rovnomerne v čase, výška a rýchlosť
 * normalizované 0..1 (min 0 pre výšku, nech graf ukazuje aj pristátie).
 * Pure; null pod 2 fixy.
 * @param {Array<object>} fixes
 * @param {{samples?: number}} [options]
 */
export function chartSeries(fixes, { samples = CHART_SAMPLES } = {}) {
  const summary = trackSummary(fixes);
  if (!summary || summary.durationS <= 0) return null;
  const n = Math.max(2, Math.floor(samples));
  const altMax = Math.max(1, summary.maxAltM ?? 1);
  const gsMax = Math.max(1, summary.maxGsMps ?? 1);
  const alt = new Array(n);
  const gs = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = summary.startT + (summary.durationS * i) / (n - 1);
    const p = interpolateFix(fixes, t);
    alt[i] = p.alt === null ? null : Math.max(0, Math.min(1, p.alt / altMax));
    gs[i] = p.gs === null ? null : Math.max(0, Math.min(1, p.gs / gsMax));
  }
  return { alt, gs, altMaxM: summary.maxAltM, gsMaxMps: summary.maxGsMps, startT: summary.startT, endT: summary.endT };
}

/** HH:MM UTC z epoch sekúnd. Pure. */
export function formatClockUtc(tS) {
  if (!Number.isFinite(tS)) return '--:--';
  return new Date(tS * 1000).toISOString().slice(11, 16);
}

/** Trvanie: '48 min', '1 h 23 min'. Pure. */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h === 0) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Titulok úseku: volací znak, inak hex veľkými. Pure. */
export function legTitle(leg) {
  const cs = String(leg?.callsign || '').trim();
  return cs || String(leg?.icao24 || '').toUpperCase();
}

// ── API ──────────────────────────────────────────────────────────────

async function getJson(url, fetcher) {
  const response = await fetcher(url);
  if (!response?.ok) throw new Error(`history HTTP ${response?.status ?? 'n/a'}`);
  return response.json();
}

export async function fetchHistoryStatus({ fetcher = globalThis.fetch } = {}) {
  return getJson('/api/history/status', fetcher);
}

/**
 * @param {string} query volací znak (prefix) alebo hex; '' = najnovšie úseky
 * @param {{hours?: number, limit?: number, fetcher?: Function}} [options]
 * @returns {Promise<Array<object>>} legs
 */
export async function searchFlightHistory(query, { hours = 24, limit = 50, fetcher = globalThis.fetch } = {}) {
  const params = new URLSearchParams({ q: String(query ?? '').trim(), hours: String(hours), limit: String(limit) });
  const payload = await getJson(`/api/history/search?${params}`, fetcher);
  return Array.isArray(payload?.legs) ? payload.legs : [];
}

/**
 * @param {string} icao24
 * @param {{fromS?: number, toS?: number, fetcher?: Function}} [options]
 * @returns {Promise<Array<object>>} fixy
 */
export async function fetchFlightTrack(icao24, { fromS, toS, fetcher = globalThis.fetch } = {}) {
  const params = new URLSearchParams({ icao24: String(icao24 || '').toLowerCase() });
  if (Number.isFinite(fromS)) params.set('from', String(Math.floor(fromS)));
  if (Number.isFinite(toS)) params.set('to', String(Math.ceil(toS)));
  return parseTrackPayload(await getJson(`/api/history/track?${params}`, fetcher));
}
