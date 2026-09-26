// src/data/deepstateFullMirror.js
/**
 * @module deepstateFullMirror
 * @description GitHub mirror CELEJ mapy DeepState so sivou zónou (2026-09-26,
 * vlastník: „použi sivú zónu z mirrorov!"). cyterat aj fork lazar-bit ukladajú
 * len okupované územie; repozitár SmartFinn/wararchive-website ukladá
 * `data/deepstate.geojson` = `map` z `https://deepstatemap.live/api/history/last`
 * bez bodov (okupované, „Unknown status" = sivá zóna, oslobodené, Krym/ORDLO).
 * Súbor sa commituje len keď sa zmení (každé 1–3 dni, od 29. 6. 2025), takže
 * stav k dňu D = posledný commit so dátumom ≤ D (koniec dňa UTC).
 *
 * LICENCIA — POCTIVO: repozitár licenciu nedeklaruje; dáta sú © DeepStateMap.live
 * a platí ich licenčná zmluva (§2 zakazuje šírenie a „proxying" bez súhlasu),
 * rovnako ako pri cyterat. Mirrory OKO používa z rozhodnutia vlastníka
 * (24. 9. 2026, „použi sivú zónu z mirrorov" 26. 9. 2026). Nikdy neoznačovať za
 * otvorené dáta.
 *
 * Náklady na upstream: zoznam commitov cez GitHub API (bez tokenu 60 dopytov/h
 * na IP) — pamäť 3 h + disk, obnovuje sa len prvá strana; súbor podľa SHA je
 * nemenný → disk navždy. Po chybe (403/429/5xx/timeout) pauza 15 min.
 */

import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { deepstateSnapshotFromApi } from './ukraineDeepState.js';

export const DEEPSTATE_FULL_MIRROR = Object.freeze({
  id: 'wararchive',
  repo: 'SmartFinn/wararchive-website',
  path: 'data/deepstate.geojson',
  /** Najstarší commit súboru (overené 26. 9. 2026). */
  firstDay: '2025-06-29',
});
export const DEEPSTATE_FULL_MIRROR_LICENSE = Object.freeze({
  data: 'DeepStateMap.live licence agreement — not open data; distribution, publication and proxying need DeepState consent',
  dataUrl: 'https://deepstatemap.live/license-en.html',
  mirrorCode: 'no licence declared by the mirror repository',
  mirrorUrl: 'https://github.com/SmartFinn/wararchive-website',
  consent: 'none declared; used by decision of the OKO owner (2026-09-24, grey zone 2026-09-26)',
});
export const DEEPSTATE_FULL_MIRROR_NOTE =
  'Date = when the mirror committed a changed DeepState map (it commits only on change); DeepState itself publishes with a deliberate 2–3 day delay. '
  + 'Includes the grey zone („unknown status"), liberated areas, Crimea and areas occupied since 2014. Not a live front line; not for evacuation or route planning.';

const MIN = 60_000;
const COMMITS_TTL_MS = 3 * 60 * MIN;
const COMMITS_MAX_PAGES = 12;
const BACKOFF_MS = 15 * MIN;
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 12 * 1024 * 1024;
const MEMORY_MAX = 4;
const USER_AGENT = 'OKO/0.1 (https://github.com/vladouh76; deepstate-full-mirror)';

/** 'YYYY-MM-DD' → posledný commit so dátumom ≤ koniec toho dňa (UTC); commity v ľubovoľnom poradí. Pure. */
export function pickCommitForDay(commits, day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) || !Array.isArray(commits)) return null;
  const end = `${day}T23:59:59.999Z`;
  let best = null;
  for (const c of commits) {
    if (!c?.sha || typeof c.at !== 'string' || c.at > end) continue;
    if (!best || c.at > best.at) best = c;
  }
  return best;
}

/** Počet dní medzi 'YYYY-MM-DD' (to − from); neplatné = 0. Pure. */
function dayGap(from, to) {
  const p = (d) => Date.parse(`${d}T00:00:00Z`);
  const v = Math.round((p(to) - p(from)) / 86_400_000);
  return Number.isFinite(v) ? v : 0;
}

