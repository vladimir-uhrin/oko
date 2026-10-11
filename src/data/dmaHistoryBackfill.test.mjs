// src/data/dmaHistoryBackfill.test.mjs — spätná história lodí z DMA (2026-10-11).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createDmaBackfill, dmaEpochSec, nextDmaDay, parseDmaLine, parseDmaListing, splitLines, unzipSingleEntry } from './dmaHistoryBackfill.js';
import { createShipHistoryStore } from './shipHistoryStore.js';

const HEADER = '# Timestamp,Type of mobile,MMSI,Latitude,Longitude,Navigational status,ROT,SOG,COG,Heading,IMO,Callsign,Name,Ship type,Cargo type,Width,Length,Type of position fixing device,Draught,Destination,ETA,Data source type,A,B,C,D';

/** ZIP s jedným súborom ako ho dáva DMA: lokálna hlavička s príznakom 3 (veľkosti 0), deflate, dátový deskriptor, centrálny adresár. */
function makeZip(name, text) {
  const data = zlib.deflateRawSync(Buffer.from(text, 'latin1'));
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x08, 6); local.writeUInt16LE(8, 8);
  local.writeUInt16LE(Buffer.byteLength(name), 26); local.writeUInt16LE(0, 28);
  const descriptor = Buffer.alloc(16, 7);
  const central = Buffer.alloc(80, 9); // na obsahu nezáleží — číta sa len po koniec deflate
  return Buffer.concat([local, Buffer.from(name), data, descriptor, central]);
}
async function* chunks(buf, size) { for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, i + size); }

test('čas a riadok DMA: lode áno, základňové stanice nie', () => {
  assert.equal(dmaEpochSec('08/10/2026 00:00:00'), Date.UTC(2026, 9, 8) / 1000);
  assert.equal(dmaEpochSec('2026-10-08'), null);
  assert.deepEqual(parseDmaLine('08/10/2026 00:00:10,Class A,259143000,54.424975,12.207853,Under way using engine,0.0,10.6,37.5,40,Unknown'),
    { mmsi: '259143000', lat: 54.424975, lon: 12.207853, t: Date.UTC(2026, 9, 8) / 1000 + 10, sog: 10.6, cog: 37.5 });
  assert.equal(parseDmaLine('08/10/2026 00:00:00,Base Station,2194006,55.5,5.0,Unknown value,,,,'), null);
  assert.equal(parseDmaLine(HEADER), null);
  assert.equal(parseDmaLine('08/10/2026 00:00:00,Class B,219000000,91,0,Unknown,,,,'), null);
});

test('výpis S3 a výber dňa: najnovší nehotový v okne', () => {
  const files = parseDmaListing('<Key>aisdk-2026-10-07.zip</Key><Key>aisdk-2026-10-08.zip</Key><Key>aisdk-2025-01-01.zip</Key><Key>other.zip</Key>');
  assert.deepEqual(files.map((f) => f.day), ['2026-10-07', '2026-10-08', '2025-01-01']);
  const now = Date.parse('2026-10-11T00:00:00Z');
  assert.equal(nextDmaDay(files, new Set(), now).day, '2026-10-08');
  assert.equal(nextDmaDay(files, new Set(['2026-10-08']), now).day, '2026-10-07');
  assert.equal(nextDmaDay(files, new Set(['2026-10-08', '2026-10-07']), now), null, '2025 je mimo 60 dní');
});

test('ZIP prúdom po malých kúskoch: celý obsah, chvost za dátami nezhodí čítanie', async () => {
  const text = `${HEADER}\n${Array.from({ length: 5000 }, (_, i) => `08/10/2026 00:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')},Class A,2${String(i % 7).padStart(8, '0')},55.${i},10.${i},Moored,0,0.1,1,1`).join('\n')}\n`;
  const zip = makeZip('aisdk-2026-10-08.csv', text);
  let lines = 0;
  let last = '';
  for await (const l of splitLines(unzipSingleEntry(chunks(zip, 997)))) { lines += 1; last = l; }
  assert.equal(lines, 5001);
  assert.match(last, /^08\/10\/2026/);
});

test('beh: stiahne najnovší deň, preriedi, zapíše do histórie a zapamätá si ho', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dma-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // Jedna loď každých 10 s počas 2 h, plávajúca ~10 kn na východ.
  const rows = [];
  for (let s = 0; s < 7200; s += 10) {
    const hh = String(Math.floor(s / 3600)).padStart(2, '0'); const mm = String(Math.floor(s / 60) % 60).padStart(2, '0'); const ss = String(s % 60).padStart(2, '0');
    rows.push(`08/10/2026 ${hh}:${mm}:${ss},Class A,219000001,55.5,${(10 + s * 0.0000857).toFixed(6)},Under way using engine,0,10.0,90,90`);
  }
  const zip = makeZip('aisdk-2026-10-08.csv', `${HEADER}\n${rows.join('\n')}\n`);
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    if (url.includes('?prefix=')) return { ok: true, text: async () => '<Key>aisdk-2026-10-08.zip</Key>' };
    return { ok: true, body: new Blob([zip]).stream() };
  };
  const job = createDmaBackfill({ dir, fetchImpl, now: () => Date.parse('2026-10-11T00:00:00Z') });
  const out = await job.runOnce();
  assert.equal(out.day, '2026-10-08');
  assert.equal(out.lines, rows.length + 1);
  assert.ok(out.written >= 12 && out.written <= 13, `riedenie 10 min: ${out.written}`);
  const read = await createShipHistoryStore({ dir }).read('219000001', Date.UTC(2026, 9, 8) / 1000, Date.UTC(2026, 9, 9) / 1000);
  assert.equal(read.length, out.written);
  assert.equal(read[0].sog, 10);
  assert.equal(await job.runOnce(), null, 'deň je hotový');
  assert.equal(requested.filter((u) => u.endsWith('.zip')).length, 1);
});
