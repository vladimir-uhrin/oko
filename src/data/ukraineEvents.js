// src/data/ukraineEvents.js
/**
 * @module ukraineEvents
 * @description Jednotný model UDALOSTÍ modulu UKRAJINA (etapa 3a, 2026-09-19;
 * plán docs/drafts/ukrajina-plan.md, „Návrh: karty udalostí a časová os").
 * Udalosť = čas, miesto, typ, závažnosť, predmet, stavový riadok, úroveň
 * overenia, zdroje. Tri prítoky:
 *
 *  - VIINA 2.0 (ODbL, denne; Zhukov & Ayers): súbor „jeden za deň" — deň,
 *    sídlo GeoNames so súradnicami, presnosť geokódu, typové príznaky (BERT
 *    klasifikácia titulkov ukrajinských a ruských médií), aktér, počet správ.
 *    BEZ hodiny a BEZ textu — text surových hlásení sa zámerne neberie (sú tam
 *    aj médiá prílohy XV; my berieme len odvodený bod udalosti).
 *  - GeoConfirmed (verejné API, „freely available for research, journalism, and
 *    analytical use"): body overené proti fotke/videu — dátum, súradnice, popis,
 *    odkazy. ETICKÝ FILTER: nikdy riadky s jednotkami (Units/OrbatUnits), nikdy
 *    frakciu „Ukraine" (polohy a technika ukrajinskej strany — čl. 114-2 TZ UA),
 *    nikdy opisy pozícií; médiá sú len odkazy, nikdy embed.
 *  - Správy (situationNews región `ukraine`): titulok s hodinou, zdroj, obrázok
 *    (len kde to podmienky dovoľujú) → pripoja sa k udalosti v tom istom dni a
 *    mieste, inak sú samostatnou „hlásenou" udalosťou.
 *
 * Modul je čistý (bez DOM a Cesia); proxy aj klient ho zdieľajú.
 */
import { classifyIncident, cleanHeadline, locateIncident } from './gulfIncidents.js';
import { UKRAINE_GAZETTEER } from './ukraineIncidents.js';

export const UKRAINE_EVENTS_API = '/api/ukraine/events';
export const VIINA_MEDIA_BASE = 'https://media.githubusercontent.com/media/zhukovyuri/VIINA/main/Data/';
export const VIINA_ATTRIBUTION = 'VIINA 2.0 (Zhukov & Ayers) · ODbL';
export const GEOCONFIRMED_ATTRIBUTION = 'GeoConfirmed · OSINT verified';
/** Najviac dní na jeden dopyt proxy (okno časovej osi sa načítava po kusoch). */
export const EVENTS_MAX_DAYS = 31;

/** Typy udalostí (poradie = legenda). */
export const EVENT_TYPES = Object.freeze(['strike', 'artillery', 'ground', 'air-defence', 'infrastructure', 'naval', 'fire', 'civil', 'alert', 'other']);
export const SEVERITY_RANK = Object.freeze({ critical: 3, major: 2, minor: 1 });

/** Deň YYYY-MM-DD z ms UTC. Pure. */
export function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
/** YYYYMMDD / YYYY-MM-DD → ms UTC o polnoci, inak null. Pure. */
export function dayToMs(value) {
  const s = String(value ?? '').replace(/-/g, '');
  const m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Number.isFinite(ms) ? ms : null;
}

/** Jednoduchý CSV splitter s úvodzovkami (RFC 4180 základ). Pure. */
export function splitCsvLine(line, sep = ',') {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = !quoted;
    } else if (ch === sep && !quoted) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** CSV text → riadky ako objekty podľa hlavičky. Pure. */
export function parseCsv(text, sep = ',') {
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0], sep).map((h) => h.trim());
  const out = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i], sep);
    const row = {};
    for (let k = 0; k < header.length; k += 1) row[header[k]] = cells[k] ?? '';
    out.push(row);
  }
  return out;
}

// ── VIINA ─────────────────────────────────────────────────────────────────
const flag = (row, name) => row[name] === '1' || row[name] === 1 || row[name] === true;

/**
 * Typ a závažnosť z príznakov VIINA (poradie = čo je na udalosti podstatné).
 * Nevojenské správy (sankcie, zatýkanie, kyber bez t_mil) = null → vynechať.
 * @returns {{type: string, sub: string|null, severity: string}|null}
 */
