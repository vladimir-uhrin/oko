// src/data/flightRouteCache.test.mjs — kartička lietadla nesmie stratiť trasu, dopravcu, číslo letu
// ani ETA (2026-09-30). Vlastník: „v kartičkách bolo ETA a chýba" a „už sa nesmie stávať, že by
// som niečo trikrát opravoval" → testy SPRÁVANIA, nielen prítomnosti kódu.
// Príčina chyby: záznam stroja sa vymení (poll, návrat do feedu, zrušené sledovanie) a trasu vrstva
// pre volací znak pýta len raz — trasa a s ňou ETA z kartičky zmizli; IATA číslo sa zahodilo pri
// každom polle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  ROUTE_ENRICHMENT_FIELDS,
  carryRouteEnrichment,
  createRouteMemory,
} from './flightRouteMemory.js';
import flightsLayer, { _routeMemoryForTest, _setTrackedFlightRefreshStateForTest } from './flights.js';

const VIE = { code: 'VIE', icao: 'LOWW', name: 'Vienna', country: 'AT', lat: 48.110833, lon: 16.570833 };
const ZRH = { code: 'ZRH', icao: 'LSZH', name: 'Zurich', country: 'CH', lat: 47.458056, lon: 8.548056 };
const ADSBDB_ROUTE = { found: true, airline: 'Austrian Airlines', callsignIata: 'OS555', origin: VIE, destination: ZRH };

test('poll prenesie dopravcu, trasu aj IATA číslo letu z predošlého záznamu', () => {
  const prev = { airline: 'Austrian Airlines', flightIata: 'OS555', route: { origin: VIE, destination: ZRH } };
  const carried = carryRouteEnrichment(prev);
  for (const field of ROUTE_ENRICHMENT_FIELDS) assert.deepEqual(carried[field], prev[field], field);
  assert.deepEqual(carryRouteEnrichment(undefined), { airline: null, flightIata: null, route: null });
});

test('pamäť trasy vráti chýbajúce polia stroju s rovnakým volacím znakom a nič neprepíše', () => {
  const memory = createRouteMemory({ max: 2 });
  memory.remember('aua555 ', ADSBDB_ROUTE);
  const replaced = { callsign: 'AUA555', route: null, airline: null, flightIata: null };
  assert.equal(memory.apply(replaced), true);
  assert.equal(replaced.route.origin.code, 'VIE');
  assert.equal(replaced.route.destination.code, 'ZRH');
  assert.equal(replaced.airline, 'Austrian Airlines');
  assert.equal(replaced.flightIata, 'OS555');
  const own = { callsign: 'AUA555', airline: 'Iný', flightIata: 'X1', route: { origin: ZRH, destination: VIE } };
  memory.apply(own);
  assert.equal(own.airline, 'Iný', 'vlastné údaje záznamu ostanú');
  assert.equal(own.route.origin.code, 'ZRH');
  assert.equal(memory.apply({ callsign: 'NEZNAMY1' }), false);
  memory.remember('AAA1', ADSBDB_ROUTE);
  memory.remember('BBB2', ADSBDB_ROUTE);
  assert.equal(memory.size, 2, 'pamäť je ohraničená');
  assert.equal(memory.has('AUA555'), false, 'najstarší záznam vypadol prvý');
  memory.clear();
  assert.equal(memory.size, 0);
});

function seedAustrian(meta) {
  _setTrackedFlightRefreshStateForTest({
    icao24: '44029f',
    entity: null,
    // medzi Viedňou a Zürichom, v hladine — trasa je vierohodná
    billboard: { position: Cesium.Cartesian3.fromDegrees(13.0, 47.8, 11_000), color: Cesium.Color.WHITE, show: true },
    billboardCollection: { show: true, remove() {} },
    viewer: { camera: { positionCartographic: null }, scene: {} },
    tracked: false,
    meta: {
      callsign: 'AUA555',
      altitude: 11_000,
      velocity: 230,
      true_track: 262,
      verticalRate: 0,
      klass: 'airliner',
      onGround: false,
      rawLat: 47.8,
      rawLon: 13.0,
      lastContactEpochMs: Date.now(),
      ...meta,
    },
  });
}

test('kartička pod kurzorom má trasu, dopravcu, číslo letu a ETA', () => {
  seedAustrian({ airline: 'Austrian Airlines', flightIata: 'OS555', route: { origin: VIE, destination: ZRH } });
  const card = flightsLayer.getContactSummary('44029f');
  assert.equal(card.route, 'VIE → ZRH');
  assert.equal(card.operator, 'Austrian Airlines');
  assert.equal(card.flightIata, 'OS555');
  assert.ok(Number.isFinite(card.progress?.etaMinutes), 'ETA v kartičke');
  assert.ok(Array.isArray(card.flightLines) && card.flightLines.length > 0);
});

test('stroj, ktorému sa vymenil záznam (bez trasy), dostane trasu a ETA späť pri prejdení myšou', () => {
  _routeMemoryForTest().clear();
  _routeMemoryForTest().remember('AUA555', ADSBDB_ROUTE);
  seedAustrian({ airline: null, flightIata: null, route: null });
  assert.equal(flightsLayer.getContactSummary('44029f').route, null, 'pred prejdením myšou záznam trasu nemá');
  flightsLayer.prefetchContactDetails('44029f');
  const card = flightsLayer.getContactSummary('44029f');
  assert.equal(card.route, 'VIE → ZRH');
  assert.equal(card.operator, 'Austrian Airlines');
  assert.equal(card.flightIata, 'OS555');
  assert.ok(Number.isFinite(card.progress?.etaMinutes), 'ETA sa vrátila');
  _routeMemoryForTest().clear();
});

test('poll vo flights.js používa prenos aj pamäť trasy', () => {
  const flights = readFileSync(new URL('./flights.js', import.meta.url), 'utf8');
  assert.ok(flights.includes('...carryRouteEnrichment(prevMeta),'), 'nový záznam pollu nesie trasu, dopravcu a IATA číslo');
  assert.ok(flights.includes('if (!meta.route) _routeMemory.apply(meta);'), 'návrat do feedu dostane trasu z pamäte');
  assert.ok(flights.includes('_routeMemory.remember(cs, data);'), 'odpoveď adsbdb sa zapamätá');
  assert.ok(flights.includes('_routeMemory.clear();'), 'zničenie vrstvy pamäť vyprázdni');
});
