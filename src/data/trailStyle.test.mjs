// src/data/trailStyle.test.mjs — farba trajektórie podľa výšky a hladké zákruty (2026-10-04).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FT_PER_M, TRAIL_ALTITUDE_BANDS, altitudeBand, bandRgb, smoothTrail, splitByBand, trailAltitudeRgb,
} from './trailStyle.js';

const m = (ft) => ft / FT_PER_M;
const hue = ([r, g, b]) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

test('farba podľa výšky: zem teplá (oranžová/červená), cestovná hladina modrá, najvyššie fialová', () => {
  const ground = trailAltitudeRgb(0);
  assert.ok(hue(ground) < 30, `zem do oranžovej (odtieň ${hue(ground).toFixed(0)}°)`);
  assert.ok(hue(trailAltitudeRgb(m(5000))) > 40 && hue(trailAltitudeRgb(m(5000))) < 60, 'nízko žltá');
  assert.ok(hue(trailAltitudeRgb(m(10000))) > 70 && hue(trailAltitudeRgb(m(10000))) < 130, '10 000 ft zelená');
  const cruise = hue(trailAltitudeRgb(m(35000)));
  assert.ok(cruise > 190 && cruise < 250, `cestovná hladina modrá (${cruise.toFixed(0)}°)`);
  assert.ok(hue(trailAltitudeRgb(m(45000))) > 270, 'najvyššie fialová');
  assert.deepEqual(trailAltitudeRgb(m(60000)), trailAltitudeRgb(m(45000)), 'nad stupnicou ostáva posledná farba');
  assert.deepEqual(trailAltitudeRgb(Number.NaN), trailAltitudeRgb(0), 'neznáma výška = zem');
  assert.deepEqual(trailAltitudeRgb(-50), trailAltitudeRgb(0), 'pod hladinou mora (geoid) = zem');
});

test('pásma: monotónne s výškou, v rozsahu; farba pásma = farba jeho stredu', () => {
  assert.equal(altitudeBand(0), 0);
  assert.equal(altitudeBand(m(100000)), TRAIL_ALTITUDE_BANDS - 1);
  let prev = -1;
  for (let ft = 0; ft <= 46000; ft += 500) {
    const band = altitudeBand(m(ft));
    assert.ok(band >= prev, `pásmo neklesá (${ft} ft)`);
    prev = band;
  }
  const band = altitudeBand(m(35000));
  assert.ok(Math.abs(hue(bandRgb(band)) - hue(trailAltitudeRgb(m(35000)))) < 15, 'odtieň pásma ≈ odtieň výšky');
});

test('úseky podľa pásma: susedné zdieľajú bod (bez medzery), pokrývajú celú čiaru', () => {
  assert.deepEqual(splitByBand([3, 3, 3]), [{ band: 3, start: 0, end: 2 }]);
  const runs = splitByBand([1, 1, 2, 2, 2, 5]);
  assert.deepEqual(runs, [{ band: 1, start: 0, end: 2 }, { band: 2, start: 2, end: 5 }]);
  for (let i = 1; i < runs.length; i += 1) assert.equal(runs[i].start, runs[i - 1].end, 'spojitosť');
  assert.equal(runs[0].start, 0);
  assert.equal(runs.at(-1).end, 5);
  assert.deepEqual(splitByBand([7]), []);
  for (const run of splitByBand([0, 1, 2, 3, 4])) assert.ok(run.end > run.start, 'každý úsek má aspoň 2 body');
});

test('zaoblenie: prechádza všetkými nameranými bodmi, v zákrute pridá body, rovný úsek nechá rovný', () => {
  const straight = [{ x: 0, y: 0, z: 0 }, { x: 1000, y: 0, z: 0 }, { x: 2000, y: 0, z: 0 }, { x: 3000, y: 0, z: 0 }];
  assert.deepEqual(smoothTrail(straight), straight, 'rovná čiara bez nových bodov');

  const corner = [{ x: 0, y: 0, z: 0 }, { x: 1000, y: 0, z: 0 }, { x: 1000, y: 1000, z: 0 }, { x: 1000, y: 2000, z: 0 }];
  const smooth = smoothTrail(corner);
  assert.ok(smooth.length > corner.length, 'v 90° zákrute pribudli body');
  let k = 0;
  for (const p of smooth) if (k < corner.length && p.x === corner[k].x && p.y === corner[k].y) k += 1;
  assert.equal(k, corner.length, 'všetky pôvodné body v pôvodnom poradí');
  // Najostrejší uhol medzi susednými úsekmi je po zaoblení oveľa menší než 90°.
  const maxTurn = (pts) => {
    let worst = 0;
    for (let i = 1; i < pts.length - 1; i += 1) {
      const u = [pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y];
      const v = [pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y];
      const cos = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v));
      worst = Math.max(worst, (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI);
    }
    return worst;
  };
  assert.ok(maxTurn(smooth) < 35, `zákruta bez ostrej hrany (najväčší zlom ${maxTurn(smooth).toFixed(0)}°)`);
  // Krivka prechádza presne nameraným rohom, takže ho mierne obíde zvonka — najviac o 10 % úseku
  // (pri ostrom 90° zlome s bodmi 1 km od seba 74 m), žiadna slučka.
  for (const p of smooth) assert.ok(p.x <= 1100 && p.y >= -100, `bez slučky (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`);
  assert.deepEqual(smoothTrail([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]).length, 2, 'dva body bez zmeny');
});

test('zapojenie: civilné aj vojenské lety majú trajektóriu podľa výšky a zaoblenú', async () => {
  const { readFileSync } = await import('node:fs');
  for (const file of ['./flights.js', './militaryFlights.js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(src, /createTrail\(_viewer, \{ color: TRAIL_COLOR, width: 2\.4, altitudeColors: true, smooth: true \}\)/, file);
    assert.match(src, /_updateTrailHeadColor\(\);/, `${file}: hlava čiary sa farbí podľa výšky`);
  }
});
