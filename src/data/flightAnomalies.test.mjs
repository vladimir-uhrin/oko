// src/data/flightAnomalies.test.mjs — zachytenie vážnych situácií v stope (Udalosti, etapa 1, 2026-09-30).
// Testy SPRÁVANIA: núdzové kódy, strmhlavé klesanie, obrat, diery a fázy letu — na umelých stopách
// aj na skutočnej stope FZ1073 (adsb.lol, 30. 9.), kde musia vyjsť presne momenty zo správy vlastníkovi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIVE_VR_MPS, FPM_PER_MPS, dataGaps, detectTriggers, diveEvents, flightPhases, normalizePoint, normalizeTrack,
  squawkEpisodes, uTurns,
} from './flightAnomalies.js';
import { T, fz1073 } from './fixtures/flightEventFixtures.mjs';

const P = (t, extra = {}) => ({ t, lat: 48, lon: 17, alt: 10_000, gs: 230, trk: 90, vr: 0, squawk: '1000', gnd: false, ...extra });

test('bod stopy: fix archívu aj bod adsb.lol v jednom tvare, kód len 4 osmičkové číslice', () => {
  assert.deepEqual(normalizePoint({ t: 10, lat: 1, lon: 2, alt: 100, gs: 5, trk: 90, vr: -1, squawk: '7700', gnd: 1 }),
    { t: 10, lat: 1, lon: 2, alt: 100, gs: 5, trk: 90, vr: -1, squawk: '7700', gnd: true });
  assert.equal(normalizePoint({ t: 1, lat: 1, lon: 1, squawk: '7800' }).squawk, null, '8 nie je osmičková číslica');
  assert.equal(normalizePoint({ t: 1, lat: 1, lon: 1, squawk: 7500 }).squawk, '7500');
  assert.equal(normalizePoint({ t: 1, lat: null, lon: 1 }), null);
  const track = normalizeTrack([P(20), P(10), P(10), null]);
  assert.deepEqual(track.map((p) => p.t), [10, 20], 'chronologicky, bez duplicitnej sekundy');
});

test('epizódy kódov: bod bez kódu epizódu nekončí, iný kód áno, 10 min bez kódu tiež; na zemi sa nerátajú', () => {
  const pts = normalizeTrack([
    P(0), P(60, { squawk: '7700' }), P(90, { squawk: null }), P(120, { squawk: '7700' }), P(150, { squawk: '7500' }),
    P(180, { squawk: '7500' }), P(200, { squawk: '2000' }), P(1000, { squawk: '7600' }), P(1700, { squawk: '7600' }),
    P(1800, { squawk: '7700', gnd: true }),
  ]);
  const eps = squawkEpisodes(pts);
  assert.deepEqual(eps.map((e) => [e.code, e.startT, e.endT, e.points]), [
    ['7700', 60, 120, 2], ['7500', 150, 180, 2], ['7600', 1000, 1000, 1], ['7600', 1700, 1700, 1],
  ]);
  assert.equal(eps[1].meaning, 'hijack');
});

test('strmhlavé klesanie: prah 8 000 ft/min, nie pri zemi, body do 2 min = jedna udalosť s najprudším', () => {
  const v = DIVE_VR_MPS;
  const pts = normalizeTrack([
    P(0), P(10, { vr: v - 1 }), P(40, { vr: v - 20, alt: 9000 }), P(100, { vr: v - 5 }), P(400, { vr: v - 50, alt: 2000 }),
    P(600, { vr: v + 1 }),
  ]);
  const dives = diveEvents(pts);
  assert.equal(dives.length, 1);
  assert.deepEqual([dives[0].t, dives[0].startT, dives[0].endT, dives[0].points, dives[0].alt], [40, 10, 100, 3, 9000]);
  assert.ok(Math.abs(DIVE_VR_MPS * FPM_PER_MPS + 8000) < 1e-6);
});

