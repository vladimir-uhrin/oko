// src/data/volbyService.js
/**
 * @module volbyService
 * @description Server sekcie VOĹBY 2026 (2026-10-24): GET /api/volby/* — kandidáti z registra MV SR,
 * číselníky a (po 20:00) výsledkové tabuľky ŠÚ SR z volbysr.sk. Len Node (služba oko-api; vo
 * vývojovom serveri v role proxy sa preposiela ako ostatné /api).
 *
 * Zdroje (verejné informácie, bez kľúča):
 *  - MV SR, register kandidátov (29. 9. 2026): 4 XLSX, ~3 MB spolu — menia sa nanajvýš pri
 *    vzdaní kandidatúry, TTL 12 h, podmienené sťahovanie (ETag / Last-Modified);
 *  - ŠÚ SR, volbysr.sk: ZIP s XLSX tabuľkami pre obce (OSO) a kraje (OSK). Pred 20:00 sú v ňom
 *    číselníky (územné členenie, strany), po 20:00 pribudnú tabuľky výsledkov — TTL 2 h pred
 *    zatvorením miestností, 3 min počas sčítavania (ZIP má ~150 kB, podmienené sťahovanie).
 * Disk: .gev-cache/volby/ (surové súbory + meta), aby reštart služby nič znova nesťahoval a aby
 * sa pri výpadku zdroja podával posledný známy stav (označený `stale`). Model v pamäti sa stavia
 * z toho, čo je k dispozícii: bez ŠÚ SR ostanú kandidáti s náhradnými kódmi obcí, bez MV SR
 * ostane posledný model. Odpovede nesú `generatedAt`, `sources` a fázu dňa — UI ich ukazuje.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZipEntries } from './zipEntries.js';
import { readXlsxRows, readXlsxSheets, tableByHeader } from './xlsxSheet.js';
import { POLLS_CLOSE_MS, buildModel, krajDetail, obecDetail, overview, searchObce } from './volbyCandidates.js';
import { buildResults, obecMapState, resultsOverview } from './volbyResults.js';
import { createVolbyLive } from './volbyLive.js';
import { createVolbyObceSweep, volbyRecords } from './volbyObceSweep.js';
import { cardPage, overviewPage, renderCardJpeg, renderOverviewJpeg } from './volbyCard.js';
import { buildPaths } from '../../scripts/lib/volbyPages.mjs';
import { upstream } from './upstreamStatus.js';

export const VOLBY_PATH = '/api/volby';
export const USER_AGENT = 'OKO-okolive.sk/1.0 (+https://okolive.sk)';
const MINV_BASE = 'https://www.minv.sk/swift_data/source/verejna_sprava/volby_a_referendum/';
/** Register kandidátov MV SR: súbor → URL a hlavičky, podľa ktorých sa v liste nájde tabuľka. */
export const MINV_SOURCES = Object.freeze({
  predseda: Object.freeze({ url: `${MINV_BASE}140_vuc/VUC26_ZZK-Predseda.xlsx`, headers: ['Kraj', 'Poradové číslo kandidáta', 'Meno', 'Priezvisko'] }),
  zupni: Object.freeze({ url: `${MINV_BASE}140_vuc/VUC26_ZZK-Poslanci.xlsx`, headers: ['Kraj', 'Volebný obvod', 'Meno', 'Priezvisko'] }),
  starosta: Object.freeze({ url: `${MINV_BASE}150_oso/OSO26_ZZK-Starosta.xlsx`, headers: ['Okres', 'Obec', 'Meno', 'Priezvisko', 'Kód okresu'] }),
  poslanci: Object.freeze({ url: `${MINV_BASE}150_oso/OSO26_ZZK-Poslanci.xlsx`, headers: ['Okres', 'Obec', 'Volebný obvod', 'Meno', 'Priezvisko'] }),
});
export const MINV_PAGE_URL = 'https://www.minv.sk/?samosprava26-info10';
/** ZIPy ŠÚ SR (volbysr.sk): obce (OSO) a samosprávne kraje (OSK). */
export const SUSR_SOURCES = Object.freeze({
  oso: 'https://volbysr.sk/oso/files/OSO2026_SK_xlsx.zip',
  osk: 'https://volbysr.sk/osk/files/OSK2026_SK_xlsx.zip',
});
export const SUSR_PAGE_URL = 'https://volbysr.sk/';
/** Číselníky ŠÚ SR potrebné pre model: kľúč modelu → názov tabuľky v ZIPe a hlavičky. */
export const SUSR_CODE_TABLES = Object.freeze({
  uzemie: Object.freeze({ table: 'OSO2026_SK_tab0dd', headers: ['Kód okresu', 'Kód obce', 'Názov obce'] }),
  mesta: Object.freeze({ table: 'OSO2026_SK_tab0dx', headers: ['Kód mesta', 'Názov mesta'] }),
  obvodyKraj: Object.freeze({ table: 'OSK2026_SK_tab0db', headers: ['Kód kraja', 'Kód volebného obvodu'] }),
  obceObvody: Object.freeze({ table: 'OSK2026_SK_tab0dc', headers: ['Kód volebného obvodu', 'Kód obce'] }),
});
export const MINV_TTL_MS = 12 * 3600_000;
export const SUSR_TTL_BEFORE_MS = 2 * 3600_000;
export const SUSR_TTL_COUNTING_MS = 3 * 60_000;
/** Pol hodiny pred zatvorením miestností už ŠÚ SR sledujeme často — štruktúra tabuliek môže pribudnúť skôr. */
export const SUSR_WATCH_LEAD_MS = 30 * 60_000;
export const FETCH_TIMEOUT_MS = 30_000;
export const TABLE_ROW_LIMIT = 5000;
const DEFAULT_GEO_PATH = fileURLToPath(new URL('./local_data/volby/obce-geo.json', import.meta.url));

