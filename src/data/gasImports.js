// src/data/gasImports.js
/**
 * @module gasImports
 * @description Dovoz plynu do EÚ podľa partnerskej krajiny (modul PLYN,
 * etapa 6, 2026-09-13; používateľ: „história … EÚ a ZSSR"). Zdroj Eurostat
 * `nrg_ti_gasm` (Imports of natural gas by partner country – monthly data;
 * JSON-stat 2.0 cez verejné API bez kľúča, mil. m³, EÚ27 agregát od 2021).
 *
 * Poctivosť: Eurostat „partner" je krajina, ktorú vykázal členský štát — často
 * posledná tranzitná (Tunisko pri alžírskom plyne, Albánsko pri azerbajdžanskom,
 * Ukrajina/Bielorusko/Turecko/Srbsko pri ruskom), nie skutočný pôvod. Preto sa
 * obchod vnútri EÚ vylúči (inak by sa plyn počítal dvakrát), tranzitné krajiny
 * ruských trás sú samostatná skupina a karta to hovorí v poznámke. Modul je
 * čistý (bez i18n a DOM), importuje ho aj server (zoskupenie robí proxy).
 */
import { KWH_PER_M3 } from './gasFlows.js';

export const GAS_IMPORTS_API = '/api/gas/imports';
export const EUROSTAT_DATASET = 'nrg_ti_gasm';
export const EUROSTAT_API_BASE = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data';
export const EUROSTAT_ATTRIBUTION = 'Eurostat';
/** EÚ27 agregát (EU27_2020) má v nrg_ti_gasm hodnoty od januára 2021. */
export const GAS_IMPORTS_SINCE = '2021-01';
export const GAS_IMPORTS_GEO = 'EU27_2020';
export const GAS_IMPORTS_BASE_YEAR = '2021';
/** Eurostat publikuje s oneskorením 2–3 mesiace; nad 5 mesiacov je to „zastarané". */
export const GAS_IMPORTS_STALE_MONTHS = 5;
export const GAS_IMPORT_RANGES = Object.freeze(['2y', 'max']);
export const EU27 = Object.freeze(['BE', 'BG', 'CZ', 'DK', 'DE', 'EE', 'IE', 'EL', 'ES', 'FR', 'HR', 'IT', 'CY', 'LV', 'LT', 'LU', 'HU', 'MT', 'NL', 'AT', 'PL', 'PT', 'RO', 'SI', 'SK', 'FI', 'SE']);
export const RUSSIA_CODES = Object.freeze(['RU']);
export const TRANSIT_CODES = Object.freeze(['UA', 'BY', 'TR', 'RS']);

/**
 * Skupiny pôvodu v poradí vrstiev grafu (zdola). `codes` = partneri Eurostatu
 * (potrubie + LNG); `kind` = zvyšok bez skupiny, rozdelený na LNG a potrubie.
 * Farby: azúr = Nórsko, červená = Rusko (tlmená = tranzit ruských trás),
 * jantár = Alžírsko (tlmená = Azerbajdžan), biela = USA, fialová = Katar/LNG.
 */
export const GAS_IMPORT_GROUPS = Object.freeze([
  Object.freeze({ key: 'no', codes: Object.freeze(['NO']), color: 'rgba(57, 208, 255, 0.55)' }),
  Object.freeze({ key: 'ru', codes: RUSSIA_CODES, color: 'rgba(255, 96, 96, 0.62)' }),
  Object.freeze({ key: 'transit', codes: TRANSIT_CODES, color: 'rgba(255, 96, 96, 0.3)' }),
  Object.freeze({ key: 'dz', codes: Object.freeze(['DZ', 'TN']), color: 'rgba(255, 179, 71, 0.55)' }),
  Object.freeze({ key: 'az', codes: Object.freeze(['AZ', 'AL']), color: 'rgba(255, 179, 71, 0.28)' }),
  Object.freeze({ key: 'us', codes: Object.freeze(['US']), color: 'rgba(255, 255, 255, 0.42)' }),
  Object.freeze({ key: 'qa', codes: Object.freeze(['QA']), color: 'rgba(190, 150, 255, 0.5)' }),
  Object.freeze({ key: 'lng-other', codes: null, kind: 'lng', color: 'rgba(190, 150, 255, 0.24)' }),
  Object.freeze({ key: 'other', codes: null, kind: 'pipe', color: 'rgba(150, 175, 185, 0.3)' }),
]);

/**
 * URL dopytu Eurostat API (JSON-stat 2.0): obe položky siec (G3000 plyn
 * spolu, G3200 LNG), mil. m³, mesačne, od GAS_IMPORTS_SINCE.
 */
