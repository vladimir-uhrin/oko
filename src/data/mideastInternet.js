// src/data/mideastInternet.js — INTERNET (OONI) modulu BLÍZKY VÝCHOD (etapa 6, 2026-11-06; plán
// docs/drafts/blizky-vychod-plan.md kap. 6 „OONI ako čip internet pri Iráne, Iraku, Jemene").
// Čistý model pre server (archív) aj klienta (panel).
//
// Zdroj: OONI (Open Observatory of Network Interference), `api.ooni.io/api/v1/aggregation`
// — denné súčty meraní web_connectivity dobrovoľníkov v krajine: ok / anomálie / potvrdené
// blokovanie / zlyhania. Licencia CC BY-NC-SA 4.0 (ooni.org/data) — NEKOMERČNÁ, vyčlenená
// v DATA_SOURCES ako TeleGeography (plán kap. 4 bod 6). Ukazovateľ: podiel meraní s potvrdeným
// blokovaním alebo anomáliou za posledných 7 dní proti priemeru 30 dní pred nimi — vzostup
// o ≥ 10 bodov = „zhoršenie", pokles o ≥ 10 bodov = „zlepšenie". Nie je to meranie výpadku siete
// (to má IODA, bez odpovede na e-mail): keď merania chýbajú (deň pod `OONI_MIN_MEASUREMENTS`),
// deň sa nehodnotí — práve tichý deň môže byť výpadok, a to karta hovorí nahlas.
//
// Etická čiara: súčty po krajinách, nič o sondách ani ľuďoch.

export const MIDEAST_INTERNET_API = '/api/mideast/events/internet';
export const OONI_AGGREGATION_URL = 'https://api.ooni.io/api/v1/aggregation';
export const OONI_SITE = 'https://ooni.org/';
export const OONI_EXPLORER = 'https://explorer.ooni.org/';
export const OONI_ATTRIBUTION = 'OONI — Open Observatory of Network Interference (merania dobrovoľníkov) · CC BY-NC-SA 4.0';
export const OONI_LICENSE = 'CC BY-NC-SA 4.0 (nekomerčná)';
/** Krajiny ukazovateľa (ISO 3166-1 alpha-2); poradie = poradie v legende. */
export const OONI_COUNTRIES = Object.freeze(['IR', 'IQ', 'YE', 'LB', 'SY', 'IL']);
/** Dejisko → krajiny, ktoré jeho legenda ukazuje; prehľad všetky. */
export const INTERNET_THEATRES = Object.freeze({
  overview: OONI_COUNTRIES, iran: ['IR'], iraq: ['IQ'], yemen: ['YE'], 'red-sea': ['YE'], 'south-lebanon': ['LB', 'IL'], 'south-syria': ['SY'], israel: ['IL'], gaza: ['IL'], 'west-bank': ['IL'],
});
export const internetCountriesForTheatre = (id) => INTERNET_THEATRES[id] || null;
/** Deň s menej meraniami sa nehodnotí (podiel z pár meraní nič nehovorí). */
export const OONI_MIN_MEASUREMENTS = 50;
/** Rozdiel podielov (v bodoch), od ktorého je to zmena. */
export const OONI_CHANGE_POINTS = 10;
/** Koľko dní späť sa pýta jeden dopyt (prekrytie s archívom; posledné dni OONI dopĺňa spätne). */
export const OONI_QUERY_DAYS = 45;
export const OONI_KEEP_DAYS = 400;

const DAY_MS = 86_400_000;
export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
export const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && Number.isFinite(Date.parse(`${s}T00:00:00Z`));

/** URL agregácie OONI za okno dní (until je výlučné — OONI počíta < until). Pure. */
export const ooniAggregationUrl = (cc, since, until) => `${OONI_AGGREGATION_URL}?${new URLSearchParams({ probe_cc: cc, test_name: 'web_connectivity', since, until, axis_x: 'measurement_start_day', time_grain: 'day' })}`;

/**
 * Odpoveď agregácie → riadky dní `{ day, ok, anomaly, confirmed, failure, total }`. Riadky bez
 * dňa alebo s nečíselnými počtami sa preskočia. Pure.
 */
