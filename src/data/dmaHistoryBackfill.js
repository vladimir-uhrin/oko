// src/data/dmaHistoryBackfill.js
/**
 * @module dmaHistoryBackfill
 * @description Spätné doplnenie histórie lodí z otvorených dát Dánskej námornej správy
 * (2026-10-11, vlastník: „všetky tri"). DMA zverejňuje každý deň súbor so VŠETKÝMI AIS
 * polohami v dánskych vodách (Kattegat, Skagerrak, západný Baltik, Severné more pri Dánsku),
 * ~3 dni oneskorene:  http://aisdata.ais.dk.s3.eu-central-1.amazonaws.com/aisdk-YYYY-MM-DD.zip
 * (~600 MB, jeden CSV). Bez registrácie; podmienky: voľné použitie s uvedením zdroja
 * „Danish Maritime Authority".
 *
 * Súbor sa NEUKLADÁ — ZIP sa číta prúdom (lokálna hlavička → inflateRaw → riadky), polohy sa
 * preriedia rovnako ako živá história (10 min / 500 m) a zapíšu do toho istého úložiska
 * (shipHistoryStore.js). Jeden deň na beh; stav (hotové dni) v JSON vedľa histórie.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { createShipHistoryStore } from './shipHistoryStore.js';

export const DMA_BUCKET = 'http://aisdata.ais.dk.s3.eu-central-1.amazonaws.com';
/** Koľko dní dozadu dopĺňať (predvolene 60). */
export const DMA_BACKFILL_DAYS = 60;

/** „08/10/2026 00:00:00" (UTC, deň/mesiac/rok) → s. Pure. */
export function dmaEpochSec(text) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(text || '').trim());
  if (!m) return null;
  return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]) / 1000;
}

/**
 * Riadok CSV DMA → poloha lode, alebo null (základňové stanice, bóje, lietadlá SAR, chyby). Pure.
 * Stĺpce: Timestamp, Type of mobile, MMSI, Latitude, Longitude, Navigational status, ROT, SOG, COG, …
 */
export function parseDmaLine(line) {
  if (!line || line.charCodeAt(0) === 35) return null; // „# Timestamp…"
  const c = line.split(',', 9);
  if (c.length < 9) return null;
  if (c[1] !== 'Class A' && c[1] !== 'Class B') return null;
  const mmsi = c[2];
  if (!/^\d{9}$/.test(mmsi)) return null;
  const lat = Number(c[3]);
  const lon = Number(c[4]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null;
  const t = dmaEpochSec(c[0]);
  if (t === null) return null;
  const sog = c[7] === '' ? null : Number(c[7]);
  const cog = c[8] === '' ? null : Number(c[8]);
  return { mmsi, lat, lon, t, sog: Number.isFinite(sog) ? sog : null, cog: Number.isFinite(cog) ? cog : null };
}

/** Kľúče súborov z výpisu S3 (XML). Pure. */
export function parseDmaListing(xml) {
  return [...String(xml || '').matchAll(/<Key>(aisdk-(\d{4}-\d{2}-\d{2})\.zip)<\/Key>/g)].map((m) => ({ key: m[1], day: m[2] }));
}

/**
 * Ktorý deň spracovať: najnovší ešte nehotový v okne `days` dní. Pure.
 * @param {Array<{key:string, day:string}>} files
 * @param {Set<string>} done
 */
export function nextDmaDay(files, done, nowMs, days = DMA_BACKFILL_DAYS) {
  const from = new Date(nowMs - days * 86400_000).toISOString().slice(0, 10);
  return files.filter((f) => f.day >= from && !done.has(f.day)).sort((a, b) => (a.day < b.day ? 1 : -1))[0] || null;
}

/**
 * Prúd bajtov ZIPu s jedným súborom → prúd rozbaleného obsahu (deflate). Číta lokálnu hlavičku
 * a zvyšok pošle do inflateRaw; ten skončí na konci dát (dátový deskriptor za tým ignoruje).
 * @param {AsyncIterable<Buffer>} source
 * @returns {AsyncGenerator<Buffer>}
 */
export async function* unzipSingleEntry(source) {
  let head = Buffer.alloc(0);
  let inflate = null;
  const queue = [];
  let done = false;
  let error = null;
  let wake = null;
  const signal = () => { if (wake) { const w = wake; wake = null; w(); } };
  const it = source[Symbol.asyncIterator]();
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done: end } = await it.next();
        if (end) break;
        if (!inflate) {
          head = Buffer.concat([head, value]);
          if (head.length < 30) continue;
          if (head.readUInt32LE(0) !== 0x04034b50) throw new Error('not a zip');
          if (head.readUInt16LE(8) !== 8) throw new Error('zip: not deflate');
          const start = 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
          if (head.length < start) continue;
          inflate = zlib.createInflateRaw();
          inflate.on('data', (d) => { queue.push(d); signal(); });
          inflate.on('end', () => { done = true; signal(); });
          inflate.on('error', (e) => { error = e; signal(); });
          const rest = head.subarray(start);
          head = null;
          if (rest.length && !inflate.write(rest)) await new Promise((r) => inflate.once('drain', r));
        } else if (!inflate.writableEnded && !done) {
          if (!inflate.write(value)) await new Promise((r) => inflate.once('drain', r));
        }
        if (done) break;
      }
      if (inflate && !inflate.writableEnded) inflate.end();
      else if (!inflate) { done = true; signal(); }
    } catch (e) { error = e; signal(); }
  })();
  for (;;) {
    if (queue.length) { yield queue.shift(); continue; }
    if (error) throw error;
    if (done) break;
    await new Promise((r) => { wake = r; });
  }
  await pump.catch(() => {});
  try { await it.return?.(); } catch { /* */ }
}

