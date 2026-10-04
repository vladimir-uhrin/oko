// src/data/frontWeekVideo.test.mjs — plán videa „Týždeň na fronte": zábery trvajú toľko, čo ich vety,
// veta nikdy nepresiahne svoj záber, kamera letí z prehľadu nad smer a späť, vrstvy popisov sa prelínajú.
import test from 'node:test';
import assert from 'node:assert/strict';

import { FRONT_WEEK_VIDEO, OVERVIEW_CAMERA, directionCamera, flyCamera, frontWeekPlan, overlapLosers } from './frontWeekVideo.js';
import { FRONT_SCENES } from '../ukraineFrontScenes.js';

const LINES = [
  { id: 'a', shot: 'opening' },
  { id: 'b', shot: 'overview' },
  { id: 'c', shot: 'overview' },
  { id: 'd', shot: 'dir:pokrovsk' },
  { id: 'e', shot: 'closing' },
];
// lead = ticho na začiatku nahrávky, speechEnd = koniec reči v nahrávke.
const DUR = {
  a: { lead: 0.2, speechEnd: 4.2 },
  b: { lead: 0.1, speechEnd: 2.1 },
  c: { lead: 0.15, speechEnd: 3.15 },
  d: { lead: 0.2, speechEnd: 1.2 },
  e: { lead: 0.1, speechEnd: 2.6 },
};
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('záber trvá ako jeho vety: nábeh + reč + medzery + dozvuk', () => {
  const plan = frontWeekPlan({}, LINES, DUR);
  assert.deepEqual(plan.shots.map((s) => s.id), ['opening', 'overview', 'dir:pokrovsk', 'closing']);
  const [opening, overview, dir, closing] = plan.shots;
  near(opening.dur, 0.3 + 4.0 + FRONT_WEEK_VIDEO.tailS);
  near(overview.start, opening.dur);
  near(overview.dur, 0.6 + 2.0 + FRONT_WEEK_VIDEO.gapS + 3.0 + FRONT_WEEK_VIDEO.tailS);
  near(dir.dur, FRONT_WEEK_VIDEO.minS.dir, 1e-9);
  near(closing.dur, 0.5 + 2.5 + FRONT_WEEK_VIDEO.endMarginS);
  near(plan.durationS, opening.dur + overview.dur + dir.dur + closing.dur);
  assert.equal(plan.totalFrames, Math.round(plan.durationS * 30));
  assert.equal(plan.fps, 30);
});

test('každá veta znie vo svojom zábere a nahrávka začína o svoje ticho skôr', () => {
  const plan = frontWeekPlan({}, LINES, DUR);
  assert.deepEqual(plan.placement.map((p) => p.id), ['a', 'b', 'c', 'd', 'e']);
  for (const p of plan.placement) {
    const shot = plan.shots.find((s) => s.id === p.shot);
    assert.ok(p.speechStart >= shot.start - 1e-9 && p.speechEnd <= shot.start + shot.dur + 1e-9, `${p.id} mimo záberu`);
    near(p.start, p.speechStart - DUR[p.id].lead);
    near(p.speechEnd - p.speechStart, DUR[p.id].speechEnd - DUR[p.id].lead);
  }
  const [a, b, c] = plan.placement;
  near(a.speechStart, FRONT_WEEK_VIDEO.leadS.opening);
  near(c.speechStart - b.speechEnd, FRONT_WEEK_VIDEO.gapS);
  // Vety sa neprekrývajú ani cez hranice záberov.
  for (let i = 1; i < plan.placement.length; i += 1) assert.ok(plan.placement[i].speechStart > plan.placement[i - 1].speechEnd);
});

test('veta bez nahrávky sa preskočí, plán bez viet nie je', () => {
  const plan = frontWeekPlan({}, LINES, { ...DUR, c: undefined });
  assert.deepEqual(plan.placement.map((p) => p.id), ['a', 'b', 'd', 'e']);
  assert.equal(frontWeekPlan({}, [], DUR), null);
  assert.equal(frontWeekPlan({}, null, DUR), null);
});

