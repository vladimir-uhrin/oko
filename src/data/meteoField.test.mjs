// src/data/meteoField.test.mjs
// Meteorológia sveta — čisté pomôcky (2026-09-08, prototyp).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  METEO_FIELDS, METEO_RAMPS, rampStopsFor, TEMP_RANGE, WIND_COMPONENT_RANGE, WIND_SPEED_RANGE,
  dequantize, forecastSteps, hexToRgb, nearestStepIndex, normalizeCatalog, quantize,
  rampCss, rampLegend, rampRgbaTable, runLabel, sliceUrl, stepLabel,
  METEO_FIELD_ORDER, WIND_LEVELS, isWindField, windLevelOf,
} from './meteoField.js';

test('kvantizácia: 0..255 nad rozsahom, NaN → 0, späť s presnosťou rozsahu/255', () => {
  assert.equal(quantize(-60, WIND_COMPONENT_RANGE), 0);
  assert.equal(quantize(60, WIND_COMPONENT_RANGE), 255);
  assert.equal(quantize(0, WIND_COMPONENT_RANGE), 128);
  assert.equal(quantize(NaN, TEMP_RANGE), 0);
  assert.equal(quantize(999, WIND_SPEED_RANGE), 255);
  assert.ok(Math.abs(dequantize(quantize(12.3, WIND_SPEED_RANGE), WIND_SPEED_RANGE) - 12.3) < 0.15);
});

test('rampy ako Windy (2026-10-07): sýta viacfarebná škála vetra, nárazy = vietor, tabuľka 256×4, CSS gradient, legenda', () => {
  const table = rampRgbaTable(METEO_RAMPS.wind, METEO_FIELDS.wind.rampRange);
  assert.equal(table.length, 256 * 4);
  assert.deepEqual(Array.from(table.subarray(0, 3)), [98, 113, 183], 'bezvetrie = modrofialová ako na Windy');
  assert.equal(table[3], 255, 'vietor bez alfy v rampe — celý svet zafarbený, orientáciu dáva mapa nad poľom');
  const at = (ms) => Array.from(table.subarray(Math.round((ms / 45) * 255) * 4, Math.round((ms / 45) * 255) * 4 + 3));
  const [r9, g9, b9] = at(9);
  assert.ok(g9 > r9 + 60 && g9 > b9 + 60, `9 m/s je zelená (${r9},${g9},${b9})`);
  const [r17, g17, b17] = at(17);
  assert.ok(r17 > g17 + 40, `17 m/s je do červena (${r17},${g17},${b17})`);
  assert.deepEqual(Array.from(table.subarray(255 * 4, 255 * 4 + 3)), [231, 215, 215], 'búrka do svetla');
  assert.equal(rampStopsFor('gust'), METEO_RAMPS.wind, 'nárazy majú škálu vetra');
  assert.match(rampCss(METEO_RAMPS.temp, METEO_FIELDS.temp.rampRange), /^linear-gradient\(90deg, #caacc3 0\.0%, .*#470e00 100\.0%\)$/);
  const temp = rampRgbaTable(METEO_RAMPS.temp, METEO_FIELDS.temp.rampRange);
  const t21 = Math.round(((21 + 55) / 102) * 255) * 4;
  assert.ok(temp[t21] > 200 && temp[t21 + 2] < 60, '21 °C je žltá');
  const legend = rampLegend(METEO_RAMPS.wind, 'm/s');
  assert.deepEqual(legend[0], { color: '#6271b7', label: '0 m/s', count: '' });
  assert.equal(METEO_RAMPS.precip[0][2], 0, 'bez zrážok priehľadné');
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

test('výškové hladiny vetra: Pa nie hPa, vlastný rozsah na hladinu, mimo čipov', () => {
  // GFS má os `isobaric` v PASCALOCH (dataset.xml: units="Pa"). Zámena za hPa
  // by ticho vrátila úplne inú hladinu, preto to drží test.
  assert.equal(METEO_FIELDS.wind850.vertCoord, 85000);
  assert.equal(METEO_FIELDS.wind250.vertCoord, 25000);
  for (const l of WIND_LEVELS.filter((x) => x.levelPa)) {
    const f = METEO_FIELDS[l.id];
    assert.ok(f, `pole ${l.id} musí existovať`);
    assert.deepEqual(f.vars, ['u-component_of_wind_isobaric', 'v-component_of_wind_isobaric']);
    assert.equal(f.vertCoord, l.levelPa, 'vertCoord = hladina v Pa');
  }

  // Namerané globálne maximá: 850 → 51,7 · 500 → 71,3 · 250 → 94,0 m/s.
  // Rozsah musí mať nad nimi rezervu, inak sa jadro tryskového prúdenia oreže
  // a častice sa hýbu nesprávnou rýchlosťou (orezalo by aj |u|).
  assert.ok(METEO_FIELDS.wind250.decode[1] > 94, '250 hPa musí uniesť viac než 94 m/s');
  assert.ok(METEO_FIELDS.wind500.decode[1] > 71.3, '500 hPa musí uniesť viac než 71,3 m/s');
  assert.equal(METEO_FIELDS.wind250.componentRange[1], METEO_FIELDS.wind250.decode[1],
    'zložky u/v majú rovnaký strop ako rýchlosť');
  assert.ok(METEO_FIELDS.wind500.decode[1] > METEO_FIELDS.wind850.decode[1],
    'vyššia hladina = širší rozsah');

  // Hladiny sa nesmú objaviť ako ďalšie čipy polí — majú vlastný prepínač.
  for (const id of ['wind850', 'wind700', 'wind500', 'wind250']) {
    assert.ok(!METEO_FIELD_ORDER.includes(id), `${id} nepatrí medzi čipy polí`);
  }
  assert.equal(isWindField('wind250'), true);
  assert.equal(isWindField('temp'), false);
  assert.equal(windLevelOf('wind500').label, '500 hPa');
  assert.equal(windLevelOf('temp'), null);
});
