// src/data/czib.js
/**
 * @module czib
 * @description VZDUŠNÝ PRIESTOR — EASA Conflict Zone Information Bulletins (modul BLÍZKY
 * VÝCHOD, etapa 5b, 2026-10-03; plán docs/drafts/blizky-vychod-plan.md kap. 6, prieskum D1–D2).
 *
 * Zdroje (bez kľúča): export EASA `…/czibs/export-json?page&_format=json` (zoznam, stav,
 * platnosť, krajiny, čas úpravy), RSS `…/czibs/feed.xml` (odkaz na stránku bulletinu podľa
 * Nid) a stránka bulletinu (číslo CZIB, „Affected Airspace", odporúčania). EASA: „Reproduction
 * is authorised, provided the source is acknowledged" (copyright-disclaimer). Hranice FIR:
 * VATSpy Data Project (`Boundaries.geojson`, CC BY-SA 4.0) — hranice simulačnej komunity,
 * realistické, NIE úradné → v UI „približné hranice FIR".
 *
 * POCTIVOSŤ: bulletin je ODPORÚČANIE EASA pre leteckých prevádzkovateľov EÚ, nie zákaz
 * letov ani uzavretie priestoru. Keď sa týka len časti FIR (čiara cez body, „nad vodami",
 * západne od poludníka, provincie), kreslí sa len obrys FIR so značkou „časť FIR" — presnú
 * hranicu má len text bulletinu. Modul je čistý (bez DOM, bez Cesia).
 */

export const CZIB_EXPORT_URL = 'https://www.easa.europa.eu/en/domains/air-operations/czibs/export-json?page&_format=json';
export const CZIB_FEED_URL = 'https://www.easa.europa.eu/en/domains/air-operations/czibs/feed.xml';
export const CZIB_LIST_URL = 'https://www.easa.europa.eu/en/domains/air-operations/czibs';
export const VATSPY_BOUNDARIES_URL = 'https://raw.githubusercontent.com/vatsimnetwork/vatspy-data-project/master/Boundaries.geojson';
export const CZIB_ATTRIBUTION = 'Source: European Union Aviation Safety Agency (EASA) — Conflict Zone Information Bulletins (easa.europa.eu)';
export const FIR_ATTRIBUTION = 'FIR boundaries: VATSpy Data Project (VATSIM) · CC BY-SA 4.0 · approximate, not official';
export const FIR_LICENSE = 'CC BY-SA 4.0';
export const AIRSPACE_API = '/api/mideast/events/airspace';

/** Krajiny modulu BLÍZKY VÝCHOD (polia `country` exportu EASA) — legenda panela; vrstva kreslí všetky. */
export const MIDEAST_CZIB_COUNTRIES = Object.freeze([
  'Iran', 'Iraq', 'Israel', 'Lebanon', 'Syria', 'Jordan', 'Yemen', 'Saudi Arabia', 'Egypt',
  'Bahrain', 'Kuwait', 'Qatar', 'Oman', 'United Arab Emirates',
]);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
/** HTML entity → znak (pomenované z tabuľky, číselné, hex). Pure. */
export function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&#(\d{1,7});/g, (m, d) => { const n = Number(d); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m; })
    .replace(/&#x([0-9a-f]{1,6});/gi, (m, h) => { const n = parseInt(h, 16); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m; })
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/** „30/11/2026" → „2026-11-30", inak null. Pure. */
export function easaDay(value) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(value ?? '').trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return Number.isFinite(Date.parse(`${iso}T00:00:00Z`)) ? iso : null;
}

/** „2026-07-08T00:00:00+0300" → epoch ms (posun bez dvojbodky prijme), inak null. Pure. */
export function easaTime(value) {
  const s = String(value ?? '').trim().replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Export EASA → riadky bulletinov. Tvar `{ conflict_zones: [...] }` (2026-10-03) aj holé pole. Pure.
 * @returns {Array<{nid:string, name:string, status:string, active:boolean, countries:string[], issuedAt:number|null, validUntil:string|null, updatedAt:number|null, point:{lat:number,lon:number}|null}>}
 */
export function parseCzibExport(json) {
  const rows = Array.isArray(json) ? json : (Array.isArray(json?.conflict_zones) ? json.conflict_zones : (Object.values(json || {}).find(Array.isArray) || []));
  const out = [];
  for (const r of rows) {
    const nid = String(r?.Nid ?? '').trim();
    if (!/^\d{1,9}$/.test(nid)) continue;
    const [lat, lon] = String(r?.coordinates ?? '').split(',').map((v) => Number(v.trim()));
    const updated = /datetime="([^"]+)"/.exec(String(r?.updated ?? ''))?.[1] ?? r?.updated;
    out.push({
      nid,
      name: decodeEntities(r?.name).trim(),
      status: String(r?.status ?? '').trim(),
      active: String(r?.status ?? '').trim().toLowerCase() === 'active',
      countries: decodeEntities(r?.country).split(',').map((c) => c.trim()).filter(Boolean),
      issuedAt: easaTime(r?.issued_date),
      validUntil: easaDay(r?.valid_until_date),
      updatedAt: easaTime(updated),
      point: Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null,
    });
  }
  return out;
}

