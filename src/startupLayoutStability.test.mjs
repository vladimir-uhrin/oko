// src/startupLayoutStability.test.mjs — stabilita rozloženia pri štarte (2026-10-31, PageSpeed: posun rozloženia
// 0,07–0,10 na telefóne). Dva pôvodcovia: (1) triedu oko-mobile dával až mobilný plášť po štarte Cesia, takže
// nadpis, dok a navigácia sa preskladali so skokom — teraz ju dáva vložený skript v index.html hneď za preloaderom
// podľa toho istého pravidla ako resolveShellMode; (2) doskočenie JetBrains Mono / Inter z Google Fonts — náhradné
// písma so zladenými metrikami (size-adjust, ascent/descent-override) a pevná výška riadkov nadpisu a preloadera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { COARSE_MAX_WIDTH_PX, MOBILE_MAX_WIDTH_PX, SHORT_HEIGHT_PX, resolveShellMode } from './mobileShell.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const html = read('../index.html');
const css = read('../style.css');

function inlineScript() {
  const loader = html.indexOf('<div id="loading-screen">');
  const globe = html.indexOf('<div id="cesiumContainer">');
  const title = html.indexOf('<div id="title-bar">');
  assert.ok(loader > 0 && globe > loader && title > globe, 'preloader, potom glóbus, potom nadpis');
  const m = html.slice(loader, globe).match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, 'vložený skript stojí medzi preloaderom a glóbusom (pred nadpisom, dokom a navigáciou)');
  return m[1];
}

function runInline({ width, height, coarse = false, matchMediaThrows = false }) {
  const classes = new Set();
  const body = {
    classList: {
      toggle(name, force) { if (force) classes.add(name); else classes.delete(name); return force; },
      add(...names) { for (const n of names) classes.add(n); },
    },
  };
  const win = {
    innerWidth: width,
    innerHeight: height,
    matchMedia(q) { if (matchMediaThrows) throw new Error('matchMedia nie je'); return { matches: q === '(pointer: coarse)' && coarse }; },
  };
  vm.runInNewContext(inlineScript(), { document: { body }, window: win });
  return classes;
}

test('index.html: oko-mobile hneď pri parsovaní, rovnaké čísla a rovnaký výsledok ako resolveShellMode', () => {
  const script = inlineScript();
  assert.match(script, new RegExp(`w <= ${MOBILE_MAX_WIDTH_PX} \\|\\|`), 'úzka obrazovka = MOBILE_MAX_WIDTH_PX');
  assert.match(script, new RegExp(`coarse && w <= ${COARSE_MAX_WIDTH_PX}\\)`), 'dotyk = COARSE_MAX_WIDTH_PX');
  assert.match(script, new RegExp(`h <= ${SHORT_HEIGHT_PX} && w > h`), 'naležato = SHORT_HEIGHT_PX');
  const cases = [
    { width: 412, height: 823, coarse: true }, // telefón na výšku (Moto G Power v Lighthouse)
    { width: 412, height: 823, coarse: false },
    { width: 1350, height: 940, coarse: false }, // počítač
    { width: 1100, height: 700, coarse: true }, // tablet
    { width: 1100, height: 700, coarse: false },
    { width: 800, height: 400, coarse: false }, // telefón naležato
    { width: 700, height: 500, coarse: true },
    { width: 0, height: 0, coarse: false },
  ];
  for (const c of cases) {
    const want = resolveShellMode(c);
    const got = runInline(c);
    assert.equal(got.has('oko-mobile'), want.mobile, `${c.width}×${c.height} coarse=${c.coarse}: oko-mobile`);
    assert.equal(got.has('oko-mobile-landscape'), want.landscape, `${c.width}×${c.height} coarse=${c.coarse}: naležato`);
    assert.ok(got.has('oko-look-in-dock'), 'oko-look-in-dock (main.js ju dáva vždy) tiež hneď');
  }
  // Bez matchMedia (starý prehliadač, robot) sa nič nerozbije: dotyk = nie.
  const safe = runInline({ width: 1000, height: 800, coarse: true, matchMediaThrows: true });
  assert.equal(safe.has('oko-mobile'), false, 'keď matchMedia padne, platí len šírka');
  assert.equal(runInline({ width: 1000, height: 800, coarse: true }).has('oko-mobile'), true);
});

test('style.css: náhradné písma so zladenými metrikami a pevná výška riadkov nadpisu a preloadera', () => {
  assert.match(css, /--font-mono: 'JetBrains Mono', 'JetBrains Mono Fallback', /, 'náhrada hneď za JetBrains Mono');
  assert.match(css, /--font-sans: 'Inter', 'Inter Fallback', /, 'náhrada hneď za Inter');
  const mono = css.match(/@font-face \{\s*font-family: 'JetBrains Mono Fallback';\s*src: local\('Courier New'\)[^;]*local\('Liberation Mono'\)[^;]*;\s*size-adjust: ([\d.]+)%;\s*ascent-override: ([\d.]+)%;\s*descent-override: ([\d.]+)%;\s*line-gap-override: 0%;\s*\}/);
  assert.ok(mono, 'JetBrains Mono Fallback: Courier New (a jeho metrické dvojčatá) s prepísanými metrikami');
  // JetBrains Mono: šírka znaku 0,60 em (= Courier New), výška riadku „normal" 1,02 + 0,30 = 1,32 em.
  assert.equal(Number(mono[1]), 100);
  assert.equal((Number(mono[2]) + Number(mono[3])) / 100, 1.32, 'nad + pod linkou = výška riadku JetBrains Mono');
  const sans = css.match(/@font-face \{\s*font-family: 'Inter Fallback';\s*src: local\('Arial'\)[^;]*local\('Liberation Sans'\)[^;]*;\s*size-adjust: ([\d.]+)%;\s*ascent-override: ([\d.]+)%;\s*descent-override: ([\d.]+)%;\s*line-gap-override: 0%;\s*\}/);
  assert.ok(sans, 'Inter Fallback: Arial (a jeho metrické dvojčatá) s prepísanými metrikami');
  // Inter: Arial × 107,12 % šírky; nad/pod linkou 0,969 / 0,241 em → po úprave veľkosti 90,44 / 22,52 %.
  assert.equal(Number(sans[1]), 107.12);
  assert.equal(Math.round((Number(sans[2]) + Number(sans[3])) * Number(sans[1]) / 100) / 100, 1.21, 'výška riadku Inter 1,21 em');
  for (const sel of ['#title-bar h1', '.loader-content h2', '.loader-status', '.loader-credit']) {
    const rule = css.match(new RegExp(`\\n${sel.replace(/[.#]/g, '\\$&')} \\{([^}]*)\\}`));
    assert.ok(rule, `pravidlo ${sel}`);
    assert.match(rule[1], /line-height: 1\.32;/, `${sel}: výška riadku = JetBrains Mono normal, aby náhradné písmo nič neposunulo`);
  }
  assert.match(html, /family=JetBrains\+Mono[^"]*family=Inter[^"]*display=swap/, 'písma z Google Fonts so swap — náhrada sa vymení bez skoku');
});
