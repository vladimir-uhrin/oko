// src/data/gasFlows.js
/**
 * @module gasFlows
 * @description Fyzické toky plynu pre panel PLYN (2026-09-13, používateľ:
 * „prietoky … EÚ a ZSSR"): čistý katalóg prepojovacích bodov, URL na
 * ENTSOG Transparency Platform, normalizácia odpovede a model karty TOKY.
 * Servíruje proxy `/api/gas/flows` (vite.config.js, `gasProxy()`), ktorá
 * všetkých 32 smerov stiahne JEDNÝM dopytom (pointDirection oddelené
 * čiarkou, overené naostro 2026-09-13) raz za hodinu.
 *
 * ENTSOG TP (bez účtu a kľúča). Podmienky použitia TRA0394-16:
 *  - 5.7 „The automate download of data is possible via the API tool of the
 *    ENTSOG TP, on condition that the current Terms and Conditions of Use
 *    are fully respected."
 *  - 5.6 „ENTSOG does not permit automatic extraction of data or other usage
 *    that reduces the performance of the ENTSOG TP." → jeden filtrovaný
 *    dopyt za hodinu, cache na disku.
 *  - 5.2 pri citovaní uviesť zdroj a dátum: „ENTSOG TP [DD-MM-YYYY]
 *    https://transparency.entsog.eu/" → `entsogCitation()` v päte karty.
 * Denné hodnoty sú „Provisional" a zverejňujú sa nasledujúce ráno (~06:35
 * CET), takže karta nikdy nehovorí „naživo" — hovorí „predbežné, D−1".
 * Modul je čistý (bez i18n a DOM): importuje ho aj vite.config.js.
 */
import { formatDateLabel } from './gasPrices.js';

export const GAS_FLOWS_API = '/api/gas/flows';
/** Okno dopytu (dní späť); karta kreslí posledných GAS_FLOW_SPARK_DAYS. */
export const GAS_FLOW_DAYS = 31;
export const GAS_FLOW_SPARK_DAYS = 14;
export const ENTSOG_OPERATIONAL_DATA_URL = 'https://transparency.entsog.eu/api/v1/operationalData.json';
export const ENTSOG_TP_URL = 'https://transparency.entsog.eu/';
/** Priemerné spaľovacie teplo ≈ 10,55 kWh/m³ — len na laický prepočet na mil. m³ (preto „≈"). */
export const KWH_PER_M3 = 10.55;
/** Po tomto veku posledného plynárenského dňa je rad „zastaraný“ (bežné oneskorenie 1–2 dni). */
export const GAS_FLOWS_STALE_DAYS = 4;
export const GAS_FLOW_GROUPS = Object.freeze(['sk', 'east']);

const DAY_MS = 86_400_000;
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const P = (id, group, operator, point, dir, from, to, name, lat, lon, noteKey = null) => Object.freeze({ id, group, operator, point, dir, from, to, name, lat, lon, noteKey });

/**
 * Katalóg smerov (operátor + bod + smer podľa ENTSOG `operatorpointdirections`,
 * overené 2026-09-13). `entry` = plyn vstupuje do sústavy operátora, `exit`
 * vystupuje; pri zásobníku Láb entry = ťažba do siete, exit = vtláčanie.
 * Súradnice sú približné polohy hraničných staníc (na glóbus, nie kataster).
 */
