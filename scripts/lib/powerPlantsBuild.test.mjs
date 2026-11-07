import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  MIN_PLANT_MW, PLANT_OVERRIDES, buildPlantFeatures, cleanPlantName, extractZipEntry, latestGeneration, parseCsv, parseCsvLine, plantFeature,
} from './powerPlantsBuild.mjs';

const row = (o) => ({
  country: 'SVK', country_long: 'Slovakia', name: 'X Power Plant Slovakia', gppd_idnr: 'T1', capacity_mw: '500', latitude: '48.1', longitude: '17.1',
  primary_fuel: 'Gas', other_fuel1: '', other_fuel2: '', other_fuel3: '', commissioning_year: '', owner: '', ...o,
});

test('CSV: úvodzovky, čiarky v poli a zdvojené úvodzovky', () => {
  assert.deepEqual(parseCsvLine('a,"b, c","d ""e""",'), ['a', 'b, c', 'd "e"', '']);
  assert.deepEqual(parseCsv('x,y\r\n1,2\n3,4\n'), [{ x: '1', y: '2' }, { x: '3', y: '4' }]);
});

test('meno bez pripojenej krajiny', () => {
  assert.equal(cleanPlantName('Mochovce Nuclear Power Plant Slovakia', 'Slovakia'), 'Mochovce Nuclear Power Plant');
  assert.equal(cleanPlantName('Slovakia', 'Slovakia'), 'Slovakia');
  assert.equal(cleanPlantName('Three Gorges Dam', 'China'), 'Three Gorges Dam');
});

test('feature: prah výkonu, vlajka ISO2 veľkými, palivo do skupiny', () => {
  assert.equal(plantFeature(row({ capacity_mw: String(MIN_PLANT_MW - 1) })), null);
  assert.equal(plantFeature(row({ latitude: '' })), null);
  const f = plantFeature(row({ primary_fuel: 'Petcoke', commissioning_year: '1998.0', owner: ' SE a.s. ' }));
  assert.equal(f.properties.cc, 'SK');
  assert.equal(f.properties.fuel, 'oil');
  assert.equal(f.properties.fuel_raw, 'Petcoke');
  assert.equal(f.properties.year, 1998);
  assert.equal(f.properties.owner, 'SE a.s.');
  assert.equal(f.properties.name, 'X Power Plant');
  assert.equal(plantFeature(row({ country_long: 'Cote DIvoire' })).properties.cc, 'CI');
  assert.equal(plantFeature(row({})).properties.fuel_raw, undefined, 'zhodné palivo sa neopakuje');
});

test('výroba: posledný nahlásený rok; nezmyselne nízka sa zahodí', () => {
  assert.deepEqual(latestGeneration({ generation_gwh_2017: '7196.5', generation_gwh_2019: '' }), { gwh: 7196.5, year: 2017 });
  assert.equal(latestGeneration({}), null);
  const ok = plantFeature(row({ generation_gwh_2018: '2000' }));
  assert.equal(ok.properties.gen_gwh, 2000);
  assert.equal(ok.properties.gen_year, 2018);
  const bogus = plantFeature(row({ capacity_mw: '218', generation_gwh_2017: '1.512' }));
  assert.equal(bogus.properties.gen_gwh, undefined);
});

test('overené opravy: zatvorené uhoľné elektrárne SR a výkon Mochoviec', () => {
  for (const id of ['GEODB0042634', 'GEODB0042632']) {
    const f = plantFeature(row({ gppd_idnr: id, primary_fuel: 'Coal' }));
    assert.equal(f.properties.status, 'closed');
    assert.match(f.properties.closed, /^\d{4}-\d{2}$/);
    assert.equal(f.properties.corrected, true);
    assert.match(PLANT_OVERRIDES[id].note_src, /^https:\/\//, 'každá oprava má zdroj');
  }
  const m = plantFeature(row({ gppd_idnr: 'GEODB0004330', capacity_mw: '880', primary_fuel: 'Nuclear' }));
  assert.equal(m.properties.mw, 1411);
});

test('poradie: od najväčších', () => {
  const out = buildPlantFeatures([row({ gppd_idnr: 'a', capacity_mw: '200' }), row({ gppd_idnr: 'b', capacity_mw: '900' }), row({ gppd_idnr: 'c', capacity_mw: '10' })]);
  assert.deepEqual(out.map((f) => f.id), ['b', 'a']);
});

test('ZIP: deflate záznam z centrálneho adresára', () => {
  const name = Buffer.from('dir/global_power_plant_database.csv');
  const data = Buffer.from('x,y\n1,2\n');
  const comp = deflateRawSync(data);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
  const cdOffset = local.length + name.length + comp.length;
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + name.length, 12); eocd.writeUInt32LE(cdOffset, 16);
  const zip = Buffer.concat([local, name, comp, central, name, eocd]);
  assert.equal(extractZipEntry(zip, 'global_power_plant_database.csv').toString(), 'x,y\n1,2\n');
  assert.throws(() => extractZipEntry(zip, 'missing.csv'), /not found/);
});