/** TTL ZIPov ŠÚ SR podľa fázy dňa. Pure. */
export function susrTtlMs(nowMs) {
  return nowMs >= POLLS_CLOSE_MS - SUSR_WATCH_LEAD_MS ? SUSR_TTL_COUNTING_MS : SUSR_TTL_BEFORE_MS;
}

/** Je to tabuľka výsledkov (nie číselník `tab0c`, `tab0d*`, `tab_info`)? Pure. */
export function isResultsTable(name) {
  return /_tab\d{2}[a-z]?$/i.test(String(name || '')) && !/_tab0[cd]/i.test(String(name || ''));
}

/**
 * ZIP ŠÚ SR → tabuľky podľa mena súboru (bez .xlsx): { name, title, sheets }. Titulky dáva list
 * `*_tab_info` (Názov súboru → Názov tabuľky).
 * @param {Buffer} buffer
 * @returns {Map<string, {name: string, title: string|null, sheets: Array<{name: string, rows: Array<Array<string|null>>}>}>}
 */
export function parseSusrZip(buffer) {
  const tables = new Map();
  for (const entry of readZipEntries(buffer)) {
    const m = /([^/\\]+)\.xlsx$/i.exec(entry.name);
    if (!m) continue;
    tables.set(m[1], { name: m[1], title: null, sheets: readXlsxSheets(entry.read()) });
  }
  for (const t of tables.values()) {
    if (!/_tab_info$/i.test(t.name)) continue;
    const info = tableByHeader(t.sheets[0]?.rows || [], ['Názov súboru', 'Názov tabuľky']);
    for (const r of info?.records || []) {
      const target = tables.get(String(r['Názov súboru'] ?? '').trim());
      if (target) target.title = String(r['Názov tabuľky'] ?? '').trim() || null;
    }
  }
  return tables;
}

/**
 * Celé spracovanie stiahnutých súborov: XLSX MV SR → kandidáti, ZIPy ŠÚ SR → tabuľky a číselníky, model, výsledky.
 * Beží v hlavnom vlákne (testy) alebo vo workeri (src/data/volbyWorker.js). Pure: vstup = buffre, výstup = dáta.
 * @param {{ minv: Record<string, Uint8Array|null>, susr: Record<string, Uint8Array|null>, geo: Array, nowMs: number }} input
 * @returns {{ model: object|null, tables: Map, results: object|null, parseErrors: Record<string, string> }}
 */
