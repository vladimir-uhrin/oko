// src/globeLighting.test.mjs
// Deň/noc na glóbuse — Flightradar-style terminátor (2026-09-05).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LIGHTING_FADE_OUT_M,
  LIGHTING_FADE_IN_M,
  GLOBE_RADIUS_M,
  lightingFadeDistancesFromCentre,
  lightingFadeFactor,
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
  assert.equal(scene.globe.lightingFadeOutDistance, GLOBE_RADIUS_M + LIGHTING_FADE_OUT_M);
  assert.equal(scene.globe.lightingFadeInDistance, GLOBE_RADIUS_M + LIGHTING_FADE_IN_M);
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
  assert.equal(scene.globe.lightingFadeOutDistance, GLOBE_RADIUS_M + LIGHTING_FADE_OUT_M, 'ladenie sa píše aj pri vypnutí');
  assert.equal(isGlobeLightingEnabled(scene), false);
});

test('deň/noc: ladenie — pod 1 500 km vypnuté (mesto vo dne), od 4 000 km naplno (terminátor pri pohľade na svet)', () => {
  assert.ok(LIGHTING_FADE_OUT_M < LIGHTING_FADE_IN_M, 'fade-out pod fade-in, inak Cesium prelína naopak');
  assert.ok(LIGHTING_FADE_OUT_M >= 1_000_000, 'mestský pohľad (stovky km) musí ostať neosvetlený');
  assert.ok(LIGHTING_FADE_IN_M <= 6_000_000, 'bežný pohľad na svet (12–13 000 km) musí byť plne osvetlený');
});

test('deň/noc: na glóbus idú vzdialenosti OD STREDU ZEME — inak fade nikdy nenastane', () => {
  // Cesium v 3D meria lightingFade* od stredu (GlobeFS: length(czm_view[3]));
  // holé výšky 1,5/4 Mm sú pod polomerom, takže osvetlenie bolo naplno aj pri
  // 700 km a mesto v noci bolo tmavé (2026-09-04 „tmavá mapa", zmerané 09-06).
  const { fadeOut, fadeIn } = lightingFadeDistancesFromCentre();
  assert.ok(fadeOut > GLOBE_RADIUS_M, 'fade-out musí byť nad polomerom Zeme');
  assert.ok(fadeIn > fadeOut);
  assert.equal(fadeOut - GLOBE_RADIUS_M, LIGHTING_FADE_OUT_M, 'výšky ostávajú jazykom návrhu');
  assert.ok(Math.abs(GLOBE_RADIUS_M - 6_378_137) < 1, 'WGS84 rovníkový polomer');
  const scene = makeScene();
  applyGlobeLighting(scene, true);
  assert.ok(scene.globe.lightingFadeOutDistance > 6_000_000, 'na glóbus sa píše hodnota od stredu');
});

test('deň/noc: lightingFadeFactor kopíruje shader — 0 pod fade-out, 1 od fade-in, lineárne medzi', () => {
  assert.equal(lightingFadeFactor(800_000), 0, 'mesto: bez osvetlenia');
  assert.equal(lightingFadeFactor(LIGHTING_FADE_OUT_M), 0);
  assert.equal(lightingFadeFactor(12_000_000), 1, 'pohľad na svet: naplno');
  assert.equal(lightingFadeFactor(LIGHTING_FADE_IN_M), 1);
  const mid = (LIGHTING_FADE_OUT_M + LIGHTING_FADE_IN_M) / 2;
  assert.ok(Math.abs(lightingFadeFactor(mid) - 0.5) < 1e-9);
  assert.equal(lightingFadeFactor(NaN), 1, 'neznáma výška = pohľad na svet, nie zhasnuté');
  assert.equal(lightingFadeFactor(undefined), 1);
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
  assert.match(i18n, /'pp\.daynight-title': 'Day\/night — real sun lighting on the globe \(terminator\) and night shading on Google 3D'/);
  assert.match(i18n, /'pp\.daynight-title': 'Deň\/noc — skutočné osvetlenie glóbusu Slnkom \(terminátor\) aj zotmenie Google 3D'/);
});

test('deň/noc rozsvieti aj mestá — svetlá sú viazané na ten istý prepínač', () => {
  // Väzba nie je štýlová voľba: shader glóbusu mieša dayAlpha/nightAlpha pod
  // `#if defined(APPLY_DAY_NIGHT_ALPHA) && defined(ENABLE_DAYNIGHT_SHADING)`,
  // a druhá podmienka je práve `globe.enableLighting`. Nočné svetlá bez
  // terminátora by teda prekryli aj dennú stranu — preto ich smie zapínať
  // JEDINE prepínač Deň/noc, nikdy vlastný chip.
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  assert.match(
    ui,
    /_setDayNightEnabled\(enabled\) \{[\s\S]{0,900}?setNightLightsEnabled\?\.\(this\._dayNightEnabled\)/,
    'nočné svetlá musia ísť z _setDayNightEnabled',
  );

  // Vrstvu vlastní mapStackController (musí prežiť prepnutie podkladu) —
  // ui.js si ju nesmie pridávať do scény sám.
  assert.doesNotMatch(ui, /createNightLightsProvider/, 'ui.js nestavia imagery provider');
});

test('deň/noc: hodiny scény bežia v reálnom čase a osvetlený glóbus si žiada snímok každú minútu', async () => {
  // Viewer štartuje so shouldAnimate=false → currentTime zamrzne na čase
  // načítania a Slnko s ním (namerané: 59 min driftu = 15° dĺžky).
  const { installDayNightClock, DAY_NIGHT_TICK_MS } = await import('./globeLighting.js');
  const Cesium = await import('cesium');
  let tick = null;
  let cleared = null;
  const requests = [];
  const viewer = { clock: { shouldAnimate: false, clockStep: 0, multiplier: 60 }, scene: { globe: { enableLighting: false } } };
  const stop = installDayNightClock(viewer, {
    requestRender: (reason) => requests.push(reason),
    setIntervalImpl: (fn, ms) => { tick = fn; assert.equal(ms, DAY_NIGHT_TICK_MS); return 7; },
    clearIntervalImpl: (id) => { cleared = id; },
  });
  assert.equal(viewer.clock.clockStep, Cesium.ClockStep.SYSTEM_CLOCK, 'currentTime = systémový čas pri každom ticku');
  assert.equal(viewer.clock.shouldAnimate, true);
  assert.equal(viewer.clock.multiplier, 1);
  assert.ok(DAY_NIGHT_TICK_MS >= 30_000 && DAY_NIGHT_TICK_MS <= 120_000, 'terminátor lezie 0,25°/min — minútový tik stačí');

  tick();
  assert.deepEqual(requests, [], 'bez osvetlenia žiadny snímok navyše');
  viewer.scene.globe.enableLighting = true;
  tick();
  assert.deepEqual(requests, ['day-night-tick']);
  stop();
  assert.equal(cleared, 7);
  assert.equal(installDayNightClock(null), null);
  assert.equal(installDayNightClock({}), null);

  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /installDayNightClock\(viewer, \{ requestRender: governorRequestRender \}\)/, 'main.js púšťa hodiny pri štarte');
});