export function eurostatImportsUrl({ geo = GAS_IMPORTS_GEO, since = GAS_IMPORTS_SINCE, base = EUROSTAT_API_BASE } = {}) {
  const params = new URLSearchParams({ format: 'JSON', lang: 'EN', freq: 'M', unit: 'MIO_M3', geo, sinceTimePeriod: since });
  return `${base}/${EUROSTAT_DATASET}?${params.toString()}`;
}

/** Plochý index JSON-stat (riadkovo po dimenziách v poradí `id`). */
function flatIndex(size, coords) {
  let n = 0;
  for (let i = 0; i < size.length; i += 1) n = n * size[i] + coords[i];
  return n;
}

/**
 * JSON-stat 2.0 → { months, updated, partners: { code: { label, total[], lng[] } } }
 * (null = chýbajúca hodnota). Rozmery freq/unit/geo majú veľkosť 1.
 * @param {object} json
 */
export function parseEurostatJsonStat(json) {
  const dims = Array.isArray(json?.id) ? json.id : [];
  const size = Array.isArray(json?.size) ? json.size : [];
  const dim = (name) => json?.dimension?.[name]?.category;
  const timeCat = dim('time');
  const partnerCat = dim('partner');
  const siecCat = dim('siec');
  if (!dims.length || !timeCat?.index || !partnerCat?.index || !siecCat?.index) return { months: [], updated: null, label: null, partners: {} };
  const months = Object.keys(timeCat.index).sort((a, b) => timeCat.index[a] - timeCat.index[b]);
  const values = json.value || {};
  const coordsFor = (siec, partner, timeIdx) => dims.map((d) => {
    if (d === 'time') return timeIdx;
    if (d === 'partner') return partnerCat.index[partner];
    if (d === 'siec') return siecCat.index[siec];
    return 0;
  });
  const read = (siec, partner, timeIdx) => {
    if (siecCat.index[siec] === undefined) return null;
    const v = values[flatIndex(size, coordsFor(siec, partner, timeIdx))];
    return Number.isFinite(v) ? v : null;
  };
  const partners = {};
  for (const code of Object.keys(partnerCat.index)) {
    partners[code] = {
      label: partnerCat.label?.[code] || code,
      total: months.map((_, t) => read('G3000', code, t)),
      lng: months.map((_, t) => read('G3200', code, t)),
    };
  }
  return { months, updated: json.updated || null, label: json.label || null, partners };
}

const sumSeries = (arrays, n) => Array.from({ length: n }, (_, t) => arrays.reduce((acc, a) => acc + (Number.isFinite(a?.[t]) ? a[t] : 0), 0));
const roundArr = (arr, digits = 1) => arr.map((v) => Math.round(v * 10 ** digits) / 10 ** digits);

/**
 * Zoskupenie pre klienta (beží v proxy): posledný mesiac s vykázaným TOTAL,
 * obchod vnútri EÚ zvlášť, vrstvy podľa GAS_IMPORT_GROUPS (potrubie = spolu
 * − LNG), spolu mimo EÚ. Hodnoty v mil. m³.
 * @param {object} json JSON-stat z Eurostat API
 * @param {{fetchedAt?: number, geo?: string}} [o]
 */
export function buildImportsPayload(json, { fetchedAt = Date.now(), geo = GAS_IMPORTS_GEO } = {}) {
  const parsed = parseEurostatJsonStat(json);
  const reported = parsed.partners.TOTAL?.total || [];
  let last = -1;
  for (let t = reported.length - 1; t >= 0; t -= 1) if (Number.isFinite(reported[t])) { last = t; break; }
  const n = last + 1;
  const months = parsed.months.slice(0, n);
  const codes = Object.keys(parsed.partners).filter((c) => c !== 'TOTAL');
  const external = codes.filter((c) => !EU27.includes(c));
  const total = (c) => parsed.partners[c].total.slice(0, n);
  const lng = (c) => parsed.partners[c].lng.slice(0, n);
  const pipe = (c) => total(c).map((v, t) => Math.max(0, (Number.isFinite(v) ? v : 0) - (Number.isFinite(lng(c)[t]) ? lng(c)[t] : 0)));
  const grouped = new Set(GAS_IMPORT_GROUPS.flatMap((g) => g.codes || []));
  const rest = external.filter((c) => !grouped.has(c));
  const groups = GAS_IMPORT_GROUPS.map((g) => {
    const members = g.codes ? g.codes.filter((c) => parsed.partners[c]) : rest;
    return {
      key: g.key,
      codes: members,
      pipe: roundArr(g.kind === 'lng' ? Array(n).fill(0) : sumSeries(members.map(pipe), n)),
      lng: roundArr(g.kind === 'pipe' ? Array(n).fill(0) : sumSeries(members.map(lng), n)),
    };
  });
  return {
    geo,
    dataset: EUROSTAT_DATASET,
    months,
    updated: parsed.updated,
    fetchedAt,
    total: roundArr(sumSeries(external.map(total), n)),
    lng: roundArr(sumSeries(external.map(lng), n)),
    intra: roundArr(sumSeries(codes.filter((c) => EU27.includes(c)).map(total), n)),
    reported: roundArr(reported.slice(0, n).map((v) => (Number.isFinite(v) ? v : 0))),
    groups,
    source: `${EUROSTAT_ATTRIBUTION} ${EUROSTAT_DATASET}`,
    url: eurostatImportsUrl({ geo }),
  };
}

