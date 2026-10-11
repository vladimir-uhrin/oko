// src/data/aisSupplementFeeds.test.mjs — zdroje polôh lodí navyše (2026-10-11).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createShipIdResolver,
  feedLabel,
  mergeSupplementRow,
  mtTileRowToVessel,
  oceanTiles,
  parseAiscastVessels,
  parseMtTileRows,
  parseOpenSeaFeedSnapshot,
} from './aisSupplementFeeds.js';

const NOW = Date.parse('2026-10-11T07:00:00Z');

test('OpenSeaFeed: skutočný tvar snímky; zlé MMSI a nulová poloha von', () => {
  const rows = parseOpenSeaFeedSnapshot({ vessels: [
    { mmsi: 211671760, lat: 50.773385, lon: 7.064815, sog: 0, cog: 323, hdg: 120, nav: 5, name: 'CASSIUS', type: 99, callsign: 'DB5267', dest: 'BONN', draught: 1.1, len: 20, beam: 5, ts: 1791701325726 },
    { mmsi: 1234, lat: 1, lon: 1, ts: 1 },
    { mmsi: 247327520, lat: 0, lon: 0, ts: 1791701756961 },
    { mmsi: 247327521, lat: 38.7, lon: -9.4, sog: 0, cog: 326.2, hdg: 511, ts: 1791701756961 },
  ] });
  assert.equal(rows.length, 2);
  assert.deepEqual({ ...rows[0], last_position_UTC: undefined }, {
    lat: 50.773385, lon: 7.064815, name: 'CASSIUS', mmsi: '211671760', imo: null, type: '99', destination: 'BONN', call_sign: 'DB5267',
    length_m: 20, beam_m: 5, draught_m: 1.1, eta: null, nav_status: 5, rate_of_turn: null, ais_class: null, pos_estimated: false,
    speed: 0, course: 323, heading: 120, last_position_UTC: undefined, last_position_epoch: 1791701325, feed: 'openseafeed',
  });
  assert.equal(rows[1].heading, null, '511 = neznámy smer');
  assert.equal(rows[1].name, 'MMSI 247327521');
});

test('Open Waters AIS: GeoJSON, čas „seen"', () => {
  const rows = parseAiscastVessels({ features: [
    { geometry: { coordinates: [1.5506966666666666, 50.97712] }, id: 232063671, properties: { beam: 31, callsign: 'MSUF4', cog: 32, destination: 'NLRTM', draught: 7.7, eta: '10-11 16:00', heading: 33, imo: 9780665, kind: 'vessel', length: 178, mmsi: 232063671, name: 'CMA CGM JANE', nav_status: 0, seen: '2026-10-11T06:59:33Z', sog: 9.7, type: 71 } },
    { geometry: { coordinates: [1, 1] }, id: 2194006, properties: { kind: 'base_station', mmsi: 2194006, seen: '2026-10-11T06:59:33Z' } },
  ] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].imo, '9780665');
  assert.equal(rows[0].last_position_epoch, Date.parse('2026-10-11T06:59:33Z') / 1000);
  assert.equal(rows[0].feed, 'aiscast');
});

test('dlaždica oceánu: rýchlosť v desatinách uzla, vek v minútach, bez MMSI', () => {
  const rows = parseMtTileRows({ type: 1, data: { rows: [
    { LAT: '-2.3069668', LON: '84.258812', SPEED: '116', COURSE: '231', HEADING: '233', ELAPSED: '22', DESTINATION: 'SG SIN>BR PMA', FLAG: 'HK', LENGTH: '361', SHIPNAME: 'ORE NINGBO', SHIPTYPE: '7', SHIP_ID: '5810894', WIDTH: '65' },
    { LAT: 'x', LON: '1', SHIP_ID: '1', ELAPSED: '1' },
  ] } }, NOW);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].speed, 11.6);
  assert.equal(rows[0].epochSec, NOW / 1000 - 22 * 60);
  const v = mtTileRowToVessel(rows[0], '477000000');
  assert.equal(v.mmsi, '477000000');
  assert.equal(v.feed, 'ocean');
  assert.equal(v.name, 'ORE NINGBO');
  assert.equal(oceanTiles().length, 40);
});

test('zlúčenie: novšia vyhrá, staršia nie, stará nad 6 h nie; statické polia ostanú', () => {
  const existing = { mmsi: '232063671', lat: 50, lon: 1, name: 'CMA CGM JANE', imo: '9780665', length_m: 178, nav_status: 0, ais_class: 'A', last_position_epoch: NOW / 1000 - 600, speed: 9 };
  const newer = { ...parseOpenSeaFeedSnapshot({ vessels: [{ mmsi: 232063671, lat: 50.1, lon: 1.1, sog: 9.7, ts: NOW - 60_000 }] })[0] };
  const m = mergeSupplementRow(existing, newer, NOW);
  assert.equal(m.lat, 50.1);
  assert.equal(m.imo, '9780665', 'statické polia z AISStream ostanú');
  assert.equal(m.length_m, 178);
  assert.equal(m.name, 'CMA CGM JANE', '„MMSI …" neprepíše meno');
  assert.equal(m.nav_status, 0);
  assert.equal(m.feed, 'openseafeed');
  assert.equal(m._updatedAt, NOW - 60_000);
  assert.equal(mergeSupplementRow({ ...existing, last_position_epoch: NOW / 1000 - 70 }, newer, NOW), null, 'len o 10 s novšia');
  assert.equal(mergeSupplementRow(null, { ...newer, last_position_epoch: NOW / 1000 - 7 * 3600 }, NOW), null, 'nad 6 h');
  assert.equal(mergeSupplementRow(null, { ...newer, last_position_epoch: NOW / 1000 + 3600 }, NOW), null, 'z budúcnosti');
  assert.equal(mergeSupplementRow(null, newer, NOW).mmsi, '232063671');
});

test('preklad ID registra → MMSI: fronta, jedno naraz, neúspech sa zapamätá', async () => {
  const calls = [];
  const r = createShipIdResolver({ resolveOne: async (id) => { calls.push(id); return id === '1' ? { mmsi: '477000000' } : { mmsi: null }; }, maxQueue: 2 });
  r.want('1'); r.want('1'); r.want('2'); r.want('3');
  assert.equal(r.pending(), 2, 'strop fronty');
  assert.equal(await r.step(), true);
  assert.equal(await r.step(), true);
  assert.equal(await r.step(), false);
  assert.deepEqual(calls, ['1', '2']);
  assert.equal(r.get('1'), '477000000');
  assert.equal(r.get('2'), null);
  r.want('2');
  assert.equal(r.pending(), 0, 'známe ID sa znova nepýta');
});

test('pôvod do karty', () => {
  assert.equal(feedLabel(''), 'AISStream');
  assert.equal(feedLabel('openseafeed'), 'OpenSeaFeed (CC BY 4.0)');
  assert.equal(feedLabel('ocean'), 'oceán · oneskorené');
});
