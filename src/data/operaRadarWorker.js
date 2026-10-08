// src/data/operaRadarWorker.js
// Worker (node:worker_threads) pre radar OPERA (2026-10-08): dekódovanie ODIM HDF5 (jsfive, ~2,5 s, ~140 MB),
// prepočet LAEA → zemepisná mriežka a PNG. Beží mimo hlavného vlákna servera, aby API počas toho nestálo.
// Vstup workerData: { buffer: ArrayBuffer }. Výstup: { ok, png: Uint8Array, width, height, bounds, echoPixels, iso }
// alebo { ok: false, error }. Volanie: decodeOperaInWorker(buffer) nižšie (server).

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import zlib from 'node:zlib';
import { reprojectOpera } from './operaRadar.js';

const strip = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, typeof v === 'string' ? v.replace(/\0+$/, '') : v]));

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** RGBA → PNG (8 bit, filter 0); riedke radarové snímky sa dobre komprimujú. */
export function encodePngRgba(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Dekódovanie v tomto vlákne (worker aj testy). */
export function decodeOperaBuffer(arrayBuffer) {
  const hdf5 = createRequire(import.meta.url)('jsfive');
  const f = new hdf5.File(arrayBuffer);
  const where = strip(f.get('where').attrs);
  const what = strip(f.get('what').attrs);
  const dataWhat = strip(f.get('dataset1/data1/what').attrs);
  if (dataWhat.quantity !== 'DBZH') throw new Error(`OPERA: nečakaná veličina ${dataWhat.quantity}`);
  const values = f.get('dataset1/data1/data').value;
  const out = reprojectOpera(values, where, dataWhat);
  const iso = /^\d{8}$/.test(what.date) && /^\d{6}$/.test(what.time)
    ? `${what.date.slice(0, 4)}-${what.date.slice(4, 6)}-${what.date.slice(6, 8)}T${what.time.slice(0, 2)}:${what.time.slice(2, 4)}:00.000Z`
    : null;
  return { png: encodePngRgba(out.rgba, out.width, out.height), width: out.width, height: out.height, bounds: out.bounds, echoPixels: out.echoPixels, iso };
}

/** Server: dekódovanie v samostatnom vlákne, timeout 60 s. */
export function decodeOperaInWorker(arrayBuffer, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { buffer: arrayBuffer }, transferList: [arrayBuffer], resourceLimits: { maxOldGenerationSizeMb: 1024 } });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('OPERA: worker timeout')); }, timeoutMs);
    worker.once('message', (msg) => {
      clearTimeout(timer);
      worker.terminate();
      if (msg?.ok) resolve({ ...msg, png: Buffer.from(msg.png) });
      else reject(new Error(msg?.error || 'OPERA: worker failed'));
    });
    worker.once('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

if (!isMainThread && workerData?.buffer && parentPort) {
  try {
    const out = decodeOperaBuffer(workerData.buffer);
    const png = new Uint8Array(out.png); // vlastná kópia — Buffer môže ležať v zdieľanom bloku pamäte
    parentPort.postMessage({ ok: true, ...out, png }, [png.buffer]);
  } catch (error) {
    parentPort.postMessage({ ok: false, error: String(error?.message || error) });
  }
}
