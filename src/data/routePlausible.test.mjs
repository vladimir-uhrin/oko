// src/data/routePlausible.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DETOUR_MAX, angleDiffDeg, greatCircleKm, routePlausible } from './routePlausible.js';

const SFO = { lat: 37.6188, lon: -122.3754 };
const LAX = { lat: 33.9416, lon: -118.4085 };
const JFK = { lat: 40.6413, lon: -73.7781 };

test('greatCircleKm sanity: SFO→LAX ≈ 543 km', () => {
  const d = greatCircleKm(SFO.lat, SFO.lon, LAX.lat, LAX.lon);
  assert.ok(Math.abs(d - 543) < 15, `got ${d}`);
});

test('plane mid-route SFO→LAX: plausible', () => {
  assert.equal(routePlausible({
    latDeg: 35.8, lonDeg: -120.4, altitudeM: 10000, verticalRateMps: 0,
    origin: SFO, destination: LAX,
  }), true);
});

test('plane in London with an SFO→LAX route: implausible', () => {
  assert.equal(routePlausible({
    latDeg: 51.5, lonDeg: -0.12, altitudeM: 10000, verticalRateMps: 0,
    origin: SFO, destination: LAX,
  }), false);
});

test('vertical trend: low climbing plane near SFO — origin must be local', () => {
  const nearSfo = { latDeg: 37.7, lonDeg: -122.4, altitudeM: 2500 };
  // JFK→SFO passes geometry (near destination), but a CLIMBING plane here just
  // departed — origin JFK (far) contradicts it.
  assert.equal(routePlausible({ ...nearSfo, verticalRateMps: 8, origin: JFK, destination: SFO }), false);
  // The same plane DESCENDING is arriving at SFO — plausible.
  assert.equal(routePlausible({ ...nearSfo, verticalRateMps: -8, origin: JFK, destination: SFO }), true);
});

test('missing data never hides a route (cannot judge → allow)', () => {
  assert.equal(routePlausible({ latDeg: 35.8, lonDeg: -120.4, origin: null, destination: null }), true);
  assert.equal(routePlausible({
    latDeg: 51.5, lonDeg: -0.12,
    origin: { lat: null, lon: null }, destination: null,
  }), true);
});

// ── 2026-10-01: obchádzky a cudzí úsek (naživo v karte chýbala trasa aj ETA, alebo bola zlá) ──
const SIN = { lat: 1.35019, lon: 103.994003 };
const AMS = { lat: 52.308601, lon: 4.76389 };
const CPH = { lat: 55.6179, lon: 12.656 };
const AYT = { lat: 36.898701, lon: 30.800501 };
const VIE = { lat: 48.1103, lon: 16.5697 };
const BTS = { lat: 48.1702, lon: 17.2127 };
const LHR = { lat: 51.47, lon: -0.4543 };
const cruise = { altitudeM: 10_973, verticalRateMps: 0 };

test('obchádzka: SQ324 Singapur → Amsterdam nad Slovenskom (uzavreté vzdušné priestory) — trasa platí aj s kurzom', () => {
  assert.equal(routePlausible({ latDeg: 48.74, lonDeg: 17.05, ...cruise, origin: SIN, destination: AMS }), true, 'stará brána (≤ 200 km od priamky) ju skryla — karta bez trasy aj ETA');
  assert.equal(routePlausible({ latDeg: 48.74, lonDeg: 17.05, ...cruise, trackDeg: 302, origin: SIN, destination: AMS }), true);
  assert.equal(routePlausible({ latDeg: 51.37, lonDeg: 9.94, ...cruise, trackDeg: 296, origin: SIN, destination: AMS }), true, 'o hodinu neskôr nad Nemeckom');
});

test('cudzí úsek: SunExpress XQ3RB má v adsbdb Kodaň → Antalya, ale letí kurzom 307° pri Viedni a 290° nad Nemeckom — Antalya ani raz pred ním → skryť, neotáčať', () => {
  assert.equal(routePlausible({ latDeg: 47.86, lonDeg: 16.98, ...cruise, trackDeg: 307, origin: CPH, destination: AYT }), false);
  assert.equal(routePlausible({ latDeg: 50.42, lonDeg: 11.27, ...cruise, trackDeg: 290, origin: CPH, destination: AYT }), false, 'karta by inak tvrdila zlú trasu aj ETA');
  assert.equal(routePlausible({ latDeg: 50.42, lonDeg: 11.27, ...cruise, trackDeg: 290, origin: AYT, destination: CPH }), false, 'ani do Kodane nie (290° vs. kurz na Kodaň ~10°) — otočenie by bol odhad');
  assert.equal(routePlausible({ latDeg: 47.86, lonDeg: 16.98, ...cruise, trackDeg: 140, origin: CPH, destination: AYT }), true, 'ten istý úsek smerom na Antalyu platí');
  assert.equal(routePlausible({ latDeg: 47.86, lonDeg: 16.98, ...cruise, origin: CPH, destination: AYT }), true, 'bez kurzu sa nesúdi');
  assert.equal(routePlausible({ latDeg: 47.86, lonDeg: 16.98, ...cruise, trackDeg: 307, onGround: true, origin: CPH, destination: AYT }), true, 'na zemi kurz nič neznamená');
});

test('zlé trasy ostávajú skryté: Londýn → New York nad Slovenskom, aj lietadlo ZA cieľom (stará brána ho prijala)', () => {
  assert.equal(routePlausible({ latDeg: 48.5, lonDeg: 18.0, ...cruise, origin: LHR, destination: JFK }), false);
  assert.equal(routePlausible({ latDeg: 48.7, lonDeg: 21.2, ...cruise, origin: VIE, destination: BTS }), false, 'Viedeň → Bratislava, lietadlo nad Košicami');
  assert.ok(DETOUR_MAX < 1.48, 'najmenšia zmeraná zlá trasa je o 48 % dlhšia');
});

test('pri letiskách sa kurz nesúdi (vektorovanie, vyčkávanie): 175 km pred Londýnom kurzom od neho = trasa ostáva', () => {
  assert.equal(routePlausible({ latDeg: 51.0, lonDeg: 2.0, altitudeM: 6000, verticalRateMps: 0, trackDeg: 110, origin: VIE, destination: LHR }), true);
});

test('angleDiffDeg: najmenší rozdiel kurzov 0–180°', () => {
  assert.equal(angleDiffDeg(307, 341), 34);
  assert.equal(angleDiffDeg(10, 350), 20);
  assert.equal(angleDiffDeg(0, 180), 180);
  assert.equal(angleDiffDeg(-90, 270), 0);
});
