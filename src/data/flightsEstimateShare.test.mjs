// src/data/flightsEstimateShare.test.mjs
// Poctivý stav lietadla mimo karty (2026-10-15): zdieľanie zastaraného letu, klesanie odhadu po trase
// predchádzajúceho letu a bod skutočnej polohy HFDL po vypnutí vrstvy. Vlastný súbor = vlastný proces,
// takže odhady a prekrytie neovplyvnia ostatné testy vrstvy lietadiel (flights.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import flightsLayer, {
  _seedFlightEstimateForTest,
  _setTrackedFlightRefreshStateForTest,
  _syncAnchorFixOverlayForTest,
} from './flights.js';
import { buildEstimateModel } from './flightEstimate.js';
import { getOverlayEntryText, getWorldOverlayDiagnostics } from '../overlays/worldOverlay.js';
import { buildFlightShareCopy, drawFlightShareCard } from '../flightShare.js';

function trackedHarness(icao24, meta = {}) {
  const entity = { gevLabelModel: { title: 'OLD', details: [] } };
  const viewer = { camera: { positionCartographic: null }, scene: {} };
  _setTrackedFlightRefreshStateForTest({
    icao24,
    entity,
    billboard: {
      position: Cesium.Cartesian3.fromDegrees(-97.7, 30.2, 9_000),
      color: Cesium.Color.WHITE,
      show: false,
    },
    billboardCollection: { show: false, remove() {} },
    viewer,
    meta: {
      callsign: 'OLD1',
      altitude: 9_000,
      renderAltitudeM: 9_050,
      velocity: 180,
      true_track: 80,
      klass: 'airliner',
      onGround: false,
      wasAirborne: true,
      turnRateDps: 0,
      rawLat: 30.2,
      rawLon: -97.7,
      ...meta,
    },
  });
  return { entity, viewer };
}

/** fetch: OpenSky dá `statesForPoll(n)`, ostatné zdroje (odhady servera, obohatenie) nič. */
function stubFetch(statesForPoll) {
  let poll = 0;
  return async (url) => {
    if (!String(url).startsWith('/api/opensky')) {
      return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
    }
    const nowSec = Math.floor(Date.now() / 1000);
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ time: nowSec, states: statesForPoll(poll++, nowSec) }),
    };
  };
}

function fakeCtx() {
  const texts = [];
  const strokes = [];
  const ctx = {
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '', textBaseline: '', shadowColor: '', shadowBlur: 0,
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {},
    fill() {}, stroke() { strokes.push(ctx.strokeStyle); }, fillRect() {},
    measureText: (text) => ({ width: String(text).length * 10 }),
    fillText(text, x, y) { texts.push({ text, color: ctx.fillStyle }); },
  };
  return { ctx, texts, strokes };
}

test('zdieľanie letu: vynechaný poll (karta „· STALE") nie je NAŽIVO — štítok ZASTARANÉ a text príspevku', async () => {
  const icao24 = 'a1b2c3';
  trackedHarness(icao24);
  const realFetch = globalThis.fetch;
  globalThis.fetch = stubFetch((poll, nowSec) => (poll === 0
    ? [[icao24, 'DAL123 ', 'United States', nowSec, nowSec, -97.6, 30.3, 10_668, false, 250, 95, 5, null, 10_700, null, null, null, 5]]
    : []));
  try {
    await flightsLayer.update({ camera: { positionCartographic: null }, scene: {} });
    const live = flightsLayer.getTrackedShareCard();
    assert.equal(live.callsign, 'DAL123');
    assert.equal(live.stale, false);
    assert.match(buildFlightShareCopy(live, { lang: 'sk' }).description, /^NAŽIVO · /);

    await flightsLayer.update({ camera: { positionCartographic: null }, scene: {} });
    const stale = flightsLayer.getTrackedShareCard();
    assert.equal(stale.stale, true, 'vynechaný poll = zastaraná poloha');
    assert.equal(stale.estimated, false);
    const sk = buildFlightShareCopy(stale, { lang: 'sk' });
    // 2026-10-16: poloha sa počas vynechaných pollov dopočítava (dead reckoning) — nie „posledná známa".
    assert.match(sk.description, /^ZASTARANÉ \(poloha dopočítaná z posledného signálu\) · /);
    assert.doesNotMatch(sk.description, /NAŽIVO/);
    assert.match(buildFlightShareCopy(stale, { lang: 'en' }).description, /^STALE \(position extrapolated from the last signal\) · /);

    const { ctx, texts, strokes } = fakeCtx();
    drawFlightShareCard(ctx, stale, 1200, 594, { lang: 'sk' });
    const chip = texts.find((x) => x.text === 'ZASTARANÉ');
    assert.ok(chip, 'štítok ZASTARANÉ na obrázku/videu');
    assert.equal(chip.color, '#fbbf24', 'jantárový tón odhadu, nie zelené NAŽIVO');
    assert.ok(!strokes.includes('#4ade80'), 'žiadny zelený rámik NAŽIVO');
    assert.ok(!texts.some((x) => x.text === 'NAŽIVO'));
  } finally {
    globalThis.fetch = realFetch;
  }
});

