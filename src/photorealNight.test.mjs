// src/photorealNight.test.mjs
// Deň/noc na Google 3D fotoreáli cez customShader (2026-09-06, „áno sprav").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  PHOTOREAL_NIGHT_FLOOR,
  PHOTOREAL_NIGHT_FRAGMENT,
  PHOTOREAL_NIGHT_LIGHTS_CUTOFF,
  PHOTOREAL_NIGHT_TEXTURE_URL,
  applyPhotorealNight,
  buildPhotorealNightShader,
  hasPhotorealNight,
} from './photorealNight.js';

test('fragment shader: normála zo svetovej polohy, Slnko cez czm_sunDirectionWC, ten istý vzorec ako glóbus', () => {
  assert.match(PHOTOREAL_NIGHT_FRAGMENT, /fsInput\.attributes\.positionWC/, 'Cesium dodá positionWC len keď ho shader menuje');
  assert.match(PHOTOREAL_NIGHT_FRAGMENT, /czm_sunDirectionWC/);
  assert.match(PHOTOREAL_NIGHT_FRAGMENT, /lambert \* 5\.0 \+ u_nightFloor/, 'rovnaká krivka ako GlobeFS (lambert*5+floor)');
  assert.match(PHOTOREAL_NIGHT_FRAGMENT, /texture\(u_nightLights, uv\)/);
  // Rovnobežková textúra: u z dĺžky (atan), v zo šírky (asin), obe do 0..1.
  assert.match(PHOTOREAL_NIGHT_FRAGMENT, /atan\(p\.y, p\.x\)/);
  assert.match(PHOTOREAL_NIGHT_FRAGMENT, /lon \/ \(2\.0 \* czm_pi\) \+ 0\.5, lat \/ czm_pi \+ 0\.5/);
  assert.match(PHOTOREAL_NIGHT_FRAGMENT, /material\.diffuse \* daylight \* tint \+ lights \* warm \* gain \* nightBlend/, 'svetlá sa pripočítavajú len na nočnej strane');
  assert.ok(PHOTOREAL_NIGHT_FLOOR >= 0.08 && PHOTOREAL_NIGHT_FLOOR <= 0.2, 'noc má byť noc (0,28 bolo „slabé"); čitateľnosť dávajú svetlá');
  assert.ok(PHOTOREAL_NIGHT_LIGHTS_CUTOFF.from >= 0.3 && PHOTOREAL_NIGHT_LIGHTS_CUTOFF.from < 0.39, 'rez začína NAD púštnym leskom (≤ 0,27) a pod svetlami (0,39) — 2026-09-07');
  assert.ok(PHOTOREAL_NIGHT_LIGHTS_CUTOFF.to > PHOTOREAL_NIGHT_LIGHTS_CUTOFF.from && PHOTOREAL_NIGHT_LIGHTS_CUTOFF.to <= 0.55);
});

test('textúra svetiel: GIBS WMS Black Marble ako jeden rovnobežkový obrázok, statický čas, keyless', () => {
  const url = new URL(PHOTOREAL_NIGHT_TEXTURE_URL);
  assert.equal(url.host, 'gibs.earthdata.nasa.gov');
  assert.equal(url.searchParams.get('LAYERS'), 'VIIRS_Black_Marble');
  assert.equal(url.searchParams.get('CRS'), 'EPSG:4326');
  assert.equal(url.searchParams.get('BBOX'), '-90,-180,90,180', 'WMS 1.3.0 + EPSG:4326 = poradie lat,lon');
  assert.equal(url.searchParams.get('WIDTH'), '4096');
  assert.equal(url.searchParams.get('HEIGHT'), '2048');
  assert.match(url.searchParams.get('TIME'), /^\d{4}-\d{2}-\d{2}$/, 'statická kompozícia — pevný dátum, nie včerajšok');
  assert.doesNotMatch(PHOTOREAL_NIGHT_TEXTURE_URL, /key=/i);
});

