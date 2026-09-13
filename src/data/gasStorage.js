// src/data/gasStorage.js
/**
 * @module gasStorage
 * @description Zásobníky plynu (GIE AGSI+) a LNG terminály (GIE ALSI) pre
 * panel PLYN (2026-09-13, používateľ: „zásobníky, naplnenie, LNG a plyn sú
 * teraz in"). Čistý modul (bez i18n a DOM): URL na GIE API, normalizácia
 * riadkov (API vracia čísla ako reťazce, chýbajúce ako „-"), zostava odpovede
 * proxy a modely kariet ZÁSOBNÍKY a LNG. Servíruje proxy `/api/gas/storage`
 * a `/api/gas/lng` (vite.config.js, `gasProxy()`), kľúč `GIE_API_KEY` z .env
 * ide v hlavičke `x-key` len zo servera.
 *
 * Podmienky GIE (API User Manual, registrácia 2026-09-13): „All data
 * published on AGSI & ALSI can be used or repackaged in any way you see fit
 * but a clear indication on GIE as data source is mandatory. A mention of
 * GIE, AGSI or ALSI (as applicable) as data source is a minimum requirement."
 * → `GIE_ATTRIBUTION` v päte karty a v kredite vrstvy.
 *
 * Overené naživo 2026-09-13: `size` až 2000 (5 rokov EÚ = 1 837 dní jedným
 * dopytom), `from`/`to` v dňoch, `continent=EU` = agregát EÚ, `country=SK`;
 * `date=` bez filtra vracia len kontinenty, preto krajiny idú po jednom.
 * AGSI polia: gasDayStart, full (% pracovného objemu), gasInStorage a
 * workingGasVolume (TWh), injection a withdrawal (GWh/d), trend (pb/d),
 * consumptionFull (% ročnej spotreby), status E = odhad, C = potvrdené.
 * ALSI: inventory {gwh}, dtmi {gwh} (deklarované maximum), sendOut (GWh/d),
 * dtrs (deklarované referenčné vyskladnenie).
 */
import { formatDateLabel } from './gasPrices.js';
import { formatGwhDay } from './gasFlows.js';

export const GAS_STORAGE_API = '/api/gas/storage';
export const GAS_LNG_API = '/api/gas/lng';
export const AGSI_API = 'https://agsi.gie.eu/api';
export const ALSI_API = 'https://alsi.gie.eu/api';
export const GIE_ATTRIBUTION = 'GIE AGSI+ / ALSI';
/** EÚ agregát drží 5 rokov (pás 5 rokov v grafe), krajiny 400 dní (medziročné porovnanie). */
export const GAS_STORAGE_HISTORY_DAYS = 5 * 366;
export const GAS_STORAGE_COUNTRY_DAYS = 400;
/** Krajiny s históriou (SK, UA) a krajiny len s posledným dňom. */
export const GAS_STORAGE_HISTORY_COUNTRIES = Object.freeze(['SK', 'UA']);
export const GAS_STORAGE_LATEST_COUNTRIES = Object.freeze(['AT', 'CZ', 'HU', 'PL', 'DE', 'IT', 'FR', 'NL']);
export const GAS_LNG_LATEST_COUNTRIES = Object.freeze(['PL', 'DE', 'NL', 'BE', 'FR', 'ES', 'IT', 'GR', 'HR', 'LT']);
export const GIE_STALE_DAYS = 4;
export const GAS_STORAGE_RANGES = Object.freeze(['1y', '5y']);

const DAY_MS = 86_400_000;
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

export function num(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s || s === '-') return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {string} base AGSI_API | ALSI_API
 * @param {{country?: string, continent?: string, from?: string, to?: string, size?: number}} q
 */
export function gieUrl(base, { country, continent, from, to, size } = {}) {
  const url = new URL(base);
  if (continent) url.searchParams.set('continent', continent);
  if (country) url.searchParams.set('country', country);
  if (from) url.searchParams.set('from', from);
  if (to) url.searchParams.set('to', to);
  if (size) url.searchParams.set('size', String(size));
  return url.toString();
}

/** Plán dopytov AGSI: EÚ 5 rokov, SK a UA 400 dní, ostatné krajiny posledné 3 dni. */
export function agsiPlan(nowMs) {
  const to = isoDay(nowMs);
  return [
    { key: 'eu', url: gieUrl(AGSI_API, { continent: 'EU', from: isoDay(nowMs - GAS_STORAGE_HISTORY_DAYS * DAY_MS), to, size: 2000 }) },
    ...GAS_STORAGE_HISTORY_COUNTRIES.map((c) => ({ key: c, url: gieUrl(AGSI_API, { country: c, from: isoDay(nowMs - GAS_STORAGE_COUNTRY_DAYS * DAY_MS), to, size: 500 }) })),
    ...GAS_STORAGE_LATEST_COUNTRIES.map((c) => ({ key: c, url: gieUrl(AGSI_API, { country: c, size: 3 }) })),
  ];
}