/**
 * Súbor mirroru (FeatureCollection = `map` z API) → snímka vrstvy DeepState:
 * rovnaký model ako archív z API (druhy occupied/grey/liberated/…), zdroj
 * `mirror`, mirror `wararchive`, čas = čas commitu (približný), `fallbackDays` =
 * koľko dní pred požadovaným dňom súbor vznikol. Pure.
 */
export function deepstateSnapshotFromFullMirror(geojson, { commitAt, sha = null, requestedDay = null } = {}) {
  const base = deepstateSnapshotFromApi({ map: geojson });
  const at = typeof commitAt === 'string' ? new Date(commitAt).toISOString() : null;
  const day = at ? at.slice(0, 10) : null;
  return {
    ...base,
    id: null, at, atApprox: true, day, datetime: null,
    source: 'mirror', mirror: DEEPSTATE_FULL_MIRROR.id, mirrorSha: sha,
    fallbackDays: day && requestedDay ? Math.max(0, dayGap(day, requestedDay)) : 0,
    upstreamUnavailable: false,
  };
}

/** Použiteľný súbor: FeatureCollection s aspoň jedným polygónom okupovaného územia. Pure. */
export function isUsableFullMirrorFile(geojson) {
  if (geojson?.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) return false;
  return geojson.features.some((f) => /geoJSON\.status\.occupied/.test(String(f?.properties?.name || '')) && /Polygon/.test(String(f?.geometry?.type || '')));
}

class MirrorError extends Error {
  constructor(status, message) { super(message || `upstream ${status}`); this.upstreamStatus = status; }
}

/**
 * Jadro mirroru: `lookup(day)` → { found: { geojson, sha, at } } alebo
 * { found: null, reason: 'before_mirror' | 'no_commit' | 'unavailable' }.
 */
