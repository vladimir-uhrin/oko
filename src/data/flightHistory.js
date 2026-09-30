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

/**
 * Ponúkané okná vyhľadávania (h): 1, 3, 7, 30, 90 a 365 dní.
 * Retencia záznamu je 365 dní (plný záznam prvých 30 dní, staršie sa preriedia
 * na ~1 fix / 2 min), preto sa dá dohľadať späť ktorékoľvek lietadlo z celého
 * rozsahu, nielen za týždeň (2026-09-15, používateľ: „chcem dohľadať spätne
 * každé lietadlo"). Úseky (legs) sa nepreriedujú, takže staršie lety sa vždy
 * nájdu — len ich prehratá dráha je nad 30 dní hrubšia. Server okno oreže na
 * `24 × retenciu`, takže väčšie hodnoty sú bezpečné aj pri kratšej retencii.
 */
export const HISTORY_SEARCH_HOURS = Object.freeze([24, 72, 168, 720, 2160, 8760]);
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
    // Úsek, ktorého aspoň jeden koniec je odhad (bridgeCoverageGaps), je odhad.
    estimated: Boolean(a.estimated || b.estimated),
    index: lo,
    frac: (tS - fixes[0].t) / Math.max(1, last.t - fixes[0].t),
  };
}

/** Diera v pokrytí za letu, ktorú prehrávanie doplní odhadom (s). */
export const GAP_BRIDGE_MIN_S = 10 * 60;
/** Krok odhadnutých bodov po veľkej kružnici (km). */
export const GAP_BRIDGE_STEP_KM = 50;

/** Bod na veľkej kružnici medzi a a b v zlomku f (sférická interpolácia). Pure. */
export function greatCirclePoint(a, b, f) {
  const r = Math.PI / 180;
  const [φ1, λ1, φ2, λ2] = [a.lat * r, a.lon * r, b.lat * r, b.lon * r];
  const d = 2 * Math.asin(Math.min(1, Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2)));
  if (d < 1e-9) return { lat: a.lat, lon: a.lon };
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return { lat: Math.atan2(z, Math.sqrt(x * x + y * y)) / r, lon: Math.atan2(y, x) / r };
}

/**
 * Doplň diery v pokrytí za letu (oceán bez prijímačov, 2026-09-30: „transatlantické lety sa
 * nedajú dopočítať?") ODHADOM — body po veľkej kružnici každých ~50 km medzi poslednou polohou
 * pred dierou a prvou po nej, čas a výška lineárne. Každý odhadnutý bod nesie `estimated: true`
 * (kreslí sa čiarkovane, v UI „odhad"); skutočné polohy sa nemenia a do archívu sa nič neukladá.
 * Skutočná trasa sa môže líšiť aj o stovky km (vetry, oceánske koridory). Pure.
 * @returns {{fixes: object[], gaps: number}}
 */
export function bridgeCoverageGaps(fixes, { minGapS = GAP_BRIDGE_MIN_S, stepKm = GAP_BRIDGE_STEP_KM } = {}) {
  if (!Array.isArray(fixes) || fixes.length < 2) return { fixes: Array.isArray(fixes) ? fixes : [], gaps: 0 };
  const out = [fixes[0]];
  let gaps = 0;
  for (let i = 1; i < fixes.length; i += 1) {
    const a = fixes[i - 1];
    const b = fixes[i];
    const dt = b.t - a.t;
    if (dt >= minGapS && !a.gnd && !b.gnd) {
      const km = greatCircleKm(a.lat, a.lon, b.lat, b.lon) || 0;
      const n = Math.max(1, Math.floor(km / stepKm));
      gaps += 1;
      for (let k = 1; k < n; k += 1) {
        const f = k / n;
        const p = greatCirclePoint(a, b, f);
        const next = greatCirclePoint(a, b, Math.min(1, f + 0.5 / n));
        const lerp = (x, y) => (x === null || x === undefined || y === null || y === undefined ? (x ?? y ?? null) : x + (y - x) * f);
        out.push({
          t: a.t + dt * f,
          lat: p.lat,
          lon: p.lon,
          alt: lerp(a.alt, b.alt),
          gs: lerp(a.gs, b.gs),
          trk: bearingDeg(p.lat, p.lon, next.lat, next.lon),
          vr: null,
          squawk: a.squawk ?? null,
          gnd: false,
          estimated: true,
        });
      }
    }
    out.push(b);
  }
  return { fixes: out, gaps };
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
 * Vyzerá dopyt ako evidenčná značka (OM-BYK, N123AB, D-AISP)? Pure.
 * Značka má písmeno a buď pomlčku, alebo tvar prefix+koncovka, a NIE je to
 * čistý 6-znakový hex (ten je priamo id stroja) — vtedy ju treba najprv
 * preložiť na hex cez adsbdb (2026-09-15, „dohľadať flotilu podľa značky").
 * @param {string} query
 * @returns {boolean}
 */
export function looksLikeRegistration(query) {
  const q = String(query ?? '').trim().toUpperCase();
  if (!q || /^[0-9A-F]{6}$/.test(q)) return false; // hex = priame id, nie značka
  if (/-/.test(q) && /[A-Z]/.test(q) && /^[A-Z0-9-]{3,10}$/.test(q)) return true; // OM-BYK, D-AISP…
  if (/^N[0-9]{1,5}[A-Z]{0,2}$/.test(q)) return true; // US N-číslo bez pomlčky
  return false;
}

/**
 * Značka → ICAO hex cez `/api/adsbdb/reg/<značka>`. Null, keď adsbdb stroj
 * nepozná alebo pri chybe. Pure nad `fetcher`.
 * @param {string} registration
 * @param {{fetcher?: Function}} [options]
 * @returns {Promise<{hex: string, registration: string|null, typeCode: string|null}|null>}
 */
export async function resolveRegistrationHex(registration, { fetcher = globalThis.fetch } = {}) {
  const reg = String(registration ?? '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (!reg) return null;
  try {
    const data = await getJson(`/api/adsbdb/reg/${encodeURIComponent(reg)}`, fetcher);
    const hex = typeof data?.modeS === 'string' && /^[0-9a-f]{6}$/.test(data.modeS) ? data.modeS : null;
    return hex ? { hex, registration: data.registration || reg, typeCode: data.typeCode || null } : null;
  } catch {
    return null;
  }
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
