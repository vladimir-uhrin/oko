// src/data/enrichGate.test.mjs — doťahovanie typu a trasy lietadla sa po chybe zopakuje (2026-09-30).
// Predtým jeden zlyhaný dopyt (HTTP 500, výpadok siete) nechal stroj bez typu, trasy a ETA až do
// obnovenia stránky. Testy správania: brána s vloženými hodinami + skutočná vrstva lietadiel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { ENRICH_MAX_ATTEMPTS, createEnrichGate } from './enrichGate.js';
import flightsLayer, { _enrichGateForTest, _setTrackedFlightRefreshStateForTest } from './flights.js';

test('odpoveď (aj „nenájdené") je konečná — druhý dopyt sa nepustí', () => {
  const gate = createEnrichGate({ now: () => 0 });
  assert.equal(gate.begin('r:AUA555'), true);
  assert.equal(gate.begin('r:AUA555'), false, 'počas dopytu nie druhý');
  gate.succeed('r:AUA555');
  assert.equal(gate.begin('r:AUA555'), false, 'po odpovedi už nie');
  assert.equal(gate.status('r:AUA555').status, 'done');
});

test('zlyhaný dopyt sa zopakuje po 1, potom 2 minútach, najviac trikrát', () => {
  let t = 0;
  const gate = createEnrichGate({ retryMs: 60_000, now: () => t });
  assert.equal(gate.begin('t:44029f'), true);
  gate.fail('t:44029f');
  assert.equal(gate.canBegin('t:44029f'), false, 'hneď po chybe nie');
  t = 59_999;
  assert.equal(gate.begin('t:44029f'), false);
  t = 60_000;
  assert.equal(gate.begin('t:44029f'), true, 'po minúte druhý pokus');
  gate.fail('t:44029f');
  t = 60_000 + 119_999;
  assert.equal(gate.begin('t:44029f'), false, 'druhé čakanie je dlhšie');
  t = 60_000 + 120_000;
  assert.equal(gate.begin('t:44029f'), true, 'tretí pokus');
  gate.fail('t:44029f');
  // Ďalšie pokusy s čakaním „minúta × pokus" až po ENRICH_MAX_ATTEMPTS (6 = ~15 min, dlhšie než 5 min blokovanie adsbdb).
  for (let attempt = 4; attempt <= ENRICH_MAX_ATTEMPTS; attempt++) {
    t += 60_000 * (attempt - 1);
    assert.equal(gate.begin('t:44029f'), true, `${attempt}. pokus`);
    gate.fail('t:44029f');
  }
  assert.ok(t >= 10 * 60_000, 'pokusy pokryjú viac ako 5 min blokovania adsbdb');
  t += 60 * 60_000;
  assert.equal(gate.begin('t:44029f'), false, `po ${ENRICH_MAX_ATTEMPTS} pokusoch koniec`);
  assert.equal(gate.status('t:44029f').attempts, ENRICH_MAX_ATTEMPTS);
});

test('canBegin nič nemení a clear všetko zabudne', () => {
  const gate = createEnrichGate({ now: () => 0 });
  assert.equal(gate.canBegin('x'), true);
  assert.equal(gate.size, 0, 'kontrola nezakladá záznam');
  gate.begin('x');
  gate.clear();
  assert.equal(gate.canBegin('x'), true);
});

function seed(icao24, callsign) {
  _setTrackedFlightRefreshStateForTest({
    icao24,
    entity: null,
    billboard: { position: Cesium.Cartesian3.fromDegrees(13.0, 47.8, 11_000), color: Cesium.Color.WHITE, show: true },
    billboardCollection: { show: true, remove() {} },
    viewer: { camera: { positionCartographic: null }, scene: {} },
    tracked: false,
    meta: { callsign, altitude: 11_000, velocity: 230, true_track: 262, klass: 'airliner', onGround: false, rawLat: 47.8, rawLon: 13.0 },
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 700));

test('vrstva lietadiel: zlyhaný dopyt trasy čaká na ďalší pokus, úspešný trasu doplní', async () => {
  const originalFetch = globalThis.fetch;
  try {
    _enrichGateForTest().clear();
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    seed('44abcd', 'AUA901');
    flightsLayer.prefetchContactDetails('44abcd');
    await settle();
    const failed = _enrichGateForTest().status('r:AUA901');
    assert.equal(failed?.status, 'failed', 'HTTP 500 nie je konečná odpoveď');
    assert.ok(failed.retryAt > Date.now(), 'ďalší pokus je naplánovaný');

    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).includes('/route/')
        ? { found: true, airline: 'Austrian Airlines', callsignIata: 'OS902',
          origin: { code: 'VIE', lat: 48.110833, lon: 16.570833 }, destination: { code: 'ZRH', lat: 47.458056, lon: 8.548056 } }
        : { found: false }),
    });
    seed('44abce', 'AUA902');
    flightsLayer.prefetchContactDetails('44abce');
    await settle();
    assert.equal(_enrichGateForTest().status('r:AUA902')?.status, 'done');
    const card = flightsLayer.getContactSummary('44abce');
    assert.equal(card.route, 'VIE → ZRH');
    assert.equal(card.flightIata, 'OS902');
  } finally {
    globalThis.fetch = originalFetch;
    _enrichGateForTest().clear();
  }
});
