// src/overlays/worldOverlayLaneSuppression.test.mjs
// Mobilný plášť (2026-09-14): hostiteľ vie potlačiť celý paint lane
// (ambient-card na telefóne), neznámy lane je chyba, stav sa dá vrátiť.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WORLD_OVERLAY_PAINT_LANES,
  isWorldOverlayLaneSuppressed,
  setWorldOverlayLaneSuppressed,
} from './worldOverlay.js';

test('setWorldOverlayLaneSuppressed: prepína známy lane, neznámy odmietne, predvolene nič nie je potlačené', () => {
  for (const lane of WORLD_OVERLAY_PAINT_LANES) assert.equal(isWorldOverlayLaneSuppressed(lane), false, lane);
  assert.equal(setWorldOverlayLaneSuppressed('ambient-card', true), true);
  assert.equal(isWorldOverlayLaneSuppressed('ambient-card'), true);
  assert.equal(isWorldOverlayLaneSuppressed('selected'), false, 'vybraná karta ostáva');
  assert.equal(isWorldOverlayLaneSuppressed('tracked'), false, 'sledovaná karta ostáva');
  assert.equal(setWorldOverlayLaneSuppressed('ambient-card', false), false);
  assert.equal(isWorldOverlayLaneSuppressed('ambient-card'), false);
  assert.throws(() => setWorldOverlayLaneSuppressed('nope', true), /Unsupported WorldOverlay paint lane/);
  assert.equal(isWorldOverlayLaneSuppressed('nope'), false);
});
