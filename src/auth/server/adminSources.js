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
import { LOOPBACK_HOST } from '../../admin/server/loopback.js';

/** Feedy s vlastným status endpointom. Poradie = poradie v paneli. */
export const ADMIN_FEEDS = Object.freeze([
  { id: 'tomtom', label: 'TomTom doprava', path: '/api/tomtom/status' },
  { id: 'firms', label: 'NASA FIRMS požiare', path: '/api/firms/status' },
  { id: 'gfw', label: 'Global Fishing Watch', path: '/api/gfw/status' },
  { id: 'meteo', label: 'Meteo', path: '/api/meteo/status' },
  { id: 'gas', label: 'Plyn (ACER / GIE)', path: '/api/gas/status' },
  { id: 'history', label: 'Archív letov', path: '/api/history/status' },
  { id: 'acars', label: 'ACARS', path: '/api/acars/status' },
  { id: 'terrain', label: 'SK terén (DMR 5.0)', path: '/api/sk-terrain/status' },
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

export function loopbackGet(port, pathname, timeoutMs) {
  return new Promise(resolve => {
    const started = Date.now();
    const req = http.get({ host: LOOPBACK_HOST, port, path: pathname, headers: { Host: `localhost:${port}`, Accept: 'application/json' } }, res => {
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
export function createAdminSources({ root, dbFile, port, fetchFeed = loopbackGet, startedAt = Date.now(), runtime = () => null }) {
  let feedCache = null;
  let commit;
  const logFile = path.join(root, '.gev-cache', 'logs', 'oko-server.log');
  return {
    runtime,
    /** Dnešná spotreba kvóty providera z /status (TomTom, GFW) pre sekciu Náklady. */
    async quotaStatus() {
      const p = port();
      const out = {};
      if (!p) return out;
      for (const [id, statusPath] of [['tomtom', '/api/tomtom/status'], ['gfw', '/api/gfw/status']]) {
        const result = await fetchFeed(p, statusPath, FEED_TIMEOUT_MS);
        const body = result.body || {};
        if (Number.isFinite(body.dailyCount)) out[id] = { dailyCount: body.dailyCount, budget: body.budget ?? null, hasKey: Boolean(body.hasKey) };
      }
      return out;
    },
    cacheDirs: () => cacheDirectories(root),
    clearCache: name => clearCacheDirectory(root, name),
    backups: () => listBackups(dbFile),
    backup: targets => createBackup(dbFile, targets),
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

// ── Údržba (2026-10-03) ─────────────────────────────────────────────────────
/** Priečinky .gev-cache, ktoré sú čistou cache — dajú sa znova stiahnuť bez straty. */
export const CLEARABLE_CACHE = Object.freeze(['img', 'linkimg', 'logos', 'overpass', 'translate', 'situation',
  'military-installations', 'relief-normal', 'tomtom']);
const BACKUPS_KEEP = 14;

/** Zoznam priečinkov .gev-cache s veľkosťou; mazať sa smú len CLEARABLE_CACHE. */
export async function cacheDirectories(root) {
  const base = path.join(root, '.gev-cache');
  let entries = [];
  try { entries = await fsp.readdir(base, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const budget = { files: 20000 };
    const bytes = await directorySize(path.join(base, entry.name), budget);
    out.push({ name: entry.name, bytes, partial: budget.files < 0, clearable: CLEARABLE_CACHE.includes(entry.name) });
  }
  return out.sort((a, b) => b.bytes - a.bytes);
}

/** Vymaže obsah povoleného priečinka cache; počítadlá rozpočtu (budget*.json) nechá. */
export async function clearCacheDirectory(root, name) {
  if (!CLEARABLE_CACHE.includes(name)) throw Object.assign(new Error('cache_not_clearable'), { status: 400 });
  const directory = path.join(root, '.gev-cache', name);
  let removed = 0;
  let freed = 0;
  const walk = async dir => {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        await fsp.rmdir(full).catch(() => {});
      } else if (entry.isFile() && !/^budget.*\.json$/i.test(entry.name)) {
        try { freed += (await fsp.stat(full)).size; await fsp.unlink(full); removed++; } catch { /* zamknutý súbor */ }
      }
    }
  };
  await walk(directory);
  return { removed, freed };
}

/** Zálohy v .auth-data/backups (najnovšie prvé). */
export async function listBackups(dbFile) {
  const directory = path.join(path.dirname(dbFile), 'backups');
  let names = [];
  try { names = (await fsp.readdir(directory)).filter(name => /^(accounts|admin)-[\dT-]+\.sqlite$/.test(name)); } catch { return []; }
  const out = [];
  for (const name of names) {
    try { const stat = await fsp.stat(path.join(directory, name)); out.push({ name, bytes: stat.size, createdAt: stat.mtimeMs }); } catch { /* zmazaný */ }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** Záloha DB účtov aj admin DB cez VACUUM INTO; ponechá BACKUPS_KEEP najnovších z každej. */
export async function createBackup(dbFile, targets, now = Date.now()) {
  const directory = path.join(path.dirname(dbFile), 'backups');
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const made = [];
  for (const [prefix, store] of Object.entries(targets)) {
    if (!store?.backupTo) continue;
    const file = path.join(directory, `${prefix}-${stamp}.sqlite`);
    await fsp.rm(file, { force: true });
    store.backupTo(file);
    if (process.platform !== 'win32') await fsp.chmod(file, 0o600).catch(() => {});
    made.push(path.basename(file));
  }
  const all = await listBackups(dbFile);
  for (const prefix of Object.keys(targets)) {
    for (const old of all.filter(backup => backup.name.startsWith(`${prefix}-`)).slice(BACKUPS_KEEP)) {
      await fsp.rm(path.join(directory, old.name), { force: true });
    }
  }
  return made;
}