export function processSources({ minv = {}, susr = {}, geo = [], nowMs = Date.now() } = {}) {
  const parseErrors = {};
  const tables = {};
  for (const [key, src] of Object.entries(MINV_SOURCES)) {
    const buf = minv[key];
    if (!buf) continue;
    try { tables[key] = tableByHeader(readXlsxRows(Buffer.from(buf)), src.headers)?.records || []; } catch (error) { parseErrors[`minv.${key}`] = `parse: ${error?.message}`; }
  }
  const susrTables = new Map();
  for (const key of Object.keys(SUSR_SOURCES)) {
    const buf = susr[key];
    if (!buf) continue;
    try { for (const [name, t] of parseSusrZip(Buffer.from(buf))) susrTables.set(name, t); } catch (error) { parseErrors[`susr.${key}`] = `parse: ${error?.message}`; }
  }
  for (const [key, spec] of Object.entries(SUSR_CODE_TABLES)) {
    const t = susrTables.get(spec.table);
    tables[key] = t ? (tableByHeader(t.sheets[0]?.rows || [], spec.headers)?.records || []) : [];
  }
  tables.geo = geo;
  const hasCandidates = Object.keys(MINV_SOURCES).some((k) => tables[k]?.length);
  const model = hasCandidates ? buildModel(tables, { generatedAt: nowMs, sources: {} }) : null;
  let results = null;
  if (model) {
    try { results = buildResults(susrTables, model, { generatedAt: nowMs }); } catch (error) { parseErrors.results = `výsledky: ${error?.message}`; }
  }
  return { model, tables: susrTables, results, parseErrors };
}

/** Spracovanie vo workeri (node:worker_threads) — hlavné vlákno API ostáva voľné. */
export async function processInWorker(input, { workerUrl = new URL('./volbyWorker.js', import.meta.url) } = {}) {
  const { Worker } = await import('node:worker_threads');
  const worker = new Worker(workerUrl);
  try {
    return await new Promise((resolve, reject) => {
      worker.once('message', (msg) => (msg?.ok ? resolve(msg.out) : reject(new Error(msg?.error || 'worker'))));
      worker.once('error', reject);
      worker.once('exit', (code) => { if (code !== 0) reject(new Error(`worker skončil ${code}`)); });
      worker.postMessage(input);
    });
  } finally {
    void worker.terminate();
  }
}

