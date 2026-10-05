// src/data/flightPath.test.mjs — trate NAT, trasa odhadu, vietor, presnosť (2026-10-05).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEstimatePath, natTrackFor, parseNatCoordinate, parseNatTracks, pathLengthKm, pointAlongPath } from './flightPath.js';
import { effectiveGroundSpeed } from './windAloft.js';
import {
  accuracyStats, buildEstimateModel, calibratedUncertaintyKm, createEstimateTracker, estimatePosition, fixFromState, uncertaintyKm,
} from './flightEstimate.js';
import { greatCircleKm } from './routePlausible.js';

// Skutočná správa FAA (nms.aim.faa.gov/datanat/nat.json, 2026-10-05, skrátená na dve časti).
const NAT_JSON = [
  {
    transaction_type: 'NAT_TRACK', start_datetime: '2026-10-05T01:00:00Z', end_datetime: '2026-10-05T08:00:00Z', part_no: 1,
    condition_message: 'NAT-1/3 TRACKS FLS 340/400 INCLUSIVE\r\nOCT 05/0100Z TO OCT 05/0800Z\r\nPART ONE OF THREE PARTS-\r\nT TUDEP 52/50 55/40 56/30 57/20 SUNOT KESIX\r\nEAST LVLS 340 350 360 370 380 390 400\r\nWEST LVLS NIL\r\nEUR RTS EAST NIL\r\nNAR N583B N569B-\r\nV BUDAR 5030/50 5330/40 5430/30 5530/20 ETARI MOGLO\r\nEAST LVLS 340 350 360 370 380 390 400\r\nWEST LVLS NIL\r\nEUR RTS EAST NIL\r\nNAR N485A N469B-\r\nEND OF PART ONE OF THREE PARTS',
  },
  {
    transaction_type: 'NAT_TRACK', start_datetime: '2026-10-05T01:00:00Z', end_datetime: '2026-10-05T08:00:00Z', part_no: 3,
    condition_message: 'NAT-3/3 TRACKS FLS 340/400 INCLUSIVE\r\nOCT 05/0100Z TO OCT 05/0800Z\r\nPART THREE OF THREE PARTS-\r\nZ NICSO 48/50 51/40 52/30 53/20 MALOT GISTI\r\nEAST LVLS 340 350 360 370 380 390 400\r\nWEST LVLS NIL\r\nEUR RTS EAST NIL\r\nNAR N285B N251B-\r\nREMARKS:\r\n1.TMI IS 278.',
  },
];
const NOW = Date.parse('2026-10-05T03:00:00Z');
const T0 = NOW / 1000 - 1800;
const state = (hex, lon, lat, { t = T0, alt = 11_300, gs = 250, trk = 70, cs = 'UAL60' } = {}) =>
  [hex, cs, 'United States', t, t, lon, lat, alt, false, gs, trk, 0, null, alt, '1000', false, 0, 3];
const EWR = { code: 'EWR', lat: 40.6925, lon: -74.1687 };
const LHR = { code: 'LHR', lat: 51.47, lon: -0.4543 };

test('NAT: súradnice a trate zo správy FAA (smer, platnosť, len súradnicové body)', () => {
  assert.deepEqual(parseNatCoordinate('52/50'), { lat: 52, lon: -50 });
  assert.deepEqual(parseNatCoordinate('5030/50'), { lat: 50.5, lon: -50 });
  assert.equal(parseNatCoordinate('SUNOT'), null);
  const tracks = parseNatTracks(NAT_JSON);
  assert.deepEqual(tracks.map((t) => t.id), ['T', 'V', 'Z']);
  assert.equal(tracks[0].dir, 'east');
  assert.deepEqual(tracks[0].points, [{ lat: 52, lon: -50 }, { lat: 55, lon: -40 }, { lat: 56, lon: -30 }, { lat: 57, lon: -20 }]);
  assert.equal(tracks[0].fromMs, Date.parse('2026-10-05T01:00:00Z'));
  assert.deepEqual(parseNatTracks(null), []);
});

