// src/data/mideastEventsProxy.js
/**
 * @module mideastEventsProxy
 * @description Vite plugin modulu BLÍZKY VÝCHOD (etapa 2 „KONTROLA SÍDIEL", 2026-09-26;
 * plán docs/drafts/blizky-vychod-plan.md kap. 5–6): archivár na pozadí +
 * `/api/mideast/events`. Beží LEN v Node (vite.config.js ho importuje ako
 * ukraineEventsProxy), nikdy v prehliadači. Sesterský modul ukraineEventsProxy.js —
 * pomocníci (limiter, kľúč klienta, send) sú zámerne skopírované, lebo samostatný
 * modul pluginu nemôže importovať z vite.config.js (cyklus + spustenie celej konfigurácie).
 *
 * Archivár (kým dev server beží — úloha Plánovača ho drží stále): jedna úloha
 * `control:<modul>` na každý modul Wikipédie (israel-palestine, yemen, syria, lebanon),
 * tik 6 h, prvé spustenia rozostúpené o minútu (200/260/320/380 s po štarte), aby
 * na Wikipédiu nešli štyri dopyty naraz (etiketa Wikimedia: jeden dopyt naraz).
 * Čerstvosť drží knižnica (fetchedAt na disku) — reštarty dev servera po zmene
 * vite.config.js upstream nezaťažia. Vypnutie: `MIDEAST_ARCHIVE=off`.
 *
 * Trasy (connect odstrihne prefix montáže, v handleri je `url.pathname` už `/status`…):
 *  - `/status` (pred limiterom): stav archivára BEZ textov chýb — len počty, časy a
 *    prehľad snímok na disku (verejná doména číta /api priamo cez tunel);
 *  - `/control?module=<id>&at=YYYY-MM-DD`: snímka platná pre deň (posledná čitateľná ≤ at),
 *    400 bad_module (so zoznamom modulov) / bad_day, 404 no_control_snapshot (žiadny deň ≤ at),
 *    500 archive_read_failed (dni ≤ at sú, no ani jeden sa nedá prečítať),
 *    200 `{ ...snapshot, requestedAt, snapshots, first, last }` s bodmi;
 *    cache 10 min na `${module}:${at}`, strop 64 kľúčov; gzip nad 1 KiB len pri tokene
 *    `gzip` s q > 0 (`acceptsGzip`) a s `Vary: Accept-Encoding` na každej stlačiteľnej 200.
 *  - `/portwatch?keys=hormuz,suez&days=400` (etapa 5a, 2026-09-26): denné prechody úžinami
 *    z IMF PortWatch — posledných `days` riadkov (30–1 000, predvolene 400) + priemer okna
 *    „pred krízou" z celej série; 400 bad_keys, 404 no_portwatch_snapshot; cache 10 min.
 *    Úloha `portwatch` (tik 6 h, prvá 440 s po štarte) obnovuje štyri úžiny postupne.
 * Bezpečnosť handlera: každý `await` aj `new URL` v try/catch — odmietnutý Promise
 * z async connect middleware zhodí dev server.
 */
import zlib from 'node:zlib';

import { MIDEAST_CONTROL_MODULE_IDS } from './wikiControl.js';
import { PORTWATCH_KEYS } from './portwatch.js';
import { controlDays, controlFor, controlIndex, dayKey, isDay, portwatchPayload, portwatchRefresh, wikiControlSnapshot } from '../../scripts/lib/mideastArchive.mjs';

const MIN = 60_000;
/** Tik úlohy kontroly (moduly Wikipédie sa menia po hodinách; história cez CLI). */
export const CONTROL_TICK_MS = 6 * 60 * MIN;
/** Prvé spustenie prvého modulu po štarte servera; ďalšie moduly o `CONTROL_STAGGER_MS` neskôr. */
export const CONTROL_FIRST_DELAY_MS = 200_000;
export const CONTROL_STAGGER_MS = 60_000;
export const CONTROL_CACHE_TTL_MS = 10 * MIN;
export const CONTROL_CACHE_MAX = 64;
export const MIDEAST_EVENTS_MOUNT = '/api/mideast/events';
/** Úloha PortWatch: tik 6 h (dataset MMF ide raz týždenne), prvý beh po moduloch Wikipédie. */
export const PORTWATCH_TICK_MS = 6 * 60 * MIN;
export const PORTWATCH_FIRST_DELAY_MS = 440_000;
/** Pauza medzi úžinami v jednom tiku (verejný ArcGIS, bez kľúča — nezahlcovať). */
export const PORTWATCH_PAUSE_MS = 1_500;
export const PORTWATCH_DAYS_DEFAULT = 400;

