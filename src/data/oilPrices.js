// src/data/oilPrices.js
/**
 * @module oilPrices
 * @description Ceny ropy (Brent / WTI) pre chokepoint scény (2026-09-17,
 * variant B; používateľ chcel ČERSTVÚ cenu — FRED mešká 1–2 dni). Zdroj je
 * Yahoo Finance chart API (BZ=F, CL=F, EURUSD=X): near-real-time cena
 * front-month kontraktu (≈ spot), denná séria na graf, deň min/max, 52-týž a
 * kurz EUR — všetko keyless jedným volaním na symbol.
 *
 * POCTIVOSŤ (pravidlo 2 CLAUDE.md): je to FRONT-MONTH FUTURES, nie čistý spot,
 * a ~15 min oneskorené; karta to hovorí („front-month ≈ spot · Yahoo Finance").
 * Yahoo je NEOFICIÁLNE API a ToS nie je open-data → len osobné/nekomerčné
 * použitie (DATA_SOURCES.md). Modul je čistý (bez DOM): proxy ho importuje na
 * serveri na parsovanie, oilPriceChip.js na zobrazenie.
 */

import { formatPct } from './gasPrices.js';

export const OIL_PRICES_API = '/api/oil/prices';
/** Yahoo Finance symboly: Brent + WTI front-month futures, EUR/USD kurz. */
export const YAHOO_SYMBOLS = Object.freeze({ brent: 'BZ=F', wti: 'CL=F', eurusd: 'EURUSD=X' });

/** Keyless Yahoo chart endpoint (denné sviečky za dané obdobie). */
export function yahooChartUrl(symbol, { range = '6mo', interval = '1d' } = {}) {
  const s = encodeURIComponent(String(symbol));
  return `https://query1.finance.yahoo.com/v8/finance/chart/${s}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
}

const localeOf = (lang) => (lang === 'sk' ? 'sk-SK' : 'en-GB');
const num = (value, lang, digits = 2) => (Number.isFinite(value)
  ? new Intl.NumberFormat(localeOf(lang), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
  : '—');

/** `130,80 $/bbl` (SK) / `130.80 $/bbl` (EN); null → `—`. */
export function formatUsdBbl(value, lang = 'sk', digits = 2) {
  return Number.isFinite(value) ? `${num(value, lang, digits)} $/bbl` : '—';
}
/** `113,95 €/bbl`; null → `—`. */
export function formatEurBbl(value, lang = 'sk', digits = 2) {
  return Number.isFinite(value) ? `${num(value, lang, digits)} €/bbl` : '—';
}

/** `17. 9. · 17:46` (SK) / `17 Sep · 17:46` (EN). */
export function formatStamp(ms, lang = 'sk') {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const day = new Intl.DateTimeFormat(localeOf(lang), { day: 'numeric', month: 'short' }).format(d);
  const time = new Intl.DateTimeFormat(localeOf(lang), { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${day} · ${time}`;
}

/**
 * One Yahoo chart response → a normalized quote. Pure. Returns null when the
 * payload has no usable price.
 * @param {any} json
 * @returns {null | {symbol: string|null, price: number, prevClose: number|null, dayHigh: number|null, dayLow: number|null, week52High: number|null, week52Low: number|null, marketTimeMs: number|null, currency: string|null, series: Array<{t: number, v: number}>}}
 */
export function parseYahooChart(json) {
  const result = json?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta || !Number.isFinite(meta.regularMarketPrice)) return null;
  const ts = Array.isArray(result.timestamp) ? result.timestamp : [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const series = [];
  for (let i = 0; i < ts.length; i += 1) {
    const v = closes[i];
    if (Number.isFinite(ts[i]) && Number.isFinite(v)) series.push({ t: ts[i] * 1000, v });
  }
  const n = (x) => (Number.isFinite(x) ? x : null);
  return {
    symbol: meta.symbol || null,
    price: meta.regularMarketPrice,
    prevClose: n(meta.chartPreviousClose),
    dayHigh: n(meta.regularMarketDayHigh),
    dayLow: n(meta.regularMarketDayLow),
    week52High: n(meta.fiftyTwoWeekHigh),
    week52Low: n(meta.fiftyTwoWeekLow),
    marketTimeMs: Number.isFinite(meta.regularMarketTime) ? meta.regularMarketTime * 1000 : null,
    currency: meta.currency || null,
    series,
  };
}

