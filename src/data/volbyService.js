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
} = {}) {
  const state = { model: null, tables: new Map(), sources: {}, refreshing: null, lastRefreshAt: 0, fetches: 0 };
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
    const results = {};
    const tables = {};
    await Promise.all([
      ...Object.entries(MINV_SOURCES).map(async ([key, src]) => {
        const r = await fetchCached(`minv-${key}.xlsx`, src.url, MINV_TTL_MS);
        results[`minv.${key}`] = r;
        if (!r.buffer) return;
        try { tables[key] = tableByHeader(readXlsxRows(r.buffer), src.headers)?.records || []; } catch (error) { r.error = `parse: ${error?.message}`; r.buffer = null; }
      }),
      ...Object.entries(SUSR_SOURCES).map(async ([key, url]) => {
        const r = await fetchCached(`susr-${key}.zip`, url, susrTtlMs(now()));
        results[`susr.${key}`] = r;
        if (!r.buffer) return;
        try { r.tables = parseSusrZip(r.buffer); } catch (error) { r.error = `parse: ${error?.message}`; r.buffer = null; }
      }),
    ]);
    const susrTables = new Map();
    for (const key of Object.keys(SUSR_SOURCES)) for (const [name, t] of results[`susr.${key}`]?.tables || []) susrTables.set(name, t);
    for (const [key, spec] of Object.entries(SUSR_CODE_TABLES)) {
      const t = susrTables.get(spec.table);
      tables[key] = t ? (tableByHeader(t.sheets[0]?.rows || [], spec.headers)?.records || []) : [];
    }
    tables.geo = loadGeo();
    const sources = {
      minv: sourceStatus(Object.keys(MINV_SOURCES).map((k) => results[`minv.${k}`]), 'Ministerstvo vnútra SR – register kandidátov', MINV_PAGE_URL),
      susr: sourceStatus(Object.keys(SUSR_SOURCES).map((k) => results[`susr.${k}`]), 'Štatistický úrad SR – volbysr.sk', SUSR_PAGE_URL),
    };
    const hasCandidates = Object.keys(MINV_SOURCES).some((k) => tables[k]?.length);
    if (hasCandidates || !state.model) state.model = buildModel(tables, { generatedAt: now(), sources });
    else state.model = { ...state.model, sources };
    state.tables = susrTables;
    state.sources = sources;
    state.lastRefreshAt = now();
    log.info?.(`[volby] model: ${state.model.obce.length} obcí, ${susrTables.size} tabuliek ŠÚ SR, ${now() - started} ms`
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

  /** Connect middleware pre `/api/volby` (req.url už bez predpony). */
  async function middleware(req, res, next) {
    const url = new URL(req.url || '/', 'http://localhost');
    const route = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
    const model = await ensure();
    if (!model) return send(res, 503, { error: 'unavailable', sources: state.sources });
    let m;
    if (route === '/' || route === '/prehlad') {
      return send(res, 200, { ...overview(model, { nowMs: now() }), results: resultsSummary(state.tables) }, 60);
    }
    if ((m = /^\/kraj\/(\d)$/.exec(route))) {
      const kraj = krajDetail(model, m[1]);
      return kraj ? send(res, 200, kraj, 300) : send(res, 404, { error: 'not_found' });
    }
    if (route === '/obce') {
      const q = String(url.searchParams.get('q') || '').slice(0, 80);
      const limit = Number(url.searchParams.get('limit')) || 25;
      if (q.trim().length < 2 && !/^\d{6}$/.test(q.trim())) return send(res, 400, { error: 'query_too_short' });
      return send(res, 200, { q, results: searchObce(model, q, Math.min(100, limit)) }, 300);
    }
    if ((m = /^\/obec\/([a-z0-9-]{1,80})$/i.exec(route))) {
      const obec = obecDetail(model, m[1]);
      return obec ? send(res, 200, obec, 300) : send(res, 404, { error: 'not_found' });
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
      sources: state.sources,
    };
  }

  return { middleware, refresh, ensure, status, isStale, _state: state };
}

/** Vite plugin (služba oko-api aj QA inštancia v role full). Model sa predhreje krátko po štarte. */
export function volbyPlugin(options = {}) {
  const service = createVolbyService(options);
  return {
    name: 'oko-volby',
    configureServer(server) {
      server.middlewares.use(VOLBY_PATH, (req, res, next) => { void service.middleware(req, res, next); });
      const timer = setTimeout(() => { void service.refresh(); }, 3000);
      timer.unref?.();
    },
    _service: service,
  };
}
