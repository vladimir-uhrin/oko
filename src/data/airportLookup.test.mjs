// src/data/airportLookup.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _resetAirportLookupForTest, lookupAirport, parseAirportIndex } from './airportLookup.js';

const GEOJSONL = [
  '{"id":"LZIB","type":"Feature","geometry":{"type":"Point","coordinates":[17.2127,48.1702]},"properties":{"name":"M. R. Štefánik Airport","ident":"LZIB","icao":"LZIB","iata":"BTS","type":"large","municipality":"Bratislava","country":"SK","elevFt":436,"scheduled":true}}',
  '{"id":"05AK","type":"Feature","geometry":{"type":"Point","coordinates":[-149.188,61.668]},"properties":{"name":"Wasilla Creek Airpark","ident":"05AK","icao":null,"iata":null,"type":"small","municipality":"Palmer","country":"US","elevFt":620}}',
  'not json',
  '',
].join('\n');
const DETAILS = { airports: { LZIB: { rwy: [['04', '22', 9515, 148, 'ASP', 1, 0, 39, 219]] } } };

function fakeFetch(calls) {
  return async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('airports.geojsonl')) return { ok: true, text: async () => GEOJSONL };
    if (String(url).endsWith('airport-details.json')) return { ok: true, json: async () => DETAILS };
    return { ok: false, status: 404 };
  };
}

test('index: ICAO, IATA aj ident vedú na ten istý záznam; chybné riadky sa preskočia', () => {
  const index = parseAirportIndex(GEOJSONL);
  assert.equal(index.get('LZIB'), index.get('BTS'));
  assert.equal(index.get('LZIB').elevFt, 436);
  assert.equal(index.get('LZIB').lat, 48.1702);
  assert.equal(index.get('05AK').icao, null);
  assert.equal(index.size, 3);
});

test('lookup: lenivé načítanie oboch súborov raz, dráhy zo sidecaru, neznámy kód null', async () => {
  _resetAirportLookupForTest();
  const calls = [];
  const fetcher = fakeFetch(calls);
  const bts = await lookupAirport('bts', { fetcher });
  assert.equal(bts.icao, 'LZIB');
  assert.deepEqual(bts.rwy, DETAILS.airports.LZIB.rwy);
  const again = await lookupAirport('LZIB', { fetcher });
  assert.equal(again.iata, 'BTS');
  assert.equal(calls.length, 2, 'druhý dopyt nič nesťahuje');
  assert.deepEqual((await lookupAirport('05AK', { fetcher })).rwy, [], 'bez sidecaru prázdne dráhy');
  assert.equal(await lookupAirport('XXXX', { fetcher }), null);
  assert.equal(await lookupAirport('', { fetcher }), null);
  _resetAirportLookupForTest();
});
