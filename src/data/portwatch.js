// src/data/portwatch.js
/**
 * @module portwatch
 * @description IMF PortWatch — denné prechody lodí úžinami pre modul BLÍZKY VÝCHOD
 * (etapa 5a, 2026-09-26; plán docs/drafts/blizky-vychod-plan.md kap. 6, prieskum kap. C1).
 *
 * Zdroj: ArcGIS FeatureServer `Daily_Chokepoints_Data` (verejný, bez kľúča; 28 úžin,
 * denné riadky od 1. 1. 2019, pole `date` je `esriFieldTypeDateOnly` = reťazec
 * YYYY-MM-DD, strana najviac 1 000 riadkov). MMF počty ODHADUJE z AIS a označuje ich
 * ako predbežné; dataset sa obnovuje približne raz týždenne (26. 9. 2026: posledný
 * riadok 20. 9., posledná úprava 22. 9.). Podmienky MMF (imf.org/en/about/copyright-and-terms):
 * dáta možno kopírovať, odvodzovať a publikovať s atribúciou „Source: International
 * Monetary Fund, <databáza>, <odkaz>" a bez zmeny, ktorá by menila ich význam.
 *
 * Porovnanie s obdobím pred krízou je ODVODENÉ (náš priemer nad ich dennými číslami) a
 * pre každú úžinu má vlastné, pomenované okno: Hormuz = rok pred vojnou s Iránom
 * (28. 2. 2025 – 27. 2. 2026), Červené more a obchádzka = pred útokmi Húsíov na lode
 * (1. 1. – 15. 11. 2023; útoky od 19. 11. 2023). Riadok ukladáme kompaktne ako pole
 * `[deň, spolu, tankery, kontajnerové, suchý_náklad, všeobecný_náklad, roro, kapacita, kapacita_tankerov]`.
 *
 * Čistý modul — žiadne DOM, Cesium ani sieť okrem vstreknutého `fetcher`.
 */
import { dayKey, dayToMs } from './ukraineEvents.js';

export const PORTWATCH_QUERY_URL = 'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query';
export const PORTWATCH_DATASET_URL = 'https://portwatch.imf.org/datasets/42132aa4e2fc4d41bdaf9a445f688931_0/about';
export const PORTWATCH_ATTRIBUTION = 'Source: International Monetary Fund, PortWatch — Daily Chokepoint Transit Calls and Trade Volume Estimates (portwatch.imf.org)';
export const PORTWATCH_LICENSE = 'IMF Copyright and Usage: reuse with attribution, no alteration that changes the meaning';
export const PORTWATCH_FIRST_DAY = '2019-01-01';
export const PORTWATCH_PAGE_SIZE = 1000;
/** Nad tento vek posledného dňa je séria ZASTARANÁ (dataset ide raz týždenne + ~2 dni oneskorenie). */
export const PORTWATCH_STALE_DAYS = 14;
/** Polia dotazu v poradí stĺpcov kompaktného riadku (okrem dňa). */
export const PORTWATCH_FIELDS = Object.freeze(['date', 'n_total', 'n_tanker', 'n_container', 'n_dry_bulk', 'n_general_cargo', 'n_roro', 'capacity', 'capacity_tanker']);
/** Indexy stĺpcov kompaktného riadku. */
export const PW = Object.freeze({ day: 0, total: 1, tanker: 2, container: 3, dryBulk: 4, generalCargo: 5, roro: 6, capacity: 7, capacityTanker: 8 });

const BASELINES = Object.freeze({
  'iran-war': Object.freeze({ id: 'iran-war', from: '2025-02-28', to: '2026-02-27' }),
  'red-sea': Object.freeze({ id: 'red-sea', from: '2023-01-01', to: '2023-11-15' }),
});

/**
 * Úžiny karty BLÍZKY VÝCHOD. `key` = náš kľúč (i18n `mideast.pw.<key>`, scéna úžiny),
 * `portid` = id v PortWatch, `baseline` = pomenované okno „pred krízou".
 */
