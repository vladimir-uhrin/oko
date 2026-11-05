// scripts/lib/mideastArchive.mjs — archív modulu BLÍZKY VÝCHOD (etapa 2 „KONTROLA
// SÍDIEL", 2026-09-26; plán docs/drafts/blizky-vychod-plan.md kap. 5–6). Sesterská
// knižnica k ukraineArchive.mjs: čistý Node, všetok I/O cez vstreknuté `fetchImpl`,
// `now` ako číslo ms alebo funkcia (`nowToMs`), atomický zápis .tmp + rename (junction
// .gev-cache → D:).
// Rozloženie na disku (.gev-cache/mideast/events/):
//   control/<modul>/<deň>.json   snímka kontroly sídiel z Lua modulu Wikipédie
//                                (CC BY-SA 4.0, Wikipedia contributors) — jeden
//                                adresár na modul, aby sa snímky rôznych modulov
//                                nemiešali (israel-palestine, yemen, syria, lebanon)
//   portwatch/<úžina>.json       denné prechody úžinou z IMF PortWatch od 1. 1. 2019
//                                (etapa 5a, 2026-09-26; kompaktné riadky, src/data/portwatch.js)
//   airspace/czib.json           aktívne bulletiny EASA o konfliktných zónach (etapa 5b,
//                                2026-10-03; src/data/czib.js)
//   airspace/fir-boundaries.json hranice FIR z VATSpy (CC BY-SA 4.0), len základné FIR
//   ukmto/incidents.json         incidenty lodí z rozhrania UKMTO (OGL v3.0; etapa 5c,
//                                2026-10-03; src/data/ukmto.js) — archív rastie, rozhranie
//                                drží len posledné tri mesiace
//   gps/<deň>.json               rušenie GPS po bunkách 0,5° — počty lietadiel a lietadiel so
//                                zhoršenou presnosťou polohy (adsb.lol, ODbL; etapa 5d,
//                                2026-10-03; src/data/gpsInterference.js), bez adries lietadiel
//   gps/<deň>.work.json          rozpracovaný deň (adresy kvôli jedinečnosti; po uzavretí sa maže)
//   geoconfirmed/<konflikt>/<deň>.json  overené udalosti GeoConfirmed po dňoch (iran, israel, yemen,
//                                syria; etapa 4, 2026-11-05; src/data/mideastIncidents.js) + _meta.json
//   ucdp/<YYYY-MM>.json          UCDP Candidate Events, len krajiny regiónu (CC BY 4.0) + _meta.json
//
// Z ukraineArchive.mjs sa berú LEN exportované primitívy (dni, disk, URL revízie).
// Sieťový obal s User-Agentom je vlastný: Wikimedia etiketa chce popisný UA
// s kontaktom, jeden dopyt naraz a pauzy medzi dopytmi (história po týždňoch).
import { promises as fsp } from 'node:fs';
import https from 'node:https';
import path from 'node:path';

import { dayKey, dayToMs, isDay, readJson, wikiRevisionUrl, writeJsonAtomic } from './ukraineArchive.mjs';
import { adsbLolBudget } from '../../src/data/adsbLolBudget.js';
import { MIDEAST_CONTROL_MODULE_IDS, wikiControlModuleById, wikiControlPoints, wikiControlSummary } from '../../src/data/wikiControl.js';
import {
  PORTWATCH_ATTRIBUTION, PORTWATCH_DATASET_URL, PORTWATCH_FIRST_DAY, PORTWATCH_KEYS, PORTWATCH_LICENSE, PORTWATCH_PAGE_SIZE, PW,
  meanOver, mergePortwatchRows, parsePortwatchFeatures, portwatchChokepoint, portwatchQueryUrl,
} from '../../src/data/portwatch.js';
import {
  CZIB_ATTRIBUTION, CZIB_EXPORT_URL, CZIB_FEED_URL, CZIB_LIST_URL, FIR_ATTRIBUTION, FIR_LICENSE, VATSPY_BOUNDARIES_URL,
  buildCzibBulletin, czibLapsed, indexFirBoundaries, parseCzibDetail, parseCzibExport, parseCzibFeed,
} from '../../src/data/czib.js';
import { UKMTO_API_URL, UKMTO_ATTRIBUTION, UKMTO_LICENSE, UKMTO_LICENSE_URL, UKMTO_SITE_URL, mergeUkmtoIncidents, parseUkmtoIncidents } from '../../src/data/ukmto.js';
import {
  GPS_ATTRIBUTION, GPS_CELL_DEG, GPS_CIRCLES, GPS_HIGH, GPS_LICENSE, GPS_LOW, GPS_MIN_AIRCRAFT, GPS_PROVIDERS,
  gpsAddSnapshot, gpsCircleUrl, gpsEmptyDay, gpsFinalizeDay, gpsMergeDays,
} from '../../src/data/gpsInterference.js';
import {
  GEOCONFIRMED_LICENSE, GEOCONFIRMED_MIDEAST_ATTRIBUTION, GEOCONFIRMED_SITE, GEOCONFIRMED_SLUGS, MIDEAST_INCIDENTS_FIRST_DAY, MIDEAST_INCIDENTS_ROLLING_DAYS,
  UCDP_ATTRIBUTION, UCDP_LICENSE, UCDP_PAGE, dedupIncidents, geoconfirmedExportUrl, inRect, parseGeoconfirmedIncidents, parseUcdpIncidents, ucdpCandidateUrl,
} from '../../src/data/mideastIncidents.js';

export { MIDEAST_CONTROL_MODULE_IDS };
export const USER_AGENT = 'OKO-mideast/0.1 (https://github.com/vladouh76; vladouh76@gmail.com)';
/** Strop tela odpovede MediaWiki API na jednu revíziu (sýrsky modul ≈ 1 MB surového Lua + JSON obal). */
export const WIKI_REVISION_MAX_BYTES = 6 * 1024 * 1024;
/** Dnešná snímka sa sťahuje znova až po tomto čase (moduly sa menia po hodinách, nie po minútach). */
export const CONTROL_FRESH_MS = 6 * 3_600_000;
/** Snímka k minulému dňu je po tomto čase konečná — Wikipédia spätne nemení históriu revízií. */
export const CONTROL_FINAL_AFTER_MS = 2 * 86_400_000;
/**
 * Predvolený začiatok histórie po týždňoch: 28. 2. 2026 (plán kap. 6 — začiatok
 * súčasnej fázy pre všetky štyri moduly). Hlbšia história (IP modul od 7. 10. 2023,
 * Jemen/Sýria roky späť) je rozhodnutie vlastníka cez CLI `--from`, nie predvoľba —
 * každý týždeň je jeden dopyt na Wikipédiu.
 */
export const MIDEAST_CONTROL_FIRST_DAY = '2026-02-28';
export const WIKI_LICENSE = 'CC BY-SA 4.0';
const DAY_MS = 86_400_000;

export const archiveDir = (root = process.cwd()) => path.join(root, '.gev-cache', 'mideast', 'events');
export const controlDir = (root, moduleId) => path.join(archiveDir(root), 'control', String(moduleId));
export const controlFile = (root, moduleId, day) => path.join(controlDir(root, moduleId), `${day}.json`);

/** Len id z MIDEAST_CONTROL_MODULE_IDS (aj ako názov adresára — bez ':' a lomiek). Pure. */
export const isMideastModuleId = (id) => typeof id === 'string' && MIDEAST_CONTROL_MODULE_IDS.includes(id);

/** Verejná stránka modulu (atribúcia CC BY-SA): `Module:X Y` → `/wiki/Module:X_Y`. Pure. */
export const wikiPageUrl = (title) => `https://en.wikipedia.org/wiki/${encodeURI(String(title || '').replace(/ /g, '_'))}`;
/** Trvalý odkaz na konkrétnu revíziu (CC BY-SA chce identifikovať verziu). Pure. */
export const wikiRevisionPermalink = (title, revid) => `https://en.wikipedia.org/w/index.php?${new URLSearchParams({ title: String(title || ''), oldid: String(revid) })}`;

/**
 * `now` z volieb: konečné ČÍSLO ms alebo FUNKCIA, ktorá ho vráti (konvencia pluginu
 * `now: () => ms`); všetko ostatné (null, reťazec, NaN, Infinity) = NaN — prísne, lebo
 * `Number(null)` je 0 a tichý rok 1970 by bol horší než chyba. Sesterský proxy podáva
 * funkciu — knižnica ju prijme namiesto RangeError z `dayKey`. Pure.
 */
export const nowToMs = (now) => { const v = typeof now === 'function' ? now() : now; return typeof v === 'number' && Number.isFinite(v) ? v : NaN; };

