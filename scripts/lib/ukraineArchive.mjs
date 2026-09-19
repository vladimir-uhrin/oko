// scripts/lib/ukraineArchive.mjs — archív udalostí a médií modulu UKRAJINA
// (etapa 3a, 2026-09-19; pokyn používateľa „všetko ukladať, aby to bolo v časovej
// osi"). Všetko leží na disku pod .gev-cache/ukraine/events/ (junction na D:):
//   viina/<rok>.json           VIINA 2.0 (ODbL) — celý rok po parse, vlastný súbor
//   geoconfirmed/<deň>.json    GeoConfirmed export okna po dňoch (posledných 90 dní)
//   news/<deň>.json            položky správ z /api/situation-news?region=ukraine
//   media/<deň>.json           videá a fotopríspevky (YouTube feedy, Telegram, ArmyInform)
//   reports/<deň>.json         hlásenie Generálneho štábu (ArmyInform, CC BY 4.0)
// Zdieľa ju dev proxy (vite.config.js: ukraineEventsProxy) aj CLI
// scripts/build-ukraine-events.mjs. Sieť ide cez vstreknuté `fetchImpl` — testy
// bežia bez internetu. Žiadne médiá (bajty obrázkov/videí) sa NEUKLADAJÚ, len
// odkazy a náhľadové URL — licencie zdrojov dovoľujú náhľad s odkazom, nie kópiu.
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { readZipEntries } from '../../src/data/zipEntries.js';
import { VIINA_MEDIA_BASE, dayKey, dayToMs, parseCsv, parseGeoconfirmedCsv, parseViinaCsv } from '../../src/data/ukraineEvents.js';
import {
  ARMYINFORM_UA_FEED, TELEGRAM_CHANNELS, YOUTUBE_CHANNELS,
  parseRssVideoEnclosures, parseTelegramPreview, parseYoutubeFeed, telegramPreviewUrl, youtubeFeedUrl,
} from '../../src/data/ukraineMedia.js';
import { ARMYINFORM_OPS_FEED, extractReportParagraphs, parseGeneralStaffReport } from '../../src/data/ukraineReport.js';
import { WIKI_DETAILED_TITLE, WIKI_OVERVIEW_TITLE, controlPointsFromModules, controlSummary } from '../../src/data/ukraineControl.js';
import { DEEPSTATE_ATTRIBUTION, DEEPSTATE_LAST_URL, deepstateSnapshotFromApi } from '../../src/data/ukraineDeepState.js';

export const VIINA_FIRST_YEAR = 2022;
export const GEOCONFIRMED_EXPORT = 'https://geoconfirmed.org/api/Map/export/Ukraine/csv';
/** GeoConfirmed: rolujúce okno — hromadný export histórie API výslovne nechce („get in touch"). */
export const GEOCONFIRMED_ROLLING_DAYS = 90;
/** Dni staršie než toto sa už nesťahujú znova (geolokácie sa dopĺňajú spätne len krátko). */
export const GEOCONFIRMED_FINAL_AFTER_DAYS = 14;
export const USER_AGENT = 'OKO-ukraine/0.1 (https://github.com/vladouh76; vladouh76@gmail.com)';
const DAY_MS = 86_400_000;

export const archiveDir = (root = process.cwd()) => path.join(root, '.gev-cache', 'ukraine', 'events');
export const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && dayToMs(s) !== null && dayKey(dayToMs(s)) === s;
/** Dni od–do vrátane (validované), alebo [] pri zlom vstupe. Pure. */
export function dayList(from, to) {
  if (!isDay(from) || !isDay(to)) return [];
  const a = dayToMs(from); const b = dayToMs(to);
  if (b < a) return [];
  const out = [];
  for (let t = a; t <= b; t += DAY_MS) out.push(dayKey(t));
  return out;
}
export const dayShift = (day, days) => dayKey(dayToMs(day) + days * DAY_MS);

// ── disk ──────────────────────────────────────────────────────────────────
export async function readJson(file) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return null; }
}
/** Zápis cez dočasný súbor + rename (junction na D:: krok .tmp je nutný, EBUSY lekcia). */
export async function writeJsonAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value), 'utf8');
  await fsp.rename(tmp, file);
}
const dayFile = (root, kind, day) => path.join(archiveDir(root), kind, `${day}.json`);

/**
 * Zlúčenie položiek podľa kľúča: nové sa pridajú, existujúce si doplnia prázdne
 * polia (obrázok dohľadaný neskôr) a zachovajú `archivedAt` prvého videnia. Pure.
 */
export function mergeItems(existing, incoming, { key = (x) => x.id, now = Date.now() } = {}) {
  const byKey = new Map();
  for (const it of existing || []) { const k = key(it); if (k) byKey.set(k, { ...it }); }
  let added = 0; let updated = 0;
  for (const it of incoming || []) {
    const k = key(it);
    if (!k) continue;
    const prev = byKey.get(k);
    if (!prev) { byKey.set(k, { ...it, archivedAt: now }); added += 1; continue; }
    let changed = false;
    for (const [f, v] of Object.entries(it)) {
      if (f === 'archivedAt') continue;
      if ((prev[f] === null || prev[f] === undefined || prev[f] === '') && v !== null && v !== undefined && v !== '') { prev[f] = v; changed = true; }
    }
    if (changed) updated += 1;
  }
  return { items: [...byKey.values()], added, updated };
}

