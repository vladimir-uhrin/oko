// src/data/meteoField.test.mjs
// Meteorológia sveta — čisté pomôcky (2026-09-08, prototyp).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  METEO_FIELDS, METEO_RAMPS, TEMP_RANGE, WIND_COMPONENT_RANGE, WIND_SPEED_RANGE,
  dequantize, forecastSteps, hexToRgb, nearestStepIndex, normalizeCatalog, quantize,
  rampCss, rampLegend, rampRgbaTable, runLabel, sliceUrl, stepLabel,
} from './meteoField.js';

test('kvantizácia: 0..255 nad rozsahom, NaN → 0, späť s presnosťou rozsahu/255', () => {
  assert.equal(quantize(-60, WIND_COMPONENT_RANGE), 0);
  assert.equal(quantize(60, WIND_COMPONENT_RANGE), 255);
  assert.equal(quantize(0, WIND_COMPONENT_RANGE), 128);
  assert.equal(quantize(NaN, TEMP_RANGE), 0);
  assert.equal(quantize(999, WIND_SPEED_RANGE), 255);
  assert.ok(Math.abs(dequantize(quantize(12.3, WIND_SPEED_RANGE), WIND_SPEED_RANGE) - 12.3) < 0.15);
});

test('rampy OKO: azúrová v strede vetra, tabuľka 256×4, CSS gradient, legenda každou druhou zastávkou', () => {
  assert.deepEqual(hexToRgb('#39d0ff'), [57, 208, 255]);
  const table = rampRgbaTable(METEO_RAMPS.wind, METEO_FIELDS.wind.rampRange);
  assert.equal(table.length, 256 * 4);
  assert.deepEqual(Array.from(table.subarray(0, 3)), hexToRgb('#155e86'), 'začiatok = prvá zastávka (Windy pass: bezvetrie modré, čitateľné na tmavom podklade)');
  assert.deepEqual(Array.from(table.subarray(255 * 4, 255 * 4 + 3)), [255, 255, 255], 'koniec = biela');
  const mid = Math.round((10 / 45) * 255);
  assert.deepEqual(Array.from(table.subarray(mid * 4, mid * 4 + 3)).map((v) => Math.round(v / 8)), hexToRgb('#39d0ff').map((v) => Math.round(v / 8)), '10 m/s ≈ azúrová --accent');
  assert.match(rampCss(METEO_RAMPS.temp, METEO_FIELDS.temp.rampRange), /^linear-gradient\(90deg, #3b1c6e 0\.0%, .*#8a0c1e 100\.0%\)$/);
  const legend = rampLegend(METEO_RAMPS.wind, 'm/s');
  assert.equal(legend.length, 5);
  assert.deepEqual(legend[0], { color: '#155e86', label: '0 m/s', count: '' });
});

test('kroky predpovede: od teraz zaokrúhleného na 3 h, 25 krokov po +72 h; najbližší krok; URL rezu', () => {
  const now = Date.parse('2026-09-08T19:47:00Z');
  const steps = forecastSteps(now);
  assert.equal(steps.length, 25);
  assert.equal(steps[0], '2026-09-08T18:00:00Z');
  assert.equal(steps[24], '2026-09-11T18:00:00Z');
  assert.equal(nearestStepIndex(steps, Date.parse('2026-09-09T04:20:00Z')), 3);
  assert.equal(sliceUrl('wind', steps[1]), '/api/meteo/slice?var=wind&time=2026-09-08T21%3A00%3A00Z');
});

test('popisky: krok s dňom a lead-om od behu (SK/EN), beh modelu, katalóg z proxy', () => {
  assert.equal(stepLabel('2026-09-09T06:00:00Z', '2026-09-08T12:00:00Z'), 'St 9. 9. 06:00 UTC · +18 h');
  assert.equal(stepLabel('2026-09-09T06:00:00Z', '2026-09-08T12:00:00Z', 'en'), 'Wed 9/9 06:00 UTC · +18 h');
  assert.equal(stepLabel('2026-09-09T06:00:00Z', null), 'St 9. 9. 06:00 UTC');
  assert.equal(stepLabel('zle', null), '—');
  assert.equal(runLabel('2026-09-08T12:00:00.000Z'), 'GFS 0,25° · beh 08.09. 12Z');
  assert.equal(runLabel(null, 'en'), 'GFS 0.25° · run unknown');
  const cat = normalizeCatalog({ model: 'GFS 0.25°', run: '2026-09-08T12:00:00Z', steps: ['2026-09-08T18:00:00Z', 'x'], attribution: 'A', stale: false, baked: 3, bakedTotal: 25 });
  assert.deepEqual(cat, { steps: ['2026-09-08T18:00:00Z'], run: '2026-09-08T12:00:00Z', model: 'GFS 0.25°', attribution: 'A', stale: false, baked: 3, bakedTotal: 25 });
  const catLegacy = normalizeCatalog({ steps: ['2026-09-08T18:00:00Z'], run: null });
  assert.deepEqual([catLegacy.baked, catLegacy.bakedTotal, catLegacy.model], [0, 1, 'GFS 0.25°'], 'stará proxy bez baked polí → 0 / počet krokov');
  assert.equal(normalizeCatalog({ steps: [] }), null);
  assert.equal(normalizeCatalog(null), null);
});
