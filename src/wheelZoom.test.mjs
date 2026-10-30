// src/wheelZoom.test.mjs — pokojnejší zoom kolieskom (2026-10-30).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WHEEL_ZOOM_FACTOR, WHEEL_ZOOM_INERTIA, applyWheelZoom } from './wheelZoom.js';

test('počítač: zoomFactor 4 a dobeh 0,5 namiesto predvolených 5 / 0,8 (zmerané: 1 cvaknutie ×0,89, 5 rýchlych ×0,61)', () => {
  const controller = { zoomFactor: 5, inertiaZoom: 0.8 };
  assert.equal(applyWheelZoom(controller), true);
  assert.deepEqual(controller, { zoomFactor: WHEEL_ZOOM_FACTOR, inertiaZoom: WHEEL_ZOOM_INERTIA });
  assert.ok(WHEEL_ZOOM_FACTOR < 5 && WHEEL_ZOOM_FACTOR >= 3, 'pokojnejšie, ale nie zdĺhavé');
  assert.ok(WHEEL_ZOOM_INERTIA <= 0.5, 'po pustení kolieska skoro stojí');
});

test('telefón (dotykový ukazovateľ) bez zmeny — zoomFactor riadi aj pinch; bez ovládača nič', () => {
  const controller = { zoomFactor: 5, inertiaZoom: 0.8 };
  assert.equal(applyWheelZoom(controller, { coarsePointer: true }), false);
  assert.deepEqual(controller, { zoomFactor: 5, inertiaZoom: 0.8 });
  assert.equal(applyWheelZoom(null), false);
});

test('zapojenie: main.js nastaví ovládač hneď po vzniku scény', () => {
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /import \{ applyWheelZoom \} from '\.\/wheelZoom\.js';/);
  assert.match(main, /applyWheelZoom\(viewer\.scene\.screenSpaceCameraController, \{ coarsePointer: window\.matchMedia\?\.\('\(pointer: coarse\)'\)\?\.matches === true \}\);/);
});
