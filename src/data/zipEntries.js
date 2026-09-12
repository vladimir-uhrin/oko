// src/data/zipEntries.js
// Minimálny čítač ZIP archívu (len Node, `node:zlib`). 4Wings vracia pri
// `format=CSV` ZIP so štyrmi členmi (CSV s dátami, readme, PDF „Considerations
// when using AIS data", geometria výrezu) — 6× menší než JSON tej istej správy
// (2026-09-12: celý Perzský záliv 7,3 MB zip vs 50 MB JSON). Bez závislosti na
// balíku: číta centrálny adresár (lokálne hlavičky smú mať veľkosti až v data
// descriptore), rozbaľuje deflate (8) a stored (0) lenivo cez `read()`. Bez ZIP64.

import { inflateRawSync } from 'node:zlib';

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const EOCD_MIN = 22;

/**
 * Zoznam členov archívu; každý má `read()`, ktoré vráti rozbalený Buffer.
 * @param {Buffer|Uint8Array} input
 * @returns {Array<{name:string, method:number, compressedSize:number, size:number, read:() => Buffer}>}
 */
export function readZipEntries(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (buf.length < EOCD_MIN) throw new Error('zip: too short');
  let eocd = -1;
  for (let i = buf.length - EOCD_MIN; i >= Math.max(0, buf.length - EOCD_MIN - 0xffff); i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: end of central directory not found');
  const count = buf.readUInt16LE(eocd + 10);
  const dirOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || dirOffset === 0xffffffff) throw new Error('zip: ZIP64 not supported');
  const out = [];
  let p = dirOffset;
  for (let k = 0; k < count; k++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) throw new Error('zip: bad central directory header');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== SIG_LOCAL) throw new Error('zip: bad local header for ' + name);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + compressedSize > buf.length) throw new Error('zip: truncated entry ' + name);
    if (method !== 8 && method !== 0) throw new Error('zip: unsupported method ' + method + ' for ' + name);
    out.push({
      name, method, compressedSize, size,
      read() {
        const raw = buf.subarray(start, start + compressedSize);
        const data = method === 8 ? inflateRawSync(raw) : raw;
        if (data.length !== size) throw new Error('zip: size mismatch for ' + name);
        return data;
      },
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/**
 * Text (UTF-8) prvého člena, ktorého meno spĺňa predikát; null bez zhody.
 * @param {Buffer|Uint8Array} input
 * @param {(name:string) => boolean} predicate
 */
export function zipEntryText(input, predicate) {
  const entry = readZipEntries(input).find((e) => predicate(e.name));
  return entry ? entry.read().toString('utf8') : null;
}
