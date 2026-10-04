// Admin panel OKO (2026-10-03) — beh telemetrie, vypínačov feedov a oznamu.
//
// • middleware pred všetkými proxy: hodinové štatistiky /api/* po feedoch
//   (počet, 4xx, 5xx, latencia, bajty), vypnutý feed → 503, denný strop → 429
// • /api/telemetry/hit: anonymné návštevy z glóbusu (bez cookie, bez IP v DB;
//   hash návštevníka s dennou soľou zmizne po skončení dňa), aktívne minúty,
//   zapnuté vrstvy, JS chyby prehliadača
// • /api/notice: verejný oznam a zoznam vypnutých zdrojov (pravidlo 2: glóbus
//   musí ukázať, že vrstva nie je živá)
// • zachytenie console.error/warn servera a HTTP 5xx do tabuľky chýb, s
//   redakciou kľúčov (hodnoty z .env sa nahradia ***)
//
// Zápis do SQLite ide raz za minútu z pamäte, takže požiadavka nečaká na disk.
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import http from 'node:http';
import { FEEDS, feedById, feedForPath, isStatusPath, routeKey } from './feeds.js';
import { LOOPBACK_HOST } from './loopback.js';

export const TIME_ZONE = 'Europe/Bratislava';
const FLUSH_MS = 60_000;
const SAMPLE_MS = 10 * 60_000;
const LIVE_MS = 2.5 * 60_000;
const HIT_MAX_BYTES = 4096;
const HITS_PER_MIN = 60;
const ERRORS_PER_MIN = 10;
const NOINDEX = 'noindex, nofollow, noarchive';
/** Max. rôznych hodnôt jednej dimenzie za deň; ďalšie idú do „iné" (ochrana pred nafúknutím DB). */
const MAX_DIM_VALUES = 300;

const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', hourCycle: 'h23' });
/** Miestny deň (Bratislava) ako YYYY-MM-DD. */
export const localDay = time => dayFmt.format(new Date(time));
export const localHour = time => hourFmt.format(new Date(time)).padStart(2, '0');

// ── pomocné čisté funkcie (testované) ─────────────────────────────────────
export function parseUserAgent(raw = '') {
  const ua = String(raw).slice(0, 512);
  const bot = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|curl|wget|python|go-http|axios|node-fetch/i.test(ua);
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung'
    : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'iné';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows'
    : /Macintosh|Mac OS X/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'iné';
  const device = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) ? 'tablet'
    : /Mobi|iPhone|Android/.test(ua) ? 'mobil' : 'desktop';
  return { bot, browser, os, device };
}

export function screenBucket(width) {
  const w = Number(width);
  if (!Number.isFinite(w) || w <= 0) return 'neznáme';
  return w < 480 ? '< 480' : w < 768 ? '480–767' : w < 1024 ? '768–1023' : w < 1440 ? '1024–1439' : w < 1920 ? '1440–1919' : '≥ 1920';
}

/** Host referera; vlastné hosty a prázdne = „priamo". */
export function referrerHost(raw, ownHosts = []) {
  if (!raw) return 'priamo';
  try {
    const host = new URL(String(raw).slice(0, 500)).hostname.toLowerCase().replace(/^www\./, '');
    if (!host || ownHosts.some(own => host === own || host.endsWith('.' + own))) return 'priamo';
    return host.slice(0, 80);
  } catch { return 'neznámy'; }
}