test('NAT: let na východ pri trati ju dostane; iný smer, mimo Atlantiku alebo ďaleko od trate nie', () => {
  const tracks = parseNatTracks(NAT_JSON);
  const onT = fixFromState(state('a1', -45, 53.6), T0); // medzi 52/50 a 55/40
  const pick = natTrackFor(onT, LHR, tracks, NOW);
  assert.equal(pick.track.id, 'T');
  assert.ok(pick.along.distKm < 60);
  assert.equal(natTrackFor({ ...onT, trkDeg: 260 }, EWR, tracks, NOW), null, 'na západ, trate sú na východ');
  assert.equal(natTrackFor(fixFromState(state('a2', 10, 50), T0), LHR, tracks, NOW), null, 'nad Európou nie');
  assert.equal(natTrackFor(fixFromState(state('a3', -40, 45), T0), LHR, tracks, NOW), null, '> 250 km od tratí');
  assert.equal(natTrackFor(onT, LHR, tracks, Date.parse('2026-10-05T20:00:00Z')), null, 'mimo platnosti');
});

test('NAT: lietadlo pred začiatkom trate (Nový Škótsko) dostane trať, ku ktorej mieri; mimo kurzu nie', () => {
  const tracks = parseNatTracks(NAT_JSON);
  // 600 km pred 52/50, kurz na začiatok trate T.
  const fix = fixFromState(state('a9', -58, 48.5, { trk: 54 }), T0);
  const pick = natTrackFor(fix, LHR, tracks, NOW);
  assert.ok(pick, 'priradená trať');
  assert.equal(pick.along.index, -1);
  const path = buildEstimatePath(fix, LHR, pick);
  assert.deepEqual(path.points[1], pick.track.points[0], 'najprv k začiatku trate');
  assert.notDeepEqual(path.points[2], path.points[1], 'začiatok trate nie je dvakrát');
  assert.equal(natTrackFor({ ...fix, trkDeg: 120 }, LHR, tracks, NOW), null, 'mieri inam');
  assert.equal(natTrackFor(fixFromState(state('a8', -75, 40, { trk: 54 }), T0), LHR, tracks, NOW), null, 'príliš ďaleko (New York)');
});

test('trasa odhadu: k trati, po nej a ku cieľu; bod na trase po vzdialenosti', () => {
  const tracks = parseNatTracks(NAT_JSON);
  const fix = fixFromState(state('a1', -45, 53.6), T0);
  const path = buildEstimatePath(fix, LHR, natTrackFor(fix, LHR, tracks, NOW));
  assert.equal(path.nat, 'T');
  assert.equal(path.toDestination, true);
  assert.ok(path.points.some((p) => p.lat === 56 && p.lon === -30), 'ide cez 56/30');
  const end = path.points[path.points.length - 1];
  assert.ok(greatCircleKm(end.lat, end.lon, LHR.lat, LHR.lon) < 1, 'končí v cieli');
  const total = pathLengthKm(path.points);
  const mid = pointAlongPath(path.points, 1000);
  assert.ok(Math.abs(mid.remainingKm - (total - 1000)) < 1);
  assert.ok(mid.lon > -45 && mid.lat > 53, 'po trati na severovýchod');
  const direct = buildEstimatePath(fix, LHR, null);
  assert.equal(direct.nat, null);
  assert.ok(total > pathLengthKm(direct.points), 'trať je dlhšia než najkratšia cesta');
});

test('vietor: zadný vietor na trase zrýchli, protivietor spomalí; nezmyselný fix bez úpravy', () => {
  const fix = { lat: 53, lon: -45, gsMps: 250, trkDeg: 90 };
  const points = [{ lat: 53, lon: -45 }, { lat: 53, lon: -20 }];
  // V mieste fixu bezvetrie, ďalej 40 m/s zo západu (u = +40 → tlačí na východ).
  const jet = (lat, lon) => ({ u: lon > -42 ? 40 : 0, v: 0 });
  const w = effectiveGroundSpeed(fix, points, jet);
  assert.ok(Math.abs(w.tasMps - 250) < 0.5);
  assert.ok(w.gsEffMps > 280, `zadný vietor (${w.gsEffMps.toFixed(0)} m/s)`);
  const head = effectiveGroundSpeed(fix, points, (lat, lon) => ({ u: lon > -42 ? -40 : 0, v: 0 }));
  assert.ok(head.gsEffMps < 220, 'protivietor');
  assert.equal(effectiveGroundSpeed({ ...fix, gsMps: 60 }, points, jet), null, 'pomalý fix = nie dopravné lietadlo');
  assert.equal(effectiveGroundSpeed(fix, points, () => null), null);
});

