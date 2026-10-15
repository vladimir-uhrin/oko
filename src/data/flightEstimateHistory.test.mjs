// Odhad po trase predchádzajúceho letu s rovnakým volacím znakom (2026-10-14).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORY_BLEND_END_S, HISTORY_BLEND_START_S, HISTORY_PATH_MAX_OFFSET_KM, buildEstimateModel, calibratedUncertaintyKm,
  createEstimateTracker, estimatePosition, historyPathFrom,
} from './flightEstimate.js';
import { openFlightHistory } from './flightHistoryStore.js';
import { greatCircleKm } from './routePlausible.js';
import { destinationPoint, nearestOnTrack } from './flightPath.js';

const DOH = { code: 'DOH', lat: 25.27, lon: 51.61 };
const LHR = { code: 'LHR', lat: 51.47, lon: -0.46 };
const ROUTE = { origin: DOH, destination: LHR };
// Včerajší let „oblúkom" cez Turecko a Balkán (nie po kružnici).
const PREV = [
  { lat: 26.5, lon: 50.5 }, { lat: 30, lon: 47 }, { lat: 34, lon: 43 }, { lat: 38, lon: 38 }, { lat: 41, lon: 30 },
  { lat: 44, lon: 22 }, { lat: 47, lon: 14 }, { lat: 49.5, lon: 6 }, { lat: 51.2, lon: 0.5 },
];
const T0 = 1_791_900_000_000;
const FIX = { hex: '06a1b2', cs: 'QTR1', tMs: T0, lat: 34.2, lon: 42.8, altM: 11_000, gsMps: 240, trkDeg: 305, vrMps: 0, onGround: false };

test('trasa z predchádzajúceho letu: od miesta pri lietadle ďalej, na konci cieľ; inde letiace = nič', () => {
  const path = historyPathFrom(FIX, LHR, PREV);
  assert.deepEqual(path[0], { lat: FIX.lat, lon: FIX.lon });
  assert.deepEqual(path[1], { lat: 38, lon: 38 }, 'pokračuje ďalším bodom včerajšej trasy');
  assert.deepEqual(path.at(-1), { lat: LHR.lat, lon: LHR.lon });
  const elsewhere = { ...FIX, lat: 30, lon: 60 };
  assert.ok(greatCircleKm(30, 60, 34, 43) > HISTORY_PATH_MAX_OFFSET_KM);
  assert.equal(historyPathFrom(elsewhere, LHR, PREV), null);
  assert.equal(historyPathFrom(FIX, LHR, null), null);
});

test('model s trasou predchádzajúceho letu: posiela trasu, druh history; prechod 15.–45. minúta', () => {
  const model = buildEstimateModel(FIX, ROUTE, { historyPoints: PREV, nowMs: T0 });
  assert.equal(model.pathKind, 'history');
  assert.ok(model.path.length >= 5);
  // Do 15. minúty ešte posledný kurz.
  const early = estimatePosition(FIX, ROUTE, T0 + (HISTORY_BLEND_START_S - 60) * 1000, model);
  const straight = destinationPoint(FIX.lat, FIX.lon, FIX.trkDeg, (FIX.gsMps * (HISTORY_BLEND_START_S - 60)) / 1000);
  assert.ok(greatCircleKm(early.lat, early.lon, straight.lat, straight.lon) < 0.5);
  // Po 45. minúte presne na včerajšej trase (pri Turecku), nie na kružnici.
  const late = estimatePosition(FIX, ROUTE, T0 + (HISTORY_BLEND_END_S + 30 * 60) * 1000, model);
  assert.equal(late.method, 'history');
  assert.equal(late.historyRoute, true);
  const gc = estimatePosition(FIX, ROUTE, T0 + (HISTORY_BLEND_END_S + 30 * 60) * 1000, null);
  assert.equal(gc.historyRoute, false);
  assert.ok(nearestOnTrack({ lat: late.lat, lon: late.lon }, PREV).distKm < 15, 'leží na včerajšej trase (oblúk vs. priamka v projekcii)');
});

test('kruh pre trasu predchádzajúceho letu: vlastné merania, inak kruh odhadu s cieľom', () => {
  const cal = [{ maxMin: 120, n: 900, p80Km: 650, byMethod: { route: { n: 300, p80Km: 360 }, history: { n: 5, p80Km: 200 } } }];
  assert.equal(calibratedUncertaintyKm(70 * 60, 900, cal, 'history'), 360, 'málo vlastných meraní → ako s cieľom');
  cal[0].byMethod.history.n = 40;
  assert.equal(calibratedUncertaintyKm(70 * 60, 900, cal, 'history'), 200);
});

test('sledovač: História sa pýta raz na odhad s cieľom, model potom letí po jej trase', async () => {
  const asked = [];
  const tracker = createEstimateTracker({
    historyGapMs: 0,
    localRoute: () => ROUTE,
    historyRoute: async (cs, fix, dest) => { asked.push([cs, dest.code]); return PREV; },
  });
  tracker.seed([FIX], T0 + 60_000);
  tracker.list(T0 + 60_000);
  await new Promise((r) => setTimeout(r, 10));
  tracker.list(T0 + 60_000);
  assert.deepEqual(asked, [['QTR1', 'LHR']], 'jeden dopyt');
  const [row] = tracker.list(T0 + 90 * 60_000);
  assert.equal(row.model.pathKind, 'history');
  assert.equal(tracker.status().historyRoutes, 1);
});