// ── sieť ───────────────────────────────────────────────────────────────────
/**
 * Stiahne telo so stropom veľkosti: rýchla cesta cez hlavičku Content-Length (ak je),
 * inak sa telo ČÍTA PO KÚSKOCH a hneď, ako súčet prekročí `maxBytes`, sa sťahovanie
 * preruší (abort + cancel čítača) — pamäť dev servera tak nikdy nedrží viac než strop
 * plus jeden kúsok ani pri chunked odpovedi bez Content-Length (bežný tvar MediaWiki
 * API s gzipom). Odpoveď bez streamu (`res.body` chýba — testovacie mocky) padá na
 * `arrayBuffer()` s kontrolou dĺžky. Chyba je jedna veta bez dumpu tela.
 */
async function fetchCapped(fetchImpl, url, { timeoutMs = 60_000, maxBytes = WIKI_REVISION_MAX_BYTES, headers = {} } = {}) {
  const host = (() => { try { return new URL(url).host; } catch { return '?'; } })();
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
  const res = await fetchImpl(url, { signal, headers: { 'User-Agent': USER_AGENT, ...headers } });
  const declared = Number(res?.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) { controller.abort(); throw new Error(`too large (Content-Length ${declared} B > ${maxBytes} B) ${host}`); }
  if (typeof res?.body?.getReader !== 'function') {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error(`too large (${buf.length} B > ${maxBytes} B) ${host}`);
    return { res, body: buf.toString('utf8') };
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      total += chunk.length;
      if (total > maxBytes) {
        controller.abort();
        await reader.cancel().catch(() => {});
        throw new Error(`too large (${total} B > ${maxBytes} B) ${host}`);
      }
      chunks.push(chunk);
    }
  } finally { try { reader.releaseLock(); } catch { /* čítač už zrušený */ } }
  return { res, body: Buffer.concat(chunks, total).toString('utf8') };
}

/**
 * Jedna revízia modulu: najnovšia (`at` = null) alebo posledná do času `at` (ISO,
 * `rvdir=older&rvstart=`). Vracia `{ revid, timestamp, size, content }` alebo null,
 * keď modul k tomu času nemal revíziu (ešte neexistoval).
 * @param {typeof fetch} fetchImpl
 * @param {string} title
 * @param {string|null} [at]
 */
export async function wikiRevision(fetchImpl, title, at = null) {
  const { res, body } = await fetchCapped(fetchImpl, wikiRevisionUrl(title, at), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`wiki HTTP ${res.status}`);
  let json;
  try { json = JSON.parse(body); } catch { throw new Error('wiki: invalid JSON'); }
  const rev = json?.query?.pages?.[0]?.revisions?.[0];
  if (!rev?.slots?.main?.content) return null;
  return { revid: rev.revid, timestamp: rev.timestamp, size: rev.size, content: rev.slots.main.content };
}

// ── snímky kontroly ────────────────────────────────────────────────────────
const unmappedOf = (snapshot) => ({ ...(snapshot?.summary?.unmapped || {}) });

/**
 * Snímka kontroly modulu k dňu (`at` = YYYY-MM-DD → posledná revízia do konca dňa
 * UTC) alebo najnovšia (`at` = null → deň podľa `now`). Každý titul konfigurácie
 * modulu sa sťahuje POSTUPNE (jeden dopyt naraz); tituly so `since` sú voliteľné
 * pred svojím vznikom, ostatné povinné. Čerstvosť ako Ukrajina: minulý deň je po
 * 2 dňoch konečný, dnešok sa obnoví po 6 h, `force` obchádza oboje.
 *
 * Súbor control/<modul>/<deň>.json nesie: day, kind 'control', module, fetchedAt,
 * at, revisionAt (najnovší timestamp z titulov), revisions { [titleId]: { title,
 * revid, timestamp, size, url } }, count, summary (vrátane `unmapped` = neznáme
 * ikony s počtami — nikdy sa ticho nezaradia k strane), skipped/sideless/invalid,
 * points, license, attribution, source (stránka modulu).
 * `now` je ČÍSLO ms alebo FUNKCIA (`nowToMs`); nekonečná/NaN hodnota = status 'error'
 * (`bad now`), nikdy odmietnutý Promise.
 * @param {string} root
 * @param {string} moduleId
 * @param {{at?: string|null, fetchImpl?: typeof fetch, now?: number|(() => number), force?: boolean, log?: Function}} [opts]
 * @returns {Promise<{status: 'updated'|'fresh'|'stale'|'error', day: string|null, module: string, count: number, revisionAt: string|null, unmapped: Record<string, number>, error?: string}>}
 */
export async function wikiControlSnapshot(root, moduleId, { at = null, fetchImpl = fetch, now = Date.now(), force = false, log = () => {} } = {}) {
  const nowMs = nowToMs(now);
  const day = at ? String(at) : (Number.isFinite(nowMs) ? dayKey(nowMs) : null);
  const base = { day, module: String(moduleId), count: 0, revisionAt: null, unmapped: {} };
  const config = isMideastModuleId(moduleId) ? wikiControlModuleById(moduleId) : null;
  if (!config) return { status: 'error', ...base, error: `unknown module '${moduleId}' (${MIDEAST_CONTROL_MODULE_IDS.join(', ')})` };
  if (!Number.isFinite(nowMs)) return { status: 'error', ...base, error: `bad now '${String(now)}'` };
  if (at && !isDay(at)) return { status: 'error', ...base, error: `bad day '${at}'` };
  const file = controlFile(root, moduleId, day);
  const prev = await readJson(file);
  if (!force && prev) {
    const final = at && nowMs - dayToMs(at) > CONTROL_FINAL_AFTER_MS;
    if (final || nowMs - (prev.fetchedAt || 0) < CONTROL_FRESH_MS) {
      return { status: 'fresh', day, module: moduleId, count: prev.count || 0, revisionAt: prev.revisionAt || null, unmapped: unmappedOf(prev) };
    }
  }
  const iso = at ? `${at}T23:59:59Z` : null;
  try {
    const sources = [];
    for (const t of config.titles) {
      if (at && t.since && at < t.since) continue;
      let rev = null;
      try { rev = await wikiRevision(fetchImpl, t.title, iso); } catch (error) { if (!t.since) throw error; }
      if (!rev) { if (t.since) continue; throw new Error(`no revision of ${t.title}${at ? ' at ' + at : ''}`); }
      sources.push({ id: t.id, src: rev.content, revision: { title: t.title, revid: rev.revid, timestamp: rev.timestamp, size: rev.size, url: wikiRevisionPermalink(t.title, rev.revid) } });
    }
    if (!sources.length) throw new Error('no revision');
    const parsed = wikiControlPoints(sources, config);
    if (!parsed.points.length) throw new Error('no control points parsed');
    const summary = wikiControlSummary(parsed.points, config, { unmapped: parsed.unmapped });
    const revisionAt = Object.values(parsed.revisions).map((r) => r?.timestamp).filter(Boolean).sort().at(-1) || null;
    const titles = sources.map((s) => s.revision.title);
    const entry = {
      day, kind: 'control', module: moduleId, fetchedAt: nowMs, at: at || null, revisionAt,
      revisions: parsed.revisions,
      count: parsed.points.length, summary, skipped: parsed.skipped, sideless: parsed.sideless, invalid: parsed.invalid,
      points: parsed.points,
      license: WIKI_LICENSE,
      attribution: `Wikipedia contributors · ${titles.join(' + ')} · ${WIKI_LICENSE}`,
      source: wikiPageUrl(titles[0]),
    };
    await writeJsonAtomic(file, entry);
    const unmappedN = Object.values(parsed.unmapped).reduce((a, b) => a + b, 0);
    log(`[mideast-events] control ${moduleId} ${day}: ${parsed.points.length} points (rev ${sources.map((s) => s.revision.revid).join('+')}, ${revisionAt})${unmappedN ? `, ${unmappedN} unmapped` : ''}`);
    return { status: 'updated', day, module: moduleId, count: parsed.points.length, revisionAt, unmapped: { ...parsed.unmapped } };
  } catch (error) {
    log(`[mideast-events] control ${moduleId} ${day} failed: ${error?.message || error}`);
    return { status: prev ? 'stale' : 'error', day, module: moduleId, count: prev?.count || 0, revisionAt: prev?.revisionAt || null, unmapped: unmappedOf(prev), error: String(error?.message || error) };
  }
}

/** Zoradené dni so snímkou modulu ([] pre neznámy modul alebo prázdny archív). */
export async function controlDays(root, moduleId) {
  if (!isMideastModuleId(moduleId)) return [];
  try { return (await fsp.readdir(controlDir(root, moduleId))).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort(); } catch { return []; }
}

