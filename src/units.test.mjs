// src/units.test.mjs
// Prepínač jednotiek výšky a rýchlosti (2026-09-07).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  UNITS_CHANGED_EVENT,
  _resetUnitsForTest,
  altitudeDisplayValue,
  altitudeUnitLabel,
  formatAltitude,
  formatHeightAgl,
  formatSpeed,
  formatSpeedRange,
  formatThousands,
  formatVerticalRateMagnitude,
  formatVesselSpeedKnots,
  getUnitSystem,
  onUnitSystemChange,
  setUnitSystem,
  speedDisplayValue,
  speedUnitLabel,
  toggleUnitSystem,
} from './units.js';

const NBSP = ' ';

test('predvolené letecké jednotky: FL nad 18 000 ft, stopy pod, knoty, ft/min', () => {
  _resetUnitsForTest();
  assert.equal(getUnitSystem(), 'aviation');
  assert.equal(formatAltitude(10_363), 'FL340');
  assert.equal(formatAltitude(10_363, { level: false }), `33${NBSP}999 ft`);
  assert.equal(formatAltitude(1_200), `3${NBSP}937 ft`);
  assert.equal(formatAltitude(NaN), '');
  assert.equal(formatSpeed(256.7), '499 kts');
  assert.equal(formatSpeedRange(150, 250), '292 → 486 kts');
  assert.equal(formatVerticalRateMagnitude(-5), '980 ft/min');
  assert.equal(formatHeightAgl(846), `2${NBSP}776 ft`);
  assert.equal(formatVesselSpeedKnots(14.4), '14 kn');
  assert.equal(formatVesselSpeedKnots(0), '');
  assert.equal(altitudeUnitLabel(), 'FT');
  assert.equal(speedUnitLabel(), 'KTS');
  assert.equal(altitudeDisplayValue(10_660.3), 34_975);
  assert.equal(speedDisplayValue(221.2), 430);
  assert.equal(formatThousands(34_975), `34${NBSP}975`, 'tenká medzera, nie anglická čiarka');
});

test('metrické jednotky: metre, km/h, m/s; žiadne letové hladiny', () => {
  _resetUnitsForTest();
  setUnitSystem('metric', { persist: false, target: null });
  assert.equal(getUnitSystem(), 'metric');
  assert.equal(formatAltitude(10_363), `10${NBSP}363 m`);
  assert.equal(formatSpeed(256.7), '924 km/h');
  assert.equal(formatSpeedRange(150, 250), '540 → 900 km/h');
  assert.equal(formatVerticalRateMagnitude(-5.04), '5,0 m/s');
  assert.equal(formatHeightAgl(846), '846 m');
  assert.equal(formatVesselSpeedKnots(14.4), '27 km/h');
  assert.equal(altitudeUnitLabel(), 'M');
  assert.equal(speedUnitLabel(), 'KM/H');
  assert.equal(altitudeDisplayValue(10_660.3), 10_660);
  assert.equal(speedDisplayValue(221.2), 796);
  // Explicitný systém prebije globálny.
  assert.equal(formatAltitude(10_363, { system: 'aviation' }), 'FL340');
  _resetUnitsForTest();
});

test('prepínanie: neplatný systém sa ignoruje, toggle strieda, udalosť nesie nový aj starý', () => {
  _resetUnitsForTest();
  const events = [];
  const target = new EventTarget();
  const off = onUnitSystemChange((system) => events.push(system), target);
  assert.equal(setUnitSystem('furlongs', { persist: false, target }), 'aviation');
  assert.equal(toggleUnitSystem({ persist: false, target }), 'metric');
  assert.equal(toggleUnitSystem({ persist: false, target }), 'aviation');
  assert.equal(setUnitSystem('aviation', { persist: false, target }), 'aviation', 'rovnaký systém = bez udalosti');
  assert.deepEqual(events, ['metric', 'aviation']);
  off();
  toggleUnitSystem({ persist: false, target });
  assert.equal(events.length, 2, 'po odhlásení nič');
  assert.equal(UNITS_CHANGED_EVENT, 'gev:units-changed');
  _resetUnitsForTest();
});

test('tripwire: spotrebitelia formátujú cez units.js, nie vlastnými konštantami', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  for (const [file, must] of [
    ['./data/trackedCardModel.js', /from '\.\.\/units\.js'/],
    ['./data/flightProfile.js', /formatSpeedRange\(/],
    ['./data/contactHoverCard.js', /formatSpeed\(summary\.speedMps\)/],
    ['./cockpitApproach.js', /formatHeightAgl\(/],
    ['./data/detectionDraw.js', /formatVesselSpeedKnots\(|formatAltitude\(/],
    ['./data/militaryFlights.js', /formatAltitude\(|formatSpeed\(/],
    ['./data/aisLiveVessels.js', /formatVesselSpeedKnots\(/],
    ['./ui.js', /altitudeDisplayValue\(|speedDisplayValue\(/],
  ]) {
    assert.match(read(file), must, `${file} používa units.js`);
  }
  const ui = read('./ui.js');
  assert.match(ui, /onUnitSystemChange\(/, 'kokpit reaguje na zmenu jednotiek živo');
  assert.doesNotMatch(ui, /toLocaleString\('en-US'\)/, 'kokpit už nepoužíva anglický oddeľovač tisícov');
  const html = read('../index.html');
  assert.match(html, /id="units-toggle"/, 'prepínač jednotiek v paneli Zobrazenie');
  for (const file of ['./data/trackedCardModel.js', './data/flightProfile.js', './data/contactHoverCard.js', './cockpitApproach.js', './data/detectionDraw.js']) {
    assert.doesNotMatch(read(file), /3\.28084|1\.94384|196\.850394/, `${file}: konverzné konštanty žijú len v units.js`);
  }
});