export function viinaClassify(row) {
  const f = (n) => flag(row, `${n}_b`) || flag(row, n);
  let type = null; let sub = null;
  if (f('t_airstrike')) { type = 'strike'; sub = 'air'; }
  else if (f('t_uav')) { type = 'strike'; sub = 'drone'; }
  else if (f('t_artillery')) type = 'artillery';
  else if (f('t_hospital')) { type = 'infrastructure'; sub = 'hospital'; }
  else if (f('t_aad')) type = 'air-defence';
  else if (f('t_control')) { type = 'ground'; sub = 'control'; }
  else if (f('t_occupy')) { type = 'ground'; sub = 'occupy'; }
  else if (f('t_retreat')) { type = 'ground'; sub = 'retreat'; }
  else if (f('t_armor') || f('t_firefight') || f('t_raid')) type = 'ground';
  else if (f('t_property')) type = 'infrastructure';
  else if (f('t_ied')) type = 'fire';
  else if (f('t_civcas')) type = 'civil';
  else if (f('t_airalert')) type = 'alert';
  else if (f('t_mil')) type = 'other';
  else return null;
  let severity = 'minor';
  if (type === 'strike' || sub === 'hospital' || f('t_civcas')) severity = 'critical';
  else if (['artillery', 'ground', 'infrastructure', 'fire', 'civil'].includes(type)) severity = 'major';
  if (f('t_milcas') && severity === 'minor') severity = 'major';
  return { type, sub, severity };
}

const PRECISION = Object.freeze({ STREET: 'street', ADM3: 'settlement', ADM2: 'district', ADM1: 'region' });

/**
 * Riadok VIINA 1pd → udalosť alebo null. Čas = polnoc UTC dňa (VIINA nemá
 * hodinu); `approx` pri presnosti okres/oblasť.
 */
export function viinaRowToEvent(row) {
  const cls = viinaClassify(row);
  if (!cls) return null;
  const t = dayToMs(row.date);
  const lat = Number(row.latitude); const lon = Number(row.longitude);
  if (t === null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const precision = PRECISION[String(row.GEO_PRECISION || '').toUpperCase()] || 'unknown';
  const actor = flag(row, 'a_rus_init_b') ? 'ru' : (flag(row, 'a_ukr_init_b') ? 'ua' : null);
  const reports = Number.parseInt(row.n_reports, 10);
  return {
    id: `viina:${row.event_id_1pd || `${row.date}:${row.geonameid}:${cls.type}`}`,
    t,
    dayOnly: true,
    lat: Math.round(lat * 1e5) / 1e5,
    lon: Math.round(lon * 1e5) / 1e5,
    place: String(row.asciiname || '').trim() || null,
    region: String(row.ADM1_NAME || '').trim() || null,
    precision,
    approx: precision === 'district' || precision === 'region',
    type: cls.type,
    sub: cls.sub,
    severity: cls.severity,
    level: 'reported',
    src: 'viina',
    actor,
    civcas: flag(row, 't_civcas_b'),
    milcas: flag(row, 't_milcas_b'),
    reports: Number.isFinite(reports) && reports > 0 ? reports : 1,
    outlets: String(row.sources || '').split(',').map((s) => s.trim()).filter(Boolean),
    sources: [],
    image: null,
    status: null,
  };
}

/** Celý CSV VIINA 1pd → udalosti (bez nevojenských riadkov). Pure. */
export function parseViinaCsv(text) {
  return parseCsv(text, ',').map(viinaRowToEvent).filter(Boolean);
}

// ── GeoConfirmed ──────────────────────────────────────────────────────────
/** Frakcie, ktoré sa berú (udalosti dopadu a ruských úderov), nie polohy UA. */
export const GEOCONFIRMED_FACTIONS_KEPT = Object.freeze(['Russia', 'Neutral', 'Russia Civilian', 'Ukraine Civilian', 'Unknown']);
const GC_POSITION_RE = /\b(position|positions|deployment|deployed|trench|trenches|dugout|bivouac|convoy|column|firing point|staging|hq|headquarters|base of|command post)\b/i;

/** Typ podľa popisu GeoConfirmed (kľúčové slová EN). Pure. */
export function geoconfirmedType(description, origin = '') {
  const s = `${description || ''} ${origin || ''}`;
  if (/\b(missile|iskander|kalibr|kh-\d+|kinzhal|glide bomb|kab|fab-|air ?strike|airstrike|bomb(?:ed|ing))\b/i.test(s)) return { type: 'strike', sub: 'air', severity: 'critical' };
  if (/\b(fpv|drone|uav|shahed|geran|lancet|kamikaze)\b/i.test(s)) return { type: 'strike', sub: 'drone', severity: 'critical' };
  if (/\b(artillery|shelling|shelled|mlrs|himars|grad|mortar|howitzer)\b/i.test(s)) return { type: 'artillery', sub: null, severity: 'major' };
  if (/\b(air defen[cs]e|shot down|intercept(?:ed)?|sam site|pantsir|s-300|s-400|buk)\b/i.test(s)) return { type: 'air-defence', sub: null, severity: 'minor' };
  if (/\b(warship|frigate|landing ship|submarine|corvette|black sea fleet|naval|sea drone|tanker|cargo ship|port of)\b/i.test(s)) return { type: 'naval', sub: null, severity: 'major' };
  if (/\b(tank|armou?r|infantry|assault|storm|advance|captur|liberat|infiltrat)\w*/i.test(s)) return { type: 'ground', sub: null, severity: 'major' };
  if (/\b(refinery|depot|substation|power|bridge|railway|station|plant|factory|warehouse|damaged|destroyed|fire|explosion|burning)\b/i.test(s)) return { type: 'infrastructure', sub: null, severity: 'major' };
  return { type: 'other', sub: null, severity: 'minor' };
}

/** „GH4P+X43 Enerhodar, Zaporizhia Oblast, Ukraine" → „Enerhodar". Pure. */
export function placeFromPlusCode(plusCode) {
  const s = String(plusCode || '').trim();
  const rest = s.replace(/^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}\s*/i, '');
  const first = rest.split(',')[0].trim();
  return first || null;
}

