import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldReveal } from './sceneRevealGate.js';

test('shouldReveal is true within the threshold, false beyond it, and safe on bad input', () => {
  // zoomed in over the strait (~300 km away) → reveal
  assert.equal(shouldReveal(300_000, 1_500_000), true);
  // exactly at the threshold still reveals
  assert.equal(shouldReveal(1_500_000, 1_500_000), true);
  // pulled back to a whole-planet view (~20 000 km) → hide
  assert.equal(shouldReveal(20_000_000, 1_500_000), false);
  // non-finite inputs never reveal (never leave overlays stuck on)
  assert.equal(shouldReveal(NaN, 1_500_000), false);
  assert.equal(shouldReveal(300_000, NaN), false);
  assert.equal(shouldReveal(undefined, 1_500_000), false);
});
