// src/data/volbyWorker.js — spracovanie súborov VOĽBY 2026 mimo hlavného vlákna služby oko-api (2026-10-24, generálka
// s výsledkami 2022: 121 000 riadkov za okrsky = ~8 s CPU, ktoré by blokovali všetky ostatné /api pri každej obnove).
import { parentPort } from 'node:worker_threads';
import { processSources } from './volbyService.js';

parentPort.on('message', (input) => {
  try {
    parentPort.postMessage({ ok: true, out: processSources(input) });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: String(error?.message || error) });
  }
});