/** Položky s časom `timeKey` (ms) → súbory po dňoch (zlúčené). */
export async function archiveDayItems(root, kind, items, { timeKey = 'publishedAt', key = (x) => x.id || x.url, now = Date.now() } = {}) {
  const byDay = new Map();
  for (const it of items || []) {
    const t = it?.[timeKey];
    if (!Number.isFinite(t)) continue;
    const d = dayKey(t);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(it);
  }
  let added = 0; let updated = 0;
  for (const [day, list] of byDay) {
    const file = dayFile(root, kind, day);
    const prev = (await readJson(file))?.items || [];
    const merged = mergeItems(prev, list, { key, now });
    if (merged.added || merged.updated) await writeJsonAtomic(file, { day, kind, updatedAt: now, items: merged.items });
    added += merged.added; updated += merged.updated;
  }
  return { days: byDay.size, added, updated };
}
export async function readDayItems(root, kind, day) {
  return (await readJson(dayFile(root, kind, day)))?.items || [];
}
export async function readRangeItems(root, kind, from, to) {
  const out = [];
  for (const day of dayList(from, to)) out.push(...await readDayItems(root, kind, day));
  return out;
}
/** Ktoré dni v rozsahu majú súbor (pokrytie pre UI). */
export async function coverageDays(root, kind, from, to) {
  const out = [];
  for (const day of dayList(from, to)) {
    try { await fsp.access(dayFile(root, kind, day)); out.push(day); } catch { /* chýba */ }
  }
  return out;
}

// ── sieť (spoločné) ───────────────────────────────────────────────────────
async function fetchCapped(fetchImpl, url, { timeoutMs = 30_000, maxBytes = 8 * 1024 * 1024, headers = {}, binary = false } = {}) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': USER_AGENT, ...headers } });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error(`too large (${buf.length} B) ${new URL(url).host}`);
  return { res, body: binary ? buf : buf.toString('utf8'), buf };
}

// ── VIINA ─────────────────────────────────────────────────────────────────
export const viinaFile = (root, year) => path.join(archiveDir(root), 'viina', `${year}.json`);
export const viinaUrl = (year) => `${VIINA_MEDIA_BASE}event_1pd_latest_${year}.zip`;
/** Zip (LFS media) alebo holý CSV → udalosti. */
export function viinaEventsFromBody(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length >= 2 && b[0] === 0x50 && b[1] === 0x4b) {
    const entry = readZipEntries(b).find((e) => /\.csv$/i.test(e.name)) || readZipEntries(b)[0];
    if (!entry) throw new Error('viina zip without entries');
    return parseViinaCsv(entry.read().toString('utf8'));
  }
  return parseViinaCsv(b.toString('utf8'));
}
/**
 * Ročný súbor VIINA čerstvý: aktuálny rok každých 24 h, minulé roky raz za 30 d
 * (VIINA prepočítava klasifikáciu spätne). Pri zlyhaní ostáva starý súbor.
 */
