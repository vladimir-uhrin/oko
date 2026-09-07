// src/starfield.test.mjs
// Ostré hviezdy: vlastný skybox z generovaných bodov (2026-09-07).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STARFIELD_FACES,
  STARFIELD_FACE_PX,
  STARFIELD_STAR_COUNT,
  STAR_TINTS,
  cubeFaceOf,
  generateStars,
  installSharpStarfield,
  mulberry32,
  paintStarfieldFaces,
  starBrightness,
} from './starfield.js';

test('PRNG je deterministický a v rozsahu 0..1', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const seqA = Array.from({ length: 5 }, () => a());
  const seqB = Array.from({ length: 5 }, () => b());
  assert.deepEqual(seqA, seqB);
  assert.ok(seqA.every((v) => v >= 0 && v < 1));
  assert.notDeepEqual(seqA, Array.from({ length: 5 }, mulberry32(43)));
});

test('hviezdy: rovnomerne na guli, jas „veľa slabých, málo jasných", deterministické zo semienka', () => {
  const stars = generateStars(6000, 7);
  assert.equal(stars.length, 6000);
  for (const s of stars.slice(0, 200)) {
    assert.ok(Math.abs(Math.hypot(s.x, s.y, s.z) - 1) < 1e-9, 'jednotkový smer');
    assert.ok(s.brightness >= 0 && s.brightness <= 1);
    assert.ok(STAR_TINTS[s.tint]);
  }
  // Rovnomernosť: každý oktant dostane zhruba 1/8 (±35 %).
  const octants = new Array(8).fill(0);
  for (const s of stars) octants[(s.x > 0 ? 1 : 0) + (s.y > 0 ? 2 : 0) + (s.z > 0 ? 4 : 0)] += 1;
  for (const n of octants) assert.ok(n > 750 * 0.65 && n < 750 * 1.35, `oktant ${n}`);
  const bright = stars.filter((s) => s.brightness > 0.8).length / stars.length;
  const faint = stars.filter((s) => s.brightness < 0.125).length / stars.length;
  assert.ok(bright < 0.15 && bright > 0.05, `jasných ${bright}`);
  assert.ok(faint > 0.3, `slabých ${faint}`);
  assert.deepEqual(generateStars(10, 99), generateStars(10, 99));
  assert.equal(starBrightness(1), 1);
  assert.equal(starBrightness(0.5), 0.25);
});

test('cube-map: stena podľa hlavnej osi, u/v v 0..1, stred steny = 0,5', () => {
  assert.deepEqual(cubeFaceOf({ x: 1, y: 0, z: 0 }), { face: 'positiveX', u: 0.5, v: 0.5 });
  assert.equal(cubeFaceOf({ x: -1, y: 0, z: 0 }).face, 'negativeX');
  assert.equal(cubeFaceOf({ x: 0, y: 1, z: 0 }).face, 'positiveY');
  assert.equal(cubeFaceOf({ x: 0, y: -1, z: 0 }).face, 'negativeY');
  assert.equal(cubeFaceOf({ x: 0, y: 0, z: 1 }).face, 'positiveZ');
  assert.equal(cubeFaceOf({ x: 0, y: 0, z: -1 }).face, 'negativeZ');
  for (const s of generateStars(500, 3)) {
    const { face, u, v } = cubeFaceOf(s);
    assert.ok(STARFIELD_FACES.includes(face));
    assert.ok(u >= 0 && u <= 1 && v >= 0 && v <= 1, `${u},${v}`);
  }
});

function fakeDoc() {
  const canvases = [];
  return {
    canvases,
    createElement() {
      const ops = { fillRect: 0, arc: 0, gradient: 0 };
      const ctx = {
        ops,
        fillStyle: null,
        fillRect() { ops.fillRect += 1; },
        beginPath() {},
        arc() { ops.arc += 1; },
        fill() {},
        createRadialGradient() { ops.gradient += 1; return { addColorStop() {} }; },
      };
      const canvas = { width: 0, height: 0, ctx, getContext: () => ctx, toDataURL: () => 'data:image/png;base64,x' };
      canvases.push(canvas);
      return canvas;
    },
  };
}

test('steny: šesť plátien danej veľkosti, čierne pozadie, body ostré (halo len pri jasných)', () => {
  const doc = fakeDoc();
  const faces = paintStarfieldFaces(doc, { facePx: 256, count: 2000, seed: 5 });
  assert.deepEqual(Object.keys(faces).sort(), [...STARFIELD_FACES].sort());
  assert.equal(doc.canvases.length, 6);
  assert.ok(doc.canvases.every((c) => c.width === 256 && c.height === 256));
  const totalRects = doc.canvases.reduce((n, c) => n + c.ctx.ops.fillRect, 0);
  const totalArcs = doc.canvases.reduce((n, c) => n + c.ctx.ops.arc, 0);
  const totalGradients = doc.canvases.reduce((n, c) => n + c.ctx.ops.gradient, 0);
  assert.ok(totalRects >= 2000 + 6, 'každá hviezda aspoň jeden fillRect + pozadie');
  assert.ok(totalArcs > 2000 * 0.08 && totalArcs < 2000 * 0.25, 'halo/kruh len pri jasných (~16 %)');
  assert.equal(totalArcs, totalGradients, 'halo ide s kruhom jasnej hviezdy');
  assert.equal(STARFIELD_FACE_PX, 2048, '2048 px na stenu — pri 60° FOV ≈ 1,3 px na px obrazovky');
  assert.ok(STARFIELD_STAR_COUNT >= 5000 && STARFIELD_STAR_COUNT <= 20000);
});

test('inštalácia: vymení skybox a vie ho vrátiť; bez scény/dokumentu no-op', () => {
  const doc = fakeDoc();
  const scene = { skyBox: 'old', renders: 0, requestRender() { this.renders += 1; } };
  let built = null;
  const revert = installSharpStarfield({ scene }, { doc, skyBoxFactory: (faces) => { built = faces; return { sources: Object.keys(faces) }; } });
  assert.ok(built && Object.keys(built).length === 6);
  assert.deepEqual(scene.skyBox, { sources: [...STARFIELD_FACES] });
  assert.equal(scene.renders, 1);
  revert();
  assert.equal(scene.skyBox, 'old');
  assert.equal(installSharpStarfield(null), null);
  assert.equal(installSharpStarfield({ scene }, { doc: {} }), null);

  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /installSharpStarfield\(viewer\)/, 'main.js vie zapnúť ostrú oblohu');
  assert.match(main, /get\('stars'\) === 'sharp'/, 'predvolená je obloha Cesia, ostrá len cez ?stars=sharp (používateľ 2026-09-07)');
});
