// src/data/runwayWind.test.mjs
// Odhad aktívnej dráhy z vetra (2026-09-05). Čisté funkcie nad dráhami zo
// sidecaru a vetrom z METAR.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CALM_WIND_KT,
  STRONG_CROSSWIND_KT,
  activeRunwayFromWind,
  activeRunwayLabel,
  headingFromIdent,
  normalizeDeg,
  runwayEnds,
  windComponents,
} from './runwayWind.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';

const t = (key, vars) => { let s = EN_STRINGS[key] || key; for (const [k, v] of Object.entries(vars || {})) s = s.replaceAll(`{${k}}`, String(v)); return s; };
// LZIB zo skutočného sidecaru: [le, he, lengthFt, widthFt, surface, lighted, closed, leHdgT, heHdgT]
const LZIB = [['13', '31', 10466, 148, 'CON', 1, 0, 134, 314], ['04', '22', 9515, 197, 'CON', 1, 0, 44, 224]];

test('dráha: hlavička z označenia, keď ju CSV nemá', () => {
  assert.equal(headingFromIdent('04'), 40);
  assert.equal(headingFromIdent('22L'), 220);
  assert.equal(headingFromIdent('09R'), 90);
  assert.equal(headingFromIdent('36'), 0, '36 je 360° = 0°');
  assert.equal(headingFromIdent('H1'), null, 'heliport nie je dráha');
  assert.equal(headingFromIdent(''), null);
  assert.equal(normalizeDeg(-10), 350);
  assert.equal(normalizeDeg(370), 10);
  assert.equal(normalizeDeg('x'), null);
});

test('dráha: konce so smermi — z CSV, inak z označenia; prázdny koniec vypadne', () => {
  assert.deepEqual(runwayEnds(LZIB[1]), [
    { ident: '04', headingDeg: 44, lengthFt: 9515 },
    { ident: '22', headingDeg: 224, lengthFt: 9515 },
  ]);
  assert.deepEqual(runwayEnds(['09', '27', 3000, 60, 'GRS', 0, 0, null, null]), [
    { ident: '09', headingDeg: 90, lengthFt: 3000 },
    { ident: '27', headingDeg: 270, lengthFt: 3000 },
  ], 'bez hlavičiek sa odvodia z čísel');
  assert.deepEqual(runwayEnds(['', '', null, null, null, 0, 0, null, null]), []);
  assert.deepEqual(runwayEnds(null), []);
});

test('vietor: čelná a bočná zložka vrátane strany', () => {
  // Vietor presne proti dráhe 04 (040°) → celý protivietor.
  assert.deepEqual(windComponents(40, 40, 10), { headKt: 10, crossKt: 0, crossSide: '' });
  // Vietor zozadu.
  assert.deepEqual(windComponents(40, 220, 10), { headKt: -10, crossKt: 0, crossSide: '' });
  // Vietor presne z boku sprava (dráha 040°, vietor 130°).
  const right = windComponents(40, 130, 10);
  assert.ok(Math.abs(right.headKt) < 0.05);
  assert.equal(right.crossKt, 10);
  assert.equal(right.crossSide, 'R');
  const left = windComponents(40, 310, 10);
  assert.equal(left.crossSide, 'L');
  // 45° → obe zložky ≈ 0,707 × rýchlosť.
  const diagonal = windComponents(0, 45, 10);
  assert.ok(Math.abs(diagonal.headKt - 7.1) < 0.1);
  assert.ok(Math.abs(diagonal.crossKt - 7.1) < 0.1);
  assert.equal(windComponents(null, 40, 10), null);
  assert.equal(windComponents(40, null, 10), null);
});