test('buildPhotorealNightShader: options pre Cesium CustomShader — textúra svetiel, uniformy, fragment', () => {
  // Skutočný CustomShader/TextureUniform sťahuje textúru už v konštruktore
  // (potrebuje document) — v Node sa overujú options, nie WebGL objekt.
  const textures = [];
  let options = null;
  const shader = buildPhotorealNightShader({
    lightsUrl: 'https://example.test/night.jpg',
    textureFactory: (url) => { textures.push(url); return { url }; },
    shaderFactory: (opts) => { options = opts; return { opts }; },
  });
  assert.deepEqual(textures, ['https://example.test/night.jpg']);
  assert.equal(shader.opts, options);
  assert.equal(options.uniforms.u_nightLights.type, Cesium.UniformType.SAMPLER_2D);
  assert.equal(options.uniforms.u_nightLights.value.url, 'https://example.test/night.jpg');
  assert.equal(options.uniforms.u_nightFloor.type, Cesium.UniformType.FLOAT);
  assert.equal(options.uniforms.u_nightFloor.value, PHOTOREAL_NIGHT_FLOOR);
  assert.equal(options.uniforms.u_lightsCutoff.type, Cesium.UniformType.VEC2);
  assert.equal(options.fragmentShaderText, PHOTOREAL_NIGHT_FRAGMENT);
  // Každý uniform z fragmentu je deklarovaný.
  assert.match(PHOTOREAL_NIGHT_FRAGMENT, /czm_viewerPositionWC - p/, 'zosilnenie svetiel podľa vzdialenosti kamery (zblízka len žiara)');
  for (const name of ['u_nightLights', 'u_nightFloor', 'u_lightsGain', 'u_lightsRange', 'u_nightTint', 'u_lightsCutoff']) {
    assert.match(PHOTOREAL_NIGHT_FRAGMENT, new RegExp(name));
    assert.ok(options.uniforms[name], `${name} chýba v uniforms`);
  }
});

test('applyPhotorealNight: jediný zapisovač customShader, recykluje inštanciu, cudzí shader neprepíše', () => {
  let built = 0;
  const factory = () => { built += 1; return { id: built }; };
  const tileset = {};
  assert.equal(applyPhotorealNight(tileset, true, { shaderFactory: factory }), true);
  assert.equal(hasPhotorealNight(tileset), true);
  assert.equal(built, 1);
  assert.equal(applyPhotorealNight(tileset, false, { shaderFactory: factory }), false);
  assert.equal(tileset.customShader, undefined);
  assert.equal(hasPhotorealNight(tileset), false);
  assert.equal(applyPhotorealNight(tileset, true, { shaderFactory: factory }), true);
  assert.equal(built, 1, 'po vypnutí a zapnutí sa shader nestavia znova (textúra ostáva na GPU)');
  // Cudzí shader (napr. iný agent/štýl) sa pri vypnutí nechá tak.
  const foreign = { customShader: { id: 'foreign' }, gevNightShader: { id: 'ours' } };
  applyPhotorealNight(foreign, false, { shaderFactory: factory });
  assert.equal(foreign.customShader.id, 'foreign');
  assert.equal(applyPhotorealNight(null, true), false);
  assert.equal(applyPhotorealNight(undefined, false), false);
});

test('tripwire: controller prepína fotoreálne zotmenie tým istým prepínačom ako svetlá, popis tlačidla to hovorí', () => {
  const controller = readFileSync(new URL('./mapStackController.js', import.meta.url), 'utf8');
  assert.match(controller, /applyPhotorealNight\(this\.googleTileset, /, 'jediný zapisovač volaný z _syncNightLightsLayer');
  const i18n = readFileSync(new URL('./i18nStrings.js', import.meta.url), 'utf8');
  assert.match(i18n, /'pp\.daynight-title': 'Day\/night — real sun lighting on the globe \(terminator\) and night shading on Google 3D'/);
  assert.match(i18n, /'pp\.daynight-title': 'Deň\/noc — skutočné osvetlenie glóbusu Slnkom \(terminátor\) aj zotmenie Google 3D'/);
});
