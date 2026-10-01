// src/data/eventVideoScene.test.mjs — 3D video udalosti v štýle OKO (2026-10-01, vlastník: „v OKO
// style", „nie je tam samotný pád"). Testy SPRÁVANIA čistej časti záberu na FZ1073 zo skutočných stôp
// aj na umelom lete: kamera kolmo na hlavný smer letu, úvod a záver celý región nad kartou, pád zboku
// a zblízka, obrat zhora, diera s pádom celá v zábere, prechody bez skokov; lietadlo nikdy nejde dierou
// (stojí bledé na poslednom meraní); značky momentov sedia na čiare stopy; bledá celá stopa len v úvode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simplifyTrack } from './eventCard.js';
import { keyMoments } from './eventPost.js';
import { videoPlan } from './eventVideo.js';
import { FT_M, VIDEO_CAMERA, distKm, eventVideoScene, normDeg } from './eventVideoScene.js';
import { normalizeTrack } from './flightAnomalies.js';
import { fz1073, fz1073Event } from './fixtures/flightEventFixtures.mjs';

async function fzScene() {
  const e = await fz1073Event();
  const { oko, adsblol } = fz1073();
  e.track = simplifyTrack(normalizeTrack([...oko, ...adsblol]));
  const plan = videoPlan(e);
  return { e, plan, scene: eventVideoScene(e, plan) };
}
const framesOf = (plan, piece) => [Math.ceil(piece.start * plan.fps - 1e-9), Math.ceil((piece.start + piece.dur) * plan.fps - 1e-9) - 1];
const mid = (plan, piece) => { const [a, b] = framesOf(plan, piece); return Math.round((a + b) / 2); };

test('kamera kolmo na hlavný smer letu, z tej strany bližšie k pohľadu na sever; úvod a záver celý región nad kartou', async () => {
  const { plan, scene } = await fzScene();
  assert.ok(Math.abs(scene.heading) <= 90, `pohľad skôr na sever (${scene.heading.toFixed(0)}°)`);
  // Hlavný smer FZ1073 v okne: ZSZ – VJV (od Dubaja na západ, obrat, späť) → kamera kolmo.
  const first = scene.frame(0);
  const last = scene.frame(plan.totalFrames - 1);
  for (const f of [first, last]) {
    assert.ok(f.camera.range >= scene.extentKm * 1000 * 2, 'celý región');
    assert.ok(Math.abs(f.camera.pitch - VIDEO_CAMERA.wide.pitch) < 1e-6);
    assert.ok(distKm(f.camera, scene.center) < 1, 'stred regiónu');
  }
  assert.ok(Math.abs(first.camera.lookDown - VIDEO_CAMERA.wide.lookDownIntro) < 1e-6, 'úvod: región nad kartou letu');
  assert.ok(Math.abs(last.camera.lookDown - VIDEO_CAMERA.wide.lookDownOutro) < 1e-6, 'záver: región nad súhrnom');
  assert.equal(first.ghost, 1, 'celá stopa bledo v úvode');
  const play = plan.pieces.find((p) => p.phase === 'play');
  assert.equal(scene.frame(framesOf(plan, play)[0] + Math.round(1.3 * plan.fps)).ghost, 0, 'potom dozneje');
});

test('pád zboku a zblízka, obrat zhora, diera s pádom celá v zábere, inak lietadlo zboku z ~88 km', async () => {
  const { e, plan, scene } = await fzScene();
  const ms = keyMoments(e);
  const holdOf = (kind) => plan.pieces.find((p) => p.phase === 'moment' && ms[p.moment].kind === kind);
  const dive = scene.frame(mid(plan, holdOf('dive')));
  assert.ok(Math.abs(dive.camera.pitch - VIDEO_CAMERA.dive.pitch) < 1, `pád zboku (${dive.camera.pitch.toFixed(1)}°)`);
  assert.ok(dive.camera.range < 60_000, 'zblízka');
  assert.ok(distKm(dive.camera, dive.plane) < 15, 'lietadlo v zábere');
  const turn = scene.frame(mid(plan, holdOf('uturn')));
  assert.ok(Math.abs(turn.camera.pitch - VIDEO_CAMERA.uturn.pitch) < 1, `obrat zhora (${turn.camera.pitch.toFixed(1)}°)`);
  const gap = plan.pieces.find((p) => p.phase === 'gap');
  const g = scene.gaps[0];
  const inGap = scene.frame(mid(plan, gap));
  assert.ok(Math.abs(inGap.camera.pitch - VIDEO_CAMERA.gapDrop.pitch) < 2, 'diera s pádom zboku');
  assert.ok(inGap.camera.range >= g.lenKm * VIDEO_CAMERA.gapDrop.perKmM * 0.9, 'celá čiarkovaná čiara v zábere');
  const plain = plan.pieces.filter((p) => p.phase === 'play' && p.dur > 1.2).find((p) => {
    const f = scene.frame(mid(plan, p));
    return Math.abs(f.camera.pitch - VIDEO_CAMERA.follow.pitch) < 0.5;
  });
  assert.ok(plain, 'bežný let: sledovanie zboku');
  const f = scene.frame(mid(plan, plain));
  assert.ok(Math.abs(f.camera.range - VIDEO_CAMERA.follow.rangeM) < 1 && distKm(f.camera, f.plane) < 0.5);
});

