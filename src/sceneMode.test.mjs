// src/sceneMode.test.mjs
// Guľa / plátno — morph scény na 2D Mercator a späť (2026-09-05).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import { SCENE_MORPH_S, MORPH_HOLD_GRACE_MS, applySceneMode, currentSceneMode } from './sceneMode.js';
import { _resetRenderGovernorForTest } from './renderGovernor.js';

function makeScene(mode = Cesium.SceneMode.SCENE3D) {
  const listeners = new Set();
  const scene = {
    mode,
    calls: [],
    morphComplete: {
      addEventListener(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      fire() { for (const fn of [...listeners]) fn(); },
      size() { return listeners.size; },
    },
    morphTo2D(d) { this.calls.push(['2d', d]); this.mode = Cesium.SceneMode.MORPHING; },
    morphTo3D(d) { this.calls.push(['3d', d]); this.mode = Cesium.SceneMode.MORPHING; },
    completeMorph() { this.calls.push(['complete']); this.mode = this.calls.some(c => c[0] === '2d') ? Cesium.SceneMode.SCENE2D : Cesium.SceneMode.SCENE3D; },
    requestRender() { this.calls.push(['render']); },
  };
  return scene;
}

test('plátno: currentSceneMode mapuje Cesium režimy na reťazce', () => {
  assert.equal(currentSceneMode({ mode: Cesium.SceneMode.SCENE3D }), 'globe');
  assert.equal(currentSceneMode({ mode: Cesium.SceneMode.SCENE2D }), 'flat');
  assert.equal(currentSceneMode({ mode: Cesium.SceneMode.COLUMBUS_VIEW }), 'columbus');
  assert.equal(currentSceneMode({ mode: Cesium.SceneMode.MORPHING }), 'morphing');
  assert.equal(currentSceneMode(null), 'unknown');
});

test('plátno: morph na 2D drží render, uvoľní sa na morphComplete a odpojí poslucháča', () => {
  _resetRenderGovernorForTest();
  const scene = makeScene();
  const timers = [];
  assert.equal(applySceneMode(scene, true, { setTimeoutImpl: (fn, ms) => timers.push([fn, ms]) }), true);
  assert.deepEqual(scene.calls[0], ['2d', SCENE_MORPH_S], 'morphTo2D s default trvaním');
  assert.equal(scene.morphComplete.size(), 1, 'poslucháč morphComplete je zavesený');
  assert.equal(timers.length, 1, 'záložný časovač proti úniku holdu');
  assert.equal(timers[0][1], SCENE_MORPH_S * 1000 + MORPH_HOLD_GRACE_MS);
  scene.morphComplete.fire();
  assert.equal(scene.morphComplete.size(), 0, 'po dokončení sa poslucháč odpojí');
  assert.ok(scene.calls.some(c => c[0] === 'render'), 'po morfe si vyžiada frame');
  // Záložný časovač po udalosti už nič nerobí (idempotentné uvoľnenie).
  const before = scene.calls.length;
  timers[0][0]();
  assert.equal(scene.calls.length, before, 'druhé uvoľnenie je no-op');
  _resetRenderGovernorForTest();
});

test('plátno: trvanie 0 = okamžitý completeMorph, späť na guľu cez morphTo3D', () => {
  _resetRenderGovernorForTest();
  const scene = makeScene();
  assert.equal(applySceneMode(scene, true, { durationS: 0 }), true);
  assert.deepEqual(scene.calls.slice(0, 2), [['2d', 0], ['complete']]);
  assert.equal(scene.mode, Cesium.SceneMode.SCENE2D);
  assert.equal(applySceneMode(scene, false, { durationS: 0 }), true);
  assert.equal(scene.calls.filter(c => c[0] === '3d').length, 1, 'návrat ide cez morphTo3D');
  _resetRenderGovernorForTest();
});

test('plátno: už v cieľovom režime = žiadny morph; bez scény = false', () => {
  _resetRenderGovernorForTest();
  const scene = makeScene(Cesium.SceneMode.SCENE2D);
  assert.equal(applySceneMode(scene, true), true);
  assert.equal(scene.calls.length, 0, 'nič sa nespustí');
  assert.equal(applySceneMode(null, true), false);
  assert.equal(applySceneMode({ mode: 0 }, true), false, 'scéna bez morphTo* je odmietnutá');
  _resetRenderGovernorForTest();
});

test('plátno: tripwire — tlačidlo default OFF, ui.js wiring, i18n EN+SK, guardy v iconOrientation', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /class="pp-toggle-btn" id="flatmap-toggle" aria-pressed="false"/, 'guľa je default — tlačidlo štartuje vypnuté');
  assert.match(html, /data-i18n="pp\.flatmap-label"/);
  assert.match(html, /material-symbols-outlined[^>]*>map</, 'monochromatická ikona');

  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  assert.match(ui, /import \{ applySceneMode \} from '\.\/sceneMode\.js';/);
  assert.match(ui, /this\._flatMapEnabled = false;/, 'default OFF v ui.js sedí s markupom');
  assert.match(ui, /this\._initFlatMapToggle\(\);/);
  assert.match(ui, /applySceneMode\(this\.viewer\?\.scene, this\._flatMapEnabled\)/, 'klik ide cez sceneMode.js');
  assert.doesNotMatch(ui, /localStorage[^\n]*[fF]latMap/, 'session-only');

  const i18n = readFileSync(new URL('./i18nStrings.js', import.meta.url), 'utf8');
  assert.match(i18n, /'pp\.flatmap-label': 'Flat map'/);
  assert.match(i18n, /'pp\.flatmap-label': 'Plátno'/);

  // Tri 3D predpoklady majú guard — bez nich plátno zhodí renderer.
  const orient = readFileSync(new URL('./data/iconOrientation.js', import.meta.url), 'utf8');
  assert.match(orient, /if \(isFlatScene\(scene\)\) return -Cesium\.Math\.toRadians\(courseDeg \|\| 0\);/, 'rotácia = kurz v plátne');
  assert.match(orient, /if \(isFlatCamera\(camera\)\) return _flatOccluder;/, 'horizontový cull vypnutý v plátne');
  assert.match(orient, /Number\.isFinite\(v\) \? v\.toFixed\(3\) : '-'/, 'podpis pózy prežije undefined uhly');
});

// ── Popisky v plátne: jemnejší screen-space error, návrat na guli (2026-09-05) ─
import { FLAT_MAP_SCREEN_SPACE_ERROR } from './sceneMode.js';

test('plátno: SSE glóbusu ide na 1 v plátne a vráti sa na pôvodnú hodnotu na guli', () => {
  _resetRenderGovernorForTest();
  const scene = makeScene();
  scene.globe = { maximumScreenSpaceError: 2 };
  applySceneMode(scene, true, { durationS: 0 });
  assert.equal(scene.globe.maximumScreenSpaceError, FLAT_MAP_SCREEN_SPACE_ERROR, 'v plátne jemnejšie dlaždice = menšie popisky');
  applySceneMode(scene, true, { durationS: 0 }); // no-op, nesmie prepísať uloženú hodnotu
  applySceneMode(scene, false, { durationS: 0 });
  assert.equal(scene.globe.maximumScreenSpaceError, 2, 'na guli pôvodná hodnota');
  // Bez glóbusu (mock) sa nič nedeje.
  const bare = makeScene();
  assert.doesNotThrow(() => applySceneMode(bare, true, { durationS: 0 }));
  _resetRenderGovernorForTest();
});
