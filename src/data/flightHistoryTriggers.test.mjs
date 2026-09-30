// src/data/flightHistoryTriggers.test.mjs — spúšťače udalostí z archívu letov (Udalosti, etapa 1, 2026-09-30).
// Testy SPRÁVANIA cez skutočný zápis (recordOpenSkyBody / recordAdsbLolBody): vrátia sa len fixy vo
// vzduchu s núdzovým kódom alebo strmhlavým klesaním nad 3 000 m, so zdrojom fixu; stopa s `withSrc`
// nesie zdroj na konci (overenie berie ako prvú sieť len OpenSky), bez neho ostáva tvar ako doteraz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openFlightHistory } from './flightHistoryStore.js';
import { liveTraceUrl } from './adsblolTrace.js';

const T0 = Date.UTC(2026, 8, 30, 5, 20) / 1000;
// OpenSky riadok: [icao, cs, krajina, t, t, lon, lat, alt, gnd, gs, trk, vr, sensors, geoAlt, squawk, spi, posSrc, cat]
const os = (icao, t, { alt = 10_000, gnd = false, vr = 0, squawk = '1000' } = {}) =>
  [icao, 'TEST1', 'X', t, t, 17, 48, gnd ? null : alt, gnd, 230, 90, vr, null, alt, squawk, false, 0, 4];

test('spúšťače: núdzový kód vo vzduchu a strmhlavé klesanie nad 3 000 m áno; na zemi, nízko a bežný let nie; zdroj fixu', () => {
  const store = openFlightHistory(':memory:', { now: () => (T0 + 3600) * 1000 });
  store.recordOpenSkyBody(JSON.stringify({ time: T0, states: [
    os('aaa001', T0, { squawk: '7700' }),
    os('aaa002', T0, { squawk: '7500', gnd: true }),
    os('aaa003', T0, { vr: -45 }),
    os('aaa004', T0, { vr: -45, alt: 2000 }),
    os('aaa005', T0),
    os('aaa006', T0, { squawk: '7600', vr: -3 }),
  ] }));
  store.recordAdsbLolBody(JSON.stringify({ now: (T0 + 30) * 1000, ac: [{ hex: 'aaa007', flight: 'MIL1', lat: 50, lon: 10, alt_baro: 30000, gs: 400, track: 90, baro_rate: -9000, squawk: '1234', seen_pos: 0 }] }), 'adsb.lol/mil');
  const rows = store.triggersSince(T0 - 60, T0 + 120);
  assert.deepEqual(rows.map((r) => [r.icao24, r.squawk, r.src]).sort(), [
    ['aaa001', '7700', 'opensky'], ['aaa003', '1000', 'opensky'], ['aaa006', '7600', 'opensky'], ['aaa007', '1234', 'adsb.lol/mil'],
  ]);
  const dive = rows.find((r) => r.icao24 === 'aaa003');
  assert.equal(dive.vr, -45);
  assert.equal(dive.alt, 10_000);
  assert.deepEqual(store.triggersSince(T0 + 1, T0 + 10), [], 'časové okno [od, do)');
  const plain = store.track('aaa001', {});
  assert.equal(plain[0].length, 12, 'bez withSrc tvar ako doteraz');
  const withSrc = store.track('aaa001', { withSrc: true });
  assert.equal(withSrc[0][12], 'opensky');
  store.close();
});

test('živá stopa adsb.lol: URL podľa posledných dvoch znakov hexu', () => {
  assert.equal(liveTraceUrl('8965D1'), 'https://adsb.lol/data/traces/d1/trace_full_8965d1.json');
  assert.equal(liveTraceUrl('xyz'), null);
});