/**
 * Riadok exportu GeoConfirmed (CSV so `;`) → udalosť alebo null (etický filter).
 * Odkazy sa čistia z medzier; médiá zo sociálnych sietí = len odkaz.
 */
export function geoconfirmedRowToEvent(row) {
  const t = dayToMs(String(row.Date || '').slice(0, 10));
  if (t === null) return null;
  const faction = String(row.Faction || '').trim();
  if (!GEOCONFIRMED_FACTIONS_KEPT.includes(faction)) return null;
  if (String(row.Units || '').trim() || String(row.OrbatUnits || '').trim()) return null;
  const description = String(row.Description || '').replace(/\s+/g, ' ').trim();
  if (GC_POSITION_RE.test(description)) return null;
  const lat = Number(row.Latitude); const lon = Number(row.Longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const cls = geoconfirmedType(description, row.Origin);
  const links = String(row.Source || '').split(/[,\s]+/).map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u));
  return {
    id: `gc:${row.Id || `${row.Date}:${lat}:${lon}`}`,
    t,
    dayOnly: true,
    lat: Math.round(lat * 1e5) / 1e5,
    lon: Math.round(lon * 1e5) / 1e5,
    place: placeFromPlusCode(row.PlusCode),
    region: null,
    precision: 'street',
    approx: false,
    type: cls.type,
    sub: cls.sub,
    severity: cls.severity,
    level: 'osint',
    src: 'geoconfirmed',
    actor: faction === 'Russia' ? 'ru' : null,
    civcas: /civilian/i.test(faction) || /\bcivilian/i.test(description),
    milcas: false,
    reports: 1,
    outlets: [],
    sources: links.slice(0, 3).map((url) => ({ name: 'GeoConfirmed', url })),
    image: null,
    status: description.replace(/^\d{1,2}:\d{2}(?:-\d{1,2}:\d{2})?\s*-\s*/, '').slice(0, 160) || null,
  };
}

/** Celý CSV exportu GeoConfirmed → udalosti. Pure. */
export function parseGeoconfirmedCsv(text) {
  return parseCsv(text, ';').map(geoconfirmedRowToEvent).filter(Boolean);
}

// ── Správy ────────────────────────────────────────────────────────────────
const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const num = (s) => { const t = String(s).toLowerCase(); return /^\d+$/.test(t) ? Number(t) : (NUM_WORDS[t] ?? null); };

/** Počty obetí z anglického titulku (len čísla, nikdy mená). Pure. */
export function casualtiesFromHeadline(title) {
  const s = String(title || '');
  const k = s.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:people\s+|civilians\s+|persons\s+)?(?:killed|dead|died)\b/i) || s.match(/\bkill(?:s|ed|ing)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  const i = s.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:people\s+|civilians\s+|persons\s+)?(?:injured|wounded|hurt)\b/i) || s.match(/\binjur(?:es|ed|ing)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  return { killed: k ? num(k[1]) : null, injured: i ? num(i[1]) : null };
}

