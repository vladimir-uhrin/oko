// src/ukraineControlLayer.test.mjs — vrstva kontroly: farby, veľkosť bodov, maľovanie
// rastra na falošné plátno (RU výplň, šrafovanie len na kontestovaných), inertná bez viewera.
import test from 'node:test';
import assert from 'node:assert/strict';

import { CONTROL_CODE } from './data/ukraineControl.js';
import { controlPointSize, createUkraineControlLayer, cssRgb, paintControlCanvas } from './ukraineControlLayer.js';

function fakeCanvas() {
  const calls = [];
  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    clearRect: (...a) => calls.push(['clearRect', ...a]), fillRect: (...a) => calls.push(['fillRect', ctx.fillStyle, ...a]),
    save: () => calls.push(['save']), restore: () => calls.push(['restore']), beginPath: () => calls.push(['beginPath']), clip: () => calls.push(['clip']),
    rect: (...a) => calls.push(['rect', ...a]), moveTo: () => {}, lineTo: () => {}, stroke: () => calls.push(['stroke', ctx.strokeStyle]),
  };
  return { width: 0, height: 0, calls, getContext: () => ctx };
}

test('farby a veľkosti', () => {
  assert.deepEqual(cssRgb('#e0553f'), [224, 85, 63]);
  assert.deepEqual(cssRgb('zle'), [255, 255, 255]);
  assert.equal(controlPointSize({ kind: 'settlement', size: 28 }), 9);
  assert.equal(controlPointSize({ kind: 'settlement', size: 12 }), 6);
  assert.equal(controlPointSize({ kind: 'settlement', size: 4 }), 3.5);
  assert.equal(controlPointSize({ kind: 'airbase', size: 12 }), 4);
});

test('paintControlCanvas: RU bunky ako výplň v behoch, kontestované šrafované, UA bez výplne', () => {
  const raster = { width: 4, height: 2, cells: Uint8Array.from([CONTROL_CODE.ru, CONTROL_CODE.ru, CONTROL_CODE.contested, CONTROL_CODE.ua, CONTROL_CODE.none, CONTROL_CODE.ru, CONTROL_CODE.ua, CONTROL_CODE.contested]) };
  const canvas = fakeCanvas();
  const out = paintControlCanvas(raster, canvas, { scale: 2 });
  assert.equal(out, canvas);
  assert.equal(canvas.width, 8);
  assert.equal(canvas.height, 4);
  const fills = canvas.calls.filter((c) => c[0] === 'fillRect');
  assert.deepEqual(fills[0].slice(2), [0, 0, 4, 2], 'beh dvoch RU buniek = jeden obdĺžnik');
  assert.deepEqual(fills[1].slice(2), [2, 2, 2, 2], 'RU bunka v druhom riadku');
  assert.ok(fills[0][1].startsWith('rgba(224, 85, 63'));
  const rects = canvas.calls.filter((c) => c[0] === 'rect');
  assert.equal(rects.length, 2, 'dve kontestované bunky orezané pre šrafy');
  assert.equal(canvas.calls.filter((c) => c[0] === 'clip').length, 1);
  assert.equal(canvas.calls.filter((c) => c[0] === 'stroke').length, 1);
  assert.equal(paintControlCanvas(raster, { getContext: () => null }), null);
});

test('bez viewera je vrstva inertná', () => {
  const inert = createUkraineControlLayer({ viewer: null });
  assert.equal(inert.isShown(), false);
  inert.setSnapshot({ points: [] });
  assert.equal(inert.getState().points, 0);
});
