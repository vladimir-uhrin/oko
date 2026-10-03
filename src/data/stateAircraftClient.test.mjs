// src/data/stateAircraftClient.test.mjs — štátne lietadlá v prehliadači (2026-09-30): zoznam s cache,
// lety so stránkovaním, riadok letu s dátumom, odvodenou trasou a trvaním.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATE_LIST_TTL_MS,
  _resetStateAircraftClientForTest,
  airportCode,
  fetchStateFlights,
  flightDateUtc,
  loadStateAircraftList,
  stateAircraftListNow,
  stateFlightRowModel,
} from './stateAircraftClient.js';

const T = Date.UTC(2026, 8, 25, 10, 12) / 1000;

test('riadok letu: odvodená trasa (IATA, inak ICAO, neznáme ?), dátum UTC, čas, trvanie, volací znak, núdzový squawk', () => {
  const row = stateFlightRowModel({
    firstT: T, lastT: T + 6780, durationS: 6780, callsign: 'SSG1', squawks: ['1000'],
    origin: { iata: 'BTS', icao: 'LZIB' }, destination: { iata: null, icao: 'EBMB' },
  }, 'sk');
  assert.equal(row.route, 'BTS → EBMB', 'bez mesta v údajoch letiska zostane kód');
  assert.equal(row.codes, 'BTS → EBMB');
  assert.equal(row.sub, 'BTS → EBMB · 25. 9. 2026 · 10:12–12:05 UTC · 1 h 53 min · SSG1');
  assert.equal(row.alert, null);
  const en = stateFlightRowModel({ firstT: T, lastT: T + 600, durationS: 600, callsign: '', squawks: ['7700'], origin: null, destination: null }, 'en');
  assert.equal(en.route, 'unknown → unknown', 'neznáme letisko sa nevymýšľa');
  assert.equal(en.sub, '? → ? · 2026-09-25 · 10:12–10:22 UTC · 10 min');
  assert.equal(en.alert, '7700');
  assert.equal(airportCode({ ident: 'LZ01' }), 'LZ01');
  assert.equal(flightDateUtc(Date.UTC(2024, 0, 5, 23, 59) / 1000, 'sk'), '5. 1. 2024');
});

test('lety: parametre dopytu, stránkovanie cez before, hex doplnený do každého letu', async () => {
  const urls = [];
  const fetcher = async (url) => {
    urls.push(url);
    return { ok: true, json: async () => ({ hex: '505abc', flights: [{ id: 7, firstT: T, lastT: T + 60 }] }) };
  };
  const flights = await fetchStateFlights('505ABC', { fetcher });
  assert.equal(flights[0].icao24, '505abc', 'panel História letov potrebuje hex letu');
  await fetchStateFlights('505abc', { before: T + 60.7, limit: 5, fetcher });
  assert.deepEqual(urls, [
    '/api/state-aircraft/flights?hex=505abc&limit=20',
    `/api/state-aircraft/flights?hex=505abc&limit=5&before=${Math.floor(T + 60.7)}`,
  ]);
  await assert.rejects(fetchStateFlights('505abc', { fetcher: async () => ({ ok: false, status: 503 }) }), /503/);
});

test('zoznam: jeden dopyt počas 30 min, pri chybe prázdny zoznam (odznak sa len neukáže)', async () => {
  _resetStateAircraftClientForTest();
  let now = 1_000_000;
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return { ok: true, json: async () => ({ aircraft: [{ hex: '505ABC', reg: 'OM-TST' }] }) };
  };
  assert.equal(stateAircraftListNow(), null);
  const list = await loadStateAircraftList({ fetcher, now: () => now });
  assert.equal(list.byHex.get('505abc').reg, 'OM-TST');
  await loadStateAircraftList({ fetcher, now: () => now });
  assert.equal(calls, 1);
  now += STATE_LIST_TTL_MS + 1;
  await loadStateAircraftList({ fetcher, now: () => now });
  assert.equal(calls, 2);
  _resetStateAircraftClientForTest();
  const empty = await loadStateAircraftList({ fetcher: async () => { throw new Error('offline'); } });
  assert.equal(empty.aircraft.length, 0);
  _resetStateAircraftClientForTest();
});

test('miesto letiska pre bežného čitateľa: mesto, pri zahraničí aj štát v jazyku rozhrania, doma len mesto (vlastník: „normálny človek to nevie")', async () => {
  const { airportPlace } = await import('./stateAircraftClient.js');
  const otp = { iata: 'OTP', icao: 'LROP', municipality: 'Bucharest', country: 'RO' };
  const bts = { iata: 'BTS', icao: 'LZIB', municipality: 'Bratislava', country: 'SK' };
  assert.equal(airportPlace(otp, 'sk'), 'Bucharest (Rumunsko)');
  assert.equal(airportPlace(otp, 'en'), 'Bucharest (Romania)');
  assert.equal(airportPlace(bts, 'sk'), 'Bratislava', 'Slovensko sa pri domácom letisku nepíše');
  assert.equal(airportPlace({ icao: 'XXXX', name: 'Some Field' }, 'sk'), 'Some Field', 'bez mesta názov letiska');
  assert.equal(airportPlace(null, 'sk'), 'neznáme');
  const row = stateFlightRowModel({ firstT: T, lastT: T + 3600, durationS: 3600, callsign: 'SQF901', squawks: [], origin: otp, destination: bts }, 'sk');
  assert.equal(row.route, 'Bucharest (Rumunsko) → Bratislava');
  assert.match(row.sub, /^OTP → BTS · 25\. 9\. 2026 · /, 'kódy ostanú drobným písmom v podriadku');
});
