// src/data/powerMarket.js
/**
 * @module powerMarket
 * @description Karta ELEKTRINA v paneli energie (2026-11-07, vlastník:
 * „plynovody, elektrinu a všetko na vrchol vylepšenia" → „pokračuj"): cena
 * na dennom trhu pre Slovensko a susedov (15-min intervaly, dnes aj zajtra
 * po aukcii ~13:00), výroba Slovenska podľa zdroja a výmena so susedmi cez
 * hranice. Všetko z Energy-Charts (Fraunhofer ISE) bez kľúča.
 *
 * Licencie (čítané z odpovedí 2026-11-07, pole `license`):
 *  - ceny AT, CZ, HU, DE-LU: CC BY 4.0 od Bundesnetzagentur | SMARD.de;
 *  - ceny SK, PL: „private and internal use only … external or commercial
 *    purposes expressly prohibited" (dátami disponuje EPEX SPOT / OKTE) —
 *    použité na rozhodnutie vlastníka („ser na zákazy", 2026-10-03), zapísané
 *    pravdivo v DATA_SOURCES.md a karta licenciu každej zóny hovorí;
 *  - výroba (public_power) a toky cez hranice (cbpf): CC BY 4.0.
 *
 * Modul je čistý (bez DOM a i18n) — importuje ho aj vite.config.js.
 */
import { formatDateLabel } from './gasPrices.js';

export const POWER_MARKET_API = '/api/power/market';
export const ENERGY_CHARTS_PRICE_URL = 'https://api.energy-charts.info/v2/price';
export const ENERGY_CHARTS_PUBLIC_POWER_URL = 'https://api.energy-charts.info/v2/public_power';
export const POWER_MARKET_TZ = 'Europe/Bratislava';
/** Zóny dňa vopred: Slovensko prvé (hlavička karty), potom susedia a nemecký trh. */
export const POWER_MARKET_ZONES = Object.freeze([
  Object.freeze({ bzn: 'SK', iso: 'SK' }),
  Object.freeze({ bzn: 'CZ', iso: 'CZ' }),
  Object.freeze({ bzn: 'HU', iso: 'HU' }),
  Object.freeze({ bzn: 'AT', iso: 'AT' }),
  Object.freeze({ bzn: 'PL', iso: 'PL' }),
  Object.freeze({ bzn: 'DE-LU', iso: 'DE' }),
]);
/** Krajina, ktorej výrobu karta rozkladá. */
export const POWER_MIX_COUNTRY = Object.freeze({ code: 'sk', iso: 'SK' });
/** Po tomto veku poslednej hodnoty výroby je karta „zastaraná" (bežné oneskorenie ~3 h). */
export const POWER_MIX_STALE_MS = 8 * 60 * 60_000;

/**
 * Skupiny zdrojov výroby: id radov Energy-Charts → skupina karty. Farby nadväzujú
 * na mapu (plyn jantár ako plynovody, ropa orchidea ako ropovody, vietor azúr).
 * Spotreba, zvyškové zaťaženie, obchod cez hranice, podiely OZE a čerpanie
 * prečerpávacích elektrární do výroby nepatria.
 */
export const POWER_MIX_GROUPS = Object.freeze([
  Object.freeze({ key: 'nuclear', ids: ['nuclear'], color: '#b48cff' }),
  Object.freeze({ key: 'hydro', ids: ['hydro_run_of_river', 'hydro_water_reservoir', 'hydro_pumped_storage'], color: '#3fa9ff' }),
  Object.freeze({ key: 'gas', ids: ['fossil_gas', 'fossil_coal-derived_gas'], color: '#ffb14d' }),
  Object.freeze({ key: 'coal', ids: ['fossil_brown_coal_lignite', 'fossil_hard_coal', 'fossil_peat', 'fossil_oil_shale'], color: '#8a7f73' }),
  Object.freeze({ key: 'oil', ids: ['fossil_oil'], color: '#eab2ff' }),
  Object.freeze({ key: 'bio', ids: ['biomass', 'other_renewables', 'geothermal', 'waste'], color: '#7bc96f' }),
  Object.freeze({ key: 'solar', ids: ['solar'], color: '#ffd84d' }),
  Object.freeze({ key: 'wind', ids: ['wind_onshore', 'wind_offshore'], color: '#7fe3ff' }),
  Object.freeze({ key: 'other', ids: ['others'], color: '#9aa5b1' }),
]);

