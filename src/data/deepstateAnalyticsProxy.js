// src/data/deepstateAnalyticsProxy.js
/**
 * @module deepstateAnalyticsProxy
 * @description Vite plugin pre `/api/deepstate/analytics` — serverová časť
 * samostatného dema `public/demos/deepstate-analytics/` (2026-09-23).
 * Stiahne denný GeoJSON okupovaného územia z GitHub mirroru
 * cyterat/deepstate-map-data, drží ho v pamäti a na disku, pri chýbajúcom dni
 * padne na starší a vráti rozlohu (km²) aj samotnú geometriu.
 *
 * LICENCIA — POCTIVO: GPL-3.0 mirroru sa vzťahuje len na jeho skripty, nie na
 * dáta. Dáta sú © DeepStateMap.live a platí pre ne ich licenčná zmluva
 * (§2 zakazuje šírenie, publikovanie a „proxying" bez súhlasu); mirror
 * súhlas DeepState nedeklaruje (docs/drafts/ukrajina-zdroje-prieskum.md).
 * Hlavné vrstvy UKRAJINY mirror nepoužívajú (plán, pravidlo 5). Toto demo
 * a endpoint sú VÝSLOVNÁ VÝNIMKA vlastníka projektu z 23. 9. 2026 („Nechať —
 * zadal som to ja") — preto nesú zdroj, licenciu a výhrady priamo v odpovedi
 * a endpoint zámerne nemá bránu podľa hostiteľa. Nikdy ich neoznačovať za
 * otvorené dáta.
 *
 * Náklady na upstream (pravidlo 4): pamäť 15 min → disk bez TTL (denný súbor
 * sa nemení) → negatívna cache 404 (30 min pre dnešok/včerajšok, 6 h staršie)
 * → jeden dopyt na deň naraz; po prvej inej chybe než 404 (429/5xx/timeout)
 * sa na GitHub nechodí ani v tom istom dopyte, ani v ďalších aspoň minútu
 * (Retry-After, strop 15 min); celé hľadanie má strop 30 s.
 */

import path from 'node:path';
import zlib from 'node:zlib';
import { promises as fsp } from 'node:fs';
import { polygonAreaKm2 } from './ukraineDeepState.js';

export const DEEPSTATE_ANALYTICS_UPSTREAM_BASE =
  'https://raw.githubusercontent.com/cyterat/deepstate-map-data/main/data';
/** Najstarší súbor v mirrore (prieskum 2026-09-19) — pred ním sa nehľadá. */
export const MIRROR_FIRST_DAY = '20240708';
export const DEFAULT_MAX_FALLBACK_DAYS = 7;
export const MAX_FALLBACK_DAYS = 14;

/** Čo zobraziť pri čísle — odpoveď a testy; stránka dema má to isté znenie s odkazmi. */
export const DEEPSTATE_ANALYTICS_ATTRIBUTION =
  'Territory under Russian control according to DeepStateMap.live, via the unofficial GitHub mirror cyterat/deepstate-map-data';
export const DEEPSTATE_ANALYTICS_LICENSE = Object.freeze({
  data: 'DeepStateMap.live licence agreement — not open data; distribution, publication and proxying need DeepState consent',
  dataUrl: 'https://deepstatemap.live/license-en.html',
  mirrorCode: 'GPL-3.0 (applies to the mirror scripts, not to the data)',
  mirrorUrl: 'https://github.com/cyterat/deepstate-map-data',
  consent: 'none declared; kept as an explicit exception by the OKO owner (2026-09-23)',
});
export const DEEPSTATE_ANALYTICS_NOTE =
  'Date = day the mirror downloaded the file (scheduled ~03:00 UTC); DeepState itself publishes with a deliberate 2–3 day delay. '
  + 'Includes Crimea and areas occupied since 2014. Not a live front line; not for evacuation or route planning.';
export const DEEPSTATE_ANALYTICS_AREA_METHOD =
  'OKO estimate: spherical polygon area, R = 6371.0088 km, holes subtracted — not a DeepState figure';

