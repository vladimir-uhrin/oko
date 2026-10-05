// src/data/flightEstimateChip.test.mjs — čip ODHADY v riadku Živých letov (2026-10-05).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import flightsLayer from './flights.js';

const chip = () => flightsLayer.getRowControls().chips.find((c) => c.id === 'estimates');

test('čip ODHADY: bez odhadov sa neukazuje; vypnutie ho nechá viditeľný ako cestu späť', () => {
  assert.equal(chip(), undefined, 'žiadne odhady, nič vypnuté → žiadny čip');
  flightsLayer.setParams({ showEstimates: false });
  const off = chip();
  assert.ok(off, 'vypnuté odhady musia mať viditeľný vypínač');
  assert.equal(off.active, false);
  assert.deepEqual(off.params, { showEstimates: true }, 'klik prepína na opak');
  assert.match(off.label, /VYP|OFF/);
  flightsLayer.setParams({ showEstimates: true });
  assert.equal(chip(), undefined);
});

test('čip ODHADY: voľba sa neukladá a nejde do zdieľaného odkazu (F5 vracia plnú oblohu)', () => {
  flightsLayer.setParams({ showEstimates: false });
  assert.equal(Object.hasOwn(flightsLayer.getParams?.() ?? {}, 'showEstimates'), false);
  flightsLayer.setParams({ showEstimates: 'nie' });
  assert.equal(chip()?.active, false, 'neplatná hodnota nič nemení');
  flightsLayer.setParams({ showEstimates: true });
});