/**
 * Snímka modulu platná pre deň: posledná ČITATEĽNÁ so dňom ≤ `day`, inak null. Dni sa
 * prechádzajú od najnovšieho spôsobilého dozadu — nečitateľný súbor (orezaný ručnou úpravou,
 * padnutý rename, kópia disku) nezakryje staršiu platnú snímku. Null s dňami ≤ `day`
 * v zozname teda znamená „nič z toho sa nedá prečítať" (proxy z toho robí 500, nie 404).
 */
export async function controlFor(root, moduleId, day, { days = null } = {}) {
  if (!isMideastModuleId(moduleId)) return null;
  const list = days || await controlDays(root, moduleId);
  let idx = -1;
  for (let i = 0; i < list.length; i += 1) { if (list[i] <= day) idx = i; else break; }
  for (let i = idx; i >= 0; i -= 1) {
    const json = await readJson(controlFile(root, moduleId, list[i]));
    if (json) return json;
  }
  return null;
}

/** Lacný prehľad archívu pre všetky moduly (len readdir, žiadne čítanie snímok). */
export async function controlIndex(root) {
  const out = {};
  for (const id of MIDEAST_CONTROL_MODULE_IDS) {
    const days = await controlDays(root, id);
    out[id] = { snapshots: days.length, first: days[0] || null, last: days.at(-1) || null };
  }
  return out;
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * História modulu po týždňoch od `from`: jedna snímka na `stepDays`, existujúce dni
 * sa preskočia, končí pri now − 1 deň. Wikipedia etiketa: jeden dopyt naraz a pauza
 * `pauseMs` po každom dopyte (vstreknuteľný `sleep` pre testy). Neúspešné dni sa
 * počítajú do `errors` a pokračuje sa (modul pred svojím vznikom nemá revíziu).
 * `now` je číslo ms alebo funkcia; neplatné `now`, neznámy modul a zlý `from` sú chyby
 * volajúceho (CLI) → výnimka PRED prvým dopytom, nie tichý beh s 0 dňami.
 * @returns {Promise<{done: number, skipped: number, errors: number}>}
 */
export async function controlBackfill(root, moduleId, { from = MIDEAST_CONTROL_FIRST_DAY, stepDays = 7, pauseMs = 1200, limit = Infinity, fetchImpl = fetch, now = Date.now(), log = () => {}, sleep = defaultSleep } = {}) {
  if (!isMideastModuleId(moduleId)) throw new Error(`unknown module '${moduleId}' (${MIDEAST_CONTROL_MODULE_IDS.join(', ')})`);
  if (!isDay(from)) throw new Error(`bad from day '${from}'`);
  const nowMs = nowToMs(now);
  if (!Number.isFinite(nowMs)) throw new Error(`bad now '${String(now)}'`);
  const step = Math.max(1, Math.floor(Number(stepDays) || 7));
  const have = new Set(await controlDays(root, moduleId));
  let done = 0; let skipped = 0; let errors = 0;
  for (let t = dayToMs(from); t < nowMs - DAY_MS && done < limit; t += step * DAY_MS) {
    const day = dayKey(t);
    if (have.has(day)) { skipped += 1; continue; }
    const r = await wikiControlSnapshot(root, moduleId, { at: day, fetchImpl, now: nowMs, log });
    if (r.status === 'updated') done += 1; else if (r.status !== 'fresh') errors += 1;
    await sleep(pauseMs);
  }
  return { done, skipped, errors };
}

// ── IMF PortWatch — denné prechody úžinami (etapa 5a, 2026-09-26) ─────────
/** Obnova najviac raz za 6 h (dataset MMF sa mení približne raz týždenne). */
export const PORTWATCH_FRESH_MS = 6 * 3_600_000;
/** Pri obnove sa znova stiahne posledných N dní — MMF spätne opravuje predbežné dni. */
export const PORTWATCH_OVERLAP_DAYS = 45;
/** Poistka proti nekonečnému stránkovaniu (celá séria od 2019 = 3 strany po 1 000). */
export const PORTWATCH_MAX_PAGES = 12;
/** Strop tela jednej strany (1 000 riadkov JSON ≈ 150 kB). */
export const PORTWATCH_PAGE_MAX_BYTES = 4 * 1024 * 1024;
export const portwatchDir = (root) => path.join(archiveDir(root), 'portwatch');
export const portwatchFile = (root, key) => path.join(portwatchDir(root), `${key}.json`);
/** Len kľúče z PORTWATCH_KEYS (aj ako názov súboru). Pure. */
export const isPortwatchKey = (key) => typeof key === 'string' && PORTWATCH_KEYS.includes(key);

/**
 * Obnoví sériu úžiny: bez súboru celá séria od 1. 1. 2019, inak od posledného dňa mínus
 * `PORTWATCH_OVERLAP_DAYS` (opravy predbežných dní) a zlúčenie (novšie vyhráva). Strany
 * po 1 000 riadkov vzostupne, kým strana nie je plná. Čerstvosť 6 h drží `fetchedAt`
 * na disku. Pri chybe ostáva stará séria (`stale`); bez nej `error`. Nikdy nehádže.
 * @param {string} root
 * @param {string} key 'hormuz' | 'bab-el-mandeb' | 'suez' | 'cape'
 * @param {{fetchImpl?: typeof fetch, now?: number|(() => number), force?: boolean, log?: Function}} [o]
 * @returns {Promise<{status: 'updated'|'fresh'|'stale'|'error', key: string, lastDay: string|null, count: number, fetched?: number, error?: string}>}
 */
export async function portwatchRefresh(root, key, { fetchImpl = fetch, now = Date.now(), force = false, log = () => {} } = {}) {
  const base = { key, lastDay: null, count: 0 };
  if (!isPortwatchKey(key)) return { status: 'error', ...base, error: `unknown chokepoint '${key}' (${PORTWATCH_KEYS.join(', ')})` };
  const nowMs = nowToMs(now);
  if (!Number.isFinite(nowMs)) return { status: 'error', ...base, error: `bad now '${String(now)}'` };
  const cp = portwatchChokepoint(key);
  const file = portwatchFile(root, key);
  const prev = await readJson(file);
  const prevRows = Array.isArray(prev?.rows) ? prev.rows : [];
  if (!force && prev && prevRows.length && nowMs - (Number(prev.fetchedAt) || 0) < PORTWATCH_FRESH_MS) {
    return { status: 'fresh', key, lastDay: prev.lastDay || null, count: prevRows.length };
  }
  const fromDay = prev?.lastDay && isDay(prev.lastDay) && prevRows.length
    ? dayKey(Math.max(dayToMs(PORTWATCH_FIRST_DAY), dayToMs(prev.lastDay) - PORTWATCH_OVERLAP_DAYS * DAY_MS))
    : null;
  try {
    const fetched = [];
    for (let page = 0; ; page += 1) {
      if (page >= PORTWATCH_MAX_PAGES) throw new Error(`PortWatch: more than ${PORTWATCH_MAX_PAGES} pages`);
      const url = portwatchQueryUrl(cp.portid, { fromDay, offset: page * PORTWATCH_PAGE_SIZE });
      const { res, body } = await fetchCapped(fetchImpl, url, { timeoutMs: 60_000, maxBytes: PORTWATCH_PAGE_MAX_BYTES, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`PortWatch HTTP ${res.status}`);
      let json;
      try { json = JSON.parse(body); } catch { throw new Error('PortWatch: invalid JSON'); }
      fetched.push(...parsePortwatchFeatures(json));
      const n = Array.isArray(json.features) ? json.features.length : 0;
      if (n < PORTWATCH_PAGE_SIZE && !json.exceededTransferLimit) break;
    }
    const rows = mergePortwatchRows(prevRows, fetched);
    if (!rows.length) throw new Error('PortWatch: no rows');
    const lastDay = rows.at(-1)[PW.day];
    await writeJsonAtomic(file, {
      key, portid: cp.portid, name: cp.name, kind: 'portwatch', fetchedAt: nowMs, from: fromDay, lastDay,
      source: PORTWATCH_DATASET_URL, attribution: PORTWATCH_ATTRIBUTION, license: PORTWATCH_LICENSE, rows,
    });
    log(`[mideast-events] portwatch ${key}: ${rows.length} days → ${lastDay} (${fetched.length} fetched${fromDay ? ` since ${fromDay}` : ', full series'})`);
    return { status: 'updated', key, lastDay, count: rows.length, fetched: fetched.length };
  } catch (error) {
    const message = String(error?.message || error);
    log(`[mideast-events] portwatch ${key} failed: ${message}`);
    if (prevRows.length) return { status: 'stale', key, lastDay: prev.lastDay || null, count: prevRows.length, error: message };
    return { status: 'error', ...base, error: message };
  }
}

/** Uložená séria úžiny alebo null (neznámy kľúč, chýbajúci či nečitateľný súbor). */
export async function portwatchRead(root, key) {
  if (!isPortwatchKey(key)) return null;
  const json = await readJson(portwatchFile(root, key));
  return json && Array.isArray(json.rows) ? json : null;
}

/**
 * Telo `/api/mideast/events/portwatch`: pre každú úžinu so sériou posledných `days`
 * riadkov a priemer okna „pred krízou" spočítaný z CELEJ série (klient má len chvost).
 * Úžiny bez súboru sa vynechajú; prázdny zoznam = volajúci vráti 404.
 */
export async function portwatchPayload(root, keys, { days = 400, nowMs = Date.now() } = {}) {
  const chokepoints = [];
  for (const key of keys) {
    const snap = await portwatchRead(root, key);
    if (!snap || !snap.rows.length) continue;
    const b = portwatchChokepoint(key).baseline;
    const total = meanOver(snap.rows, b.from, b.to, PW.total);
    const tanker = meanOver(snap.rows, b.from, b.to, PW.tanker);
    chokepoints.push({
      key, portid: snap.portid, name: snap.name, fetchedAt: snap.fetchedAt ?? null, lastDay: snap.lastDay ?? snap.rows.at(-1)[PW.day],
      baseline: { ...b, mean: total.mean, meanTanker: tanker.mean, days: total.days },
      rows: snap.rows.slice(-Math.max(1, Math.floor(days))),
    });
  }
  return { source: PORTWATCH_DATASET_URL, attribution: PORTWATCH_ATTRIBUTION, license: PORTWATCH_LICENSE, generatedAt: nowMs, chokepoints };
}

// ── airspace/ — EASA CZIB + hranice FIR z VATSpy (etapa 5b, 2026-10-03) ─────────
/** Zoznam bulletinov sa pýta raz za 6 h; stránka bulletinu len pri zmene `updated`. */
export const AIRSPACE_FRESH_MS = 6 * 3_600_000;
/** Hranice FIR (VATSpy, mení sa po týždňoch) raz za 7 dní. */
export const FIR_FRESH_MS = 7 * DAY_MS;
/** Pauza medzi stránkami bulletinov EASA (zdvorilosť; ~16 aktívnych). */
export const CZIB_DETAIL_PAUSE_MS = 1_200;
export const CZIB_LIST_MAX_BYTES = 2 * 1024 * 1024;
/** Stránka bulletinu má ~280 kB HTML (menu webu EASA). */
export const CZIB_PAGE_MAX_BYTES = 4 * 1024 * 1024;
/** Boundaries.geojson VATSpy má 2,2 MB (1 220 prvkov, 2026-10-03). */
export const FIR_BOUNDARIES_MAX_BYTES = 12 * 1024 * 1024;
export const airspaceDir = (root) => path.join(archiveDir(root), 'airspace');
export const czibFile = (root) => path.join(airspaceDir(root), 'czib.json');
export const firFile = (root) => path.join(airspaceDir(root), 'fir-boundaries.json');
const defaultSleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Obnoví snímku aktívnych bulletinov EASA: export (stav, platnosť, krajiny) + RSS (odkaz)
 * + stránka bulletinu (číslo, dotknutý priestor, odporúčania) — stránka sa sťahuje len pre
 * nový bulletin alebo pri zmenenom `updated`, inak sa prevezme z predošlej snímky. Stiahnutý
 * (Withdrawn) bulletin zo snímky vypadne. Pri chybe zoznamu ostáva stará snímka (`stale`).
 * Nikdy nehádže.
 * @returns {Promise<{status:'updated'|'partial'|'fresh'|'stale'|'error', count:number, fetched?:number, day?:string, errors?:string[], error?:string}>}
 */
export async function czibRefresh(root, { fetchImpl = fetch, now = Date.now(), force = false, log = () => {}, sleep = defaultSleepMs } = {}) {
  const nowMs = nowToMs(now);
  if (!Number.isFinite(nowMs)) return { status: 'error', count: 0, error: `bad now '${String(now)}'` };
  const prev = await readJson(czibFile(root));
  const prevList = Array.isArray(prev?.bulletins) ? prev.bulletins : [];
  if (!force && prev && nowMs - (Number(prev.fetchedAt) || 0) < AIRSPACE_FRESH_MS) {
    return { status: 'fresh', count: prevList.length, day: dayKey(Number(prev.fetchedAt)) };
  }
  try {
    const list = await fetchCapped(fetchImpl, CZIB_EXPORT_URL, { maxBytes: CZIB_LIST_MAX_BYTES, headers: { Accept: 'application/json' } });
    if (!list.res.ok) throw new Error(`EASA export HTTP ${list.res.status}`);
    let exported;
    try { exported = JSON.parse(list.body); } catch { throw new Error('EASA export: invalid JSON'); }
    const rows = parseCzibExport(exported);
    if (!rows.length) throw new Error('EASA export: no bulletins');
    let links = new Map();
    try {
      const feed = await fetchCapped(fetchImpl, CZIB_FEED_URL, { maxBytes: CZIB_LIST_MAX_BYTES, headers: { Accept: 'application/rss+xml,application/xml' } });
      if (feed.res.ok) links = parseCzibFeed(feed.body);
    } catch (error) { log(`[mideast-events] czib feed failed: ${error?.message || error}`); }
    const prevByNid = new Map(prevList.map((b) => [b.nid, b]));
    const bulletins = [];
    const errors = [];
    let fetched = 0;
    for (const row of rows.filter((r) => r.active)) {
      const old = prevByNid.get(row.nid);
      const url = links.get(row.nid) || old?.url || null;
      if (!force && old?.czib && old.updatedAt === row.updatedAt) {
        bulletins.push({ ...old, status: row.status, active: row.active });
        continue;
      }
      if (!url) { errors.push(`${row.nid}: no link`); bulletins.push(old ? { ...old } : buildCzibBulletin(row, null, null)); continue; }
      if (fetched) await sleep(CZIB_DETAIL_PAUSE_MS);
      fetched += 1;
      try {
        const page = await fetchCapped(fetchImpl, url, { maxBytes: CZIB_PAGE_MAX_BYTES, headers: { Accept: 'text/html' } });
        if (!page.res.ok) throw new Error(`HTTP ${page.res.status}`);
        bulletins.push(buildCzibBulletin(row, parseCzibDetail(page.body), url));
      } catch (error) {
        errors.push(`${row.nid}: ${error?.message || error}`);
        bulletins.push(old ? { ...old } : buildCzibBulletin(row, null, url));
      }
    }
    await writeJsonAtomic(czibFile(root), {
      kind: 'czib', fetchedAt: nowMs, source: CZIB_LIST_URL, attribution: CZIB_ATTRIBUTION, bulletins,
    });
    log(`[mideast-events] czib: ${bulletins.length} active bulletins (${fetched} pages fetched${errors.length ? `, ${errors.length} errors` : ''})`);
    return { status: errors.length ? 'partial' : 'updated', count: bulletins.length, fetched, day: dayKey(nowMs), errors };
  } catch (error) {
    const message = String(error?.message || error);
    log(`[mideast-events] czib failed: ${message}`);
    return { status: prev ? 'stale' : 'error', count: prevList.length, error: message };
  }
}

/**
 * Hranice FIR z VATSpy (CC BY-SA 4.0) → `fir-boundaries.json` = { kód: polygóny } len základných
 * FIR (bez sektorov), súradnice na 0,001°. Raz za 7 dní; pri chybe ostáva starý súbor. Nikdy nehádže.
 */
export async function firBoundariesRefresh(root, { fetchImpl = fetch, now = Date.now(), force = false, log = () => {} } = {}) {
  const nowMs = nowToMs(now);
  if (!Number.isFinite(nowMs)) return { status: 'error', count: 0, error: `bad now '${String(now)}'` };
  const prev = await readJson(firFile(root));
  const prevCount = prev?.firs ? Object.keys(prev.firs).length : 0;
  if (!force && prevCount && nowMs - (Number(prev.fetchedAt) || 0) < FIR_FRESH_MS) return { status: 'fresh', count: prevCount };
  try {
    const { res, body } = await fetchCapped(fetchImpl, VATSPY_BOUNDARIES_URL, { timeoutMs: 90_000, maxBytes: FIR_BOUNDARIES_MAX_BYTES, headers: { Accept: 'application/geo+json,application/json' } });
    if (!res.ok) throw new Error(`VATSpy HTTP ${res.status}`);
    let geojson;
    try { geojson = JSON.parse(body); } catch { throw new Error('VATSpy: invalid JSON'); }
    const index = indexFirBoundaries(geojson);
    // Poistka proti orezanému či inému súboru: svet má stovky FIR, nie desiatky.
    if (index.size < 100) throw new Error(`VATSpy: only ${index.size} FIRs`);
    await writeJsonAtomic(firFile(root), {
      kind: 'fir-boundaries', fetchedAt: nowMs, source: VATSPY_BOUNDARIES_URL, attribution: FIR_ATTRIBUTION, license: FIR_LICENSE,
      firs: Object.fromEntries(index),
    });
    log(`[mideast-events] fir boundaries: ${index.size} FIRs`);
    return { status: 'updated', count: index.size };
  } catch (error) {
    const message = String(error?.message || error);
    log(`[mideast-events] fir boundaries failed: ${message}`);
    return { status: prevCount ? 'stale' : 'error', count: prevCount, error: message };
  }
}

/**
 * Telo `/api/mideast/events/airspace`: aktívne bulletiny (s príznakom `lapsed`, keď uplynul
 * dátum platnosti) + polygóny len tých FIR, ktoré bulletiny menujú (každý kód raz) + kódy
 * bez hranice v VATSpy (`missingFirs` — napr. UIR Kyjev). Bez snímky bulletinov null.
 */
export async function airspacePayload(root, { nowMs = Date.now() } = {}) {
  const czib = await readJson(czibFile(root));
  if (!czib || !Array.isArray(czib.bulletins)) return null;
  const fir = await readJson(firFile(root));
  const firs = {};
  const missingFirs = [];
  for (const b of czib.bulletins) {
    for (const code of Array.isArray(b.firs) ? b.firs : []) {
      if (firs[code] || missingFirs.includes(code)) continue;
      if (fir?.firs?.[code]) firs[code] = fir.firs[code]; else missingFirs.push(code);
    }
  }
  return {
    source: CZIB_LIST_URL, attribution: CZIB_ATTRIBUTION, firAttribution: FIR_ATTRIBUTION, firLicense: FIR_LICENSE,
    generatedAt: nowMs, fetchedAt: czib.fetchedAt ?? null, boundariesAt: fir?.fetchedAt ?? null,
    bulletins: czib.bulletins.map((b) => ({ ...b, lapsed: czibLapsed(b, nowMs) })),
    firs, missingFirs,
  };
}

// ── ukmto/ — incidenty lodí z rozhrania UKMTO (etapa 5c, 2026-10-03) ────────────
/**
 * Rozhranie UKMTO sa pýta raz za štvrťhodinu (vlastník 2026-10-03: „žiadne oneskorovanie, skôr
 * najaktuálnejšie" — pôvodne hodina). Čerstvosť je o minútu kratšia než tik úlohy, aby každý
 * tik naozaj stiahol; jeden ľahký dopyt = 96 denne.
 */
export const UKMTO_FRESH_MS = 14 * 60_000;
export const UKMTO_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Záložný prenos cez `node:https` s tým istým rozhraním ako `fetch` (stačí na `fetchCapped`).
 * Rozhranie UKMTO stojí za Cloudflare a podľa odtlačku klienta vracia 403: zmerané 2026-10-03
 * z toho istého stroja a s tou istou hlavičkou User-Agent — Node 24 `fetch` 403 a `https` 200,
 * Node 22 naopak, curl 200. Preto sa pri 403 skúsi ešte tento druhý ŠTANDARDNÝ klient; nič sa
 * nepredstiera (žiadny falošný prehliadač), User-Agent ostáva náš s kontaktom, a keď neprejde
 * ani jeden, archív ostáva a skúsi sa o hodinu.
 */
export function httpsFetch(url, { headers = {}, signal = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, signal: signal || undefined }, (res) => {
      const chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        total += chunk.length;
        if (total > 16 * 1024 * 1024) { req.destroy(new Error('too large')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const status = Number(res.statusCode) || 502;
        // Response nepripúšťa telo pri 204/304 — tie tu nečakáme, pre istotu bez tela.
        const body = status === 204 || status === 304 ? null : Buffer.concat(chunks, total);
        resolve(new Response(body, { status, headers: { 'content-type': String(res.headers['content-type'] || '') } }));
      });
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}
export const ukmtoDir = (root) => path.join(archiveDir(root), 'ukmto');
export const ukmtoFile = (root) => path.join(ukmtoDir(root), 'incidents.json');

/**
 * Stiahne incidenty UKMTO a ZLÚČI ich s archívom: rozhranie drží len približne posledné tri
 * mesiace, archív ich necháva všetky (rovnaké id = novší záznam vyhrá — UKMTO varovania dopĺňa).
 * Prázdne pole je platná odpoveď (pokoj na mori) a archív nemaže. Pri chybe ostáva starý archív
 * (`stale`), bez neho `error`. Nikdy nehádže.
 * @returns {Promise<{status:'updated'|'fresh'|'stale'|'error', count:number, fetched?:number, added?:number, lastT?:number|null, day?:string|null, error?:string}>}
 */
export async function ukmtoRefresh(root, { fetchImpl = fetch, altFetchImpl = httpsFetch, now = Date.now(), force = false, log = () => {} } = {}) {
  const nowMs = nowToMs(now);
  if (!Number.isFinite(nowMs)) return { status: 'error', count: 0, error: `bad now '${String(now)}'` };
  const prev = await readJson(ukmtoFile(root));
  const prevList = Array.isArray(prev?.incidents) ? prev.incidents : [];
  const lastOf = (list) => (list.length ? list[0].t : null);
  if (!force && prev && nowMs - (Number(prev.fetchedAt) || 0) < UKMTO_FRESH_MS) {
    return { status: 'fresh', count: prevList.length, lastT: lastOf(prevList), day: lastOf(prevList) ? dayKey(lastOf(prevList)) : null };
  }
  try {
    const request = { maxBytes: UKMTO_MAX_BYTES, headers: { Accept: 'application/json' } };
    let { res, body } = await fetchCapped(fetchImpl, UKMTO_API_URL, request);
    // 403 od Cloudflare podľa odtlačku klienta → jeden pokus druhým štandardným klientom (httpsFetch).
    if (res.status === 403 && typeof altFetchImpl === 'function') {
      log('[mideast-events] ukmto: HTTP 403 — trying the second transport');
      ({ res, body } = await fetchCapped(altFetchImpl, UKMTO_API_URL, request));
    }
    if (!res.ok) throw new Error(`UKMTO HTTP ${res.status}`);
    let json;
    try { json = JSON.parse(body); } catch { throw new Error('UKMTO: invalid JSON'); }
    const fetched = parseUkmtoIncidents(json);
    const incidents = mergeUkmtoIncidents(prevList, fetched);
    const known = new Set(prevList.map((it) => it.id));
    const added = fetched.filter((it) => !known.has(it.id)).length;
    await writeJsonAtomic(ukmtoFile(root), {
      kind: 'ukmto', fetchedAt: nowMs, source: UKMTO_SITE_URL, attribution: UKMTO_ATTRIBUTION, license: UKMTO_LICENSE, licenseUrl: UKMTO_LICENSE_URL, incidents,
    });
    log(`[mideast-events] ukmto: ${incidents.length} incidents in archive (${fetched.length} fetched, ${added} new)`);
    return { status: 'updated', count: incidents.length, fetched: fetched.length, added, lastT: lastOf(incidents), day: lastOf(incidents) ? dayKey(lastOf(incidents)) : null };
  } catch (error) {
    const message = String(error?.message || error);
    log(`[mideast-events] ukmto failed: ${message}`);
    return { status: prev ? 'stale' : 'error', count: prevList.length, lastT: lastOf(prevList), error: message };
  }
}

/**
 * Telo `/api/mideast/events/ukmto`: incidenty za posledných `days` dní (najnovšie prvé) + počet
 * a rozsah celého archívu. Bez archívu null (volajúci vráti 404).
 */
export async function ukmtoPayload(root, { days = 90, nowMs = Date.now() } = {}) {
  const snap = await readJson(ukmtoFile(root));
  if (!snap || !Array.isArray(snap.incidents)) return null;
  const since = nowMs - Math.max(1, Math.floor(days)) * DAY_MS;
  return {
    source: UKMTO_SITE_URL, attribution: UKMTO_ATTRIBUTION, license: UKMTO_LICENSE, licenseUrl: UKMTO_LICENSE_URL,
    generatedAt: nowMs, fetchedAt: snap.fetchedAt ?? null, days: Math.max(1, Math.floor(days)),
    archived: snap.incidents.length, firstT: snap.incidents.length ? snap.incidents.at(-1).t : null,
    incidents: snap.incidents.filter((it) => it.t >= since),
  };
}

// ── gps/ — rušenie GPS odvodené z presnosti polohy lietadiel (etapa 5d, 2026-10-03) ──
/** Pauza medzi kruhmi: adsb.lol vracia 429 pri dávke a tú istú adresu používajú aj vojenské lety OKO. */
export const GPS_CIRCLE_PAUSE_MS = 5_000;
/** Po 429 jeden nový pokus o ten istý kruh po tomto čase; potom sa kruh v tomto kole vynechá. */
/** Už sa nepoužíva (2026-10-30: po 429 sa neopakuje — adsb.fi chyby počíta, adsb.lol drží pauzu dňa). */
export const GPS_RETRY_AFTER_429_MS = 12_000;
export const GPS_MAX_BYTES = 6 * 1024 * 1024;
/** Najviac toľko dní dozadu vracia trasa (okno mapy). */
export const GPS_MAX_DAYS = 7;
export const gpsDir = (root) => path.join(archiveDir(root), 'gps');
/** Výsledok uzavretého dňa (bez adries lietadiel). */
export const gpsDayFile = (root, day) => path.join(gpsDir(root), `${day}.json`);
/** Rozpracovaný deň (adresy lietadiel po bunkách kvôli jedinečnosti; po uzavretí dňa sa maže). */
export const gpsWorkFile = (root, day) => path.join(gpsDir(root), `${day}.work.json`);

/** Uzavrie rozpracované dni staršie než `today`: zapíše výsledok bez adries a pracovný súbor zmaže. */
async function gpsCloseOldDays(root, today, log) {
  let names = [];
  try { names = await fsp.readdir(gpsDir(root)); } catch { return 0; }
  let closed = 0;
  for (const name of names) {
    const m = /^(\d{4}-\d{2}-\d{2})\.work\.json$/.exec(name);
    if (!m || m[1] >= today) continue;
    const work = await readJson(gpsWorkFile(root, m[1]));
    if (work && work.cells) {
      await writeJsonAtomic(gpsDayFile(root, m[1]), { ...gpsFinalizeDay({ ...work, day: m[1] }), kind: 'gps-day', attribution: GPS_ATTRIBUTION, license: GPS_LICENSE });
      closed += 1;
      log(`[mideast-events] gps: day ${m[1]} closed`);
    }
    try { await fsp.unlink(gpsWorkFile(root, m[1])); } catch { /* už zmazaný */ }
  }
  return closed;
}

/**
 * Jedno kolo zberu: šesť kruhov postupne s pauzou, lietadlá sa pridajú do rozpracovaného dňa (UTC).
 * Zdroj kruhu (2026-10-30): adsb.fi hlavný; keď zlyhá, adsb.lol len ak to dovolí denný rozpočet (druh `gps`,
 * adsbLolBudget.js — 500 dopytov na IP, zber bol predtým 576 denne sám). Žiadne opakovanie po 429 (chyby sa
 * adsb.fi počítajú, adsb.lol po 429 drží pauzu do resetu dňa). Kruh bez odpovede sa v kole vynechá — kolo sa
 * zapíše, keď prešiel aspoň jeden. Staršie rozpracované dni sa uzavrú. Nikdy nehádže.
 * @returns {Promise<{status:'updated'|'partial'|'error', day:string, circles:number, failed:string[], samples:number, degraded:number, snapshots:number}>}
 */
export async function gpsCollect(root, { fetchImpl = fetch, now = Date.now(), log = () => {}, sleep = defaultSleepMs, circles = GPS_CIRCLES, budget = adsbLolBudget } = {}) {
  const nowMs = nowToMs(now);
  if (!Number.isFinite(nowMs)) return { status: 'error', day: null, circles: 0, failed: ['bad now'], samples: 0, degraded: 0, snapshots: 0 };
  const day = dayKey(nowMs);
  const aircraft = [];
  const failed = [];
  let ok = 0;
  /** Koľko kruhov dal ktorý zdroj (log, výsledok). */
  const sources = {};
  for (const [i, circle] of circles.entries()) {
    if (i) await sleep(GPS_CIRCLE_PAUSE_MS);
    const request = { timeoutMs: 30_000, maxBytes: GPS_MAX_BYTES, headers: { Accept: 'application/json' } };
    const errors = [];
    const okBefore = ok;
    for (const provider of GPS_PROVIDERS) {
      const budgeted = provider === 'adsb.lol';
      if (budgeted && !budget?.allow?.('gps')) { errors.push('adsb.lol: budget'); continue; }
      try {
        if (budgeted) budget.spend('gps');
        let res; let body;
        try {
          ({ res, body } = await fetchCapped(fetchImpl, gpsCircleUrl(circle, provider), request));
        } catch (error) {
          if (budgeted) budget.record('gps', { error: true });
          throw error;
        }
        if (budgeted) budget.record('gps', { status: res.status, headers: res.headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        let json;
        try { json = JSON.parse(body); } catch { throw new Error('invalid JSON'); }
        if (!Array.isArray(json?.ac)) throw new Error('no ac array');
        aircraft.push(...json.ac);
        sources[provider] = (sources[provider] || 0) + 1;
        ok += 1;
        break;
      } catch (error) {
        errors.push(`${provider}: ${String(error?.message || error)}`);
      }
    }
    if (ok === okBefore) failed.push(`${circle.id}: ${errors.join(', ')}`);
  }
  try { await gpsCloseOldDays(root, day, log); } catch (error) { log(`[mideast-events] gps close failed: ${error?.message || error}`); }
  if (!ok) {
    log(`[mideast-events] gps: no circle answered (${failed.join('; ')})`);
    return { status: 'error', day, circles: 0, failed, samples: 0, degraded: 0, snapshots: 0 };
  }
  const prev = await readJson(gpsWorkFile(root, day));
  const work = prev && prev.day === day && prev.cells && typeof prev.cells === 'object' ? prev : gpsEmptyDay(day);
  const { samples, degraded } = gpsAddSnapshot(work, aircraft);
  await writeJsonAtomic(gpsWorkFile(root, day), work);
  const via = Object.entries(sources).map(([name, n]) => `${name} ${n}`).join(', ');
  log(`[mideast-events] gps ${day}: snapshot ${work.snapshots} · ${samples} aircraft, ${degraded} with degraded accuracy · ${via}${failed.length ? ` · failed ${failed.length}/${circles.length}` : ''}`);
  return { status: failed.length ? 'partial' : 'updated', day, circles: ok, failed, samples, degraded, snapshots: work.snapshots, sources };
}

/**
 * Telo `/api/mideast/events/gps`: bunky za posledných `days` dní (uzavreté dni + rozpracovaný
 * dnešok prepočítaný bez adries) so stupňom, počty buniek podľa stupňa, obdobie, počet snímok.
 * Bez jediného dňa null (volajúci vráti 404).
 */
export async function gpsPayload(root, { days = 2, nowMs = Date.now() } = {}) {
  const n = Math.min(GPS_MAX_DAYS, Math.max(1, Math.floor(days)));
  const today = dayKey(nowMs);
  const list = [];
  for (let back = 0; back < n; back += 1) {
    const day = dayKey(nowMs - back * DAY_MS);
    let data = await readJson(gpsDayFile(root, day));
    if (!data) {
      const work = await readJson(gpsWorkFile(root, day));
      if (work && work.cells) data = { ...gpsFinalizeDay({ ...work, day }), partial: day === today };
    }
    if (data && Array.isArray(data.cells)) list.push(data);
  }
  if (!list.length) return null;
  const merged = gpsMergeDays(list);
  return {
    source: 'https://api.adsb.lol', attribution: GPS_ATTRIBUTION, license: GPS_LICENSE,
    generatedAt: nowMs, cellDeg: GPS_CELL_DEG, requestedDays: n,
    days: merged.days, snapshots: merged.snapshots, aircraft: merged.aircraft,
    todayPartial: list.some((d) => d.partial),
    thresholds: { low: GPS_LOW, high: GPS_HIGH, minAircraft: GPS_MIN_AIRCRAFT },
    circles: GPS_CIRCLES.map((c) => ({ id: c.id, lat: c.lat, lon: c.lon, nm: c.nm })),
    counts: merged.counts,
    cells: merged.cells.map((c) => [c.latIdx, c.lonIdx, c.total, c.bad, c.badAdjusted, c.level]),
  };
}

// ── geoconfirmed/ + ucdp/ — overené udalosti (etapa 4, 2026-11-05) ─────────────
// GeoConfirmed po konfliktoch (Iran, israel, Yemen, Syria) a po dňoch; UCDP Candidate po
// mesiacoch. Model, etický filter a dedup: src/data/mideastIncidents.js. Žiadne oneskorovanie
// zverejnenia (rozhodnutie vlastníka 2026-10-03 a 2026-11-05) — deň sa ukáže hneď, ako ho zdroj má.
/** Obnova najviac raz za ~6 h (tik úlohy 6 h; o 5 min kratšia, aby každý tik naozaj stiahol). */
export const GEOCONFIRMED_FRESH_MS = 6 * 3_600_000 - 5 * 60_000;
/** Strop tela exportu jedného konfliktu (Irán od 28. 2. ≈ 1,4 MB). */
export const GEOCONFIRMED_MAX_BYTES = 40 * 1024 * 1024;
/** Pauza medzi konfliktmi v jednom tiku (zdvorilosť k verejnému API). */
export const GEOCONFIRMED_PAUSE_MS = 2_000;
/** UCDP Candidate: kontrola nového mesačného súboru raz za deň. */
export const UCDP_FRESH_MS = 24 * 3_600_000 - 5 * 60_000;
/** Strop jedného mesačného súboru UCDP (celý svet ≈ 1,6 MB). */
export const UCDP_MAX_BYTES = 30 * 1024 * 1024;
export const UCDP_PAUSE_MS = 2_000;
export const geoconfirmedDir = (root, slug) => path.join(archiveDir(root), 'geoconfirmed', String(slug));
export const geoconfirmedDayFile = (root, slug, day) => path.join(geoconfirmedDir(root, slug), `${day}.json`);
/** Stav konfliktu: posledná obnova, okno, počty riadkov a zahodených podľa dôvodu, prvé naplnenie. */
export const geoconfirmedMetaFile = (root, slug) => path.join(geoconfirmedDir(root, slug), '_meta.json');
export const ucdpDir = (root) => path.join(archiveDir(root), 'ucdp');
export const ucdpMonthFile = (root, month) => path.join(ucdpDir(root), `${month}.json`);
export const ucdpMetaFile = (root) => path.join(ucdpDir(root), '_meta.json');
export const isGeoconfirmedSlug = (slug) => typeof slug === 'string' && GEOCONFIRMED_SLUGS.includes(slug);

/**
 * Obnoví archív konfliktu GeoConfirmed: bez prvého naplnenia (meta `backfilledFrom`) JEDEN dopyt
 * od 28. 2. 2026 po dnešok, potom rolujúce okno posledných 30 dní. Každý deň okna sa zapíše
 * (aj prázdny), aby bolo pokrytie známe; staršie dni ostávajú, ako boli. Odpoveď, ktorá nie je
 * CSV exportu (chýba hlavička s `Date;`), je chyba — archív ostáva (`stale`). Nikdy nehádže.
 * @param {string} root
 * @param {string} slug 'iran' | 'israel' | 'yemen' | 'syria'
 * @returns {Promise<{status:'updated'|'fresh'|'stale'|'error', conflict:string, from?:string, to?:string, days?:number, count:number, rows?:number, dropped?:Record<string,number>, backfill?:boolean, error?:string}>}
 */
export async function geoconfirmedRefresh(root, slug, { fetchImpl = fetch, now = Date.now(), force = false, log = () => {} } = {}) {
  if (!isGeoconfirmedSlug(slug)) return { status: 'error', conflict: String(slug), count: 0, error: `unknown conflict '${slug}' (${GEOCONFIRMED_SLUGS.join(', ')})` };
  const nowMs = nowToMs(now);
  if (!Number.isFinite(nowMs)) return { status: 'error', conflict: slug, count: 0, error: `bad now '${String(now)}'` };
  const meta = await readJson(geoconfirmedMetaFile(root, slug));
  if (!force && meta && nowMs - (Number(meta.fetchedAt) || 0) < GEOCONFIRMED_FRESH_MS) {
    return { status: 'fresh', conflict: slug, count: Number(meta.count) || 0, from: meta.window?.[0], to: meta.window?.[1] };
  }
  const to = dayKey(nowMs);
  const backfill = !meta?.backfilledFrom;
  const from = backfill
    ? MIDEAST_INCIDENTS_FIRST_DAY
    : dayKey(Math.max(dayToMs(MIDEAST_INCIDENTS_FIRST_DAY), dayToMs(to) - (MIDEAST_INCIDENTS_ROLLING_DAYS - 1) * DAY_MS));
  const url = geoconfirmedExportUrl(slug, from, to);
  try {
    const { res, body } = await fetchCapped(fetchImpl, url, { timeoutMs: 120_000, maxBytes: GEOCONFIRMED_MAX_BYTES, headers: { Accept: 'text/csv' } });
    if (!res.ok) throw new Error(`GeoConfirmed HTTP ${res.status}`);
    if (!/^﻿?\s*Date;/.test(body)) throw new Error('GeoConfirmed: not a CSV export');
    const parsed = parseGeoconfirmedIncidents(body, { conflict: slug });
    const byDay = new Map();
    for (let t = dayToMs(from); t <= dayToMs(to); t += DAY_MS) byDay.set(dayKey(t), []);
    for (const it of parsed.incidents) if (byDay.has(it.day)) byDay.get(it.day).push(it);
    for (const [day, items] of byDay) {
      await writeJsonAtomic(geoconfirmedDayFile(root, slug, day), { day, kind: 'geoconfirmed', conflict: slug, fetchedAt: nowMs, window: [from, to], items });
    }
    const count = parsed.incidents.length;
    const stats = { rows: parsed.rows, kept: count, dropped: parsed.dropped };
    await writeJsonAtomic(geoconfirmedMetaFile(root, slug), {
      kind: 'geoconfirmed-meta', conflict: slug, fetchedAt: nowMs, window: [from, to], count, ...stats,
      backfilledFrom: meta?.backfilledFrom || from,
      backfill: backfill ? { at: nowMs, ...stats } : (meta?.backfill || null),
      source: geoconfirmedExportUrl(slug, '…', '…').replace(/\?.*$/, ''), attribution: GEOCONFIRMED_MIDEAST_ATTRIBUTION, license: GEOCONFIRMED_LICENSE,
    });
    const dropText = Object.entries(parsed.dropped).map(([k, v]) => `${k} ${v}`).join(', ');
    log(`[mideast-events] geoconfirmed ${slug} ${from}..${to}: ${count} incidents of ${parsed.rows} rows${dropText ? ` (dropped: ${dropText})` : ''}${backfill ? ' — first fill' : ''}`);
    return { status: 'updated', conflict: slug, from, to, days: byDay.size, count, rows: parsed.rows, dropped: parsed.dropped, backfill };
  } catch (error) {
    const message = String(error?.message || error);
    log(`[mideast-events] geoconfirmed ${slug} failed: ${message}`);
    return { status: meta ? 'stale' : 'error', conflict: slug, count: Number(meta?.count) || 0, error: message };
  }
}

/** Mesiace od `fromMonth` po `toMonth` vrátane ('YYYY-MM'). Pure. */
export function monthList(fromMonth, toMonth) {
  const out = [];
  let [y, m] = String(fromMonth).split('-').map(Number);
  const [ty, tm] = String(toMonth).split('-').map(Number);
  if (![y, m, ty, tm].every(Number.isFinite)) return out;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/**
 * UCDP Candidate po mesiacoch od februára 2026 (mesiac 28. 2.) po minulý mesiac: chýbajúci
 * mesiac sa stiahne (jeden súbor celého sveta, uložia sa len krajiny regiónu), 404 znamená
 * „ešte nevyšiel" a ďalšie mesiace sa v tomto behu nepýtajú. Uložený mesiac sa nesťahuje znova.
 * Kontrola raz za deň (meta `checkedAt`). Nikdy nehádže.
 * @returns {Promise<{status:'updated'|'fresh'|'partial'|'error', months:string[], fetched:string[], missing:string|null, count:number, errors?:string[]}>}
 */
export async function ucdpRefresh(root, { fetchImpl = fetch, now = Date.now(), force = false, log = () => {}, sleep = defaultSleepMs } = {}) {
  const nowMs = nowToMs(now);
  if (!Number.isFinite(nowMs)) return { status: 'error', months: [], fetched: [], missing: null, count: 0, errors: [`bad now '${String(now)}'`] };
  const meta = await readJson(ucdpMetaFile(root));
  const have = async () => {
    let names = [];
    try { names = await fsp.readdir(ucdpDir(root)); } catch { /* prázdny archív */ }
    return names.filter((n) => /^\d{4}-\d{2}\.json$/.test(n)).map((n) => n.slice(0, 7)).sort();
  };
  if (!force && meta && nowMs - (Number(meta.checkedAt) || 0) < UCDP_FRESH_MS) {
    return { status: 'fresh', months: await have(), fetched: [], missing: meta.missing || null, count: Number(meta.count) || 0 };
  }
  const today = new Date(nowMs);
  const lastMonthMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1);
  const wanted = monthList(MIDEAST_INCIDENTS_FIRST_DAY.slice(0, 7), dayKey(lastMonthMs).slice(0, 7));
  const stored = new Set(await have());
  const fetched = [];
  const errors = [];
  let missing = null;
  for (const month of wanted) {
    if (stored.has(month) && !force) continue;
    if (fetched.length || errors.length) await sleep(UCDP_PAUSE_MS);
    const [year, mon] = month.split('-').map(Number);
    const url = ucdpCandidateUrl(year, mon);
    try {
      const { res, body } = await fetchCapped(fetchImpl, url, { timeoutMs: 120_000, maxBytes: UCDP_MAX_BYTES, headers: { Accept: 'text/csv' } });
      if (res.status === 404) { missing = month; break; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!/^﻿?"?id"?,/.test(body)) throw new Error('not a UCDP CSV');
      const parsed = parseUcdpIncidents(body);
      await writeJsonAtomic(ucdpMonthFile(root, month), {
        month, kind: 'ucdp', fetchedAt: nowMs, url, rows: parsed.rows, count: parsed.incidents.length, dropped: parsed.dropped,
        attribution: UCDP_ATTRIBUTION, license: UCDP_LICENSE, items: parsed.incidents,
      });
      fetched.push(month);
      log(`[mideast-events] ucdp ${month}: ${parsed.incidents.length} region events of ${parsed.rows} rows`);
    } catch (error) {
      errors.push(`${month}: ${String(error?.message || error)}`);
      log(`[mideast-events] ucdp ${month} failed: ${error?.message || error}`);
    }
  }
  const months = await have();
  let count = 0;
  for (const month of months) count += Number((await readJson(ucdpMonthFile(root, month)))?.count) || 0;
  await writeJsonAtomic(ucdpMetaFile(root), { kind: 'ucdp-meta', checkedAt: nowMs, months, missing, count, source: UCDP_PAGE, attribution: UCDP_ATTRIBUTION, license: UCDP_LICENSE });
  const status = errors.length ? (fetched.length || months.length ? 'partial' : 'error') : (fetched.length ? 'updated' : 'fresh');
  return { status, months, fetched, missing, count, errors };
}

/**
 * Udalosti okna dní (GeoConfirmed všetkých konfliktov + UCDP), po dedupe, voliteľne len
 * v obdĺžniku dejiska (+0,5°). `coverage` = koľko dní okna má súbor po konfliktoch a ktoré
 * mesiace UCDP sú v archíve. Pure voči sieti (len disk).
 */
async function incidentsInRange(root, from, to, { rect = null, ucdpCache = null } = {}) {
  const items = [];
  const coverage = { geoconfirmed: {}, ucdp: [] };
  for (const slug of GEOCONFIRMED_SLUGS) {
    let days = 0;
    for (let t = dayToMs(from); t <= dayToMs(to); t += DAY_MS) {
      const json = await readJson(geoconfirmedDayFile(root, slug, dayKey(t)));
      if (!json || !Array.isArray(json.items)) continue;
      days += 1;
      items.push(...json.items);
    }
    coverage.geoconfirmed[slug] = days;
  }
  for (const month of monthList(from.slice(0, 7), to.slice(0, 7))) {
    let json = ucdpCache?.get(month);
    if (json === undefined) { json = await readJson(ucdpMonthFile(root, month)); ucdpCache?.set(month, json); }
    if (!json || !Array.isArray(json.items)) continue;
    coverage.ucdp.push(month);
    for (const it of json.items) if (it.day >= from && it.day <= to) items.push(it);
  }
  const { incidents, duplicates } = dedupIncidents(items);
  const inside = rect ? incidents.filter((it) => inRect(it, rect)) : incidents;
  inside.sort((a, b) => b.t - a.t || (a.id < b.id ? -1 : 1));
  return { incidents: inside, duplicates, coverage };
}

const sourcesBlock = async (root) => {
  const metas = {};
  for (const slug of GEOCONFIRMED_SLUGS) {
    const m = await readJson(geoconfirmedMetaFile(root, slug));
    metas[slug] = m ? { fetchedAt: m.fetchedAt ?? null, window: m.window || null, count: m.count ?? null } : null;
  }
  const u = await readJson(ucdpMetaFile(root));
  return {
    geoconfirmed: { attribution: GEOCONFIRMED_MIDEAST_ATTRIBUTION, license: GEOCONFIRMED_LICENSE, site: GEOCONFIRMED_SITE, conflicts: metas },
    ucdp: { attribution: UCDP_ATTRIBUTION, license: UCDP_LICENSE, page: UCDP_PAGE, checkedAt: u?.checkedAt ?? null, months: u?.months || [] },
  };
};
const hasAnyArchive = (sources) => Object.values(sources.geoconfirmed.conflicts).some(Boolean) || sources.ucdp.months.length > 0;

/**
 * Telo `/api/mideast/events/incidents?from&to[&theatre]`: udalosti okna (≤ 31 dní, volajúci
 * stráži), najnovšie prvé, s pokrytím, počtom duplicít GC × UCDP a blokom zdrojov. Bez akéhokoľvek
 * archívu null (volajúci vráti 404).
 */
export async function incidentsPayload(root, { from, to, rect = null, theatre = null, nowMs = Date.now() } = {}) {
  const sources = await sourcesBlock(root);
  if (!hasAnyArchive(sources)) return null;
  const { incidents, duplicates, coverage } = await incidentsInRange(root, from, to, { rect });
  return {
    generatedAt: nowMs, from, to, theatre: theatre || null, sources, coverage, duplicates,
    counts: { total: incidents.length, geoconfirmed: incidents.filter((x) => x.src === 'geoconfirmed').length, ucdp: incidents.filter((x) => x.src === 'ucdp').length },
    incidents,
  };
}

/**
 * Telo `/api/mideast/events/incidents/summary?from&to[&theatre]`: počty po dňoch (len dni
 * s udalosťou: spolu, podľa zdroja, podľa druhu) pre jednoduchú os; okno ≤ 400 dní (volajúci
 * stráži). Bez archívu null.
 */
export async function incidentsSummaryPayload(root, { from, to, rect = null, theatre = null, nowMs = Date.now() } = {}) {
  const sources = await sourcesBlock(root);
  if (!hasAnyArchive(sources)) return null;
  const days = {};
  let total = 0;
  const byType = {};
  const ucdpCache = new Map();
  const coverage = { geoconfirmed: Object.fromEntries(GEOCONFIRMED_SLUGS.map((s) => [s, 0])), ucdp: new Set() };
  // Po kusoch 31 dní (dedup je v rámci dňa, kusy ho nerozbijú) — pamäť drží len jeden kus.
  for (let start = dayToMs(from); start <= dayToMs(to); start += 31 * DAY_MS) {
    const end = Math.min(dayToMs(to), start + 30 * DAY_MS);
    const part = await incidentsInRange(root, dayKey(start), dayKey(end), { rect, ucdpCache });
    for (const [slug, n] of Object.entries(part.coverage.geoconfirmed)) coverage.geoconfirmed[slug] += n;
    for (const m of part.coverage.ucdp) coverage.ucdp.add(m);
    for (const it of part.incidents) {
      const d = days[it.day] || (days[it.day] = { total: 0, geoconfirmed: 0, ucdp: 0, byType: {} });
      d.total += 1;
      d[it.src] = (d[it.src] || 0) + 1;
      d.byType[it.type] = (d.byType[it.type] || 0) + 1;
      byType[it.type] = (byType[it.type] || 0) + 1;
      total += 1;
    }
  }
  return { generatedAt: nowMs, from, to, theatre: theatre || null, sources, coverage: { geoconfirmed: coverage.geoconfirmed, ucdp: [...coverage.ucdp].sort() }, total, byType, days };
}

/** Lacný prehľad archívu udalostí pre /status (len meta súbory). */
export async function incidentsIndex(root) {
  const out = { geoconfirmed: {}, ucdp: null };
  for (const slug of GEOCONFIRMED_SLUGS) {
    const m = await readJson(geoconfirmedMetaFile(root, slug));
    out.geoconfirmed[slug] = m ? { fetchedAt: m.fetchedAt ?? null, count: m.count ?? 0, window: m.window || null, backfilledFrom: m.backfilledFrom || null } : null;
  }
  const u = await readJson(ucdpMetaFile(root));
  out.ucdp = u ? { checkedAt: u.checkedAt ?? null, months: u.months || [], count: u.count ?? 0, missing: u.missing || null } : null;
  return out;
}

export { dayKey, dayToMs, isDay } from './ukraineArchive.mjs';
