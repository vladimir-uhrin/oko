// src/data/eventTimeline.test.mjs — časová os udalosti z dvoch sietí (Udalosti, etapa 1, 2026-09-30).
// Testy SPRÁVANIA: pri FZ1073 vyjdú momenty v správnom poradí, pri každom ktorá sieť ho videla,
// diera ostane dierou a pristátie mimo pokrytia sa nevymyslí; vyvrátený šum na osi nie je.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTrack } from './flightAnomalies.js';
import { verifyEvent } from './eventVerify.js';
import { buildEventTimeline, clockUtc, describeMoment } from './eventTimeline.js';
import { T, fz1073, noiseCase, NOISE_CASES } from './fixtures/flightEventFixtures.mjs';

const nets = (oko, adsblol) => [
  { id: 'opensky', label: 'OpenSky', points: normalizeTrack(oko) },
  { id: 'adsblol', label: 'adsb.lol', points: normalizeTrack(adsblol) },
];
const labels = { opensky: 'OpenSky', adsblol: 'adsb.lol' };

test('FZ1073: klesanie → 9 min bez údajov → 7700 → 7500 → obrat → koniec údajov vo výške (bez vymysleného pristátia)', () => {
  const { oko, adsblol } = fz1073();
  const networks = nets(oko, adsblol);
  const v = verifyEvent(networks[0], networks[1]);
  const { moments, coverage } = buildEventTimeline(networks, v.triggers);
  const incident = moments.filter((m) => m.t >= T('2026-09-30T05:20:00Z'));
  assert.deepEqual(incident.map((m) => m.kind), ['dive', 'gap', 'squawk', 'squawk', 'uturn', 'last-contact']);
  const [dive, gap, c7700, c7500, uturn, end] = incident;
  assert.deepEqual(dive.seenBy, ['opensky', 'adsblol']);
  assert.equal(dive.fpm, -21_312);
  assert.equal(Math.round(gap.s / 60), 9);
  assert.deepEqual([c7700.code, c7700.seenBy, c7700.status], ['7700', ['adsblol'], 'no-data'], 'kód videla len jedna sieť — na osi označený');
  assert.equal(c7500.t, T('2026-09-30T05:36:18Z'));
  assert.ok(Math.abs(uturn.turnDeg) >= 150);
  assert.deepEqual([end.kind, end.airborne, end.t], ['last-contact', true, T('2026-09-30T05:53:33Z')]);
  assert.ok(!moments.some((m) => m.kind === 'landing'), 'pristátie v Tabuku v dátach nie je');
  assert.ok(moments[0].kind === 'takeoff', 'začína štartom');
  assert.deepEqual(coverage.map((c) => c.id), ['opensky', 'adsblol']);
  assert.ok(coverage.every((c) => c.points > 0));
});

test('popis momentu SK aj EN: čas UTC, fakt, ktoré siete ho videli', () => {
  const { oko, adsblol } = fz1073();
  const networks = nets(oko, adsblol);
  const { moments } = buildEventTimeline(networks, verifyEvent(networks[0], networks[1]).triggers);
  const text = moments.map((m) => describeMoment(m, { labels }));
  assert.ok(text.includes('05:22:05 UTC — strmhlavé klesanie 21 312 ft/min vo výške 35 550 ft (OpenSky, adsb.lol)'), text.join('\n'));
  assert.ok(text.includes('05:31:30 UTC — transpondér vysiela 7700 (núdza) (adsb.lol)'));
  assert.ok(text.includes('05:36:18 UTC — transpondér vysiela 7500 (nezákonný zásah) (adsb.lol)'));
  assert.ok(text.includes('05:53:33 UTC — koniec údajov vo výške 15 025 ft (OpenSky, adsb.lol)'));
  const en = moments.map((m) => describeMoment(m, { lang: 'en', labels }));
  assert.ok(en.includes('05:36:18 UTC — transponder squawks 7500 (unlawful interference) (adsb.lol)'));
  assert.equal(clockUtc(T('2026-09-30T05:02:03Z')), '05:02:03');
});

test('diera bez údajov: potvrdzujú ju len siete, ktoré v okne nejaké body majú', () => {
  const { oko } = fz1073();
  const networks = nets(oko, []);
  const { moments } = buildEventTimeline(networks, verifyEvent(networks[0], networks[1]).triggers);
  const gaps = moments.filter((m) => m.kind === 'gap');
  assert.ok(gaps.length > 0);
  assert.ok(gaps.every((g) => g.seenBy.join() === 'opensky'), 'prázdna druhá sieť dieru nepotvrdzuje');
});

test('vyvrátený šum na časovej osi nie je', () => {
  const c = NOISE_CASES[0];
  const { oko, adsblol } = noiseCase(c);
  const networks = nets(oko, adsblol);
  const v = verifyEvent(networks[0], networks[1]);
  assert.equal(v.status, 'rejected');
  const { moments } = buildEventTimeline(networks, v.triggers);
  assert.ok(!moments.some((m) => m.kind === 'squawk'), 'kód 7500 z archívu OKO sa na osi neukáže');
});