test('klesanie bez straty výšky (chybná hodnota rýchlosti) sa zahodí; klesanie, po ktorom údaje skončia, ostane (havária)', () => {
  const v = DIVE_VR_MPS - 10;
  const spike = normalizeTrack([P(0), P(30, { vr: v }), P(60), P(300), P(600)]);
  assert.deepEqual(diveEvents(spike), [], 'výška ostala 10 000 m — nie klesanie');
  const real = normalizeTrack([P(0), P(30, { vr: v }), P(90, { alt: 8000, vr: v }), P(400, { alt: 5000 })]);
  assert.equal(diveEvents(real)[0].lossM, 5000);
  const lost = normalizeTrack([P(0), P(30, { vr: v, alt: 9800 })]);
  assert.equal(diveEvents(lost).length, 1, 'údaje po klesaní chýbajú — nezahodiť');
});

test('obrat: 180° do 5 min vo výške áno (čas = polovica otočky), 90° alebo nízko nie; diery a fázy letu', () => {
  const turn = (alt) => normalizeTrack(Array.from({ length: 13 }, (_, i) => P(i * 10, { trk: (360 + 90 - i * 15) % 360, alt })));
  const [u] = uTurns(turn(5000));
  assert.ok(u && Math.round(u.turnDeg) === -180, `obrat doľava ${u?.turnDeg}`);
  assert.equal(u.t, 60, 'polovica otočky');
  assert.deepEqual(uTurns(normalizeTrack(Array.from({ length: 7 }, (_, i) => P(i * 10, { trk: 90 - i * 15 })))), []);
  assert.deepEqual(uTurns(turn(1500)), [], 'nízko = priblíženie, nie obrat');
  const gaps = dataGaps(normalizeTrack([P(0), P(100), P(500), P(520, { gnd: true }), P(2000, { gnd: true })]));
  assert.deepEqual(gaps.map((g) => [g.fromT, g.toT, g.s]), [[100, 500, 400]], 'diera na zemi sa nepočíta');
  const ph = flightPhases(normalizeTrack([
    P(0, { gnd: true, alt: 0 }), P(60, { alt: 500, vr: 10 }), P(600, { alt: 11_000 }), P(3000, { alt: 11_000 }),
    P(5000, { alt: 300, vr: -5 }), P(5100, { gnd: true, alt: 0 }),
  ]));
  assert.deepEqual([ph.takeoff.t, ph.cruise.t, ph.landing.t, ph.lastContact.airborne], [60, 600, 5100, false]);
  const cut = flightPhases(normalizeTrack([P(0, { gnd: true, alt: 0 }), P(60, { alt: 500 }), P(900, { alt: 4500 })]));
  assert.equal(cut.landing, null, 'údaje skončili vo vzduchu — pristátie sa nevymyslí');
  assert.equal(cut.lastContact.airborne, true);
});

test('skutočný FZ1073 (adsb.lol): klesanie 05:22:05, 7700 o 05:31:30, 7500 o 05:36:18, obrat okolo 05:42, koniec vo výške 05:53:33', () => {
  const { adsblol } = fz1073();
  const pts = normalizeTrack(adsblol);
  const trig = detectTriggers(pts);
  const dive = trig.find((x) => x.kind === 'dive');
  assert.equal(dive.t, T('2026-09-30T05:22:05Z'));
  assert.equal(Math.round(dive.vr * FPM_PER_MPS), -21_312);
  const codes = trig.filter((x) => x.kind === 'squawk');
  assert.deepEqual(codes.map((c) => [c.code, c.startT]), [['7700', T('2026-09-30T05:31:30Z')], ['7500', T('2026-09-30T05:36:18Z')]]);
  const [u] = uTurns(pts);
  assert.ok(u.t >= T('2026-09-30T05:42:00Z') && u.t <= T('2026-09-30T05:43:30Z'), `obrat ${new Date(u.t * 1000).toISOString()}`);
  assert.ok(Math.abs(u.turnDeg) >= 150 && u.turnDeg < 0, 'obrat doľava');
  const ph = flightPhases(pts);
  assert.equal(ph.lastContact.t, T('2026-09-30T05:53:33Z'));
  assert.equal(ph.lastContact.airborne, true, 'Tabuk nie je v dátach');
  assert.equal(ph.landing, null);
  assert.ok(ph.takeoff && ph.takeoff.t >= T('2026-09-30T03:00:00Z') && ph.takeoff.t <= T('2026-09-30T03:08:00Z'), 'štart z Dubaja');
  assert.ok(dataGaps(pts).some((g) => g.fromT <= T('2026-09-30T05:22:30Z') && g.toT >= T('2026-09-30T05:31:00Z')), '9 min bez údajov počas klesania');
});
