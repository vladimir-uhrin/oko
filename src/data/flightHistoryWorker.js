// src/data/flightHistoryWorker.js — samostatné vlákno, ktoré vlastní SQLite históriu letov (2026-09-30).
//
// CPU profil dev servera po štarte ukázal, že zápis jedného snímku OpenSky (~12 000 polôh,
// 3 príkazy na polohu, databáza 6,6 GB) trvá ~4,4 s a node:sqlite je synchrónne — celé hlavné
// vlákno vrátane verejného /api na okolive.sk vtedy stálo (merač [event-loop]: bloky 3–6 s každých
// ~90 s). Tu beží ten istý flightHistoryStore.js, len mimo hlavného vlákna; klient je
// flightHistoryClient.js.

import { parentPort, workerData } from 'node:worker_threads';
import { openFlightHistory } from './flightHistoryStore.js';

const METHODS = new Set(['recordOpenSkyBody', 'recordAdsbLolBody', 'status', 'search', 'track', 'leg']);
const WRITE_METHODS = new Set(['recordOpenSkyBody', 'recordAdsbLolBody']);
/**
 * Zápis dlhší než tretina odstupu strážcu (90 s) = databáza prerástla cache —
 * varovanie do logu služby (2026-09-30: archív má rásť roky, „miesta mám dosť").
 */
const SLOW_WRITE_MS = 30_000;
const writes = { count: 0, lastMs: null, maxMs: 0, maxAt: null, slow: 0 };
let lastSlowWarnAt = 0;

let store = null;
try {
  store = openFlightHistory(workerData.dbPath, workerData.options || {});
  parentPort.postMessage({ type: 'ready' });
} catch (error) {
  parentPort.postMessage({ type: 'init-error', error: String(error?.message || error) });
}

parentPort.on('message', (message) => {
  const { id, method, args } = message || {};
  if (!store || !METHODS.has(method)) {
    parentPort.postMessage({ id, ok: false, error: store ? `unknown method ${method}` : 'history store is not open' });
    return;
  }
  try {
    const startedAt = performance.now();
    let result = store[method](...(Array.isArray(args) ? args : []));
    if (WRITE_METHODS.has(method)) {
      const ms = Math.round(performance.now() - startedAt);
      writes.count += 1;
      writes.lastMs = ms;
      if (ms > writes.maxMs) { writes.maxMs = ms; writes.maxAt = Date.now(); }
      if (ms > SLOW_WRITE_MS) {
        writes.slow += 1;
        if (Date.now() - lastSlowWarnAt > 10 * 60_000) {
          lastSlowWarnAt = Date.now();
          console.warn(`[flight-history] pomalý zápis snímku: ${ms} ms (${result} nových polôh) — databáza prerástla cache SQLite`);
        }
      }
    } else if (method === 'status') {
      result = { ...result, writes: { ...writes } };
    }
    parentPort.postMessage({ id, ok: true, result });
  } catch (error) {
    parentPort.postMessage({ id, ok: false, error: String(error?.message || error) });
  }
});
