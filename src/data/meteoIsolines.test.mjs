// src/data/meteoIsolines.test.mjs
// Izočiary marching squares (2026-09-08, fáza „polia"): syntetický vrch → uzavretá krivka.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeChannel, downsample, isolineLevels, isolines, isolinesForLevel } from './meteoIsolines.js';

/** Gaussovský vrch 1030 hPa na pozadí 1000 hPa, mriežka 41×41 (0,5°). */
function bump(cols = 41, rows = 41) {
  const values = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
    const dx = (c - 20) / 8;
    const dy = (r - 20) / 8;
    values[r * cols + c] = 1000 + 30 * Math.exp(-(dx * dx + dy * dy));
  }
  return { values, cols, rows };
}
const geo = { lon0: 0, lat0: 20, dlon: 0.5, dlat: -0.5 };

test('hladiny a podvzorkovanie', () => {
  assert.deepEqual(isolineLevels(993.2, 1012, 4), [996, 1000, 1004, 1008, 1012]);
  assert.deepEqual(isolineLevels(1000, 1000, 4), [1000]);
  const g = downsample(new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), 3, 3, 2);
  assert.deepEqual([g.cols, g.rows, Array.from(g.values)], [2, 2, [1, 3, 7, 9]]);
  const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 0, 0, 255]);
  assert.deepEqual(Array.from(decodeChannel(rgba, 0, [940, 1060])), [940, 1060]);
});

test('vrch: hladina 1012 dá jednu uzavretú čiaru okolo stredu, body ležia na správnej hodnote (interpolácia)', () => {
  const { values, cols, rows } = bump();
  const lines = isolinesForLevel(values, cols, rows, 1012, geo);
  assert.equal(lines.length, 1, 'jedna spojená krivka (úseky sa pospájali)');
  const pts = lines[0];
  assert.ok(pts.length > 40, `dosť bodov: ${pts.length}`);
  const first = pts[0];
  const last = pts[pts.length - 1];
  assert.ok(Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.6, 'uzavretá (koniec pri začiatku)');
  // polomer kde 1000 + 30·exp(-d²) = 1012 → d = sqrt(ln(30/12)) ≈ 0,957 → 7,66 buniek ≈ 3,83°;
  // stred vrchu je stĺpec 20 (10° E) a riadok 20 (lat0 20 + 20·(−0,5) = 10° N).
  for (const [lon, lat] of pts) {
    const d = Math.hypot((lon - 10) / 0.5, (10 - lat) / 0.5) / 8;
    assert.ok(Math.abs(d - 0.957) < 0.08, `bod na izobare: d=${d.toFixed(3)}`);
  }
  assert.deepEqual(isolinesForLevel(values, cols, rows, 1040, geo), [], 'hladina nad maximom = nič');
});

test('isolines: všetky hladiny v rozsahu poľa, krátke úseky vyhodené, poradie hladín', () => {
  const { values, cols, rows } = bump();
  const all = isolines(values, cols, rows, { step: 4, minPoints: 6 }, geo);
  const levels = [...new Set(all.map((l) => l.level))];
  assert.deepEqual(levels, [1004, 1008, 1012, 1016, 1020, 1024, 1028]);
  assert.ok(all.every((l) => l.points.length >= 6));
  const clipped = isolines(values, cols, rows, { step: 4, min: 1010, max: 1020 }, geo);
  assert.deepEqual([...new Set(clipped.map((l) => l.level))], [1012, 1016, 1020]);
});
