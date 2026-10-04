// src/data/stateAircraftBackfill.js — spätný import stôp štátnych lietadiel z adsb.lol (2026-09-30).
//
// Pre každý stroj zo zoznamu (stateAircraft.js) a každý deň: GET globe_history adsb.lol (jeden
// malý súbor, ~kB; deň bez letu = 404) → traceToFlight → importFlight do histórie letov. Najprv
// dni od posledného hotového po včerajšok (aby sa dopĺňal každý nový deň), potom do minulosti až po
// najstarší deň, ktorý adsb.lol vracia (2023-02-20, sonda 2026-09-30), alebo po dátum, odkedy stroj
// slúži štátu. Pomaly (jeden dopyt za STATE_BACKFILL_INTERVAL_MS), pri 403/429 dlhá pauza —
// podmienky rýchlosti adsb.lol nezverejňuje a pri rýchlych sondách vracal 403.
// Pozícia sa pamätá v JSON súbore vedľa databázy (reštart pokračuje, nezačína odznova).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { globeHistoryUrl, shiftDay, traceToFlight, utcDay } from './adsblolTrace.js';

export const STATE_BACKFILL_FLOOR_DAY = '2023-02-20';
/** Základné tempo: jeden deň jedného stroja za 5 s (séria rýchlych sond 2026-09-30 dostala 403). */
export const STATE_BACKFILL_INTERVAL_MS = 5000;
/** Po každom 403/429 sa tempo zdvojnásobí, najviac na tento odstup. */
export const STATE_BACKFILL_MAX_INTERVAL_MS = 60_000;
export const STATE_BACKFILL_BLOCK_PAUSE_MS = 30 * 60_000;
export const STATE_BACKFILL_ERROR_PAUSE_MS = 5 * 60_000;
/** Deň D sa pýta až 2 h po jeho konci (UTC) — adsb.lol dopisuje archív dňa po polnoci. */
export const STATE_DAY_SETTLE_MS = 2 * 3600_000;
export const STATE_BACKFILL_UA = 'OKO/1.0 (+https://okolive.sk)';
const MAX_TRACE_BYTES = 32 * 1024 * 1024;
const DAY_MS = 86_400_000;

/** Posledný celý deň UTC, ktorý už má zmysel pýtať. Pure. */
export function latestCompleteDay(nowMs) {
  return utcDay(nowMs - DAY_MS - STATE_DAY_SETTLE_MS);
}

/**
 * Ďalšia úloha: najprv nový stroj (začne posledným celým dňom), potom dni dopredu, potom do
 * minulosti. `aircraft` = [{hex, since, until}] (since/until = služba štátu, voliteľné). Pure.
 * @returns {{hex: string, day: string, direction: 'start'|'forward'|'back'}|null}
 */
export function nextBackfillJob({ aircraft, cursors, latestDay, floorDay = STATE_BACKFILL_FLOOR_DAY }) {
  const top = (a) => (a.until && a.until < latestDay ? a.until : latestDay);
  const bottom = (a) => (a.since && a.since > floorDay ? a.since : floorDay);
  for (const a of aircraft) {
    const c = cursors[a.hex];
    if (!c) {
      if (top(a) >= bottom(a)) return { hex: a.hex, day: top(a), direction: 'start' };
      continue; // služba štátu skončila pred prvým dňom archívu
    }
    if (c.newest < top(a)) return { hex: a.hex, day: shiftDay(c.newest, 1), direction: 'forward' };
  }
  // Do minulosti striedavo: vždy stroj s najkratšou doterajšou históriou (najnovší `oldest`),
  // aby sa všetky dopĺňali súčasne od najnovších dní — nie jeden celý a ostatné hodiny nič.
  let pick = null;
  for (const a of aircraft) {
    const c = cursors[a.hex];
    if (c && c.oldest > bottom(a) && (!pick || c.oldest > pick.oldest)) pick = { hex: a.hex, oldest: c.oldest };
  }
  return pick ? { hex: pick.hex, day: shiftDay(pick.oldest, -1), direction: 'back' } : null;
}

/** Posuň pozíciu stroja po hotovom dni. Pure. */
export function advanceCursor(cursors, job) {
  const c = cursors[job.hex];
  const next = { ...cursors };
  if (!c) next[job.hex] = { newest: job.day, oldest: job.day };
  else if (job.direction === 'forward') next[job.hex] = { ...c, newest: job.day };
  else next[job.hex] = { ...c, oldest: job.day };
  return next;
}

/**
 * Stiahni a prelož stopu jedného stroja za jeden deň.
 * @returns {Promise<{status: number, flight?: object}>}
 */
export async function fetchGlobeTrace(hex, day, { fetchImpl = fetch, timeoutMs = 30_000 } = {}) {
  const url = globeHistoryUrl(hex, day);
  if (!url) return { status: 400 };
  return fetchTraceFromUrl(url, { fetchImpl, timeoutMs });
}

