// src/data/mideastHumanitarian.js — HUMANITÁRNE SÚČTY modulu BLÍZKY VÝCHOD (etapa 6, 2026-11-06;
// plán docs/drafts/blizky-vychod-plan.md kap. 6 „Tech for Palestine súčty v karte Gazy a Západného
// brehu"). Čistý model pre server (archív) aj klienta (panel).
//
// Zdroj: Tech for Palestine, `data.techforpalestine.org/api/v3/summary.json` — súhrn hlásení
// ministerstva zdravotníctva v Gaze (cez OCHA/UN), pre Západný breh (OCHA) a Libanon (ministerstvo
// zdravotníctva Libanonu); dataset je public domain (stránka projektu). Berieme LEN súčty:
// zabití spolu/deti/ženy/zdravotníci/novinári/civilná obrana, zranení, počet hlásení, dátum
// posledného hlásenia. Zoznamy mien (`killed-in-gaza`, `press_killed_in_gaza`) sa NIKDY nesťahujú
// (plán kap. 4 bod 4 — mená obetí nikdy). Čísla sú hlásenia strany konfliktu — karta to menuje
// („podľa ministerstva zdravotníctva v Gaze“), nie OKO.

export const MIDEAST_HUMANITARIAN_API = '/api/mideast/events/humanitarian';
export const T4P_SUMMARY_URL = 'https://data.techforpalestine.org/api/v3/summary.json';
export const T4P_SITE = 'https://data.techforpalestine.org/';
export const T4P_ATTRIBUTION = 'Tech for Palestine — súhrn hlásení ministerstva zdravotníctva v Gaze, OCHA (Západný breh) a ministerstva zdravotníctva Libanonu';
export const T4P_LICENSE = 'public domain (data.techforpalestine.org)';
/** Dejisko → kľúč súhrnu T4P. Dejiská bez kľúča kartu nemajú. */
export const HUMANITARIAN_THEATRES = Object.freeze({ gaza: 'gaza', 'west-bank': 'west_bank', 'south-lebanon': 'lebanon' });
export const humanitarianKeyForTheatre = (id) => HUMANITARIAN_THEATRES[id] || null;

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);

/**
 * Surový súhrn v3 → len súčty (bez zoznamov mien). Chýbajúci blok = null. Pure.
 * @param {any} json
 * @returns {{ gaza: object|null, west_bank: object|null, lebanon: object|null }}
 */
export function parseT4pSummary(json) {
  if (!json || typeof json !== 'object') throw new Error('t4p: not an object');
  const gaza = json.gaza && typeof json.gaza === 'object' ? {
    reports: num(json.gaza.reports), lastUpdate: day(json.gaza.last_update),
    killed: num(json.gaza.killed?.total), children: num(json.gaza.killed?.children), women: num(json.gaza.killed?.women),
    medical: num(json.gaza.killed?.medical), press: num(json.gaza.killed?.press), civilDefence: num(json.gaza.killed?.civil_defence),
    injured: num(json.gaza.injured?.total),
  } : null;
  const wb = json.west_bank && typeof json.west_bank === 'object' ? {
    reports: num(json.west_bank.reports), lastUpdate: day(json.west_bank.last_update),
    killed: num(json.west_bank.killed?.total), children: num(json.west_bank.killed?.children),
    injured: num(json.west_bank.injured?.total), injuredChildren: num(json.west_bank.injured?.children),
    settlerAttacks: num(json.west_bank.settler_attacks),
  } : null;
  const lb = json.lebanon && typeof json.lebanon === 'object' ? {
    reports: num(json.lebanon.reports), lastUpdate: day(json.lebanon.last_update), firstReport: day(json.lebanon.first_report),
    killed: num(json.lebanon.killed?.total), injured: num(json.lebanon.injured?.total),
  } : null;
  if (!gaza && !wb && !lb) throw new Error('t4p: no summary blocks');
  return { gaza, west_bank: wb, lebanon: lb };
}

/**
 * Riadky karty pre dejisko: [{ id, value }] v poradí zobrazenia; null hodnoty vypadnú. Pure.
 * @param {ReturnType<typeof parseT4pSummary>} summary
 * @param {string} theatreId
 */
export function humanitarianRows(summary, theatreId) {
  const key = humanitarianKeyForTheatre(theatreId);
  const block = key ? summary?.[key] : null;
  if (!block) return [];
  const order = key === 'gaza'
    ? ['killed', 'children', 'women', 'medical', 'press', 'civilDefence', 'injured']
    : (key === 'west_bank' ? ['killed', 'children', 'injured', 'injuredChildren', 'settlerAttacks'] : ['killed', 'injured']);
  return order.filter((id) => Number.isFinite(block[id])).map((id) => ({ id, value: block[id] }));
}

async function getJson(fetcher, url, bad) {
  const response = await fetcher(url, { cache: 'no-store' });
  const json = await response.json().catch(() => null);
  if (!response.ok) { const err = new Error(json?.error ? String(json.error) : `HTTP ${response.status}`); err.status = response.status; throw err; }
  if (!json) throw new Error(bad);
  return json;
}
/** Klient: posledný súhrn zo servera. */
export async function fetchMideastHumanitarian({ fetcher = (...a) => fetch(...a), base = MIDEAST_HUMANITARIAN_API } = {}) {
  const json = await getJson(fetcher, base, 'bad_humanitarian_payload');
  if (!json.summary || typeof json.summary !== 'object') throw new Error('bad_humanitarian_payload');
  return json;
}