test('dráha: aktívna je tá s najväčším protivetrom; pri zhode rozhodne dĺžka', () => {
  // Vietor 230° / 12 kt → dráha 22 (224°).
  const west = activeRunwayFromWind(LZIB, { dirDeg: 230, speedKt: 12 });
  assert.equal(west.ident, '22');
  assert.ok(west.headKt > 11);
  assert.equal(west.tailwind, false);
  assert.equal(west.strongCross, false);
  // Vietor 130° / 10 kt → dráha 13 (134°).
  assert.equal(activeRunwayFromWind(LZIB, { dirDeg: 130, speedKt: 10 }).ident, '13');
  // Vietor presne z boku oboch dráh: rozhodne dlhšia (13/31, 10 466 ft).
  const crossOnly = activeRunwayFromWind(
    [['09', '27', 5000, 45, 'ASP', 1, 0, 90, 270], ['08', '26', 9000, 45, 'ASP', 1, 0, 80, 260]],
    { dirDeg: 355, speedKt: 8 },
  );
  assert.equal(crossOnly.ident, '08', 'takmer rovnaký protivietor → dlhšia dráha');
  // Vietor zarovnaný s dráhou 31 (314°) nemá bočnú zložku vôbec.
  const aligned = activeRunwayFromWind(LZIB, { dirDeg: 314, speedKt: 25 });
  assert.equal(aligned.ident, '31');
  assert.ok(aligned.crossKt < 1);
  assert.equal(aligned.strongCross, false);
  // Severný vietor 25 kt leží medzi oboma dráhami → silný bočný vietor.
  const strong = activeRunwayFromWind(LZIB, { dirDeg: 0, speedKt: 25 });
  assert.equal(strong.ident, '04');
  assert.equal(strong.strongCross, true);
  assert.ok(strong.crossKt >= STRONG_CROSSWIND_KT);
  assert.equal(strong.crossSide, 'L');
});

test('dráha: bezvetrie a premenlivý smer sa priznajú, nie zamlčia', () => {
  const calm = activeRunwayFromWind(LZIB, { dirDeg: 200, speedKt: CALM_WIND_KT - 1 });
  assert.equal(calm.calm, true);
  assert.equal(calm.ident, '');
  assert.equal(activeRunwayLabel(calm, t), EN_STRINGS['airport.runway-calm']);
  const variable = activeRunwayFromWind(LZIB, { dirDeg: null, speedKt: 8, variable: true });
  assert.equal(variable.variable, true);
  assert.equal(activeRunwayLabel(variable, t), EN_STRINGS['airport.runway-variable']);
  assert.equal(activeRunwayFromWind([], { dirDeg: 200, speedKt: 10 }), null, 'bez dráh niet čo tvrdiť');
  assert.equal(activeRunwayFromWind(null, null), null);
  assert.equal(activeRunwayLabel(null, t), '');
});

test('dráha: text pre kartu — protivietor, zadný vietor, bočný so stranou', () => {
  assert.equal(activeRunwayLabel(activeRunwayFromWind(LZIB, { dirDeg: 230, speedKt: 12 }), t), 'RWY 22 · headwind 12 kt · crosswind 1 kt R');
  const tail = activeRunwayLabel({ ident: '04', headKt: -6, crossKt: 0, crossSide: '', tailwind: true }, t);
  assert.match(tail, /TAILWIND 6 kt/, 'zadný vietor sa zdôrazní');
  const cross = activeRunwayLabel({ ident: '27', headKt: 3, crossKt: 12, crossSide: 'L', tailwind: false }, t);
  assert.match(cross, /crosswind 12 kt L/);
  for (const key of ['airport.headwind', 'airport.tailwind', 'airport.crosswind', 'airport.runway-calm', 'airport.runway-variable', 'airport.runway-estimate']) {
    assert.ok(EN_STRINGS[key], `EN ${key}`);
    assert.ok(SK_STRINGS[key], `SK ${key}`);
  }
});

test('dráha: tripwire — sidecar nesie hlavičky, karta ich používa, METAR vietor je dostupný', () => {
  const sidecar = JSON.parse(readFileSync(new URL('./local_data/airports/airport-details.json', import.meta.url), 'utf8'));
  const lzib = sidecar.airports.LZIB.rwy;
  assert.equal(lzib[0].length, 9, 'tuple dráhy má 9 polí vrátane oboch hlavičiek');
  assert.ok(Number.isFinite(lzib[0][7]) && Number.isFinite(lzib[0][8]));
  const weather = readFileSync(new URL('./airportWeather.js', import.meta.url), 'utf8');
  assert.match(weather, /export function cachedMetarWind/);
  assert.match(weather, /_cache\.set\(station, \{\s*\n\s*report,/, 'surový METAR ostáva v cache pre vietor');
  const card = readFileSync(new URL('./airportCard.js', import.meta.url), 'utf8');
  assert.match(card, /activeRunwayFromWind/);
  assert.match(card, /airport\.runway-estimate/, 'karta priznáva, že je to odhad');
});
