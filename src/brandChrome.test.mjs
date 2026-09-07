// src/brandChrome.test.mjs
// Logo a preloader (2026-09-07): pulzujúce červené oko a podpis autora.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('./i18nStrings.js', import.meta.url), 'utf8');

test('logo: červená zrenica pulzuje jemne (dych + zriedkavý zážeh), screen blend, rešpektuje reduced-motion', () => {
  assert.match(css, /\.brand-logo::after \{[\s\S]*?mix-blend-mode: screen;[\s\S]*?animation: oko-eye-breathe [\d.]+s ease-in-out infinite, oko-eye-flare [\d.]+s ease-in-out infinite;/);
  assert.match(css, /@keyframes oko-eye-breathe \{[\s\S]*?opacity: 0\.4;[\s\S]*?opacity: 0\.8;/, 'dych medzi 0,4 a 0,8 — nie 0 a 1 (žiadne tvrdé blikanie)');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.brand-logo::after \{ animation: none;/);
  assert.match(css, /\.brand-logo \{\s*position: relative;/, 'pseudo-element potrebuje relatívny rodič');
});

test('preloader: podpis „made by Uhrin Vladimír" v štýle mono + azúrová linka, text lokalizovaný EN/SK', () => {
  assert.match(html, /<p class="loader-credit"><span class="loader-credit-rule" aria-hidden="true"><\/span><span><span data-i18n="loader.made-by">made by<\/span> <strong>Uhrin Vladimír<\/strong><\/span><\/p>/);
  assert.match(css, /\.loader-credit \{[\s\S]*?font-family: var\(--font-mono\);[\s\S]*?text-transform: uppercase;/);
  assert.match(css, /\.loader-credit strong \{[\s\S]*?color: var\(--accent\);/);
  assert.match(i18n, /'loader\.made-by': 'made by',/);
  assert.match(i18n, /'loader\.made-by': 'vytvoril',/);
});
