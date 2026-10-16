// src/data/vrsRoutesWorker.js
// Worker (node:worker_threads) pre trasy VRS standing-data (2026-10-15): gunzip + buildVrsDb (~3 s,
// 620 tis. trás) mimo hlavného vlákna servera, aby denná obnova nezastavila verejné API.
// Vstup workerData: { gz: Uint8Array, port?: MessagePort }. Výstup: { ok, packed } (packVrsDb — typované
// polia, prenesú sa bez kopírovania) alebo { ok: false, error }. Volanie: parseVrsArchiveInWorker(gz)
// v vrsRoutes.js. Výsledok ide cez `port` (2026-10-16), aby ho hlavné vlákno vedelo pri časovom limite
// vybrať synchrónne (receiveMessageOnPort); bez portu cez parentPort.

import { parentPort, workerData } from 'node:worker_threads';
import { packVrsDb, packedVrsBuffers, parseVrsArchive } from './vrsRoutes.js';

const out = workerData?.port || parentPort;
if (out && workerData?.gz) {
  try {
    const packed = packVrsDb(parseVrsArchive(workerData.gz));
    out.postMessage({ ok: true, packed }, packedVrsBuffers(packed));
  } catch (error) {
    out.postMessage({ ok: false, error: String(error?.message || error) });
  }
}