test('prechody kamery bez skokov (aj pri diere, zastavení a závere): malé zmeny zo snímky na snímku', async () => {
  const { plan, scene } = await fzScene();
  let prev = scene.frame(0).camera;
  for (let i = 1; i < plan.totalFrames; i += 1) {
    const c = scene.frame(i).camera;
    assert.ok(Math.abs(c.pitch - prev.pitch) < 3, `snímka ${i}: sklon ${prev.pitch.toFixed(1)} → ${c.pitch.toFixed(1)}`);
    assert.ok(Math.abs(Math.log(c.range / prev.range)) < 0.12, `snímka ${i}: vzdialenosť ${prev.range.toFixed(0)} → ${c.range.toFixed(0)}`);
    assert.ok(Math.abs(normDeg(c.heading - prev.heading)) < 4, `snímka ${i}: smer`);
    assert.ok(distKm(c, prev) < 8, `snímka ${i}: cieľ sa posunul o ${distKm(c, prev).toFixed(1)} km`);
    prev = c;
  }
});

test('lietadlo nikdy nejde dierou: stojí bledé na poslednom meraní, za dierou je na ďalšom meraní; značky na čiare stopy', async () => {
  const { e, plan, scene } = await fzScene();
  const g = scene.gaps[0];
  const gap = plan.pieces.find((p) => p.phase === 'gap');
  const [a, b] = framesOf(plan, gap);
  for (let i = a; i <= b; i += 1) {
    const p = scene.frame(i).plane;
    assert.deepEqual([p.lat, p.lon, p.altFt, p.dim, p.gap], [g.a[1], g.a[2], g.a[3], true, true], `snímka ${i}`);
  }
  const after = scene.frame(b + 2).plane;
  assert.ok(!after.gap && distKm(after, { lat: g.b[1], lon: g.b[2] }) < 3, 'za dierou na ďalšom meraní');
  // Značka na čiare stopy: výška stopy v čase momentu (medzi susednými meraniami; v diere posledné meranie).
  const data = scene.sceneData();
  keyMoments(e).forEach((m, i) => {
    const a = e.track.filter((p) => p[0] <= m.t).at(-1);
    const b = e.track.find((p) => p[0] >= m.t);
    const onLine = !b || b === a || b[0] - a[0] >= 300 ? a[3] : a[3] + ((b[3] - a[3]) * (m.t - a[0])) / (b[0] - a[0]);
    assert.ok(Math.abs(data.moments[i].altM - onLine * FT_M) < 1, `značka ${i + 1} na čiare stopy`);
  });
});

test('všeobecne: umelý let s klesaním a obratom bez dier — scéna, žiadna diera, lietadlo stále v pohybe (nebledé)', () => {
  const T0 = 1_790_000_000;
  const lons = [30.0, 30.2, 30.4, 30.6, 30.8, 30.6, 30.4, 30.2];
  const track = lons.map((lon, i) => [T0 + i * 60, 30, lon, 30_000 - i * 1000]);
  const e = {
    id: 'abc123-20260922T1320', status: 'unverified', firstT: track[2][0], lastT: track[4][0], track,
    timeline: [
      { kind: 'dive', t: track[2][0], fpm: -12_000, alt: 9000, lat: 30, lon: 30.4, seenBy: ['opensky'] },
      { kind: 'uturn', t: track[4][0], turnDeg: -180, lat: 30, lon: 30.8, seenBy: ['opensky'] },
    ],
  };
  const plan = videoPlan(e);
  const scene = eventVideoScene(e, plan);
  assert.equal(scene.gaps.length, 0);
  const outro = plan.pieces.at(-1);
  for (let i = 0; i < Math.floor(outro.start * plan.fps) - 1; i += 7) assert.equal(scene.frame(i).plane.dim, false, `snímka ${i}`);
  assert.equal(scene.frame(plan.totalFrames - 1).plane.ended, true, 'koniec údajov na poslednom meraní');
  assert.equal(eventVideoScene(e, null), null);
});

test('otvorenie a koncová karta: prílet z obežnej dráhy do regiónu a odlet späť, plynulo (bez skokov)', async () => {
  const { e } = await fzScene();
  const plan = videoPlan(e, { openingS: 2.6, endCardS: 3 });
  const scene = eventVideoScene(e, plan);
  const first = scene.frame(0).camera;
  const last = scene.frame(plan.totalFrames - 1).camera;
  for (const c of [first, last]) {
    assert.ok(c.range >= VIDEO_CAMERA.orbit.rangeM * 0.99, `z obežnej dráhy (${Math.round(c.range / 1000)} km)`);
    assert.ok(Math.abs(c.pitch - VIDEO_CAMERA.orbit.pitch) < 0.5 && distKm(c, scene.center) < 1);
  }
  const arrived = scene.frame(Math.round((scene.opening.start + scene.opening.dur) * plan.fps)).camera;
  assert.ok(arrived.range < scene.extentKm * 1000 * 3, 'po otvorení celý región');
  const playing = scene.frame(Math.round((scene.playStart + 3) * plan.fps));
  assert.equal(playing.ghost, 0);
  let prev = first;
  for (let i = 1; i < plan.totalFrames; i += 1) {
    const c = scene.frame(i).camera;
    assert.ok(Math.abs(Math.log(c.range / prev.range)) < 0.12 && Math.abs(c.pitch - prev.pitch) < 3 && distKm(c, prev) < 8, `snímka ${i}`);
    prev = c;
  }
});
