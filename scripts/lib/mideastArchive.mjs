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
// Ďalšie druhy (GeoConfirmed × 4 konflikty, UCDP, UKMTO, správy) prídu v ďalších
// etapách plánu vedľa tohto súboru v tom istom koreni.
//
// Z ukraineArchive.mjs sa berú LEN exportované primitívy (dni, disk, URL revízie).
// Sieťový obal s User-Agentom je vlastný: Wikimedia etiketa chce popisný UA
// s kontaktom, jeden dopyt naraz a pauzy medzi dopytmi (história po týždňoch).
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { dayKey, dayToMs, isDay, readJson, wikiRevisionUrl, writeJsonAtomic } from './ukraineArchive.mjs';
import { MIDEAST_CONTROL_MODULE_IDS, wikiControlModuleById, wikiControlPoints, wikiControlSummary } from '../../src/data/wikiControl.js';
import {
  PORTWATCH_ATTRIBUTION, PORTWATCH_DATASET_URL, PORTWATCH_FIRST_DAY, PORTWATCH_KEYS, PORTWATCH_LICENSE, PORTWATCH_PAGE_SIZE, PW,
  meanOver, mergePortwatchRows, parsePortwatchFeatures, portwatchChokepoint, portwatchQueryUrl,
} from '../../src/data/portwatch.js';

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

export { dayKey, dayToMs, isDay } from './ukraineArchive.mjs';
