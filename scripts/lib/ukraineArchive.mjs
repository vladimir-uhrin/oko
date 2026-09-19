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
import { VIINA_MEDIA_BASE, dayKey, dayToMs, parseGeoconfirmedCsv, parseViinaCsv } from '../../src/data/ukraineEvents.js';
import {
  ARMYINFORM_UA_FEED, TELEGRAM_CHANNELS, YOUTUBE_CHANNELS,
  parseRssVideoEnclosures, parseTelegramPreview, parseYoutubeFeed, telegramPreviewUrl, youtubeFeedUrl,
} from '../../src/data/ukraineMedia.js';
import { ARMYINFORM_OPS_FEED, extractReportParagraphs, parseGeneralStaffReport } from '../../src/data/ukraineReport.js';

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
  const out = Object.fromEntries(days.map((d) => [d, { viina: 0, geoconfirmed: 0, news: 0, media: 0, report: null, critical: 0, killed: 0, injured: 0, types: {} }]));
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
  const [viina, geoconfirmed, news, media, reports] = await Promise.all([
    viinaEvents(root, from, to, { cache: viinaCache }),
    geoconfirmedEvents(root, from, to),
    readRangeItems(root, 'news', from, to),
    readRangeItems(root, 'media', from, to),
    readReports(root, from, to),
  ]);
  const coverage = {
    viina: Object.fromEntries(await Promise.all([...new Set(days.map((d) => Number(d.slice(0, 4))))].map(async (y) => { const e = viinaCache?.get(y) || await readJson(viinaFile(root, y)); return [y, e ? { count: e.count, fetchedAt: e.fetchedAt } : null]; }))),
    geoconfirmed: await coverageDays(root, 'geoconfirmed', from, to),
    news: await coverageDays(root, 'news', from, to),
    media: await coverageDays(root, 'media', from, to),
    reports: Object.keys(reports),
  };
  return {
    from, to, days: days.length, generatedAt: now,
    events: [...viina, ...geoconfirmed],
    news, media, reports, coverage,
    counts: { viina: viina.length, geoconfirmed: geoconfirmed.length, news: news.length, media: media.length, reports: Object.keys(reports).length },
    attribution: {
      viina: 'VIINA 2.0 (Zhukov & Ayers), ODbL 1.0 — vlastný súbor',
      geoconfirmed: 'GeoConfirmed (geoconfirmed.org) — verejné API, odkazy na overené záznamy',
      news: 'otvorené spravodajstvo (GDELT, RSS redakcií, Google News) — len titulok, odkaz a náhľad',
      media: 'YouTube feedy redakcií (vložený prehrávač), oficiálne Telegram kanály UA (náhľad + embed), ArmyInform CC BY 4.0',
      reports: 'Generálny štáb ZSU cez ArmyInform, CC BY 4.0',
    },
  };
}

// Re-export pre CLI a plugin (deň z ms a späť), aby nemuseli siahať do src/data.
export { dayKey, dayToMs } from "../../src/data/ukraineEvents.js";