/** RSS EASA → Map Nid → URL stránky bulletinu (len https na easa.europa.eu). Pure. */
export function parseCzibFeed(xml) {
  const out = new Map();
  for (const m of String(xml ?? '').matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const nid = /<guid[^>]*>\s*(\d{1,9})\s+on\b/i.exec(m[1])?.[1];
    const link = decodeEntities(/<link>\s*([^<\s]+)\s*<\/link>/i.exec(m[1])?.[1] || '');
    if (!nid || !/^https:\/\/www\.easa\.europa\.eu\/[\w/.-]+$/.test(link)) continue;
    out.set(nid, link);
  }
  return out;
}

const DETAIL_LABELS = new Set([
  'Status', 'CZIB number', 'Issue date', 'Revision date', 'Revision description', 'Valid until',
  'Referenced publication(s):', 'Affected Airspace', 'Affected Countries', 'Applicability',
  'Applicability Description', 'Description', 'Recommendation(s)', 'Contact us', 'Get notified via email alerts',
]);

/** Telo stránky (`<main>`) → riadky textu; bloky a položky zoznamov sú samostatné riadky. Pure. */
export function detailLines(html) {
  const main = /<main[\s\S]*?<\/main>/i.exec(String(html ?? ''))?.[0] || String(html ?? '');
  return decodeEntities(main
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(?:br|li|\/li|\/p|\/div|\/h\d|\/ol|\/ul)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .split('\n')
    .map((s) => s.replace(/\s+/g, ' ').replace(/^[-–]\s+/, '').trim())
    .filter(Boolean);
}

/** Riadky pod popiskom až po ďalší popisok poľa. Pure. */
function section(lines, label) {
  const i = lines.indexOf(label);
  if (i < 0) return [];
  const out = [];
  for (let k = i + 1; k < lines.length && !DETAIL_LABELS.has(lines[k]); k += 1) out.push(lines[k]);
  return out;
}

/**
 * Stránka bulletinu → polia. Pure.
 * @returns {{czib:string|null, status:string|null, issued:string|null, revised:string|null, revisionNote:string|null, validUntil:string|null, affected:string, countries:string[], recommendations:string[]}}
 */
export function parseCzibDetail(html) {
  const lines = detailLines(html);
  const one = (label) => section(lines, label)[0] || null;
  const day = (label) => easaDay(String(one(label) || '').split(',')[0]);
  return {
    czib: one('CZIB number'),
    status: one('Status'),
    issued: day('Issue date'),
    revised: day('Revision date'),
    revisionNote: one('Revision description'),
    validUntil: day('Valid until'),
    affected: section(lines, 'Affected Airspace').join(' '),
    countries: section(lines, 'Affected Countries').flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean),
    recommendations: section(lines, 'Recommendation(s)'),
  };
}

/**
 * Kódy FIR (ICAO, 4 veľké písmená) z textu „Affected Airspace" — len v zátvorkách
 * („FIR Baghdad (ORBB)", „(FIR OYSC)", „(Bahrain FIR – OBBB)"), aby mená ako „FIR KYIV"
 * či „EASA" neprešli ako kódy. Pure.
 */
export function firCodesFromText(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(/\(([^)]{0,60})\)/g)) {
    for (const code of m[1].match(/\b[A-Z]{4}\b/g) || []) if (!out.includes(code)) out.push(code);
  }
  return out;
}

const PARTIAL_RE = /\b(?:west|east|north|south) of the line\b|defined by the line|over the waters|\b(?:west|east) of longitude|\bprovinces\b|within the territory and airspace of|\bnorth-east of\b/i;
const BELOW_FL_RE = /\b(?:at or )?below\s+(?:flight level\s*\(?FL\)?\s*|FL\s*)(\d{2,3})\b/i;

/** Prvé odporúčanie, ktoré niečo prikazuje („Not operate…", „recommends not to…"). Pure. */
export function mainRecommendation(recommendations) {
  const list = Array.isArray(recommendations) ? recommendations : [];
  return list.find((s) => /\bnot (?:to )?(?:operate|fly)\b|recommends? not/i.test(s)) || list.find((s) => !/should:?$/i.test(s)) || null;
}