/** Prehľad výsledkových tabuliek ŠÚ SR pre odpoveď (bez riadkov). Pure. */
export function resultsSummary(tables) {
  const list = [...(tables?.values?.() || [])].filter((t) => isResultsTable(t.name))
    .map((t) => ({ name: t.name, title: t.title, rows: t.sheets.reduce((s, sh) => s + Math.max(0, sh.rows.length - 2), 0) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return list.length ? { tables: list } : null;
}

/**
 * @param {object} [o]
 * @param {string} [o.cacheDir] .gev-cache/volby
 * @param {typeof fetch} [o.fetchImpl]
 * @param {() => number} [o.now]
 * @param {string} [o.geoPath] obce-geo.json
 * @param {{record: Function}} [o.registry] upstreamStatus
 * @param {{info?: Function, warn?: Function}} [o.log]
 * @param {number} [o.timeoutMs]
 */
export function createVolbyService({
  cacheDir = path.join(process.cwd(), '.gev-cache', 'volby'),
  fetchImpl = globalThis.fetch,
  now = Date.now,
  geoPath = DEFAULT_GEO_PATH,
  registry = upstream,
  log = console,
  timeoutMs = FETCH_TIMEOUT_MS,
  useWorker = false,
  live = null,
  sweep = null,
} = {}) {
  const state = { model: null, tables: new Map(), sources: {}, refreshing: null, lastRefreshAt: 0, fetches: 0, results: null, forceRebuild: false };
  // Priebežné výsledky z JSON stránky ŠÚ SR (volbyLive.js) — po 20:00, kým ZIP s tabuľkami výsledky nemá.
  let liveInst = null;
  const liveNow = () => { if (live) return live; if (!liveInst && now() >= POLLS_CLOSE_MS) liveInst = createVolbyLive({ fetchImpl, now, registry }); return liveInst; };
  async function liveOverview(model) {
    const L = liveNow(); if (!L) return null;
    const sum = await L.summary();
    // osk tab01 počíta okrsky (6 029), oso tab01 obce (2 921) — „spracovaných X z Y okrskov" teda z OSK.
    const s = sum.osk || sum.oso;
    if (!s || !s.okrskyDone) return null;
    const kraje = await Promise.all(model.kraje.map(async (k) => {
      const pred = await L.predseda(k.code);
      const lead = pred?.[0] || null;
      return { code: k.code, okrskyDone: null, okrskyTotal: null, final: false, lead: lead ? { n: lead.n, meno: lead.meno, priezvisko: lead.priezvisko, strany: lead.strany, nezavisly: lead.nezavisly, votes: lead.votes, pct: lead.pct, elected: lead.elected } : null };
    }));
    return { generatedAt: new Date(now()).toISOString(), tables: { live: 'volbysr.sk/json' }, live: true,
      summary: { okrskyDone: s.okrskyDone, okrskyTotal: s.okrskyTotal, pct: s.pct, obceWithResults: null, obceFinal: null, registered: s.registered ?? null, voted: s.voted ?? null, turnoutPct: s.turnoutPct ?? null, osk: sum.osk, oso: sum.oso },
      kraje };
  }
  async function liveKraj(kraj) {
    const L = liveNow(); if (!L) return null;
    const predseda = await L.predseda(kraj.code);
    const obvody = (await Promise.all(kraj.obvody.map(async (o) => ({ code: o.code, name: o.name, seats: o.seats || 1, kandidati: await L.zupniObvod(o.code, o.seats || 1) })))).filter((o) => o.kandidati);
    if (!predseda && !obvody.length) return null;
    return { live: true, okrskyDone: null, okrskyTotal: null, final: false, predseda: predseda || [], obvody };
  }
  async function liveObec(obec) {
    const L = liveNow(); if (!L) return null;
    const prehlad = sweepNow()?.result(obec) || null;
    const starosta = await L.starosta(obec.code);
    if (!starosta) return null;
    const ucast = prehlad?.turnoutPct != null ? { registered: prehlad.registered, voted: prehlad.voted, pct: prehlad.turnoutPct } : null;
    return { live: true, okrskyDone: null, okrskyTotal: null, final: starosta.some((c) => c.elected), ucast, starosta, poslanci: [], prehlad };
  }
  // Výsledky všetkých obcí (volbyObceSweep.js) — zber na pozadí po zatvorení miestností; sweep: false ho vypne (testy).
  let sweepInst = null;
  const sweepNow = () => { if (sweep === false) return null; if (sweep) return sweep; if (!sweepInst && now() >= POLLS_CLOSE_MS) sweepInst = createVolbyObceSweep({ fetchImpl, now, log, registry, cacheFile: path.join(cacheDir, 'obce-sweep.json') }); return sweepInst; };
  let recordsMemo = { key: '', value: null };
  let pagePaths = { model: null, paths: new Map() };
  function records(model) {
    const S = sweepNow(); if (!S) return null;
    const st = S.status();
    const key = `${st.cached}|${st.lastRoundAt}`;
    if (recordsMemo.key !== key) recordsMemo = { key, value: volbyRecords(S.results(model.obce), { excludeCodes: new Set(['582000', '599981']) }) };
    return recordsMemo.value;
  }
  const build = (input) => (useWorker ? processInWorker(input) : Promise.resolve(processSources(input)));
  let geo = null;

  function loadGeo() {
    if (geo) return geo;
    try { geo = JSON.parse(fs.readFileSync(geoPath, 'utf8')).rows || []; } catch (error) { log.warn?.(`[volby] obce-geo.json: ${error?.message}`); geo = []; }
    return geo;
  }

  const cachePaths = (name) => ({ file: path.join(cacheDir, name), meta: path.join(cacheDir, `${name}.meta.json`) });
  function readCache(name) {
    try {
      const { file, meta } = cachePaths(name);
      if (!fs.existsSync(file) || !fs.existsSync(meta)) return null;
      return { buffer: fs.readFileSync(file), meta: JSON.parse(fs.readFileSync(meta, 'utf8')) };
    } catch { return null; }
  }
  function writeCache(name, buffer, meta) {
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      const p = cachePaths(name);
      fs.writeFileSync(p.file, buffer);
      fs.writeFileSync(p.meta, JSON.stringify(meta));
    } catch (error) { log.warn?.(`[volby] cache: ${error?.message}`); }
  }

  /**
   * Súbor z disku, kým je čerstvý; inak podmienené stiahnutie; pri chybe starý súbor (stale).
   * @returns {Promise<{buffer: Buffer|null, fetchedAt: number|null, stale: boolean, error: string|null, changed: boolean, lastModified: string|null}>}
   */
  async function fetchCached(name, url, ttlMs) {
    const cached = readCache(name);
    const fromCache = (meta, stale, error) => ({ buffer: cached.buffer, fetchedAt: meta.fetchedAt ?? null, stale, error, changed: false, lastModified: meta.lastModified ?? null });
    if (cached && now() - (cached.meta.fetchedAt || 0) < ttlMs) return fromCache(cached.meta, false, null);
    const host = new URL(url).hostname;
    const headers = { 'User-Agent': USER_AGENT, Accept: 'application/octet-stream, application/zip, */*' };
    if (cached?.meta.etag) headers['If-None-Match'] = cached.meta.etag;
    else if (cached?.meta.lastModified) headers['If-Modified-Since'] = cached.meta.lastModified;
    try {
      state.fetches += 1;
      const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      registry.record(host, { status: res.status });
      if (res.status === 304 && cached) {
        const meta = { ...cached.meta, fetchedAt: now() };
        writeCache(name, cached.buffer, meta);
        return fromCache(meta, false, null);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 100) throw new Error('prázdna odpoveď');
      const meta = { fetchedAt: now(), etag: res.headers.get('etag') || null, lastModified: res.headers.get('last-modified') || null, size: buffer.length, url };
      writeCache(name, buffer, meta);
      return { buffer, fetchedAt: meta.fetchedAt, stale: false, error: null, changed: !cached || !cached.buffer.equals(buffer), lastModified: meta.lastModified };
    } catch (error) {
      registry.record(host, { error: true });
      const message = String(error?.message || error);
      if (cached) return fromCache(cached.meta, true, message);
      return { buffer: null, fetchedAt: null, stale: true, error: message, changed: false, lastModified: null };
    }
  }

  const sourceStatus = (list, label, url) => {
    const fetchedAt = Math.max(0, ...list.map((r) => r?.fetchedAt || 0));
    return {
      label, url,
      fetchedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null,
      lastModified: list.map((r) => r?.lastModified).find(Boolean) || null,
      stale: list.some((r) => r?.stale),
      ok: list.every((r) => r?.buffer),
      errors: list.map((r) => r?.error).filter(Boolean),
    };
  };

  async function refreshNow() {
    const started = now();
    const fetched = {};
    await Promise.all([
      ...Object.entries(MINV_SOURCES).map(async ([key, src]) => { fetched[`minv.${key}`] = await fetchCached(`minv-${key}.xlsx`, src.url, MINV_TTL_MS); }),
      ...Object.entries(SUSR_SOURCES).map(async ([key, url]) => { fetched[`susr.${key}`] = await fetchCached(`susr-${key}.zip`, url, susrTtlMs(now())); }),
    ]);
    // Bez zmeny súborov (304 alebo čerstvá cache) a s hotovým modelom sa nič neprestavuje — len stav zdrojov.
    const anyChanged = Object.values(fetched).some((r) => r.changed);
    const sourcesOf = () => ({
      minv: sourceStatus(Object.keys(MINV_SOURCES).map((k) => fetched[`minv.${k}`]), 'Ministerstvo vnútra SR – register kandidátov', MINV_PAGE_URL),
      susr: sourceStatus(Object.keys(SUSR_SOURCES).map((k) => fetched[`susr.${k}`]), 'Štatistický úrad SR – volbysr.sk', SUSR_PAGE_URL),
    });
    if (state.model && !anyChanged && !state.forceRebuild) {
      state.sources = sourcesOf();
      state.model = { ...state.model, sources: state.sources };
      state.lastRefreshAt = now();
      return;
    }
    state.forceRebuild = false;
    const input = {
      minv: Object.fromEntries(Object.keys(MINV_SOURCES).map((k) => [k, fetched[`minv.${k}`]?.buffer || null])),
      susr: Object.fromEntries(Object.keys(SUSR_SOURCES).map((k) => [k, fetched[`susr.${k}`]?.buffer || null])),
      geo: loadGeo(),
      nowMs: now(),
    };
    // Spracovanie (XLSX + model + výsledky, sekundy CPU pri výsledkoch) mimo hlavného vlákna, ak je worker zapnutý.
    const out = await build(input);
    for (const [key, msg] of Object.entries(out.parseErrors || {})) if (fetched[key]) { fetched[key].error = msg; fetched[key].buffer = null; }
    const sources = sourcesOf();
    if (out.model) state.model = { ...out.model, sources };
    else if (state.model) state.model = { ...state.model, sources };
    else throw new Error('register kandidátov nie je k dispozícii');
    state.tables = out.tables;
    state.sources = sources;
    state.lastRefreshAt = now();
    state.results = out.results && state.model ? out.results : null;
    log.info?.(`[volby] model: ${state.model.obce.length} obcí, ${state.tables.size} tabuliek ŠÚ SR, výsledky ${state.results?.available ? Object.keys(state.results.tables).join('+') : 'nie'}, ${now() - started} ms`
      + (sources.minv.errors.length || sources.susr.errors.length ? ` · chyby: ${[...sources.minv.errors, ...sources.susr.errors].join('; ')}` : ''));
  }

  /** Jedna obnova naraz; chyba nezhodí server. */
  function refresh() {
    if (!state.refreshing) {
      state.refreshing = refreshNow()
        .catch((error) => log.warn?.(`[volby] obnova zlyhala: ${error?.message}`))
        .finally(() => { state.refreshing = null; });
    }
    return state.refreshing;
  }
  const isStale = () => now() - state.lastRefreshAt >= Math.min(MINV_TTL_MS, susrTtlMs(now()));
  /** Model pre odpoveď: prvý raz počká, potom podáva hneď a obnovuje na pozadí. */
  async function ensure() {
    if (!state.model) await refresh();
    else if (isStale()) void refresh();
    return state.model;
  }

  function send(res, status, body, maxAge = 0) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': maxAge > 0 ? `public, max-age=${maxAge}` : 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(body));
  }

  function sendJpeg(res, buffer, maxAge) {
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': String(buffer.length), 'Cache-Control': `public, max-age=${maxAge}` });
    res.end(buffer);
  }
  function sendHtml(res, html, maxAge) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': `public, max-age=${maxAge}` });
    res.end(html);
  }
  const originOf = (req) => {
    const host = String(req?.headers?.host || '').trim();
    if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return 'https://okolive.sk';
    const proto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim() || (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? 'http' : 'https');
    return `${proto === 'http' ? 'http' : 'https'}://${host}`;
  };

  /** Connect middleware pre `/api/volby` (req.url už bez predpony). */
  async function middleware(req, res, next) {
    const url = new URL(req.url || '/', 'http://localhost');
    const route = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
    const model = await ensure();
    if (!model) return send(res, 503, { error: 'unavailable', sources: state.sources });
    sweepNow()?.maybeRound(model.obce);
    let m;
    if (route === '/' || route === '/prehlad') {
      const vysledky = resultsOverview(state.results) || await liveOverview(model).catch(() => null);
      return send(res, 200, { ...overview(model, { nowMs: now() }), results: resultsSummary(state.tables), vysledky }, 60);
    }
    if ((m = /^\/kraj\/(\d)$/.exec(route))) {
      const kraj = krajDetail(model, m[1]);
      if (!kraj) return send(res, 404, { error: 'not_found' });
      const vysledky = state.results?.kraje?.get(kraj.code) || await liveKraj(kraj).catch(() => null);
      return send(res, 200, { ...kraj, vysledky }, vysledky ? 60 : (now() >= POLLS_CLOSE_MS ? 60 : 300));
    }
    if (route === '/obce') {
      const q = String(url.searchParams.get('q') || '').slice(0, 80);
      const limit = Number(url.searchParams.get('limit')) || 25;
      if (q.trim().length < 2 && !/^\d{6}$/.test(q.trim())) return send(res, 400, { error: 'query_too_short' });
      return send(res, 200, { q, results: searchObce(model, q, Math.min(100, limit)) }, 300);
    }
    if ((m = /^\/obec\/([a-z0-9-]{1,80})$/i.exec(route))) {
      const obec = obecDetail(model, m[1]);
      if (!obec) return send(res, 404, { error: 'not_found' });
      const zip = state.results?.obce?.get(obec.code) || null;
      // Definitívne tabuľky (2026-10-26): k výsledku obce aj prehľad zo zberu (doterajší starosta, trieda pre mapu).
      const vysledky = zip ? { ...zip, prehlad: sweepNow()?.result(obec) || null } : await liveObec(obec).catch(() => null);
      return send(res, 200, { ...obec, vysledky }, vysledky ? 60 : (now() >= POLLS_CLOSE_MS ? 60 : 300));
    }
    if (route === '/obce-body') {
      // Mapa obcí (volbyObceLayer.js): všetky obce s polohou, stav výsledkov (0 nič, 1 čiastočné, 2 úplné) a vedúci kandidát na starostu.
      const rows = [];
      const S = sweepNow();
      for (const o of model.obce) {
        if (!Number.isFinite(o.lat) || !Number.isFinite(o.lon)) continue;
        const r = state.results?.obce?.get(o.code) || null;
        const sw = S?.result(o) || null;
        const lead = r?.starosta?.[0] || sw?.winner;
        rows.push([o.code, o.name, o.lat, o.lon, o.seats || 0, sw?.done ? 2 : obecMapState(state.results, o.code), lead ? `${lead.meno} ${lead.priezvisko}`.trim() : '', lead ? lead.pct : null, sw && sw.cls !== 'pending' ? sw.cls : null, sw?.party || null]);
      }
      return send(res, 200, { generatedAt: new Date(state.results?.generatedAt || model.generatedAt).toISOString(), columns: ['code', 'name', 'lat', 'lon', 'seats', 'state', 'lead', 'leadPct', 'win', 'party'], rows }, 60);
    }
    if (route === '/tabulky') {
      const list = [...state.tables.values()].map((t) => ({ name: t.name, title: t.title, results: isResultsTable(t.name), sheets: t.sheets.map((s) => ({ name: s.name, rows: s.rows.length, header: s.rows[1] || s.rows[0] || [] })) }));
      return send(res, 200, { count: list.length, generatedAt: new Date(state.lastRefreshAt).toISOString(), sources: state.sources, tables: list }, 60);
    }
    if ((m = /^\/tabulka\/([A-Za-z0-9_]{1,40})$/.exec(route))) {
      const t = state.tables.get(m[1]);
      if (!t) return send(res, 404, { error: 'not_found' });
      return send(res, 200, { name: t.name, title: t.title, sheets: t.sheets.map((s) => ({ name: s.name, rows: s.rows.slice(0, TABLE_ROW_LIMIT), truncated: s.rows.length > TABLE_ROW_LIMIT })) }, 60);
    }
    if (route === '/zaujimavosti') {
      const rec = records(model);
      return send(res, 200, { generatedAt: new Date(now()).toISOString(), available: Boolean(rec?.counts?.done), ...(rec || {}) }, 120);
    }
    if ((m = /^\/karta\/(\d{6})(\.jpg)?$/.exec(route))) {
      const obec = obecDetail(model, m[1]);
      if (!obec) return send(res, 404, { error: 'not_found' });
      const r = sweepNow()?.result(obec) || null;
      if (m[2]) return sendJpeg(res, await renderCardJpeg(obec, r), r?.done ? 3600 : 300);
      // Návštevník z karty na ľahkú stránku výsledkov obce (tá istá adresa, akú vyrobil scripts/build-volby-pages.mjs).
      if (pagePaths.model !== model) pagePaths = { model, paths: buildPaths(model.obce) };
      return sendHtml(res, cardPage(obec, r, originOf(req), r?.done ? pagePaths.paths.get(obec.code)?.path || null : null), 300);
    }
    if ((m = /^\/karta-volby(\.jpg)?$/.exec(route))) {
      const rec = records(model);
      if (m[1]) {
        const S = sweepNow();
        const points = model.obce.filter((o) => Number.isFinite(o.lat) && Number.isFinite(o.lon) && !['582000', '599981'].includes(o.code)).map((o) => [o.lat, o.lon, S?.result(o)?.cls || 'pending']);
        return sendJpeg(res, await renderOverviewJpeg(points, rec?.counts || {}), 600);
      }
      return sendHtml(res, overviewPage(rec?.counts || {}, originOf(req)), 300);
    }
    if (route === '/status') return send(res, 200, status());
    return next ? next() : send(res, 404, { error: 'not_found' });
  }

  /** Stav pre admin a testy. */
  function status() {
    return {
      ready: Boolean(state.model),
      generatedAt: state.model ? new Date(state.model.generatedAt).toISOString() : null,
      lastRefreshAt: state.lastRefreshAt ? new Date(state.lastRefreshAt).toISOString() : null,
      refreshing: Boolean(state.refreshing),
      fetches: state.fetches,
      obce: state.model?.obce.length ?? 0,
      tables: [...state.tables.keys()],
      results: resultsSummary(state.tables),
      vysledky: state.results?.available ? { tables: state.results.tables, summary: state.results.summary } : null,
      sources: state.sources,
    };
  }

  return { middleware, refresh, ensure, status, isStale, records, _state: state, _sweep: () => sweepNow() };
}