export function parseOoniAggregation(json) {
  const rows = Array.isArray(json?.result) ? json.result : null;
  if (!rows) throw new Error('ooni: result missing');
  const out = [];
  for (const r of rows) {
    const day = String(r?.measurement_start_day || '').slice(0, 10);
    if (!isDay(day)) continue;
    const n = (v) => Math.max(0, Math.floor(Number(v) || 0));
    const row = { day, ok: n(r.ok_count), anomaly: n(r.anomaly_count), confirmed: n(r.confirmed_count), failure: n(r.failure_count) };
    row.total = n(r.measurement_count) || row.ok + row.anomaly + row.confirmed + row.failure;
    out.push(row);
  }
  out.sort((a, b) => (a.day < b.day ? -1 : 1));
  return out;
}

/** Zlúči staré a nové riadky po dňoch (nové vyhrávajú), oreže na `keepDays` najnovších. Pure. */
export function mergeOoniDays(oldRows, newRows, { keepDays = OONI_KEEP_DAYS } = {}) {
  const byDay = new Map();
  for (const r of [...(oldRows || []), ...(newRows || [])]) if (isDay(r?.day)) byDay.set(r.day, r);
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)).slice(-keepDays);
}

/** Podiel blokovaných (potvrdené + anomálie) z meraní bez zlyhaní, v percentách; null pod prahom. Pure. */
export function blockedShare(row, { minMeasurements = OONI_MIN_MEASUREMENTS } = {}) {
  const base = (Number(row?.ok) || 0) + (Number(row?.anomaly) || 0) + (Number(row?.confirmed) || 0);
  if (base < minMeasurements) return null;
  return Math.round((((Number(row?.anomaly) || 0) + (Number(row?.confirmed) || 0)) / base) * 1000) / 10;
}

/**
 * Ukazovateľ krajiny: priemer podielu za posledných 7 dní (`recent`), priemer 30 dní pred nimi
 * (`baseline`), rozdiel a stupeň: 'worse' | 'better' | 'same' | 'quiet' (málo meraní v posledných
 * 7 dňoch — možný výpadok, OONI ho nemeria) | 'none' (nič). Pure.
 * @param {Array<{day:string}>} rows
 * @param {number} nowMs
 */
export function internetIndicator(rows, nowMs = Date.now(), { minMeasurements = OONI_MIN_MEASUREMENTS, changePoints = OONI_CHANGE_POINTS } = {}) {
  const today = dayKey(nowMs);
  const recentFrom = dayKey(Date.parse(`${today}T00:00:00Z`) - 6 * DAY_MS);
  const baseFrom = dayKey(Date.parse(`${recentFrom}T00:00:00Z`) - 30 * DAY_MS);
  const mean = (list) => (list.length ? Math.round((list.reduce((s, v) => s + v, 0) / list.length) * 10) / 10 : null);
  const recentRows = (rows || []).filter((r) => r.day >= recentFrom && r.day <= today);
  const baseRows = (rows || []).filter((r) => r.day >= baseFrom && r.day < recentFrom);
  const recentShares = recentRows.map((r) => blockedShare(r, { minMeasurements })).filter((v) => v !== null);
  const baseShares = baseRows.map((r) => blockedShare(r, { minMeasurements })).filter((v) => v !== null);
  const recent = mean(recentShares); const baseline = mean(baseShares);
  const measurements = recentRows.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const lastDay = rows?.length ? rows.at(-1).day : null;
  let level = 'none';
  if (recent === null && baseline !== null) level = 'quiet';
  else if (recent !== null && baseline !== null) level = recent - baseline >= changePoints ? 'worse' : (baseline - recent >= changePoints ? 'better' : 'same');
  else if (recent !== null) level = 'same';
  const sparkline = (rows || []).filter((r) => r.day >= baseFrom && r.day <= today).map((r) => ({ day: r.day, share: blockedShare(r, { minMeasurements }) }));
  return { recent, baseline, delta: recent !== null && baseline !== null ? Math.round((recent - baseline) * 10) / 10 : null, level, measurements, days: recentShares.length, lastDay, sparkline };
}

async function getJson(fetcher, url, bad) {
  const response = await fetcher(url, { cache: 'no-store' });
  const json = await response.json().catch(() => null);
  if (!response.ok) { const err = new Error(json?.error ? String(json.error) : `HTTP ${response.status}`); err.status = response.status; throw err; }
  if (!json) throw new Error(bad);
  return json;
}
/** Klient: ukazovatele po krajinách zo servera. */
export async function fetchMideastInternet({ fetcher = (...a) => fetch(...a), base = MIDEAST_INTERNET_API } = {}) {
  const json = await getJson(fetcher, base, 'bad_internet_payload');
  if (!json.countries || typeof json.countries !== 'object') throw new Error('bad_internet_payload');
  return json;
}
