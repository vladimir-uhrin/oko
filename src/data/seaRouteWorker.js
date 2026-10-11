// src/data/seaRouteWorker.js — výpočet plavebnej trasy vo vlákne (2026-10-11, bod 5 „zrýchlenie").
// Knižnica searoute-js sa načítava ~4 s a jedna trasa trvá ~45 ms — v hlavnom vlákne to blokovalo
// všetky odpovede servera. Toto vlákno ju drží načítanú; hlavné vlákno posiela {id, pts} a dostáva
// {id, route}.
import { parentPort, workerData } from 'node:worker_threads';
import { computeSeaRoute } from './seaRouteProxy.js';

// Zahriatie: prvý výpočet načíta sieť marnet, aby prvý skutočný dopyt nečakal.
if (workerData?.warm) { try { computeSeaRoute([[0, 50], [1, 51]]); } catch { /* */ } }
parentPort.postMessage({ ready: true });
parentPort.on('message', ({ id, pts }) => {
  try {
    parentPort.postMessage({ id, route: computeSeaRoute(pts) });
  } catch (error) {
    parentPort.postMessage({ id, error: String(error?.message || error) });
  }
});
