// src/data/zipEntries.test.mjs
// Čítač ZIP pre správy 4Wings (2026-09-12): archív sa v teste skladá ručne
// (deflate aj stored člen, lokálna hlavička s nulami a data descriptorom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { readZipEntries, zipEntryText } from './zipEntries.js';

function buildZip(entries, { descriptor = false } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, text, stored } of entries) {
    const data = Buffer.from(text, 'utf8');
    const packed = stored ? data : deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(descriptor ? 0x8 : 0, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(descriptor ? 0 : packed.length, 18);
    local.writeUInt32LE(descriptor ? 0 : data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(dir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, eocd]);
}

const CSV = 'Lat,Lon,Time Range,Vessel Name\r\n25.19,56.41,2026-09-08 04:00,"DN, 30"\r\n';

test('readZipEntries: deflate aj stored člen, mená, veľkosti, lenivé read()', () => {
  const zip = buildZip([
    { name: 'layer-activity-data-0/public-global-presence-v4.0.csv', text: CSV },
    { name: 'readme.md', text: 'ahoj', stored: true },
  ]);
  const entries = readZipEntries(zip);
  assert.deepEqual(entries.map((e) => [e.name, e.method, e.size]), [
    ['layer-activity-data-0/public-global-presence-v4.0.csv', 8, Buffer.byteLength(CSV)],
    ['readme.md', 0, 4],
  ]);
  assert.equal(entries[0].read().toString('utf8'), CSV);
  assert.equal(entries[1].read().toString('utf8'), 'ahoj');
});

test('readZipEntries: veľkosti berie z centrálneho adresára — lokálna hlavička s nulami (data descriptor) nevadí', () => {
  const zip = buildZip([{ name: 'a.csv', text: CSV }], { descriptor: true });
  assert.equal(readZipEntries(zip)[0].read().toString('utf8'), CSV);
});

test('zipEntryText: prvý člen podľa predikátu; bez zhody null; poškodený archív hádže', () => {
  const zip = buildZip([{ name: 'x/readme.md', text: 'nie' }, { name: 'x/data.csv', text: CSV }]);
  assert.equal(zipEntryText(zip, (n) => n.endsWith('.csv')), CSV);
  assert.equal(zipEntryText(zip, (n) => n.endsWith('.pdf')), null);
  assert.throws(() => readZipEntries(Buffer.from('nie je zip, ale dosť dlhý text na EOCD hľadanie')), /end of central directory/);
  assert.throws(() => readZipEntries(zip.subarray(0, zip.length - 40)), /central directory|too short/);
  const bad = Buffer.from(zip);
  bad.writeUInt32LE(0, 0); // zničená lokálna signatúra
  assert.throws(() => readZipEntries(bad), /local header/);
});