export const GAS_FLOW_POINTS = Object.freeze([
  // Slovensko (eustream SK-TSO-0001)
  P('lanzhot-in', 'sk', 'SK-TSO-0001', 'ITP-00051', 'entry', 'CZ', 'SK', 'Lanžhot', 48.72, 16.97),
  P('lanzhot-out', 'sk', 'SK-TSO-0001', 'ITP-00051', 'exit', 'SK', 'CZ', 'Lanžhot', 48.72, 16.97),
  P('baumgarten-in', 'sk', 'SK-TSO-0001', 'ITP-00168', 'entry', 'AT', 'SK', 'Baumgarten', 48.34, 16.85),
  P('baumgarten-out', 'sk', 'SK-TSO-0001', 'ITP-00168', 'exit', 'SK', 'AT', 'Baumgarten', 48.34, 16.85),
  P('zlievce-in', 'sk', 'SK-TSO-0001', 'ITP-00027', 'entry', 'HU', 'SK', 'Veľké Zlievce', 48.18, 19.44),
  P('zlievce-out', 'sk', 'SK-TSO-0001', 'ITP-00027', 'exit', 'SK', 'HU', 'Veľké Zlievce', 48.18, 19.44),
  P('vyrava-in', 'sk', 'SK-TSO-0001', 'ITP-00177', 'entry', 'PL', 'SK', 'Výrava', 49.27, 21.98, 'gas.note-vyrava'),
  P('vyrava-out', 'sk', 'SK-TSO-0001', 'ITP-00177', 'exit', 'SK', 'PL', 'Výrava', 49.27, 21.98),
  P('kapusany-in', 'sk', 'SK-TSO-0001', 'ITP-00117', 'entry', 'UA', 'SK', 'Veľké Kapušany', 48.55, 22.08, 'gas.note-kapusany'),
  P('kapusany-out', 'sk', 'SK-TSO-0001', 'ITP-00117', 'exit', 'SK', 'UA', 'Veľké Kapušany', 48.55, 22.08),
  P('budince-in', 'sk', 'SK-TSO-0001', 'ITP-00421', 'entry', 'UA', 'SK', 'Budince', 48.53, 22.10),
  P('budince-out', 'sk', 'SK-TSO-0001', 'ITP-00421', 'exit', 'SK', 'UA', 'Budince', 48.53, 22.10),
  P('lab-in', 'sk', 'SK-TSO-0001', 'UGS-00538', 'entry', 'zásobník', 'SK', 'Láb', 48.37, 16.97, 'gas.note-lab'),
  P('lab-out', 'sk', 'SK-TSO-0001', 'UGS-00538', 'exit', 'SK', 'zásobník', 'Láb', 48.37, 16.97),
  // Hranice EÚ s bývalým ZSSR a ruské trasy
  P('strandzha2', 'east', 'BG-TSO-0001', 'ITP-00549', 'entry', 'TR', 'BG', 'Strandža 2 (TurkStream)', 42.04, 27.45, 'gas.note-turkstream'),
  P('strandzha1', 'east', 'BG-TSO-0001', 'ITP-00041', 'entry', 'TR', 'BG', 'Strandža 1 (Trans-Balkán)', 42.04, 27.45, 'gas.note-transbalkan'),
  P('greifswald-opal', 'east', 'DE-TSO-0016', 'ITP-00251', 'entry', 'RU', 'DE', 'Greifswald / OPAL', 54.14, 13.66, 'gas.note-nordstream'),
  P('greifswald-nel', 'east', 'DE-TSO-0017', 'ITP-00247', 'entry', 'RU', 'DE', 'Greifswald / NEL', 54.14, 13.66, 'gas.note-nordstream'),
  P('imatra', 'east', 'FI-TSO-0003', 'ITP-00024', 'entry', 'RU', 'FI', 'Imatra', 61.17, 28.77, 'gas.note-imatra'),
  P('narva', 'east', 'EE-TSO-0001', 'ITP-00243', 'entry', 'RU', 'EE', 'Narva', 59.38, 28.19, 'gas.note-baltic'),
  P('varska', 'east', 'EE-TSO-0001', 'ITP-00187', 'entry', 'RU', 'EE', 'Värska', 57.95, 27.63, 'gas.note-baltic'),
  P('kotlovka', 'east', 'LT-TSO-0001', 'ITP-00085', 'entry', 'BY', 'LT', 'Kotlovka', 55.32, 26.30, 'gas.note-kotlovka'),
  P('sudzha', 'east', 'UA-TSO-0001', 'ITP-00184', 'entry', 'RU', 'UA', 'Sudža', 51.19, 35.27, 'gas.note-sudzha'),
  P('kobryn', 'east', 'UA-TSO-0001', 'ITP-00445', 'entry', 'BY', 'UA', 'Kobryn', 52.21, 24.36, 'gas.note-belarus'),
  P('mozyr', 'east', 'UA-TSO-0001', 'ITP-00446', 'entry', 'BY', 'UA', 'Mozyr', 52.05, 29.25, 'gas.note-belarus'),
  P('isaccea-in', 'east', 'RO-TSO-0001', 'ITP-00087', 'entry', 'UA', 'RO', 'Isaccea I', 45.27, 28.46, 'gas.note-isaccea'),
  P('isaccea-out', 'east', 'RO-TSO-0001', 'ITP-00087', 'exit', 'RO', 'UA', 'Isaccea I', 45.27, 28.46),
  P('bereg-in', 'east', 'HU-TSO-0001', 'ITP-10006', 'entry', 'UA', 'HU', 'VIP Bereg', 48.20, 22.53, 'gas.note-bereg'),
  P('bereg-out', 'east', 'HU-TSO-0001', 'ITP-10006', 'exit', 'HU', 'UA', 'VIP Bereg', 48.20, 22.53),
  P('ungheni', 'east', 'RO-TSO-0001', 'ITP-00154', 'exit', 'RO', 'MD', 'Ungheni', 47.21, 27.80, 'gas.note-ungheni'),
  P('kipoi', 'east', 'AL-TSO-0001', 'ITP-00274', 'entry', 'TR', 'GR', 'Kipoi (TAP)', 40.95, 26.30, 'gas.note-tap'),
  P('kipi', 'east', 'GR-TSO-0001', 'ITP-00046', 'entry', 'TR', 'GR', 'Kipi (ITG)', 40.95, 26.32, 'gas.note-kipi'),
]);