test('História: predchádzajúci let s rovnakým znakom a cieľom, preriedený; iný cieľ alebo znak nie', () => {
  const nowMs = T0 + 3 * 86400_000;
  const store = openFlightHistory(':memory:', { now: () => nowMs });
  try {
    const t0 = Math.floor(T0 / 1000) - 86400;
    const pts = [];
    // Včerajší QTR1: 600 bodov po 12 s (≈ 8 km od seba) po PREV, na konci pri LHR — riedi sa na 20 km.
    for (let i = 0; i < 600; i += 1) {
      const f = i / 599;
      const k = Math.min(PREV.length - 2, Math.floor(f * (PREV.length - 1)));
      const u = f * (PREV.length - 1) - k;
      const a = PREV[k];
      const b = PREV[k + 1];
      pts.push({ t: t0 + i * 12, lat: a.lat + (b.lat - a.lat) * u, lon: a.lon + (b.lon - a.lon) * u, alt: 11000, gs: 240, callsign: 'QTR1' });
    }
    store.importFlight({ icao24: '06a1b2', points: pts }, 'test');
    const before = Math.floor(T0 / 1000) - 3600;
    const route = store.previousRoute('QTR1', { beforeS: before, sinceS: before - 8 * 86400, endLat: LHR.lat, endLon: LHR.lon, minFixes: 20 });
    assert.ok(Array.isArray(route) && route.length >= 5 && route.length < 400, `preriedené (${route?.length})`);
    for (let i = 1; i < route.length; i += 1) assert.ok(greatCircleKm(route[i - 1].lat, route[i - 1].lon, route[i].lat, route[i].lon) >= 20);
    assert.equal(store.previousRoute('QTR1', { beforeS: before, sinceS: before - 8 * 86400, endLat: 48.35, endLon: 11.79, minFixes: 20 }), null, 'iný cieľ (Mníchov)');
    assert.equal(store.previousRoute('QTR2', { beforeS: before, sinceS: before - 8 * 86400, endLat: LHR.lat, endLon: LHR.lon, minFixes: 20 }), null, 'iný znak');
  } finally {
    store.close();
  }
});

test('úseky jedného letu sa spoja (medzera < 4 h, to isté lietadlo), iné lietadlo či ďalší deň nie', async () => {
  const { groupLegsIntoFlights } = await import('./flightHistoryStore.js');
  const g = groupLegsIntoFlights([
    { icao24: 'aaa111', first_t: 1000, last_t: 2000, fixes: 25 },
    { icao24: 'bbb222', first_t: 1500, last_t: 2500, fixes: 30 },
    { icao24: 'aaa111', first_t: 3000, last_t: 6000, fixes: 25 },
    { icao24: 'aaa111', first_t: 6000 + 86400, last_t: 9000 + 86400, fixes: 50 },
  ]);
  assert.equal(g.length, 3);
  assert.deepEqual(g[0], { icao24: 'aaa111', first_t: 6000 + 86400, last_t: 9000 + 86400, fixes: 50, legs: 1 }, 'najnovší let prvý');
  const joined = g.find((x) => x.icao24 === 'aaa111' && x.legs === 2);
  assert.equal(joined.fixes, 50);
  assert.equal(joined.first_t, 1000);
  assert.equal(joined.last_t, 6000);
});

test('História: let rozsekaný dierou v pokrytí sa poskladá; koniec vo vzduchu smerom k cieľu sa berie, inam nie', () => {
  const nowMs = T0 + 3 * 86400_000;
  const store = openFlightHistory(':memory:', { now: () => nowMs });
  try {
    const t0 = Math.floor(T0 / 1000) - 86400;
    const at = (f) => {
      const k = Math.min(PREV.length - 2, Math.floor(f * (PREV.length - 1)));
      const u = f * (PREV.length - 1) - k;
      return { lat: PREV[k].lat + (PREV[k + 1].lat - PREV[k].lat) * u, lon: PREV[k].lon + (PREV[k + 1].lon - PREV[k].lon) * u };
    };
    // Dva úseky po 25 bodov (každý sám < 40), medzi nimi 40 min bez pokrytia.
    const a = Array.from({ length: 25 }, (_, i) => ({ t: t0 + i * 120, ...at(i / 70), alt: 11000, gs: 240, callsign: 'QTR7' }));
    const b = Array.from({ length: 25 }, (_, i) => ({ t: t0 + 25 * 120 + 2400 + i * 120, ...at((25 + 20 + i) / 70), alt: 11000, gs: 240, callsign: 'QTR7' }));
    store.importFlight({ icao24: '06a1c3', points: a }, 'test');
    store.importFlight({ icao24: '06a1c3', points: b }, 'test');
    assert.ok(store.search('QTR7').length >= 2, 'v Histórii sú dva úseky');
    const before = Math.floor(T0 / 1000) - 3600;
    const opts = { beforeS: before, sinceS: before - 8 * 86400, endLat: LHR.lat, endLon: LHR.lon };
    const route = store.previousRoute('QTR7', opts);
    assert.ok(Array.isArray(route) && route.length >= 5, 'poskladaná trasa (spolu 50 bodov)');
    // Koniec úseku b je pri Mníchove/Alpách vo vzduchu a mieri na Londýn → berie sa (dotiahne sa k cieľu).
    // Pre cieľ Káhira (iný smer) nie.
    assert.equal(store.previousRoute('QTR7', { ...opts, endLat: 30.12, endLon: 31.41 }), null, 'mieril inam');
  } finally {
    store.close();
  }
});
