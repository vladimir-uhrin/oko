// src/data/ukraineControlClutter.test.mjs — menej rušivá KONTROLA SÍDIEL (2026-09-26,
// vlastník: „tie zelené pruhy sprav lepšie a mestá bodky sú veľmi rušivé"):
// pás bojov ako mäkká stuha (predvolený štýl), šrafovanie len na KARTE; body
// Wikipédie v tyle až zblízka, front vždy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CONTROL_CODE, controlRaster } from './ukraineControl.js';
import { CONTROL_STYLES, REAR_RURAL_FAR_M, REAR_SETTLEMENT_FAR_M, controlPointRelevance, paintControlCanvas } from '../ukraineControlLayer.js';

function fakeCanvas() {
  const calls = [];
  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 1, filter: '', imageSmoothingEnabled: false,
    clearRect: (...a) => calls.push(['clearRect', ...a]), fillRect: (...a) => calls.push(['fillRect', ctx.fillStyle, ...a]),
    rect: (...a) => calls.push(['rect', ...a]), clip: () => calls.push(['clip']), stroke: () => calls.push(['stroke']),
    beginPath() {}, moveTo() {}, lineTo() {}, save: () => calls.push(['save']), restore: () => calls.push(['restore']),
    drawImage: (...a) => calls.push(['drawImage', ctx.filter, a.length]),
  };
  return { width: 0, height: 0, calls, getContext: () => ctx };
}
const raster = { width: 4, height: 2, cellDeg: 0.05, bbox: { west: 30, north: 50, east: 30.2, south: 49.9 }, cells: Uint8Array.from([CONTROL_CODE.ru, CONTROL_CODE.contested, CONTROL_CODE.contested, CONTROL_CODE.ua, CONTROL_CODE.none, CONTROL_CODE.ru, CONTROL_CODE.ua, CONTROL_CODE.ua]) };

test('predvolený štýl kreslí pás mäkko (bez pruhov), KARTA ostáva šrafovaná; predvolené volanie bez zmeny', () => {
  assert.equal(CONTROL_STYLES.default.band, 'soft');
  assert.equal(CONTROL_STYLES.karta.band, 'hatch');
  const soft = fakeCanvas();
  paintControlCanvas(raster, soft, { scale: 2, band: 'soft', createCanvas: fakeCanvas });
  assert.equal(soft.calls.filter((c) => c[0] === 'stroke').length, 0, 'žiadne pruhy');
  assert.equal(soft.calls.filter((c) => c[0] === 'clip').length, 0);
  const draws = soft.calls.filter((c) => c[0] === 'drawImage');
  assert.equal(draws.length, 1, 'stuha z pomocného plátna');
  assert.match(draws[0][1], /^blur\(1\.5px\)$/, 'bandSoft 3 × scale 2 / 4');
  const crisp = fakeCanvas();
  paintControlCanvas(raster, crisp, { scale: 2, band: 'soft' });
  const bandFills = crisp.calls.filter((c) => c[0] === 'fillRect' && c[1].startsWith('rgba(255, 181, 71'));
  assert.deepEqual(bandFills.map((c) => c.slice(2)), [[2, 0, 4, 2]], 'bez továrne: beh dvoch sporných buniek ako jeden ostrý obdĺžnik');
  assert.equal(crisp.calls.filter((c) => c[0] === 'stroke').length, 0);
  const hatched = fakeCanvas();
  paintControlCanvas(raster, hatched, { scale: 2 });
  assert.equal(hatched.calls.filter((c) => c[0] === 'stroke').length, 1, 'predvolené volanie (KARTA, testy pásu) šrafuje ako doteraz');
});

test('body v tyle: sporné, infraštruktúra, mestá a okolie pásu = front; dedina 20 km od pásu = rear', () => {
  const pts = [
    { kind: 'settlement', side: 'ua', lat: 48.0, lon: 37.0, size: 8 },
    { kind: 'settlement', side: 'ru', lat: 48.0, lon: 37.3, size: 8 },
    { kind: 'rural', side: 'ua', lat: 48.6, lon: 36.4, size: 4 },
    { kind: 'settlement', side: 'ua', lat: 48.6, lon: 36.2, size: 20 },
    { kind: 'airbase', side: 'ru', lat: 48.7, lon: 38.9, size: 4 },
  ];
  const r = controlRaster(pts, { bbox: { west: 36, south: 47.5, east: 39.5, north: 49 }, bandKm: 5, contestedKm: 4 });
  assert.equal(controlPointRelevance(pts[0], r), 'front', 'sídlo pri páse');
  assert.equal(controlPointRelevance(pts[1], r), 'front');
  assert.equal(controlPointRelevance(pts[2], r), 'rear', 'dedina hlboko v tyle');
  assert.equal(controlPointRelevance(pts[3], r), 'front', 'mesto (size ≥ 16) vždy');
  assert.equal(controlPointRelevance(pts[4], r), 'front', 'infraštruktúra vždy');
  assert.equal(controlPointRelevance({ kind: 'rural', side: 'contested', lat: 48.6, lon: 36.4 }, r), 'front', 'sporné vždy');
  assert.equal(controlPointRelevance({ kind: 'rural', side: 'ua', lat: 55, lon: 20, size: 4 }, r), 'front', 'mimo rastra sa neskrýva');
  assert.equal(controlPointRelevance(pts[2], null), 'front', 'bez rastra sa neskrýva');
  assert.ok(REAR_RURAL_FAR_M < REAR_SETTLEMENT_FAR_M && REAR_SETTLEMENT_FAR_M < 160_000, 'pri pohľade na smer (~160 km) tyl nevidno');
});

test('vrstva dáva bodom v tyle podmienku vzdialenosti a legenda ukazuje mäkkú stuhu', () => {
  const src = readFileSync(new URL('../ukraineControlLayer.js', import.meta.url), 'utf8');
  assert.match(src, /rear \? \{ distanceDisplayCondition: new Cesium\.DistanceDisplayCondition\(0, farM\), translucencyByDistance: new Cesium\.NearFarScalar\(farM \* 0\.6, 1, farM, 0\) \} : \{\}/);
  assert.match(src, /_raster = controlRaster\([\s\S]*?\);\n\s+_frontPoints = 0;\n\s+for \(const p of _snapshot\.points\)/, 'raster pred bodmi');
  const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.oko-ukr-tl-ctl-item\.is-zone \.oko-ukr-tl-ctl-sw \{ background: radial-gradient/, 'vzorka legendy = stuha, nie pruhy');
});
