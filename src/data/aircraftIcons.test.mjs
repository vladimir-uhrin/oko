// src/data/aircraftIcons.test.mjs
// Antikolízne strobo (požiadavka 2026-09-03: „blikajúce svetlo ako majú
// lietadlá normálne, ale veľmi jemné, 1–2 px"): čistá fáza blikania a
// strobo variant ikony.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STROBE_FLASH_MS,
  STROBE_PERIOD_MS,
  aircraftIcon,
  strobeOn,
} from './aircraftIcons.js';

function decoded(uri) {
  return Buffer.from(uri.split(',')[1], 'base64').toString('utf8');
}

test('strobeOn: krátky záblesk, dlhá tma — z wall-clocku, nie z frame countera', () => {
  // Reálny strobe: ~10 % duty cycle. Wall-clock fáza = na zaparkovanej scéne
  // sa nič nevynucuje (flights drží continuous render, kým je vrstva zapnutá).
  assert.ok(STROBE_FLASH_MS < STROBE_PERIOD_MS / 4, 'záblesk je krátky, nie stroboskop');
  assert.equal(strobeOn(0), true);
  assert.equal(strobeOn(STROBE_FLASH_MS - 1), true);
  assert.equal(strobeOn(STROBE_FLASH_MS), false);
  assert.equal(strobeOn(STROBE_PERIOD_MS - 1), false);
  assert.equal(strobeOn(STROBE_PERIOD_MS), true, 'perióda sa opakuje');
  assert.equal(strobeOn(STROBE_PERIOD_MS * 7 + 10), true);
});

test('strobo variant ikony: vlastný cache kľúč, svetlo len v zapnutej fáze', () => {
  const base = aircraftIcon('airliner', 64, false);
  const lit = aircraftIcon('airliner', 64, true);
  assert.notEqual(base, lit, 'zapnutá fáza je iná textúra');
  assert.equal(aircraftIcon('airliner', 64), base, 'default = bez svetla (spätne kompatibilné)');
  assert.equal(aircraftIcon('airliner', 64, true), lit, 'cache vracia identickú URI');
  assert.ok(!decoded(base).includes('strobe'), 'základ svetlo nemá');
  assert.ok(decoded(lit).includes('strobe'), 'zapnutá fáza nesie strobo svetlo');
});

test('TR-3B si nechá vlastné svetlá — strobo sa naň nelepí', () => {
  // Easter egg má trojicu rohových svetiel s vlastným rytmom scény; biele
  // strobo na čiernom trojuholníku by kazilo siluetu.
  assert.equal(aircraftIcon('tr3b', 64, true), aircraftIcon('tr3b', 64, false));
  assert.equal(aircraftIcon('tr3bHot', 192, true), aircraftIcon('tr3bHot', 192, false));
});

test('tripwire: fleet tick prepína strobo fázu pre civilnú aj vojenskú flotilu', () => {
  const flights = readFileSync(new URL('./flights.js', import.meta.url), 'utf8');
  const military = readFileSync(new URL('./militaryFlights.js', import.meta.url), 'utf8');
  for (const [name, source] of [['flights', flights], ['military', military]]) {
    assert.match(source, /_lastStrobeOn/, `${name}: drží poslednú fázu`);
    assert.match(source, /strobeOn\(/, `${name}: číta wall-clock fázu`);
  }
});