/** Cesta stránky bez query; zdieľané odkazy zlúčené do /s/*. */
export function pagePath(raw) {
  const value = String(raw || '/').split(/[?#]/)[0].slice(0, 120);
  if (/^\/s\/[^/]+/.test(value)) return '/s/*';
  return /^\/[\w./-]*$/.test(value) ? value : '/';
}

const SECRET_PARAM = /([?&;\s"']?(?:api[_-]?key|key|token|access[_-]?token|secret|password|passwd|auth|signature|sig|map_key|client_secret)=)[^&\s"']+/gi;
/** Odstráni tajomstvá z textu chyby: hodnoty z .env, parametre URL, Bearer. */
export function redact(text, secrets = []) {
  let out = String(text ?? '');
  for (const secret of secrets) if (secret) out = out.split(secret).join('***');
  return out.replace(SECRET_PARAM, '$1***').replace(/Bearer\s+[\w.~+/=-]+/gi, 'Bearer ***')
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, 'sk-***');
}

/** Hodnoty z prostredia, ktoré vyzerajú ako tajomstvo — na redakciu logov. */
export function secretValues(env = process.env) {
  return Object.entries(env)
    .filter(([key, value]) => /KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIAL|AUTH/i.test(key) && typeof value === 'string' && value.length >= 8)
    .map(([, value]) => value).sort((a, b) => b.length - a.length);
}

const signature = (kind, message, where = '') => createHash('sha256')
  .update(`${kind}\n${String(message).replace(/\d+/g, '#').replace(/[0-9a-f]{8,}/gi, '~').slice(0, 300)}\n${where}`)
  .digest('hex').slice(0, 32);

function clientIp(req) {
  const socket = req.socket?.remoteAddress || '';
  const forwarded = req.headers['cf-connecting-ip'];
  // Len pre štatistiku: za tunelom je socket vždy loopback, skutočnú adresu dáva Cloudflare.
  if (typeof forwarded === 'string' && isIP(forwarded) && /^(127\.|::1$|::ffff:127\.)/.test(socket)) return forwarded;
  return socket || 'unknown';
}

/**
 * @param {object} options
 * @param {ReturnType<import('./store.js').openAdminStore>} options.store
 * @param {() => number} [options.now]
 * @param {string[]} [options.ownHosts] vlastné domény (referer z nich = priamo)
 * @param {string[]} [options.secrets] hodnoty na redakciu
 * @param {() => number|null} [options.port] port servera pre vzorkovanie statusov
 */
export function createAdminRuntime({ store, now = Date.now, ownHosts = [], secrets = [], port = () => null,
  fetchStatus = loopbackStatus, timers = true } = {}) {
  // buffre do ďalšieho flushu
  let traffic = new Map();
  let pageviews = new Map();
  let visitors = new Map();
  let errors = new Map();
  let samples = [];
  const live = new Map(); // hash → posledný ping (len v pamäti)
  const limiter = new Map(); // ip → { minute, hits, errors } (len v pamäti)
  const caps = { day: localDay(now()), counts: new Map() };
  let settingsCache = null;
  const dimValues = { day: '', sets: new Map() }; // deň → dim → videné hodnoty (len v pamäti)

  // Dnešné počty pre stropy prežijú reštart: dopočítajú sa z uloženej štatistiky.
  const startDay = localDay(now());
  for (const row of store.routeHours(FEEDS.filter(f => f.paid).map(f => f.id), Math.floor(now() / 3600_000) - 30)) {
    if (localDay(row.hour * 3600_000) === startDay) caps.counts.set(row.route, (caps.counts.get(row.route) || 0) + row.n - row.blocked);
  }

  function feedSettings() {
    if (!settingsCache) settingsCache = new Map(store.settings('feed:').map(([key, value]) => [key.slice(5), value]));
    return settingsCache;
  }
  const feedSetting = id => ({ enabled: true, dailyCap: null, unitPrice: null, ...(feedSettings().get(id) || {}) });

  function addTraffic(route, status, ms, bytes, blocked = false) {
    const hour = Math.floor(now() / 3600_000);
    const key = `${hour}|${route}`;
    const t = traffic.get(key) || { hour, route, n: 0, e4: 0, e5: 0, blocked: 0, msSum: 0, msMax: 0, bytes: 0 };
    t.n++;
    if (blocked) t.blocked++;
    else if (status >= 500) t.e5++;
    else if (status >= 400) t.e4++;
    t.msSum += ms; t.msMax = Math.max(t.msMax, ms); t.bytes += bytes;
    traffic.set(key, t);
  }
  function addPv(day, dim, raw, n = 1) {
    if (dimValues.day !== day) { dimValues.day = day; dimValues.sets.clear(); }
    const seen = dimValues.sets.get(dim) || new Set();
    dimValues.sets.set(dim, seen);
    let val = String(raw).slice(0, 80);
    if (!seen.has(val)) {
      if (seen.size >= MAX_DIM_VALUES) val = 'iné';
      else seen.add(val);
    }
    const key = `${day}|${dim}|${val}`;
    const p = pageviews.get(key) || { day, dim, val, n: 0 };
    p.n += n;
    pageviews.set(key, p);
  }
  function recordError(kind, message, detail = '') {
    const text = redact(message, secrets).slice(0, 500);
    if (!text.trim()) return;
    const sig = signature(kind, text, String(detail).split('\n')[0]);
    const time = now();
    const e = errors.get(sig) || { sig, kind, message: text, detail: '', count: 0, firstAt: time, lastAt: time };
    e.count++; e.lastAt = time; e.detail = redact(detail, secrets).slice(0, 1500);
    errors.set(sig, e);
    if (errors.size > 500) flush();
  }
  function allow(ip, kind) {
    const minute = Math.floor(now() / 60_000);
    let entry = limiter.get(ip);
    if (!entry || entry.minute !== minute) {
      if (limiter.size > 20_000) limiter.clear();
      entry = { minute, hits: 0, errors: 0 };
      limiter.set(ip, entry);
    }
    entry[kind]++;
    return entry[kind] <= (kind === 'errors' ? ERRORS_PER_MIN : HITS_PER_MIN);
  }
  function capCount(id) {
    const day = localDay(now());
    if (caps.day !== day) { caps.day = day; caps.counts.clear(); }
    return caps.counts.get(id) || 0;
  }

  function flush() {
    const batch = { traffic: [...traffic.values()], pageviews: [...pageviews.values()],
      visitors: [...visitors.values()], errors: [...errors.values()], samples };
    traffic = new Map(); pageviews = new Map(); visitors = new Map(); errors = new Map(); samples = [];
    try { store.flush(batch); } catch (error) { originalConsole.warn?.('[admin] telemetry flush failed:', error?.message); }
  }
  let lastMaintenance = 0;
  function maintenance() {
    const time = now();
    if (time - lastMaintenance < 3600_000) return;
    lastMaintenance = time;
    try { store.rollup(localDay(time)); store.prune(time); } catch { /* ďalší pokus o hodinu */ }
  }

  async function sampleFeeds() {
    const p = port();
    if (!p) return;
    for (const feed of FEEDS.filter(f => f.sample)) {
      const result = await fetchStatus(p, feed.status);
      samples.push({ at: now(), feed: feed.id, ok: result.status >= 200 && result.status < 300, status: result.status, ms: result.ms });
    }
  }

  // ── middleware pred proxy ─────────────────────────────────────────────
  function middleware(req, res, next) {
    const pathname = String(req.url || '/').split('?')[0];
    const route = routeKey(pathname);
    if (!route) return next();
    const started = performance.now();
    const feed = feedForPath(pathname);
    let blocked = false;
    res.once('finish', () => {
      const ms = performance.now() - started;
      const bytes = Number(res.getHeader('content-length')) || 0;
      addTraffic(route, res.statusCode, ms, bytes, blocked);
      if (res.statusCode >= 500 && !blocked) recordError('http', `HTTP ${res.statusCode} ${req.method} ${route}`, pathname);
    });
    if (feed?.toggle && !isStatusPath(pathname)) {
      const setting = feedSetting(feed.id);
      if (setting.enabled === false) {
        blocked = true;
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '300', 'X-Robots-Tag': NOINDEX });
        res.end(JSON.stringify({ error: 'disabled_by_admin', feed: feed.id, message: 'Zdroj je dočasne vypnutý prevádzkovateľom.' }));
        return;
      }
      if (feed.paid) {
        if (Number.isFinite(setting.dailyCap) && capCount(feed.id) >= setting.dailyCap) {
          blocked = true;
          res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '3600', 'X-Robots-Tag': NOINDEX });
          res.end(JSON.stringify({ error: 'budget', scope: 'admin_daily_cap', feed: feed.id }));
          return;
        }
        caps.counts.set(feed.id, capCount(feed.id) + 1);
      }
    }
    next();
  }

  // ── verejné endpointy ─────────────────────────────────────────────────
  function sendJson(res, status, body, cache = 'no-store') {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': NOINDEX });
    res.end(body === null ? '' : JSON.stringify(body));
  }
  function readBody(req) {
    return new Promise(resolve => {
      let size = 0; const chunks = [];
      req.on('data', chunk => { size += chunk.length; if (size <= HIT_MAX_BYTES) chunks.push(chunk); });
      req.on('end', () => resolve(size > HIT_MAX_BYTES ? null : Buffer.concat(chunks).toString('utf8')));
      req.on('error', () => resolve(null));
    });
  }
  function notice() {
    const stored = store.getSetting('notice')?.value;
    const active = stored?.text && (!stored.until || stored.until > now()) ? stored : null;
    const disabled = FEEDS.filter(feed => feed.toggle && feedSetting(feed.id).enabled === false).map(feed => feed.label);
    return {
      notice: active ? { id: createHash('sha256').update(`${active.text}|${active.level}`).digest('hex').slice(0, 12), text: active.text, level: active.level || 'info' } : null,
      disabled,
    };
  }

  async function handleHit(req, res) {
    // Prehliadač s Do Not Track / GPC posiela nič — server to rešpektuje aj pre istotu.
    if (req.headers.dnt === '1' || req.headers['sec-gpc'] === '1') return sendJson(res, 204, null);
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin') return sendJson(res, 403, { error: 'origin' });
    const raw = await readBody(req);
    let hit;
    try { hit = JSON.parse(raw); } catch { return sendJson(res, 400, { error: 'invalid' }); }
    if (!hit || typeof hit !== 'object') return sendJson(res, 400, { error: 'invalid' });
    const ip = clientIp(req);
    const kind = hit.t === 'error' ? 'errors' : 'hits';
    if (!allow(ip, kind)) return sendJson(res, 429, { error: 'rate_limited' });
    const ua = parseUserAgent(req.headers['user-agent']);
    const time = now();
    const day = localDay(time);
    if (hit.t === 'error') {
      const where = `${String(hit.src || '').split('?')[0].slice(0, 200)}:${Number(hit.line) || 0}`;
      recordError('client', String(hit.msg || 'Neznáma chyba'), `${where}\n${ua.browser} · ${ua.os}\n${String(hit.stack || '').slice(0, 1000)}`);
      return sendJson(res, 204, null);
    }
    if (ua.bot) { addPv(day, 'bots', ''); return sendJson(res, 204, null); }
    const hash = createHash('sha256').update(`${store.salt(day)}|${ip}|${String(req.headers['user-agent'] || '').slice(0, 512)}`).digest('base64url').slice(0, 22);
    if (hit.t === 'view') {
      visitors.set(`${day}|${hash}`, { day, hash });
      live.set(hash, time);
      addPv(day, 'views', '');
      addPv(day, 'path', pagePath(hit.p));
      addPv(day, 'ref', referrerHost(hit.r, ownHosts));
      const country = String(req.headers['cf-ipcountry'] || '').toUpperCase();
      addPv(day, 'country', /^[A-Z]{2}$/.test(country) && country !== 'XX' ? country : '??');
      addPv(day, 'browser', ua.browser);
      addPv(day, 'os', ua.os);
      addPv(day, 'device', ua.device);
      addPv(day, 'screen', screenBucket(hit.w));
      const lang = String(hit.l || '').toLowerCase().split('-')[0];
      addPv(day, 'lang', /^[a-z]{2,3}$/.test(lang) ? lang : '??');
      addPv(day, 'hour', localHour(time));
    } else if (hit.t === 'ping') {
      live.set(hash, time);
      addPv(day, 'minutes', '');
    } else if (hit.t === 'layer') {
      const layer = String(hit.layer || '');
      if (!/^[\w-]{1,48}$/.test(layer)) return sendJson(res, 400, { error: 'invalid' });
      addPv(day, 'layer', layer);
    } else return sendJson(res, 400, { error: 'invalid' });
    return sendJson(res, 204, null);
  }

  async function handlePublic(req, res, next) {
    const pathname = String(req.url || '/').split('?')[0];
    if (pathname === '/api/notice') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method_not_allowed' });
      return sendJson(res, 200, notice(), 'public, max-age=30');
    }
    if (pathname === '/api/telemetry/hit') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });
      try { return await handleHit(req, res); } catch { return sendJson(res, 400, { error: 'invalid' }); }
    }
    return next();
  }

  // ── zachytenie chýb servera ───────────────────────────────────────────
  const originalConsole = { error: console.error, warn: console.warn };
  let consoleInstalled = false;
  function installConsoleCapture() {
    if (consoleInstalled) return;
    consoleInstalled = true;
    for (const level of ['error', 'warn']) {
      const original = console[level];
      console[level] = function captured(...args) {
        original.apply(this, args);
        try {
          const text = args.map(arg => (arg instanceof Error ? `${arg.name}: ${arg.message}` : typeof arg === 'string' ? arg : (() => { try { return JSON.stringify(arg); } catch { return String(arg); } })())).join(' ');
          const stack = args.find(arg => arg instanceof Error)?.stack || '';
          recordError(level === 'error' ? 'server' : 'warn', text, stack.split('\n').slice(1, 6).join('\n'));
        } catch { /* nikdy nezhodiť logovanie */ }
      };
    }
    process.on('uncaughtExceptionMonitor', error => recordError('server', `Uncaught: ${error?.message || error}`, error?.stack || ''));
  }

  let flushTimer = null;
  let sampleTimer = null;
  function start() {
    installConsoleCapture();
    if (!timers || flushTimer) return;
    flushTimer = setInterval(() => { flush(); maintenance(); }, FLUSH_MS);
    flushTimer.unref?.();
    sampleTimer = setInterval(() => { void sampleFeeds().catch(() => {}); }, SAMPLE_MS);
    sampleTimer.unref?.();
    setTimeout(() => { void sampleFeeds().catch(() => {}); }, 30_000).unref?.();
  }
  function stop() {
    clearInterval(flushTimer); clearInterval(sampleTimer); flushTimer = null;
    for (const level of ['error', 'warn']) console[level] = originalConsole[level];
    consoleInstalled = false;
    flush();
  }

  return {
    middleware, handlePublic, recordError, flush, maintenance, sampleFeeds, start, stop, notice,
    store, feedSetting,
    liveVisitors() {
      const cut = now() - LIVE_MS;
      for (const [hash, at] of live) if (at < cut) live.delete(hash);
      return live.size;
    },
    capCount,
    setFeedSetting(id, value, by) {
      const feed = feedById(id);
      if (!feed?.toggle) throw Object.assign(new Error('feed_not_toggleable'), { status: 400 });
      // Nezadané polia ostávajú, null = zrušiť (strop / cena).
      const merged = { ...feedSetting(id), ...value };
      const clean = { enabled: merged.enabled !== false };
      if (feed.paid && Number.isFinite(merged.dailyCap)) clean.dailyCap = merged.dailyCap;
      if (feed.paid && Number.isFinite(merged.unitPrice)) clean.unitPrice = merged.unitPrice;
      const isDefault = clean.enabled && clean.dailyCap === undefined && clean.unitPrice === undefined;
      store.setSetting(`feed:${id}`, isDefault ? null : clean, now(), by);
      settingsCache = null;
      return feedSetting(id);
    },
    setNotice(value, by) { store.setSetting('notice', value, now(), by); },
    getNotice: () => store.getSetting('notice'),
  };
}

export function loopbackStatus(port, pathname, timeoutMs = 8000) {
  return new Promise(resolve => {
    const started = Date.now();
    const req = http.get({ host: LOOPBACK_HOST, port, path: pathname, headers: { Host: `localhost:${port}` } }, res => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, ms: Date.now() - started }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ status: 0, ms: Date.now() - started }));
  });
}