export function createDeepStateFullMirror(opts = {}) {
  const root = opts.root || process.cwd();
  const cacheDir = opts.cacheDir || path.join(root, '.gev-cache', 'deepstate-full');
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const now = opts.now || Date.now;
  const log = opts.log || console.log;
  const mirror = opts.mirror || DEEPSTATE_FULL_MIRROR;
  const apiBase = opts.apiBase || 'https://api.github.com';
  const rawBase = opts.rawBase || 'https://raw.githubusercontent.com';

  let commits = null; // [{ sha, at }]
  let commitsAt = 0;
  let commitsTask = null;
  let pausedUntil = 0;
  const files = new Map(); // sha → geojson (LRU)
  const fileTasks = new Map();
  const indexPath = path.join(cacheDir, 'commits.json');
  const filePath = (sha) => path.join(cacheDir, `${sha}.geojson`);

  async function get(url, accept) {
    if (now() < pausedUntil) throw new MirrorError('paused', 'mirror paused after an error');
    let resp;
    try {
      resp = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      pausedUntil = now() + BACKOFF_MS;
      throw new MirrorError(error?.name === 'TimeoutError' ? 'timeout' : 'network', error?.message);
    }
    if (!resp.ok) {
      if (resp.status !== 404) pausedUntil = now() + BACKOFF_MS;
      throw new MirrorError(resp.status);
    }
    const len = Number(resp.headers?.get?.('content-length'));
    if (Number.isFinite(len) && len > MAX_BYTES) throw new MirrorError('too_large');
    const text = await resp.text();
    if (text.length > MAX_BYTES) throw new MirrorError('too_large');
    return text;
  }

  async function readIndexFromDisk() {
    try {
      const j = JSON.parse(await fsp.readFile(indexPath, 'utf8'));
      if (Array.isArray(j?.commits)) return { list: j.commits.filter((c) => c?.sha && typeof c.at === 'string'), at: Number(j.fetchedAt) || 0 };
    } catch { /* prvý beh */ }
    return null;
  }
  async function writeFileAtomic(file, text) {
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      await fsp.mkdir(cacheDir, { recursive: true });
      await fsp.writeFile(tmp, text, 'utf8');
      await fsp.rename(tmp, file);
    } catch (error) {
      log(`[deepstate-full] zápis ${path.basename(file)} zlyhal: ${error?.message || error}`);
      await fsp.rm(tmp, { force: true }).catch(() => {});
    }
  }
  const pageUrl = (page) => `${apiBase}/repos/${mirror.repo}/commits?path=${encodeURIComponent(mirror.path)}&per_page=100&page=${page}`;
  const parsePage = (text) => (JSON.parse(text) || []).map((c) => ({ sha: c?.sha, at: c?.commit?.committer?.date || c?.commit?.author?.date })).filter((c) => c.sha && typeof c.at === 'string');

  /** Zoznam commitov súboru: pamäť 3 h → disk → GitHub (pri známom zozname len prvá strana). */
  async function commitList() {
    if (commits && now() - commitsAt < COMMITS_TTL_MS) return commits;
    if (commitsTask) return commitsTask;
    commitsTask = (async () => {
      if (!commits) {
        const disk = await readIndexFromDisk();
        if (disk) { commits = disk.list; commitsAt = disk.at; if (now() - commitsAt < COMMITS_TTL_MS) return commits; }
      }
      try {
        const known = new Set((commits || []).map((c) => c.sha));
        const fresh = [];
        for (let page = 1; page <= COMMITS_MAX_PAGES; page += 1) {
          const list = parsePage(await get(pageUrl(page), 'application/vnd.github+json'));
          const unseen = list.filter((c) => !known.has(c.sha));
          fresh.push(...unseen);
          // Známy zoznam: stačí strana, na ktorej sa objaví už známy commit.
          if (list.length < 100 || unseen.length < list.length) break;
        }
        const merged = [...fresh, ...(commits || [])];
        const seen = new Set();
        commits = merged.filter((c) => (seen.has(c.sha) ? false : (seen.add(c.sha), true))).sort((a, b) => (a.at < b.at ? 1 : -1));
        commitsAt = now();
        await writeFileAtomic(indexPath, JSON.stringify({ fetchedAt: commitsAt, repo: mirror.repo, path: mirror.path, commits }));
      } catch (error) {
        log(`[deepstate-full] zoznam commitov: ${error?.message || error}`);
        if (!commits) throw error; // bez zoznamu nevieme nič; so starým pokračujeme
      }
      return commits;
    })().finally(() => { commitsTask = null; });
    return commitsTask;
  }

  /** Súbor podľa SHA (nemenný): pamäť → disk → raw.githubusercontent.com. */
  async function fileFor(sha) {
    if (files.has(sha)) { const v = files.get(sha); files.delete(sha); files.set(sha, v); return v; }
    if (fileTasks.has(sha)) return fileTasks.get(sha);
    const task = (async () => {
      let text = null;
      try { text = await fsp.readFile(filePath(sha), 'utf8'); } catch { text = null; }
      let geojson = null;
      if (text) { try { geojson = JSON.parse(text); } catch { geojson = null; } }
      if (!isUsableFullMirrorFile(geojson)) {
        text = await get(`${rawBase}/${mirror.repo}/${sha}/${mirror.path}`, 'application/geo+json, application/json');
        geojson = JSON.parse(text);
        if (!isUsableFullMirrorFile(geojson)) throw new MirrorError('unusable', 'mirror file without occupied polygons');
        await writeFileAtomic(filePath(sha), text);
      }
      files.set(sha, geojson);
      while (files.size > MEMORY_MAX) files.delete(files.keys().next().value);
      return geojson;
    })().finally(() => fileTasks.delete(sha));
    fileTasks.set(sha, task);
    return task;
  }

  async function lookup(day) {
    if (day < mirror.firstDay) return { found: null, reason: 'before_mirror' };
    let list;
    try { list = await commitList(); } catch (error) { return { found: null, reason: 'unavailable', error: error?.message || String(error) }; }
    const commit = pickCommitForDay(list, day);
    if (!commit) return { found: null, reason: 'no_commit' };
    try {
      return { found: { geojson: await fileFor(commit.sha), sha: commit.sha, at: commit.at } };
    } catch (error) {
      return { found: null, reason: 'unavailable', error: error?.message || String(error) };
    }
  }

  return { id: mirror.id, lookup, _state: () => ({ commits: commits?.length || 0, commitsAt, pausedUntil, files: files.size }) };
}