/** Vite plugin (služba oko-api aj QA inštancia v role full). Model sa predhreje krátko po štarte. */
let sharedService = null;
/** Obsluha s odchytením chyby: 500 namiesto pádu procesu. */
export function safeMiddleware(service, req, res, next) {
  return Promise.resolve().then(() => service.middleware(req, res, next)).catch((error) => {
    console.warn('[volby] chyba obsluhy:', error?.message || error);
    try { if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); } res.end(JSON.stringify({ error: 'internal' })); } catch { /* spojenie už zavreté */ }
  });
}
/** Služba volieb pre zdieľacie adresy /s/v<kód> a /s/volby2026 (vite.config.js, plugin zdieľania). */
export function volbyShareService() { return sharedService; }

export function volbyPlugin(options = {}) {
  const service = createVolbyService({ useWorker: true, ...options });
  sharedService = service;
  return {
    name: 'oko-volby',
    configureServer(server) {
      // Chyba v obsluhe nesmie zhodiť proces (async výnimka bez catch = unhandled rejection → koniec služby oko-api).
      server.middlewares.use(VOLBY_PATH, (req, res, next) => { safeMiddleware(service, req, res, next); });
      const timer = setTimeout(() => { void service.refresh(); }, 3000);
      timer.unref?.();
    },
    _service: service,
  };
}