/** Bajty → riadky. */
export async function* splitLines(chunks) {
  let rest = '';
  for await (const chunk of chunks) {
    const text = rest + chunk.toString('latin1');
    const lines = text.split('\n');
    rest = lines.pop();
    for (const l of lines) yield l.endsWith('\r') ? l.slice(0, -1) : l;
  }
  if (rest) yield rest;
}

/**
 * @param {object} o
 * @param {string} o.dir koreň histórie lodí (D:\oko-history\ships)
 * @param {typeof fetch} [o.fetchImpl]
 * @param {() => number} [o.now]
 * @param {number} [o.days]
 * @param {() => boolean} [o.diskOk]
 * @param {(msg: string) => void} [o.log]
 */
export function createDmaBackfill({ dir, fetchImpl = globalThis.fetch, now = Date.now, days = DMA_BACKFILL_DAYS, diskOk = () => true, log = () => {} }) {
  const stateFile = path.join(dir, 'dma-backfill.json');
  let running = false;

  async function readState() {
    try { return JSON.parse(await fsp.readFile(stateFile, 'utf8')); } catch { return { done: {} }; }
  }

  /** Spracuje jeden deň (stiahnutie prúdom). @returns {Promise<{day:string, lines:number, written:number}|null>} */
  async function runOnce() {
    if (running || !diskOk()) return null;
    running = true;
    try {
      const state = await readState();
      const listing = await fetchImpl(`${DMA_BUCKET}/?prefix=aisdk-`, { signal: AbortSignal.timeout(60_000) });
      if (!listing.ok) throw new Error(`listing HTTP ${listing.status}`);
      const next = nextDmaDay(parseDmaListing(await listing.text()), new Set(Object.keys(state.done || {})), now(), days);
      if (!next) return null;
      const res = await fetchImpl(`${DMA_BUCKET}/${next.key}`, { signal: AbortSignal.timeout(45 * 60_000) });
      if (!res.ok || !res.body) throw new Error(`${next.key} HTTP ${res.status}`);
      // Vlastná inštancia úložiska: riedenie začína od nuly a nemieša sa so živým záznamom.
      const store = createShipHistoryStore({ dir, now, diskOk, log });
      let lines = 0;
      let accepted = 0;
      for await (const line of splitLines(unzipSingleEntry(Readable.fromWeb(res.body)))) {
        lines += 1;
        const p = parseDmaLine(line);
        if (p && store.record(p.mmsi, p.lat, p.lon, p.t, p.sog, p.cog)) accepted += 1;
        if (accepted && accepted % 200_000 === 0) await store.flush();
      }
      const written = (await store.flush()) + 0;
      state.done = { ...(state.done || {}), [next.day]: { at: now(), lines, accepted } };
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(stateFile, JSON.stringify(state));
      log(`[dma-backfill] ${next.day}: ${lines} riadkov → ${accepted} polôh`);
      return { day: next.day, lines, written: accepted, flushed: written };
    } finally { running = false; }
  }

  return { runOnce, readState, isRunning: () => running };
}
