// src/data/flightEstimate.test.mjs — odhadovaná poloha lietadla bez signálu (2026-10-04).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ESTIMATE_MISSING_AFTER_S, ESTIMATE_NO_ROUTE_MAX_S, createEstimateTracker, estimatePosition, fixFromState,
  qualifiesForEstimate, uncertaintyKm,
} from './flightEstimate.js';
import { greatCircleKm } from './routePlausible.js';

const T0 = 1_791_000_000; // s
// Lietadlo nad Írskom smerom na západ (Atlantik), FL370, 240 m/s.
const state = (hex, lon, lat, { t = T0, alt = 11_300, gs = 240, trk = 270, ground = false, cs = 'DLH400' } = {}) =>
  [hex, `${cs}  `, 'Germany', t, t, lon, lat, alt, ground, gs, trk, 0, null, alt + 50, '1000', false, 0, 3];
const JFK = { code: 'JFK', icao: 'KJFK', name: 'New York', lat: 40.6413, lon: -73.7781, country: 'US' };
const FRA = { code: 'FRA', icao: 'EDDF', name: 'Frankfurt', lat: 50.0379, lon: 8.5622, country: 'DE' };
const ROUTE = { origin: FRA, destination: JFK, airline: 'Lufthansa', callsignIata: 'LH400' };

test('kto dostane odhad: len vo vzduchu, vysoko a rýchlo', () => {
  const fix = fixFromState(state('3c6444', -10, 53), T0);
  assert.equal(qualifiesForEstimate(fix), true);
  assert.equal(qualifiesForEstimate(fixFromState(state('a', -10, 53, { ground: true }), T0)), false, 'na zemi nie');
  assert.equal(qualifiesForEstimate(fixFromState(state('a', -10, 53, { alt: 1200 }), T0)), false, 'nízko (pristáva/štartuje) nie');
  assert.equal(qualifiesForEstimate(fixFromState(state('a', -10, 53, { gs: 60 }), T0)), false, 'pomaly (vrtuľník) nie');
  assert.equal(fix.cs, 'DLH400');
  assert.equal(fix.altM, 11_350, 'geometrická výška má prednosť');
});

test('so známym cieľom letí po veľkej kružnici k cieľu poslednou rýchlosťou a pri cieli skončí', () => {
  const fix = fixFromState(state('3c6444', -10, 53), T0);
  const totalKm = greatCircleKm(53, -10, JFK.lat, JFK.lon);
  const oneHour = estimatePosition(fix, ROUTE, (T0 + 3600) * 1000);
  assert.equal(oneHour.method, 'route');
  assert.ok(Math.abs(oneHour.distanceKm - 864) < 1, 'za hodinu 240 m/s = 864 km');
  const leftKm = greatCircleKm(oneHour.lat, oneHour.lon, JFK.lat, JFK.lon);
  assert.ok(Math.abs(leftKm - (totalKm - 864)) < 2, 'leží na kružnici k cieľu');
  assert.ok(oneHour.lon < -10 && oneHour.lon > -40, 'nad Atlantikom smerom na západ');
  assert.equal(oneHour.ended, false);
  assert.ok(oneHour.uncertaintyKm > 60 && oneHour.uncertaintyKm < 80, 'neistota rastie so vzdialenosťou');
  const arrived = estimatePosition(fix, ROUTE, (T0 + Math.ceil(totalKm * 1000 / 240) + 10) * 1000);
  assert.equal(arrived.ended, true);
  assert.equal(arrived.reason, 'arrived');
  const near = estimatePosition(fix, ROUTE, (T0 + Math.floor((totalKm - 100) * 1000 / 240)) * 1000);
  assert.ok(near.altM < fix.altM, 'posledných 200 km klesá');
});

test('bez cieľa (alebo s nezmyselnou trasou) letí v poslednom smere najviac 2 hodiny', () => {
  const fix = fixFromState(state('3c6444', -10, 53), T0);
  const est = estimatePosition(fix, null, (T0 + 1800) * 1000);
  assert.equal(est.method, 'track');
  assert.ok(Math.abs(est.lat - 53) < 0.6 && est.lon < -15, 'na západ po kružnici');
  assert.equal(estimatePosition(fix, null, (T0 + ESTIMATE_NO_ROUTE_MAX_S + 1) * 1000).ended, true);
  // Trasa opačným smerom (letí na západ, cieľ Frankfurt za chrbtom) sa nepoužije.
  const wrong = estimatePosition(fix, { origin: JFK, destination: FRA }, (T0 + 1800) * 1000);
  assert.equal(wrong.method, 'track', 'cieľ za chrbtom = trasa neplatí');
});

