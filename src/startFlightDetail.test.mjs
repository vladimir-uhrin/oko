// src/startFlightDetail.test.mjs — hrubšie dlaždice Google 3D počas úvodného preletu (2026-10-16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  START_FLIGHT_CAP_MS, START_FLIGHT_RESTORE_AFTER_MS, START_FLIGHT_SHARPEN_BEFORE_MS, START_FLIGHT_SSE, coarsenTilesDuringStartFlight,
} from './startFlightDetail.js';
import { START_FLY_DURATION_S, START_GLOBE_DWELL_MS } from './camera.js';

/** Udalosť ako Cesium.Event: addEventListener vracia odhlásenie. */
function fakeEvent() {
  const listeners = new Set();
  return {
    addEventListener(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    raise() { for (const fn of [...listeners]) fn(); },
    get count() { return listeners.size; },
  };
}
function harness({ whenReady = Promise.resolve() } = {}) {
  const timers = [];
  const setTimer = (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length; };
  const clearTimer = (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; };
  const camera = { moveStart: fakeEvent(), moveEnd: fakeEvent() };
  const tileset = { maximumScreenSpaceError: 16 };
  const ctl = coarsenTilesDuringStartFlight({ tileset, camera, whenReady, setTimer, clearTimer });
  return { timers, camera, tileset, ctl, pending: () => timers.filter((t) => !t.cleared) };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

test('konštanty: SSE 32 (2× predvolených 16), plný detail 1,5 s pred koncom letu, poistka pauza + let + 3 s', () => {
  assert.equal(START_FLIGHT_SSE, 32);
  assert.equal(START_FLIGHT_SHARPEN_BEFORE_MS, 1500);
  assert.equal(START_FLIGHT_RESTORE_AFTER_MS, START_FLY_DURATION_S * 1000 - 1500);
  assert.equal(START_FLIGHT_CAP_MS, START_GLOBE_DWELL_MS + START_FLY_DURATION_S * 1000 + 3000);
});

test('let: po skrytí úvodnej obrazovky čaká na pohyb kamery, zhrubí, pred pristátím vráti plný detail a všetko odpojí', async () => {
  const h = harness();
  h.camera.moveStart.raise();
  assert.equal(h.tileset.maximumScreenSpaceError, 16, 'pred skrytím úvodnej obrazovky sa nič nedeje');
  await settle();
  assert.equal(h.camera.moveStart.count, 1, 'po skrytí počúva začiatok pohybu');
  assert.equal(h.pending().length, 1, 'poistka beží');
  assert.equal(h.pending()[0].ms, START_FLIGHT_CAP_MS);
  h.camera.moveStart.raise();
  assert.equal(h.tileset.maximumScreenSpaceError, 32);
  assert.equal(h.ctl.active, true);
  assert.equal(h.camera.moveStart.count, 0, 'začiatok pohybu stačí raz');
  assert.equal(h.camera.moveEnd.count, 1);
  const restore = h.pending().find((t) => t.ms === START_FLIGHT_RESTORE_AFTER_MS);
  assert.ok(restore, 'časovač návratu plného detailu');
  restore.fn();
  assert.equal(h.tileset.maximumScreenSpaceError, 16);
  assert.equal(h.ctl.active, false);
  assert.equal(await h.ctl.done, 'sharpened');
  assert.equal(h.camera.moveEnd.count, 0, 'odpojené');
  assert.equal(h.pending().length, 0, 'poistka zrušená');
  h.camera.moveEnd.raise(); h.camera.moveStart.raise();
  assert.equal(h.tileset.maximumScreenSpaceError, 16, 'raz a dosť');
});

test('zastavenie kamery (dotyk preruší let, alebo pristátie skôr) vráti plný detail hneď', async () => {
  const h = harness();
  await settle();
  h.camera.moveStart.raise();
  assert.equal(h.tileset.maximumScreenSpaceError, 32);
  h.camera.moveEnd.raise();
  assert.equal(h.tileset.maximumScreenSpaceError, 16);
  assert.equal(await h.ctl.done, 'stopped');
  assert.equal(h.pending().length, 0, 'časovače zrušené');
});

test('poistka: bez pohybu (robot, bez polohy) sa detail nikdy nezmení a počúvanie skončí', async () => {
  const h = harness();
  await settle();
  const cap = h.pending()[0];
  cap.fn();
  assert.equal(h.tileset.maximumScreenSpaceError, 16);
  assert.equal(await h.ctl.done, 'cap');
  assert.equal(h.camera.moveStart.count, 0);
  h.camera.moveStart.raise();
  assert.equal(h.tileset.maximumScreenSpaceError, 16);
});

test('bez tilesetu (OSM, QA, robot) alebo bez udalostí kamery sa nič nerobí; ručný restore je nevratný', async () => {
  const none = coarsenTilesDuringStartFlight({ tileset: null, camera: { moveStart: fakeEvent(), moveEnd: fakeEvent() } });
  assert.equal(await none.done, 'none');
  assert.equal(coarsenTilesDuringStartFlight({ tileset: { maximumScreenSpaceError: 16 }, camera: null }).active, false);
  const h = harness();
  await settle();
  h.ctl.restore();
  assert.equal(await h.ctl.done, 'restored');
  h.camera.moveStart.raise();
  assert.equal(h.tileset.maximumScreenSpaceError, 16);
  // zlyhané čakanie nič nepokazí
  const failed = coarsenTilesDuringStartFlight({ tileset: { maximumScreenSpaceError: 16 }, camera: { moveStart: fakeEvent(), moveEnd: fakeEvent() }, whenReady: Promise.reject(new Error('x')) });
  assert.equal(await failed.done, 'error');
});

test('zapojenie: main.js zhrubí dlaždice počas úvodného preletu (tileset, kamera, skrytie úvodnej obrazovky)', () => {
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /import \{ coarsenTilesDuringStartFlight \} from '\.\/startFlightDetail\.js';/);
  assert.match(main, /coarsenTilesDuringStartFlight\(\{ tileset, camera: viewer\.camera, whenReady: whenStartupReady\(\) \}\);/);
});
