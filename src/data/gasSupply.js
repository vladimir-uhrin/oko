// src/data/gasSupply.js
/**
 * @module gasSupply
 * @description Denný mix dodávok EÚ podľa pôvodu (modul PLYN, etapa 7,
 * 2026-09-13; používateľ: „a reálne toky sú k dispozícii?", „pokračuj ďalej").
 * Skladá sa z už stiahnutých dát: fyzické toky ENTSOG na vstupoch do EÚ
 * z krajín mimo EÚ (katalóg gasFlows.js, body s `origin`) + vyskladnenie
 * LNG terminálov EÚ z GIE ALSI (všetky pôvody). Doplnok k mesačnému
 * Eurostatu (gasImports.js): to isté „odkiaľ", ale za plynárenský deň D−1.
 *
 * Poctivosť: bez domácej ťažby EÚ (~10 % spotreby) a bez UK → Írsko; Nórsko
 * cez päť zverejnených vstupov (Norpipe NPT TP nezverejňuje); deň je
 * „úplný", keď hlási aspoň 70 % aktívnych bodov, inak sa graf skončí skôr;
 * chýbajúci deň jedného bodu sa doplní poslednou hodnotou do 3 dní. Modul je
 * čistý (bez i18n a DOM).
 */
import { GAS_FLOW_POINTS, entsogCitation, formatGwhDay, mcmPerDay } from './gasFlows.js';
import { formatDateLabel } from './gasPrices.js';

export const SUPPLY_DAYS = 31;
/** Deň je úplný, keď hlási aspoň tento podiel aktívnych bodov mixu. */
export const SUPPLY_COMPLETE_SHARE = 0.7;
/** Chýbajúci deň bodu: posledná známa hodnota najviac takto stará. */
export const SUPPLY_FILL_DAYS = 3;
export const SUPPLY_STALE_DAYS = 4;

/** Pôvody v poradí vrstiev grafu (zdola); farby ako v karte DOVOZ. */
export const SUPPLY_ORIGINS = Object.freeze([
  Object.freeze({ key: 'NO', color: 'rgba(57, 208, 255, 0.55)' }),
  Object.freeze({ key: 'RU', color: 'rgba(255, 96, 96, 0.62)' }),
  Object.freeze({ key: 'RU-UA', color: 'rgba(255, 96, 96, 0.3)' }),
  Object.freeze({ key: 'DZ', color: 'rgba(255, 179, 71, 0.55)' }),
  Object.freeze({ key: 'LY', color: 'rgba(255, 179, 71, 0.28)' }),
  Object.freeze({ key: 'AZ', color: 'rgba(255, 220, 140, 0.42)' }),
  Object.freeze({ key: 'UK', color: 'rgba(150, 175, 185, 0.35)' }),
  Object.freeze({ key: 'LNG', color: 'rgba(190, 150, 255, 0.5)' }),
]);

const DAY_MS = 86_400_000;
const dayMs = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const ORIGIN_BY_ID = new Map(GAS_FLOW_POINTS.map((p) => [p.id, p.origin || null]));

/**
 * Body payloadu tokov, ktoré patria do mixu (origin z payloadu alebo z katalógu —
 * proxy cache môže hodinu niesť staršiu podobu bodov).
 * @param {Array<object>} points
 */
export function supplyPoints(points) {
  return (Array.isArray(points) ? points : [])
    .map((p) => ({ ...p, origin: p?.origin || ORIGIN_BY_ID.get(p?.id) || null }))
    .filter((p) => p.origin && SUPPLY_ORIGINS.some((o) => o.key === p.origin));
}

/** Os dní končiaca `endDay` (vrátane), `days` kusov, ISO. */
export function supplyDays(endDay, days = SUPPLY_DAYS) {
  const end = dayMs(endDay);
  return Array.from({ length: days }, (_, i) => isoDay(end - (days - 1 - i) * DAY_MS));
}

/**
 * Hodnoty bodu na osi: skutočná, inak posledná známa do `fillDays` späť, inak 0.
 * @returns {{values: number[], reported: boolean[]}}
 */
export function alignSeries(series, days, { key = 'gwh', fillDays = SUPPLY_FILL_DAYS } = {}) {
  const byDay = new Map();
  for (const r of series || []) if (r?.date && Number.isFinite(r?.[key])) byDay.set(r.date, r[key]);
  const values = [];
  const reported = [];
  for (const day of days) {
    if (byDay.has(day)) { values.push(byDay.get(day)); reported.push(true); continue; }
    let filled = 0;
    const t = dayMs(day);
    for (let back = 1; back <= fillDays; back += 1) {
      const prev = isoDay(t - back * DAY_MS);
      if (byDay.has(prev)) { filled = byDay.get(prev); break; }
    }
    values.push(filled);
    reported.push(false);
  }
  return { values, reported };
}

const locale = (lang) => (lang === 'sk' ? 'sk-SK' : 'en-GB');
const pctText = (fraction, lang) => (Number.isFinite(fraction)
  ? `${new Intl.NumberFormat(locale(lang), { maximumFractionDigits: fraction * 100 < 10 && fraction > 0 ? 1 : 0 }).format(fraction * 100)} %`
  : '—');

/**
 * Model karty ZDROJE DODÁVOK.
 * @param {{flows: object|null, lng: object|null}} payloads payloady proxy /api/gas/flows a /api/gas/lng
 * @param {{lang?: string, translate?: Function, nowMs?: number, days?: number, completeShare?: number}} [o]
 */