test('neistota: 5 km + 8 % preletenej vzdialenosti', () => {
  assert.equal(uncertaintyKm(0), 5);
  assert.equal(uncertaintyKm(1000), 85);
});

test('sledovač: zmiznuté lietadlo vo vzduchu ide do odhadov, návrat signálu ho vyradí; pristávajúce nie', () => {
  const tracker = createEstimateTracker();
  const world = (extra = [], t = T0) => ({ time: t, states: [...Array.from({ length: 200 }, (_, i) => state(`f${String(i).padStart(5, '0')}`, 10 + i * 0.01, 48, { t, cs: 'XXX1' })), ...extra] });
  tracker.ingest(world([state('3c6444', -10, 53), state('4b1805', 17.2, 48.17, { alt: 900, gs: 70 })]));
  // Ďalší snímok o 30 s bez nich — ešte nie je „bez signálu".
  assert.equal(tracker.ingest(world([], T0 + 30)), 0);
  assert.equal(tracker.list((T0 + 30) * 1000).length, 0);
  // Po ESTIMATE_MISSING_AFTER_S áno — ale len to vo výške, nie pristávajúce nízko a pomaly.
  assert.equal(tracker.ingest(world([], T0 + ESTIMATE_MISSING_AFTER_S + 10)), 1);
  const list = tracker.list((T0 + 200) * 1000);
  assert.deepEqual(list.map((e) => e.hex), ['3c6444']);
  assert.equal(list[0].route, null);
  // Signál sa vrátil.
  tracker.ingest(world([state('3c6444', -25, 52, { t: T0 + 3600 })], T0 + 3600));
  assert.equal(tracker.list((T0 + 3600) * 1000).length, 0);
});

test('sledovač: polovičný snímok (výpadok, regionálna záloha) nevyrobí falošné odhady', () => {
  const tracker = createEstimateTracker();
  const many = (t, n) => ({ time: t, states: Array.from({ length: n }, (_, i) => state(`a${String(i).padStart(5, '0')}`, -20 + i * 0.001, 50, { t })) });
  tracker.ingest(many(T0, 1000));
  assert.equal(tracker.ingest(many(T0 + 600, 100)), 0, 'tretina snímku = nič nezmizlo');
  assert.equal(tracker.list((T0 + 600) * 1000).length, 0);
  assert.equal(tracker.status().skippedPartial, 1);
  assert.equal(tracker.ingest(many(T0 + 600, 1000)), 0, 'starší alebo rovnaký čas snímku sa ignoruje');
});

test('sledovač: trasu dohľadá pre volací znak dopravcu; pri cieli vyradí, inak ju pošle s odhadom', async () => {
  const lookups = [];
  const tracker = createEstimateTracker({ lookupGapMs: 0, lookupRoute: async (cs) => { lookups.push(cs); return cs === 'DLH400' ? ROUTE : { origin: FRA, destination: { ...FRA, code: 'XXX', lat: 53.02, lon: -10.02 } }; } });
  const snap = (t, extra) => ({ time: t, states: [...Array.from({ length: 50 }, (_, i) => state(`b${String(i).padStart(5, '0')}`, 5, 45 + i * 0.01, { t, cs: 'N12345' })), ...extra] });
  tracker.ingest(snap(T0, [state('3c6444', -10, 53), state('aaaaaa', -10, 53, { cs: 'EIN105' })]));
  tracker.ingest(snap(T0 + 300, []));
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(lookups.sort(), ['DLH400', 'EIN105'], 'len volacie znaky dopravcov');
  const list = tracker.list((T0 + 400) * 1000);
  assert.deepEqual(list.map((e) => e.hex), ['3c6444'], 'EIN105 má cieľ 2 km od poslednej polohy = pristáva, vyradený');
  assert.equal(list[0].route.destination.code, 'JFK');
});
