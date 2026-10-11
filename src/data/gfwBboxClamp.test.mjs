// src/data/gfwBboxClamp.test.mjs — výrez radaru najviac 38° na stranu (2026-10-11, Hormuz HTTP 400).
import test from 'node:test';
import assert from 'node:assert/strict';
import { GFW_MAX_BBOX_DEG, clampGfwBbox } from './gfwPresence.js';
import { quantizeGfwBbox } from './gfwPresenceCore.js';

test('široký šikmý výrez sa zúži okolo bodu pod kamerou; malý ostane', () => {
  const wide = { west: 30, south: 25, east: 83, north: 41 };
  const out = clampGfwBbox(wide, { lon: 56.3, lat: 26.5 });
  assert.ok(out.east - out.west <= GFW_MAX_BBOX_DEG + 1e-9 && out.north - out.south <= 16 + 1e-9);
  assert.ok(out.west <= 56.3 && out.east >= 56.3, 'Hormuz ostane vo výreze');
  assert.ok(out.west >= 30 && out.east <= 83, 'v pôvodnom obdĺžniku');
  assert.deepEqual(clampGfwBbox({ west: 55, south: 25, east: 57, north: 27 }, { lon: 56, lat: 26 }), { west: 55, south: 25, east: 57, north: 27 });
  // Stred mimo obdĺžnika (kamera sa pozerá za okraj) → prichytí sa k okraju.
  const edge = clampGfwBbox({ west: 0, south: 0, east: 100, north: 10 }, { lon: 200, lat: 5 });
  assert.equal(edge.east, 100);
  assert.equal(edge.west, 100 - GFW_MAX_BBOX_DEG);
  // Bez stredu: okolo stredu obdĺžnika.
  const mid = clampGfwBbox({ west: 0, south: 0, east: 100, north: 10 });
  assert.equal(mid.west, 50 - GFW_MAX_BBOX_DEG / 2);
  assert.ok(quantizeGfwBbox(mid).east - quantizeGfwBbox(mid).west <= 40, 'po zaokrúhlení pod limitom proxy');
});