// Viedeň → Londýn, signál stratený nad Belgickom; predchádzajúci let tou istou trasou (pathKind 'history').
const ROUTE = { origin: { code: 'VIE', lat: 48.11, lon: 16.57 }, destination: { code: 'LHR', lat: 51.47, lon: -0.45 } };
function historyEstimate(hex, minutesWithoutSignal) {
  const fix = {
    hex, cs: 'AUA451', tMs: Date.now() - minutesWithoutSignal * 60_000, lat: 51.2, lon: 5.2, altM: 11_000, gsMps: 230,
    trkDeg: 272, vrMps: 0, onGround: false, category: 3, country: 'Austria',
  };
  const historyPoints = [];
  for (let i = 0; i <= 20; i += 1) {
    const f = i / 20;
    historyPoints.push({
      lat: fix.lat + (ROUTE.destination.lat - fix.lat) * f + (i > 0 && i < 20 ? 0.05 : 0),
      lon: fix.lon + (ROUTE.destination.lon - fix.lon) * f,
    });
  }
  const model = buildEstimateModel(fix, ROUTE, { nowMs: fix.tMs, historyPoints });
  return { fix, route: ROUTE, model, source: 'server', est: null };
}

test('odhad po trase predchádzajúceho letu klesá k cieľu — vertikálna rýchlosť je klesanie, nie 0', async () => {
  const hex = 'abc123';
  trackedHarness(hex, { callsign: 'AUA451', rawLat: 51.2, rawLon: 5.2, altitude: 11_000 });
  const realFetch = globalThis.fetch;
  globalThis.fetch = stubFetch(() => []); // živý snímok lietadlo nemá — ide riadok odhadu
  try {
    // 24 min bez signálu: ~60 km pred LHR, výška odhadu klesá (ESTIMATE_DESCENT_KM).
    const descending = historyEstimate(hex, 24);
    assert.equal(descending.model.pathKind, 'history', 'odhad ide po trase predchádzajúceho letu');
    _seedFlightEstimateForTest(hex, descending);
    await flightsLayer.update({ camera: { positionCartographic: null }, scene: {} });
    assert.equal(descending.est?.method, 'history');
    assert.ok(descending.est.altM < descending.fix.altM, 'výška odhadu klesá');
    // Kartička pod kurzorom a glyf trendu na karte čítajú tú istú vertikálnu rýchlosť.
    const summary = flightsLayer.getContactSummary(hex);
    assert.ok(summary.verticalRateMps < 0, `klesanie, nie vodorovný let (vr ${summary.verticalRateMps})`);

    // Kontrola: ďaleko pred cieľom drží výšku → 0, nie vymyslené klesanie.
    const cruising = historyEstimate(hex, 10);
    _seedFlightEstimateForTest(hex, cruising);
    await flightsLayer.update({ camera: { positionCartographic: null }, scene: {} });
    assert.equal(cruising.est?.method, 'history');
    assert.equal(cruising.est.altM, cruising.fix.altM);
    assert.equal(flightsLayer.getContactSummary(hex).verticalRateMps, 0);
  } finally {
    globalThis.fetch = realFetch;
    _seedFlightEstimateForTest(hex, null);
  }
});

test('vypnutie vrstvy lietadiel zhasne bod skutočnej polohy HFDL; po návrate sa nakreslí znova', () => {
  const hadDocument = 'document' in globalThis;
  const priorDocument = globalThis.document;
  globalThis.document ??= { addEventListener() {}, removeEventListener() {}, body: { classList: { contains: () => false } } };
  const hex = 'def456';
  const source = 'flights-anchor-fix';
  const entryId = `anchor:${hex}`;
  const viewer = {
    scene: { preRender: new Cesium.Event(), preUpdate: new Cesium.Event(), postRender: new Cesium.Event(), requestRender() {}, canvas: {}, primitives: { remove() {} } },
    camera: { moveEnd: new Cesium.Event(), positionWC: new Cesium.Cartesian3(), cancelFlight() {} },
    entities: { add: (e) => e, remove() {} },
  };
  const seed = () => {
    _setTrackedFlightRefreshStateForTest({
      icao24: hex, entity: { gevLabelModel: { title: 'TEST1', details: [] } }, billboard: { show: true },
      billboardCollection: { show: true, remove() {} }, viewer, tracked: true,
      meta: { callsign: 'TEST1', klass: 'airliner', rawLat: 50, rawLon: -30, altitude: 11_000 },
    });
  };
  // Sledovaný odhad ukotvený na polohe z HFDL (tvar ako po _estimateRows).
  const tMs = Date.now() - 20 * 60_000;
  _seedFlightEstimateForTest(hex, {
    fix: { hex, cs: 'TEST1', via: 'hfdl', lat: 50, lon: -30, altM: 11_000, tMs },
    route: null,
    source: 'server',
    est: { lat: 50.5, lon: -25, altM: 11_000, method: 'track', uncertaintyKm: 80 },
  });
  try {
    seed();
    _syncAnchorFixOverlayForTest();
    assert.match(getOverlayEntryText(source, entryId)?.title || '', /HFDL/, 'bod HFDL s časom je na glóbuse');

    flightsLayer.disable(viewer);
    assert.equal(getOverlayEntryText(source, entryId), null, 'po vypnutí vrstvy bod nezostane bez lietadla');
    assert.equal(getWorldOverlayDiagnostics().entriesBySource[source] ?? 0, 0);

    // Tá istá poloha HFDL po opätovnom sledovaní: pamäť popisu je vynulovaná, takže sa nakreslí znova.
    seed();
    _syncAnchorFixOverlayForTest();
    assert.ok(getOverlayEntryText(source, entryId), 'po návrate sa bod nakreslí znova');
    flightsLayer.destroy(viewer);
    assert.equal(getOverlayEntryText(source, entryId), null, 'zrušenie vrstvy ho zhasne tiež');
  } finally {
    _seedFlightEstimateForTest(hex, null);
    if (hadDocument) globalThis.document = priorDocument;
    else delete globalThis.document;
  }
});
