// src/data/seaRoute.test.mjs — plavebná trasa po mori (2026-10-11, bod 5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSeaRoute, parseRoutePoints, seaRouteProxy } from './seaRouteProxy.js';
import { _resetSeaRouteForTest, _setSeaRouteForTest, seaRoutePositionsDeg } from './seaRoute.js';
import { greatCircleKm } from './vesselDestination.js';

test('body z dopytu: 2–12 platných bodov', () => {
  assert.deepEqual(parseRoutePoints('-76.43,36.98;8.15,53.52'), [[-76.43, 36.98], [8.15, 53.52]]);
  assert.equal(parseRoutePoints('1,2'), null);
  assert.equal(parseRoutePoints('1,2;x,y'), null);
  assert.equal(parseRoutePoints(Array(13).fill('1,2').join(';')), null);
});

test('Mumbaj → Rotterdam ide cez Suez, nie cez pevninu (dlhšia ako priamka, krajné body zachované)', () => {
  const route = computeSeaRoute([[72.8, 18.95], [4.4, 51.9]]);
  const straight = greatCircleKm(18.95, 72.8, 51.9, 4.4);
  assert.ok(route.lengthKm > straight * 1.4 && route.lengthKm < 13000, `${route.lengthKm} km`);
  assert.deepEqual(route.coordinates[0], [72.8, 18.95]);
  assert.deepEqual(route.coordinates.at(-1), [4.4, 51.9]);
  // Suezský prieplav: trasa prechádza okolo 32,3° V / 30–31° S.
  assert.ok(route.coordinates.some(([lon, lat]) => lon > 32 && lon < 33 && lat > 29.5 && lat < 31.5), 'cez Suez');
});

test('úsek bez trasy ostane priamkou, celé nezlyhá; endpoint vracia JSON a kešuje', async () => {
  const route = computeSeaRoute([[0, 0], [1, 1], [2, 2]], (o, d) => (o.geometry.coordinates[0] === 0 ? null : { geometry: { coordinates: [[1, 1], [1.5, 1.5], [2, 2]] }, properties: { length: 157 } }));
  assert.deepEqual(route.legs, [null, 157]);
  assert.equal(route.lengthKm, null, 'bez dĺžky všetkých úsekov celková dĺžka nie je');
  assert.deepEqual(route.coordinates, [[0, 0], [1, 1], [1.5, 1.5], [2, 2]]);
  const plugin = seaRouteProxy();
  const res = { writeHead(s) { this.s = s; }, end(b) { this.b = b; } };
  plugin._handler({ method: 'GET', url: '/?points=-76.43,36.98;8.15,53.52' }, res);
  assert.equal(res.s, 200);
  const body = JSON.parse(res.b);
  assert.ok(body.lengthKm > 6000 && body.lengthKm < 7500, `Newport News → Wilhelmshaven ${body.lengthKm} km`);
  const bad = { writeHead(s) { this.s = s; }, end() {} };
  plugin._handler({ method: 'GET', url: '/?points=1,2' }, bad);
  assert.equal(bad.s, 400);
});

test('karta: priebeh a zostávajúce km po mori, keď je trasa známa', async () => {
  const { vesselVoyageModel } = await import('./vesselCardDetails.js');
  const { buildPortIndex } = await import('./vesselDestination.js');
  _resetSeaRouteForTest();
  const vessel = { lat: 52.0, lon: 2.68, destination: 'DEWVN' };
  const origin = { lat: 36.98, lon: -76.43 };
  const dest = { lat: 53.52, lon: 8.15 };
  const index = buildPortIndex([{ id: 'w', geometry: { coordinates: [8.15, 53.52] }, properties: { name: 'Wilhelmshaven', locode: 'DEWVN', country: 'Germany' } }]);
  const info = { voyage: { lastPort: 'Newport News', lastPortCountry: 'United States', departedAt: 1, lat: origin.lat, lon: origin.lon, locode: 'USNNS' } };
  _setSeaRouteForTest([origin, { lat: vessel.lat, lon: vessel.lon }], { coordinates: [[0, 0], [1, 1]], lengthKm: 6300 });
  _setSeaRouteForTest([{ lat: vessel.lat, lon: vessel.lon }, dest], { coordinates: [[0, 0], [1, 1]], lengthKm: 420 });
  const model = vesselVoyageModel(vessel, info, index);
  assert.equal(model.progress.bySea, true);
  assert.equal(model.progress.remainingKm, 420);
  assert.ok(Math.abs(model.progress.fractionDone - 6300 / 6720) < 1e-9);
  assert.deepEqual(seaRoutePositionsDeg({ coordinates: [[1, 2], [3, 4]] }), [[1, 2, 0], [3, 4, 0]]);
  _resetSeaRouteForTest();
});