export async function viinaYear(root, year, { fetchImpl = fetch, now = Date.now(), force = false, log = () => {} } = {}) {
  const file = viinaFile(root, year);
  const prev = await readJson(file);
  const currentYear = new Date(now).getUTCFullYear();
  const maxAge = year >= currentYear ? DAY_MS : 30 * DAY_MS;
  if (!force && prev && Number.isFinite(prev.fetchedAt) && now - prev.fetchedAt < maxAge) return { year, status: 'fresh', count: prev.count, fetchedAt: prev.fetchedAt };
  const headers = prev?.lastModified ? { 'If-Modified-Since': prev.lastModified } : {};
  const started = Date.now();
  try {
    const { res, buf } = await fetchCapped(fetchImpl, viinaUrl(year), { timeoutMs: 120_000, maxBytes: 80 * 1024 * 1024, headers, binary: true });
    if (res.status === 304 && prev) { await writeJsonAtomic(file, { ...prev, fetchedAt: now }); return { year, status: 'not-modified', count: prev.count, fetchedAt: now }; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const events = viinaEventsFromBody(buf);
    if (!events.length) throw new Error('no events parsed');
    const entry = { year, source: viinaUrl(year), fetchedAt: now, lastModified: res.headers?.get?.('last-modified') || null, bytes: buf.length, count: events.length, events };
    await writeJsonAtomic(file, entry);
    // Malý súhrn po dňoch vedľa ročného súboru (2022 má 135 810 udalostí = 45 MB;
    // prehľad osi „od 2022" nesmie čítať roky celé).
    await writeJsonAtomic(viinaSummaryFile(root, year), { year, fetchedAt: now, count: events.length, days: viinaDaySummary(events) });
    log(`[ukraine-events] VIINA ${year}: ${events.length} events (${buf.length} B) in ${Date.now() - started} ms`);
    return { year, status: 'updated', count: events.length, fetchedAt: now };
  } catch (error) {
    log(`[ukraine-events] VIINA ${year} failed: ${error?.message || error}${prev ? ' — keeping the previous file' : ''}`);
    return { year, status: prev ? 'stale' : 'missing', count: prev?.count || 0, fetchedAt: prev?.fetchedAt || null, error: String(error?.message || error) };
  }
}
export const viinaSummaryFile = (root, year) => path.join(archiveDir(root), 'viina', `${year}.summary.json`);
/** Počty po dňoch z udalostí jedného roka (typy, kritické, obete VIINA nemá). Pure. */
export function viinaDaySummary(events) {
  const days = {};
  for (const e of events || []) {
    const d = dayKey(e.t);
    const row = days[d] || (days[d] = { count: 0, critical: 0, civcas: 0, types: {} });
    row.count += 1;
    if (e.severity === 'critical') row.critical += 1;
    if (e.civcas) row.civcas += 1;
    row.types[e.type] = (row.types[e.type] || 0) + 1;
  }
  return days;
}
/** Súhrn roka zo súboru `.summary.json`; ak chýba (staršia stavba), dopočíta sa z ročného súboru a zapíše. */
export async function viinaSummary(root, year, { cache = null } = {}) {
  const hit = cache?.get(`summary:${year}`);
  if (hit) return hit;
  let summary = await readJson(viinaSummaryFile(root, year));
  if (!summary) {
    const entry = await readJson(viinaFile(root, year));
    if (!entry) return null;
    summary = { year, fetchedAt: entry.fetchedAt, count: entry.count, days: viinaDaySummary(entry.events) };
    await writeJsonAtomic(viinaSummaryFile(root, year), summary);
  }
  cache?.set(`summary:${year}`, summary);
  return summary;
}
/** Udalosti VIINA v rozsahu dní (roky z disku; chýbajúci rok = prázdno). */
export async function viinaEvents(root, from, to, { cache = null } = {}) {
  const days = dayList(from, to);
  if (!days.length) return [];
  const a = dayToMs(from); const b = dayToMs(to);
  const years = new Set(days.map((d) => Number(d.slice(0, 4))));
  const out = [];
  for (const year of years) {
    let entry = cache?.get(year) || null;
    if (!entry) { entry = await readJson(viinaFile(root, year)); if (entry && cache) cache.set(year, entry); }
    for (const e of entry?.events || []) if (e.t >= a && e.t <= b) out.push(e);
  }
  return out;
}
export async function viinaStatus(root, { now = Date.now() } = {}) {
  const out = {};
  for (let year = VIINA_FIRST_YEAR; year <= new Date(now).getUTCFullYear(); year += 1) {
    const entry = await readJson(viinaFile(root, year));
    out[year] = entry ? { count: entry.count, fetchedAt: entry.fetchedAt } : null;
  }
  return out;
}

// ── GeoConfirmed ──────────────────────────────────────────────────────────
export const geoconfirmedUrl = (from, to) => `${GEOCONFIRMED_EXPORT}?start=${from}&end=${to}`;
/**
 * Okno dní: stiahne export raz a zapíše KAŽDÝ deň okna (aj prázdny), aby bolo
 * pokrytie známe. Dni staršie než FINAL sa neobnovujú; mladšie po `maxAgeMs`.
 */
export async function geoconfirmedRefresh(root, from, to, { fetchImpl = fetch, now = Date.now(), maxAgeMs = 6 * 3_600_000, force = false, log = () => {} } = {}) {
  const days = dayList(from, to);
  if (!days.length) return { status: 'bad-range' };
  if (!force) {
    let stale = false;
    for (const day of days) {
      const prev = await readJson(dayFile(root, 'geoconfirmed', day));
      if (!prev) { stale = true; break; }
      const final = now - dayToMs(day) > GEOCONFIRMED_FINAL_AFTER_DAYS * DAY_MS;
      if (!final && now - (prev.fetchedAt || 0) > maxAgeMs) { stale = true; break; }
    }
    if (!stale) return { status: 'fresh', days: days.length };
  }
  const started = Date.now();
  try {
    const { res, body } = await fetchCapped(fetchImpl, geoconfirmedUrl(from, to), { timeoutMs: 60_000, maxBytes: 40 * 1024 * 1024, headers: { Accept: 'text/csv' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const events = parseGeoconfirmedCsv(body);
    const byDay = new Map(days.map((d) => [d, []]));
    for (const e of events) { const d = dayKey(e.t); if (byDay.has(d)) byDay.get(d).push(e); }
    for (const [day, list] of byDay) await writeJsonAtomic(dayFile(root, 'geoconfirmed', day), { day, kind: 'geoconfirmed', fetchedAt: now, window: [from, to], items: list });
    log(`[ukraine-events] GeoConfirmed ${from}..${to}: ${events.length} events (${body.length} B) in ${Date.now() - started} ms`);
    return { status: 'updated', days: days.length, count: events.length };
  } catch (error) {
    log(`[ukraine-events] GeoConfirmed ${from}..${to} failed: ${error?.message || error}`);
    return { status: 'error', error: String(error?.message || error) };
  }
}
export const geoconfirmedEvents = (root, from, to) => readRangeItems(root, 'geoconfirmed', from, to);

// ── médiá ─────────────────────────────────────────────────────────────────
/** Všetky mediálne prítoky naraz; každý zlyháva samostatne. */
export async function collectMedia({ fetchImpl = fetch, log = () => {}, youtube = YOUTUBE_CHANNELS, telegram = TELEGRAM_CHANNELS, armyinform = ARMYINFORM_UA_FEED } = {}) {
  const items = []; const failures = [];
  const grab = async (label, url, parse, opts = {}) => {
    try {
      const { res, body } = await fetchCapped(fetchImpl, url, { timeoutMs: 20_000, maxBytes: 6 * 1024 * 1024, headers: opts.headers || {} });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = parse(body);
      items.push(...parsed);
      return parsed.length;
    } catch (error) { failures.push({ label, error: String(error?.message || error) }); return 0; }
  };
  for (const ch of youtube) await grab(`youtube:${ch.label}`, youtubeFeedUrl(ch.id), (xml) => parseYoutubeFeed(xml, ch));
  for (const ch of telegram) await grab(`telegram:${ch.name}`, telegramPreviewUrl(ch.name), (html) => parseTelegramPreview(html, ch), { headers: { Accept: 'text/html' } });
  if (armyinform) await grab('armyinform', armyinform, (xml) => parseRssVideoEnclosures(xml));
  if (failures.length) log(`[ukraine-events] media: ${failures.length} feed(s) failed — ${failures.map((f) => `${f.label} (${f.error})`).join('; ')}`);
  return { items, failures };
}

// ── hlásenia GŠ ───────────────────────────────────────────────────────────
export const reportDay = (report) => { const t = Date.parse(report?.reportedAt || ''); return Number.isFinite(t) ? dayKey(t) : null; };
/** Minimálny RSS 2.0 čítač položiek (titulok, odkaz, dátum ISO) pre CLI bez vite.config.js. Pure. */
export function simpleRssItems(xml, limit = 20) {
  const out = [];
  for (const m of String(xml || '').matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const it = m[1];
    const tag = (n) => { const r = new RegExp(`<${n}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${n}>`, 'i').exec(it); return r ? r[1].trim() : ''; };
    const title = tag('title'); const url = tag('link'); const t = Date.parse(tag('pubDate') || tag('dc:date'));
    if (!title || !/^https?:\/\//.test(url)) continue;
    out.push({ title, url, publishedAt: Number.isFinite(t) ? new Date(t).toISOString() : null });
    if (out.length >= limit) break;
  }
  return out;
}
/** Uloží hlásenie pod jeho deň (novšie `fetchedAt` vyhráva). */
export async function archiveReport(root, report, { now = Date.now() } = {}) {
  const day = reportDay(report);
  if (!day) return { status: 'no-day' };
  const file = dayFile(root, 'reports', day);
  const prev = await readJson(file);
  if (prev && (prev.fetchedAt || 0) >= (report.fetchedAt || now)) return { status: 'kept', day };
  await writeJsonAtomic(file, { ...report, day, fetchedAt: report.fetchedAt || now });
  return { status: 'stored', day };
}
export async function readReports(root, from, to) {
  const out = {};
  for (const day of dayList(from, to)) { const r = await readJson(dayFile(root, 'reports', day)); if (r) out[day] = r; }
  return out;
}
/**
 * Spätné naplnenie hlásení z tagového feedu ArmyInform (`?paged=N`, WordPress):
 * články sa parsujú rovnakým čistým parserom ako živé hlásenie. Zdvorilá pauza
 * medzi článkami; už archivované dni sa preskočia.
 * @param {(xml:string, limit:number)=>Array<{title:string,url:string,publishedAt:string}>} normalizeRss zdieľaný RSS parser (vite.config.js)
 */
export async function backfillReports(root, { fetchImpl = fetch, normalizeRss = simpleRssItems, pages = 6, pauseMs = 1500, now = Date.now(), log = () => {} } = {}) {
  let stored = 0; let seen = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let page = 1; page <= pages; page += 1) {
    const url = page === 1 ? ARMYINFORM_OPS_FEED : `${ARMYINFORM_OPS_FEED}?paged=${page}`;
    let items = [];
    try {
      const { res, body } = await fetchCapped(fetchImpl, url, { timeoutMs: 20_000, maxBytes: 4 * 1024 * 1024 });
      if (!res.ok) break;
      items = normalizeRss(body, 20);
    } catch (error) { log(`[ukraine-events] reports page ${page} failed: ${error?.message || error}`); break; }
    if (!items.length) break;
    for (const item of items) {
      seen += 1;
      const day = Number.isFinite(Date.parse(item.publishedAt)) ? dayKey(Date.parse(item.publishedAt)) : null;
      if (day && await readJson(dayFile(root, 'reports', day))) continue;
      try {
        await sleep(pauseMs);
        const { res, body } = await fetchCapped(fetchImpl, item.url, { timeoutMs: 20_000, maxBytes: 3 * 1024 * 1024 });
        if (!res.ok) continue;
        const parsed = parseGeneralStaffReport(extractReportParagraphs(body), { publishedAt: item.publishedAt, url: item.url, title: item.title });
        if (!parsed.ok || parsed.directions.length < 5) continue;
        // Bez „станом на HH:MM" v texte nesie deň dátum položky feedu.
        const reportedAt = parsed.reportedAt || (Number.isFinite(Date.parse(item.publishedAt)) ? new Date(Date.parse(item.publishedAt)).toISOString() : null);
        const r = await archiveReport(root, { ...parsed, reportedAt, feed: ARMYINFORM_OPS_FEED, fetchedAt: now }, { now });
        if (r.status === 'stored') stored += 1;
      } catch (error) { log(`[ukraine-events] report ${item.url} failed: ${error?.message || error}`); }
    }
  }
  return { seen, stored };
}

// ── súhrn po dňoch (prehľad časovej osi „od 2022") ────────────────────────
/**
 * Počty po dňoch bez samotných udalostí: VIINA (z ročných súborov), GeoConfirmed,
 * správy, médiá, hlásenia; k tomu kritické udalosti a hlásené obete. Lacné pre
 * roky (číta len ročné súbory a existujúce denné súbory).
 */
export async function summaryPayload(root, from, to, { now = Date.now(), viinaCache = null } = {}) {
  const days = dayList(from, to);
  const out = Object.fromEntries(days.map((d) => [d, { viina: 0, geoconfirmed: 0, news: 0, media: 0, fires: 0, report: null, critical: 0, killed: 0, injured: 0, types: {} }]));
  const fireIndex = await firesIndex(root);
  for (const day of days) if (fireIndex[day]) out[day].fires = fireIndex[day];
  const bump = (e) => {
    const d = dayKey(e.t); const row = out[d];
    if (!row) return;
    row.types[e.type] = (row.types[e.type] || 0) + 1;
    if (e.severity === 'critical') row.critical += 1;
    if (Number.isFinite(e.killed)) row.killed += e.killed;
    if (Number.isFinite(e.injured)) row.injured += e.injured;
  };
  for (const year of new Set(days.map((d) => Number(d.slice(0, 4))))) {
    const summary = await viinaSummary(root, year, { cache: viinaCache });
    for (const [day, row] of Object.entries(summary?.days || {})) {
      const o = out[day];
      if (!o) continue;
      o.viina += row.count; o.critical += row.critical;
      for (const [type, n] of Object.entries(row.types || {})) o.types[type] = (o.types[type] || 0) + n;
    }
  }
  for (const day of days) {
    const gc = await readJson(dayFile(root, 'geoconfirmed', day));
    if (gc) { out[day].geoconfirmed = gc.items.length; for (const e of gc.items) bump(e); }
    const news = await readJson(dayFile(root, 'news', day));
    if (news) out[day].news = news.items.length;
    const media = await readJson(dayFile(root, 'media', day));
    if (media) out[day].media = media.items.length;
    const rep = await readJson(dayFile(root, 'reports', day));
    if (rep) out[day].report = { total: rep.total ?? null, directions: Array.isArray(rep.directions) ? rep.directions.length : 0 };
  }
  return { from, to, days: out, generatedAt: now };
}

// ── odpoveď proxy ─────────────────────────────────────────────────────────
/** Zložený obsah okna pre klienta (udalosti, správy, médiá, hlásenia, pokrytie). */
export async function eventsPayload(root, from, to, { now = Date.now(), viinaCache = null } = {}) {
  const days = dayList(from, to);
  const [viina, geoconfirmed, news, media, reports, fires] = await Promise.all([
    viinaEvents(root, from, to, { cache: viinaCache }),
    geoconfirmedEvents(root, from, to),
    readRangeItems(root, 'news', from, to),
    readRangeItems(root, 'media', from, to),
    readReports(root, from, to),
    firesEvents(root, from, to),
  ]);
  const coverage = {
    viina: Object.fromEntries(await Promise.all([...new Set(days.map((d) => Number(d.slice(0, 4))))].map(async (y) => { const e = viinaCache?.get(y) || await readJson(viinaFile(root, y)); return [y, e ? { count: e.count, fetchedAt: e.fetchedAt } : null]; }))),
    geoconfirmed: await coverageDays(root, 'geoconfirmed', from, to),
    news: await coverageDays(root, 'news', from, to),
    media: await coverageDays(root, 'media', from, to),
    reports: Object.keys(reports),
    fires: await coverageDays(root, 'fires', from, to),
  };
  return {
    from, to, days: days.length, generatedAt: now,
    events: [...viina, ...geoconfirmed],
    news, media, reports, fires, coverage,
    counts: { viina: viina.length, geoconfirmed: geoconfirmed.length, news: news.length, media: media.length, reports: Object.keys(reports).length, fires: fires.length },
    attribution: {
      viina: 'VIINA 2.0 (Zhukov & Ayers), ODbL 1.0 — vlastný súbor',
      geoconfirmed: 'GeoConfirmed (geoconfirmed.org) — verejné API, odkazy na overené záznamy',
      news: 'otvorené spravodajstvo (GDELT, RSS redakcií, Google News) — len titulok, odkaz a náhľad',
      media: 'YouTube feedy redakcií (vložený prehrávač), oficiálne Telegram kanály UA (náhľad + embed), ArmyInform CC BY 4.0',
      reports: 'Generálny štáb ZSU cez ArmyInform, CC BY 4.0',
      fires: 'The Economist war-fire model (NASA FIRMS + ML), CC BY 4.0 — odvodené, nie potvrdené údery',
      control: 'Wikipedia · Russo-Ukrainian war detailed/overview map · CC BY-SA 4.0 — dobrovoľnícka mapa, nie oficiálna línia',
    },
  };
}

// ── územná kontrola (Wikipedia, CC BY-SA) ─────────────────────────────────
export const WIKI_API = 'https://en.wikipedia.org/w/api.php';
/** Prehľadový modul vznikol 22. 4. 2024; skoršie revízie má len podrobný modul. */
export const WIKI_OVERVIEW_SINCE = '2024-04-22';
export const CONTROL_FIRST_DAY = '2022-02-24';
const controlDir = (root) => path.join(archiveDir(root), 'control');
const controlFile = (root, day) => path.join(controlDir(root), `${day}.json`);
/** URL revízie modulu k času `at` (ISO) alebo najnovšej. Pure. */
export function wikiRevisionUrl(title, at = null) {
  const p = new URLSearchParams({ action: 'query', prop: 'revisions', titles: title, rvslots: 'main', rvprop: 'content|timestamp|ids|size', rvlimit: '1', format: 'json', formatversion: '2' });
  if (at) { p.set('rvdir', 'older'); p.set('rvstart', at); }
  return `${WIKI_API}?${p.toString()}`;
}
async function wikiRevision(fetchImpl, title, at) {
  const { res, body } = await fetchCapped(fetchImpl, wikiRevisionUrl(title, at), { timeoutMs: 60_000, maxBytes: 6 * 1024 * 1024, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`wiki HTTP ${res.status}`);
  const json = JSON.parse(body);
  const rev = json?.query?.pages?.[0]?.revisions?.[0];
  if (!rev?.slots?.main?.content) return null;
  return { revid: rev.revid, timestamp: rev.timestamp, size: rev.size, content: rev.slots.main.content };
}
/**
 * Snímka kontroly k dňu (`at` = YYYY-MM-DD; posledná revízia do konca dňa UTC)
 * alebo najnovšia (null): oba moduly → body + súhrn → control/<deň>.json. Súbor
 * nesie revízie (atribúcia CC BY-SA) a dátum revízie ako „stav k".
 */
export async function controlSnapshot(root, { at = null, fetchImpl = fetch, now = Date.now(), force = false, log = () => {} } = {}) {
  const day = at || dayKey(now);
  const file = controlFile(root, day);
  const prev = await readJson(file);
  if (!force && prev) {
    const final = at && now - dayToMs(at) > 2 * DAY_MS;
    if (final || now - (prev.fetchedAt || 0) < 6 * 3_600_000) return { status: 'fresh', day, count: prev.count };
  }
  const iso = at ? `${at}T23:59:59Z` : null;
  try {
    const detailed = await wikiRevision(fetchImpl, WIKI_DETAILED_TITLE, iso);
    if (!detailed) throw new Error('no detailed revision');
    let overview = null;
    if (!at || at >= WIKI_OVERVIEW_SINCE) { try { overview = await wikiRevision(fetchImpl, WIKI_OVERVIEW_TITLE, iso); } catch { overview = null; } }
    const points = controlPointsFromModules(overview?.content || '', detailed.content);
    if (!points.length) throw new Error('no control points parsed');
    const summary = controlSummary(points);
    const revisionAt = [detailed.timestamp, overview?.timestamp].filter(Boolean).sort().at(-1);
    const entry = {
      day, kind: 'control', fetchedAt: now, at: at || null, revisionAt,
      revisions: { detailed: { title: WIKI_DETAILED_TITLE, revid: detailed.revid, timestamp: detailed.timestamp }, overview: overview ? { title: WIKI_OVERVIEW_TITLE, revid: overview.revid, timestamp: overview.timestamp } : null },
      license: 'CC BY-SA 4.0 (derived from Wikipedia; https://creativecommons.org/licenses/by-sa/4.0/)',
      count: points.length, summary, points,
    };
    await writeJsonAtomic(file, entry);
    log(`[ukraine-events] control ${day}: ${points.length} points (rev ${detailed.revid}${overview ? '+' + overview.revid : ''}, ${revisionAt})`);
    return { status: 'updated', day, count: points.length, revisionAt };
  } catch (error) {
    log(`[ukraine-events] control ${day} failed: ${error?.message || error}`);
    return { status: prev ? 'stale' : 'error', day, count: prev?.count || 0, error: String(error?.message || error) };
  }
}
/** Zoznam dní so snímkou (zoradený). */
export async function controlDays(root) {
  try { return (await fsp.readdir(controlDir(root))).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort(); } catch { return []; }
}
/** Snímka platná pre deň: posledná so dňom ≤ `day` (alebo null). */
export async function controlFor(root, day, { days = null } = {}) {
  const list = days || await controlDays(root);
  let pick = null;
  for (const d of list) { if (d <= day) pick = d; else break; }
  return pick ? readJson(controlFile(root, pick)) : null;
}
/**
 * História po týždňoch od 24. 2. 2022: jedna snímka na `stepDays`, existujúce
 * dni sa preskočia; Wikipedia etiketa = jeden dopyt naraz, pauza medzi nimi.
 */
export async function controlBackfill(root, { fetchImpl = fetch, now = Date.now(), from = CONTROL_FIRST_DAY, stepDays = 7, pauseMs = 1200, log = () => {}, limit = Infinity } = {}) {
  const have = new Set(await controlDays(root));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let done = 0; let skipped = 0;
  for (let t = dayToMs(from); t < now - DAY_MS && done < limit; t += stepDays * DAY_MS) {
    const day = dayKey(t);
    if (have.has(day)) { skipped += 1; continue; }
    const r = await controlSnapshot(root, { at: day, fetchImpl, now, log });
    if (r.status === 'updated') done += 1;
    await sleep(pauseMs);
  }
  return { done, skipped };
}

// ── vojnové požiare (The Economist war-fire model, CC BY 4.0) ─────────────
export const ECONOMIST_FIRES_URL = 'https://raw.githubusercontent.com/TheEconomist/the-economist-war-fire-model/master/output-data/ukraine_war_fires.csv';
const firesDir = (root) => path.join(archiveDir(root), 'fires');
const firesFile = (root, day) => path.join(firesDir(root), `${day}.json`);
const firesMetaFile = (root) => path.join(firesDir(root), 'meta.json');
/** Riadok CSV Economistu → požiar `{id, t, lat, lon, urban, restrictive, sustained}` alebo null. Pure. */
export function fireRowToItem(row) {
  const lat = Number(row.LATITUDE); const lon = Number(row.LONGITUDE);
  const day = String(row.date || '').slice(0, 10);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || dayToMs(day) === null) return null;
  const hhmm = String(row.ACQ_TIME || '0').padStart(4, '0');
  const hh = Math.min(23, Number(hhmm.slice(0, 2)) || 0); const mm = Math.min(59, Number(hhmm.slice(2)) || 0);
  const t = dayToMs(day) + hh * 3_600_000 + mm * 60_000;
  return { id: `fire:${day}:${hhmm}:${lat.toFixed(4)}:${lon.toFixed(4)}`, t, lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4, urban: String(row.in_urban_area).toUpperCase() === 'TRUE', restrictive: row.war_fire_restrictive === '1', sustained: row.sustained_excess === '1' };
}
/** CSV → Map(deň → požiare). Pure. */
export function firesByDay(csvText) {
  const byDay = new Map();
  for (const row of parseCsv(csvText, ',')) {
    if (row.war_fire !== '1' && row.war_fire !== undefined) continue;
    const it = fireRowToItem(row);
    if (!it) continue;
    const day = dayKey(it.t);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(it);
  }
  return byDay;
}
/**
 * Stiahne CSV (70 MB; ETag → 304 = nič), rozloží po dňoch a prepíše len dni,
 * ktorých počet sa zmenil; index `meta.json` nesie ETag a počty po dňoch.
 */
export async function firesRefresh(root, { fetchImpl = fetch, now = Date.now(), force = false, maxAgeMs = 12 * 3_600_000, log = () => {} } = {}) {
  const meta = (await readJson(firesMetaFile(root))) || { days: {} };
  if (!force && Number.isFinite(meta.fetchedAt) && now - meta.fetchedAt < maxAgeMs) return { status: 'fresh', days: Object.keys(meta.days || {}).length };
  const started = Date.now();
  try {
    const headers = { Accept: 'text/csv' };
    if (meta.etag && !force) headers['If-None-Match'] = meta.etag;
    const { res, body } = await fetchCapped(fetchImpl, ECONOMIST_FIRES_URL, { timeoutMs: 300_000, maxBytes: 200 * 1024 * 1024, headers });
    if (res.status === 304) { await writeJsonAtomic(firesMetaFile(root), { ...meta, fetchedAt: now }); return { status: 'not-modified', days: Object.keys(meta.days || {}).length }; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const byDay = firesByDay(body);
    if (!byDay.size) throw new Error('no fires parsed');
    let written = 0; let total = 0;
    const days = {};
    for (const [day, items] of byDay) {
      days[day] = items.length; total += items.length;
      if (meta.days?.[day] === items.length) continue;
      await writeJsonAtomic(firesFile(root, day), { day, kind: 'fires', fetchedAt: now, items });
      written += 1;
    }
    await writeJsonAtomic(firesMetaFile(root), { fetchedAt: now, etag: res.headers?.get?.('etag') || null, bytes: body.length, total, days, source: ECONOMIST_FIRES_URL });
    log(`[ukraine-events] fires: ${total} war fires over ${byDay.size} days (${body.length} B, ${written} day files written) in ${Date.now() - started} ms`);
    return { status: 'updated', days: byDay.size, total, written };
  } catch (error) {
    log(`[ukraine-events] fires failed: ${error?.message || error}`);
    return { status: meta.days && Object.keys(meta.days).length ? 'stale' : 'error', days: Object.keys(meta.days || {}).length, error: String(error?.message || error) };
  }
}
export const firesEvents = (root, from, to) => readRangeItems(root, 'fires', from, to);
export async function firesIndex(root) { return (await readJson(firesMetaFile(root)))?.days || {}; }

// ── DeepStateMap.live (nekomerčné hobby použitie, súhlas sa žiada) ────────
// `/api/history/last` odpovedá bez kľúča; história je za autorizáciou (401 —
// overené 2026-09-19), preto si dni archivujeme sami. Jeden dopyt za hodinu.
const deepstateDir = (root) => path.join(archiveDir(root), 'deepstate');
const deepstateFile = (root, day) => path.join(deepstateDir(root), `${day}.json`);
/**
 * Stiahne poslednú snímku, prevedie čistým modelom (bez jednotiek) a uloží pod
 * DEŇ snímky (z `id`); nezmenené `id` = nič nové. `maxAgeMs` chráni pred
 * častejším sťahovaním než raz za hodinu.
 */
export async function deepstateSnapshot(root, { fetchImpl = fetch, now = Date.now(), force = false, maxAgeMs = 60 * 60_000, log = () => {} } = {}) {
  const metaFile = path.join(deepstateDir(root), 'meta.json');
  const meta = (await readJson(metaFile)) || {};
  if (!force && Number.isFinite(meta.fetchedAt) && now - meta.fetchedAt < maxAgeMs) return { status: 'fresh', day: meta.lastDay || null, id: meta.lastId || null };
  const started = Date.now();
  try {
    const { res, body } = await fetchCapped(fetchImpl, DEEPSTATE_LAST_URL, { timeoutMs: 60_000, maxBytes: 20 * 1024 * 1024, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const snapshot = deepstateSnapshotFromApi(JSON.parse(body));
    if (!snapshot.day || !snapshot.features.length) throw new Error('no usable features');
    const changed = snapshot.id !== meta.lastId;
    if (changed) await writeJsonAtomic(deepstateFile(root, snapshot.day), { ...snapshot, kind: 'deepstate', fetchedAt: now, source: DEEPSTATE_LAST_URL, attribution: DEEPSTATE_ATTRIBUTION, use: 'non-commercial hobby use; consent requested from DeepState (licence §2); units omitted' });
    await writeJsonAtomic(metaFile, { fetchedAt: now, lastId: snapshot.id, lastDay: snapshot.day, lastAt: snapshot.at, bytes: body.length });
    log(`[ukraine-events] deepstate: ${changed ? 'new' : 'unchanged'} snapshot ${snapshot.day} (id ${snapshot.id}, ${snapshot.features.length} features, ${body.length} B) in ${Date.now() - started} ms`);
    return { status: changed ? 'updated' : 'not-modified', day: snapshot.day, id: snapshot.id, features: snapshot.features.length };
  } catch (error) {
    log(`[ukraine-events] deepstate failed: ${error?.message || error}`);
    return { status: meta.lastDay ? 'stale' : 'error', day: meta.lastDay || null, error: String(error?.message || error) };
  }
}
export async function deepstateDays(root) {
  try { return (await fsp.readdir(deepstateDir(root))).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort(); } catch { return []; }
}
/** Snímka platná pre deň: posledná so dňom ≤ `day`, alebo null. */
export async function deepstateFor(root, day, { days = null } = {}) {
  const list = days || await deepstateDays(root);
  let pick = null;
  for (const d of list) { if (d <= day) pick = d; else break; }
  return pick ? readJson(deepstateFile(root, pick)) : null;
}

// Re-export pre CLI a plugin (deň z ms a späť), aby nemuseli siahať do src/data.
export { dayKey, dayToMs } from "../../src/data/ukraineEvents.js";
