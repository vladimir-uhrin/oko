// src/data/oilPrices.js
/**
 * @module oilPrices
 * @description Ceny ropy a energetických komodít pre kartu ROPA (2026-09-17,
 * variant B; používateľ chcel čerstvé + viac informácií). Zdroj Yahoo Finance
 * chart API (keyless, jedno volanie na symbol, ročná denná séria):
 *   Brent BZ=F, WTI CL=F  — front-month ≈ spot, $/bbl (hlavné, s detailom)
 *   NG=F, RB=F, HO=F      — zemný plyn / benzín / nafta (kompaktne)
 *   EURUSD=X              — kurz na prepočet do EUR
 *
 * POCTIVOSŤ (pravidlo 2 CLAUDE.md): front-month FUTURES, nie čistý spot, ~15 min
 * oneskorené; karta to hovorí. Denná zmena sa počíta z DENNEJ SÉRIE (posledné dva
 * záznamy), NIE z Yahoo `chartPreviousClose` — ten je pri rolovaní futures
 * kontraktu nespoľahlivý (skáče o desiatky %). Yahoo je NEOFICIÁLNE API, ToS len
 * osobné/nekomerčné (DATA_SOURCES.md). Modul je čistý (bez DOM).
 */

import { formatPct } from './gasPrices.js';

export const OIL_PRICES_API = '/api/oil/prices';
/** Yahoo symboly: ropa (detail), energetické komodity (kompakt), kurz EUR. */
export const YAHOO_SYMBOLS = Object.freeze({
  brent: 'BZ=F',
  wti: 'CL=F',
  eurusd: 'EURUSD=X',
  natgas: 'NG=F',
  gasoline: 'RB=F',
  diesel: 'HO=F',
});
/** Units per commodity (Yahoo quotes these in USD per the listed unit). */
export const COMMODITY_UNITS = Object.freeze({ natgas: '$/MMBtu', gasoline: '$/gal', diesel: '$/gal' });

const DAY_MS = 86_400_000;

/** Keyless Yahoo chart endpoint. A one-year daily series backs the period changes and the chart ranges. */
export function yahooChartUrl(symbol, { range = '1y', interval = '1d' } = {}) {
  const s = encodeURIComponent(String(symbol));
  return `https://query1.finance.yahoo.com/v8/finance/chart/${s}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
}

const localeOf = (lang) => (lang === 'sk' ? 'sk-SK' : 'en-GB');
const num = (value, lang, digits = 2) => (Number.isFinite(value)
  ? new Intl.NumberFormat(localeOf(lang), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
  : '—');

/** `130,80 $/bbl`; null → `—`. */
export function formatUsdBbl(value, lang = 'sk', digits = 2) {
  return Number.isFinite(value) ? `${num(value, lang, digits)} $/bbl` : '—';
}
/** `113,95 €/bbl`; null → `—`. */
export function formatEurBbl(value, lang = 'sk', digits = 2) {
  return Number.isFinite(value) ? `${num(value, lang, digits)} €/bbl` : '—';
}
/** `17. 9. · 17:46`. */
export function formatStamp(ms, lang = 'sk') {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const day = new Intl.DateTimeFormat(localeOf(lang), { day: 'numeric', month: 'short' }).format(d);
  const time = new Intl.DateTimeFormat(localeOf(lang), { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${day} · ${time}`;
}

/**
 * % change of `currentPrice` versus the daily close closest to `days` ago.
 * Series-based (robust to the futures-roll break in Yahoo's chartPreviousClose).
 * @param {Array<{t:number,v:number}>} series ascending daily {t(ms), v}
 * @param {number} days
 * @param {number} currentPrice
 * @returns {number|null} percent, or null when there is no reference point
 */
export function changeOverDays(series, days, currentPrice) {
  if (!Array.isArray(series) || !series.length || !Number.isFinite(currentPrice)) return null;
  const cutoff = series[series.length - 1].t - days * DAY_MS;
  let ref = null;
  for (const p of series) { if (p.t <= cutoff) ref = p; else break; }
  if (!ref) ref = series[0]; // cutoff older than the series → earliest available
  if (!Number.isFinite(ref?.v) || ref.v === 0) return null;
  return ((currentPrice - ref.v) / ref.v) * 100;
}

