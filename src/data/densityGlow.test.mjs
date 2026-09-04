// src/data/densityGlow.test.mjs
// Mäkký žiar buniek hustoty (2026-09-04): disky čítali ako „bubliny".
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DENSITY_GLOW_DIAMETER_RATIO,
  DENSITY_GLOW_TEXTURE_PX,
  densityGlowDiameterPx,
  densityGlowSprite,
  _resetDensityGlowForTest,
} from './densityGlow.js';

test('bez DOM-u vracia prázdny sprite a vrstva image nenastaví', () => {
  _resetDensityGlowForTest();
  assert.equal(typeof document, 'undefined', 'Node test beží bez DOM-u');
  assert.equal(densityGlowSprite(), '');
  assert.equal(densityGlowSprite(), '', 'cache drží aj prázdny výsledok');
});

test('s DOM-om vznikne PNG data URL raz a cachuje sa', () => {
  _resetDensityGlowForTest();
  let created = 0;
  let gradientStops = 0;
  const fakeContext = {
    createRadialGradient: () => ({ addColorStop: () => { gradientStops += 1; } }),
    fillRect: () => {},
    set fillStyle(_value) {},
  };
  globalThis.document = {
    createElement: () => {
      created += 1;
      return {
        width: 0, height: 0,
        getContext: () => fakeContext,
        toDataURL: () => 'data:image/png;base64,AAA',
      };
    },
  };
  try {
    assert.equal(densityGlowSprite(), 'data:image/png;base64,AAA');
    assert.equal(densityGlowSprite(), 'data:image/png;base64,AAA');
    assert.equal(created, 1, 'jedna textúra pre obe vrstvy');
    // Okraj musí byť priehľadný — inak je to zas disk.
    assert.ok(gradientStops >= 3);
  } finally {
    delete globalThis.document;
    _resetDensityGlowForTest();
  }
});

test('žiar je širší než jadro, ktoré nahrádza', () => {
  assert.ok(DENSITY_GLOW_DIAMETER_RATIO > 1.5);
  assert.equal(densityGlowDiameterPx(10), 10 * DENSITY_GLOW_DIAMETER_RATIO);
  assert.ok(densityGlowDiameterPx(Number.NaN) > 0, 'nefinitné jadro nedá nulový sprite');
  assert.ok(DENSITY_GLOW_TEXTURE_PX >= 32, 'dosť pixelov na hladký gradient');
});