export function buildSupplyModel({ flows, lng }, { lang = 'sk', translate = (key) => key, nowMs = Date.now(), days = SUPPLY_DAYS, completeShare = SUPPLY_COMPLETE_SHARE } = {}) {
  const t = translate;
  const points = supplyPoints(flows?.points);
  const active = points.filter((p) => Array.isArray(p.series) && p.series.some((r) => Number.isFinite(r?.gwh)));
  const lngSeries = Array.isArray(lng?.eu?.series) ? lng.eu.series.filter((r) => r?.date && Number.isFinite(r?.sendOut)) : [];
  if (!active.length && !lngSeries.length) return { ok: false, reason: 'empty', days: [], layers: [], rows: [] };
  let endDay = null;
  for (const p of active) for (const r of p.series) if (Number.isFinite(r?.gwh) && r.date && (!endDay || r.date > endDay)) endDay = r.date;
  for (const r of lngSeries) if (!endDay || r.date > endDay) endDay = r.date;
  const axis = supplyDays(endDay, days);
  const byOrigin = Object.fromEntries(SUPPLY_ORIGINS.map((o) => [o.key, Array(axis.length).fill(0)]));
  const reportedCount = Array(axis.length).fill(0);
  const pointsByOrigin = Object.fromEntries(SUPPLY_ORIGINS.map((o) => [o.key, { total: 0, active: 0, reportedLast: 0 }]));
  for (const p of points) pointsByOrigin[p.origin].total += 1;
  for (const p of active) {
    const { values, reported } = alignSeries(p.series, axis);
    pointsByOrigin[p.origin].active += 1;
    for (let i = 0; i < axis.length; i += 1) {
      byOrigin[p.origin][i] += values[i];
      if (reported[i]) reportedCount[i] += 1;
    }
  }
  const lngAligned = lngSeries.length ? alignSeries(lngSeries, axis, { key: 'sendOut' }) : null;
  if (lngAligned) for (let i = 0; i < axis.length; i += 1) byOrigin.LNG[i] += lngAligned.values[i];
  // Úplný deň: hlási aspoň completeShare aktívnych bodov (LNG sa počíta ako bod, keď je).
  const denominator = active.length + (lngAligned ? 1 : 0);
  let complete = axis.length - 1;
  for (let i = axis.length - 1; i >= 0; i -= 1) {
    const n = reportedCount[i] + (lngAligned?.reported[i] ? 1 : 0);
    if (n >= Math.ceil(denominator * completeShare)) { complete = i; break; }
  }
  for (const p of active) {
    const { reported } = alignSeries(p.series, axis);
    if (reported[complete]) pointsByOrigin[p.origin].reportedLast += 1;
  }
  const totals = axis.map((_, i) => SUPPLY_ORIGINS.reduce((acc, o) => acc + byOrigin[o.key][i], 0));
  const total = totals[complete];
  const avg7 = (arr) => { const slice = arr.slice(Math.max(0, complete - 6), complete + 1); return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null; };
  const chartDays = axis.slice(0, complete + 1);
  const layers = SUPPLY_ORIGINS.map((o) => ({ key: o.key, label: t(`gas.supply-origin-${o.key}`), color: o.color, values: byOrigin[o.key].slice(0, complete + 1).map((v) => Math.round(v * 10) / 10) }));
  const rows = SUPPLY_ORIGINS.map((o) => {
    const v = byOrigin[o.key][complete];
    const isLng = o.key === 'LNG';
    const pts = pointsByOrigin[o.key];
    const nodata = isLng ? !lngAligned : pts.active === 0;
    const share = total > 0 ? v / total : null;
    const sub = [];
    if (!nodata) sub.push(t('gas.supply-avg7', { v: formatGwhDay(avg7(byOrigin[o.key]), lang) }));
    sub.push(isLng ? t('gas.supply-lng-points') : t('gas.supply-points', { n: pts.reportedLast, m: pts.total }));
    return {
      key: o.key,
      name: t(`gas.supply-origin-${o.key}`),
      color: o.color,
      value: v,
      valueText: nodata ? t('gas.flow-nodata') : formatGwhDay(v, lang),
      pct: share,
      pctText: nodata ? '' : pctText(share, lang),
      sub: sub.join(' · '),
      level: nodata ? 'nodata' : (v >= 0.05 ? 'ok' : 'zero'),
    };
  }).sort((a, b) => b.value - a.value);
  const latestDate = axis[complete];
  const ageDays = Math.floor((nowMs - dayMs(latestDate)) / DAY_MS);
  const mcm = mcmPerDay(total);
  const lead = rows.filter((r) => r.level === 'ok').slice(0, 4).map((r) => `${r.name} ${r.pctText}`);
  return {
    ok: true,
    days: chartDays,
    headline: {
      totalText: formatGwhDay(total, lang),
      mcmText: mcm !== null ? t('gas.supply-mcm', { v: new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 0 }).format(mcm) }) : '',
      dateText: formatDateLabel(latestDate, lang),
      sharesText: lead.join(' · '),
      completeText: t('gas.supply-complete', { n: reportedCount[complete] + (lngAligned?.reported[complete] ? 1 : 0), m: denominator }),
    },
    layers,
    rows,
    note: t('gas.supply-note'),
    sourceLine: [flows?.citation || entsogCitation(flows?.fetchedAt ?? nowMs), lngAligned ? t('gas.supply-lng-source') : ''].filter(Boolean).join(' · '),
    freshness: { latestDate, ageDays, stale: ageDays > SUPPLY_STALE_DAYS, lngMissing: !lngAligned, activePoints: active.length, points: points.length },
  };
}
