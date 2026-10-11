// src/data/shipServer/history.js
/**
 * @module shipServer/history
 * @description História lodí na disku + spätné plnenie z DMA — serverová časť (2026-10-11,
 * presunuté z vite.config.js, bod 8 „údržba"). Zriedené polohy z AISStream a zdrojov navyše idú
 * do mesačných súborov (shipHistoryStore.js) vedľa Histórie letov (D:\oko-history\ships),
 * predvolene 24 mesiacov. Zapisuje len služba (AIS_STATE_PERSIST ≠ off); skúšobná inštancia
 * z toho istého priečinka len číta. Čistý Node, bez Vite.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SHIP_HISTORY_DEFAULT_MONTHS, createShipHistoryStore } from '../shipHistoryStore.js';
import { createDmaBackfill } from '../dmaHistoryBackfill.js';

export const SHIP_HISTORY_FLUSH_MS = 5 * 60_000;
export const DMA_BACKFILL_EVERY_MS = 60 * 60_000;
export const DMA_BACKFILL_FIRST_MS = 2 * 60_000;

/** Priečinok histórie: SHIP_HISTORY_DIR, inak vedľa DB histórie letov, inak .gev-cache/ship-history. Pure. */
export function shipHistoryDirFromEnv(env, rootDir) {
  const explicit = String(env.SHIP_HISTORY_DIR || '').trim();
  if (explicit) return explicit;
  const flightDb = String(env.FLIGHT_HISTORY_DB || '').trim();
  return flightDb ? path.join(path.dirname(flightDb), 'ships') : path.join(rootDir, '.gev-cache', 'ship-history');
}

/**
 * @param {object} o
 * @param {string} o.rootDir
 * @param {object} [o.env]
 * @param {(o: {dir: string}) => {ok: () => boolean}} o.createDiskGuard poistka voľného miesta (flightHistoryKeeper)
 * @param {{warn: Function, log: Function}} [o.log]
 */
export function createShipHistoryService({ rootDir, env = process.env, createDiskGuard, log = console, setIntervalImpl = setInterval, setTimeoutImpl = setTimeout }) {
  let store = null;
  let flushTimer = null;
  let dma = null;
  let dmaTimer = null;
  const dir = () => shipHistoryDirFromEnv(env, rootDir);
  const guardFor = () => { const d = dir(); return createDiskGuard({ dir: fs.existsSync(d) ? d : path.dirname(d) }); };

  function history() {
    if (!store) {
      const guard = guardFor();
      const months = Math.max(1, Math.min(120, Math.floor(Number(env.SHIP_HISTORY_MONTHS)) || SHIP_HISTORY_DEFAULT_MONTHS));
      store = createShipHistoryStore({ dir: dir(), months, diskOk: () => guard.ok(), log: (m) => log.warn(m) });
    }
    return store;
  }

  /** Zápis každých 5 min, mazanie starých mesiacov raz za deň. */
  function startFlush() {
    if (flushTimer) return;
    let lastPrune = 0;
    flushTimer = setIntervalImpl(() => {
      const s = history();
      void s.flush().catch((error) => log.warn('[ship-history] zápis zlyhal:', error?.message || error));
      if (Date.now() - lastPrune > 24 * 3600_000) { lastPrune = Date.now(); void s.prune().catch(() => {}); }
    }, SHIP_HISTORY_FLUSH_MS);
    flushTimer.unref?.();
  }

  /** Spätná história DMA: jeden deň za hodinu, posledných DMA_BACKFILL_DAYS dní (60). DMA_BACKFILL=off vypne. */
  function startDma() {
    if (dmaTimer || String(env.DMA_BACKFILL || '').toLowerCase() === 'off') return;
    const guard = guardFor();
    const days = Math.max(1, Math.min(365, Math.floor(Number(env.DMA_BACKFILL_DAYS)) || 60));
    dma = createDmaBackfill({ dir: dir(), days, diskOk: () => guard.ok(), log: (m) => log.log(m) });
    const run = () => { void dma.runOnce().catch((error) => log.warn('[dma-backfill] zlyhalo:', error?.message || error)); };
    dmaTimer = setIntervalImpl(run, DMA_BACKFILL_EVERY_MS);
    dmaTimer.unref?.();
    setTimeoutImpl(run, DMA_BACKFILL_FIRST_MS).unref?.();
  }

  /** Kedy DMA naposledy dokončila deň (ms), alebo null. */
  function dmaLastDoneAt() {
    let last = null;
    try {
      const state = JSON.parse(fs.readFileSync(path.join(dir(), 'dma-backfill.json'), 'utf8'));
      for (const v of Object.values(state?.done || {})) if (Number.isFinite(v?.at)) last = Math.max(last ?? 0, v.at);
    } catch { /* ešte nič */ }
    return last;
  }

  return {
    dir,
    history,
    startFlush,
    startDma,
    isRecording: () => Boolean(flushTimer),
    dmaActive: () => Boolean(dma),
    dmaLastDoneAt,
    /** Poloha do histórie — len keď zápis beží (služba), inak nič. */
    record(mmsi, lat, lon, epochSec, speed = null, course = null) {
      if (!flushTimer) return false;
      return history().record(mmsi, lat, lon, epochSec, speed, course);
    },
    statsOrNull: () => (store ? store.stats() : null),
    stop() {
      if (flushTimer) clearInterval(flushTimer);
      if (dmaTimer) clearInterval(dmaTimer);
      flushTimer = null;
      dmaTimer = null;
    },
  };
}
