// src/preloaderFlow.test.mjs — víchor textu okolo oka v preloaderi ako úvod midjourney.com
// (2026-09-26/27, vlastník: „ja to chcem ako Midjourney… to oko v strede nemeň ani text").

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  FLOW_AMBER_WORDS, FLOW_STAGE_SPEEDS, FLOW_SWIRL, buildFlowBlock, clearRadius, flowStageSpeed,
  obstacleFromRect, startPreloaderFlow, swirlSource,
} from '../public/preloaderFlow.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('vír Midjourney: na začiatku rovný blok, uhol = hodiny × 0,1 / max(0,1; r), stred sa točí rýchlejšie', () => {
  const hw = 640; const hh = 360;
  const id = swirlSource(123, -45, hw, hh, 0);
  assert.ok(near(id.x, 123) && near(id.y, -45) && id.angle === 0, 'hodiny 0 = nezmenený blok');
  assert.deepEqual(FLOW_SWIRL, { rate: 0.1, core: 0.1 }, 'hodnoty Midjourney');
  const inner = swirlSource(64, 0, hw, hh, 5);   // r = 0,1
  const outer = swirlSource(576, 0, hw, hh, 5);  // r = 0,9
  assert.ok(near(inner.angle, 5) && near(outer.angle, 5 * 0.1 / 0.9), 'uhol klesá so vzdialenosťou');
  assert.ok(near(swirlSource(0, 0, hw, hh, 5).angle, 5), 'jadro je obmedzené (max(0,1; r))');
  // otočenie zachová vzdialenosť v normovaných súradniciach (vír je eliptický ako obrazovka)
  const p = swirlSource(300, 200, hw, hh, 7);
  assert.ok(near(Math.hypot(p.x / hw, p.y / hh), Math.hypot(300 / hw, 200 / hh), 1e-9));
});

test('voľný stred: zaoblený obdĺžnik tesne okolo .loader-content (oko + texty nezmenené, text ho obteká)', () => {
  const o = obstacleFromRect({ left: 500, top: 300, width: 260, height: 240 });
  assert.deepEqual(o, { cx: 630, cy: 420, a: 156, b: 138 });
  const small = obstacleFromRect({ left: 600, top: 300, width: 120, height: 100 });
  assert.equal(small.a, 150); assert.equal(small.b, 110);
  assert.ok(near(clearRadius(1, 0), 1) && near(clearRadius(0, 1), 1), 'okraj je r = 1');
  assert.ok(clearRadius(0.8, 0.8) < 1, 'rohy obdĺžnika sú vnútri (superelipsa, nie elipsa)');
});

test('stupne načítania zrýchľujú hodiny víru a orezávajú sa na posledný', () => {
  for (let i = 1; i < FLOW_STAGE_SPEEDS.length; i++) assert.ok(flowStageSpeed(i) > flowStageSpeed(i - 1));
  assert.equal(flowStageSpeed(99), FLOW_STAGE_SPEEDS.at(-1));
  assert.equal(flowStageSpeed(-3), FLOW_STAGE_SPEEDS[0]);
});

test('zdrojový blok ako prompty Midjourney: riadky „/oko …" zarovnané vľavo, rôznej dĺžky, občas prázdne', () => {
  const a = buildFlowBlock(183, 60); const b = buildFlowBlock(183, 60);
  assert.deepEqual(a.data, b.data, 'deterministické');
  assert.equal(a.data.length, 183 * 60);
  const filled = a.lines.filter(Boolean);
  assert.ok(filled.every((l) => l.startsWith('/oko ')), 'každý riadok začína /oko (ako /imagine)');
  assert.ok(a.lines.some((l) => l === ''), 'občas prázdny riadok');
  const lengths = filled.map((l) => l.length);
  assert.ok(Math.min(...lengths) < 183 * 0.5 && Math.max(...lengths) > 183 * 0.85, 'rôzne dĺžky — konce riadkov tvoria ramená špirály');
  for (let r = 0; r < 60; r++) {
    const line = a.lines[r];
    for (let c = line.length; c < 183; c++) assert.equal(a.data[r * 183 + c], 0, 'za koncom riadku je prázdno');
  }
  let letters = 0; let amber = 0;
  for (const code of a.data) { if (!code) continue; letters++; if (code & 128) amber++; assert.ok((code & 127) <= a.chars.length); }
  assert.ok(amber > 0 && amber / letters < 0.05, `jantárové (odhad/omeškané) sú výnimka: ${(amber / letters * 100).toFixed(1)} %`);
  for (const w of FLOW_AMBER_WORDS) assert.ok(!/ŽIVÉ/.test(w));
});

