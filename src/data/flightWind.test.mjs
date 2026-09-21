// src/data/flightWind.test.mjs — vietor v letovej hladine pre kartu lietadla.
import test from 'node:test';
import assert from 'node:assert/strict';

import { LEVEL_ALTITUDE_M, flightLevelOf, levelForAltitude, windRelativeToTrack } from './flightWind.js';
import { WIND_LEVELS } from './meteoField.js';

test('každá hladina má výšku a výšky rastú s klesajúcim tlakom', () => {
  for (const l of WIND_LEVELS) {
    assert.ok(Number.isFinite(LEVEL_ALTITUDE_M[l.id]), `${l.id} nemá výšku`);
  }
  const alts = WIND_LEVELS.map((l) => LEVEL_ALTITUDE_M[l.id]);
  for (let i = 1; i < alts.length; i += 1) {
    assert.ok(alts[i] > alts[i - 1], 'nižší tlak = väčšia výška');
  }
});

test('levelForAltitude vyberie najbližšiu hladinu, nie tú pod alebo nad', () => {
  assert.equal(levelForAltitude(0).id, 'wind', 'na zemi prízemný vietor');
  assert.equal(levelForAltitude(1500).id, 'wind850');
  assert.equal(levelForAltitude(3000).id, 'wind700');
  assert.equal(levelForAltitude(5600).id, 'wind500');
  // Dopravné lietadlo v FL340 (~10 360 m) → 250 hPa, presne preto to robíme.
  assert.equal(levelForAltitude(10_363).id, 'wind250');
  assert.equal(levelForAltitude(11_500).id, 'wind250', 'nad najvyššou hladinou ostane najvyššia');
  assert.equal(levelForAltitude(NaN), null);
  assert.equal(levelForAltitude(undefined), null);
});

test('windRelativeToTrack: smer ODKIAĽ fúka podľa meteorologickej konvencie', () => {
  // Vietor fúkajúci NA východ (u > 0) prichádza zo ZÁPADU = 270°.
  assert.equal(Math.round(windRelativeToTrack(10, 0, 0).fromDeg), 270);
  // Vietor fúkajúci NA sever (v > 0) prichádza z JUHU = 180°.
  assert.equal(Math.round(windRelativeToTrack(0, 10, 0).fromDeg), 180);
  assert.equal(Math.round(windRelativeToTrack(-10, 0, 0).fromDeg), 90, 'na západ = z východu');
  assert.equal(Math.round(windRelativeToTrack(0, -10, 0).fromDeg), 0, 'na juh = zo severu');
  assert.equal(Math.round(windRelativeToTrack(3, 4, 0).speedMps), 5, 'rýchlosť je hypotenúza');
});

test('windRelativeToTrack: zadný vietor kladný, protivietor záporný, bočný sprava kladný', () => {
  // Let na sever (kurz 0), vietor fúka na sever (v = +10) → tlačí zozadu.
  const tail = windRelativeToTrack(0, 10, 0);
  assert.equal(Math.round(tail.headMps), 10, 'zadný vietor je kladný');
  assert.equal(Math.round(tail.crossMps), 0);

  // Let na sever, vietor fúka na juh → protivietor.
  assert.equal(Math.round(windRelativeToTrack(0, -10, 0).headMps), -10);

  // Let na sever, vietor FÚKA na východ (u = +10) → prichádza zo ZÁPADU (270°),
  // čo je naľavo od kurzu 0. Môj pôvodný test tvrdil opak — chybu odhalil až
  // prepočet živého letu (UAE69), nie test.
  const cross = windRelativeToTrack(10, 0, 0);
  assert.equal(Math.round(cross.headMps), 0);
  assert.equal(Math.round(cross.crossMps), -10, 'fúka doprava = prichádza ZĽAVA');
  // A naopak: vietor fúkajúci na západ prichádza z východu = sprava.
  assert.equal(Math.round(windRelativeToTrack(-10, 0, 0).crossMps), 10, 'prichádza sprava');

  // Let na východ (kurz 90), vietor na východ → zadný.
  assert.equal(Math.round(windRelativeToTrack(10, 0, 90).headMps), 10);

  // Bez kurzu sa zložky nedajú spočítať — a NEsmú sa vymyslieť.
  const noTrack = windRelativeToTrack(5, 5, undefined);
  assert.ok(Number.isNaN(noTrack.headMps));
  assert.ok(Number.isNaN(noTrack.crossMps));
  assert.ok(Number.isFinite(noTrack.speedMps), 'rýchlosť vetra sa dá aj bez kurzu');
});

test('zachovanie energie: head² + cross² = rýchlosť²', () => {
  for (const [u, v, trk] of [[7, -3, 42], [-12, 5, 217], [0, 9, 355], [4, 4, 130]]) {
    const w = windRelativeToTrack(u, v, trk);
    const sum = Math.hypot(w.headMps, w.crossMps);
    assert.ok(Math.abs(sum - w.speedMps) < 1e-9, 'rozklad nesmie stratiť ani pridať energiu');
  }
});

test('flightLevelOf: metre → FL po desiatkach', () => {
  assert.equal(flightLevelOf(10_363), 340, 'FL340');
  assert.equal(flightLevelOf(3048), 100, 'FL100');
  assert.equal(flightLevelOf(0), 0);
  assert.equal(flightLevelOf(NaN), null);
});

test('regresia zo živého letu: UAE69 kurz 282°, vietor z 348° prichádza SPRAVA', () => {
  // 122 kts ≈ 62,8 m/s z 348° → fúka na 168°.
  const sp = 62.8;
  const toward = (168 * Math.PI) / 180;
  const u = Math.sin(toward) * sp;
  const v = Math.cos(toward) * sp;
  const w = windRelativeToTrack(u, v, 282);
  assert.ok(w.headMps < 0, 'protivietor');
  assert.ok(Math.abs(w.headMps) > 20 && Math.abs(w.headMps) < 30, 'okolo 25 m/s (~49 kts)');
  assert.ok(w.crossMps > 0, 'zdroj 66° napravo od nosa = prichádza SPRAVA');
  assert.ok(Math.abs(Math.hypot(w.headMps, w.crossMps) - sp) < 1e-9, 'energia sedí');
});
