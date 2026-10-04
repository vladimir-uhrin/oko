// src/homeView.test.mjs — sklon úvodného pohľadu podľa tvaru okna (2026-09-30).
// Na výšku (mobil) ukazovalo 60° zorné pole ~18° oblohy a vzdialené lietadlá pri Viedni
// pôsobili ako roj nad Bratislavou; vlastník: „daj −20°". Na šírku ostáva pôvodných −12°.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOME_PORTRAIT_PITCH_DEG, HOME_VIEW, homePitchDeg } from './camera.js';

test('úvodný pohľad: na výšku −20°, na šírku a pri neznámej veľkosti pôvodný sklon', () => {
  assert.equal(HOME_PORTRAIT_PITCH_DEG, -20);
  assert.equal(HOME_VIEW.pitchDeg, -12);
  assert.equal(homePitchDeg(375, 812), -20, 'telefón na výšku');
  assert.equal(homePitchDeg(627, 860), -20, 'úzke okno na výšku');
  assert.equal(homePitchDeg(1280, 720), -12, 'počítač na šírku');
  assert.equal(homePitchDeg(800, 800), -12, 'štvorec ostáva ako na šírku');
  assert.equal(homePitchDeg(undefined, undefined), -12, 'bez plátna (headless) pôvodný sklon');
  assert.equal(homePitchDeg(0, 500), -12);
});
