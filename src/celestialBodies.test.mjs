// src/celestialBodies.test.mjs
// Slnko a Mesiac na prstenci ako telesá s fázou (2026-09-07).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CELESTIAL_MARKER_PX,
  MOON_RADIUS_RATIO,
  SUN_RADIUS_RATIO,
  brightLimbAngle,
  drawMoonDisc,
  drawSunDisc,
  markerRenderKey,
  moonIllumination,
  prepareMarkerCanvas,
} from './celestialBodies.js';

function stubCtx() {
  const calls = [];
  const rec = (name) => (...args) => { calls.push([name, ...args]); };
  return {
    calls,
    save: rec('save'), restore: rec('restore'), translate: rec('translate'), rotate: rec('rotate'),
    beginPath: rec('beginPath'), closePath: rec('closePath'), arc: rec('arc'), ellipse: rec('ellipse'),
    fill: rec('fill'), stroke: rec('stroke'), clip: rec('clip'), clearRect: rec('clearRect'), setTransform: rec('setTransform'),
    createRadialGradient: () => ({ addColorStop() {} }),
    fillStyle: null, strokeStyle: null, lineWidth: 1,
  };
}

test('fáza: nov pri Slnku (0), spln oproti (1), kvadratúra 0,5 — z geocentrických smerov', () => {
  const sun = { x: 1, y: 0, z: 0 };
  assert.ok(Math.abs(moonIllumination(sun, { x: 1, y: 0, z: 0 }).fraction) < 1e-9, 'nov');
  assert.ok(Math.abs(moonIllumination(sun, { x: -1, y: 0, z: 0 }).fraction - 1) < 1e-9, 'spln');
  const quarter = moonIllumination(sun, { x: 0, y: 1, z: 0 });
  assert.ok(Math.abs(quarter.fraction - 0.5) < 1e-9, 'prvá/posledná štvrť');
  assert.ok(Math.abs(quarter.elongationRad - Math.PI / 2) < 1e-9);
  // Mierne nenormalizovaný vstup nesmie vyhodiť NaN (clamp na ±1).
  assert.equal(Number.isFinite(moonIllumination({ x: 1.0000001, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }).fraction), true);
});

test('jasný okraj mieri od Mesiaca k Slnku po prstenci', () => {
  // Slnko vpravo (0), Mesiac vľavo (π): okraj mieri doprava (0).
  assert.ok(Math.abs(brightLimbAngle(0, Math.PI)) < 1e-9);
  // Slnko hore (−π/2 v canvase), Mesiac dole (π/2): okraj hore.
  assert.ok(Math.abs(brightLimbAngle(-Math.PI / 2, Math.PI / 2) + Math.PI / 2) < 1e-9);
});

test('kreslenie Mesiaca: kosák uberá elipsu (evenodd), gibbous pridáva, nov bez svetlej časti', () => {
  const crescent = stubCtx();
  drawMoonDisc(crescent, 11, 11, 9, 0.25, 0);
  const crescentFills = crescent.calls.filter((c) => c[0] === 'fill');
  assert.ok(crescentFills.some((c) => c[1] === 'evenodd'), 'kosák = polkruh mínus elipsa');
  const crescentEllipse = crescent.calls.find((c) => c[0] === 'ellipse');
  assert.ok(Math.abs(crescentEllipse[3] - 9 * 0.5) < 1e-9, 'polos elipsy r·(1−2f)');

  const gibbous = stubCtx();
  drawMoonDisc(gibbous, 11, 11, 9, 0.75, 1);
  assert.ok(!gibbous.calls.some((c) => c[0] === 'fill' && c[1] === 'evenodd'));
  const gibbousEllipse = gibbous.calls.find((c) => c[0] === 'ellipse');
  assert.ok(Math.abs(gibbousEllipse[3] - 9 * 0.5) < 1e-9, 'polos elipsy r·(2f−1)');
  assert.ok(gibbous.calls.some((c) => c[0] === 'rotate' && c[1] === 1), 'natočené k Slnku');

  const newMoon = stubCtx();
  drawMoonDisc(newMoon, 11, 11, 9, 0, 0);
  assert.ok(!newMoon.calls.some((c) => c[0] === 'ellipse'), 'nov: žiadna svetlá časť');
  assert.ok(newMoon.calls.some((c) => c[0] === 'stroke'), 'nov: tenký obrys, nech kotúč nezmizne');

  const sun = stubCtx();
  drawSunDisc(sun, 11, 11, 7);
  const arcs = sun.calls.filter((c) => c[0] === 'arc');
  assert.equal(arcs.length, 2, 'koróna + disk');
  assert.ok(arcs[0][3] > arcs[1][3], 'koróna je väčšia než disk');
});

test('telesá sú výrazné: značka ≥ 32 px, disky zaberajú väčšinu plátna (používateľ: „slabučké")', () => {
  assert.ok(CELESTIAL_MARKER_PX >= 32, `značka ${CELESTIAL_MARKER_PX}px`);
  assert.ok(SUN_RADIUS_RATIO >= 0.55 && SUN_RADIUS_RATIO * 1.72 <= 1.0, 'Slnko s korónou sa zmestí do plátna');
  assert.ok(MOON_RADIUS_RATIO >= 0.75 && MOON_RADIUS_RATIO <= 0.9);
  const ring = readFileSync(new URL('./celestialRing.js', import.meta.url), 'utf8');
  assert.match(ring, /half \* SUN_RADIUS_RATIO/);
  assert.match(ring, /half \* MOON_RADIUS_RATIO/);
});

test('plátno značky: DPR škálovanie, CSS rozmer, kľúč prekreslenia', () => {
  const ctx = stubCtx();
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx };
  assert.equal(prepareMarkerCanvas(canvas, 2), ctx);
  assert.equal(canvas.width, CELESTIAL_MARKER_PX * 2);
  assert.equal(canvas.style.width, `${CELESTIAL_MARKER_PX}px`);
  assert.ok(ctx.calls.some((c) => c[0] === 'setTransform' && c[1] === 2));
  assert.equal(prepareMarkerCanvas({ width: 0, height: 0, style: {} }, 1), null, 'bez 2D kontextu null');
  assert.equal(markerRenderKey(0.4321, 1.2345, 2), '0.43:1.23:2');
  assert.equal(markerRenderKey(0.4321, 1.2345, 2), markerRenderKey(0.434, 1.231, 2), 'malé zmeny neprekresľujú');
});

test('tripwire: prstenec kreslí telesá na plátna, nie Material Symbols glyfy', () => {
  const ring = readFileSync(new URL('./celestialRing.js', import.meta.url), 'utf8');
  assert.doesNotMatch(ring, /textContent = 'light_mode'|textContent = 'dark_mode'/, 'glyfy sú preč');
  assert.match(ring, /drawMoonDisc\(/);
  assert.match(ring, /drawSunDisc\(/);
  assert.match(ring, /moonIllumination\(this\._sunFixed, this\._moonFixed\)/, 'fáza zo skutočných vektorov prstenca');
  assert.match(ring, /markerRenderKey\(/, 'kreslí sa len pri zmene kľúča');
});
