// src/windParticles.test.mjs
// GPU častice vetra (2026-09-08) — čisté pomôcky, shader tripwires, stub bez WebGL2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWindParticles, matricesDiffer, particleTextureSize, WIND_PARTICLE_COUNT_DEFAULT } from './windParticles.js';

test('rozmer stavovej textúry a detekcia pohybu kamery', () => {
  assert.equal(particleTextureSize(WIND_PARTICLE_COUNT_DEFAULT), 256);
  assert.equal(particleTextureSize(10_000), 100);
  assert.equal(particleTextureSize(1), 16, 'minimum 16 × 16');
  const a = new Float32Array(16).fill(1);
  const b = Float32Array.from(a);
  assert.equal(matricesDiffer(a, b), false);
  b[5] = 1.001;
  assert.equal(matricesDiffer(a, b), true);
  assert.equal(matricesDiffer(null, b), true);
});

test('bez WebGL2 vráti stub (plátno sa odstráni, isSupported=false, metódy sú no-op)', () => {
  const removed = [];
  const canvas = { className: '', hidden: false, setAttribute() {}, getContext: () => null, remove() { removed.push('canvas'); } };
  const doc = { createElement: () => canvas };
  const container = { ownerDocument: doc, appendChild() {}, clientWidth: 800, clientHeight: 600 };
  const p = createWindParticles(container, { scene: {} });
  assert.equal(p.isSupported(), false);
  assert.deepEqual(removed, ['canvas']);
  p.setWind({}, {}); p.start(); p.stop(); p.destroy();
  assert.equal(p.getState().count, 0);
});

test('shadery: WGS84 ECEF, zahodenie odvrátenej pologule, GFS mriežka 0..360° so severom hore, 16-bit poloha', () => {
  const src = readFileSync(new URL('./windParticles.js', import.meta.url), 'utf8');
  assert.match(src, /const float A = 6378137\.0;\s*const float B = 6356752\.314245;/, 'WGS84 poloosi v shaderi');
  assert.match(src, /v_vis = dot\(n, normalize\(toCam\)\) > 0\.02 \? 1\.0 : 0\.0;/, 'okluzia skalárnym súčinom normály a smeru ku kamere');
  assert.match(src, /if \(v_vis < 0\.5\) discard;/);
  assert.match(src, /vec2 wuv = vec2\(fract\(\(lon \+ 360\.0\) \/ 360\.0\), \(90\.0 - lat\) \/ 180\.0\);/, 'vzorkovanie GFS mriežky (0° E prvý stĺpec, 90° N prvý riadok)');
  assert.match(src, /vec2 pos = vec2\(color\.r \/ 255\.0 \+ color\.b, color\.g \/ 255\.0 \+ color\.a\);/, '16-bit lon/lat v RGBA8');
  assert.match(src, /random_pos\.y = \(degrees\(asin\(random_pos\.y \* 2\.0 - 1\.0\)\) \+ 90\.0\) \/ 180\.0;/, 'rovnomerné zrodenie po guli');
  assert.match(src, /getContext\('webgl2'/, 'vlastný WebGL2 kontext, nie Cesium');
  assert.match(src, /scene\.mode !== globalThis\.Cesium\.SceneMode\.SCENE3D/, '2D režim = bez častíc');
});