function simpleLimiter({ windowMs, max }) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) { hits.set(key, recent); return false; }
    recent.push(now); hits.set(key, recent);
    if (hits.size > 500) hits.delete(hits.keys().next().value);
    return true;
  };
}
// Kľúč limitera: CF-Connecting-IP (nastavuje Cloudflare), inak socket. X-Forwarded-For
// sa zámerne nepoužíva — prvú hodnotu si klient volí sám (kontrola 24. 9. 2026).
const clientKey = (req) => {
  const cf = req.headers?.['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return cf.trim();
  return String(req.socket?.remoteAddress || 'anon');
};

/** Názov úlohy archivára pre modul. Pure. */
export const controlJobName = (moduleId) => `control:${moduleId}`;

/**
 * Klient prijíma gzip len s VÝSLOVNÝM tokenom `gzip` a q > 0: `gzip;q=0, identity` je
 * odmietnutie (holé /\bgzip\b/ by ho vzalo ako súhlas), `*` sa zámerne neberie, chýbajúce
 * alebo nečitateľné q = 1 resp. odmietnutie — identita je vždy bezpečná. Pure.
 */
export function acceptsGzip(acceptEncoding) {
  for (const part of String(acceptEncoding || '').split(',')) {
    const [token, ...params] = part.split(';').map((s) => s.trim().toLowerCase());
    if (token !== 'gzip') continue;
    const q = params.find((p) => p.startsWith('q='));
    if (!q) return true;
    const value = Number(q.slice(2));
    return Number.isFinite(value) && value > 0;
  }
  return false;
}

/**
 * @param {{root?: string, env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, now?: () => number, setTimer?: Function, clearTimer?: Function, log?: Function}} [opts]
 *   `now` je FUNKCIA (plugin volá `now()`); do knižnice ide číslo `now()`.
 * @returns {import('vite').Plugin & {_tick: (name: string) => Promise<void>, _state: object, _start: (base: string) => void, _stop: () => void}}
 */
export function mideastEventsProxy({ root = process.cwd(), env = process.env, fetchImpl = (...a) => fetch(...a), now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, log = (m) => console.log(m), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const enabled = env.MIDEAST_ARCHIVE !== 'off';
  const limiter = simpleLimiter({ windowMs: MIN, max: 40 });
  const controlCache = new Map(); // `${module}:${at}` -> { at, json }
  const portwatchCache = new Map(); // `${keys}:${days}` -> { at, json }
  const timers = new Map();
  const state = { enabled, base: null, running: {}, last: {}, errors: [] };
  const note = (name, error) => { const msg = `${name}: ${error?.message || error}`; state.errors = [{ at: now(), msg }, ...state.errors].slice(0, 20); log(`[mideast-events] ${msg}`); };

  const dropCacheFor = (moduleId) => { for (const key of [...controlCache.keys()]) if (key.startsWith(`${moduleId}:`)) controlCache.delete(key); };

  // Územná kontrola (Wikipedia, CC BY-SA): najnovšia snímka každého modulu raz za 6 h;
  // história po týždňoch ide cez CLI (scripts/build-mideast-events.mjs --control-history).
  const jobs = {};
  const tickMs = {};
  const firstDelayMs = {};
  MIDEAST_CONTROL_MODULE_IDS.forEach((moduleId, i) => {
    const name = controlJobName(moduleId);
    jobs[name] = async () => {
      const r = await wikiControlSnapshot(root, moduleId, { fetchImpl, now: now(), log });
      if (r.status === 'updated') dropCacheFor(moduleId);
      return r;
    };
    tickMs[name] = CONTROL_TICK_MS;
    firstDelayMs[name] = CONTROL_FIRST_DELAY_MS + i * CONTROL_STAGGER_MS;
  });
  // IMF PortWatch (etapa 5a): štyri úžiny postupne s pauzou; čerstvosť 6 h drží knižnica.
  jobs.portwatch = async () => {
    const results = [];
    for (const [i, key] of PORTWATCH_KEYS.entries()) {
      if (i) await sleep(PORTWATCH_PAUSE_MS);
      results.push(await portwatchRefresh(root, key, { fetchImpl, now: now(), log }));
    }
    if (results.some((r) => r.status === 'updated')) portwatchCache.clear();
    const failed = results.filter((r) => r.status === 'error' || r.status === 'stale');
    const lastDay = results.map((r) => r.lastDay).filter(Boolean).sort().at(-1) || null;
    return { status: failed.length ? (failed.length === results.length ? 'error' : 'partial') : (results.some((r) => r.status === 'updated') ? 'updated' : 'fresh'), day: lastDay, count: results.reduce((s, r) => s + (r.count || 0), 0) };
  };
  tickMs.portwatch = PORTWATCH_TICK_MS;
  firstDelayMs.portwatch = PORTWATCH_FIRST_DELAY_MS;

  async function tick(name) {
    if (!jobs[name] || state.running[name]) return;
    state.running[name] = true;
    const started = now();
    try {
      const result = await jobs[name]();
      state.last[name] = { at: now(), ms: now() - started, result };
    } catch (error) { state.last[name] = { at: now(), ms: now() - started, error: String(error?.message || error) }; note(name, error); }
    finally { state.running[name] = false; }
  }
  // Zastavenie počas behu úlohy: `stop()` zruší časovače, no tik, ktorý práve čaká na
  // Wikipédiu (až 60 s), by sa po `await` znova naplánoval na mŕtvej inštancii (reštart
  // Vite po úprave vite.config.js → zombie archivár na 6 h). Preto príznak `stopped` +
  // generácia štartu: spätné volanie sa po tiku preplánuje len v tej istej generácii.
  let stopped = false;
  let generation = 0;
  function schedule(name, delay) {
    clearTimer(timers.get(name));
    const gen = generation;
    timers.set(name, setTimer(async () => {
      await tick(name);
      if (stopped || gen !== generation || !timers.has(name)) return;
      schedule(name, tickMs[name]);
    }, delay));
  }
  function start(base) {
    state.base = base;
    stopped = false;
    generation += 1;
    if (!enabled) { log('[mideast-events] archiver disabled (MIDEAST_ARCHIVE=off)'); return; }
    for (const name of Object.keys(jobs)) schedule(name, firstDelayMs[name]);
    log(`[mideast-events] archiver started (base ${base}; control ×${MIDEAST_CONTROL_MODULE_IDS.length} every 6 h, first after ${CONTROL_FIRST_DELAY_MS / 1000} s)`);
  }
  function stop() { stopped = true; for (const t of timers.values()) clearTimer(t); timers.clear(); }

  function send(res, status, json, req) {
    const body = Buffer.from(JSON.stringify(json));
    const compressible = status === 200 && body.length > 1024;
    const gzip = compressible && acceptsGzip(req?.headers?.['accept-encoding']);
    const out = gzip ? zlib.gzipSync(body, { level: 6 }) : body;
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': status === 200 ? 'public, max-age=60' : 'no-store', 'Content-Length': String(out.length) };
    // Telo sa líši podľa Accept-Encoding → zdieľaná cache (tunel ↔ klient) nesmie dať gzip klientovi bez gzipu.
    if (compressible) headers.Vary = 'Accept-Encoding';
    if (gzip) headers['Content-Encoding'] = 'gzip';
    res.writeHead(status, headers);
    res.end(out);
  }

  /** Verejný stav: žiadne texty chýb (tunel ich pustí von), len počty, časy a stav úloh. */
  function publicStatus(index) {
    const last = {};
    for (const [name, v] of Object.entries(state.last)) {
      const r = v.result || null;
      last[name] = { at: v.at, ms: v.ms, ok: !v.error && r?.status !== 'error', status: v.error ? 'error' : (r?.status ?? null), day: r?.day ?? null, count: r?.count ?? null, revisionAt: r?.revisionAt ?? null };
    }
    return { enabled, now: now(), running: { ...state.running }, last, errors: state.errors.length, lastErrorAt: state.errors[0]?.at ?? null, control: index };
  }

  async function route(req, res) {
    if (req.method !== 'GET') { send(res, 405, { error: 'Method Not Allowed' }, req); return; }
    let url; try { url = new URL(req.url || '/', 'http://localhost'); } catch { send(res, 400, { error: 'bad_url' }, req); return; }
    const sub = url.pathname.replace(/\/+$/, '');
    if (sub === '/status') {
      let index = null;
      try { index = await controlIndex(root); } catch (error) { note('status', error); }
      send(res, 200, publicStatus(index), req);
      return;
    }
    if (!limiter(clientKey(req))) { send(res, 429, { error: 'rate_limited' }, req); return; }
    if (sub === '/control') {
      // Snímka kontroly modulu platná pre deň `at` (posledná so dňom ≤ at); bez `at` = dnes.
      const moduleId = url.searchParams.get('module') || '';
      if (!MIDEAST_CONTROL_MODULE_IDS.includes(moduleId)) { send(res, 400, { error: 'bad_module', modules: [...MIDEAST_CONTROL_MODULE_IDS] }, req); return; }
      const at = url.searchParams.get('at') || dayKey(now());
      if (!isDay(at)) { send(res, 400, { error: 'bad_day' }, req); return; }
      const key = `${moduleId}:${at}`;
      const hit = controlCache.get(key);
      if (hit && now() - hit.at < CONTROL_CACHE_TTL_MS) { send(res, 200, hit.json, req); return; }
      try {
        const days = await controlDays(root, moduleId);
        const snapshot = await controlFor(root, moduleId, at, { days });
        if (!snapshot) {
          // Dni ≤ at na disku sú, no žiadny sa nedá prečítať (controlFor ich prešiel všetky) = chyba archívu, nie „bez snímky".
          if (days.some((d) => d <= at)) { note('control', new Error(`unreadable control snapshots ${moduleId} ≤ ${at}`)); send(res, 500, { error: 'archive_read_failed' }, req); return; }
          send(res, 404, { error: 'no_control_snapshot', module: moduleId, at, days: days.length }, req);
          return;
        }
        const json = { ...snapshot, requestedAt: at, snapshots: days.length, first: days[0] || null, last: days.at(-1) || null };
        controlCache.set(key, { at: now(), json });
        if (controlCache.size > CONTROL_CACHE_MAX) controlCache.delete(controlCache.keys().next().value);
        send(res, 200, json, req);
      } catch (error) { note('control', error); send(res, 500, { error: 'archive_read_failed' }, req); }
      return;
    }
    if (sub === '/portwatch') {
      // Prechody úžinami (IMF PortWatch): kľúče z allowlistu, chvost `days` riadkov + priemer pred krízou.
      const rawKeys = (url.searchParams.get('keys') || PORTWATCH_KEYS.join(',')).split(',').map((k) => k.trim()).filter(Boolean);
      const keys = [...new Set(rawKeys)];
      if (!keys.length || keys.some((k) => !PORTWATCH_KEYS.includes(k))) { send(res, 400, { error: 'bad_keys', keys: [...PORTWATCH_KEYS] }, req); return; }
      const daysRaw = Number(url.searchParams.get('days') || PORTWATCH_DAYS_DEFAULT);
      const days = Number.isFinite(daysRaw) ? Math.min(1000, Math.max(30, Math.floor(daysRaw))) : PORTWATCH_DAYS_DEFAULT;
      const cacheKey = `${keys.join(',')}:${days}`;
      const hit = portwatchCache.get(cacheKey);
      if (hit && now() - hit.at < CONTROL_CACHE_TTL_MS) { send(res, 200, hit.json, req); return; }
      try {
        const json = await portwatchPayload(root, keys, { days, nowMs: now() });
        if (!json.chokepoints.length) { send(res, 404, { error: 'no_portwatch_snapshot', keys }, req); return; }
        portwatchCache.set(cacheKey, { at: now(), json });
        if (portwatchCache.size > CONTROL_CACHE_MAX) portwatchCache.delete(portwatchCache.keys().next().value);
        send(res, 200, json, req);
      } catch (error) { note('portwatch', error); send(res, 500, { error: 'archive_read_failed' }, req); }
      return;
    }
    // Udalosti (`/?from&to`) prídu v ďalších etapách plánu; kým nie sú, poctivé 404.
    send(res, 404, { error: 'not_found', routes: ['/status', '/control?module=<id>&at=YYYY-MM-DD', '/portwatch?keys=<k,…>&days=N'], modules: [...MIDEAST_CONTROL_MODULE_IDS] }, req);
  }
  async function handler(req, res) {
    try { await route(req, res); } catch (error) {
      note('handler', error);
      try { if (!res.headersSent) send(res, 500, { error: 'internal' }, req); } catch { /* spojenie už padlo */ }
    }
  }
  function install(server) {
    server.middlewares.use(MIDEAST_EVENTS_MOUNT, handler);
    const http = server.httpServer;
    if (!http) return;
    const onListening = () => {
      const addr = http.address();
      if (!addr || typeof addr !== 'object') return;
      const host = addr.address.includes(':') ? `[${addr.address}]` : addr.address;
      start(`http://${host}:${addr.port}`);
    };
    if (http.listening) onListening(); else http.once('listening', onListening);
    http.once('close', stop);
  }
  return {
    name: 'mideast-events-proxy',
    configureServer(server) { install(server); },
    configurePreviewServer(server) { install(server); },
    _tick: tick,
    _state: state,
    _start: start,
    _stop: stop,
  };
}