/**
 * Display model for the oil card. Change is computed here from price vs the
 * previous close (known scale), not read off Yahoo's own percent field.
 * @param {{brent?: object, wti?: object, eurusd?: object, fetchedAt?: number}|null} payload
 * @param {{lang?: string, translate?: (k: string, v?: object) => string, nowMs?: number}} [o]
 */
export function buildOilModel(payload, { lang = 'sk', translate = (key) => key } = {}) {
  const brentQ = payload?.brent;
  const wtiQ = payload?.wti;
  if (!brentQ && !wtiQ) return { ok: false, reason: 'empty' };
  const rate = Number.isFinite(payload?.eurusd?.price) && payload.eurusd.price > 0 ? payload.eurusd.price : null;

  const grade = (q, labelKey) => {
    if (!q || !Number.isFinite(q.price)) return null;
    const changeAbs = Number.isFinite(q.prevClose) ? q.price - q.prevClose : null;
    const changePct = (changeAbs !== null && q.prevClose) ? (changeAbs / q.prevClose) * 100 : null;
    const eur = rate ? q.price / rate : null;
    return {
      label: translate(labelKey),
      usd: q.price,
      usdText: formatUsdBbl(q.price, lang),
      eur,
      eurText: eur !== null ? formatEurBbl(eur, lang) : null,
      changeAbs,
      changePct,
      pctText: formatPct(changePct, lang),
      dir: changePct === null ? 'flat' : (changePct > 0 ? 'up' : (changePct < 0 ? 'down' : 'flat')),
      dayLow: q.dayLow,
      dayHigh: q.dayHigh,
      dayRangeText: (Number.isFinite(q.dayLow) && Number.isFinite(q.dayHigh)) ? `${num(q.dayLow, lang)}–${num(q.dayHigh, lang)}` : null,
      week52Low: q.week52Low,
      week52High: q.week52High,
      week52Text: (Number.isFinite(q.week52Low) && Number.isFinite(q.week52High)) ? `${num(q.week52Low, lang)}–${num(q.week52High, lang)}` : null,
      series: Array.isArray(q.series) ? q.series : [],
    };
  };
  const brent = grade(brentQ, 'oil.brent');
  const wti = grade(wtiQ, 'oil.wti');
  const spread = (brent && wti) ? brent.usd - wti.usd : null;
  const marketTimeMs = Math.max(brentQ?.marketTimeMs || 0, wtiQ?.marketTimeMs || 0) || null;
  const chartSeries = [];
  if (brent?.series?.length) chartSeries.push({ key: 'brent', points: brent.series });
  if (wti?.series?.length) chartSeries.push({ key: 'wti', points: wti.series });

  return {
    ok: true,
    brent,
    wti,
    spread,
    spreadText: spread !== null ? `${spread >= 0 ? '+' : '−'}${num(Math.abs(spread), lang)} $` : null,
    eurusd: rate,
    chart: { unit: '$/bbl', series: chartSeries },
    marketTimeMs,
    stampText: marketTimeMs ? formatStamp(marketTimeMs, lang) : '—',
    sourceLine: translate('oil.source', { time: marketTimeMs ? formatStamp(marketTimeMs, lang) : '—' }),
    freshness: { fetchedAt: payload?.fetchedAt ?? null, marketTimeMs },
  };
}

/**
 * Fetch from the proxy. Proxy error = throw (card shows „unavailable"),
 * 502/503 carries `{error:'…'}`.
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
