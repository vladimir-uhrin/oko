// src/data/fixtures/eurostatImportsFixture.mjs
// Syntetický JSON-stat 2.0 v tvare Eurostat API (nrg_ti_gasm) pre testy
// modulu dovozu a panela PLYN — žiadne reálne dáta, len tvar a jednoduché
// čísla, ktoré sa dajú overiť z hlavy (2026-09-13).

/** Mesiace „YYYY-MM" od `from` (vrátane), `n` kusov. */
export function monthsFrom(from, n) {
  const y0 = Number(from.slice(0, 4));
  const m0 = Number(from.slice(5, 7));
  return Array.from({ length: n }, (_, i) => { const k = m0 - 1 + i; return `${y0 + Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`; });
}

/**
 * JSON-stat 2.0 ako z Eurostat API (id freq,siec,partner,unit,geo,time).
 * @param {{months: string[], partners: Record<string, {total: Array<number|null>, lng: Array<number|null>}>, updated?: string}} o
 */
export function jsonStat({ months, partners, updated = '2026-09-08T23:00:00+0200' }) {
  const codes = Object.keys(partners);
  const value = {};
  const idx = (s, p, t) => (s * codes.length + p) * months.length + t;
  codes.forEach((code, p) => months.forEach((_, t) => {
    const tot = partners[code].total?.[t];
    const lng = partners[code].lng?.[t];
    if (Number.isFinite(tot)) value[idx(0, p, t)] = tot;
    if (Number.isFinite(lng)) value[idx(1, p, t)] = lng;
  }));
  const index = (arr) => Object.fromEntries(arr.map((k, i) => [k, i]));
  return {
    version: '2.0', class: 'dataset', label: 'Imports of natural gas by partner country - monthly data', updated,
    id: ['freq', 'siec', 'partner', 'unit', 'geo', 'time'], size: [1, 2, codes.length, 1, 1, months.length],
    dimension: {
      freq: { category: { index: { M: 0 }, label: { M: 'Monthly' } } },
      siec: { category: { index: { G3000: 0, G3200: 1 }, label: { G3000: 'Natural gas', G3200: 'Liquefied natural gas' } } },
      partner: { category: { index: index(codes), label: Object.fromEntries(codes.map((c) => [c, c])) } },
      unit: { category: { index: { MIO_M3: 0 }, label: { MIO_M3: 'Million cubic metres' } } },
      geo: { category: { index: { EU27_2020: 0 }, label: { EU27_2020: 'European Union - 27 countries (from 2020)' } } },
      time: { category: { index: index(months), label: Object.fromEntries(months.map((m) => [m, m])) } },
    },
    value,
  };
}

/** 66 mesiacov 2021-01…2026-06 s dátami + 2 mesiace bez TOTAL (Eurostat ich už vypísal, ale ešte nenaplnil). */
export const MONTHS = monthsFrom('2021-01', 68);
const known = (i) => i < 66;
const series = (fn) => MONTHS.map((m, i) => (known(i) ? fn(m, i) : null));
const y2021 = (m) => m.startsWith('2021');
/** Mimo EÚ: 2021 = 32 200 mil. m³/mesiac (RU 7 000 + UA 3 000), od 2022 = 24 700; DE = obchod vnútri EÚ 2 400. */
export const PARTNERS = {
  NO: { total: series(() => 8000), lng: series(() => 0) },
  RU: { total: series((m) => (y2021(m) ? 7000 : 2500)), lng: series(() => 1400) },
  UA: { total: series((m) => (y2021(m) ? 3000 : 0)), lng: series(() => 0) },
  US: { total: series(() => 4000), lng: series(() => 4000) },
  DZ: { total: series(() => 2500), lng: series(() => 1800) },
  TN: { total: series(() => 1800), lng: series(() => 0) },
  QA: { total: series(() => 1500), lng: series(() => 1500) },
  NG: { total: series(() => 700), lng: series(() => 700) },
  UK: { total: series(() => 1700), lng: series(() => 0) },
  NSP: { total: series(() => 2000), lng: series(() => 1600) },
  DE: { total: series(() => 2400), lng: series(() => 0) },
};
PARTNERS.TOTAL = {
  total: series((m, i) => Object.values(PARTNERS).reduce((n, p) => n + (p.total[i] || 0), 0)),
  lng: series((m, i) => Object.values(PARTNERS).reduce((n, p) => n + (p.lng[i] || 0), 0)),
};
export const EUROSTAT_IMPORTS_JSON_STAT = jsonStat({ months: MONTHS, partners: PARTNERS });