const CACHE_DIR_NAME = 'deepstate-analytics';
const DAY_MS = 86_400_000;
const MIN = 60_000;
const MEMORY_TTL_MS = 15 * MIN;
const MEMORY_MAX = 16;
const MISSING_TTL_RECENT_MS = 30 * MIN;
const MISSING_TTL_OLD_MS = 6 * 60 * MIN;
const MISSING_MAX = 128;
const LIMITER_MAX_KEYS = 500;
const USER_AGENT = 'OKO/0.1 (https://github.com/vladouh76; spatial-analytics)';
const UPSTREAM_TIMEOUT_MS = 25_000;
const REQUEST_BUDGET_MS = 30_000;
/** Po chybe mirroru (nie 404) sa na GitHub nechodí aspoň minútu, najviac 15 min (Retry-After). */
const BACKOFF_MIN_MS = MIN;
const BACKOFF_MAX_MS = 15 * MIN;
/** Starší súbor z disku mimo okna fallbacku — najviac mesiac starý. */
export const STALE_DISK_MAX_DAYS = 30;
const OUT_OF_BUDGET = Symbol('out-of-budget');

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * YYYYMMDD pre N kalendárnych dní pred dňom `baseDate` — všetko v UTC (mirror
 * pomenúva súbory podľa UTC dňa behu o ~03:00 UTC). Pure.
 */
export function getFormattedDateKey(daysAgo = 1, baseDate = new Date()) {
  const b = new Date(baseDate);
  const d = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate() - daysAgo));
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}

/** YYYYMMDD → ms UTC o polnoci, len pre skutočný dátum (20261399 = null). Pure. */
export function parseDateKey(key) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(key ?? ''));
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return getFormattedDateKey(0, new Date(ms)) === key ? ms : null;
}

/** Formátuje YYYYMMDD na YYYY-MM-DD. Pure. */
export function formatDisplayDate(dateKey) {
  if (!dateKey || typeof dateKey !== 'string' || dateKey.length !== 8) return dateKey;
  return `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`;
}

/** URL upstream súboru na GitHube. Pure. */
export function deepstateRawUrl(dateKey) {
  return `${DEEPSTATE_ANALYTICS_UPSTREAM_BASE}/deepstatemap_data_${dateKey}.geojson`;
}

/**
 * Vypočíta celkovú rozlohu v km² z GeoJSON kolekcie alebo geometrie
 * pomocou sférickej trigonometrie (Chamberlain & Duquette). Pure.
 */
export function calculateGeoJsonAreaKm2(geojson) {
  if (!geojson) return 0;
  let totalKm2 = 0;

  function processGeometry(geom) {
    if (!geom || !geom.type || !geom.coordinates) return;
    if (geom.type === 'Polygon') {
      totalKm2 += polygonAreaKm2(geom.coordinates);
    } else if (geom.type === 'MultiPolygon') {
      for (const polyCoords of geom.coordinates) {
        totalKm2 += polygonAreaKm2(polyCoords);
      }
    }
  }

  if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
    for (const f of geojson.features) {
      processGeometry(f?.geometry);
    }
  } else if (geojson.type === 'Feature') {
    processGeometry(geojson.geometry);
  } else if (geojson.type === 'Polygon' || geojson.type === 'MultiPolygon') {
    processGeometry(geojson);
  }

  return Math.round(totalKm2 * 100) / 100;
}

/**
 * Súbor sa berie len vtedy, keď nesie aspoň jeden polygón s kladnou rozlohou.
 * Prázdna kolekcia (napr. keď mirror stiahne chybovú odpoveď) by sa inak
 * uložila na disk NAVŽDY a deň by ukazoval „0 km²". Pure.
 */
export function isUsableSnapshot(geojson) {
  return calculateGeoJsonAreaKm2(geojson) > 0;
}