/** Plán dopytov ALSI: EÚ 400 dní, krajiny posledné 3 dni. */
export function alsiPlan(nowMs) {
  const to = isoDay(nowMs);
  return [
    { key: 'eu', url: gieUrl(ALSI_API, { continent: 'EU', from: isoDay(nowMs - GAS_STORAGE_COUNTRY_DAYS * DAY_MS), to, size: 500 }) },
    ...GAS_LNG_LATEST_COUNTRIES.map((c) => ({ key: c, url: gieUrl(ALSI_API, { country: c, size: 3 }) })),
  ];
}

/**
 * AGSI riadky → vzostupný rad (API vracia zostupne). Chýbajúce „-" → null.
 * @param {any[]} rows
 */
export function normalizeAgsiRows(rows) {
  const out = [];
  for (const r of rows || []) {
    const date = String(r?.gasDayStart ?? '').slice(0, 10);
    if (!ISO_DAY_RE.test(date)) continue;
    const gasInStorage = num(r.gasInStorage);
    const workingGasVolume = num(r.workingGasVolume);
    let full = num(r.full);
    if (full === null && gasInStorage !== null && workingGasVolume) full = Math.round((gasInStorage / workingGasVolume) * 10000) / 100;
    const injection = num(r.injection);
    const withdrawal = num(r.withdrawal);
    out.push({
      date,
      full,
      gasInStorage,
      workingGasVolume,
      injection,
      withdrawal,
      net: injection !== null && withdrawal !== null ? Math.round((injection - withdrawal) * 100) / 100 : null,
      trend: num(r.trend),
      consumptionFull: num(r.consumptionFull),
      status: r.status === 'E' ? 'E' : (r.status === 'C' ? 'C' : null),
      updatedAt: r.updatedAt ? String(r.updatedAt) : null,
    });
  }
  const byDate = new Map();
  for (const r of out) byDate.set(r.date, r);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * ALSI riadky → vzostupný rad. `inventory`/`dtmi` sú objekty {lng, gwh}.
 * @param {any[]} rows
 */
export function normalizeAlsiRows(rows) {
  const out = [];
  for (const r of rows || []) {
    const date = String(r?.gasDayStart ?? '').slice(0, 10);
    if (!ISO_DAY_RE.test(date)) continue;
    const inventoryGwh = num(r?.inventory?.gwh ?? r?.inventory);
    const dtmiGwh = num(r?.dtmi?.gwh ?? r?.dtmi);
    out.push({
      date,
      inventoryGwh,
      dtmiGwh,
      fullPct: inventoryGwh !== null && dtmiGwh ? Math.round((inventoryGwh / dtmiGwh) * 1000) / 10 : null,
      sendOut: num(r.sendOut),
      dtrs: num(r.dtrs),
      status: r.status === 'E' ? 'E' : (r.status === 'C' ? 'C' : null),
      updatedAt: r.updatedAt ? String(r.updatedAt) : null,
    });
  }
  const byDate = new Map();
  for (const r of out) byDate.set(r.date, r);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Serverová zostava: výsledky po kľúčoch plánu ({ eu: rows, SK: rows, … };
 * chýbajúci kľúč = dopyt zlyhal) → payload pre klienta.
 * @param {'agsi'|'alsi'} kind
 * @param {Record<string, any[]>} results
 * @param {{fetchedAt?: number, errors?: Record<string, string>}} [o]
 */
export function buildGiePayload(kind, results, { fetchedAt = Date.now(), errors = {} } = {}) {
  const normalize = kind === 'alsi' ? normalizeAlsiRows : normalizeAgsiRows;
  const plan = kind === 'alsi' ? [...GAS_LNG_LATEST_COUNTRIES] : [...GAS_STORAGE_HISTORY_COUNTRIES, ...GAS_STORAGE_LATEST_COUNTRIES];
  return {
    kind,
    eu: { series: normalize(results?.eu || []) },
    countries: plan.map((code) => ({ code, series: normalize(results?.[code] || []), error: errors?.[code] ?? null })),
    fetchedAt,
    source: kind === 'alsi' ? 'GIE ALSI · LNG terminals' : 'GIE AGSI+ · gas storage',
    attribution: GIE_ATTRIBUTION,
  };
}

/** Hodnota `key` v rade približne pred rokom (±3 dni), inak null. */
export function yearAgoValue(series, date, key = 'full') {
  const target = Date.UTC(Number(date.slice(0, 4)) - 1, Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  let best = null; let bestDiff = 4 * DAY_MS;
  for (const r of series || []) {
    const t = Date.UTC(Number(r.date.slice(0, 4)), Number(r.date.slice(5, 7)) - 1, Number(r.date.slice(8, 10)));
    const diff = Math.abs(t - target);
    if (diff < bestDiff && Number.isFinite(r[key])) { best = r[key]; bestDiff = diff; }
  }
  return best;
}

const locale = (lang) => (lang === 'sk' ? 'sk-SK' : 'en-GB');
const fmt = (value, lang, digits) => new Intl.NumberFormat(locale(lang), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);

export function formatPctFull(value, lang = 'sk') {
  return Number.isFinite(value) ? `${fmt(value, lang, 1)} %` : '—';
}
export function formatTwh(value, lang = 'sk') {
  return Number.isFinite(value) ? `${fmt(value, lang, value >= 100 ? 0 : 1)} TWh` : '—';
}
export function formatGwh(value, lang = 'sk') {
  return Number.isFinite(value) ? `${fmt(value, lang, 0)} GWh` : '—';
}
/** Názov krajiny v jazyku UI (Intl.DisplayNames), inak kód. */
export function countryName(code, lang = 'sk') {
  if (code === 'eu') return lang === 'sk' ? 'EÚ' : 'EU';
  try { return new Intl.DisplayNames([locale(lang)], { type: 'region' }).of(code) || code; } catch { return code; }
}

async function fetchJson(url, fetcher) {
  const response = await fetcher(url, { cache: 'no-store' });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(json?.error ? String(json.error) : `HTTP ${response.status}`);
    err.status = response.status;
    err.code = json?.error ?? null;
    throw err;
  }
  return json;
}
export async function fetchGasStorage({ fetcher = (...a) => fetch(...a), url = GAS_STORAGE_API } = {}) { return fetchJson(url, fetcher); }
export async function fetchGasLng({ fetcher = (...a) => fetch(...a), url = GAS_LNG_API } = {}) { return fetchJson(url, fetcher); }

function freshnessOf(latestDate, nowMs) {
  const ageDays = latestDate ? Math.floor((nowMs - Date.UTC(Number(latestDate.slice(0, 4)), Number(latestDate.slice(5, 7)) - 1, Number(latestDate.slice(8, 10)))) / DAY_MS) : null;
  return { latestDate, ageDays, stale: latestDate === null || (Number.isFinite(ageDays) && ageDays > GIE_STALE_DAYS) };
}

/**
 * Model karty ZÁSOBNÍKY (čistý; DOM skladá gasPanel.js).
 * @param {object|null} payload výstup buildGiePayload('agsi', …)
 * @param {{lang?: string, translate?: (k: string, v?: object) => string, nowMs?: number, range?: '1y'|'5y'}} [o]
 */
export function buildStorageModel(payload, { lang = 'sk', translate = (key) => key, nowMs = Date.now(), range = '1y' } = {}) {
  const eu = Array.isArray(payload?.eu?.series) ? payload.eu.series : [];
  if (!eu.length) return { ok: false, reason: 'empty' };
  const last = eu[eu.length - 1];
  const yearAgo = yearAgoValue(eu, last.date, 'full');
  const days = Number.isFinite(last.consumptionFull) ? Math.round((last.consumptionFull / 100) * 365) : null;
  const headline = {
    fullPct: last.full,
    fullText: formatPctFull(last.full, lang),
    twhText: translate('gas.storage-twh', { a: formatTwh(last.gasInStorage, lang), b: formatTwh(last.workingGasVolume, lang) }),
    netText: Number.isFinite(last.net) ? translate(last.net >= 0 ? 'gas.storage-net-in' : 'gas.storage-net-out', { v: formatGwhDay(Math.abs(last.net), lang) }) : '',
    yearAgoText: Number.isFinite(yearAgo) ? translate('gas.storage-year-ago', { v: formatPctFull(yearAgo, lang) }) : '',
    daysText: days !== null ? translate('gas.storage-days', { d: fmt(days, lang, 0) }) : '',
    dateText: formatDateLabel(last.date, lang),
    statusText: last.status ? translate(last.status === 'E' ? 'gas.status-estimated' : 'gas.status-confirmed') : '',
    dir: Number.isFinite(last.net) ? (last.net > 0 ? 'up' : (last.net < 0 ? 'down' : 'flat')) : 'flat',
  };
  const floor = nowMs - (range === '5y' ? GAS_STORAGE_HISTORY_DAYS : 366) * DAY_MS;
  const points = eu.filter((r) => Number.isFinite(r.full) && Date.UTC(Number(r.date.slice(0, 4)), Number(r.date.slice(5, 7)) - 1, Number(r.date.slice(8, 10))) >= floor)
    .map((r) => ({ t: Date.UTC(Number(r.date.slice(0, 4)), Number(r.date.slice(5, 7)) - 1, Number(r.date.slice(8, 10))), v: r.full }));
  const rows = (payload.countries || []).map((c) => {
    const s = c.series || [];
    const r = s.length ? s[s.length - 1] : null;
    const ya = r ? yearAgoValue(s, r.date, 'full') : null;
    return {
      code: c.code,
      name: countryName(c.code, lang),
      level: r ? 'ok' : 'nodata',
      fullPct: r?.full ?? null,
      fullText: r ? formatPctFull(r.full, lang) : translate('gas.flow-nodata'),
      sub: r ? [
        translate('gas.storage-twh', { a: formatTwh(r.gasInStorage, lang), b: formatTwh(r.workingGasVolume, lang) }),
        Number.isFinite(r.net) ? translate(r.net >= 0 ? 'gas.storage-net-in' : 'gas.storage-net-out', { v: formatGwhDay(Math.abs(r.net), lang) }) : '',
        Number.isFinite(ya) ? translate('gas.storage-year-ago', { v: formatPctFull(ya, lang) }) : '',
        formatDateLabel(r.date, lang, { year: false }),
      ].filter(Boolean).join(' · ') : (c.error || ''),
    };
  });
  return {
    ok: true,
    range,
    headline,
    chart: { unit: '%', series: points.length >= 2 ? [{ key: 'eu-full', points }] : [] },
    rows,
    note: translate('gas.storage-note'),
    sourceLine: translate('gas.gie-source'),
    freshness: { fetchedAt: payload?.fetchedAt ?? null, ...freshnessOf(last.date, nowMs) },
  };
}

/**
 * Model karty LNG.
 * @param {object|null} payload výstup buildGiePayload('alsi', …)
 */
export function buildLngModel(payload, { lang = 'sk', translate = (key) => key, nowMs = Date.now() } = {}) {
  const eu = Array.isArray(payload?.eu?.series) ? payload.eu.series : [];
  if (!eu.length) return { ok: false, reason: 'empty' };
  const last = eu[eu.length - 1];
  const headline = {
    sendOut: last.sendOut,
    sendOutText: formatGwhDay(last.sendOut, lang),
    inventoryText: translate('gas.lng-inventory', { v: formatGwh(last.inventoryGwh, lang), b: formatGwh(last.dtmiGwh, lang), p: formatPctFull(last.fullPct, lang) }),
    dateText: formatDateLabel(last.date, lang),
    statusText: last.status ? translate(last.status === 'E' ? 'gas.status-estimated' : 'gas.status-confirmed') : '',
  };
  const floor = nowMs - 366 * DAY_MS;
  const points = eu.filter((r) => Number.isFinite(r.sendOut) && Date.UTC(Number(r.date.slice(0, 4)), Number(r.date.slice(5, 7)) - 1, Number(r.date.slice(8, 10))) >= floor)
    .map((r) => ({ t: Date.UTC(Number(r.date.slice(0, 4)), Number(r.date.slice(5, 7)) - 1, Number(r.date.slice(8, 10))), v: r.sendOut }));
  const rows = (payload.countries || []).map((c) => {
    const s = c.series || [];
    const r = s.length ? s[s.length - 1] : null;
    return {
      code: c.code,
      name: countryName(c.code, lang),
      level: r ? (Number.isFinite(r.sendOut) && r.sendOut >= 0.5 ? 'ok' : 'zero') : 'nodata',
      sendOutText: r ? formatGwhDay(r.sendOut, lang) : translate('gas.flow-nodata'),
      sub: r ? [
        Number.isFinite(r.fullPct) ? translate('gas.lng-tanks', { p: formatPctFull(r.fullPct, lang) }) : '',
        formatDateLabel(r.date, lang, { year: false }),
      ].filter(Boolean).join(' · ') : (c.error || ''),
    };
  });
  return {
    ok: true,
    headline,
    chart: { unit: 'GWh/d', series: points.length >= 2 ? [{ key: 'eu-sendout', points }] : [] },
    rows,
    note: translate('gas.lng-note'),
    sourceLine: translate('gas.gie-source'),
    freshness: { fetchedAt: payload?.fetchedAt ?? null, ...freshnessOf(last.date, nowMs) },
  };
}
