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
    const result = store[method](...(Array.isArray(args) ? args : []));
    parentPort.postMessage({ id, ok: true, result });
  } catch (error) {
    parentPort.postMessage({ id, ok: false, error: String(error?.message || error) });
  }
});
