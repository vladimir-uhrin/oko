// src/data/oilPrices.js
/**
 * @module oilPrices
 * @description Ceny ropy (Brent / WTI) pre chokepoint scény (2026-09-17,
 * pokračovanie „chokehold on oil" reveal-u — používateľ: variant B). Reálne
 * SPOTOVÉ ceny, nie odvodené: front-month futures (EEX/ICE) sú platené a sem
 * nepatria — spot z verejného zdroja stačí na kontext pri úžine.
 *
 * Zdroj: FRED keyless CSV (`fredgraph.csv?id=…`), rovnaký zdrojový rod ako pri
 * cenách plynu (pozri gasPrices.js), takže parser aj formátovanie sú zdieľané:
 *  - DCOILBRENTEU — Crude Oil Prices: Brent – Europe (USD/barrel, denne)
 *  - DCOILWTICO   — Crude Oil Prices: WTI – Cushing, OK (USD/barrel, denne)
 * Podkladové dáta sú U.S. EIA (federálne, public domain); FRED ich len
 * redistribuuje. Servíruje ich proxy `/api/oil/prices` (vite.config.js). Modul
 * je čistý (bez i18n/DOM): importuje ho aj server v proxy.
 */

import {
  dateToMs,
  fredCsvUrl,
  formatDateLabel,
  formatPct,
  latestWithChange,
  parseFredCsv,
  sliceByRange,
} from './gasPrices.js';

export const OIL_PRICES_API = '/api/oil/prices';
export const FRED_BRENT_SERIES = 'DCOILBRENTEU';
export const FRED_WTI_SERIES = 'DCOILWTICO';
/** Po tomto veku posledného denného záznamu je rad „zastaraný" (víkend + sviatok). */
export const OIL_PRICES_STALE_DAYS = 5;

const DAY_MS = 86_400_000;

/** Dve keyless FRED CSV adresy, ktoré proxy sťahuje na serveri. */
export function oilFredUrls() {
  return { brent: fredCsvUrl(FRED_BRENT_SERIES), wti: fredCsvUrl(FRED_WTI_SERIES) };
}

const localeOf = (lang) => (lang === 'sk' ? 'sk-SK' : 'en-GB');

/** `130,80 $/bbl` (SK) / `130.80 $/bbl` (EN); null → `—`. */
export function formatUsdBbl(value, lang = 'sk', digits = 2) {
  if (!Number.isFinite(value)) return '—';
  const n = new Intl.NumberFormat(localeOf(lang), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  return `${n} $/bbl`;
}

/**
 * Model dvojice cien (Brent + WTI) pre chip. Čistý; DOM skladá oilPriceChip.js.
 * @param {{brent?: {rows?: any[]}, wti?: {rows?: any[]}, fetchedAt?: number}|null} payload
 * @param {{lang?: string, translate?: (k: string, v?: object) => string, nowMs?: number, range?: '1m'|'1y'|'max'}} [o]
 */
export function buildOilModel(payload, { lang = 'sk', translate = (key) => key, nowMs = Date.now(), range = '1m' } = {}) {
  const brentRows = Array.isArray(payload?.brent?.rows) ? payload.brent.rows : [];
  const wtiRows = Array.isArray(payload?.wti?.rows) ? payload.wti.rows : [];
  if (!brentRows.length && !wtiRows.length) return { ok: false, reason: 'empty' };

  const head = (rows, labelKey) => {
    const lw = latestWithChange(rows, 'value');
    if (!lw) return null;
    return {
      label: translate(labelKey),
      value: lw.row.value,
      text: formatUsdBbl(lw.row.value, lang),
      date: lw.row.date,
      dateText: formatDateLabel(lw.row.date, lang),
      delta: lw.delta,
      pct: lw.pct,
      pctText: formatPct(lw.pct, lang),
      dir: lw.delta === null ? 'flat' : (lw.delta > 0 ? 'up' : (lw.delta < 0 ? 'down' : 'flat')),
    };
  };
  const brent = head(brentRows, 'oil.brent');
  const wti = head(wtiRows, 'oil.wti');

  const points = (rows) => sliceByRange(rows, range, nowMs)
    .filter((r) => Number.isFinite(r.value))
    .map((r) => ({ t: dateToMs(r.date), v: r.value }));
  const spark = { brent: points(brentRows), wti: points(wtiRows) };

  const latestDate = [brent?.date, wti?.date].filter(Boolean).sort().pop() || null;
  const ageDays = latestDate ? Math.floor((nowMs - dateToMs(latestDate)) / DAY_MS) : null;
  const stale = Number.isFinite(ageDays) && ageDays > OIL_PRICES_STALE_DAYS;

  return {
    ok: true,
    brent,
    wti,
    spark,
    sourceLine: translate('oil.source', { date: latestDate ? formatDateLabel(latestDate, lang) : '—' }),
    freshness: { fetchedAt: payload?.fetchedAt ?? null, latestDate, ageDays, stale },
  };
}

/**
 * Stiahni ceny z proxy. Chyba proxy = výnimka (chip ju ukáže ako „nedostupné"),
 * 502/503 nesie `{error:'…'}` vysvetlenie.
 * @param {{fetcher?: typeof fetch, url?: string}} [o]
 */
export async function fetchOilPrices({ fetcher = (...a) => fetch(...a), url = OIL_PRICES_API } = {}) {
  const response = await fetcher(url, { cache: 'no-store' });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(json?.error ? String(json.error) : `HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return json;
}