const locale = (lang) => (lang === 'sk' ? 'sk-SK' : 'en-GB');

/** Miestny deň v časovom pásme trhu ('YYYY-MM-DD'). */
export function marketDay(ms, tz = POWER_MARKET_TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

/** Deň posunutý o `days` (podľa kalendára, nie o 24 h — prechod času). */
export function shiftDay(day, days) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** URL ceny dňa vopred pre zónu: dnes aj zajtra (zajtrajšok príde po aukcii). */
export function energyChartsPriceUrl(bzn, nowMs = Date.now()) {
  const today = marketDay(nowMs);
  return `${ENERGY_CHARTS_PRICE_URL}?bzn=${encodeURIComponent(bzn)}&start=${today}&end=${shiftDay(today, 1)}`;
}

/** URL výroby krajiny: včera aj dnes (po polnoci ostáva čo ukázať, výroba mešká ~3 h). */
export function energyChartsPublicPowerUrl(code, nowMs = Date.now()) {
  const today = marketDay(nowMs);
  return `${ENERGY_CHARTS_PUBLIC_POWER_URL}?country=${encodeURIComponent(code)}&start=${shiftDay(today, -1)}&end=${today}`;
}

/** Riadky `data[]` Energy-Charts → [{t, v}] pre jeden rad (null = chýba). */
function seriesPoints(json, id) {
  const out = [];
  for (const row of Array.isArray(json?.data) ? json.data : []) {
    const t = Date.parse(row?.timestamp || '');
    if (!Number.isFinite(t)) continue;
    const v = row?.values?.[id];
    out.push({ t, v: Number.isFinite(v) ? v : null });
  }
  return out;
}

/**
 * Bilancia hraníc krajiny z odpovede `/api/power/flows` (powerFlows.js): pre
 * každú dvojicu so `iso` tok DO krajiny (kladné = dovoz), čas a smer.
 * @param {object|null} flows payload tokov
 * @param {string} [iso]
 * @returns {Array<{iso: string, gw: number|null, at: string|null}>}
 */
export function borderBalance(flows, iso = POWER_MIX_COUNTRY.iso) {
  const out = [];
  for (const pair of Object.values(flows?.pairs || {})) {
    if (pair?.a !== iso && pair?.b !== iso) continue;
    const other = pair.a === iso ? pair.b : pair.a;
    const gw = Number.isFinite(pair.latestGw) ? (pair.b === iso ? pair.latestGw : -pair.latestGw) : null;
    out.push({ iso: other, gw: gw === null ? null : Math.round(gw * 1000) / 1000, at: pair.latestAt || null });
  }
  return out.sort((x, y) => x.iso.localeCompare(y.iso));
}

/**
 * Odpoveď proxy `/api/power/market` z odpovedí Energy-Charts. Zlyhaná zóna
 * má `error` a prázdny rad — ostatné prejdú.
 * @param {{prices: Array<{bzn: string, json: object|null, error?: string|null}>, mix: {json: object|null, error?: string|null}, flows?: object|null}} input
 * @param {{fetchedAt?: number}} [o]
 */
export function buildPowerMarketPayload({ prices = [], mix = null, flows = null } = {}, { fetchedAt = Date.now() } = {}) {
  const zones = POWER_MARKET_ZONES.map(({ bzn, iso }) => {
    const r = prices.find((p) => p?.bzn === bzn) || null;
    return {
      bzn,
      iso,
      unit: r?.json?.unit || 'EUR / MWh',
      license: typeof r?.json?.license === 'string' ? r.json.license : null,
      points: r?.json ? seriesPoints(r.json, 'day_ahead_price') : [],
      error: r?.error || (r?.json ? null : 'missing'),
    };
  });
  const mixJson = mix?.json || null;
  const ids = Array.isArray(mixJson?.series) ? mixJson.series.map((s) => s.id) : [];
  const rows = [];
  for (const row of Array.isArray(mixJson?.data) ? mixJson.data : []) {
    const t = Date.parse(row?.timestamp || '');
    if (!Number.isFinite(t)) continue;
    const values = {};
    let any = false;
    for (const id of ids) {
      const v = row?.values?.[id];
      if (Number.isFinite(v)) { values[id] = v; any = true; }
    }
    if (any) rows.push({ t, values });
  }
  return {
    fetchedAt,
    tz: POWER_MARKET_TZ,
    zones,
    mix: {
      country: POWER_MIX_COUNTRY.iso,
      unit: mixJson?.unit || 'MW',
      intervalMinutes: Number.isFinite(mixJson?.interval_minutes) ? mixJson.interval_minutes : null,
      license: typeof mixJson?.license === 'string' ? mixJson.license : null,
      rows: rows.slice(-48),
      error: mix?.error || (mixJson ? null : 'missing'),
    },
    borders: borderBalance(flows),
    bordersAt: flows?.fetchedAt ?? null,
    citation: 'Energy-Charts.info (Fraunhofer ISE) · ENTSO-E · EPEX SPOT · https://www.energy-charts.info/',
  };
}

/** Je licencia zóny otvorená (CC BY)? Inak „len súkromné použitie". */
export function isOpenLicense(license) {
  return /CC BY/i.test(String(license || ''));
}

export function formatEurMwhPower(v, lang = 'sk') {
  if (!Number.isFinite(v)) return '—';
  return `${new Intl.NumberFormat(locale(lang), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)} €/MWh`;
}

const formatMw = (mw, lang) => (Math.abs(mw) >= 1000
  ? `${new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 2 }).format(mw / 1000)} GW`
  : `${new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 0 }).format(mw)} MW`);

const formatPct = (v, lang) => `${new Intl.NumberFormat(locale(lang), { maximumFractionDigits: v < 10 ? 1 : 0 }).format(v)} %`;

const timeFmt = (ms, lang, tz) => new Intl.DateTimeFormat(locale(lang), { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(ms));

/** Štatistika dňa zo 15-min radu: priemer, min, max, počet. */
function dayStats(points, day, tz) {
  const vals = points.filter((p) => Number.isFinite(p.v) && marketDay(p.t, tz) === day).map((p) => p.v);
  if (!vals.length) return null;
  return { avg: vals.reduce((a, b) => a + b, 0) / vals.length, min: Math.min(...vals), max: Math.max(...vals), count: vals.length };
}

/** Hodnota intervalu, ktorý obsahuje `now` (posledný začiatok ≤ now). */
function pointAt(points, now) {
  let hit = null;
  for (const p of points) if (p.t <= now && Number.isFinite(p.v)) hit = p;
  return hit;
}

/**
 * Model karty ELEKTRINA.
 * @param {object|null} payload odpoveď `/api/power/market`
 * @param {{lang?: string, translate?: (k: string, v?: object) => string, nowMs?: number, regionName?: (iso: string) => string}} [o]
 */
export function buildPowerMarketModel(payload, { lang = 'sk', translate = (k) => k, nowMs = Date.now(), regionName = (iso) => iso } = {}) {
  const tz = payload?.tz || POWER_MARKET_TZ;
  const zones = Array.isArray(payload?.zones) ? payload.zones : [];
  const sk = zones.find((z) => z.bzn === 'SK') || null;
  if (!payload || !sk || !sk.points.some((p) => Number.isFinite(p.v))) return { ok: false };
  const today = marketDay(nowMs, tz);
  const tomorrow = shiftDay(today, 1);
  const intervalMs = 15 * 60_000;
  const zoneName = (z) => (z.bzn === 'DE-LU' ? `${regionName('DE') || 'DE'} · LU` : (regionName(z.iso) || z.iso));
  const rowOf = (z) => {
    const now = pointAt(z.points, nowMs);
    const td = dayStats(z.points, today, tz);
    const tm = dayStats(z.points, tomorrow, tz);
    return {
      key: z.bzn,
      iso: z.iso,
      name: zoneName(z),
      now: now?.v ?? null,
      nowText: now ? formatEurMwhPower(now.v, lang) : '—',
      avgText: td ? translate('power.market-avg', { v: formatEurMwhPower(td.avg, lang) }) : '',
      tomorrowText: tm && tm.count >= 4 ? translate('power.market-tomorrow', { v: formatEurMwhPower(tm.avg, lang) }) : '',
      open: isOpenLicense(z.license),
      level: z.error ? 'nodata' : 'ok',
    };
  };
  const skNow = pointAt(sk.points, nowMs);
  const skToday = dayStats(sk.points, today, tz);
  const skTomorrow = dayStats(sk.points, tomorrow, tz);
  const headline = {
    value: skNow?.v ?? null,
    text: skNow ? formatEurMwhPower(skNow.v, lang) : '—',
    intervalText: skNow ? `${timeFmt(skNow.t, lang, tz)}–${timeFmt(skNow.t + intervalMs, lang, tz)}` : '',
    avgText: skToday ? translate('power.market-avg', { v: formatEurMwhPower(skToday.avg, lang) }) : '',
    rangeText: skToday ? translate('power.market-range', { min: formatEurMwhPower(skToday.min, lang), max: formatEurMwhPower(skToday.max, lang) }) : '',
    tomorrowText: skTomorrow && skTomorrow.count >= 4 ? translate('power.market-tomorrow', { v: formatEurMwhPower(skTomorrow.avg, lang) }) : translate('power.market-tomorrow-pending'),
    // Laik: €/MWh ÷ 10 = ct/kWh (veľkoobchod, bez distribúcie, poplatkov a DPH).
    laicText: skNow ? translate('power.market-laic', { ct: new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 1 }).format(skNow.v / 10) }) : '',
    dir: skNow && skToday ? (skNow.v > skToday.avg * 1.05 ? 'up' : (skNow.v < skToday.avg * 0.95 ? 'down' : 'flat')) : 'flat',
  };
  const chartPoints = (day) => sk.points.filter((p) => Number.isFinite(p.v) && marketDay(p.t, tz) === day);
  const series = [{ key: 'sk-today', points: chartPoints(today) }];
  const tomorrowPts = chartPoints(tomorrow);
  if (tomorrowPts.length >= 4) series.push({ key: 'sk-tomorrow', points: tomorrowPts });

  // ── výroba SR ────────────────────────────────────────────────────
  const mixRows = Array.isArray(payload?.mix?.rows) ? payload.mix.rows : [];
  const lastMix = [...mixRows].reverse().find((r) => POWER_MIX_GROUPS.some((g) => g.ids.some((id) => Number.isFinite(r.values?.[id])))) || null;
  let mix = null;
  if (lastMix) {
    const groups = POWER_MIX_GROUPS.map((g) => ({ ...g, mw: g.ids.reduce((s, id) => s + (Number.isFinite(lastMix.values[id]) && lastMix.values[id] > 0 ? lastMix.values[id] : 0), 0) }))
      .filter((g) => g.mw > 0.5);
    const total = groups.reduce((s, g) => s + g.mw, 0);
    const load = Number(lastMix.values.load);
    const ren = Number(lastMix.values.renewable_share_of_load);
    const trade = Number(lastMix.values.cross_border_electricity_trading);
    mix = {
      at: lastMix.t,
      timeText: `${formatDateLabel(marketDay(lastMix.t, tz), lang, { year: false })} ${timeFmt(lastMix.t, lang, tz)}`,
      totalText: translate('power.mix-total', { v: formatMw(total, lang) }),
      totalValueText: formatMw(total, lang),
      loadText: Number.isFinite(load) ? translate('power.mix-load', { v: formatMw(load, lang) }) : '',
      renewText: Number.isFinite(ren) ? translate('power.mix-renewable', { v: formatPct(ren, lang) }) : '',
      tradeText: Number.isFinite(trade) && Math.abs(trade) >= 1 ? translate(trade < 0 ? 'power.mix-export' : 'power.mix-import', { v: formatMw(Math.abs(trade), lang) }) : '',
      rows: groups.sort((a, b) => b.mw - a.mw).map((g) => ({
        key: g.key, color: g.color, level: 'ok', name: translate(`power.mix-${g.key}`),
        valueText: formatMw(g.mw, lang), pctText: total > 0 ? formatPct((g.mw / total) * 100, lang) : '', sub: '',
      })),
      stale: nowMs - lastMix.t > POWER_MIX_STALE_MS,
    };
  }

  // ── výmena so susedmi (z tokov cez hranice) ──────────────────────
  const borders = Array.isArray(payload?.borders) ? payload.borders : [];
  const known = borders.filter((b) => Number.isFinite(b.gw));
  let exchange = null;
  if (known.length) {
    const net = known.reduce((s, b) => s + b.gw, 0);
    const at = known.map((b) => Date.parse(b.at || '')).filter(Number.isFinite).sort((a, b) => b - a)[0] ?? null;
    exchange = {
      netText: Math.abs(net) < 0.005 ? translate('power.exchange-balanced') : translate(net < 0 ? 'power.exchange-net-export' : 'power.exchange-net-import', { v: formatMw(Math.abs(net) * 1000, lang) }),
      timeText: at ? `${formatDateLabel(marketDay(at, tz), lang, { year: false })} ${timeFmt(at, lang, tz)}` : '',
      rows: borders.map((b) => ({
        iso: b.iso,
        name: regionName(b.iso) || b.iso,
        level: Number.isFinite(b.gw) ? (Math.abs(b.gw) >= 0.005 ? 'flow' : 'zero') : 'nodata',
        text: Number.isFinite(b.gw) ? (Math.abs(b.gw) < 0.005 ? '0 MW' : formatMw(Math.abs(b.gw) * 1000, lang)) : translate('gas.flow-nodata'),
        routeText: Number.isFinite(b.gw) && Math.abs(b.gw) >= 0.005 ? (b.gw > 0 ? `${b.iso} → ${POWER_MIX_COUNTRY.iso}` : `${POWER_MIX_COUNTRY.iso} → ${b.iso}`) : `${POWER_MIX_COUNTRY.iso} ↔ ${b.iso}`,
      })),
    };
  }

  const restricted = zones.filter((z) => z.license && !isOpenLicense(z.license)).map((z) => z.bzn);
  return {
    ok: true,
    headline,
    zones: zones.filter((z) => z.bzn !== 'SK').map(rowOf),
    chart: { series },
    mix,
    exchange,
    note: translate('power.market-note'),
    licenseText: restricted.length ? translate('power.market-license', { zones: restricted.join(', ') }) : '',
    sourceLine: payload.citation || '',
    freshness: { fetchedAt: payload.fetchedAt ?? null, stale: !skNow || nowMs - skNow.t > 2 * 60 * 60_000 },
  };
}

/** Stiahni odpoveď proxy (cache 1 h). */
export async function fetchPowerMarket({ fetcher = (...a) => fetch(...a), url = POWER_MARKET_API } = {}) {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
