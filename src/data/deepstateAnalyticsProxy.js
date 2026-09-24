// src/data/deepstateAnalyticsProxy.js
/**
 * @module deepstateAnalyticsProxy
 * @description Jadro mirroru DeepState (`createDeepStateMirror`) pre vrstvu
 * DeepState UKRAJINY + Vite plugin `/api/deepstate/analytics` (2026-09-23;
 * samostatné demo, pre ktoré vznikol, vlastník 24. 9. 2026 zmazal — „omyl v prompte").
 * Stiahne denný GeoJSON okupovaného územia z GitHub mirroru
 * cyterat/deepstate-map-data (záloha: jeho fork lazar-bit, ktorý DeepState
 * sťahuje sám), drží ho v pamäti a na disku, pri chýbajúcom dni padne na
 * starší a vráti rozlohu (km²) aj samotnú geometriu.
 *
 * LICENCIA — POCTIVO: GPL-3.0 mirroru sa vzťahuje len na jeho skripty, nie na
 * dáta. Dáta sú © DeepStateMap.live a platí pre ne ich licenčná zmluva
 * (§2 zakazuje šírenie, publikovanie a „proxying" bez súhlasu); mirror
 * súhlas DeepState nedeklaruje (docs/drafts/ukrajina-zdroje-prieskum.md).
 * Používa sa z ROZHODNUTIA VLASTNÍKA: 23. 9. 2026 demo a endpoint ponechal
 * („Nechať — zadal som to ja"), od 24. 9. 2026 mirrory používame a mirror je
 * zdrojom vrstvy DeepState na verejnej doméne
 * (`createDeepStateMirror` zdieľa ukraineEventsProxy). Licenčné fakty to
 * nemení — preto zdroj, licencia a výhrady idú priamo v odpovedi. Endpoint
 * zámerne nemá bránu podľa hostiteľa. Nikdy neoznačovať za otvorené dáta.
 *
 * Náklady na upstream (pravidlo 4): pamäť 15 min → disk bez TTL (denný súbor
 * sa nemení) → negatívna cache 404 (30 min pre dnešok/včerajšok, 6 h staršie)
 * → jeden dopyt na deň naraz; po inej chybe než 404 (429/5xx/timeout) má
 * TEN mirror pauzu aspoň minútu (Retry-After, strop 15 min) — ostatné sa pýtajú
 * ďalej; keď sú v pauze všetky, na GitHub sa nechodí. Jeden mirror má 12 s,
 * celé hľadanie 30 s.
 */

import path from 'node:path';
import zlib from 'node:zlib';
import { promises as fsp } from 'node:fs';
import { polygonAreaKm2 } from './ukraineDeepState.js';

export const DEEPSTATE_ANALYTICS_UPSTREAM_BASE =
  'https://raw.githubusercontent.com/cyterat/deepstate-map-data/main/data';
/**
 * Mirrory v poradí dôvery. cyterat = pôvodný repozitár; lazar-bit = jeho fork,
 * ktorý DeepState sťahuje VLASTNÝM skriptom (GitHub Actions 03:00 UTC) — preto
 * je skutočná záloha: má dni, ktoré cyterat nemá (26. 11. 2025, 9. 7. 2026;
 * overené 24. 9. 2026). Rovnaké názvy súborov, rovnaký formát, rovnaká licencia
 * (GPL-3.0 na skripty, dáta pod licenciou DeepState).
 */
export const DEEPSTATE_MIRRORS = Object.freeze([
  Object.freeze({ id: 'cyterat', repo: 'cyterat/deepstate-map-data', base: DEEPSTATE_ANALYTICS_UPSTREAM_BASE }),
  Object.freeze({ id: 'lazar-bit', repo: 'lazar-bit/deepstate-map-data-analytics', base: 'https://raw.githubusercontent.com/lazar-bit/deepstate-map-data-analytics/main/data' }),
]);
/** Najstarší súbor v mirrore (prieskum 2026-09-19) — pred ním sa nehľadá. */
export const MIRROR_FIRST_DAY = '20240708';
export const DEFAULT_MAX_FALLBACK_DAYS = 7;
export const MAX_FALLBACK_DAYS = 14;

