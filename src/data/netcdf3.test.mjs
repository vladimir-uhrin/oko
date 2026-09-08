// src/data/netcdf3.test.mjs
// Minimálna NetCDF-3 čítačka (2026-09-08) — súbor sa poskladá v teste podľa špecifikácie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridOf, parseNetcdf3 } from './netcdf3.js';

/** Zloží NetCDF-3 classic: dims lat=2, lon=3; float var s scale/fill; short var; char atribúty. */
function buildNetcdf({ version = 1 } = {}) {
  const parts = [];
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  const pad = (buf) => Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4)]);
  const name = (s) => Buffer.concat([u32(s.length), pad(Buffer.from(s, 'utf8'))]);
  const attrText = (k, v) => Buffer.concat([name(k), u32(2), u32(v.length), pad(Buffer.from(v, 'utf8'))]);
  const attrFloat = (k, v) => { const b = Buffer.alloc(4); b.writeFloatBE(v); return Buffer.concat([name(k), u32(5), u32(1), b]); };
  parts.push(Buffer.from('CDF'), Buffer.from([version]), u32(0)); // numrecs
  // dims
  parts.push(u32(0x0A), u32(2), name('latitude'), u32(2), name('longitude'), u32(3));
  // global attrs
  parts.push(u32(0x0C), u32(1), attrText('title', 'test'));
  // vars: latitude(float[2]), longitude(float[3]), temp(float[lat,lon]) s scale a fill, code(short[lat,lon])
  const headerLen = () => Buffer.concat(parts).length;
  const varsStart = [];
  const begins = {};
  const dataLat = Buffer.alloc(8); dataLat.writeFloatBE(50, 0); dataLat.writeFloatBE(49, 4);
  const dataLon = Buffer.alloc(12); [16, 17, 18].forEach((v, i) => dataLon.writeFloatBE(v, i * 4));
  const dataTemp = Buffer.alloc(24); [1, 2, 3, 4, -9999, 6].forEach((v, i) => dataTemp.writeFloatBE(v, i * 4));
  const dataCode = Buffer.alloc(12); [7, 8, 9, 10, 11, 12].forEach((v, i) => dataCode.writeInt16BE(v, i * 2));
  // Predpočítaj dĺžku hlavičky: napíš var_list dvakrát (druhýkrát so správnymi begin).
  function varList(beginsMap) {
    const off = (n) => (version === 1 ? u32(n) : Buffer.concat([u32(0), u32(n)]));
    return Buffer.concat([
      u32(0x0B), u32(4),
      name('latitude'), u32(1), u32(0), u32(0), u32(0), u32(5), u32(8), off(beginsMap.latitude || 0),
      name('longitude'), u32(1), u32(1), u32(0), u32(0), u32(5), u32(12), off(beginsMap.longitude || 0),
      name('temp'), u32(2), u32(0), u32(1), u32(0x0C), u32(2), attrFloat('scale_factor', 0.5), attrFloat('_FillValue', -9999), u32(5), u32(24), off(beginsMap.temp || 0),
      name('code'), u32(2), u32(0), u32(1), u32(0), u32(0), u32(3), u32(12), off(beginsMap.code || 0),
    ]);
  }
  const headerNoVars = Buffer.concat(parts);
  const vl = varList({});
  let cursor = headerNoVars.length + vl.length;
  begins.latitude = cursor; cursor += 8;
  begins.longitude = cursor; cursor += 12;
  begins.temp = cursor; cursor += 24;
  begins.code = cursor; cursor += 12;
  return Buffer.concat([headerNoVars, varList(begins), dataLat, dataLon, dataTemp, dataCode]);
}

test('parseNetcdf3: dimenzie, atribúty, typy, scale_factor a _FillValue → NaN; 64-bit offset variant', () => {
  for (const version of [1, 2]) {
    const nc = parseNetcdf3(buildNetcdf({ version }));
    assert.equal(nc.version, version);
    assert.deepEqual(nc.dims.map((d) => [d.name, d.size]), [['latitude', 2], ['longitude', 3]]);
    assert.equal(nc.attrs.title, 'test');
    assert.equal(nc.vars.temp.type, 'float');
    assert.deepEqual(nc.vars.temp.dims, ['latitude', 'longitude']);
    const temp = nc.read('temp');
    assert.deepEqual(Array.from(temp.subarray(0, 4)), [0.5, 1, 1.5, 2], 'scale_factor');
    assert.ok(Number.isNaN(temp[4]), '_FillValue → NaN');
    assert.equal(temp[5], 3);
    assert.deepEqual(Array.from(nc.read('code')), [7, 8, 9, 10, 11, 12]);
    assert.deepEqual(Array.from(nc.read('temp', { raw: true }).subarray(4, 5)), [-9999]);
  }
});

test('gridOf: pole [lat][lon] s osami; chýbajúca premenná a HDF5 magic hádžu zrozumiteľnú chybu', () => {
  const nc = parseNetcdf3(buildNetcdf());
  const g = gridOf(nc, 'temp');
  assert.equal(g.rows, 2);
  assert.equal(g.cols, 3);
  assert.deepEqual(Array.from(g.lat), [50, 49]);
  assert.deepEqual(Array.from(g.lon), [16, 17, 18]);
  assert.equal(g.values.length, 6);
  assert.throws(() => gridOf(nc, 'nope'), /neexistuje/);
  assert.throws(() => parseNetcdf3(new Uint8Array([0x89, 0x48, 0x44, 0x46, 0, 0, 0, 0])), /NetCDF-4/);
  assert.throws(() => parseNetcdf3(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), /magic/);
});
