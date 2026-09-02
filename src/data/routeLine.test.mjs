// src/data/routeLine.test.mjs
// Trasová čiara sledovaného letu: čistá geometria (preletené / zostávajúce)
// a lifecycle handle nad mock viewerom (vzor trailRenderer.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { isOwnedByOtherLayer } from './pickRegistry.js';
import {
  ROUTE_LINE_DEFAULT_ALTITUDE_M,
  createTrackedRouteLine,
  routeLinePositionsDeg,
} from './routeLine.js';

const ROUTE_INFO = {
  origin: { code: 'BTS', lat: 48.17, lon: 17.21 },
  destination: { code: 'AMS', lat: 52.31, lon: 4.76 },
  lat: 50.1,
  lon: 11.4,
  altitudeM: 10_700,
};

test('geometria: dva segmenty v konštantnej letovej hladine (plán, nie profil)', () => {
  // FR24 idiom: čiara plánu letí celá vo výške lietadla — žiadne zabárania
  // koncov do terénu (letiská majú rôzne elevácie a polyline sa clampovať
  // po častiach nedá), žiadne terénne dopyty.
  const geometry = routeLinePositionsDeg(ROUTE_INFO);
  assert.deepEqual(geometry, {
    flown: [[17.21, 48.17, 10_700], [11.4, 50.1, 10_700]],
    remaining: [[11.4, 50.1, 10_700], [4.76, 52.31, 10_700]],
  });
});

test('geometria: chýbajúce súradnice čiaru poctivo zrušia, výška má default', () => {
  assert.equal(routeLinePositionsDeg({ ...ROUTE_INFO, origin: { code: 'BTS' } }), null);
  assert.equal(routeLinePositionsDeg({ ...ROUTE_INFO, destination: null }), null);
  assert.equal(routeLinePositionsDeg({ ...ROUTE_INFO, lat: null }), null);
  assert.equal(routeLinePositionsDeg({ ...ROUTE_INFO, lon: Number.NaN }), null);
  assert.equal(routeLinePositionsDeg(null), null);
  // Bez známej výšky sa použije rozumný letový default — čiara sa nekreslí
  // na elipsoide (h=0 by ju pochovalo pod terén).
  const fallback = routeLinePositionsDeg({ ...ROUTE_INFO, altitudeM: null });
  assert.equal(fallback.flown[0][2], ROUTE_LINE_DEFAULT_ALTITUDE_M);
  assert.ok(ROUTE_LINE_DEFAULT_ALTITUDE_M >= 8_000);
});

test('handle: dve polyline entity v gev-route: pick priestore, clear/destroy upratuje', () => {
  const added = [];
  const removed = [];
  const viewer = {
    isDestroyed: () => false,
    entities: {
      add(definition) { added.push(definition); return definition; },
      remove(entity) { removed.push(entity); },
    },
  };
  const line = createTrackedRouteLine(viewer);
  line.setSegments(routeLinePositionsDeg(ROUTE_INFO));
  assert.equal(added.length, 2, 'preletený + zostávajúci segment');
  for (const entity of added) {
    assert.match(String(entity.id), /^gev-route:/);
    // Klik na čiaru plánu nesmie nikde čítať ako "prázdny priestor" a
    // deselektovať sledované lietadlo — namespace je claimnutý v
    // pickRegistry, rovnaká ochrana ako trails.
    assert.equal(isOwnedByOtherLayer('flights', entity.id), true);
    assert.equal(
      entity.polyline.positions.getValue().length >= 2,
      true,
      'CallbackProperty vracia aktuálne pozície',
    );
  }

  // clear() vyprázdni geometriu, ale entity nechá (ďalší poll ju znova naplní).
  line.clear();
  assert.equal(added[0].polyline.positions.getValue().length, 0);
  assert.equal(removed.length, 0);

  line.destroy();
  assert.equal(removed.length, 2);
  // destroy je idempotentné a setSegments po ňom nič nevytvára.
  line.destroy();
  line.setSegments(routeLinePositionsDeg(ROUTE_INFO));
  assert.equal(added.length, 2);
});

test('tripwire: flights.js čiaru synchronizuje pri obnove sledovaného labelu a uprace pri untracku', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('./flights.js', import.meta.url), 'utf8');
  assert.match(source, /_syncTrackedRouteLine\(icao24\)/, 'sync beží z _updateTrackedLabelModel');
  assert.match(source, /_trackedRouteLine\?\.clear\(\)/, 'untrack čiaru vyprázdni');
  assert.match(source, /_routeIsPlausible/, 'čiara zdieľa gate s kartou — implauzibilná trasa sa nekreslí');
});
