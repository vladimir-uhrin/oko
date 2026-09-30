// src/data/flightHistoryClient.js — história letov cez samostatné vlákno (2026-09-30).
//
// Rovnaké mená ako flightHistoryStore.js (recordOpenSkyBody, recordAdsbLolBody, status, search,
// track, leg), len vracajú Promise: SQLite beží vo flightHistoryWorker.js, takže zápis snímku
// ani dlhý dopyt nezastaví hlavné vlákno dev servera (a s ním verejné /api).

import { Worker } from 'node:worker_threads';

/** Dopyt na históriu, ktorý nepríde včas, sa vzdá (HTTP odpoveď nesmie visieť). */
export const HISTORY_QUERY_TIMEOUT_MS = 30_000;
/** Najviac toľko snímkov čaká na zápis; ďalšie sa zahodia (história je best effort, príde ďalší). */
export const HISTORY_RECORD_QUEUE_MAX = 3;

/**
 * @param {string} dbPath cesta k SQLite alebo ':memory:'
 * @param {{retentionDays?: number, rawHours?: number}} [options]
 * @param {{timeoutMs?: number, workerUrl?: URL}} [runtime]
 */
export function openFlightHistoryWorker(dbPath, options = {}, {
  timeoutMs = HISTORY_QUERY_TIMEOUT_MS,
  workerUrl = new URL('./flightHistoryWorker.js', import.meta.url),
} = {}) {
  const worker = new Worker(workerUrl, { workerData: { dbPath, options } });
  const pending = new Map();
  let nextId = 1;
  let closed = false;
  let recordsInFlight = 0;

  const failAll = (error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };

  const ready = new Promise((resolve, reject) => {
    const onInit = (message) => {
      if (message?.type === 'ready') { worker.off('message', onInit); resolve(); }
      else if (message?.type === 'init-error') { worker.off('message', onInit); reject(new Error(message.error)); }
    };
    worker.on('message', onInit);
    worker.once('exit', (code) => reject(new Error(`history worker exited (${code}) before ready`)));
  });
  ready.catch(() => {}); // odmietnutie rieši volajúci cez `ready`; tu len bez „unhandled"

  worker.on('message', (message) => {
    if (!message || message.id === undefined) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.result);
    else entry.reject(new Error(message.error));
  });
  worker.on('error', (error) => { closed = true; failAll(error); });
  worker.on('exit', (code) => { closed = true; failAll(new Error(`history worker exited (${code})`)); });

  function call(method, args, timeout = timeoutMs) {
    if (closed) return Promise.reject(new Error('history worker is closed'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = timeout > 0
        ? setTimeout(() => { pending.delete(id); reject(new Error(`history ${method} timed out`)); }, timeout)
        : null;
      timer?.unref?.();
      pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, method, args });
    });
  }

  function record(method, body, src) {
    if (closed || recordsInFlight >= HISTORY_RECORD_QUEUE_MAX) return Promise.resolve(0);
    recordsInFlight += 1;
    // Text, nie Buffer: štruktúrovaná kópia by z Buffera spravila Uint8Array a store ho číta ako text.
    const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
    return call(method, [text, src], 0).finally(() => { recordsInFlight -= 1; });
  }

  return {
    ready,
    recordOpenSkyBody: (body, src) => record('recordOpenSkyBody', body, src),
    recordAdsbLolBody: (body, src) => record('recordAdsbLolBody', body, src),
    status: () => call('status', []),
    search: (query, opts) => call('search', [query, opts]),
    track: (icao24, opts) => call('track', [icao24, opts]),
    leg: (id) => call('leg', [id]),
    get closed() { return closed; },
    close() {
      closed = true;
      failAll(new Error('history worker is closed'));
      return worker.terminate();
    },
  };
}