/**
 * Stiahni a prelož stopu readsb z adsb.lol (denný archív alebo živá stopa — liveTraceUrl).
 * @returns {Promise<{status: number, flight?: object}>}
 */
export async function fetchTraceFromUrl(url, { fetchImpl = fetch, timeoutMs = 30_000 } = {}) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': STATE_BACKFILL_UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return { status: res.status };
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_TRACE_BYTES) return { status: 413 };
  // Súbor je gzip; ak ho fetch už rozbalil (Content-Encoding), ide rovno o JSON.
  const text = buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
  return { status: 200, flight: traceToFlight(JSON.parse(text)) };
}

/** Pozície v JSON súbore (zápis cez dočasný súbor — pád nenechá rozbitý JSON). */
export function fileCursorStore(file) {
  return {
    load() {
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        return data && typeof data === 'object' ? data : {};
      } catch {
        return {};
      }
    },
    save(cursors) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(cursors, null, 1));
      fs.renameSync(tmp, file);
    },
  };
}

/**
 * Plánovač: jeden deň jedného stroja za krok.
 * @param {object} options
 * @param {() => Array<{hex: string, since?: string|null, until?: string|null}>} options.aircraft
 * @param {(hex: string, day: string) => Promise<{status: number, flight?: object}>} options.fetchTrace
 * @param {(flight: object) => Promise<{inserted: number, legsInserted: number, legsExtended: number}>} options.importFlight
 * @param {{load: () => object, save: (cursors: object) => void}} options.cursorStore
 */
export function createStateBackfill({
  aircraft,
  fetchTrace,
  importFlight,
  cursorStore,
  now = Date.now,
  log = (msg) => console.log(msg),
  intervalMs = STATE_BACKFILL_INTERVAL_MS,
  floorDay = STATE_BACKFILL_FLOOR_DAY,
}) {
  let cursors = cursorStore.load();
  let timer = null;
  let running = false;
  let busy = false;
  let pausedUntil = 0;
  let idleLogged = false;
  let currentIntervalMs = intervalMs;
  const stats = { jobs: 0, found: 0, notFound: 0, errors: 0, inserted: 0, legsInserted: 0, legsExtended: 0, lastJob: null, lastError: null };

  async function tick() {
    if (busy || now() < pausedUntil) return null;
    const job = nextBackfillJob({ aircraft: aircraft(), cursors, latestDay: latestCompleteDay(now()), floorDay });
    if (!job) {
      if (!idleLogged) log('[state-aircraft] spätný import hotový po posledný celý deň');
      idleLogged = true;
      return null;
    }
    idleLogged = false;
    busy = true;
    try {
      const res = await fetchTrace(job.hex, job.day);
      if (res.status === 403 || res.status === 429) {
        pausedUntil = now() + STATE_BACKFILL_BLOCK_PAUSE_MS;
        currentIntervalMs = Math.min(STATE_BACKFILL_MAX_INTERVAL_MS, currentIntervalMs * 2);
        stats.errors += 1;
        stats.lastError = `HTTP ${res.status} ${job.hex} ${job.day}`;
        log(`[state-aircraft] adsb.lol vrátil ${res.status} — pauza ${STATE_BACKFILL_BLOCK_PAUSE_MS / 60_000} min, potom jeden deň za ${currentIntervalMs / 1000} s`);
        return { job, status: res.status };
      }
      if (res.status === 200) {
        if (res.flight && res.flight.points.length) {
          const r = await importFlight(res.flight);
          stats.inserted += r.inserted;
          stats.legsInserted += r.legsInserted;
          stats.legsExtended += r.legsExtended;
        }
        stats.found += 1;
      } else if (res.status === 404) {
        stats.notFound += 1;
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
      cursors = advanceCursor(cursors, job);
      cursorStore.save(cursors);
      stats.jobs += 1;
      stats.lastJob = { ...job, status: res.status };
      return { job, status: res.status };
    } catch (error) {
      pausedUntil = now() + STATE_BACKFILL_ERROR_PAUSE_MS;
      stats.errors += 1;
      stats.lastError = `${error?.message || error} ${job.hex} ${job.day}`;
      log(`[state-aircraft] ${job.hex} ${job.day}: ${error?.message || error} — pauza ${STATE_BACKFILL_ERROR_PAUSE_MS / 60_000} min`);
      return { job, error: String(error?.message || error) };
    } finally {
      busy = false;
    }
  }

  // Reťaz setTimeout (nie setInterval): tempo sa po 403/429 mení za behu.
  function schedule() {
    if (!running) return;
    timer = setTimeout(async () => {
      await tick();
      schedule();
    }, currentIntervalMs);
    timer.unref?.();
  }

  return {
    tick,
    start() {
      if (running) return;
      running = true;
      schedule();
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    status() {
      return { running, intervalMs: currentIntervalMs, pausedUntil: pausedUntil > now() ? pausedUntil : null, ...stats, cursors };
    },
  };
}
