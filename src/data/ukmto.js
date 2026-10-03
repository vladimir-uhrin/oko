// src/data/ukmto.js
/**
 * @module ukmto
 * @description INCIDENTY LODÍ — varovania UKMTO (United Kingdom Maritime Trade Operations)
 * pre modul BLÍZKY VÝCHOD (etapa 5c, 2026-10-03; plán docs/drafts/blizky-vychod-plan.md kap. 6,
 * prieskum C2).
 *
 * Zdroj (bez kľúča): `https://sccd.royalnavy.mod.uk/api/ukmto/all` — dátové rozhranie, z ktorého
 * kreslí mapu stránka ukmto.org „Recent Incidents" (pole incidentov za približne posledné tri
 * mesiace: číslo, čas, druh, poloha, oblasť, druh plavidla, text varovania). Podmienky ukmto.org
 * (bod 20): „www.ukmto.org is published under the Open Government Licence" → použitie
 * s uvedením zdroja a odkazom na licenciu.
 *
 * ZÁMERNE NIE mscio.eu: priečinok PDF varovaní MSCIO (EU NAVFOR) a z neho odvodené mirrory
 * (GitHub `Wyvern-2021/ukmto-signage`) majú v podmienkach zákaz zverejňovať informácie zo
 * stránky („may not … publish … including on the User's internet site") — preverené 2026-10-03.
 *
 * POCTIVOSŤ: varovanie je HLÁSENÁ udalosť („UKMTO has received a report…"), poloha je tá,
 * ktorú uvádza UKMTO. Mená plavidiel sa neberú vôbec (UKMTO ich aj tak anonymizuje), osoby
 * nikdy. Modul je čistý (bez DOM, bez Cesia).
 */

export const UKMTO_API_URL = 'https://sccd.royalnavy.mod.uk/api/ukmto/all';
export const UKMTO_SITE_URL = 'https://www.ukmto.org/recent-incidents';
export const UKMTO_LICENSE = 'Open Government Licence v3.0';
export const UKMTO_LICENSE_URL = 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/';
export const UKMTO_ATTRIBUTION = 'Source: UKMTO (United Kingdom Maritime Trade Operations), ukmto.org — contains public sector information licensed under the Open Government Licence v3.0';
export const UKMTO_API = '/api/mideast/events/ukmto';
/** Koľko dní dozadu ukazuje mapa a legenda (rozhranie UKMTO drží približne tri mesiace). */
export const UKMTO_DAYS_DEFAULT = 90;
/** Úžiny (chokepointScenes.js), pri ktorých sa incidenty ukážu — ležia v oblasti hlásení UKMTO. */
export const UKMTO_CHOKEPOINT_SCENES = Object.freeze(['hormuz', 'bab-el-mandeb', 'suez']);
const DAY_MS = 86_400_000;

/**
 * Druhy incidentov (číselník rozhrania `/incident/filters`, 2026-10-03: Advisory, Attack,
 * Attempted Boarding, Electronic Interference, Hijack, Illegal Boarding, Kidnap, Suspicious
 * Activity) → naše triedy s farbou bodu. `rank` = poradie v legende (vážnejšie prvé).
 */
export const UKMTO_TYPES = Object.freeze([
  Object.freeze({ id: 'hijack', match: /^hijack$/i, css: '#ff3d9a', rank: 7 }),
  Object.freeze({ id: 'kidnap', match: /^kidnap$/i, css: '#ff3d9a', rank: 6 }),
  Object.freeze({ id: 'attack', match: /^attack$/i, css: '#ff5a5f', rank: 5 }),
  Object.freeze({ id: 'boarding', match: /boarding/i, css: '#ff8a3d', rank: 4 }),
  Object.freeze({ id: 'suspicious', match: /^suspicious/i, css: '#ffb547', rank: 3 }),
  Object.freeze({ id: 'interference', match: /electronic interference/i, css: '#b07cff', rank: 2 }),
  Object.freeze({ id: 'advisory', match: /^advisory$/i, css: '#8fb8d8', rank: 1 }),
]);
export const UKMTO_TYPE_OTHER = Object.freeze({ id: 'other', css: '#8aa0b6', rank: 0 });

/** Trieda incidentu podľa názvu druhu z rozhrania. Pure. */
export function ukmtoType(name) {
  const s = String(name ?? '').trim();
  return UKMTO_TYPES.find((type) => type.match.test(s)) || UKMTO_TYPE_OTHER;
}

const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Text varovania bez hlavičky („UKMTO WARNING 078-26 - ATTACK", Report Date/Time, Issue Date,
 * Source) — od prvej vety „UKMTO has received…"; keď taká nie je, len bez riadkov hlavičky. Pure.
 */
export function ukmtoBody(details) {
  const raw = String(details ?? '');
  const start = raw.search(/UKMTO\s+(?:has|have|can|is|are|continues?)\b/i);
  const body = start >= 0 ? raw.slice(start) : raw
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:UKMTO[ _](?:WARNING|ADVISORY|ATTACK|HIJACK)\b|Report Date:|Report Time:|Issue Date:|Source:)/i.test(line))
    .join(' ');
  return squash(body);
}

/** Kto hlásil („Source: Master" → „Master"), inak null. Pure. */
export function ukmtoReporter(details) {
  const m = /(?:^|[\r\n])\s*Source:\s*([^\r\n]{2,60})(?:\r?\n\s*(Officer)\b)?/i.exec(String(details ?? ''));
  // „Company Security\r\nOfficer" — zalomený riadok hlavičky patrí k sebe.
  return m ? squash(`${m[1]} ${m[2] || ''}`).slice(0, 40) : null;
}