test('kamera smeru: KARTA zhora nad výrezom smeru', () => {
  for (const scene of FRONT_SCENES.filter((s) => !s.overview)) {
    const cam = directionCamera(scene.id);
    const [w, s, e, n] = scene.rectDegrees;
    assert.equal(cam.pitchDeg, -80, scene.id);
    assert.ok(cam.lon > w && cam.lon < e, `${scene.id}: lon ${cam.lon}`);
    assert.ok(cam.lat > s - 1.5 && cam.lat < n, `${scene.id}: lat ${cam.lat} (kamera stojí južne od stredu a hľadí na sever)`);
    assert.ok(cam.heightM > 60_000 && cam.heightM < 260_000, `${scene.id}: výška ${cam.heightM}`);
  }
  assert.equal(directionCamera('neexistuje'), null);
});

test('prelet: začína a končí presne, uprostred s nadhľadom', () => {
  const b = directionCamera('pokrovsk');
  const start = flyCamera(OVERVIEW_CAMERA, b, 0);
  near(start.lon, OVERVIEW_CAMERA.lon); near(start.lat, OVERVIEW_CAMERA.lat); near(start.heightM, OVERVIEW_CAMERA.heightM, 1e-3); near(start.pitchDeg, OVERVIEW_CAMERA.pitchDeg);
  const end = flyCamera(OVERVIEW_CAMERA, b, 1);
  near(end.lon, b.lon); near(end.lat, b.lat); near(end.heightM, b.heightM, 1e-3); near(end.pitchDeg, b.pitchDeg);
  // Medzi dvoma smermi sa kamera zdvihne nad oba (vidno, kam sa letí).
  const a = directionCamera('lyman');
  assert.ok(flyCamera(a, b, 0.5).heightM > Math.max(a.heightM, b.heightM));
  near(flyCamera(a, b, 2).lon, b.lon); // mimo rozsahu sa drží cieľa
});

test('stav snímky: záber, kamera a vrstvy popisov', () => {
  const plan = frontWeekPlan({}, LINES, DUR);
  const fps = plan.fps;
  const [opening, overview, dir, closing] = plan.shots;
  const first = plan.at(0);
  assert.equal(first.shot.kind, 'opening');
  assert.deepEqual(first.layers, { opening: 1, main: 0, endCard: 0 });
  assert.equal(first.card, 'overview');
  // Koniec úvodu: karta háčika sa prelína do hlavnej vrstvy.
  const fadeOut = plan.at(Math.round((opening.dur - FRONT_WEEK_VIDEO.fadeS / 2) * fps));
  assert.ok(fadeOut.layers.opening > 0.2 && fadeOut.layers.opening < 0.8);
  near(fadeOut.layers.opening + fadeOut.layers.main, 1, 1e-9);

  const mid = plan.at(Math.round((overview.start + overview.dur / 2) * fps));
  assert.equal(mid.shot.id, 'overview');
  assert.deepEqual(mid.layers, { opening: 0, main: 1, endCard: 0 });
  assert.equal(mid.camera.lon, OVERVIEW_CAMERA.lon);
  assert.ok(mid.camera.heightM < OVERVIEW_CAMERA.heightM * 1.04 && mid.camera.heightM > OVERVIEW_CAMERA.heightM * 0.95, 'pomalé približovanie');

  // Smer: na začiatku kamera ešte v prehľade, po prelete nad smerom, karta patrí smeru.
  const dirStart = plan.at(Math.ceil(dir.start * fps) + 1);
  assert.equal(dirStart.shot.sceneId, 'pokrovsk');
  assert.equal(dirStart.card, 'pokrovsk');
  assert.ok(dirStart.cardAlpha < 0.2, 'karta smeru nabieha');
  assert.ok(dirStart.camera.heightM > 500_000);
  const dirLate = plan.at(Math.round((dir.start + FRONT_WEEK_VIDEO.flyS + 0.5) * fps));
  const target = directionCamera('pokrovsk');
  near(dirLate.camera.lon, target.lon); near(dirLate.camera.lat, target.lat);
  assert.ok(dirLate.camera.heightM <= target.heightM && dirLate.camera.heightM > target.heightM * 0.9);
  assert.equal(dirLate.cardAlpha, 1);

  // Záver: návrat na prehľad a koncová karta.
  const end = plan.at(plan.totalFrames - 1);
  assert.equal(end.shot.kind, 'closing');
  assert.equal(end.layers.endCard, 1);
  assert.equal(end.layers.main, 0);
  assert.equal(end.card, null);
  near(end.camera.lon, OVERVIEW_CAMERA.lon);
  // Snímka za koncom sa drží poslednej.
  assert.equal(plan.at(plan.totalFrames + 500).shot.kind, 'closing');
  // Záverečný prelet začína tam, kde skončil posledný smer.
  near(closing.from.lon, directionCamera('pokrovsk').lon);
  near(closing.from.heightM, directionCamera('pokrovsk').heightM);
});