test('model + odhad: trať a vietor sa prejavia v polohe; bez modelu ako predtým', () => {
  const tracks = parseNatTracks(NAT_JSON);
  const fix = fixFromState(state('a1', -45, 53.6), T0);
  const route = { origin: EWR, destination: LHR };
  // Rovnaký vietor všade by rýchlosť nezmenil (bol už v nameranej rýchlosti) — dýzový prúd až za fixom.
  const model = buildEstimateModel(fix, route, { natTracks: tracks, windSamplerFor: () => (lat, lon) => ({ u: lon > -43 ? 40 : 0, v: 0 }), nowMs: NOW });
  assert.equal(model.nat, 'T');
  assert.ok(model.path.length > 3);
  assert.ok(model.gsEffMps > fix.gsMps, 'zadný vietor zo západu');
  const withModel = estimatePosition(fix, route, NOW, model);
  const plain = estimatePosition(fix, route, NOW);
  assert.equal(withModel.method, 'nat');
  assert.equal(withModel.wind, true);
  assert.equal(plain.method, 'route');
  assert.ok(greatCircleKm(withModel.lat, withModel.lon, plain.lat, plain.lon) > 20, 'model mení polohu');
});

test('presnosť: pásma, medián a 80. percentil, porovnanie s jednoduchým odhadom; kalibrácia kruhu', () => {
  const samples = [
    ...Array.from({ length: 30 }, (_, i) => ({ elapsedMin: 90, errorKm: 10 + i, baselineKm: 40 + i, method: 'nat' })),
    { elapsedMin: 10, errorKm: 2, baselineKm: 2, method: 'track' },
  ];
  const stats = accuracyStats(samples);
  const b = stats.find((x) => x.minMin === 60);
  assert.equal(b.n, 30);
  assert.equal(b.medianKm, 25);
  assert.ok(b.p80Km >= 33 && b.p80Km <= 34);
  assert.ok(b.baselineMedianKm > b.medianKm, 'model je lepší ako jednoduchý odhad');
  assert.equal(b.byMethod.nat.n, 30);
  const cal = stats.map((x) => ({ maxMin: Number.isFinite(x.maxMin) ? x.maxMin : null, n: x.n, p80Km: x.p80Km }));
  assert.equal(calibratedUncertaintyKm(90 * 60, 1350, cal), b.p80Km, 'dosť meraní → kruh podľa skutočnej chyby');
  assert.equal(calibratedUncertaintyKm(10 * 60, 150, cal), uncertaintyKm(150), 'málo meraní → model');
  assert.equal(calibratedUncertaintyKm(600, 150, null), uncertaintyKm(150));
});

test('sledovač: pri návrate signálu odmeria chybu odhadu aj jednoduchého odhadu', () => {
  const samples = [];
  const tracker = createEstimateTracker({ onAccuracy: (x) => samples.push(x) });
  const crowd = (t) => Array.from({ length: 30 }, (_, i) => state(`c${String(i).padStart(5, '0')}`, 5, 45 + i * 0.01, { t, cs: 'N1' }));
  tracker.ingest({ time: T0, states: [...crowd(T0), state('abc123', -45, 53.6, { trk: 60 })] });
  tracker.ingest({ time: T0 + 300, states: crowd(T0 + 300) });
  assert.equal(tracker.list((T0 + 300) * 1000).length, 1);
  // Po 40 min sa vráti ~50 km od priameho odhadu.
  const back = estimatePosition(fixFromState(state('abc123', -45, 53.6, { trk: 60 }), T0), null, (T0 + 2400) * 1000);
  tracker.ingest({ time: T0 + 2400, states: [...crowd(T0 + 2400), state('abc123', back.lon + 0.6, back.lat, { t: T0 + 2400 })] });
  assert.equal(samples.length, 1);
  assert.equal(samples[0].elapsedMin, 40);
  assert.ok(samples[0].errorKm > 30 && samples[0].errorKm < 50);
  assert.equal(tracker.list((T0 + 2400) * 1000).length, 0);
});