test('bez prehliadača / bez preloadera sa nič nespustí', () => {
  assert.equal(startPreloaderFlow({ doc: { getElementById: () => null }, win: {} }), null);
  const hidden = { classList: { contains: (c) => c === 'hidden' }, querySelector: () => ({}) };
  assert.equal(startPreloaderFlow({ doc: { getElementById: () => hidden }, win: {} }), null);
});

test('zapojenie: malý vstup PRED main.js, oko a texty preloadera bez zmeny, plátno pod obsahom', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const flow = html.indexOf('<script type="module" async src="/preloaderFlow.js"></script>');
  const main = html.indexOf('<script type="module" src="/src/main.js"></script>');
  assert.ok(flow > 0 && main > flow, 'preloaderFlow.js sa načíta pred main.js');
  // async: Vite presunie balík appky do <head>; bez async by sa preloader spustil až po ňom
  assert.ok(html.includes('<script type="module" async src="/preloaderFlow.js"></script>'));
  for (const line of [
    '<span class="loader-logo brand-logo" data-logo-gaze data-logo-src="/logo.svg" aria-hidden="true"><img src="/logo.svg" alt="" /><span class="brand-eye" aria-hidden="true"></span></span>',
    '<h2>OK<span class="title-accent">O</span></h2>',
    '<p class="loader-status" data-i18n="loader.start">Štartujem fotorealistický svet…</p>',
  ]) assert.ok(html.includes(line), `stred preloadera nezmenený: ${line.slice(0, 40)}…`);
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.loader-content \{\n {2}position: relative;\n {2}z-index: 1;/, 'obsah nad plátnom');
  assert.match(css, /#loader-flow \{\n {2}position: absolute;\n {2}inset: 0;/);
  assert.match(css, /html\.oko-preloader-demo #loading-screen\.hidden \{/, '?preloader=demo podrží preloader');
  const src = readFileSync(new URL('../public/preloaderFlow.js', import.meta.url), 'utf8');
  assert.ok(!/^import /m.test(src), 'bez importov — malý samostatný balík');
  assert.match(src, /loseContext\(\)/, 'po skrytí sa GPU kontext uvoľní');
  assert.match(src, /prefers-reduced-motion: reduce/);
  // obmedzený pohyb = pomalší vír, NIE nehybný obraz (vlastník 09-27: „zostane zamrznuté")
  assert.match(src, /const CALM_SPEED = 0\.5;/);
  assert.match(src, /\* \(calm \? CALM_SPEED : 1\);/);
  assert.ok(!/still/.test(src), 'žiadna nehybná vetva');
  assert.match(src, /querySelector\?\.\('\.loader-logo'\)/, 'vír sa točí okolo oka');
});

test('nároky (vlastník: „mimoriadne náročné na hardvér"): 30 snímok/s, najviac 1,5 px na bod, obrazovka jeden priechod', () => {
  const src = readFileSync(new URL('../public/preloaderFlow.js', import.meta.url), 'utf8');
  assert.match(src, /const FLOW_FPS = 30;/);
  assert.match(src, /const FLOW_MAX_DPR = 1\.5;/);
  assert.ok(!/const FS_POST|const FS_GLYPH|scene = target/.test(src), 'žiadny medzisnímok na celú obrazovku');
  assert.equal((src.match(/= program\(FS_/g) || []).length, 2, 'dva programy: malá mriežka buniek + jedna obrazovka');
  assert.match(src, /if \(uFx > 0\.01\) \{/, 'viac vzoriek na pixel len počas úvodu');
  assert.match(src, /if \(!measuredOnce && now - measuredAt > 250\)/, 'stred sa nepremeriava stále dookola');
});

test('ukážka pozastaví glóbus pod preloaderom (60 snímok/s + Google 3D dlaždice by bežali naprázdno) a po konci ho rozbehne', () => {
  const src = readFileSync(new URL('../public/preloaderFlow.js', import.meta.url), 'utf8');
  assert.match(src, /if \(!demo \|\| !screen\.classList\.contains\('hidden'\)\) return;/, 'len v ukážke a len nad hotovou appkou');
  assert.match(src, /pausedViewer\.useDefaultRenderLoop = !doc\.hidden;/, 'po ukážke podľa viditeľnosti okna (ako main.js)');
  assert.match(src, /viewer\.useDefaultRenderLoop = false; pausedViewer = viewer;/);
  assert.match(src, /function exitDemo\(\) \{\n {4}doc\.documentElement\.classList\.remove\('oko-preloader-demo'\);\n {4}resumeGlobe\(\);/);
  assert.match(src, /stopped = true;\n {4}resumeGlobe\(\);/, 'aj pri zastavení');
});