const TYPE_FROM_INCIDENT = Object.freeze({ strike: 'strike', fire: 'fire', ground: 'ground', 'air-defence': 'air-defence', infrastructure: 'infrastructure', naval: 'naval', seizure: 'ground', blockade: 'naval' });

/**
 * Položka správ (situationNews) → hlásená udalosť, alebo null bez triedy či
 * miesta (bez miesta niet kotvy — región ukraine nemá predvolený bod).
 */
export function newsItemToEvent(item, { gazetteer = UKRAINE_GAZETTEER } = {}) {
  const title = String(item?.title || '');
  const cls = classifyIncident(title, { region: 'ukraine' });
  if (!cls) return null;
  const loc = locateIncident(title, gazetteer);
  if (!loc) return null;
  const t = Number.isFinite(item?.publishedAt) ? item.publishedAt : null;
  if (t === null) return null;
  const c = casualtiesFromHeadline(title);
  return {
    id: `news:${item.url}`,
    t,
    dayOnly: false,
    lat: loc.lat,
    lon: loc.lon,
    place: loc.name,
    region: null,
    precision: 'settlement',
    approx: true,
    type: TYPE_FROM_INCIDENT[cls.type] || 'other',
    sub: /\b(drone|shahed|fpv|uav)\b/i.test(title) ? 'drone' : null,
    severity: c.killed ? 'critical' : cls.severity,
    level: item.badge === 'official-ua' ? 'official' : 'reported',
    src: 'news',
    actor: /\brussian\b/i.test(title) ? 'ru' : (/\bukrainian\b/i.test(title) ? 'ua' : null),
    civcas: Boolean(c.killed || c.injured),
    milcas: false,
    reports: 1,
    outlets: [],
    killed: c.killed,
    injured: c.injured,
    sources: [{ name: String(item.source || ''), url: String(item.url || '') }],
    image: item.image && !item.noImage ? item.image : null,
    noImage: Boolean(item.noImage),
    status: cleanHeadline(title).slice(0, 160),
  };
}

