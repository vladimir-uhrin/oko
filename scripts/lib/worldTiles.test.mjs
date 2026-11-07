// scripts/lib/worldTiles.test.mjs
// Celosvetové dlaždice (2026-11-07): žiadne prekrytie so starým oknom ani navzájom,
// pokrytie miest, ktoré doteraz chýbali, mriežka jadra USA.
import test from 'node:test';
import assert from 'node:assert/strict';

import { ORIGINAL_WINDOW, WORLD_TILES_COARSE, WORLD_TILES_FINE, grid } from './worldTiles.mjs';

const area = ([S, W, N, E]) => (N - S) * (E - W);
const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
const inside = ([S, W, N, E], lon, lat) => lat >= S && lat <= N && lon >= W && lon <= E;

test('grid: dlaždice bez medzier a presahov', () => {
  const g = grid(24, 56, -128, -64, 8, 16);
  assert.equal(g.length, 16);
  assert.equal(g.reduce((s, t) => s + area(t), 0), (56 - 24) * (128 - 64));
  assert.deepEqual(g[0], [24, -128, 32, -112]);
});

for (const [name, tiles] of [['COARSE', WORLD_TILES_COARSE], ['FINE', WORLD_TILES_FINE]]) {
  test(`${name}: neprekrývajú sa so starým oknom ani navzájom, zdieľajú len okraje`, () => {
    for (const t of tiles) {
      assert.ok(t[0] < t[2] && t[1] < t[3], `${t} je platný obdĺžnik`);
      assert.ok(t[1] >= -180 && t[3] <= 180 && t[0] >= -90 && t[2] <= 90, `${t} v rozsahu`);
      assert.equal(overlap(t, ORIGINAL_WINDOW), 0, `${t} zasahuje do pôvodného okna`);
    }
    for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) assert.equal(overlap(tiles[i], tiles[j]), 0, `${tiles[i]} × ${tiles[j]}`);
  });

  test(`${name}: pokrýva miesta, ktoré doteraz chýbali`, () => {
    const places = {
      'Houston': [-95.4, 29.8], 'Chicago': [-87.6, 41.9], 'Kalifornia': [-119.4, 36.8], 'Alberta (ropné piesky)': [-111.4, 57.0],
      'Mexiko (mesto)': [-99.1, 19.4], 'Panama': [-79.5, 9.0], 'São Paulo': [-46.6, -23.5], 'Buenos Aires': [-58.4, -34.6],
      'Island': [-21.9, 64.1], 'Kanárske ostrovy': [-15.4, 28.1], 'Dakar': [-17.4, 14.7], 'Johannesburg': [28.0, -26.2],
      'Jakarta': [106.8, -6.2], 'Sydney': [151.2, -33.9], 'Auckland': [174.8, -36.8], 'Luanda': [13.2, -8.8],
    };
    for (const [place, [lon, lat]] of Object.entries(places)) {
      assert.ok(tiles.some((t) => inside(t, lon, lat)), `${place} (${lon}, ${lat})`);
    }
  });
}
