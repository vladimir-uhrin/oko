// src/data/vesselEstimate.test.mjs — odhad polohy lode mimo dosahu (2026-10-11, bod 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { destinationPoint, estimateLine, estimateVesselPosition, initialBearing } from './vesselEstimate.js';
import { greatCircleKm } from './vesselDestination.js';

const sk = (key, vars = {}) => ({
  'vessel.estimate-now': 'Odhad teraz {pos} ±{radius} km (z polohy spred {age})',
  'vessel.estimate-arrived': 'Odhad: asi v cieli {port} od ~{when}',
}[key] || key).replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);

test('geometria: bod vo vzdialenosti a kurz sedia s veľkokružnicou', () => {
  const p = destinationPoint(50, 0, 90, 100);
  assert.ok(Math.abs(greatCircleKm(50, 0, p.lat, p.lon) - 100) < 0.5);
  assert.ok(Math.abs(initialBearing(0, 0, 0, 10) - 90) < 1e-6);
});

test('MINERVA ZEN: z polohy 10. 10. 02:57 pri USA ide k Wilmingtonu, po dosiahnutí cieľa zastane', () => {
  // Skutočná posledná poloha z registra (Roaming) a cieľ USILM.
  const base = { lat: 34.130165, lon: -68.883499, t: Date.parse('2026-10-10T02:57:38Z'), speedKn: 13.1, course: 253 };
  const wilmington = { lat: 34.23, lon: -77.95, name: 'Wilmington' };
  const toGo = greatCircleKm(base.lat, base.lon, wilmington.lat, wilmington.lon);
  const mid = estimateVesselPosition(base, { destination: wilmington, nowMs: base.t + 12 * 3600_000 });
  assert.equal(mid.method, 'destination');
  assert.equal(mid.arrived, false);
  assert.ok(Math.abs(greatCircleKm(base.lat, base.lon, mid.lat, mid.lon) - 13.1 * 1.852 * 12) < 1, '12 h × 13,1 kn');
  assert.ok(greatCircleKm(mid.lat, mid.lon, wilmington.lat, wilmington.lon) < toGo, 'bližšie k cieľu');
  assert.ok(mid.radiusKm > 3, 'neistota rastie s dráhou');
  const late = estimateVesselPosition(base, { destination: wilmington, nowMs: base.t + 40 * 3600_000 });
  assert.equal(late.arrived, true);
  assert.equal(late.lat, wilmington.lat);
  assert.match(estimateLine(late, 'Wilmington', sk, 'sk'), /^Odhad: asi v cieli Wilmington od ~11\. 10\. \d\d:\d\d UTC$/);
  assert.match(estimateLine(mid, 'Wilmington', sk, 'sk'), /^Odhad teraz \d+,\d\d° S \d+,\d\d° Z ±\d+ km \(z polohy spred 12 h\)$/);
});

test('bez cieľa podľa kurzu; čerstvá, stará nad 72 h alebo stojaca loď sa neodhaduje', () => {
  const base = { lat: 50, lon: 0, t: 0, speedKn: 10, course: 0 };
  const byCourse = estimateVesselPosition(base, { nowMs: 3600_000 });
  assert.equal(byCourse.method, 'course');
  assert.ok(byCourse.lat > 50 && Math.abs(byCourse.lon) < 1e-9, 'na sever');
  assert.equal(estimateVesselPosition(base, { nowMs: 10 * 60_000 }), null, 'čerstvá poloha (10 min)');
  assert.equal(estimateVesselPosition(base, { nowMs: 80 * 3600_000 }), null, 'nad 72 h len dohad');
  assert.equal(estimateVesselPosition({ ...base, speedKn: 0.2 }, { nowMs: 3600_000 }), null, 'stojí');
  assert.equal(estimateVesselPosition({ ...base, course: null }, { nowMs: 3600_000 }), null, 'bez kurzu a cieľa nevieme smer');
});
