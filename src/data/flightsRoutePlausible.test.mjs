// src/data/flightsRoutePlausible.test.mjs — trasa v kartách lietadiel (2026-10-01, vlastník: „v kartičkách
// chýba ETA"). Naživo: SQ324 Singapur → Amsterdam nad Slovenskom (obchádzka) mal kartu bez trasy aj ETA;
// SunExpress XQ3RB s trasou Kodaň → Antalya z adsbdb letel nad Nemeckom na západ — iný úsek, ktorý sa
// nesmie ukázať ako fakt. Test SPRÁVANIA cez vrstvu lietadiel: kartička pod kurzorom ide cez tú istú
// bránu ako karta, trasová čiara aj hlas (_routeIsPlausible s kurzom lietadla).
// Vlastný súbor — kandidáti zostávajú v stave modulu (node --test spúšťa súbory oddelene).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import flightsLayer, { _addFlightTrackingCandidateForTest } from './flights.js';

const SIN = { code: 'SIN', name: 'Singapore', lat: 1.35019, lon: 103.994003, country: 'SG' };
const AMS = { code: 'AMS', name: 'Amsterdam', lat: 52.308601, lon: 4.76389, country: 'NL' };
const CPH = { code: 'CPH', name: 'Copenhagen', lat: 55.6179, lon: 12.656, country: 'DK' };
const AYT = { code: 'AYT', name: 'Antalya', lat: 36.8987, lon: 30.8005, country: 'TR' };
const LHR = { code: 'LHR', name: 'London', lat: 51.47, lon: -0.4543, country: 'GB' };
const JFK = { code: 'JFK', name: 'New York', lat: 40.6413, lon: -73.7781, country: 'US' };

function plane(icao24, { lat, lon, track, callsign, route }) {
  _addFlightTrackingCandidateForTest({
    icao24,
    billboard: { position: Cesium.Cartesian3.fromDegrees(lon, lat, 10_973), show: true },
    meta: { callsign, rawLat: lat, rawLon: lon, altitude: 10_973, velocity: 222, true_track: track, verticalRate: 0, onGround: false, route },
  });
}

test('kartička pod kurzorom: obchádzka SQ324 má trasu aj ETA; cudzí úsek SunExpress a zlá trasa sa neukážu', () => {
  plane('76ceed', { lat: 48.74, lon: 17.05, track: 302, callsign: 'SIA324', route: { origin: SIN, destination: AMS } });
  const detour = flightsLayer.getContactSummary('76ceed');
  assert.equal(detour.route, 'SIN → AMS', 'predtým null — karta bez trasy aj ETA');
  assert.ok(Number.isFinite(detour.progress?.etaMinutes), 'ETA je');
  assert.ok(detour.progress.remainingKm > 900 && detour.progress.remainingKm < 1100, `zostatok do Amsterdamu: ${detour.progress.remainingKm}`);

  plane('4bcdef', { lat: 50.42, lon: 11.27, track: 290, callsign: 'SXS3RB', route: { origin: CPH, destination: AYT } });
  const otherLeg = flightsLayer.getContactSummary('4bcdef');
  assert.deepEqual([otherLeg.route, otherLeg.routeInfo, otherLeg.progress], [null, null, null], 'Antalya je za chrbtom — iný úsek, nie fakt');

  plane('abc123', { lat: 48.5, lon: 18.0, track: 280, callsign: 'BAW1', route: { origin: LHR, destination: JFK } });
  const wrong = flightsLayer.getContactSummary('abc123');
  assert.deepEqual([wrong.route, wrong.routeInfo, wrong.progress], [null, null, null]);
});
