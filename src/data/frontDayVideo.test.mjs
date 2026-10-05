// Plán denného videa „Deň na fronte": 9:16, háčik hneď, zábery podľa viet, akčný záber bez mapy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY_OVERVIEW_CAMERA, DAY_UKRAINE_CAMERA, FRONT_DAY_FORMAT, FRONT_DAY_VIDEO, frontDayPlan, openingCamera } from './frontDayVideo.js';

const lines = [
  { id: 'hook', shot: 'opening' }, { id: 'clashes', shot: 'overview' }, { id: 'top', shot: 'dir:pokrovsk' },
  { id: 'clip0', shot: 'clip:0' }, { id: 'air', shot: 'air' }, { id: 'strikes', shot: 'air' }, { id: 'portal', shot: 'closing' },
];
const dur = (s) => ({ lead: 0.1, speechEnd: 0.1 + s });
const durations = { hook: dur(3.2), clashes: dur(4), top: dur(3.4), clip0: dur(2.9), air: dur(4.6), strikes: dur(3.1), portal: dur(3.5) };

test('formát 9:16 a háčik od začiatku: reč začína do 0,3 s', () => {
  assert.deepEqual(FRONT_DAY_FORMAT, { w: 1080, h: 1920 });
  const plan = frontDayPlan({ story: 'air' }, lines, durations);
  assert.ok(plan.placement[0].speechStart <= 0.3, `háčik začína ${plan.placement[0].speechStart} s`);
  assert.deepEqual(plan.shots.map((s) => s.id), ['opening', 'overview', 'dir:pokrovsk', 'clip:0', 'air', 'closing']);
  assert.ok(plan.durationS > 25 && plan.durationS < 45, `dĺžka ${plan.durationS}`);
});

test('nahrávka s dlhším tichom na začiatku než úvod záberu nezačne pred 0 s (ffmpeg adelay)', () => {
  const plan = frontDayPlan({ story: 'air' }, lines, { ...durations, hook: { lead: 0.158, speechEnd: 3.4 } });
  assert.ok(plan.placement.every((p) => p.start >= 0), plan.placement.map((p) => p.start).join(', '));
  assert.ok(plan.placement[0].speechStart <= 0.3);
});

test('vety jedného záberu idú za sebou s medzerou; záber trvá aspoň minimum', () => {
  const plan = frontDayPlan({ story: 'air' }, lines, durations);
  const air = plan.placement.filter((p) => p.shot === 'air');
  assert.ok(Math.abs(air[1].speechStart - air[0].speechEnd - FRONT_DAY_VIDEO.gapS) < 1e-9);
  for (const s of plan.shots) assert.ok(s.dur >= (FRONT_DAY_VIDEO.minS[s.kind] ?? 0) - 1e-9, s.id);
  const clip = plan.shots.find((s) => s.kind === 'clip');
  assert.ok(clip.dur >= 3.6, 'akčný záber aspoň 3,6 s');
});

test('akčný záber: mapa sa nenahráva (clip = index), kamera stojí; potom prelet ďalej', () => {
  const plan = frontDayPlan({ story: 'air' }, lines, durations);
  const clip = plan.shots.find((s) => s.kind === 'clip');
  const mid = plan.at(Math.round((clip.start + clip.dur / 2) * plan.fps));
  assert.equal(mid.clip, 0);
  assert.deepEqual(mid.camera, plan.shots.find((s) => s.id === 'dir:pokrovsk').to, 'kamera ostane nad smerom');
  const air = plan.shots.find((s) => s.kind === 'air');
  assert.deepEqual(air.to, DAY_UKRAINE_CAMERA);
  assert.equal(plan.at(Math.round((air.start + 0.2) * plan.fps)).flying, true, 'z výrezu smeru prelet na celú Ukrajinu');
  assert.equal(plan.at(0).clip, null);
});

test('úvodná karta nad miestom príbehu: zmena mapy → smer, hrozba → celá Ukrajina, inak front', () => {
  assert.deepEqual(openingCamera('air', null), DAY_UKRAINE_CAMERA);
  assert.deepEqual(openingCamera('clashes', null), DAY_OVERVIEW_CAMERA);
  const ru = openingCamera('ru', 'huliaipole');
  assert.ok(ru.heightM < DAY_OVERVIEW_CAMERA.heightM && Math.abs(ru.lon - DAY_OVERVIEW_CAMERA.lon) < 6);
  const plan = frontDayPlan({ story: 'ru', focusSceneId: 'huliaipole' }, lines, durations);
  assert.equal(plan.at(0).layers.opening, 1);
  assert.equal(plan.at(plan.totalFrames - 1).layers.endCard, 1);
});