/** Kľúč klienta: za tunelom CF-Connecting-IP, inak socket. */
export function getClientIp(req) {
  const cf = req?.headers?.['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return cf.trim();
  return req?.socket?.remoteAddress || 'local';
}

/** `maxFallback` z dopytu: nečíslo = predvolené, inak 0 … 14. Pure. */
export function parseMaxFallback(raw) {
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) ? Math.min(MAX_FALLBACK_DAYS, Math.max(0, n)) : DEFAULT_MAX_FALLBACK_DAYS;
}

function simpleLimiter({ windowMs, max, now = Date.now }) {
  const hits = new Map();
  return (key) => {
    const t = now();
    let arr = hits.get(key);
    if (!arr) {
      arr = [];
      hits.set(key, arr);
      if (hits.size > LIMITER_MAX_KEYS) hits.delete(hits.keys().next().value);
    }
    while (arr.length && t - arr[0] > windowMs) arr.shift();
    if (arr.length >= max) return false;
    arr.push(t);
    return true;
  };
}

class UpstreamError extends Error {
  constructor(status, message, retryAfterMs = null) {
    super(message || `Upstream HTTP ${status}`);
    this.upstreamStatus = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Retry-After z odpovede v ms (sekundy alebo HTTP dátum), inak null. */
function retryAfterMs(resp) {
  const raw = resp?.headers?.get?.('retry-after');
  if (!raw) return null;
  const s = Number(raw);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const t = Date.parse(raw);
  return Number.isFinite(t) ? Math.max(0, t - Date.now()) : null;
}

/**
 * Počká na zdieľaný dopyt najviac `ms` — potom OUT_OF_BUDGET. Zdieľaný dopyt
 * sa nepreruší: jeho výsledok sa aj tak uloží pre ďalšie dopyty.
 */
function withBudget(shared, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(OUT_OF_BUDGET), Math.max(0, ms));
    timer.unref?.();
    shared.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

/**
 * Vite plugin pre `/api/deepstate/analytics`.
 */
export function deepstateAnalyticsProxy(opts = {}) {
  const projectRoot = opts.root || process.cwd();
  const cacheDir = opts.cacheDir || path.join(projectRoot, '.gev-cache', CACHE_DIR_NAME);
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const now = opts.now || Date.now;
  const log = opts.log || console.log;

  const memoryCache = new Map(); // dateKey -> { json, cachedAt }
  const missing = new Map(); // dateKey -> checkedAt (upstream povedal 404 / nepoužiteľné)
  const inFlight = new Map(); // dateKey -> Promise<json|null>
  const limiter = simpleLimiter({ windowMs: 60_000, max: 60, now });
  let upstreamBackoffUntil = 0; // po chybe mirroru: dovtedy len pamäť a disk
  let lastUpstreamStatus = null;

  const diskPath = (dateKey) => path.join(cacheDir, `${dateKey}.geojson`);

  function remember(dateKey, json) {
    const t = now();
    for (const [k, v] of memoryCache) if (t - v.cachedAt >= MEMORY_TTL_MS) memoryCache.delete(k);
    memoryCache.delete(dateKey);
    memoryCache.set(dateKey, { json, cachedAt: t });
    while (memoryCache.size > MEMORY_MAX) memoryCache.delete(memoryCache.keys().next().value);
  }

  function markMissing(dateKey) {
    missing.delete(dateKey);
    missing.set(dateKey, now());
    while (missing.size > MISSING_MAX) missing.delete(missing.keys().next().value);
  }

  function missingFresh(dateKey) {
    const at = missing.get(dateKey);
    if (at === undefined) return false;
    const recent = dateKey >= getFormattedDateKey(1, new Date(now()));
    return now() - at < (recent ? MISSING_TTL_RECENT_MS : MISSING_TTL_OLD_MS);
  }

  async function readDisk(dateKey) {
    try {
      const parsed = JSON.parse(await fsp.readFile(diskPath(dateKey), 'utf8'));
      return isUsableSnapshot(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async function writeDisk(dateKey, text) {
    // Cez .tmp + rename: .gev-cache je junction na D: (lekcia EBUSY z terénu).
    const file = diskPath(dateKey);
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      await fsp.mkdir(cacheDir, { recursive: true });
      await fsp.writeFile(tmp, text, 'utf8');
      await fsp.rename(tmp, file);
    } catch (error) {
      log(`[deepstate-analytics] zápis ${dateKey} zlyhal: ${error?.message || error}`);
      await fsp.rm(tmp, { force: true }).catch(() => {});
    }
  }

  /**
   * Jeden dopyt na GitHub pre deň naraz; null = súbor nie je (404) alebo je
   * nepoužiteľný. Zdieľaný dopyt má VLASTNÝ pevný timeout — nie rozpočet
   * volajúceho, ktorý prišiel prvý (ten by ho mohol zabiť po 1 s aj ostatným).
   */
  function fetchUpstream(dateKey) {
    const running = inFlight.get(dateKey);
    if (running) return running;
    const promise = (async () => {
      const mapError = (error) => new UpstreamError(
        error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'network', error?.message,
      );
      let resp;
      try {
        resp = await fetchImpl(deepstateRawUrl(dateKey), {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json, application/json' },
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
      } catch (error) {
        throw mapError(error);
      }
      if (resp.status === 404) { markMissing(dateKey); return null; }
      if (!resp.ok) throw new UpstreamError(resp.status, undefined, retryAfterMs(resp));
      let text;
      try {
        text = typeof resp.text === 'function' ? await resp.text() : JSON.stringify(await resp.json());
      } catch (error) {
        throw mapError(error); // timeout / prerušenie počas čítania tela
      }
      let geojson = null;
      try { geojson = JSON.parse(text); } catch { geojson = null; }
      if (!isUsableSnapshot(geojson)) {
        log(`[deepstate-analytics] ${dateKey}: súbor bez polygónu s rozlohou — preskočený, neukladá sa`);
        markMissing(dateKey);
        return null;
      }
      await writeDisk(dateKey, text);
      remember(dateKey, geojson);
      return geojson;
    })();
    inFlight.set(dateKey, promise);
    promise.then(() => {}, () => {}).finally(() => { if (inFlight.get(dateKey) === promise) inFlight.delete(dateKey); });
    return promise;
  }

  /**
   * Snímka dňa: pamäť → disk → negatívna cache → (ak smie) upstream.
   * `resolved: false` = o dni nevieme nič, lebo upstream nesmel (chyba, pauza
   * po chybe alebo vyčerpaný čas) — takýto deň sa nepočíta ako „skontrolovaný".
   */
  async function snapshotFor(dateKey, { allowUpstream, budgetMs }) {
    const mem = memoryCache.get(dateKey);
    if (mem && now() - mem.cachedAt < MEMORY_TTL_MS) return { data: mem.json, source: 'memory', resolved: true };
    const disk = await readDisk(dateKey);
    if (disk) { remember(dateKey, disk); return { data: disk, source: 'disk', resolved: true }; }
    if (missingFresh(dateKey)) return { data: null, source: null, resolved: true };
    if (!allowUpstream) return { data: null, source: null, resolved: false };
    const data = await withBudget(fetchUpstream(dateKey), budgetMs);
    if (data === OUT_OF_BUDGET) return { data: null, source: null, resolved: false, outOfBudget: true };
    return { data, source: data ? 'upstream' : null, resolved: true };
  }

  /** Najnovší použiteľný súbor na disku v rozsahu [minKey, maxKey] — keď mirror stojí dlhšie než okno. */
  async function newestOnDisk(minKey, maxKey) {
    let names = [];
    try { names = await fsp.readdir(cacheDir); } catch { return null; }
    const keys = names
      .map((n) => /^(\d{8})\.geojson$/.exec(n)?.[1])
      .filter((k) => k && parseDateKey(k) !== null && k <= maxKey && k >= minKey)
      .sort()
      .reverse();
    for (const key of keys) {
      const data = await readDisk(key);
      if (data) return { key, data };
    }
    return null;
  }

  function send(req, res, status, json, extra = {}) {
    const body = Buffer.from(JSON.stringify(json));
    const gzip = status === 200 && body.length > 1024 && /\bgzip\b/i.test(String(req?.headers?.['accept-encoding'] || ''));
    const out = gzip ? zlib.gzipSync(body, { level: 6 }) : body;
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store',
      'Content-Length': String(out.length),
      ...extra,
    };
    if (gzip) { headers['Content-Encoding'] = 'gzip'; headers.Vary = 'Accept-Encoding'; }
    res.writeHead(status, headers);
    res.end(req?.method === 'HEAD' ? undefined : out);
  }

  async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(req, res, 405, { ok: false, error: 'method_not_allowed' }, { Allow: 'GET, HEAD' });
      return;
    }

    if (!limiter(getClientIp(req))) {
      send(req, res, 429, { ok: false, error: 'too_many_requests' }, { 'Retry-After': '60' });
      return;
    }

    // Connect po odrezaní prefixu podá napr. „//x:99999" — new URL() by hodil
    // a async handler bez tohto try by zhodil celý dev server (a s ním /api domény).
    let url;
    try { url = new URL(req.url || '/', 'http://localhost'); } catch {
      send(req, res, 400, { ok: false, error: 'bad_url' });
      return;
    }
    const started = now();
    const todayKey = getFormattedDateKey(0, new Date(started));
    const rawDate = url.searchParams.get('date');
    const requestedDate = rawDate === null || rawDate === '' ? null : rawDate;
    if (requestedDate !== null) {
      const reason = parseDateKey(requestedDate) === null ? 'invalid'
        : requestedDate > todayKey ? 'future'
          : requestedDate < MIRROR_FIRST_DAY ? 'before_mirror' : null;
      if (reason) {
        send(req, res, 400, { ok: false, error: 'bad_date', reason, requestedDate, firstDay: MIRROR_FIRST_DAY, today: todayKey });
        return;
      }
    }
    const maxFallback = parseMaxFallback(url.searchParams.get('maxFallback'));
    // Predvolene VČERAJŠOK podľa zadania — kalendárny UTC deň, nie „teraz − 24 h".
    const baseKey = requestedDate || getFormattedDateKey(1, new Date(started));
    const baseMs = parseDateKey(baseKey);

    let found = null;
    let fallbackDays = 0;
    let checkedDays = 0;
    let unresolvedDays = 0;
    let upstreamError = null;
    let budgetExhausted = false;
    const backoffActive = started < upstreamBackoffUntil;

    for (let i = 0; i <= maxFallback; i += 1) {
      const key = getFormattedDateKey(i, new Date(baseMs));
      if (key < MIRROR_FIRST_DAY) break;
      const remaining = REQUEST_BUDGET_MS - (now() - started);
      if (remaining <= 1000) budgetExhausted = true;
      const allowUpstream = !upstreamError && !backoffActive && !budgetExhausted;
      try {
        const result = await snapshotFor(key, { allowUpstream, budgetMs: remaining });
        if (result.outOfBudget) budgetExhausted = true;
        if (result.resolved) checkedDays += 1; else unresolvedDays += 1;
        if (result.data) { found = { key, data: result.data, source: result.source }; fallbackDays = i; break; }
      } catch (error) {
        // Po prvej chybe (nie 404) už GitHub nebombardujeme: v tomto dopyte len
        // pamäť a disk, a ďalšie dopyty čakajú aspoň minútu (alebo Retry-After).
        upstreamError = error;
        unresolvedDays += 1;
        upstreamBackoffUntil = now() + Math.min(BACKOFF_MAX_MS, Math.max(BACKOFF_MIN_MS, error?.retryAfterMs ?? 0));
        lastUpstreamStatus = error?.upstreamStatus ?? null;
        log(`[deepstate-analytics] ${key}: ${error?.message || error} — GitHub pauza do ${new Date(upstreamBackoffUntil).toISOString()}`);
      }
    }

    // Mirror stojí dlhšie než okno: najnovší súbor z disku, najviac 30 dní starý —
    // len pri predvolenom dopyte; výslovný ?date= dostane poctivé „nie je".
    let outsideWindow = false;
    if (!found && requestedDate === null) {
      const minKey = getFormattedDateKey(STALE_DISK_MAX_DAYS, new Date(baseMs));
      const disk = await newestOnDisk(minKey > MIRROR_FIRST_DAY ? minKey : MIRROR_FIRST_DAY, baseKey);
      if (disk) {
        found = { key: disk.key, data: disk.data, source: 'disk-stale' };
        fallbackDays = Math.round((baseMs - parseDateKey(disk.key)) / DAY_MS);
        outsideWindow = true;
      }
    }

    const upstreamProblem = Boolean(upstreamError) || (backoffActive && unresolvedDays > 0);
    if (!found) {
      const who = { requestedDate: requestedDate || 'yesterday', checkedDays, unresolvedDays };
      if (upstreamProblem) {
        const retry = Math.max(1, Math.ceil((upstreamBackoffUntil - now()) / 1000));
        send(req, res, 502, { ok: false, error: 'upstream_unavailable', upstreamStatus: upstreamError?.upstreamStatus ?? lastUpstreamStatus, ...who }, { 'Retry-After': String(retry) });
      } else if (budgetExhausted) {
        send(req, res, 503, { ok: false, error: 'upstream_slow', ...who }, { 'Retry-After': '30' });
      } else {
        send(req, res, 404, { ok: false, error: 'no_data_available', ...who });
      }
      return;
    }

    const areaKm2 = calculateGeoJsonAreaKm2(found.data);
    const payload = {
      ok: true,
      date: formatDisplayDate(found.key),
      dateKey: found.key,
      requestedDate: requestedDate ? formatDisplayDate(requestedDate) : null,
      fallbackDays,
      stale: fallbackDays > 0,
      outsideWindow,
      // Prečo je súbor starší: mirror nedostupný (chyba / pauza po chybe / čas)
      // vs. novšie súbory naozaj neexistujú — demo to hovorí nahlas.
      upstreamUnavailable: unresolvedDays > 0,
      upstreamStatus: unresolvedDays > 0 ? (upstreamError?.upstreamStatus ?? (budgetExhausted ? 'timeout' : lastUpstreamStatus)) : null,
      areaKm2,
      formattedArea: Math.round(areaKm2).toLocaleString('en-US') + ' km²',
      areaMethod: DEEPSTATE_ANALYTICS_AREA_METHOD,
      featuresCount: Array.isArray(found.data.features) ? found.data.features.length : 1,
      sourceUrl: deepstateRawUrl(found.key),
      attribution: DEEPSTATE_ANALYTICS_ATTRIBUTION,
      license: DEEPSTATE_ANALYTICS_LICENSE,
      note: DEEPSTATE_ANALYTICS_NOTE,
      geojson: found.data,
    };
    send(req, res, 200, payload, { 'X-OKO-Source': found.source });
  }

  /** Middleware: žiadna výnimka z handlera nesmie ostať neodchytená (zhodila by server). */
  function middleware(req, res) {
    return handler(req, res).catch((error) => {
      log(`[deepstate-analytics] interná chyba: ${error?.stack || error}`);
      try {
        if (!res.headersSent) send(req, res, 500, { ok: false, error: 'internal' });
        else res.end();
      } catch { /* odpoveď už je preč */ }
    });
  }

  return {
    name: 'deepstate-analytics-proxy',
    configureServer(server) {
      server.middlewares.use('/api/deepstate/analytics', middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/deepstate/analytics', middleware);
    },
    _handler: middleware,
    _dir: cacheDir,
    _calculateArea: calculateGeoJsonAreaKm2,
  };
}
