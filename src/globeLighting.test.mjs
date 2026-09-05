// src/globeLighting.test.mjs
// Deň/noc na glóbuse — Flightradar-style terminátor (2026-09-05).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LIGHTING_FADE_OUT_M,
  LIGHTING_FADE_IN_M,
  applyGlobeLighting,
  isGlobeLightingEnabled,
} from './globeLighting.js';

function makeScene({ withDynamicAtmo = true } = {}) {
  const globe = { enableLighting: false, lightingFadeOutDistance: 0, lightingFadeInDistance: 0 };
  if (withDynamicAtmo) {
    globe.dynamicAtmosphereLighting = false;
    globe.dynamicAtmosphereLightingFromSun = false;
  }
  const scene = { globe, renders: 0, requestRender() { this.renders += 1; } };
  return scene;
}

test('deň/noc: zapnutie nastaví osvetlenie, prelínanie vzdialeností aj atmosféru podľa Slnka', () => {
  const scene = makeScene();
  assert.equal(applyGlobeLighting(scene, true), true);
  assert.equal(scene.globe.enableLighting, true);
  assert.equal(scene.globe.lightingFadeOutDistance, LIGHTING_FADE_OUT_M);
  assert.equal(scene.globe.lightingFadeInDistance, LIGHTING_FADE_IN_M);
  assert.equal(scene.globe.dynamicAtmosphereLighting, true);
  assert.equal(scene.globe.dynamicAtmosphereLightingFromSun, true);
  assert.equal(scene.renders, 1, 'zmena scény si vyžiada frame (render governor)');
  assert.equal(isGlobeLightingEnabled(scene), true);
});

test('deň/noc: vypnutie zhasne osvetlenie aj atmosféru, vzdialenosti ostávajú deterministické', () => {
  const scene = makeScene();
  applyGlobeLighting(scene, true);
  scene.globe.lightingFadeOutDistance = 123; // cudzia hodnota — nesmie prežiť
  assert.equal(applyGlobeLighting(scene, false), false);
  assert.equal(scene.globe.enableLighting, false);
  assert.equal(scene.globe.dynamicAtmosphereLighting, false);
  assert.equal(scene.globe.dynamicAtmosphereLightingFromSun, false);
  assert.equal(scene.globe.lightingFadeOutDistance, LIGHTING_FADE_OUT_M, 'ladenie sa píše aj pri vypnutí');
  assert.equal(isGlobeLightingEnabled(scene), false);
});

test('deň/noc: ladenie — pod 1 500 km vypnuté (mesto vo dne), od 4 000 km naplno (terminátor pri pohľade na svet)', () => {
  assert.ok(LIGHTING_FADE_OUT_M < LIGHTING_FADE_IN_M, 'fade-out pod fade-in, inak Cesium prelína naopak');
  assert.ok(LIGHTING_FADE_OUT_M >= 1_000_000, 'mestský pohľad (stovky km) musí ostať neosvetlený');
  assert.ok(LIGHTING_FADE_IN_M <= 6_000_000, 'bežný pohľad na svet (12–13 000 km) musí byť plne osvetlený');
});

test('deň/noc: bezpečné bez glóbusu a bez atmosférových vlastností (mock/staršie scény)', () => {
  assert.equal(applyGlobeLighting(null, true), false);
  assert.equal(applyGlobeLighting({}, true), false);
  assert.equal(isGlobeLightingEnabled(null), false);
  const scene = makeScene({ withDynamicAtmo: false });
  assert.equal(applyGlobeLighting(scene, true), true);
  assert.equal(scene.globe.enableLighting, true);
  assert.equal('dynamicAtmosphereLighting' in scene.globe, false, 'nepridáva vlastnosti, ktoré scéna nemá');
  assert.equal(scene.renders, 1);
});

test('deň/noc: tripwire — tlačidlo v lište (default ON), ui.js wiring, i18n EN+SK', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="daynight-toggle"[^>]*aria-pressed="true"/, 'tlačidlo štartuje zapnuté (markup nesie default)');
  assert.match(html, /class="pp-toggle-btn active" id="daynight-toggle"/, 'svieti od štartu ako 3D a priezor');
  assert.match(html, /data-i18n-title="pp\.daynight-title"/);
  assert.match(html, /data-i18n="pp\.daynight-label"/);
  assert.match(html, /material-symbols-outlined[^>]*>wb_twilight</, 'monochromatická ikona, nie emoji');

  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  assert.match(ui, /import \{ applyGlobeLighting \} from '\.\/globeLighting\.js';/, 'jediný zapisovač je globeLighting.js');
  assert.match(ui, /this\._dayNightEnabled = true;/, 'default ON v ui.js sedí s markupom');
  assert.match(ui, /this\._initDayNightToggle\(\);/, 'prepínač sa inicializuje pri štarte');
  assert.match(ui, /applyGlobeLighting\(this\.viewer\?\.scene, this\._dayNightEnabled\)/, 'klik ide cez applyGlobeLighting');
  assert.match(ui, /this\._dayNightBtn\?\.setAttribute\('aria-pressed', String\(this\._dayNightEnabled\)\)/, 'aria-pressed pre čítačku');
  assert.doesNotMatch(ui, /localStorage[^\n]*[dD]ayNight/, 'session-only — bez uloženia, ako priezor');

  const i18n = readFileSync(new URL('./i18nStrings.js', import.meta.url), 'utf8');
  assert.match(i18n, /'pp\.daynight-label': 'Day\/Night'/);
  assert.match(i18n, /'pp\.daynight-label': 'Deň\/noc'/);
  assert.match(i18n, /'pp\.daynight-title': 'Day\/night — real sun lighting on the globe \(terminator\); globe basemaps only'/);
  assert.match(i18n, /'pp\.daynight-title': 'Deň\/noc — skutočné osvetlenie glóbusu Slnkom \(terminátor\); len mapové podklady glóbusu'/);
});
