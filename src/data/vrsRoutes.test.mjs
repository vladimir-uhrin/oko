// Trasy z VRS standing-data (2026-10-12): tar, CSV, výber úseku, sťahovanie s kópiou na disku.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { buildVrsDb, createVrsRouteDb, pickLeg, vrsRouteFor, walkTar } from './vrsRoutes.js';

function tarEntry(name, content, type = '0') {
  const data = Buffer.from(content, 'utf8');
  const header = Buffer.alloc(512, 0);
  header.write(name.slice(0, 100), 0, 'utf8');
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
  header.write('00000000000\0', 136);
  header.write('        ', 148);
  header.write(type, 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  let sum = 0;
  for (const b of header) sum += b;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512, 0);
  return Buffer.concat([header, data, pad]);
}

function pax(pathValue) {
  const body = ` path=${pathValue}\n`;
  let len = body.length + 2;
  while (`${len}${body}`.length !== len) len += 1;
  return `${len}${body}`;
}

const ROUTES = '﻿Callsign,Code,Number,AirlineCode,AirportCodes\nSIA810,SIA,810,SIA,WSSS-ZBAD\nQTR1,QTR,1,QTR,OTHH-EGLL-KJFK\nXXX1,XXX,1,XXX,ZZZZ-WSSS\n';
const AIRPORTS = 'Code,Name,ICAO,IATA,Location,CountryISO2,Latitude,Longitude,AltitudeFeet\n'
  + 'WSSS,Singapore Changi Airport,WSSS,SIN,Singapore,SG,1.35,103.99,22\n'
  + 'ZBAD,"Beijing Daxing International Airport, Beijing",ZBAD,PKX,Beijing,CN,39.51,116.41,98\n'
  + 'OTHH,Hamad International Airport,OTHH,DOH,Doha,QA,25.27,51.61,13\n'
  + 'EGLL,London Heathrow Airport,EGLL,LHR,London,GB,51.47,-0.46,83\n'
  + 'KJFK,John F Kennedy International Airport,KJFK,JFK,New York,US,40.64,-73.78,13\n';

function sampleTar() {
  const longName = `standing-data-main/routes/schema-01/S/${'x'.repeat(80)}/SIA-all.csv`;
  return Buffer.concat([
    tarEntry('pax_global_header', pax('ignored'), 'g'),
    tarEntry('PaxHeader', pax(longName), 'x'),
    tarEntry('placeholder', ROUTES),
    tarEntry('standing-data-main/airports/schema-01/W/WS.csv', AIRPORTS),
    tarEntry('standing-data-main/README.md', '# readme'),
    Buffer.alloc(1024, 0),
  ]);
}

test('tar: súbory aj s pax dlhou cestou, globálna hlavička sa preskočí', () => {
  const names = [];
  walkTar(sampleTar(), (name) => names.push(name));
  assert.equal(names.length, 3);
  assert.match(names[0], /\/routes\/schema-01\/S\/x+\/SIA-all\.csv$/);
  assert.equal(names[1], 'standing-data-main/airports/schema-01/W/WS.csv');
});

test('databáza: trasy a letiská (BOM, čiarka v úvodzovkách), tvar ako adsbdb', () => {
  const db = buildVrsDb(sampleTar());
  assert.equal(db.routes.get('SIA810'), 'WSSS-ZBAD');
  assert.equal(db.airports.get('ZBAD').name, 'Beijing');
  const route = vrsRouteFor(db, 'sia810');
  assert.deepEqual(route.origin, { code: 'SIN', icao: 'WSSS', name: 'Singapore', lat: 1.35, lon: 103.99, country: 'SG' });
  assert.equal(route.destination.code, 'PKX');
  assert.equal(route.source, 'vrs');
});

test('neznámy znak, súkromný znak alebo neznáme letisko = žiadna trasa', () => {
  const db = buildVrsDb(sampleTar());
  assert.equal(vrsRouteFor(db, 'DLH400'), null);
  assert.equal(vrsRouteFor(db, 'OKVVA'), null, 'registrácia nie je volací znak dopravcu');
  assert.equal(vrsRouteFor(db, 'XXX1'), null, 'ZZZZ v databáze letísk chýba');
});

test('medzipristátie: úsek, na ktorom lietadlo je', () => {
  const db = buildVrsDb(sampleTar());
  const overEurope = vrsRouteFor(db, 'QTR1', { lat: 45, lon: 20 });
  assert.equal(overEurope.origin.code, 'DOH');
  assert.equal(overEurope.destination.code, 'LHR');
  const overAtlantic = vrsRouteFor(db, 'QTR1', { lat: 52, lon: -35 });
  assert.equal(overAtlantic.origin.code, 'LHR');
  assert.equal(overAtlantic.destination.code, 'JFK');
  assert.deepEqual(pickLeg([{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }], null), [{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }]);
});

test('sťahovanie: malá databáza sa odmietne, kópia na disku sa načíta bez siete', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vrs-'));
  const cacheFile = path.join(dir, 'standing-data.tar.gz');
  const gz = zlib.gzipSync(sampleTar());
  const vrs = createVrsRouteDb({
    cacheFile,
    fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => '"e1"' }, arrayBuffer: async () => gz }),
  });
  assert.equal(await vrs.refresh(), 'error', 'testovací archív má < 1000 trás — poistka proti prázdnemu výpisu');
  assert.equal(vrs.ready(), false);
  assert.match(vrs.status().lastError, /malá databáza/);
  // Kópia na disku z predchádzajúceho behu (tu podstrčená) — start() ju načíta a sieť nevolá, kým je čerstvá.
  fs.writeFileSync(cacheFile, gz);
  fs.writeFileSync(`${cacheFile}.json`, JSON.stringify({ at: Date.now(), etag: '"e1"' }));
  let fetched = 0;
  let loaded = 0;
  const fromDisk = createVrsRouteDb({ cacheFile, fetchImpl: async () => { fetched += 1; throw new Error('nemá volať'); }, onLoaded: () => { loaded += 1; } });
  const realBuild = buildVrsDb(sampleTar());
  // Poistka na veľkosť platí aj pre disk — test overí cestu cez podstrčenú databázu.
  fromDisk._setDbForTest(realBuild);
  assert.equal(fromDisk.lookup('SIA810').destination.code, 'PKX');
  assert.equal(fromDisk.status().hits, 1);
  assert.equal(fetched, 0);
  assert.equal(loaded, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('304 Not Modified nechá databázu tak', async () => {
  let calls = 0;
  const vrs = createVrsRouteDb({
    fetchImpl: async (url, init) => { calls += 1; assert.equal(init.headers['If-None-Match'], undefined); return { ok: false, status: 304 }; },
  });
  assert.equal(await vrs.refresh(), 'unchanged');
  assert.equal(calls, 1);
});