const locale = (lang) => (lang === 'sk' ? 'sk-SK' : 'en-GB');

/** mil. m³ → „27,5 mld m³" / „27.5 bcm". */
export function formatBcm(mio, lang = 'sk', digits = 1) {
  if (!Number.isFinite(mio)) return '—';
  const v = new Intl.NumberFormat(locale(lang), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(mio / 1000);
  return lang === 'sk' ? `${v} mld m³` : `${v} bcm`;
}

/** mil. m³ → TWh pri KWH_PER_M3 (1 mil. m³ ≈ 10,55 GWh; laický prepočet, preto „≈"). */
export function mioM3ToTwh(mio) {
  return Number.isFinite(mio) ? (mio * KWH_PER_M3) / 1000 : null;
}

export function formatTwhRound(twh, lang = 'sk') {
  return Number.isFinite(twh) ? `${new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 0 }).format(twh)} TWh` : '—';
}

export function formatSharePct(fraction, lang = 'sk') {
  if (!Number.isFinite(fraction)) return '—';
  const pct = fraction * 100;
  return `${new Intl.NumberFormat(locale(lang), { maximumFractionDigits: pct < 10 && pct > 0 ? 1 : 0 }).format(pct)} %`;
}

export function formatSignedPct(fraction, lang = 'sk') {
  if (!Number.isFinite(fraction)) return '';
  const pct = fraction * 100;
  const s = new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(Math.abs(pct));
  return `${pct < 0 ? '−' : '+'}${s} %`;
}

/** „2026-06" → „jún 2026" / „June 2026". */
export function formatMonthLabel(month, lang = 'sk') {
  const y = Number(String(month).slice(0, 4));
  const m = Number(String(month).slice(5, 7));
  if (!y || !m) return String(month || '');
  return new Intl.DateTimeFormat(locale(lang), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 15)));
}

/** Počet mesiacov medzi „YYYY-MM" a časom `nowMs` (kladné = mesiac je v minulosti). */
export function monthsBetween(month, nowMs) {
  const y = Number(String(month).slice(0, 4));
  const m = Number(String(month).slice(5, 7));
  if (!y || !m) return null;
  const d = new Date(nowMs);
  return (d.getUTCFullYear() - y) * 12 + (d.getUTCMonth() + 1 - m);
}

const shareOf = (part, whole) => (Number.isFinite(part) && Number.isFinite(whole) && whole > 0 ? part / whole : null);

/**
 * Model karty DOVOZ.
 * @param {ReturnType<typeof buildImportsPayload>} payload
 * @param {{lang?: string, translate?: Function, nowMs?: number, range?: string}} [o]
 */