/**
 * Číslo varovania „149-26": z hlavičky textu, keď sedí s číslom incidentu z rozhrania; inak
 * z čísla incidentu a roka udalosti. Pure.
 */
export function ukmtoRef(details, number, tMs) {
  const m = /\bUKMTO[ _]+(?:WARNING|ADVISORY|ATTACK|HIJACK)?[ _]*0*(\d{1,3})\s*[-_ ]\s*(\d{2})\b/i.exec(String(details ?? '').slice(0, 80));
  const n = Number.isInteger(number) && number > 0 ? number : null;
  if (m && (n === null || Number(m[1]) === n)) return `${m[1].padStart(3, '0')}-${m[2]}`;
  if (n === null || !Number.isFinite(tMs)) return null;
  return `${String(n).padStart(3, '0')}-${String(new Date(tMs).getUTCFullYear()).slice(2)}`;
}

/**
 * Odpoveď rozhrania UKMTO → incidenty (najnovšie prvé). Riadok bez platného času alebo polohy
 * sa vynechá; meno plavidla sa neberie. Nepole = výnimka (volajúci nechá starý archív). Pure.
 * @returns {Array<{id:string, number:number|null, ref:string|null, t:number, createdAt:number|null, type:string, typeName:string, lat:number, lon:number, place:string, vesselType:string|null, reporter:string|null, text:string, hijacked:boolean}>}
 */
export function parseUkmtoIncidents(json) {
  if (!Array.isArray(json)) throw new Error('UKMTO: answer is not an array');
  const out = [];
  const seen = new Set();
  for (const r of json) {
    const t = Date.parse(String(r?.utcDateOfIncident ?? ''));
    const lat = Number(r?.locationLatitude);
    const lon = Number(r?.locationLongitude);
    if (!Number.isFinite(t) || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) continue;
    const number = Number.isInteger(r?.incidentNumber) && r.incidentNumber > 0 ? r.incidentNumber : null;
    const sid = String(r?.sitecoreId ?? '').toLowerCase();
    const id = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(sid) ? sid : `n${number ?? 'x'}-${new Date(t).toISOString().slice(0, 16)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const typeName = squash(r?.incidentTypeName) || 'Incident';
    const created = Date.parse(String(r?.utcDateCreated ?? ''));
    const vesselType = squash(r?.vesselType);
    out.push({
      id,
      number,
      ref: ukmtoRef(r?.otherDetails, number, t),
      t,
      createdAt: Number.isFinite(created) ? created : null,
      type: ukmtoType(typeName).id,
      typeName,
      lat: Math.round(lat * 10_000) / 10_000,
      lon: Math.round(lon * 10_000) / 10_000,
      place: squash(r?.place),
      vesselType: vesselType && vesselType.length <= 30 ? vesselType : null,
      reporter: ukmtoReporter(r?.otherDetails),
      text: ukmtoBody(r?.otherDetails).slice(0, 700),
      hijacked: r?.vesselUnderPirateControl === true,
    });
  }
  out.sort((a, b) => b.t - a.t);
  return out;
}

/** Zlúči archív s novou odpoveďou (rovnaké id = novší záznam vyhrá), najnovšie prvé. Pure. */
export function mergeUkmtoIncidents(existing, incoming) {
  const map = new Map();
  for (const it of Array.isArray(existing) ? existing : []) if (it?.id) map.set(it.id, it);
  for (const it of Array.isArray(incoming) ? incoming : []) if (it?.id) map.set(it.id, it);
  return [...map.values()].sort((a, b) => b.t - a.t);
}

/** Vek incidentu pre kreslenie: 'fresh' ≤ 7 dní, 'recent' ≤ 30 dní, inak 'old'. Pure. */
export function ukmtoAge(tMs, nowMs = Date.now()) {
  const days = (nowMs - tMs) / DAY_MS;
  return days <= 7 ? 'fresh' : (days <= 30 ? 'recent' : 'old');
}

/**
 * Súhrn pre legendu: počty podľa druhu za posledných `days` dní (zoradené podľa vážnosti)
 * a najnovšie incidenty. Pure.
 */
export function ukmtoSummary(incidents, { nowMs = Date.now(), days = 30, latest = 5 } = {}) {
  const list = Array.isArray(incidents) ? incidents : [];
  const since = nowMs - days * DAY_MS;
  const counts = new Map();
  let total = 0;
  for (const it of list) {
    if (it.t < since || it.t > nowMs + DAY_MS) continue;
    counts.set(it.type, (counts.get(it.type) || 0) + 1);
    total += 1;
  }
  const typeOf = (id) => UKMTO_TYPES.find((x) => x.id === id) || UKMTO_TYPE_OTHER;
  return {
    days,
    total,
    byType: [...counts].map(([type, count]) => ({ type, count, css: typeOf(type).css, rank: typeOf(type).rank })).sort((a, b) => b.rank - a.rank),
    latest: list.slice(0, Math.max(0, latest)),
  };
}

/**
 * Klient: incidenty z archívu servera. Chyba proxy = výnimka s `status`.
 * @param {{fetcher?: typeof fetch, base?: string, days?: number}} [o]
 */
export async function fetchUkmto({ fetcher = (...a) => fetch(...a), base = UKMTO_API, days = UKMTO_DAYS_DEFAULT } = {}) {
  const response = await fetcher(`${base}?days=${encodeURIComponent(days)}`, { cache: 'no-store' });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(json?.error ? String(json.error) : `HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  if (!json || !Array.isArray(json.incidents)) throw new Error('bad_ukmto_payload');
  return json;
}