const kmBetween = (a, b) => {
  const R = 6371; const dLat = ((b.lat - a.lat) * Math.PI) / 180; const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const sameFamily = (a, b) => a === b || (['strike', 'artillery', 'fire', 'infrastructure', 'civil'].includes(a) && ['strike', 'artillery', 'fire', 'infrastructure', 'civil'].includes(b));

/**
 * Pripoj správy k udalostiam toho istého dňa a miesta (≤ 15 km, príbuzný typ):
 * udalosť dostane titulok ako stav, zdroj, obrázok a hodinu; nepripojené správy
 * ostanú samostatné. Vracia nové pole (vstupy sa nemenia). Pure.
 * @param {Array} events VIINA + GeoConfirmed
 * @param {Array} newsEvents z newsItemToEvent
 */
export function attachNews(events, newsEvents, { maxKm = 15 } = {}) {
  const out = events.map((e) => ({ ...e, sources: [...(e.sources || [])] }));
  const loose = [];
  for (const n of newsEvents || []) {
    const day = dayKey(n.t);
    let best = null; let bestKm = Infinity;
    for (const e of out) {
      if (dayKey(e.t) !== day || !sameFamily(e.type, n.type)) continue;
      const km = kmBetween(e, n);
      if (km <= maxKm && km < bestKm) { best = e; bestKm = km; }
    }
    if (!best) { loose.push(n); continue; }
    if (!best.status) best.status = n.status;
    if (!best.image && n.image) best.image = n.image;
    if (n.killed && !best.killed) best.killed = n.killed;
    if (n.injured && !best.injured) best.injured = n.injured;
    if (SEVERITY_RANK[n.severity] > SEVERITY_RANK[best.severity]) best.severity = n.severity;
    if (best.dayOnly && Number.isFinite(n.t)) { best.t = n.t; best.dayOnly = false; }
    if (n.level === 'official' && best.level === 'reported') best.level = 'official';
    for (const s of n.sources) if (!best.sources.some((x) => x.url === s.url)) best.sources.push(s);
    best.reports = (best.reports || 1) + 1;
  }
  return [...out, ...loose];
}

/**
 * Pripoj médiá (videá/fotopríspevky, src 'media') k udalostiam toho istého dňa
 * a miesta (≤ maxKm, ľubovoľný typ): udalosť dostane `media[]` (najviac 6),
 * obrázok, ak nemá, a zdroj; médiá bez miesta alebo bez páru ostanú samostatné
 * (v časovej osi sú vždy). Vracia nové pole. Pure.
 */
export function attachMedia(events, mediaEvents, { maxKm = 15, maxPerEvent = 6 } = {}) {
  const out = events.map((e) => ({ ...e, sources: [...(e.sources || [])], media: [...(e.media || [])] }));
  const loose = [];
  for (const m of mediaEvents || []) {
    if (!Number.isFinite(m?.lat) || !Number.isFinite(m?.lon)) { loose.push(m); continue; }
    const day = dayKey(m.t);
    let best = null; let bestKm = Infinity;
    for (const e of out) {
      if (e.src === 'media' || dayKey(e.t) !== day || !Number.isFinite(e.lat)) continue;
      if (m.type !== 'other' && e.type !== 'other' && !sameFamily(e.type, m.type)) continue;
      const km = kmBetween(e, m);
      if (km <= maxKm && km < bestKm) { best = e; bestKm = km; }
    }
    if (!best || best.media.length >= maxPerEvent) { loose.push(m); continue; }
    best.media.push(...(m.media || []));
    if (!best.image && m.image) best.image = m.image;
    if (!best.status && m.status) best.status = m.status;
    if (m.killed && !best.killed) best.killed = m.killed;
    if (m.injured && !best.injured) best.injured = m.injured;
    if (m.level === 'official' && best.level === 'reported') best.level = 'official';
    for (const s of m.sources || []) if (!best.sources.some((x) => x.url === s.url)) best.sources.push(s);
    best.reports = (best.reports || 1) + 1;
  }
  return [...out, ...loose];
}

// ── Okno, zhluky, výber kariet ────────────────────────────────────────────
/** Udalosti v okne [startMs, endMs] (vrátane), zoradené od najnovšej. Pure. */
export function eventsInWindow(events, startMs, endMs) {
  return (events || []).filter((e) => Number.isFinite(e?.t) && e.t >= startMs && e.t <= endMs).sort((a, b) => b.t - a.t);
}

/**
 * Zhluky pre pohľad zďaleka: bunky `cellDeg`, každá so stredom (ťažisko),
 * počtom, najvyššou závažnosťou a rozdelením typov. Pure.
 */
export function clusterEvents(events, cellDeg = 0.25) {
  const cells = new Map();
  for (const e of events || []) {
    if (!Number.isFinite(e?.lat) || !Number.isFinite(e?.lon)) continue;
    const key = `${Math.floor(e.lat / cellDeg)}:${Math.floor(e.lon / cellDeg)}`;
    let c = cells.get(key);
    if (!c) { c = { key, count: 0, lat: 0, lon: 0, severity: 'minor', types: {}, ids: [] }; cells.set(key, c); }
    c.count += 1; c.lat += e.lat; c.lon += e.lon; c.ids.push(e.id);
    c.types[e.type] = (c.types[e.type] || 0) + 1;
    if (SEVERITY_RANK[e.severity] > SEVERITY_RANK[c.severity]) c.severity = e.severity;
  }
  return [...cells.values()].map((c) => ({ ...c, lat: c.lat / c.count, lon: c.lon / c.count }));
}

/**
 * Ktoré udalosti dostanú plnú kartu: najprv závažnosť, potom čerstvosť, potom
 * počet správ; jedna karta na (miesto, rodina typu); približné (okres/oblasť)
 * karty nedostanú. Pure.
 */
export function pickCards(events, { max = 8 } = {}) {
  const sorted = [...(events || [])].filter((e) => Number.isFinite(e?.lat) && Number.isFinite(e?.lon) && (!e.approx || e.src === 'news' || e.src === 'media')).sort((a, b) => (SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]) || (b.t - a.t) || ((b.reports || 0) - (a.reports || 0)));
  const taken = new Set();
  const out = [];
  for (const e of sorted) {
    const family = ['strike', 'artillery', 'fire', 'infrastructure', 'civil'].includes(e.type) ? 'impact' : e.type;
    const key = `${(e.place || `${e.lat.toFixed(2)},${e.lon.toFixed(2)}`).toLowerCase()}|${family}`;
    if (taken.has(key)) continue;
    taken.add(key);
    out.push(e);
    if (out.length >= max) break;
  }
  return out;
}

