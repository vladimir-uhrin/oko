// src/windParticles.test.mjs
// GPU častice vetra (2026-09-08) — čisté pomôcky, shader tripwires, stub bez WebGL2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWindParticles, matricesDiffer, particleTextureSize, sceneModeCode, WIND_PARTICLE_COUNT_DEFAULT } from './windParticles.js';

test('rozmer stavovej textúry a detekcia pohybu kamery', () => {
  assert.equal(particleTextureSize(WIND_PARTICLE_COUNT_DEFAULT), 128, '16 384 častíc — jemná sieť (používateľ 09-08: „vybodkované")');
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
  assert.match(src, /return dot\(n, normalize\(toCam\)\) > 0\.02 \? 1\.0 : 0\.0;/, 'okluzia skalárnym súčinom normály a smeru ku kamere');
  // Spojité čiary, nie bodky: úsečka predchádzajúca → aktuálna poloha, oba konce viditeľné, respawn sa nekreslí.
  assert.match(src, /gl\.drawArrays\(gl\.LINES, 0, total \* 2\);/);
  assert.match(src, /float vis = flat \? 1\.0 : visible\(pNow\) \* visible\(pPrev\);\s*float ok = vis \* \(distance\(pNow, pPrev\) < u_max_seg_m \? 1\.0 : 0\.0\);/, 'oba konce viditeľné (na plátne vždy), respawn sa nekreslí');
  assert.ok(!src.includes('gl.POINTS'), 'žiadne body');
  assert.match(src, /export const WIND_SCREEN_SCALE = 0\.55;/, 'stopy v menšej textúre s LINEAR filtrom = mäkké');
  assert.match(src, /screenA = texture\(gl, gl\.LINEAR, empty, sw, sh\);/);
  assert.match(src, /if \(v_vis < 0\.5\) discard;/);
  assert.match(src, /vec2 wuv = vec2\(fract\(\(lon \+ 360\.0\) \/ 360\.0\), \(90\.0 - lat\) \/ 180\.0\);/, 'vzorkovanie GFS mriežky (0° E prvý stĺpec, 90° N prvý riadok)');
  assert.match(src, /vec2 pos = vec2\(color\.r \/ 255\.0 \+ color\.b, color\.g \/ 255\.0 \+ color\.a\);/, '16-bit lon/lat v RGBA8');
  assert.match(src, /random_pos\.y = \(degrees\(asin\(random_pos\.y \* 2\.0 - 1\.0\)\) \+ 90\.0\) \/ 180\.0;/, 'rovnomerné zrodenie po guli');
  assert.match(src, /getContext\('webgl2'/, 'vlastný WebGL2 kontext, nie Cesium');
  // Plátno (2D) aj Columbus: projekcia (0, lon·R, lat·R) resp. Mercator, bez okluzie; morph = prázdne plátno.
  assert.match(src, /vec3 pNow = flat \? projected\(posNow\) : ecef\(posNow\);/, 'plátno používa projekciu Cesia namiesto ECEF');
  assert.match(src, /return vec3\(0\.0, A \* lon, y\);/, 'svet 2D = (0, x, y) projekcie');
  assert.match(src, /gl\.uniform1f\(progDraw\.uniforms\.u_mode, mode\);/);
});

test('sceneModeCode: 3D = 0, plátno geografické = 1, Mercator = 2, morph = −1, bez scény = 0', () => {
  class WebMercatorProjection {}
  const Cesium = { SceneMode: { SCENE3D: 3, SCENE2D: 2, COLUMBUS_VIEW: 1, MORPHING: 0 }, WebMercatorProjection };
  assert.equal(sceneModeCode({ mode: 3 }, Cesium), 0);
  assert.equal(sceneModeCode({ mode: 2, mapProjection: {} }, Cesium), 1);
  assert.equal(sceneModeCode({ mode: 1, mapProjection: new WebMercatorProjection() }, Cesium), 2);
  assert.equal(sceneModeCode({ mode: 0 }, Cesium), -1);
  assert.equal(sceneModeCode(null, Cesium), 0);
});