test('prelet je len na začiatku záberu smeru a záveru (nahrávanie podľa neho riedi popisy mapy)', () => {
  const plan = frontWeekPlan({}, LINES, DUR);
  const [opening, overview, dir, closing] = plan.shots;
  const at = (s) => plan.at(Math.ceil(s * plan.fps) + 1);
  assert.equal(at(opening.start + 1).flying, false);
  assert.equal(at(overview.start).flying, false);
  assert.equal(at(dir.start).flying, true);
  assert.equal(at(dir.start + FRONT_WEEK_VIDEO.flyS - 0.2).flying, true);
  assert.equal(at(dir.start + FRONT_WEEK_VIDEO.flyS + 0.1).flying, false);
  assert.equal(at(closing.start + 0.5).flying, true);
  assert.equal(at(closing.start + FRONT_WEEK_VIDEO.flyS + 0.2).flying, false);
});

test('prekrývajúce sa popisy mapy: ostane dôležitejší; kto prehral, už nikoho neskrýva', () => {
  const box = (x0, x1, priority, y0 = 0, y1 = 20) => ({ x0, x1, y0, y1, priority });
  // KYIV (3 mil.) a BROVARY (100 tis.) cez seba, CHERKASY bokom.
  assert.deepEqual(overlapLosers([box(50, 110, 100_000), box(40, 90, 3_000_000), box(300, 380, 270_000)]), [0]);
  // Reťaz A–B–C: B prehrá s A; C sa dotýka len B, takže ostáva.
  assert.deepEqual(overlapLosers([box(0, 100, 900), box(90, 190, 500), box(180, 280, 100)]), [1]);
  // Rovnaká priorita: vyhrá skôr uvedený. Rôzne riadky sa neprekrývajú.
  assert.deepEqual(overlapLosers([box(0, 100, 5), box(50, 150, 5)]), [1]);
  assert.deepEqual(overlapLosers([box(0, 100, 5, 0, 20), box(0, 100, 1, 30, 50)]), []);
  // Dotyk hranou nie je prekryv.
  assert.deepEqual(overlapLosers([box(0, 100, 5), box(100, 200, 1)]), []);
  assert.deepEqual(overlapLosers([]), []);
  assert.deepEqual(overlapLosers(null), []);
});

test('neznámy smer nezhodí plán — kamera ostane v prehľade', () => {
  const plan = frontWeekPlan({}, [{ id: 'x', shot: 'dir:nikde' }], { x: { lead: 0, speechEnd: 2 } });
  const st = plan.at(Math.round(3 * plan.fps));
  assert.equal(st.shot.sceneId, 'nikde');
  near(st.camera.lon, OVERVIEW_CAMERA.lon);
});