/** Kľúč smeru tak, ako ho berie ENTSOG `pointDirection` (malé písmená, bez oddeľovačov). */
export function pointDirectionKey(p) {
  return `${p.operator}${p.point}${p.dir}`.toLowerCase();
}

export function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Okno dopytu: `days` dní späť až po zajtrajšok (ENTSOG má `to` inkluzívne v dňoch). */
export function flowWindow(nowMs, days = GAS_FLOW_DAYS) {
  return { from: isoDay(nowMs - days * DAY_MS), to: isoDay(nowMs + DAY_MS) };
}

/**
 * Jeden dopyt pre všetky smery (indicator Physical Flow, denne, CET, bez limitu).
 * @param {ReadonlyArray<{operator: string, point: string, dir: string}>} points
 * @param {{from: string, to: string}} window
 * @param {{base?: string}} [o]
 */
export function entsogFlowsUrl(points, { from, to }, { base = ENTSOG_OPERATIONAL_DATA_URL } = {}) {
  const url = new URL(base);
  url.searchParams.set('pointDirection', points.map(pointDirectionKey).join(','));
  url.searchParams.set('indicator', 'Physical Flow');
  url.searchParams.set('periodType', 'day');
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  url.searchParams.set('timezone', 'CET');
  url.searchParams.set('limit', '-1');
  return url.toString();
}

/**
 * ENTSOG `operationalData` riadky → rady po smeroch. kWh/d → GWh/d (3 des.),
 * deň = začiatok plynárenského dňa (`periodFrom` v CET), duplicitný deň:
 * posledný riadok vyhráva (opravené hodnoty chodia neskôr).
 * @param {any[]} rows
 * @returns {Map<string, Array<{date: string, gwh: number, status: string|null}>>}
 */
export function normalizeFlowRows(rows) {
  const byKey = new Map();
  for (const r of rows || []) {
    const key = `${r?.operatorKey ?? ''}${r?.pointKey ?? ''}${r?.directionKey ?? ''}`.toLowerCase();
    const date = String(r?.periodFrom ?? '').slice(0, 10);
    const value = Number(r?.value);
    if (!key || !ISO_DAY_RE.test(date) || !Number.isFinite(value)) continue;
    const unit = String(r?.unit ?? 'kWh/d');
    const gwh = unit === 'MWh/d' ? value / 1e3 : (unit === 'GWh/d' ? value : value / 1e6);
    if (!byKey.has(key)) byKey.set(key, new Map());
    byKey.get(key).set(date, { date, gwh: Math.round(gwh * 1000) / 1000, status: r?.flowStatus ? String(r.flowStatus) : null });
  }
  const out = new Map();
  for (const [key, days] of byKey) out.set(key, [...days.values()].sort((a, b) => a.date.localeCompare(b.date)));
  return out;
}

/**
 * @param {Array<{date: string, gwh: number}>} series vzostupne
 * @returns {{latest: object|null, prev: object|null, avg7: number|null, max: number|null}}
 */
export function summarizeSeries(series) {
  const valid = (series || []).filter((r) => Number.isFinite(r?.gwh));
  if (!valid.length) return { latest: null, prev: null, avg7: null, max: null };
  const latest = valid[valid.length - 1];
  const prev = valid.length > 1 ? valid[valid.length - 2] : null;
  const last7 = valid.slice(-7);
  const avg7 = Math.round((last7.reduce((s, r) => s + r.gwh, 0) / last7.length) * 1000) / 1000;
  const max = Math.max(...valid.map((r) => r.gwh));
  return { latest, prev, avg7, max };
}

/** Citácia podľa čl. 5.2 podmienok ENTSOG TP: „ENTSOG TP [DD-MM-YYYY] https://transparency.entsog.eu/". */
export function entsogCitation(ms) {
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `ENTSOG TP ${dd}-${mm}-${d.getUTCFullYear()} ${ENTSOG_TP_URL}`;
}

/**
 * Serverová zostava odpovede proxy: katalóg + rady + súhrny.
 * @param {any[]} rows ENTSOG operationalData
 * @param {{points?: ReadonlyArray<object>, fetchedAt?: number, window?: object|null}} [o]
 */
