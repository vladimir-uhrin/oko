// src/flightReplay.test.mjs
// Prehrávač historického letu — hodiny, farby výšky, lifecycle bez WebGL (2026-09-07).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  REPLAY_ALTITUDE_STOPS,
  REPLAY_SPEEDS,
  ReplayClock,
  altitudeRgb,
  createFlightReplay,
} from './flightReplay.js';

const T0 = 1_757_000_000;
const fixes = [
  { t: T0, lat: 48, lon: 17, alt: 1000, gs: 100, trk: 90, vr: 5, squawk: null, gnd: false },
  { t: T0 + 60, lat: 48.1, lon: 17.2, alt: 3000, gs: 150, trk: 90, vr: 5, squawk: null, gnd: false },
  { t: T0 + 120, lat: 48.2, lon: 17.4, alt: 5000, gs: 200, trk: 90, vr: 0, squawk: null, gnd: false },
];

test('hodiny: rýchlosť × reálny čas, zastavia na konci, play od konca začne odznova, seek sa oreže', () => {
  const c = new ReplayClock(T0, T0 + 120);
  assert.equal(c.speed, 10, 'default 10×');
  c.play();
  assert.equal(c.advance(1000), true);
  assert.equal(c.t, T0 + 10);
  c.setSpeed(300);
  c.advance(1000);
  assert.equal(c.t, T0 + 120, 'orezané na koniec');
  assert.equal(c.playing, false, 'na konci sa zastaví');
  assert.equal(c.fraction, 1);
  c.play();
  assert.equal(c.t, T0, 'play na konci = od začiatku');
  c.setSpeed(7);
  assert.equal(c.speed, 300, 'neznáma rýchlosť sa ignoruje');
  c.seekFraction(0.5);
  assert.equal(c.t, T0 + 60);
  c.seek(T0 - 999);
  assert.equal(c.t, T0);
  assert.equal(c.advance(-5), false);
  assert.deepEqual([...REPLAY_SPEEDS], [1, 10, 60, 300]);
});

test('farba podľa výšky: jantár pri zemi → azúr v cestovnej hladine → biela vysoko, spojito', () => {
  assert.deepEqual(altitudeRgb(0), REPLAY_ALTITUDE_STOPS[0][1]);
  assert.deepEqual(altitudeRgb(11_000), REPLAY_ALTITUDE_STOPS[2][1]);
  assert.deepEqual(altitudeRgb(99_999), REPLAY_ALTITUDE_STOPS[3][1]);
  const mid = altitudeRgb(3000);
  const [a, b] = [REPLAY_ALTITUDE_STOPS[0][1], REPLAY_ALTITUDE_STOPS[1][1]];
  for (let k = 0; k < 3; k += 1) assert.ok(Math.abs(mid[k] - (a[k] + (b[k] - a[k]) * 0.5)) < 1e-9);
  assert.deepEqual(altitudeRgb(NaN), REPLAY_ALTITUDE_STOPS[0][1]);
});

function fakeViewer() {
  const prims = [];
  const ents = [];
  return {
    prims,
    ents,
    trackedEntity: undefined,
    scene: { primitives: { add: (p) => prims.push(p), remove: (p) => { const i = prims.indexOf(p); if (i >= 0) prims.splice(i, 1); } }, requestRender() {} },
    entities: { add: (e) => { ents.push(e); return e; }, remove: (e) => { const i = ents.indexOf(e); if (i >= 0) ents.splice(i, 1); } },
    camera: { flyToBoundingSphere() {} },
  };
}

test('prehrávač: load stavia trasu a značku, seek/play/pause/follow, destroy uprace; rAF slučka injektovaná', () => {
  const viewer = fakeViewer();
  const frames = [];
  let nowMs = 0;
  const replay = createFlightReplay(viewer, {
    trackFactory: (fx) => ({ kind: 'track', n: fx.length }),
    requestFrame: (cb) => { frames.push(cb); return frames.length; },
    cancelFrame: () => {},
    now: () => nowMs,
  });
  assert.equal(replay.load([fixes[0]]), false, 'jeden fix sa neprehráva');
  assert.equal(replay.load(fixes), true);
  assert.equal(viewer.prims.length, 1);
  assert.equal(viewer.prims[0].n, 3);
  assert.equal(viewer.ents.length, 1, 'značka lietadla');
  const states = [];
  replay.onChange((s) => states.push(s));
  replay.seekFraction(0.5);
  let st = replay.getState();
  assert.equal(st.t, T0 + 60);
  assert.ok(Math.abs(st.sample.alt - 3000) < 1e-6);
  assert.equal(st.playing, false);
  replay.play();
  assert.equal(replay.getState().playing, true);
  assert.equal(frames.length, 1, 'slučka požiadala o snímok');
  nowMs = 1000; frames[0]();       // prvý snímok len nastaví čas
  nowMs = 2000; frames[1]();       // 1 s × 10× = +10 s
  assert.equal(replay.getState().t, T0 + 70);
  replay.setSpeed(60);
  nowMs = 3000; frames[2]();
  assert.equal(replay.getState().t, T0 + 120, 'orezané na koniec');
  assert.equal(replay.getState().playing, false);
  replay.setFollow(true);
  assert.equal(viewer.trackedEntity, viewer.ents[0], 'follow = trackedEntity je značka');
  replay.setFollow(false);
  assert.equal(viewer.trackedEntity, undefined);
  assert.ok(states.length >= 3, 'poslucháč dostáva zmeny');
  replay.load([]);
  assert.equal(viewer.prims.length, 0);
  assert.equal(viewer.ents.length, 0);
  assert.equal(replay.getState().loaded, false);
  replay.destroy();
});

test('tripwire: značka používa siluetu a orientáciu flotily; panel je zapojený v ui a markupu', () => {
  const src = readFileSync(new URL('./flightReplay.js', import.meta.url), 'utf8');
  assert.match(src, /aircraftIcon\(kind, 64, false, 'cyan'\)/);
  assert.match(src, /screenProjectedRotation\(viewer\.scene, currentPos/);
  assert.match(src, /alignedAxis: Cesium\.Cartesian3\.ZERO/);
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  assert.match(ui, /this\._historyPanel = installHistoryPanel\(\{/);
  assert.match(ui, /case 'history':/);
  assert.match(ui, /\{ id: 'history-panel' \}/, 'panel v registri zdieľaného stavu');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="history-panel"[^>]*data-panel-id="history-panel"/);
  assert.match(html, /data-history-body/);
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /#left-panel-stack > #history-panel \{ order: 5; \}/);
  assert.match(css, /body\.cockpit-mode #left-panel-stack > #history-panel \{ display: none !important; \}/);
});
