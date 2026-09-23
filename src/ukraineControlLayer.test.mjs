// src/ukraineControlLayer.test.mjs — vrstva kontroly: farby, veľkosť bodov, maľovanie
// rastra na falošné plátno (RU výplň, šrafovanie len na kontestovaných), inertná bez viewera.
import test from 'node:test';
import assert from 'node:assert/strict';

import { CONTROL_CODE } from './data/ukraineControl.js';
import { CONTROL_STYLES, controlPointSize, controlZoneAlphas, createUkraineControlLayer, cssRgb, nearestSide, paintControlCanvas } from './ukraineControlLayer.js';

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

test('K3: nearestSide — najbližšie sídlo do 3 km, infraštruktúra sa nepočíta, mixed = contested, ďaleko = null', () => {
  const pts = [
    { lat: 48.99, lon: 37.80, side: 'contested', kind: 'settlement' },
    { lat: 48.98, lon: 37.95, side: 'ru', kind: 'settlement' },
    { lat: 49.03, lon: 37.55, side: 'ua', kind: 'infrastructure' },
    { lat: 49.03, lon: 37.60, side: 'mixed', kind: 'rural' },
  ];
  assert.equal(nearestSide(pts, 37.805, 48.992), 'contested');
  assert.equal(nearestSide(pts, 37.94, 48.985), 'ru');
  assert.equal(nearestSide(pts, 37.55, 49.03), null, 'infraštruktúra nie je sídlo');
  assert.equal(nearestSide(pts, 37.6, 49.03), 'contested', 'mixed → contested');
  assert.equal(nearestSide(pts, 37.0, 48.5), null);
  assert.equal(nearestSide(pts, 37.805, 48.992, 0.1), null, 'maxKm ostro');
  assert.equal(nearestSide(null, 37, 48), null);
  assert.deepEqual(CONTROL_STYLES.karta.points, false);
});

test('K3: paintControlCanvas mäkko — výplne 1 px na bunku do pomocného plátna, rozmazané zväčšenie, šrafovanie ostré; bez továrne ostrý spôsob', () => {
  const raster = { width: 4, height: 2, cells: Uint8Array.from([2, 2, 0, 3, 1, 2, 3, 0]) };
  const canvas = fakeCanvas();
  const offs = [];
  const createCanvas = () => { const c = fakeCanvas(); c.getContext().drawImage = undefined; offs.push(c); return c; };
  const ctx = canvas.getContext();
  ctx.drawImage = (...a) => canvas.calls.push(['drawImage', ...a.slice(1)]);
  ctx.filter = 'none';
  const out = paintControlCanvas(raster, canvas, { scale: 2, soft: 3, createCanvas });
  assert.equal(out, canvas);
  assert.equal(offs.length, 1); assert.equal(offs[0].width, 4); assert.equal(offs[0].height, 2);
  assert.ok(offs[0].calls.some((c) => c[0] === 'fillRect'), 'výplne šli do pomocného plátna');
  assert.ok(!canvas.calls.some((c) => c[0] === 'fillRect' && String(c[1]).includes('224, 85, 63')), 'na výstupe žiadna ostrá RU výplň');
  assert.ok(canvas.calls.some((c) => c[0] === 'drawImage' && c[3] === 8 && c[4] === 4), 'pomocné plátno nakreslené v plnej veľkosti');
  assert.equal(canvas.calls.filter((c) => c[0] === 'stroke').length, 1, 'šrafovanie ostré na výstupe');
  const crisp = fakeCanvas();
  paintControlCanvas(raster, crisp, { scale: 2, soft: 3 });
  assert.ok(crisp.calls.some((c) => c[0] === 'fillRect'), 'bez továrne kreslí naostro');
});

test('A2: zastaraná snímka stlmí RU výplň o STALE_DIM, šrafovanie zóny bojov ostáva naplno', async () => {
  const { STALE_DIM } = await import('./data/ukraineFreshness.js');
  const fresh = controlZoneAlphas(CONTROL_STYLES.default, false);
  const stale = controlZoneAlphas(CONTROL_STYLES.default, true);
  assert.equal(fresh.ruAlpha, CONTROL_STYLES.default.ruAlpha, 'čerstvá kreslí naplno');
  assert.equal(stale.ruAlpha, CONTROL_STYLES.default.ruAlpha * STALE_DIM);
  // Šrafovanie zóny bojov ostáva naplno — stlmené bolo na doméne nevýrazné
  // (používateľ 2026-09-23). O veku hovorí výplň, značka a riadok ZDROJE.
  assert.equal(stale.hatchAlpha, fresh.hatchAlpha, 'zóna bojov sa nestlmuje');
  // Štýl KARTA má vlastnú slabšiu výplň — stlmenie sa na ňu násobí, neprepisuje ju.
  assert.equal(controlZoneAlphas(CONTROL_STYLES.karta, true).ruAlpha, CONTROL_STYLES.karta.ruAlpha * STALE_DIM);
});