export function buildFlowsPayload(rows, { points = GAS_FLOW_POINTS, fetchedAt = Date.now(), window = null } = {}) {
  const byKey = normalizeFlowRows(rows);
  return {
    points: points.map((p) => {
      const series = byKey.get(pointDirectionKey(p)) || [];
      const s = summarizeSeries(series);
      return { ...p, series, latest: s.latest, prev: s.prev, avg7: s.avg7, max: s.max };
    }),
    fetchedAt,
    window,
    source: 'ENTSOG Transparency Platform · Physical Flow · day',
    citation: entsogCitation(fetchedAt),
  };
}

const locale = (lang) => (lang === 'sk' ? 'sk-SK' : 'en-GB');
const fmt = (value, lang, digits) => new Intl.NumberFormat(locale(lang), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);

/** `24,6 GWh/d` (od 100 bez desatiny: `381 GWh/d`); nula → `0 GWh/d`; null → `—`. */
export function formatGwhDay(gwh, lang = 'sk') {
  if (!Number.isFinite(gwh)) return '—';
  if (Math.abs(gwh) < 0.05) return '0 GWh/d';
  return `${fmt(gwh, lang, Math.abs(gwh) >= 100 ? 0 : 1)} GWh/d`;
}

/** GWh/d → mil. m³/d pri KWH_PER_M3 (laický prepočet, preto „≈" v texte). */
export function mcmPerDay(gwh) {
  return Number.isFinite(gwh) ? Math.round((gwh / KWH_PER_M3) * 100) / 100 : null;
}

export async function fetchGasFlows({ fetcher = (...a) => fetch(...a), url = GAS_FLOWS_API } = {}) {
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
 * Model karty TOKY (čistý; DOM skladá gasPanel.js).
 * @param {{points?: any[], fetchedAt?: number, citation?: string}|null} payload
 * @param {{lang?: string, translate?: (k: string, v?: object) => string, nowMs?: number}} [o]
 */
export function buildFlowsModel(payload, { lang = 'sk', translate = (key) => key, nowMs = Date.now() } = {}) {
  const points = Array.isArray(payload?.points) ? payload.points : [];
  if (!points.length) return { ok: false, reason: 'empty' };
  let latestDate = null;
  const rowModel = (p) => {
    const latest = p.latest || null;
    if (latest?.date && (!latestDate || latest.date > latestDate)) latestDate = latest.date;
    const gwh = Number.isFinite(latest?.gwh) ? latest.gwh : null;
    const level = gwh === null ? 'nodata' : (gwh >= 0.05 ? 'flow' : 'zero');
    const mcm = level === 'flow' ? mcmPerDay(gwh) : null;
    return {
      id: p.id,
      name: p.name,
      route: `${p.from} → ${p.to}`,
      lat: p.lat,
      lon: p.lon,
      level,
      gwh,
      text: level === 'nodata' ? translate('gas.flow-nodata') : formatGwhDay(gwh, lang),
      mcmText: mcm !== null ? translate('gas.flow-mcm', { v: fmt(mcm, lang, mcm >= 10 ? 0 : 1) }) : '',
      avg7Text: Number.isFinite(p.avg7) && p.avg7 >= 0.05 ? translate('gas.flow-avg7', { v: formatGwhDay(p.avg7, lang) }) : '',
      dateText: latest ? formatDateLabel(latest.date, lang, { year: false }) : '',
      statusText: latest?.status ? translate(/^prov/i.test(latest.status) ? 'gas.flow-provisional' : 'gas.flow-confirmed') : '',
      note: p.noteKey ? translate(p.noteKey) : '',
      spark: (p.series || []).slice(-GAS_FLOW_SPARK_DAYS).map((r) => r.gwh),
    };
  };
  const groups = GAS_FLOW_GROUPS.map((key) => ({
    key,
    title: translate(`gas.flows-${key}`),
    rows: points.filter((p) => p.group === key).map(rowModel),
  }));
  const ageDays = latestDate ? Math.floor((nowMs - Date.UTC(Number(latestDate.slice(0, 4)), Number(latestDate.slice(5, 7)) - 1, Number(latestDate.slice(8, 10)))) / DAY_MS) : null;
  const stale = latestDate === null || (Number.isFinite(ageDays) && ageDays > GAS_FLOWS_STALE_DAYS);
  return {
    ok: true,
    groups,
    note: translate('gas.flows-note'),
    sourceLine: payload?.citation || entsogCitation(payload?.fetchedAt ?? nowMs),
    freshness: { fetchedAt: payload?.fetchedAt ?? null, latestDate, ageDays, stale },
  };
}