/** Súhrn okna: počty podľa typu a závažnosti, hlásené obete (súčet). Pure. */
export function summarizeEvents(events) {
  const byType = {}; const bySeverity = { critical: 0, major: 0, minor: 0 };
  let killed = 0; let injured = 0; let osint = 0;
  for (const e of events || []) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1;
    if (Number.isFinite(e.killed)) killed += e.killed;
    if (Number.isFinite(e.injured)) injured += e.injured;
    if (e.level === 'osint') osint += 1;
  }
  return { total: (events || []).length, byType, bySeverity, killed, injured, osint };
}

// ── Karta ─────────────────────────────────────────────────────────────────
/** Krátky text typu udalosti (i18n `ukraine.ev.<type>[.<sub>]`). */
export function eventTypeLabel(ev, translate = (k) => k) {
  const key = ev.sub ? `ukraine.ev.${ev.type}.${ev.sub}` : `ukraine.ev.${ev.type}`;
  const out = translate(key);
  return out === key ? translate(`ukraine.ev.${ev.type}`) : out;
}

/**
 * Stavový riadok karty: titulok zo správ, inak zložený z typu/aktéra/obetí —
 * počty vždy len ako „hlásené", nikdy mená. Pure.
 */
export function eventStatusText(ev, translate = (k) => k) {
  const parts = [];
  if (ev.status) parts.push(ev.status);
  else {
    if (ev.actor === 'ru') parts.push(translate('ukraine.ev.actor-ru'));
    else if (ev.actor === 'ua') parts.push(translate('ukraine.ev.actor-ua'));
    if (ev.civcas) parts.push(translate('ukraine.ev.civcas'));
    else if (ev.milcas) parts.push(translate('ukraine.ev.milcas'));
  }
  const cas = [];
  if (Number.isFinite(ev.killed) && ev.killed > 0) cas.push(translate('ukraine.ev.killed', { n: ev.killed }));
  if (Number.isFinite(ev.injured) && ev.injured > 0) cas.push(translate('ukraine.ev.injured', { n: ev.injured }));
  if (cas.length) parts.push(cas.join(' · '));
  if (ev.reports > 1) parts.push(translate('ukraine.ev.reports', { n: ev.reports }));
  return parts.filter(Boolean).join(' · ');
}

/** Čas na karte: len dátum pre denné udalosti, inak dátum + hodina UTC. Pure. */
export function eventTimeText(ev, lang = 'sk') {
  const d = new Date(ev.t);
  if (Number.isNaN(d.getTime())) return '';
  const date = `${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
  if (ev.dayOnly) return date;
  const hh = String(d.getUTCHours()).padStart(2, '0'); const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return lang === 'sk' ? `${date} ${hh}:${mm} UTC` : `${date} ${hh}:${mm} UTC`;
}

/** Model karty (čisté dáta pre renderer). */
export function eventCardModel(ev, { translate = (k) => k, lang = 'sk' } = {}) {
  return {
    id: ev.id,
    severity: ev.severity,
    type: ev.type,
    typeText: eventTypeLabel(ev, translate),
    timeText: eventTimeText(ev, lang),
    title: ev.place || translate('ukraine.ev.unknown-place'),
    status: eventStatusText(ev, translate),
    levelText: translate(`ukraine.level.${ev.level}`),
    sourceText: ev.src === 'viina' ? translate('ukraine.src.viina') : (ev.src === 'geoconfirmed' ? translate('ukraine.src.geoconfirmed') : (ev.sources?.[0]?.name || '')),
    url: ev.sources?.[0]?.url || null,
    image: ev.image || null,
    approx: Boolean(ev.approx),
    lat: Number.isFinite(ev.lat) ? ev.lat : null,
    lon: Number.isFinite(ev.lon) ? ev.lon : null,
    media: Array.isArray(ev.media) ? ev.media : [],
    kind: ev.kind || null,
    killed: Number.isFinite(ev.killed) ? ev.killed : null,
    injured: Number.isFinite(ev.injured) ? ev.injured : null,
    level: ev.level,
    src: ev.src,
  };
}

/**
 * Klient: udalosti z proxy pre okno dní. Chyba proxy = výnimka so statusom.
 * @param {string} from YYYY-MM-DD
 * @param {string} to YYYY-MM-DD
 */
export async function fetchUkraineEvents(from, to, { fetcher = (...a) => fetch(...a), base = UKRAINE_EVENTS_API } = {}) {
  const url = `${base}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const response = await fetcher(url, { cache: 'no-store' });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(json?.error ? String(json.error) : `HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return json;
}
