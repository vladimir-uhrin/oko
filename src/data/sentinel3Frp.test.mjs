// src/data/sentinel3Frp.test.mjs — požiare Sentinel-3 SLSTR (Copernicus), 2026-10-07.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { S3_FRP_CSV, extractZipEntry, parseS3FrpCsv, s3GranuleStartMs, s3FrpCatalogFilter } from './sentinel3Frp.js';
import { createSentinel3FrpService } from './sentinel3FrpService.js';
import { adaptFirmsRecords, sensorFromSatellite } from './firmsAdapt.js';
import { satelliteFullName } from './firmsLabels.js';

const HEADER = 'lat(deg),lon(deg),day,time,D/N,FRP(MW),FRPerr(MW),used_channel,confidence(%),confidence_class(lower=0;nominal=1;higher=2),MWIR_BT(K),IFOV_area(m2),SZA(deg),VZA(deg),actrack(km),altrack(km),satellite';
const CSV = `#title = SLSTR Level 2 Product, Fire Radiative Power (FRP) measurement, Near Real Time (NRT)
#number_of_detected_fires = 2

${HEADER}
-13.491851,19.988104,2026-10-07,08:45:40,D,8.960177,1.717190,F1,80.0,1,314.49,1490713.500,26.46,25.57,1.16,1.29,S3B
-13.815070,20.808332,2026-10-07,08:45:49,N,23.447602,5.118031,F1,88.1,2,323.58,1745188.375,25.78,31.66,1.22,1.43,S3A
999,1,2026-10-07,08:45:49,D,1,1,F1,1,1,1,1,1,1,1,1,S3A
`;

/** Minimálny ZIP (deflate) s danými súbormi — rovnaký formát, aký vracia zipper CDSE. */
function makeZip(files) {
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = zlib.deflateRawSync(Buffer.from(content));
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(Buffer.byteLength(content), 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(Buffer.byteLength(content), 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data); centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(Object.keys(files).length, 8); eocd.writeUInt16LE(Object.keys(files).length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
const G1 = 'S3B_SL_2_FRP____20261007T084522_20261007T084822_20261007T102700_0179_125_235______MAR_O_NR_003';
const G2 = 'S3A_SL_2_FRP____20261007T091022_20261007T091322_20261007T104500_0179_125_235______MAR_O_NR_003';

test('ZIP: vytiahne CSV z produktu (deflate), iný/poškodený súbor = null', () => {
  const zip = makeZip({ [`${G1}.SEN3/manifest.xml`]: '<x/>', [`${G1}.SEN3/${S3_FRP_CSV}`]: CSV });
  assert.equal(extractZipEntry(zip, (n) => n.endsWith(S3_FRP_CSV)).toString(), CSV);
  assert.equal(extractZipEntry(zip, (n) => n.endsWith('nic.csv')), null);
  assert.equal(extractZipEntry(Buffer.from('not a zip at all, definitely not'), () => true), null);
});

test('CSV: ohniská v tvare FIRMS (čas HHMM, deň/noc, FRP, spoľahlivosť %, pixel km, družica); zlá poloha preč', () => {
  const f = parseS3FrpCsv(CSV);
  assert.equal(f.length, 2);
  assert.deepEqual(f[0], { lat: -13.491851, lon: 19.988104, frp: 8.960177, confidence: 80, brightness: 314.49, brightnessTi5: 0, daynight: 'D', acqDate: '2026-10-07', acqTime: '0845', satellite: 'S3B', instrument: 'SLSTR', scan: 1.16, track: 1.29 });
  assert.equal(f[1].daynight, 'N');
  assert.deepEqual(parseS3FrpCsv('#len hlavička\n' + HEADER + '\n'), []);
  const [a] = adaptFirmsRecords(f);
  assert.equal(a.sensor, 'SLSTR'); assert.equal(a.confidence, 0.8); assert.equal(a.acqMs, Date.UTC(2026, 9, 7, 8, 45));
  assert.equal(sensorFromSatellite('S3A'), 'SLSTR'); assert.equal(satelliteFullName('S3B'), 'Sentinel-3B');
  assert.equal(s3GranuleStartMs(G1), Date.UTC(2026, 9, 7, 8, 45, 22));
  assert.match(s3FrpCatalogFilter('2026-10-06T00:00:00.000Z'), /contains\(Name,'SL_2_FRP'\) and contains\(Name,'_NR_'\) and ContentDate\/Start gt 2026-10-06T00:00:00\.000Z$/);
});

test('služba: token, katalóg, každý granul raz, cache na disku prežije reštart, staré nad 24 h preč', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oko-s3-'));
  let now = Date.UTC(2026, 9, 7, 12, 0);
  const calls = { token: 0, catalog: 0, download: 0 };
  const zip = makeZip({ [`${G1}.SEN3/${S3_FRP_CSV}`]: CSV });
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/token')) { calls.token += 1; assert.match(String(opts.body), /grant_type=client_credentials/); return new Response(JSON.stringify({ access_token: 'T', expires_in: 1800 }), { status: 200 }); }
    if (u.startsWith('https://catalogue.')) { calls.catalog += 1; return new Response(JSON.stringify({ value: [{ Id: 'a', Name: `${G1}.SEN3` }, { Id: 'b', Name: `${G2}.SEN3` }] }), { status: 200 }); }
    if (u.startsWith('https://zipper.')) { calls.download += 1; assert.equal(opts.headers.Authorization, 'Bearer T'); return u.includes('(b)') ? new Response('x', { status: 500 }) : new Response(zip, { status: 200 }); }
    throw new Error('unexpected ' + u);
  };
  const svc = createSentinel3FrpService({ clientId: 'sh-x', clientSecret: 's', cacheDir: dir, fetchImpl, now: () => now });
  assert.equal(svc.enabled(), true);
  const st = await svc.sync();
  assert.equal(st.catalog, 2); assert.equal(st.downloaded, 1); assert.equal(st.failed, 1);
  assert.equal(svc.fires().length, 2);
  await svc.sync();
  assert.equal(calls.download, 3, 'stiahnutý granul sa znova nesťahuje, zlyhaný áno');
  assert.equal(calls.token, 1, 'token sa znova používa');
  // reštart: nová služba načíta ohniská z disku bez siete
  const svc2 = createSentinel3FrpService({ clientId: 'sh-x', clientSecret: 's', cacheDir: dir, fetchImpl: () => { throw new Error('bez siete'); }, now: () => now });
  await svc2.loadDisk();
  assert.equal(svc2.fires().length, 2);
  now += 25 * 3600_000;
  assert.equal(svc2.fires().length, 0, 'po 24 h sa granul nepočíta');
  assert.equal(createSentinel3FrpService({ clientId: '', clientSecret: '', cacheDir: dir }).enabled(), false);
});
