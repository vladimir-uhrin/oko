// src/data/groundSnap.test.mjs
// Prestávka vzorkovania podľa ceny sampleHeight (2026-09-28): jedna vzorka nad
// fotorealistickými dlaždicami stojí ~116 ms, rozpočet 4 / 250 ms ju nebrzdil.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createGroundSnap, sampleCooldownMs } from './groundSnap.js';

test('sampleCooldownMs: 5 % vlákna → 19× cena vzorky, strop 5 s, pod 16 ms nič, nezmysly = 0', () => {
  assert.equal(sampleCooldownMs(116), 2204);
  assert.equal(sampleCooldownMs(16), 304);
  assert.equal(sampleCooldownMs(15.9), 0, 'lacnejšia než snímka — bez prestávky (testy s náhradou = 0 ms)');
  assert.equal(sampleCooldownMs(5), 0);
  assert.equal(sampleCooldownMs(1000), 5000, 'strop');
  assert.equal(sampleCooldownMs(0), 0);
  assert.equal(sampleCooldownMs(NaN), 0);
  assert.equal(sampleCooldownMs(-3), 0);
  assert.equal(sampleCooldownMs(100, 1), 0, 'podiel 1 = bez prestávky');
  assert.equal(sampleCooldownMs(100, 0.5), 100);
  assert.equal(sampleCooldownMs(20.7), 393, 'celé ms (Date.now je celočíselný)');
});

/** Náhradný viewer: vzorka „trvá" sampleMs na podstrčených hodinách. */
function fakeViewer(sampleMs, clock) {
  const calls = [];
  return {
    calls,
    scene: {
      primitives: { length: 0 },
      sampleHeight(carto) {
        calls.push(Cesium.Math.toDegrees(carto.longitude));
        clock.now += sampleMs;
        return 123;
      },
    },
  };
}

const A = Cesium.Cartesian3.fromDegrees(17.2, 48.17, 0);
const B = Cesium.Cartesian3.fromDegrees(17.21, 48.17, 0);

test('drahá vzorka zavrie vzorkovanie na 19× svoju cenu; lacná nie', () => {
  const clock = { now: 1_000_000 };
  const snap = createGroundSnap({ now: () => clock.now });
  const viewer = fakeViewer(116, clock);
  assert.equal(snap.heightFor(viewer, 'a', A), 123);
  assert.equal(viewer.calls.length, 1);
  // Druhý stroj hneď potom: bez vzorky, bez hodnoty (nič držané) — skúsi to neskôr.
  assert.equal(snap.heightFor(viewer, 'b', B), null);
  assert.equal(viewer.calls.length, 1, 'v prestávke sa nevzorkuje');
  clock.now += 2000;
  assert.equal(snap.heightFor(viewer, 'b', B), null, '116 + 2000 < 2204 ms prestávka');
  assert.equal(viewer.calls.length, 1);
  clock.now += 100;
  assert.equal(snap.heightFor(viewer, 'b', B), 123, 'po prestávke sa vzorkuje');
  assert.equal(viewer.calls.length, 2);
  // Cache prvého stroja odpovedá aj počas prestávky (žiadna vzorka).
  assert.equal(snap.heightFor(viewer, 'a', A), 123);
  assert.equal(viewer.calls.length, 2);

  const cheap = createGroundSnap({ now: () => clock.now });
  const viewer2 = fakeViewer(2, clock);
  assert.equal(cheap.heightFor(viewer2, 'a', A), 123);
  assert.equal(cheap.heightFor(viewer2, 'b', B), 123, 'lacná vzorka (2 ms) nebrzdí');
  assert.equal(viewer2.calls.length, 2);
});

test('hodiny skočia dozadu (podstrčený čas v testoch, NTP) → prestávka neblokuje', () => {
  const clock = { now: 5_000_000 };
  const snap = createGroundSnap({ now: () => clock.now });
  const viewer = fakeViewer(116, clock);
  assert.equal(snap.heightFor(viewer, 'a', A), 123);
  clock.now = 3_000_000;
  assert.equal(snap.heightFor(viewer, 'b', B), 123, 'starý deadline nesmie prežiť skok hodín');
  assert.equal(viewer.calls.length, 2);
});

test('prestávka neprepisuje okno 4 vzorky / 250 ms', () => {
  const clock = { now: 5_000_000 };
  const snap = createGroundSnap({ now: () => clock.now });
  const viewer = fakeViewer(20, clock); // 20 ms → 380 ms prestávka
  const positions = [0, 1, 2, 3, 4, 5].map((i) => Cesium.Cartesian3.fromDegrees(17 + i * 0.01, 48, 0));
  let sampled = 0;
  for (let i = 0; i < 6; i++) {
    if (snap.heightFor(viewer, 'p' + i, positions[i]) != null) sampled++;
    clock.now += 400; // > 380 ms prestávka; každé volanie v novom okne
  }
  assert.equal(sampled, 6, 'po prestávke sa vždy vzorkuje');
  const burst = createGroundSnap({ now: () => clock.now });
  const viewer3 = fakeViewer(1, clock); // bez prestávky → platí len okno
  let inWindow = 0;
  for (let i = 0; i < 6; i++) if (burst.heightFor(viewer3, 'q' + i, positions[i]) != null) inWindow++;
  assert.equal(inWindow, 4, 'okno pustí najviac 4 vzorky');
  assert.equal(viewer3.calls.length, 4);
});
