// src/data/meteoRasterize.test.mjs
// Meteorológia sveta — rasterizácia NetCDF → RGBA (2026-09-17, krok 1 fázy 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rasterizeMeteoField, runIsoOf } from './meteoRasterize.js';
import { dequantize, WIND_COMPONENT_RANGE, WIND_SPEED_RANGE, TEMP_RANGE } from './meteoField.js';

/** Mini NetCDF mock v tvare, aký vracia parseNetcdf3 (len čo rasterizácia číta). */
function mockNc({ lats, lons, vars, reftimeHours, reftimeUnits }) {
  const dims = [
    { name: 'time', size: 1 },
    { name: 'lat', size: lats.length },
    { name: 'lon', size: lons.length },
  ];
  const varEntries = {};
  for (const [name, data] of Object.entries(vars)) {
    varEntries[name] = { name, dims: ['time', 'lat', 'lon'], attrs: {}, data: Float32Array.from(data) };
  }
  varEntries.lat = { name: 'lat', dims: ['lat'], attrs: {}, data: Float32Array.from(lats) };
  varEntries.lon = { name: 'lon', dims: ['lon'], attrs: {}, data: Float32Array.from(lons) };
  if (reftimeHours !== undefined) {
    varEntries.reftime = { name: 'reftime', dims: ['time'], attrs: { units: reftimeUnits || 'Hour since 2026-09-01T00:00:00Z' }, data: Float64Array.from([reftimeHours]) };
  }
  return {
    dims,
    attrs: {},
    vars: varEntries,
    read(name) { return this.vars[name]?.data; },
  };
}

test('skalárne pole: prevod K → °C, kvantizácia do R=G=B, alfa 255, rozmery', () => {
  // 2 riadky (lat) × 3 stĺpce (lon), NCSS poradie −180..180 ⇒ bez posunu.
  const nc = mockNc({
    lats: [45, -45], // sever hore (northUp)
    lons: [-180, 0, 180],
    vars: { Temperature_height_above_ground: [273.15, 300.15, 233.15, 313.15, 253.15, 283.15] },
  });
  const { data, width, height } = rasterizeMeteoField('temp', nc);
  assert.equal(width, 3);
  assert.equal(height, 2);
  assert.equal(data.length, 2 * 3 * 4);
  const px = (r, c) => data.subarray((r * 3 + c) * 4, (r * 3 + c) * 4 + 4);
  // Float32: 273,15 − 273,15 ≈ −0,005 °C, takže stred rozsahu 127 alebo 128.
  assert.ok(Math.abs(px(0, 0)[0] - 128) <= 1, '0 °C ≈ stred rozsahu −60..60');
  assert.equal(px(0, 0)[1], px(0, 0)[0]);
  assert.equal(px(0, 0)[2], px(0, 0)[0]);
  assert.equal(px(0, 0)[3], 255);
  assert.ok(Math.abs(dequantize(px(0, 1)[0], TEMP_RANGE) - 27) < 0.5, '27 °C ≈ 300 K');
  assert.ok(Math.abs(dequantize(px(0, 2)[0], TEMP_RANGE) - (-40)) < 0.5, '−40 °C ≈ 233 K');
  assert.ok(Math.abs(dequantize(px(1, 0)[0], TEMP_RANGE) - 40) < 0.5, '40 °C ≈ 313 K (južný riadok)');
});

test('vietor: R = u, G = v, B = rýchlosť (hypot), rozsah ±60 / 0..60 m/s', () => {
  const nc = mockNc({
    lats: [0],
    lons: [-180, 0],
    vars: {
      'u-component_of_wind_height_above_ground': [3, -30],
      'v-component_of_wind_height_above_ground': [4, 0],
    },
  });
  const { data } = rasterizeMeteoField('wind', nc);
  const px = (c) => data.subarray(c * 4, c * 4 + 4);
  assert.ok(Math.abs(dequantize(px(0)[0], WIND_COMPONENT_RANGE) - 3) < 0.5);
  assert.ok(Math.abs(dequantize(px(0)[1], WIND_COMPONENT_RANGE) - 4) < 0.5);
  assert.ok(Math.abs(dequantize(px(0)[2], WIND_SPEED_RANGE) - 5) < 0.5, '3-4-5 trojuholník');
  assert.ok(px(1)[0] < 128, 'záporné u pod stredom');
  assert.ok(Math.abs(dequantize(px(1)[2], WIND_SPEED_RANGE) - 30) < 0.5);
});

test('južná-os hore: riadky sa otočia tak, že riadok 0 PNG = sever', () => {
  const nc = mockNc({
    lats: [-45, 45], // juh hore (southUp)
    lons: [-180],
    vars: { Temperature_height_above_ground: [233.15, 313.15] },
  });
  const { data, height } = rasterizeMeteoField('temp', nc);
  assert.equal(height, 2);
  const top = data.subarray(0, 4);
  const bottom = data.subarray(4, 8);
  assert.ok(Math.abs(dequantize(top[0], TEMP_RANGE) - 40) < 0.5, 'hore 45°N = 40 °C');
  assert.ok(Math.abs(dequantize(bottom[0], TEMP_RANGE) - (-40)) < 0.5, 'dole 45°S = −40 °C');
});

test('os 0..360: stĺpce sa posunú tak, že stĺpec 0 PNG = −180°', () => {
  // lon [0, 90, 180, 270] ⇒ posun 2; hodnoty 280,290,300,310 K.
  const nc = mockNc({
    lats: [0],
    lons: [0, 90, 180, 270],
    vars: { Temperature_height_above_ground: [280.15, 290.15, 300.15, 310.15] },
  });
  const { data, width } = rasterizeMeteoField('temp', nc);
  assert.equal(width, 4);
  const px = (c) => data.subarray(c * 4, c * 4 + 4);
  assert.ok(Math.abs(dequantize(px(0)[0], TEMP_RANGE) - 27) < 0.5, '−180° = pôvodný lon 180');
  assert.ok(Math.abs(dequantize(px(1)[0], TEMP_RANGE) - 37) < 0.5, '−90° = pôvodný lon 270');
  assert.ok(Math.abs(dequantize(px(2)[0], TEMP_RANGE) - 7) < 0.5, '0° = pôvodný lon 0');
});

test('beh modelu: reftime „Hour since …" → ISO; bez reftime → null', () => {
  const nc = mockNc({
    lats: [0], lons: [-180],
    vars: { Temperature_height_above_ground: [273.15] },
    reftimeHours: 300,
  });
  assert.equal(runIsoOf(nc), '2026-09-13T12:00:00.000Z');
  const bez = mockNc({ lats: [0], lons: [-180], vars: { Temperature_height_above_ground: [273.15] } });
  assert.equal(runIsoOf(bez), null);
});

test('neznáme pole a neznáma premenná: výnimka, nie tichá nula', () => {
  const nc = mockNc({ lats: [0], lons: [-180], vars: {} });
  assert.throws(() => rasterizeMeteoField('neexistuje', nc), /neznáme pole/);
  assert.throws(() => rasterizeMeteoField('temp', nc), /neexistuje/);
});
