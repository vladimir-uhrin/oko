// src/data/airportWeather.test.mjs
// METAR karta letiska: formátovanie dekódovaného reportu, výber stanice
// a cache so vstreknutým fetcherom (žiadna sieť v testoch).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  METAR_CACHE_TTL_MS,
  cachedMetarCardLines,
  metarCardLines,
  metarStationId,
  requestAirportMetar,
  _resetMetarCacheForTest,
} from './airportWeather.js';

const NOW = Date.parse('2026-09-02T04:00:00Z');
const REPORT = {
  icaoId: 'LZIB',
  fltCat: 'VFR',
  wdir: 240,
  wspd: 11,
  visib: '10+',
  temp: 21.7,
  dewp: 12.1,
  altim: 1018.6,
  obsTime: Math.floor(Date.parse('2026-09-02T03:30:00Z') / 1000),
};

test('metarCardLines: plný report → kategória/vietor/dohľadnosť, teploty/QNH, čas+vek', () => {
  assert.deepEqual(metarCardLines(REPORT, NOW), [
    'VFR · 240°/11KT · VIS 10+SM',
    'T22° DP12° · QNH 1019',
    'METAR 03:30Z (30 min)',
  ]);
});

test('metarCardLines: CALM, VRB, nárazy a chýbajúce polia degradujú poctivo', () => {
  assert.equal(metarCardLines({ ...REPORT, wspd: 0, wdir: 0 }, NOW)[0], 'VFR · CALM · VIS 10+SM');
  assert.equal(metarCardLines({ ...REPORT, wdir: 'VRB' }, NOW)[0], 'VFR · VRB/11KT · VIS 10+SM');
  assert.equal(
    metarCardLines({ ...REPORT, wgst: 22 }, NOW)[0],
    'VFR · 240°/11KT G22 · VIS 10+SM',
  );
  // Bez fltCat vedie riadok slovom METAR — kategória sa nevymýšľa.
  assert.equal(metarCardLines({ ...REPORT, fltCat: undefined }, NOW)[0], 'METAR · 240°/11KT · VIS 10+SM');
  // Záporná teplota sa zaokrúhľuje a nesie znamienko.
  assert.equal(metarCardLines({ ...REPORT, temp: -3.4, dewp: -7.8 }, NOW)[1], 'T-3° DP-8° · QNH 1019');
  // Bez času nie je vek — riadok sa vynechá, nikdy sa nefalšuje.
  assert.deepEqual(
    metarCardLines({ fltCat: 'IFR' }, NOW),
    ['IFR'],
  );
  assert.deepEqual(metarCardLines(null, NOW), []);
});

test('metarStationId: ICAO má prednosť, ident je fallback, ne-ICAO identy odpadnú', () => {
  assert.equal(metarStationId({ icao: 'LZIB', ident: 'LZIB' }), 'LZIB');
  assert.equal(metarStationId({ icao: null, ident: 'LZKZ' }), 'LZKZ');
  // OurAirports identy ako 'US-0571' nie sú METAR stanice.
  assert.equal(metarStationId({ icao: null, ident: 'US-0571' }), null);
  assert.equal(metarStationId({ ident: 'lzib' }), null, 'malé písmená nie sú platný kód');
  assert.equal(metarStationId({}), null);
  assert.equal(metarStationId(null), null);
});

test('cache: jeden fetch na stanicu v TTL okne, odpoveď plní riadky, onDone sa zavolá', async () => {
  _resetMetarCacheForTest();
  let fetches = 0;
  const fetcher = async (url) => {
    fetches += 1;
    assert.match(String(url), /\/api\/metar\?ids=LZIB$/);
    return { ok: true, json: async () => [REPORT] };
  };
  let done = 0;
  await requestAirportMetar('LZIB', { fetcher, onDone: () => { done += 1; }, nowMs: NOW });
  assert.equal(fetches, 1);
  assert.equal(done, 1);
  assert.deepEqual(cachedMetarCardLines('LZIB', NOW)[0], 'VFR · 240°/11KT · VIS 10+SM');

  // Čerstvá cache: žiadny ďalší fetch.
  await requestAirportMetar('LZIB', { fetcher, onDone: () => { done += 1; }, nowMs: NOW + 60_000 });
  assert.equal(fetches, 1);
  // Po TTL sa obnoví.
  await requestAirportMetar('LZIB', { fetcher, onDone: () => {}, nowMs: NOW + METAR_CACHE_TTL_MS + 1 });
  assert.equal(fetches, 2);
});

test('cache: prázdna odpoveď je poctivé NO METAR, chyba je UNAVAILABLE a nekešuje sa dlho', async () => {
  _resetMetarCacheForTest();
  await requestAirportMetar('XX99', {
    fetcher: async () => ({ ok: true, json: async () => [] }),
    onDone: () => {},
    nowMs: NOW,
  });
  assert.deepEqual(cachedMetarCardLines('XX99', NOW), ['NO METAR']);

  await requestAirportMetar('YY99', {
    fetcher: async () => ({ ok: false, status: 503 }),
    onDone: () => {},
    nowMs: NOW,
  });
  assert.deepEqual(cachedMetarCardLines('YY99', NOW), ['METAR UNAVAILABLE']);
  // Neznáma stanica bez fetchu: žiadne riadky (karta bez METAR sekcie).
  assert.deepEqual(cachedMetarCardLines('ZZ99', NOW), []);
});
