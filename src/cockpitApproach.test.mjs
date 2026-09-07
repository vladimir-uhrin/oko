// src/cockpitApproach.test.mjs
// Priblíženie a METAR cieľa v kokpite (2026-09-07).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  APPROACH_RANGE_KM,
  approachLines,
  approachState,
  destinationLookupCode,
  destinationWeatherLine,
} from './cockpitApproach.js';

const t = (key, vars = {}) => `${key}${Object.keys(vars).length ? ' ' + JSON.stringify(vars) : ''}`;
const LZIB = { lat: 48.1702, lon: 17.2127 };
const AIRPORT = { elevFt: 436, rwy: [['04', '22', 9515, 148, 'ASP', 1, 0, 39, 219]] };
// ~20 km západne od LZIB, 1 200 m MSL, klesá 5 m/s, 80 m/s.
const NEAR = { latitude: 48.17, longitude: 16.94, altitudeM: 1200, verticalRateMps: -5, speedMps: 80, destination: LZIB };

test('priblíženie: do 50 km a klesá → vzdialenosť, výška nad letiskom, sklon, čas, dráha z vetra', () => {
  const state = approachState({ ...NEAR, airport: AIRPORT, wind: { dirDeg: 230, speedKt: 12 } });
  assert.ok(state);
  assert.ok(state.distanceKm > 19 && state.distanceKm < 21, `vzdialenosť ${state.distanceKm}`);
  assert.equal(state.elevationKnown, true);
  assert.ok(Math.abs(state.aglM - (1200 - 436 * 0.3048)) < 0.01, `AGL ${state.aglM} m`);
  assert.ok(state.glideDeg > 2.9 && state.glideDeg < 3.3, `sklon ${state.glideDeg}`);
  assert.ok(state.etaMin > 3.9 && state.etaMin < 4.4, `ETA ${state.etaMin}`);
  assert.equal(state.runway.ident, '22', 'vietor z 230° → dráha 22');
  const lines = approachLines(state, t);
  assert.match(lines.runway, /^RWY 22/);
  assert.match(lines.distance, /cockpit\.approach-distance \{"km":"20","min":4\}/);
  assert.match(lines.height, /cockpit\.approach-height \{"h":"3.501 ft","deg":"3\.\d"\}/, 'výška cez units.js (letecky ft, tisícky s U+202F)');
});

test('priblíženie: ďaleko, na zemi, vysoko bez klesania alebo bez cieľa → null; nízko bez klesania → áno', () => {
  assert.equal(approachState({ ...NEAR, longitude: 15.5 }), null, 'ďalej než 50 km');
  assert.equal(approachState({ ...NEAR, onGround: true }), null);
  assert.equal(approachState({ ...NEAR, altitudeM: 9000, verticalRateMps: 0 }), null, 'prelet vo výške');
  assert.ok(approachState({ ...NEAR, altitudeM: 900, verticalRateMps: 0 }), 'nízko = priblíženie aj bez klesania');
  assert.equal(approachState({ ...NEAR, destination: null }), null);
  assert.equal(approachState({ ...NEAR, latitude: NaN }), null);
  assert.equal(APPROACH_RANGE_KM, 50);
});

test('riadky: bez dráh / bez vetra / bez výšky letiska sú priznané, nie vymyslené', () => {
  const noRunways = approachLines(approachState({ ...NEAR, airport: { elevFt: 436, rwy: [] } }), t);
  assert.equal(noRunways.runway, 'cockpit.approach-runway-none');
  const noWind = approachLines(approachState({ ...NEAR, airport: AIRPORT, wind: null }), t);
  assert.equal(noWind.runway, 'cockpit.approach-runway-unknown');
  const noElev = approachLines(approachState({ ...NEAR, airport: null }), t);
  assert.match(noElev.height, /^cockpit\.approach-height-msl/);
  const slow = approachLines(approachState({ ...NEAR, speedMps: 5, airport: AIRPORT }), t);
  assert.match(slow.distance, /^cockpit\.approach-distance-nomin/);
  assert.equal(approachLines(null, t), null);
});

test('METAR cieľa: stanica, kategória, titulok, vek; čakanie a nedostupnosť', () => {
  const now = 1_700_000_000_000;
  const report = { icaoId: 'LZIB', fltCat: 'VFR', temp: 18.2, wspd: 12, wdir: 230, clouds: [{ cover: 'BKN', base: 4000 }], obsTime: now / 1000 - 25 * 60 };
  const line = destinationWeatherLine(report, 'LZIB', now, t);
  assert.match(line, /^LZIB · VFR · /);
  assert.match(line, /18.°C/, 'teplota z metarHeadline (NBSP pred °C)');
  assert.match(line, /cockpit\.route-metar-age \{"min":25\}$/);
  const stale = destinationWeatherLine({ ...report, obsTime: now / 1000 - 200 * 60 }, 'LZIB', now, t);
  assert.match(stale, /cockpit\.route-metar-stale \{"min":200\}$/);
  assert.equal(destinationWeatherLine(null, 'LZIB', now, t, { pending: true }), 'LZIB · cockpit.route-metar-pending');
  assert.equal(destinationWeatherLine(null, 'LZIB', now, t), 'LZIB · cockpit.route-metar-unavailable');
  assert.equal(destinationWeatherLine(report, null, now, t), '');
});

test('kód cieľa: ICAO má prednosť pred IATA kódom adsbdb; nezmysly prázdne', () => {
  assert.equal(destinationLookupCode({ icao: 'LZIB', code: 'BTS' }), 'LZIB');
  assert.equal(destinationLookupCode({ code: 'bts' }), 'BTS');
  assert.equal(destinationLookupCode({ code: 'Bratislava' }), '');
  assert.equal(destinationLookupCode(null), '');
});

test('tripwire: kokpit má METAR cieľa a blok priblíženia, feed dodáva klesanie, proxy dodáva ICAO', () => {
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  assert.match(ui, /updateDestinationServices\(info, destination\)/, 'updateRoute volá služby cieľa');
  assert.match(ui, /requestAirportMetar\(station, \{ onDone/, 'METAR cez zdieľanú cache airportWeather.js');
  assert.match(ui, /approachState\(\{/, 'stav priblíženia z čistého modulu');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="cockpit-route-metar"/);
  assert.match(html, /id="cockpit-approach"/);
  const flights = readFileSync(new URL('./data/flights.js', import.meta.url), 'utf8');
  assert.match(flights, /verticalRateMps: Number\.isFinite\(info\?\.verticalRate\) \? info\.verticalRate : null,/, 'getTrackedInfo nesie klesanie');
  const vite = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.match(vite, /icao: typeof a\.icao_code === 'string'/, 'adsbdb trasa nesie aj ICAO letiska');
});
