// src/data/gasPrices.js
/**
 * @module gasPrices
 * @description Ceny plynu pre panel PLYN (2026-09-13, používateľ: „potrebujem
 * plyn kompletne EÚ a ZSSR … dôležité sú reálne dáta, ceny na burzách,
 * história" a hneď „platiť nechcem, nemám peniaze"). Čisté parsovanie a
 * odvodenie nad dvoma verejnými zdrojmi, ktoré servíruje proxy
 * `/api/gas/prices` (vite.config.js, `gasProxy()`):
 *
 *  - ACER TERMINAL (nariadenie Rady (EÚ) 2022/2576): denná cena LNG pre EÚ,
 *    SZ a J Európu v €/MWh a LNG benchmark. Benchmark je podľa nariadenia
 *    rozdiel medzi cenou LNG a settlementom TTF front-month (ICE Endex), takže
 *    TTF front-month sa dá ODVODIŤ: `ttf = eu − benchmark`. Odvodená hodnota
 *    nie je burzová kotácia — karta to hovorí (pravidlo 2 CLAUDE.md).
 *  - IMF Primary Commodity Prices cez FRED (PNGASEUUSDM): mesačná európska
 *    cena od 1992 v USD/MMBtu (dnes na báze TTF, historicky cena ruského
 *    plynu na nemeckej hranici). Prepočet na €/MWh cez mesačný priemer kurzu
 *    USD za EUR (FRED DEXUSEU) a 1 MMBtu = 0,293071 MWh.
 *
 * Burzové kotácie (EEX, ICE) sú len s platenou licenciou; sem nepatria.
 * Modul je čistý (bez i18n a DOM): importuje ho aj vite.config.js na serveri.
 */

export const GAS_PRICES_API = '/api/gas/prices';
/** 1 MMBtu v MWh (IEA/EIA konvencia 1 MMBtu = 293,071 kWh). */
export const MWH_PER_MMBTU = 0.29307107;
export const ACER_HISTORICAL_URL = 'https://aegis.acer.europa.eu/terminal/price_assessments/historical_data';
export const FRED_EU_GAS_SERIES = 'PNGASEUUSDM';
export const FRED_USD_PER_EUR_SERIES = 'DEXUSEU';
export const GAS_PRICE_RANGES = Object.freeze(['1m', '1y', 'max']);
/** Po tomto veku posledného denného záznamu je rad „zastaraný“ (víkend + sviatok = 4 dni). */
export const GAS_PRICES_STALE_DAYS = 5;

const DAY_MS = 86_400_000;

/** Keyless CSV endpoint FRED (`fredgraph.csv?id=…`). */
export function fredCsvUrl(seriesId) {
  return `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(String(seriesId))}`;
}

/**
 * Jeden riadok CSV s úvodzovkami (RFC 4180: `""` = úvodzovka v poli).
 * @param {string} line
 * @returns {string[]}
 */
export function parseCsvLine(line) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(field); field = ''; }
    else field += ch;
  }
  out.push(field);
  return out.map((s) => s.trim());
}

