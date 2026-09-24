// src/data/ukraineControlBand.test.mjs — tenší pás bojov z Wikipédie (2026-09-24,
// vlastník: „stenši pás"): vlastný polomer sporných sídiel, šírky vrstvy a tenké
// pruhy na hustejšom plátne.
import test from 'node:test';
import assert from 'node:assert/strict';

import { CONTROL_CODE, controlRaster } from './ukraineControl.js';
import { CONTROL_BAND_KM, CONTROL_CONTESTED_KM, CONTROL_RASTER_SCALE, paintControlCanvas } from '../ukraineControlLayer.js';

const PTS = [
  { lat: 48.0, lon: 37.0, side: 'ua', kind: 'settlement' },
  { lat: 48.0, lon: 38.0, side: 'ru', kind: 'settlement' },
  { lat: 48.6, lon: 36.6, side: 'contested', kind: 'settlement' },
];
const OPTS = { bbox: { west: 36.0, south: 47.5, east: 38.5, north: 49.0 }, cellDeg: 0.05, maxKm: 60 };

test('polomer sporných sídiel je samostatný; predvolene rovnaký ako šírka pásu', () => {
  const same = controlRaster(PTS, { ...OPTS, bandKm: 7 });
  const explicit = controlRaster(PTS, { ...OPTS, bandKm: 7, contestedKm: 7 });
  assert.deepEqual([...same.cells], [...explicit.cells], 'bez contestedKm sa nič nemení');
  const narrow = controlRaster(PTS, { ...OPTS, bandKm: 7, contestedKm: 3 });
  assert.ok(narrow.counts.contested < same.counts.contested, `${narrow.counts.contested} < ${same.counts.contested}`);
  const at = (r, lat, lon) => r.cells[Math.floor((OPTS.bbox.north - lat) / OPTS.cellDeg) * r.width + Math.floor((lon - OPTS.bbox.west) / OPTS.cellDeg)];
  assert.equal(at(narrow, 48.0, 37.5), CONTROL_CODE.contested, 'stred medzi stranami ostáva v páse');
});

test('vrstva kreslí užší pás tenkými pruhmi', () => {
  assert.equal(CONTROL_BAND_KM, 5);
  assert.equal(CONTROL_CONTESTED_KM, 4);
  assert.equal(CONTROL_RASTER_SCALE, 8);
  const widths = [];
  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    clearRect() {}, fillRect() {}, save() {}, restore() {}, beginPath() {}, clip() {}, rect() {}, moveTo() {}, lineTo() {},
    stroke() { widths.push(ctx.lineWidth); },
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const raster = { width: 2, height: 1, cells: Uint8Array.from([CONTROL_CODE.contested, CONTROL_CODE.ru]) };
  paintControlCanvas(raster, canvas);
  assert.equal(canvas.width, 16, '8 px na bunku');
  assert.equal(widths.length, 1);
  assert.ok(widths[0] <= 1.2, `pruh ${widths[0]} px ≈ 1/8 bunky`);
});