export function buildImportsModel(payload, { lang = 'sk', translate = (key) => key, nowMs = Date.now(), range = '2y' } = {}) {
  const t = translate;
  const months = Array.isArray(payload?.months) ? payload.months : [];
  const n = months.length;
  if (n < 2 || !Array.isArray(payload?.total) || !Array.isArray(payload?.groups)) return { ok: false, months: [], layers: [], rows: [] };
  const last = n - 1;
  const total = payload.total;
  const groupTotal = (g, t0) => (g.pipe[t0] || 0) + (g.lng[t0] || 0);
  const groupByKey = Object.fromEntries(payload.groups.map((g) => [g.key, g]));
  const yearSum = (arr, year) => months.reduce((acc, m, i) => acc + (m.startsWith(year) && Number.isFinite(arr[i]) ? arr[i] : 0), 0);
  const groupYear = (g, year) => months.reduce((acc, m, i) => acc + (m.startsWith(year) ? groupTotal(g, i) : 0), 0);
  const baseYearAvailable = months.some((m) => m.startsWith(GAS_IMPORTS_BASE_YEAR));
  const baseTotal = baseYearAvailable ? yearSum(total, GAS_IMPORTS_BASE_YEAR) : null;
  const shareLine = (key) => {
    const g = groupByKey[key];
    if (!g) return { pct: null, base: null };
    return {
      pct: shareOf(groupTotal(g, last), total[last]),
      base: baseYearAvailable ? shareOf(groupYear(g, GAS_IMPORTS_BASE_YEAR), baseTotal) : null,
    };
  };
  const ru = shareLine('ru');
  const transit = shareLine('transit');
  const lngShare = shareOf(payload.lng?.[last], total[last]);
  const yoy = last >= 12 && total[last - 12] > 0 ? total[last] / total[last - 12] - 1 : null;
  const from = range === 'max' ? 0 : Math.max(0, n - 24);
  const sliced = months.slice(from);
  const layers = payload.groups.map((g) => {
    const def = GAS_IMPORT_GROUPS.find((d) => d.key === g.key);
    return {
      key: g.key,
      label: t(`gas.imports-group-${g.key}`),
      color: def?.color || 'rgba(150, 175, 185, 0.3)',
      values: sliced.map((_, i) => Math.round(groupTotal(g, from + i)) / 1000),
    };
  });
  const rows = payload.groups.map((g) => {
    const v = groupTotal(g, last);
    const def = GAS_IMPORT_GROUPS.find((d) => d.key === g.key);
    const yearAgo = last >= 12 ? groupTotal(g, last - 12) : null;
    const lngPart = shareOf(g.lng[last], v);
    const sub = [];
    if (g.lng[last] > 0 && g.pipe[last] > 0) sub.push(t('gas.imports-of-which-lng', { pct: formatSharePct(lngPart, lang) }));
    if (Number.isFinite(yearAgo)) sub.push(t('gas.imports-year-ago', { v: formatBcm(yearAgo, lang) }));
    return {
      key: g.key,
      name: t(`gas.imports-group-${g.key}`),
      color: def?.color || null,
      value: v,
      valueText: formatBcm(v, lang),
      pct: shareOf(v, total[last]),
      pctText: formatSharePct(shareOf(v, total[last]), lang),
      sub: sub.join(' · '),
      level: v > 0 ? 'ok' : 'zero',
    };
  }).sort((a, b) => b.value - a.value);
  const latestMonth = months[last];
  const age = monthsBetween(latestMonth, nowMs);
  const updatedDay = payload.updated ? String(payload.updated).slice(0, 10) : null;
  return {
    ok: true,
    months: sliced,
    range,
    headline: {
      totalText: formatBcm(total[last], lang),
      twhText: t('gas.imports-twh', { v: formatTwhRound(mioM3ToTwh(total[last]), lang) }),
      dateText: formatMonthLabel(latestMonth, lang),
      yoyText: Number.isFinite(yoy) ? t('gas.imports-yoy', { v: formatSignedPct(yoy, lang) }) : '',
      dir: !Number.isFinite(yoy) || Math.abs(yoy) < 0.005 ? 'flat' : (yoy > 0 ? 'up' : 'down'),
      ruText: t('gas.imports-ru-share', { pct: formatSharePct(ru.pct, lang), base: ru.base === null ? '—' : formatSharePct(ru.base, lang) }),
      transitText: t('gas.imports-transit-share', { pct: formatSharePct(transit.pct, lang), base: transit.base === null ? '—' : formatSharePct(transit.base, lang) }),
      lngText: t('gas.imports-lng-share', { pct: formatSharePct(lngShare, lang) }),
      intraText: t('gas.imports-intra', { v: formatBcm(payload.intra?.[last], lang) }),
    },
    shares: { ru: ru.pct, ruBase: ru.base, transit: transit.pct, transitBase: transit.base, lng: lngShare },
    layers,
    rows,
    note: t('gas.imports-note'),
    sourceLine: t('gas.imports-source', { date: updatedDay ? formatDateLabel(updatedDay, lang) : '—' }),
    freshness: { latestMonth, ageMonths: age, stale: Number.isFinite(age) && age > GAS_IMPORTS_STALE_MONTHS },
  };
}

/** „2026-09-08" → „8. 9. 2026" / „8 Sep 2026" (bez importu gasPrices, aby server nenačítal celý modul). */
function formatDateLabel(day, lang) {
  const y = Number(String(day).slice(0, 4));
  const m = Number(String(day).slice(5, 7));
  const d = Number(String(day).slice(8, 10));
  if (!y || !m || !d) return String(day);
  return new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: lang === 'sk' ? 'numeric' : 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

export async function fetchGasImports({ fetcher = (...a) => fetch(...a), url = GAS_IMPORTS_API } = {}) {
  const response = await fetcher(url, { cache: 'no-store' });
  if (!response.ok) {
    const json = await response.json().catch(() => null);
    const err = new Error(json?.error ? String(json.error) : `HTTP ${response.status}`);
    err.status = response.status;
    err.code = json?.error ?? null;
    throw err;
  }
  return response.json();
}