/**
 * One Yahoo chart response → a normalized quote. Pure. null without a price.
 * @param {any} json
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
    dayHigh: n(meta.regularMarketDayHigh),
    dayLow: n(meta.regularMarketDayLow),
    week52High: n(meta.fiftyTwoWeekHigh),
    week52Low: n(meta.fiftyTwoWeekLow),
    marketTimeMs: Number.isFinite(meta.regularMarketTime) ? meta.regularMarketTime * 1000 : null,
    currency: meta.currency || null,
    series,
  };
}

const dirOf = (pct) => (pct === null || pct === undefined ? 'flat' : (pct > 0 ? 'up' : (pct < 0 ? 'down' : 'flat')));

/**
 * Display model for the oil card. Period changes are all series-based (day = vs
 * the prior close), and each grade carries its 52-week position.
 * @param {{brent?:object, wti?:object, eurusd?:object, natgas?:object, gasoline?:object, diesel?:object, fetchedAt?:number}|null} payload
 * @param {{lang?:string, translate?:(k:string,v?:object)=>string}} [o]
 */
export function buildOilModel(payload, { lang = 'sk', translate = (key) => key } = {}) {
  const brentQ = payload?.brent;
  const wtiQ = payload?.wti;
  if (!brentQ && !wtiQ) return { ok: false, reason: 'empty' };
  const rate = Number.isFinite(payload?.eurusd?.price) && payload.eurusd.price > 0 ? payload.eurusd.price : null;

  const grade = (q, labelKey) => {
    if (!q || !Number.isFinite(q.price)) return null;
    const changes = {
      day: changeOverDays(q.series, 1, q.price),
      week: changeOverDays(q.series, 7, q.price),
      month: changeOverDays(q.series, 30, q.price),
      year: changeOverDays(q.series, 365, q.price),
    };
    const eur = rate ? q.price / rate : null;
    const range52 = (Number.isFinite(q.week52Low) && Number.isFinite(q.week52High) && q.week52High > q.week52Low)
      ? {
        low: q.week52Low,
        high: q.week52High,
        pos: Math.max(0, Math.min(1, (q.price - q.week52Low) / (q.week52High - q.week52Low))),
        belowHighPct: ((q.week52High - q.price) / q.week52High) * 100,
      }
      : null;
    const periods = ['day', 'week', 'month', 'year'].map((key) => ({
      key,
      pct: changes[key],
      pctText: formatPct(changes[key], lang),
      dir: dirOf(changes[key]),
    }));
    return {
      label: translate(labelKey),
      usd: q.price,
      usdText: formatUsdBbl(q.price, lang),
      eur,
      eurText: eur !== null ? formatEurBbl(eur, lang) : null,
      changes,
      periods,
      dayPctText: formatPct(changes.day, lang),
      dir: dirOf(changes.day),
      range52,
      lowText: range52 ? num(range52.low, lang) : null,
      highText: range52 ? num(range52.high, lang) : null,
      belowHighText: range52 ? formatPct(-range52.belowHighPct, lang) : null,
      series: Array.isArray(q.series) ? q.series : [],
    };
  };
  const brent = grade(brentQ, 'oil.brent');
  const wti = grade(wtiQ, 'oil.wti');

  const commodity = (q, key) => {
    if (!q || !Number.isFinite(q.price)) return null;
    const day = changeOverDays(q.series, 1, q.price);
    return {
      key,
      label: translate(`oil.${key}`),
      unit: COMMODITY_UNITS[key],
      priceText: `${num(q.price, lang)} ${COMMODITY_UNITS[key]}`,
      dir: dirOf(day),
      pctText: formatPct(day, lang),
    };
  };
  const commodities = [
    commodity(payload?.natgas, 'natgas'),
    commodity(payload?.gasoline, 'gasoline'),
    commodity(payload?.diesel, 'diesel'),
  ].filter(Boolean);

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
    commodities,
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
