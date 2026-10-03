// Admin panel OKO (2026-10-03) — prevádzkové údaje pre /api/admin/{overview,feeds,log}.
//
// Stav feedov sa číta z už existujúcich /status a /health endpointov proxy
// cez loopback na ten istý proces — kód proxy vo vite.config.js sa nemení.
// Nič sa nevolá v slučke: dotaz ide len vtedy, keď admin otvorí panel alebo
// klikne Obnoviť, a výsledok sa 30 s drží v pamäti.
//
// Z odpovedí sa odstraňujú polia, ktoré by mohli niesť niečo o kľúči
// (`*key*` okrem hasKey, `*token*`, `*secret*`) — admin vidí len áno/nie.
import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';

/** Feedy s vlastným status endpointom. Poradie = poradie v paneli. */
export const ADMIN_FEEDS = Object.freeze([
  { id: 'tomtom', label: 'TomTom doprava', path: '/api/tomtom/status' },
  { id: 'firms', label: 'NASA FIRMS požiare', path: '/api/firms/status' },
  { id: 'gfw', label: 'Global Fishing Watch', path: '/api/gfw/status' },
  { id: 'meteo', label: 'Meteo', path: '/api/meteo/status' },
  { id: 'gas', label: 'Plyn (ACER / GIE)', path: '/api/gas/status' },
  { id: 'history', label: 'Archív letov', path: '/api/history/status' },
  { id: 'acars', label: 'ACARS', path: '/api/acars/status' },
  { id: 'sk-terrain', label: 'SK terén (DMR 5.0)', path: '/api/sk-terrain/status' },
  { id: 'cctv', label: 'CCTV kamery', path: '/api/cctv/health' },
]);

const FEED_TIMEOUT_MS = 8000;
const CACHE_MS = 30_000;
const LOG_BYTES = 48 * 1024;

/** Odstráni polia, ktoré môžu niesť tajomstvo alebo jeho dĺžku; hasKey ostáva. */
export function redactStatus(value, depth = 0) {
  if (depth > 6) return '…';
  if (Array.isArray(value)) return value.slice(0, 50).map(item => redactStatus(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (key !== 'hasKey' && /key|token|secret|password|authorization|cookie/i.test(key)) continue;
    out[key] = redactStatus(item, depth + 1);
  }
  return out;
}

/** CCTV /health vracia zoznam kamier — v paneli stačí súhrn. */
function summarizeFeed(id, body) {
  if (id === 'cctv' && Array.isArray(body?.cameras)) {
    const states = {};
    for (const camera of body.cameras) {
      const state = String(camera?.status ?? camera?.state ?? (camera?.ok === false ? 'error' : camera?.ok ? 'ok' : 'unknown'));
      states[state] = (states[state] || 0) + 1;
    }
    return { cameras: body.cameras.length, states };
  }
  return body;
}

function loopbackGet(port, pathname, timeoutMs) {
  return new Promise(resolve => {
    const started = Date.now();
    const req = http.get({ host: '127.0.0.1', port, path: pathname, headers: { Host: `localhost:${port}`, Accept: 'application/json' } }, res => {
      const chunks = [];
      let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size <= 512 * 1024) chunks.push(chunk); });
      res.on('end', () => {
        let body = null;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = null; }
        resolve({ status: res.statusCode, ms: Date.now() - started, body });
      });
      res.on('error', () => resolve({ status: 0, ms: Date.now() - started, body: null, error: 'read_failed' }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', error => resolve({ status: 0, ms: Date.now() - started, body: null, error: error.message === 'timeout' ? 'timeout' : 'unreachable' }));
  });
}

function gitCommit(root) {
  return new Promise(resolve => {
    execFile('git', ['log', '-1', '--format=%h %cI %s'], { cwd: root, timeout: 3000, windowsHide: true }, (error, stdout) => {
      if (error) return resolve(null);
      const [hash, date, ...subject] = stdout.trim().split(' ');
      resolve(hash ? { hash, date, subject: subject.join(' ').slice(0, 160) } : null);
    });
  });
}

async function directorySize(directory, budget = { files: 20000 }) {
  let bytes = 0;
  let entries;
  try { entries = await fsp.readdir(directory, { withFileTypes: true }); } catch { return 0; }
  for (const entry of entries) {
    if (--budget.files < 0) break;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) bytes += await directorySize(full, budget);
    else if (entry.isFile()) { try { bytes += (await fsp.stat(full)).size; } catch { /* zmizol */ } }
  }
  return bytes;
}

/** Veľkosť cache; pri obrovskom počte súborov len dolný odhad (`cachePartial`). */
async function cacheSize(directory) {
  const budget = { files: 20000 };
  const cacheBytes = await directorySize(directory, budget);
  return { cacheBytes, cachePartial: budget.files < 0 };
}

/**
 * @param {object} options
 * @param {string} options.root koreň repozitára
 * @param {string} options.dbFile cesta k accounts.sqlite
 * @param {() => number|null} options.port port bežiaceho servera
 */
export function createAdminSources({ root, dbFile, port, fetchFeed = loopbackGet, startedAt = Date.now() }) {
  let feedCache = null;
  let commit;
  const logFile = path.join(root, '.gev-cache', 'logs', 'oko-server.log');
  return {
    async feeds() {
      if (feedCache && Date.now() - feedCache.at < CACHE_MS) return feedCache.feeds;
      const p = port();
      const feeds = await Promise.all(ADMIN_FEEDS.map(async feed => {
        if (!p) return { ...feed, ok: false, status: 0, error: 'no_port', ms: 0, data: null };
        const result = await fetchFeed(p, feed.path, FEED_TIMEOUT_MS);
        return { ...feed, ok: result.status >= 200 && result.status < 300, status: result.status, ms: result.ms,
          error: result.error || null, data: result.body == null ? null : redactStatus(summarizeFeed(feed.id, result.body)) };
      }));
      feedCache = { at: Date.now(), feeds };
      return feeds;
    },
    async server() {
      if (commit === undefined) commit = await gitCommit(root);
      const memory = process.memoryUsage();
      let dbBytes = 0;
      for (const suffix of ['', '-wal']) { try { dbBytes += (await fsp.stat(dbFile + suffix)).size; } catch { /* nie je */ } }
      return {
        node: process.version, platform: `${process.platform} ${process.arch}`, pid: process.pid,
        startedAt, uptimeS: Math.round(process.uptime()), rssBytes: memory.rss, heapUsedBytes: memory.heapUsed,
        commit, dbBytes, ...await cacheSize(path.join(root, '.gev-cache')),
      };
    },
    async log() {
      let handle;
      try {
        handle = await fsp.open(logFile, 'r');
        const { size } = await handle.stat();
        const length = Math.min(size, LOG_BYTES);
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, size - length);
        const text = buffer.toString('utf8');
        // Prvý riadok môže byť odrezaný uprostred.
        return size > length ? text.slice(text.indexOf('\n') + 1) : text;
      } catch { return ''; }
      finally { await handle?.close(); }
    },
  };
}