/**
 * Rozsah bulletinu: výšky (všetky / pod FLxxx), časť FIR, výnimky. Hlavné odporúčanie má
 * prednosť pred „Affected Airspace" (Líbya: priestor „all altitudes", odporúčanie „below FL 320"). Pure.
 * @returns {{altitude:'all'|'below', fl:number|null, partial:boolean, partialHint:string|null, exceptions:boolean}}
 */
export function czibScope(affected, recommendations) {
  const rec = mainRecommendation(recommendations) || '';
  const both = `${rec} ${affected || ''}`;
  const below = BELOW_FL_RE.exec(rec) || BELOW_FL_RE.exec(String(affected || ''));
  const partial = PARTIAL_RE.exec(both);
  return {
    altitude: below ? 'below' : 'all',
    fl: below ? Number(below[1]) : null,
    partial: Boolean(partial),
    partialHint: partial ? partial[0].toLowerCase() : null,
    exceptions: /\bexcept\b/i.test(rec) || /\bexcept\b/i.test(String(affected || '')),
  };
}

/**
 * Riadok exportu + stránka bulletinu → model bulletinu (to, čo archív ukladá a vrstva kreslí). Pure.
 */
export function buildCzibBulletin(row, detail, url) {
  const recommendation = mainRecommendation(detail?.recommendations);
  return {
    nid: row.nid,
    czib: detail?.czib || null,
    title: row.name,
    status: row.status,
    active: row.active,
    countries: detail?.countries?.length ? detail.countries : row.countries,
    issued: detail?.issued || (row.issuedAt ? new Date(row.issuedAt).toISOString().slice(0, 10) : null),
    revised: detail?.revised || null,
    revisionNote: detail?.revisionNote || null,
    validUntil: detail?.validUntil || row.validUntil,
    updatedAt: row.updatedAt,
    point: row.point,
    url: url || null,
    affected: detail?.affected || '',
    recommendation,
    firs: firCodesFromText(detail?.affected || ''),
    scope: czibScope(detail?.affected || '', detail?.recommendations || []),
  };
}

/** Patrí bulletin Blízkemu východu (aspoň jedna krajina zo zoznamu)? Pure. */
export function isMideastBulletin(bulletin) {
  return (bulletin?.countries || []).some((c) => MIDEAST_CZIB_COUNTRIES.includes(c));
}

/** Platnosť uplynula (dátum „valid until" je pred dneškom), hoci EASA ešte nezmenila stav. Pure. */
export function czibLapsed(bulletin, nowMs = Date.now()) {
  if (!bulletin?.validUntil) return false;
  return Date.parse(`${bulletin.validUntil}T23:59:59Z`) < nowMs;
}

/**
 * Prstence polygónu FIR z GeoJSON (Polygon / MultiPolygon) → [[outer, ...holes], …] so
 * súradnicami zaokrúhlenými na 0,001° (≈ 100 m — hranice VATSpy sú beztak približné). Pure.
 */
export function firPolygons(geometry) {
  const polys = geometry?.type === 'Polygon' ? [geometry.coordinates] : (geometry?.type === 'MultiPolygon' ? geometry.coordinates : []);
  const round = (v) => Math.round(v * 1000) / 1000;
  const out = [];
  for (const poly of polys || []) {
    const rings = (poly || []).map((ring) => (ring || [])
      .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90)
      .map(([lon, lat]) => [round(lon), round(lat)]))
      .filter((ring) => ring.length >= 4);
    if (rings.length) out.push(rings);
  }
  return out;
}

/** GeoJSON VATSpy → Map kód → polygóny (len základné FIR bez sektorov „ORBB-N"). Pure. */
export function indexFirBoundaries(geojson) {
  const map = new Map();
  for (const f of Array.isArray(geojson?.features) ? geojson.features : []) {
    const id = String(f?.properties?.id || '');
    if (!/^[A-Z]{4}$/.test(id)) continue;
    const polygons = firPolygons(f.geometry);
    if (polygons.length) map.set(id, [...(map.get(id) || []), ...polygons]);
  }
  return map;
}

/**
 * Klient: aktívne bulletiny s polygónmi FIR z archívu servera. Chyba proxy = výnimka s `status`.
 * @param {{fetcher?: typeof fetch, base?: string}} [o]
 */
export async function fetchAirspace({ fetcher = (...a) => fetch(...a), base = AIRSPACE_API } = {}) {
  const response = await fetcher(base, { cache: 'no-store' });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(json?.error ? String(json.error) : `HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  if (!json || !Array.isArray(json.bulletins) || typeof json.firs !== 'object') throw new Error('bad_airspace_payload');
  return json;
}