export const PORTWATCH_CHOKEPOINTS = Object.freeze([
  Object.freeze({ key: 'hormuz', portid: 'chokepoint6', name: 'Strait of Hormuz', baseline: BASELINES['iran-war'] }),
  Object.freeze({ key: 'bab-el-mandeb', portid: 'chokepoint4', name: 'Bab el-Mandeb Strait', baseline: BASELINES['red-sea'] }),
  Object.freeze({ key: 'suez', portid: 'chokepoint1', name: 'Suez Canal', baseline: BASELINES['red-sea'] }),
  Object.freeze({ key: 'cape', portid: 'chokepoint7', name: 'Cape of Good Hope', baseline: BASELINES['red-sea'] }),
]);
export const PORTWATCH_KEYS = Object.freeze(PORTWATCH_CHOKEPOINTS.map((c) => c.key));

/** Úžina podľa nášho kľúča alebo null. Pure. */
export function portwatchChokepoint(key) {
  return PORTWATCH_CHOKEPOINTS.find((c) => c.key === key) || null;
}

/** Úžina, ktorú karta zvýrazní pri dejisku (Hormuz/Záliv → Hormuz, Jemen/Červené more → Báb al-Mandab). Pure. */
export function portwatchKeyForTheatre(theatreId) {
  return ({ hormuz: 'hormuz', gulf: 'hormuz', 'red-sea': 'bab-el-mandeb', yemen: 'bab-el-mandeb' })[String(theatreId || '')] || null;
}

const isDayStr = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && dayToMs(s) !== null && dayKey(dayToMs(s)) === s;

/**
 * URL jednej strany dotazu (vzostupne podľa dňa, voliteľne od dňa `fromDay`). Pure.
 * @param {string} portid napr. 'chokepoint6'
 * @param {{fromDay?: string|null, offset?: number, pageSize?: number}} [o]
 */
export function portwatchQueryUrl(portid, { fromDay = null, offset = 0, pageSize = PORTWATCH_PAGE_SIZE } = {}) {
  if (!/^chokepoint\d{1,2}$/.test(String(portid || ''))) throw new Error(`bad portid: ${portid}`);
  let where = `portid='${portid}'`;
  if (fromDay !== null) {
    if (!isDayStr(fromDay)) throw new Error(`bad fromDay: ${fromDay}`);
    where += ` AND date >= DATE '${fromDay}'`;
  }
  const p = new URLSearchParams({
    where, outFields: PORTWATCH_FIELDS.join(','), orderByFields: 'date ASC', returnGeometry: 'false',
    resultOffset: String(Math.max(0, Math.floor(offset))), resultRecordCount: String(Math.max(1, Math.floor(pageSize))), f: 'json',
  });
  return `${PORTWATCH_QUERY_URL}?${p}`;
}

const count = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : 0);

/**
 * Odpoveď ArcGIS → kompaktné riadky (neplatný deň sa zahodí, záporné/chýbajúce čísla = 0).
 * Chyba ArcGIS (`{error}`) hodí výnimku — prázdna strana nie je chyba. Pure.
 * @returns {Array<Array<string|number>>}
 */
export function parsePortwatchFeatures(json) {
  if (json && json.error) throw new Error(`PortWatch error ${json.error.code || ''}: ${json.error.message || 'unknown'}`.trim());
  if (!json || !Array.isArray(json.features)) throw new Error('PortWatch: no features array');
  const out = [];
  for (const f of json.features) {
    const a = f && f.attributes;
    if (!a || !isDayStr(a.date)) continue;
    out.push([a.date, count(a.n_total), count(a.n_tanker), count(a.n_container), count(a.n_dry_bulk), count(a.n_general_cargo), count(a.n_roro), count(a.capacity), count(a.capacity_tanker)]);
  }
  return out;
}

/** Zlúči dve série podľa dňa (novšia vyhráva — MMF spätne opravuje predbežné dni) a zoradí vzostupne. Pure. */
export function mergePortwatchRows(existing, incoming) {
  const byDay = new Map();
  for (const r of Array.isArray(existing) ? existing : []) if (Array.isArray(r) && isDayStr(r[0])) byDay.set(r[0], r);
  for (const r of Array.isArray(incoming) ? incoming : []) if (Array.isArray(r) && isDayStr(r[0])) byDay.set(r[0], r);
  return [...byDay.values()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * Priemer stĺpca cez dni v okne [from, to] (vrátane), len dni, ktoré v sérii sú. Pure.
 * @returns {{mean: number|null, days: number}}
 */
export function meanOver(rows, from, to, col = PW.total) {
  let sum = 0; let days = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r[0] < from || r[0] > to) continue;
    const v = Number(r[col]);
    if (!Number.isFinite(v)) continue;
    sum += v; days += 1;
  }
  return { mean: days ? sum / days : null, days };
}