/** Atribúcia pri čísle (odpoveď a testy); pre fork ju skladá `deepstateAnalyticsAttribution`. */
export const DEEPSTATE_ANALYTICS_ATTRIBUTION =
  'Territory under Russian control according to DeepStateMap.live, via the unofficial GitHub mirror cyterat/deepstate-map-data';
export const DEEPSTATE_ANALYTICS_LICENSE = Object.freeze({
  data: 'DeepStateMap.live licence agreement — not open data; distribution, publication and proxying need DeepState consent',
  dataUrl: 'https://deepstatemap.live/license-en.html',
  mirrorCode: 'GPL-3.0 (applies to the mirror scripts, not to the data)',
  mirrorUrl: 'https://github.com/cyterat/deepstate-map-data',
  consent: 'none declared; used by decision of the OKO owner (2026-09-23/24)',
});
const mirrorById = (id) => DEEPSTATE_MIRRORS.find((m) => m.id === id) || DEEPSTATE_MIRRORS[0];
/** Atribúcia podľa mirroru, z ktorého deň naozaj prišiel. Pure. */
export function deepstateAnalyticsAttribution(mirrorId) {
  const m = mirrorById(mirrorId);
  return m.id === 'cyterat' ? DEEPSTATE_ANALYTICS_ATTRIBUTION
    : `Territory under Russian control according to DeepStateMap.live, via the unofficial GitHub mirror ${m.repo} (fork of cyterat/deepstate-map-data)`;
}
/** Licenčný blok s odkazom na skutočný mirror. Pure. */
export function deepstateMirrorLicense(mirrorId) {
  const m = mirrorById(mirrorId);
  return m.id === 'cyterat' ? DEEPSTATE_ANALYTICS_LICENSE : { ...DEEPSTATE_ANALYTICS_LICENSE, mirrorUrl: `https://github.com/${m.repo}` };
}
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
const UPSTREAM_TIMEOUT_MS = 12_000; // na jeden mirror — dva sa zmestia do rozpočtu 30 s
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
export function deepstateRawUrl(dateKey, mirror = DEEPSTATE_MIRRORS[0]) {
  return `${mirror.base}/deepstatemap_data_${dateKey}.geojson`;
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
 * Stav 1 čísla dňa z mirroru: `invalid` / `future` / `before_mirror` / null. Pure.
 * @param {string} key YYYYMMDD
 * @param {string} todayKey YYYYMMDD (UTC)
 */
export function dateKeyProblem(key, todayKey) {
  if (parseDateKey(key) === null) return 'invalid';
  if (key > todayKey) return 'future';
  if (key < MIRROR_FIRST_DAY) return 'before_mirror';
  return null;
}

/**
 * Jadro mirroru — cache, pauza po chybe, overovanie súborov a hľadanie dňa.
 * Zdieľa ho `/api/deepstate/analytics` aj vrstva DeepState UKRAJINY
 * (`/api/ukraine/events/deepstate` na verejnej doméne a pre dni bez vlastného
 * archívu; mirrory používame z rozhodnutia vlastníka, 24. 9. 2026).
 */
export function createDeepStateMirror(opts = {}) {
  const projectRoot = opts.root || process.cwd();
  const cacheDir = opts.cacheDir || path.join(projectRoot, '.gev-cache', CACHE_DIR_NAME);
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const now = opts.now || Date.now;
  const log = opts.log || console.log;
  // Predvolene len cyterat; produkcia (vite.config.js) dáva obe — fork je záloha.
  const mirrors = Array.isArray(opts.mirrors) && opts.mirrors.length ? opts.mirrors : [DEEPSTATE_MIRRORS[0]];

  const memoryCache = new Map(); // dateKey -> { json, cachedAt }
  const mirrorOf = new Map(); // dateKey -> id mirroru, z ktorého súbor prišiel
  const missing = new Map(); // dateKey -> checkedAt (upstream povedal 404 / nepoužiteľné)
  const inFlight = new Map(); // dateKey -> Promise<json|null>
  const mirrorBackoff = new Map(); // id mirroru -> do kedy sa naň nechodí (po jeho chybe)
  let lastUpstreamStatus = null;
  const backoffUntil = (id) => mirrorBackoff.get(id) || 0;
  const allInBackoff = (t) => mirrors.every((m) => t < backoffUntil(m.id));
  function pauseMirror(mirror, error) {
    const until = now() + Math.min(BACKOFF_MAX_MS, Math.max(BACKOFF_MIN_MS, error?.retryAfterMs ?? 0));
    mirrorBackoff.set(mirror.id, until);
    lastUpstreamStatus = error?.upstreamStatus ?? null;
    log(`[deepstate-mirror] ${mirror.id}: ${error?.message || error} — pauza do ${new Date(until).toISOString()}`);
  }

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
      if (!isUsableSnapshot(parsed)) return null;
      // Pôvod súboru: bočný súbor `<deň>.mirror`; bez neho cyterat (všetko staršie prišlo odtiaľ).
      if (!mirrorOf.has(dateKey)) {
        try {
          const id = (await fsp.readFile(path.join(cacheDir, `${dateKey}.mirror`), 'utf8')).trim();
          if (DEEPSTATE_MIRRORS.some((m) => m.id === id)) mirrorOf.set(dateKey, id);
          else { log(`[deepstate-mirror] ${dateKey}.mirror: neznámy mirror „${id}" — beriem cyterat`); mirrorOf.set(dateKey, 'cyterat'); }
        } catch (error) {
          // Bez bočného súboru = cyterat; iná chyba čítania sa necachuje (skúsi sa znova).
          if (error?.code === 'ENOENT') mirrorOf.set(dateKey, 'cyterat');
        }
      }
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Súbor dňa + jeho pôvod na disk; true = uložené. Oboje cez .tmp + rename
   * (.gev-cache je junction na D:, lekcia EBUSY). Pôvod (`<deň>.mirror`) ide
   * PRED súbor dňa a pri jeho zlyhaní sa zmaže — súbor a štítok sa nerozídu;
   * cyterat bočný súbor nemá (a starý sa zmaže).
   */
  async function writeDisk(dateKey, text, mirrorId = 'cyterat') {
    const file = diskPath(dateKey);
    const side = path.join(cacheDir, `${dateKey}.mirror`);
    const tmp = `${file}.${process.pid}.tmp`;
    const sideTmp = `${side}.${process.pid}.tmp`;
    try {
      await fsp.mkdir(cacheDir, { recursive: true });
      if (mirrorId !== 'cyterat') { await fsp.writeFile(sideTmp, mirrorId, 'utf8'); await fsp.rename(sideTmp, side); }
      await fsp.writeFile(tmp, text, 'utf8');
      await fsp.rename(tmp, file);
      if (mirrorId === 'cyterat') await fsp.rm(side, { force: true });
      return true;
    } catch (error) {
      log(`[deepstate-mirror] zápis ${dateKey} (${mirrorId}) zlyhal: ${error?.message || error}`);
      await fsp.rm(tmp, { force: true }).catch(() => {});
      await fsp.rm(sideTmp, { force: true }).catch(() => {});
      if (mirrorId !== 'cyterat') await fsp.rm(side, { force: true }).catch(() => {});
      return false;
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
      // Mirrory po poradí: 404 / nepoužiteľný súbor / chyba jedného = skús ďalší.
      // Chyba dá TOMU mirroru pauzu (aj keď iný potom odpovie). „Nie je" (negatívna
      // cache) len keď NIKTO nemal súbor, nikto nezlyhal a nikto nebol v pauze.
      let firstError = null;
      let skipped = false;
      for (const mirror of mirrors) {
        if (now() < backoffUntil(mirror.id)) { skipped = true; continue; }
        let resp;
        try {
          resp = await fetchImpl(deepstateRawUrl(dateKey, mirror), {
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json, application/json' },
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
          });
        } catch (error) {
          const e = mapError(error);
          pauseMirror(mirror, e);
          firstError ||= e;
          continue;
        }
        if (resp.status === 404) continue;
        if (!resp.ok) {
          const e = new UpstreamError(resp.status, undefined, retryAfterMs(resp));
          pauseMirror(mirror, e);
          firstError ||= e;
          continue;
        }
        let text;
        try {
          text = typeof resp.text === 'function' ? await resp.text() : JSON.stringify(await resp.json());
        } catch (error) {
          const e = mapError(error); // timeout / prerušenie počas čítania tela
          pauseMirror(mirror, e);
          firstError ||= e;
          continue;
        }
        let geojson = null;
        try { geojson = JSON.parse(text); } catch { geojson = null; }
        if (!isUsableSnapshot(geojson)) {
          log(`[deepstate-mirror] ${dateKey} (${mirror.id}): súbor bez polygónu s rozlohou — preskočený, neukladá sa`);
          continue;
        }
        await writeDisk(dateKey, text, mirror.id);
        mirrorOf.set(dateKey, mirror.id);
        remember(dateKey, geojson);
        return geojson;
      }
      if (firstError) throw firstError;
      // Mirror v pauze mohol súbor mať — „nie je" by bolo tvrdenie bez dôkazu.
      if (skipped) throw new UpstreamError(lastUpstreamStatus ?? 'backoff', 'dostupné mirrory súbor nemajú, iný je v pauze');
      markMissing(dateKey);
      return null;
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

  /**
   * Nájde snímku: `requestedDate` (YYYYMMDD, už overený) alebo predvolene
   * VČERAJŠOK (kalendárny UTC deň, nie „teraz − 24 h"), potom až `maxFallback`
   * starších dní. Pri predvolenom dopyte, keď mirror stojí dlhšie než okno,
   * najnovší súbor z disku najviac 30 dní starý (`outsideWindow`).
   */
  async function lookup({ requestedDate = null, maxFallback = DEFAULT_MAX_FALLBACK_DAYS } = {}) {
    const started = now();
    const baseKey = requestedDate || getFormattedDateKey(1, new Date(started));
    const baseMs = parseDateKey(baseKey);

    let found = null;
    let fallbackDays = 0;
    let checkedDays = 0;
    let unresolvedDays = 0;
    let upstreamError = null;
    let budgetExhausted = false;
    const backoffActive = allInBackoff(started);

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
        if (result.data) { found = { key, data: result.data, source: result.source, mirror: mirrorOf.get(key) || 'cyterat' }; fallbackDays = i; break; }
      } catch (error) {
        // Po prvej chybe (nie 404) už GitHub nebombardujeme: v tomto dopyte len
        // pamäť a disk, a ďalšie dopyty čakajú aspoň minútu (alebo Retry-After).
        // Pauzu jednotlivým mirrorom dal fetchUpstream; tu sa už na GitHub nechodí.
        upstreamError = error;
        unresolvedDays += 1;
      }
    }

    // Mirror stojí dlhšie než okno: najnovší súbor z disku, najviac 30 dní starý —
    // len pri predvolenom dopyte; výslovný dátum dostane poctivé „nie je".
    let outsideWindow = false;
    if (!found && requestedDate === null) {
      const minKey = getFormattedDateKey(STALE_DISK_MAX_DAYS, new Date(baseMs));
      const disk = await newestOnDisk(minKey > MIRROR_FIRST_DAY ? minKey : MIRROR_FIRST_DAY, baseKey);
      if (disk) {
        found = { key: disk.key, data: disk.data, source: 'disk-stale', mirror: mirrorOf.get(disk.key) || 'cyterat' };
        fallbackDays = Math.round((baseMs - parseDateKey(disk.key)) / DAY_MS);
        outsideWindow = true;
      }
    }

    const upstreamProblem = Boolean(upstreamError) || (backoffActive && unresolvedDays > 0);
    return {
      baseKey,
      found,
      fallbackDays,
      checkedDays,
      unresolvedDays,
      outsideWindow,
      upstreamProblem,
      budgetExhausted,
      // Prečo je súbor starší / prečo nie je: mirror nedostupný (chyba / pauza po
      // chybe / čas) vs. novšie súbory naozaj neexistujú.
      upstreamUnavailable: unresolvedDays > 0,
      upstreamStatus: unresolvedDays > 0 || upstreamProblem
        ? (upstreamError?.upstreamStatus ?? (budgetExhausted && !backoffActive ? 'timeout' : lastUpstreamStatus))
        : null,
      retryAfterSec: Math.max(1, Math.ceil((Math.min(...mirrors.map((m) => backoffUntil(m.id))) - now()) / 1000)),
    };
  }

  return { lookup, cacheDir, now, mirrors };
}

/**
 * Vite plugin pre `/api/deepstate/analytics` (len JSON; stránka dema zmazaná 24. 9. 2026).
 * `opts.mirror` = zdieľané jadro; bez neho si plugin vytvorí vlastné.
 */
export function deepstateAnalyticsProxy(opts = {}) {
  const mirror = opts.mirror || createDeepStateMirror(opts);
  const now = opts.now || mirror.now || Date.now;
  const log = opts.log || console.log;
  const limiter = simpleLimiter({ windowMs: 60_000, max: 60, now });

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
    const todayKey = getFormattedDateKey(0, new Date(now()));
    const rawDate = url.searchParams.get('date');
    const requestedDate = rawDate === null || rawDate === '' ? null : rawDate;
    if (requestedDate !== null) {
      const reason = dateKeyProblem(requestedDate, todayKey);
      if (reason) {
        send(req, res, 400, { ok: false, error: 'bad_date', reason, requestedDate, firstDay: MIRROR_FIRST_DAY, today: todayKey });
        return;
      }
    }
    const maxFallback = parseMaxFallback(url.searchParams.get('maxFallback'));
    const r = await mirror.lookup({ requestedDate, maxFallback });

    if (!r.found) {
      const who = { requestedDate: requestedDate || 'yesterday', checkedDays: r.checkedDays, unresolvedDays: r.unresolvedDays };
      if (r.upstreamProblem) {
        send(req, res, 502, { ok: false, error: 'upstream_unavailable', upstreamStatus: r.upstreamStatus, ...who }, { 'Retry-After': String(r.retryAfterSec) });
      } else if (r.budgetExhausted) {
        send(req, res, 503, { ok: false, error: 'upstream_slow', ...who }, { 'Retry-After': '30' });
      } else {
        send(req, res, 404, { ok: false, error: 'no_data_available', ...who });
      }
      return;
    }

    const found = r.found;
    const areaKm2 = calculateGeoJsonAreaKm2(found.data);
    const payload = {
      ok: true,
      date: formatDisplayDate(found.key),
      dateKey: found.key,
      requestedDate: requestedDate ? formatDisplayDate(requestedDate) : null,
      fallbackDays: r.fallbackDays,
      stale: r.fallbackDays > 0,
      outsideWindow: r.outsideWindow,
      upstreamUnavailable: r.upstreamUnavailable,
      upstreamStatus: r.upstreamUnavailable ? r.upstreamStatus : null,
      areaKm2,
      formattedArea: Math.round(areaKm2).toLocaleString('en-US') + ' km²',
      areaMethod: DEEPSTATE_ANALYTICS_AREA_METHOD,
      featuresCount: Array.isArray(found.data.features) ? found.data.features.length : 1,
      sourceUrl: deepstateRawUrl(found.key, DEEPSTATE_MIRRORS.find((m) => m.id === found.mirror) || DEEPSTATE_MIRRORS[0]),
      mirror: found.mirror,
      attribution: deepstateAnalyticsAttribution(found.mirror),
      license: deepstateMirrorLicense(found.mirror),
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
    _dir: mirror.cacheDir,
    _mirror: mirror,
    _calculateArea: calculateGeoJsonAreaKm2,
  };
}
