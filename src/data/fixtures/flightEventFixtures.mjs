// src/data/fixtures/flightEventFixtures.mjs — skutočné stopy pre testy Udalostí (2026-09-30).
// Stopy adsb.lol (ODbL 1.0) orezané na potrebné okná — pozri README.md. Strana „archív OKO"
// (sieť OpenSky) sa neukladá (šírenie dát OpenSky v repozitári som proti ich podmienkam
// neoveril); odvodí sa z tej istej stopy tak, ako ju archív OKO 30. 9. naozaj mal: bod najviac
// raz za 30 s (+ body strmhlavého klesania) a kód podľa pravidla — pri FZ1073 v úseku incidentu
// bez kódu, pri šume 7500 v okne, kde ho archív hlásil.
import { readFileSync } from 'node:fs';
import { traceToFlight } from '../adsblolTrace.js';
import { DIVE_VR_MPS } from '../flightAnomalies.js';

const iso = (s) => Date.parse(s) / 1000;

/** Stopa adsb.lol z fixtúry → stroj (traceToFlight). */
export function loadTrace(name) {
  return traceToFlight(JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')));
}

/** Strana archívu OKO odvodená zo stopy: bod najviac raz za 30 s + body strmhlavého klesania, kód podľa `code(p)`. */
export function okoSide(points, code) {
  const out = [];
  let lastT = -Infinity;
  for (const p of points) {
    if (p.t - lastT >= 30 || (p.vr !== null && p.vr <= DIVE_VR_MPS)) {
      out.push({ ...p, squawk: code(p) });
      lastT = p.t;
    }
  }
  return out;
}

/** FZ1073 (A6-FKF, 8965d1), 30. 9. 2026: adsb.lol stopa + strana OKO bez kódov v úseku incidentu. */
export function fz1073() {
  const flight = loadTrace('adsblol-trace-8965d1-20260930.json');
  const incident = iso('2026-09-30T05:10:00Z');
  return { flight, adsblol: flight.points, oko: okoSide(flight.points, (p) => (p.t < incident ? p.squawk : null)) };
}

/** Štyri „7500" z archívu OKO 28.–30. 9., ktoré adsb.lol v tom istom čase videla s bežným kódom. */
export const NOISE_CASES = Object.freeze([
  { hex: 'a670b4', file: 'adsblol-trace-a670b4-20260929.json', from: '2026-09-29T23:33:38Z', to: '2026-09-29T23:59:59Z', otherCode: '5323' },
  { hex: 'a46cc1', file: 'adsblol-trace-a46cc1-20260928.json', from: '2026-09-28T23:50:05Z', to: '2026-09-28T23:59:59Z', otherCode: '3244' },
  { hex: 'a681e5', file: 'adsblol-trace-a681e5-20260929.json', from: '2026-09-29T17:26:15Z', to: '2026-09-29T17:40:07Z', otherCode: '1200' },
  { hex: '300a95', file: 'adsblol-trace-300a95-20260930.json', from: '2026-09-30T04:23:37Z', to: '2026-09-30T04:31:35Z', otherCode: '7224' },
]);

/** Šumový prípad: adsb.lol stopa + strana OKO s kódom 7500 v okne, kde ho archív OKO hlásil. */
export function noiseCase(c) {
  const flight = loadTrace(c.file);
  const a = iso(c.from);
  const b = iso(c.to);
  return { flight, adsblol: flight.points, oko: okoSide(flight.points, (p) => (p.t >= a && p.t <= b ? '7500' : p.squawk)), fromS: a, toS: b };
}

export const T = (s) => iso(s);