/**
 * Súhrn úžiny pre kartu: posledný deň, priemer 7 a 30 dní končiacich posledným dňom,
 * priemer okna pred krízou, zmena 7-dňového priemeru voči nemu v %, vek a zastaranie,
 * a séria posledných `sparkDays` dní pre mini graf. Pure.
 * @param {Array} rows kompaktné riadky vzostupne
 * @param {object} chokepoint položka PORTWATCH_CHOKEPOINTS
 * @param {{nowMs?: number, staleDays?: number, sparkDays?: number, baselineMean?: number|null, baselineTankerMean?: number|null, baselineDays?: number|null}} [o]
 *   `baselineMean` a spol. = hodnoty vypočítané serverom z celej série (klient má len chvost).
 */
export function portwatchSummary(rows, chokepoint, { nowMs = Date.now(), staleDays = PORTWATCH_STALE_DAYS, sparkDays = 365, baselineMean = undefined, baselineTankerMean = undefined, baselineDays = undefined } = {}) {
  const list = Array.isArray(rows) ? rows.filter((r) => Array.isArray(r) && isDayStr(r[0])) : [];
  const b = chokepoint?.baseline || null;
  const base = b ? meanOver(list, b.from, b.to, PW.total) : { mean: null, days: 0 };
  const baseTanker = b ? meanOver(list, b.from, b.to, PW.tanker) : { mean: null, days: 0 };
  const baseline = b ? {
    id: b.id, from: b.from, to: b.to,
    mean: baselineMean !== undefined ? baselineMean : base.mean,
    meanTanker: baselineTankerMean !== undefined ? baselineTankerMean : baseTanker.mean,
    days: baselineDays !== undefined ? baselineDays : base.days,
  } : null;
  if (!list.length) {
    return { key: chokepoint?.key || null, lastDay: null, lastTotal: null, lastTanker: null, avg7: null, avg7Tanker: null, avg30: null, days7: 0, baseline, pctVsBaseline: null, ageDays: null, stale: false, spark: [] };
  }
  const last = list[list.length - 1];
  const lastMs = dayToMs(last[0]);
  const from7 = dayKey(lastMs - 6 * 86_400_000);
  const from30 = dayKey(lastMs - 29 * 86_400_000);
  const a7 = meanOver(list, from7, last[0], PW.total);
  const a7t = meanOver(list, from7, last[0], PW.tanker);
  const a30 = meanOver(list, from30, last[0], PW.total);
  const pct = baseline && Number.isFinite(baseline.mean) && baseline.mean > 0 && a7.mean !== null
    ? Math.round(((a7.mean - baseline.mean) / baseline.mean) * 100)
    : null;
  const ageDays = Number.isFinite(nowMs) ? Math.max(0, Math.floor((nowMs - lastMs) / 86_400_000)) : null;
  const sparkFrom = dayKey(lastMs - (Math.max(1, sparkDays) - 1) * 86_400_000);
  return {
    key: chokepoint?.key || null,
    lastDay: last[0], lastTotal: last[PW.total], lastTanker: last[PW.tanker],
    avg7: a7.mean, avg7Tanker: a7t.mean, avg30: a30.mean, days7: a7.days,
    baseline, pctVsBaseline: pct,
    ageDays, stale: ageDays !== null && ageDays > staleDays,
    spark: list.filter((r) => r[0] >= sparkFrom).map((r) => ({ day: r[0], total: r[PW.total] })),
  };
}

/**
 * Prechody z proxy (`/api/mideast/events/portwatch`). Chyby ako `Error` so `status`
 * (404 = `no_portwatch_snapshot`: archivár ešte nič nestiahol). 200 bez poľa
 * `chokepoints` = `bad_portwatch_payload`.
 * @param {string[]} keys
 * @param {{fetcher?: Function, base?: string, days?: number}} [o]
 */
export async function fetchPortwatch(keys = PORTWATCH_KEYS, { fetcher = (...a) => fetch(...a), base = '/api/mideast/events', days = 400 } = {}) {
  const q = new URLSearchParams({ keys: (keys || []).join(','), days: String(days) });
  const response = await fetcher(`${base}/portwatch?${q}`, { cache: 'no-store' });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(json?.error ? String(json.error) : `HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  if (!json || !Array.isArray(json.chokepoints)) {
    const err = new Error('bad_portwatch_payload');
    err.status = response.status;
    throw err;
  }
  return json;
}
