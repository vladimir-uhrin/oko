// src/windParticles.test.mjs
// GPU častice vetra (2026-09-08) — čisté pomôcky, shader tripwires, stub bez WebGL2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activeParticleCount, densityForHeight, trailFadeForHeight, TRAIL_FADE_NEAR, WIND_TRAIL_FADE, speedScaleForRange, DENSITY_FAR_M, DENSITY_NEAR_M, DENSITY_MIN, WIND_BASE_RANGE_TOP, createWindParticles, matricesDiffer, maxSegmentMetres, particleTextureSize, sceneModeCode, simSecondsPerFrame, spawnRectChanged, spawnRectFromView, WIND_PARTICLE_COUNT_DEFAULT } from './windParticles.js';

test('rozmer stavovej textúry a detekcia pohybu kamery', () => {
  assert.equal(particleTextureSize(WIND_PARTICLE_COUNT_DEFAULT), 222, '49 152 častíc — hustá sieť (Windy pass 17-09: „veľmi slabé")');
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
  // `flat` je v GLSL rezervované slovo (kvalifikátor) — shader sa s ním nezostavil a častice ticho zmizli (2026-09-08).
  assert.ok(!/bool flat =/.test(src), 'žiadny identifikátor flat v GLSL');
  assert.match(src, /float vis = isFlat \? 1\.0 : visible\(pNow\) \* visible\(pPrev\);\s*float ok = vis \* \(distance\(pNow, pPrev\) < u_max_seg_m \? 1\.0 : 0\.0\);/, 'oba konce viditeľné (na plátne vždy), respawn sa nekreslí');
  assert.ok(!src.includes('gl.POINTS'), 'žiadne body');
  assert.match(src, /export const WIND_SCREEN_SCALE = 0\.75;/, 'stopy v menšej textúre s LINEAR filtrom = mäkké (0,75 = ostrejšie, Windy pass)');
  assert.match(src, /screenA = texture\(gl, gl\.LINEAR, empty, sw, sh\);/);
  assert.match(src, /if \(v_vis < 0\.5\) discard;/);
  assert.match(src, /vec2 wuv = vec2\(fract\(\(lon \+ 360\.0\) \/ 360\.0\), \(90\.0 - lat\) \/ 180\.0\);/, 'vzorkovanie GFS mriežky (0° E prvý stĺpec, 90° N prvý riadok)');
  assert.match(src, /vec2 pos = vec2\(color\.r \/ 255\.0 \+ color\.b, color\.g \/ 255\.0 \+ color\.a\);/, '16-bit lon/lat v RGBA8');
  assert.match(src, /random_pos = vec2\(r\.x, \(degrees\(asin\(r\.y \* 2\.0 - 1\.0\)\) \+ 90\.0\) \/ 180\.0\);/, 'rovnomerné zrodenie po guli (celý svet)');
  assert.match(src, /getContext\('webgl2'/, 'vlastný WebGL2 kontext, nie Cesium');
  // Plynulosť: RK2 (vietor v strede kroku), zrod vo výreze, jas podľa vetra, rýchlosť podľa výšky.
  assert.match(src, /vec2 mid = advance\(pos, w1, u_dt \* 0\.5\);\s*vec2 w = windAt\(mid\);/, 'RK2');
  assert.match(src, /uniform vec4 u_spawn;/);
  assert.match(src, /o = vec4\(mix\(c\.rgb, vec3\(1\.0\), 0\.05\), 0\.35 \+ 0\.65 \* v_speed_t\);/, 'Windy pass: sýta rampa, alfa 0,35 + 0,65 × rýchlosť');
  assert.match(src, /simSecondsPerFrame\(cam\.height\)/);
  assert.match(src, /gl\.drawArrays\(gl\.LINES, 0, active \* 2\);/);
  // Plátno (2D) aj Columbus: projekcia (0, lon·R, lat·R) resp. Mercator, bez okluzie; morph = prázdne plátno.
  assert.match(src, /vec3 pNow = isFlat \? projected\(posNow\) : ecef\(posNow\);/, 'plátno používa projekciu Cesia namiesto ECEF');
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

test('zrod vo výreze: okraj 15 %, celá guľa pri > polovici sveta alebo bez obdĺžnika; šev ±180°; zmena výrezu', () => {
  const g = spawnRectFromView(null);
  assert.equal(g.global, true);
  const eu = spawnRectFromView({ west: 5, south: 40, east: 25, north: 55 });
  assert.equal(eu.global, false);
  assert.ok(Math.abs(eu.west - 2) < 1e-9 && Math.abs(eu.width - 26) < 1e-9, 'okraj 15 % šírky');
  assert.ok(Math.abs(eu.south - 37.75) < 1e-9 && Math.abs(eu.height - 19.5) < 1e-9);
  assert.ok(eu.areaFraction > 0.004 && eu.areaFraction < 0.005);
  assert.equal(spawnRectFromView({ west: -170, south: -80, east: 170, north: 80 }).global, true, 'skoro celý svet');
  const seam = spawnRectFromView({ west: 170, south: -10, east: -170, north: 10 });
  assert.equal(seam.global, false);
  assert.ok(Math.abs(seam.width - 26) < 1e-9, 'cez šev: šírka 20° + 2 × 15 % okraj');
  assert.equal(spawnRectChanged(eu, eu), false);
  assert.equal(spawnRectChanged(eu, spawnRectFromView({ west: 30, south: 40, east: 50, north: 55 })), true, 'posun o celú šírku');
  assert.equal(spawnRectChanged(eu, g), true);
});

test('rýchlosť podľa výšky (~1 px/snímok pri 10 m/s) a počet aktívnych častíc podľa výrezu', () => {
  assert.equal(simSecondsPerFrame(8_000_000), 960);
  assert.equal(simSecondsPerFrame(400_000), 48);
  assert.equal(simSecondsPerFrame(50_000), 30, 'spodná hranica');
  assert.equal(simSecondsPerFrame(25_000_000), 1500, 'horná hranica');
  assert.equal(simSecondsPerFrame(NaN), 1500);
  assert.equal(activeParticleCount(49152, 1), 49152);
  assert.equal(activeParticleCount(49152, 0.5), 49152);
  assert.equal(activeParticleCount(49152, 0.1), Math.round(49152 * Math.sqrt(0.2)));
  assert.equal(activeParticleCount(49152, 0.001), Math.round(49152 * 0.12), 'dno 12 %');
});

test('hranica úsečky podľa kroku: 60 m/s × dt × 3, dno 2 km, strop 300 km — inak „teleporty" cez obrazovku pri priblížení', () => {
  assert.equal(maxSegmentMetres(58), 60 * 58 * 3);
  assert.equal(maxSegmentMetres(5), 2_000);
  assert.equal(maxSegmentMetres(1500), 270_000);
  assert.equal(maxSegmentMetres(5000), 300_000);
  assert.equal(maxSegmentMetres(NaN), 270_000);
  const src = readFileSync(new URL('./windParticles.js', import.meta.url), 'utf8');
  assert.ok(src.includes('gl.uniform1f(progDraw.uniforms.u_max_seg_m, maxSegmentMetres(simDt));'), 'hranica z aktuálneho kroku, nie konštanta');
});

test('slučka: dtFrame je deklarovaný pred prvým použitím (TDZ chyba 2026-09-09 zabila prúdnice)', () => {
  const src = readFileSync(new URL('./windParticles.js', import.meta.url), 'utf8');
  const decl = src.indexOf('const dtFrame = lastTime');
  // Hľadá sa DEKLARÁCIA simDt, nie presné znenie výrazu — tripwire má strážiť
  // poradie, nie to, čo všetko sa do simDt násobí (2026-09-21 tam pribudlo
  // spomalenie podľa hladiny a doslovná zhoda by padla bez skutočnej chyby).
  const use = src.indexOf('const simDt =');
  assert.ok(decl > 0 && use > 0 && decl < use, 'dtFrame deklarovaný pred simDt');
  assert.match(src.slice(use, use + 200), /dtFrame/, 'simDt naozaj používa dtFrame');
});

test('hustota podľa výšky kamery: plná pri planéte, výrazne menej pri priblížení', () => {
  // Používateľ 2026-09-21: „strašne veľa prúdnic… pri zazoomovaní je to úplne biele."
  // Podiel plochy to nerieši — častice žijú len v zábere, takže po priblížení sa
  // ten istý počet stlačí na tú istú obrazovku.
  assert.equal(densityForHeight(12_000_000), 1, 'pohľad na planétu = plná hustota');
  assert.equal(densityForHeight(DENSITY_FAR_M), 1);
  assert.equal(densityForHeight(DENSITY_NEAR_M), DENSITY_MIN);
  assert.equal(densityForHeight(10_000), DENSITY_MIN, 'pod prahom už neklesá');
  assert.ok(densityForHeight(1_000_000) < 0.6 && densityForHeight(1_000_000) > DENSITY_MIN, 'medzi tým plynulo');
  assert.ok(densityForHeight(300_000) < densityForHeight(1_000_000), 'monotónne klesá');
  assert.equal(densityForHeight(NaN), 1, 'neznáma výška nič neuberá');
});

test('spomalenie podľa hladiny: jet je rýchlejší, ale nelieta cez obrazovku', () => {
  assert.equal(speedScaleForRange(WIND_BASE_RANGE_TOP), 1, 'prízemný vietor sa nespomaľuje');
  assert.ok(speedScaleForRange(130) < 1, '250/200 hPa sa spomalí');
  assert.ok(speedScaleForRange(130) > 0.5, 'ale nie na polovicu — jet MÁ vyzerať rýchlejšie');
  assert.ok(speedScaleForRange(130) < speedScaleForRange(90), 'širší rozsah = väčšie spomalenie');
  assert.equal(speedScaleForRange(30), 1, 'užší rozsah než prízemný nezrýchľuje');
  assert.equal(speedScaleForRange(NaN), 1);
});

test('dĺžka stopy podľa výšky: dlhá pri planéte, krátka zblízka', () => {
  // V malej oblasti fúka všade rovnako, takže dlhé stopy sa zlejú do statického
  // hrebeňa rovnobežných čiar — presne to používateľ videl ako „úplne biele".
  assert.equal(trailFadeForHeight(12_000_000), WIND_TRAIL_FADE);
  assert.equal(trailFadeForHeight(DENSITY_FAR_M), WIND_TRAIL_FADE);
  assert.equal(trailFadeForHeight(DENSITY_NEAR_M), TRAIL_FADE_NEAR);
  assert.ok(trailFadeForHeight(250_000) < WIND_TRAIL_FADE, 'zblízka kratšia stopa');
  assert.ok(trailFadeForHeight(250_000) >= TRAIL_FADE_NEAR);
  assert.ok(trailFadeForHeight(400_000) > trailFadeForHeight(250_000), 'monotónne');
  assert.equal(trailFadeForHeight(NaN), WIND_TRAIL_FADE, 'neznáma výška nič nemení');
});