function num(value) {
  const s = String(value ?? '').trim().replace(',', '.');
  if (!s || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ACER TERMINAL historický CSV → denné riadky vzostupne podľa dátumu.
 * Hlavička (2026-09): DATE, NORTH-WEST EUROPE PRICE (EUR/MWh), SOUTH EUROPE
 * PRICE (EUR/MWh), EU PRICE (EUR/MWh), LNG BENCHMARK (EUR/MWh). Stĺpce sa
 * hľadajú podľa názvu, nie pozície. `ttf = eu − benchmark` (odvodené).
 * @param {string} text
 * @returns {Array<{date: string, nwe: number|null, south: number|null, eu: number|null, benchmark: number|null, ttf: number|null}>}
 */
export function parseAcerCsv(text) {
  const lines = String(text ?? '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.toUpperCase());
  const col = (re) => header.findIndex((h) => re.test(h));
  const iDate = col(/^DATE$/);
  const iNwe = col(/NORTH-?WEST/);
  const iSouth = col(/^SOUTH/);
  const iEu = col(/^EU PRICE/);
  const iBench = col(/BENCHMARK/);
  if (iDate < 0 || iEu < 0) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const f = parseCsvLine(lines[i]);
    const date = f[iDate];
    if (!ISO_DAY_RE.test(date)) continue;
    const eu = num(f[iEu]);
    const benchmark = iBench >= 0 ? num(f[iBench]) : null;
    rows.push({
      date,
      nwe: iNwe >= 0 ? num(f[iNwe]) : null,
      south: iSouth >= 0 ? num(f[iSouth]) : null,
      eu,
      benchmark,
      ttf: eu !== null && benchmark !== null ? Math.round((eu - benchmark) * 1000) / 1000 : null,
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

/**
 * FRED `fredgraph.csv`: prvý stĺpec dátum (observation_date alebo DATE),
 * druhý hodnota; chýbajúce hodnoty sú `.`.
 * @param {string} text
 * @returns {Array<{date: string, value: number}>}
 */
export function parseFredCsv(text) {
  const lines = String(text ?? '').split(/\r?\n/).filter((l) => l.trim());
  const rows = [];
  for (const line of lines) {
    const f = parseCsvLine(line);
    if (!ISO_DAY_RE.test(f[0] || '')) continue;
    const value = num(f[1]);
    if (value === null) continue;
    rows.push({ date: f[0], value });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

/**
 * Mesačné priemery denných hodnôt (kľúč `YYYY-MM`).
 * @param {Array<{date: string, value: number}>} rows
 * @returns {Map<string, number>}
 */
export function monthlyAverage(rows) {
  const sums = new Map();
  for (const r of rows || []) {
    const month = String(r.date).slice(0, 7);
    const acc = sums.get(month) || { sum: 0, n: 0 };
    acc.sum += r.value;
    acc.n += 1;
    sums.set(month, acc);
  }
  const out = new Map();
  for (const [month, { sum, n }] of sums) out.set(month, sum / n);
  return out;
}

/**
 * Mesačná európska cena z USD/MMBtu na €/MWh cez mesačný priemer kurzu
 * USD za EUR. Bez kurzu pre daný mesiac ostáva `eurMwh` null (rad sa
 * nevymýšľa).
 * @param {Array<{date: string, value: number}>} gasRows PNGASEUUSDM (mesačne, dátum = 1. deň)
 * @param {Array<{date: string, value: number}>} fxRows DEXUSEU (denne)
 * @returns {Array<{month: string, usdMmbtu: number, eurMwh: number|null}>}
 */
export function monthlyEurPerMwh(gasRows, fxRows) {
  const fx = monthlyAverage(fxRows);
  return (gasRows || []).map((r) => {
    const month = String(r.date).slice(0, 7);
    const rate = fx.get(month);
    const eurMwh = Number.isFinite(rate) && rate > 0 ? Math.round((r.value / MWH_PER_MMBTU / rate) * 100) / 100 : null;
    return { month, usdMmbtu: r.value, eurMwh };
  });
}

/** Deň `YYYY-MM-DD` alebo mesiac `YYYY-MM` → UTC ms. */
export function dateToMs(date) {
  const s = String(date || '');
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7)) || 1;
  const d = Number(s.slice(8, 10)) || 1;
  return Number.isFinite(y) && y > 0 ? Date.UTC(y, m - 1, d) : NaN;
}

/**
 * Výrez radu podľa rozsahu: `1m` = 31 dní, `1y` = 366 dní, `max` = všetko.
 * @template T
 * @param {T[]} rows
 * @param {'1m'|'1y'|'max'} range
 * @param {number} nowMs
 * @param {(row: T) => string} [dateOf]
 * @returns {T[]}
 */
export function sliceByRange(rows, range, nowMs, dateOf = (r) => r.date ?? r.month) {
  const list = rows || [];
  if (range === 'max') return list.slice();
  const days = range === '1y' ? 366 : 31;
  const floor = nowMs - days * DAY_MS;
  return list.filter((r) => dateToMs(dateOf(r)) >= floor);
}

/**
 * Posledný riadok s hodnotou v `key` a zmena oproti predchádzajúcemu takému riadku.
 * @param {Array<Record<string, any>>} rows vzostupne
 * @param {string} key
 * @returns {{row: object, prev: object|null, delta: number|null, pct: number|null}|null}
 */
export function latestWithChange(rows, key) {
  const valid = (rows || []).filter((r) => Number.isFinite(r?.[key]));
  if (!valid.length) return null;
  const row = valid[valid.length - 1];
  const prev = valid.length > 1 ? valid[valid.length - 2] : null;
  const delta = prev ? Math.round((row[key] - prev[key]) * 1000) / 1000 : null;
  const pct = prev && prev[key] !== 0 ? Math.round(((row[key] - prev[key]) / prev[key]) * 1000) / 10 : null;
  return { row, prev, delta, pct };
}

const locale = (lang) => (lang === 'sk' ? 'sk-SK' : 'en-GB');

/** `79,5 €/MWh` (SK) / `79.5 €/MWh` (EN); null → `—`. */
export function formatEurMwh(value, lang = 'sk', digits = 1) {
  if (!Number.isFinite(value)) return '—';
  return `${new Intl.NumberFormat(locale(lang), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)} €/MWh`;
}

/** €/MWh → ct/kWh (delené 10): `7,95 ct/kWh`. */
export function formatCtKwh(eurMwh, lang = 'sk') {
  if (!Number.isFinite(eurMwh)) return '—';
  return `${new Intl.NumberFormat(locale(lang), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(eurMwh / 10)} ct/kWh`;
}

/** Zmena so znamienkom: `+3,2 %` / `−1,0 %`; null → `—`. */
export function formatPct(pct, lang = 'sk') {
  if (!Number.isFinite(pct)) return '—';
  const sign = pct > 0 ? '+' : (pct < 0 ? '−' : '');
  return `${sign}${new Intl.NumberFormat(locale(lang), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.abs(pct))} %`;
}

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-09-11` → `11. 9. 2026` (SK) / `11 Sep 2026` (EN); `2026-09` → `9/2026` / `Sep 2026`. */
export function formatDateLabel(date, lang = 'sk', { year = true } = {}) {
  const s = String(date || '');
  const y = s.slice(0, 4);
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  if (!y || !m) return s;
  if (!d) return lang === 'sk' ? `${m}/${y}` : `${EN_MONTHS[m - 1]} ${y}`;
  if (lang === 'sk') return `${d}. ${m}.${year ? ` ${y}` : ''}`;
  return `${d} ${EN_MONTHS[m - 1]}${year ? ` ${y}` : ''}`;
}

/**
 * Stiahni ceny z proxy. Chyba proxy = výnimka (panel ju ukáže ako
 * „nedostupné“), 503 nesie `{error:'…'}` vysvetlenie.
 * @param {{fetcher?: typeof fetch, url?: string}} [o]
 */
export async function fetchGasPrices({ fetcher = (...a) => fetch(...a), url = GAS_PRICES_API } = {}) {
  const response = await fetcher(url, { cache: 'no-store' });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(json?.error ? String(json.error) : `HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return json;
}

/**
 * Model karty CENY pre panel (čistý; DOM skladá gasPanel.js).
 * @param {{acer?: {rows?: any[]}, monthly?: {rows?: any[]}, fetchedAt?: number}|null} payload
 * @param {{range?: '1m'|'1y'|'max', nowMs?: number, lang?: string, translate?: (k: string, v?: object) => string}} [o]
 */
export function buildPricesModel(payload, { range = '1m', nowMs = Date.now(), lang = 'sk', translate = (key) => key } = {}) {
  const acer = Array.isArray(payload?.acer?.rows) ? payload.acer.rows : [];
  const monthly = Array.isArray(payload?.monthly?.rows) ? payload.monthly.rows : [];
  if (!acer.length && !monthly.length) return { ok: false, reason: 'empty' };
  const latestTtf = latestWithChange(acer, 'ttf');
  const latestEu = latestWithChange(acer, 'eu');
  const head = latestTtf || latestEu;
  const headKey = latestTtf ? 'ttf' : 'eu';
  const headline = head ? {
    key: headKey,
    label: translate(headKey === 'ttf' ? 'gas.ttf-derived' : 'gas.eu-lng'),
    value: head.row[headKey],
    text: formatEurMwh(head.row[headKey], lang),
    date: head.row.date,
    dateText: formatDateLabel(head.row.date, lang),
    delta: head.delta,
    pct: head.pct,
    pctText: formatPct(head.pct, lang),
    dir: head.delta === null ? 'flat' : (head.delta > 0 ? 'up' : (head.delta < 0 ? 'down' : 'flat')),
    ctKwh: formatCtKwh(head.row[headKey], lang),
  } : null;
  const last = acer.length ? acer[acer.length - 1] : null;
  const rows = last ? [
    { key: 'eu', label: translate('gas.eu-lng'), text: formatEurMwh(last.eu, lang) },
    { key: 'nwe', label: translate('gas.nwe'), text: formatEurMwh(last.nwe, lang) },
    { key: 'south', label: translate('gas.south'), text: formatEurMwh(last.south, lang) },
  ] : [];
  const series = [];
  if (range === 'max') {
    const m = monthly.filter((r) => Number.isFinite(r.eurMwh));
    if (m.length) series.push({ key: 'monthly', label: translate('gas.monthly-label'), points: m.map((r) => ({ t: dateToMs(r.month), v: r.eurMwh })) });
    const daily = acer.filter((r) => Number.isFinite(r.ttf));
    if (daily.length) series.push({ key: 'ttf', label: translate('gas.ttf-derived'), points: daily.map((r) => ({ t: dateToMs(r.date), v: r.ttf })) });
  } else {
    const win = sliceByRange(acer, range, nowMs);
    const ttf = win.filter((r) => Number.isFinite(r.ttf));
    const eu = win.filter((r) => Number.isFinite(r.eu));
    if (ttf.length) series.push({ key: 'ttf', label: translate('gas.ttf-derived'), points: ttf.map((r) => ({ t: dateToMs(r.date), v: r.ttf })) });
    if (eu.length) series.push({ key: 'eu', label: translate('gas.eu-lng'), points: eu.map((r) => ({ t: dateToMs(r.date), v: r.eu })) });
  }
  const latestDate = last?.date || (monthly.length ? monthly[monthly.length - 1].month : null);
  const ageDays = latestDate ? Math.floor((nowMs - dateToMs(latestDate)) / DAY_MS) : null;
  const stale = Number.isFinite(ageDays) && ageDays > GAS_PRICES_STALE_DAYS;
  const sourceLines = [];
  if (last) sourceLines.push(translate('gas.source-acer', { date: formatDateLabel(last.date, lang) }));
  if (range === 'max' && monthly.length) sourceLines.push(translate('gas.source-monthly'));
  return {
    ok: true,
    range,
    headline,
    rows,
    chart: { unit: '€/MWh', series },
    note: translate('gas.ttf-derived-note'),
    laic: headline ? translate('gas.per-kwh', { ct: headline.ctKwh }) : '',
    sourceLines,
    freshness: { fetchedAt: payload?.fetchedAt ?? null, latestDate, ageDays, stale },
  };
}
