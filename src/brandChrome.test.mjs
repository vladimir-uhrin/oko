// src/brandChrome.test.mjs
// Logo a preloader (2026-09-07): pulzujúce červené oko a podpis autora.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('./i18nStrings.js', import.meta.url), 'utf8');
const gaze = readFileSync(new URL('./logoGaze.js', import.meta.url), 'utf8');

test('logo: červená zrenica (skutočný span) pulzuje jemne (dych + zriedkavý zážeh), screen blend; reduced-motion = pomalý dych', () => {
  assert.match(css, /\.brand-logo \.brand-eye \{[\s\S]*?mix-blend-mode: screen;[\s\S]*?animation: oko-eye-breathe [\d.]+s ease-in-out infinite, oko-eye-flare [\d.]+s ease-in-out infinite;/);
  assert.match(css, /@keyframes oko-eye-breathe \{[\s\S]*?opacity: 0\.4;[\s\S]*?opacity: 0\.8;/, 'dych medzi 0,4 a 0,8 — nie 0 a 1 (žiadne tvrdé blikanie)');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.brand-logo \.brand-eye \{ animation: oko-eye-breathe 6s ease-in-out infinite; \}/, 'pri obmedzených animáciách pomalý dych, nie statika');
  assert.match(css, /\.brand-logo \{\s*position: relative;/, 'absolútne umiestnená zrenica potrebuje relatívny rodič');
  assert.equal((html.match(/<span class="brand-eye" aria-hidden="true"><\/span>/g) || []).length, 2, 'titulné logo aj preloader');
  assert.match(gaze, /const eye = state\.element\.querySelector\('\.brand-eye'\);\s*state\.element\.replaceChildren\(svg\);\s*if \(eye\) state\.element\.appendChild\(eye\);/, 'inline SVG výmena zrenicu zachová');
});

test('BETA červeným pri názve v titulku aj v preloaderi; pod heslom podpis autora ako v preloaderi', () => {
  // vlastník 2026-09-27: „napísať, že je app vo vývoji, napr. BETA červeným a pod tým moje meno"
  assert.match(html, /<span>OK<span class="title-accent">O<\/span><\/span><span class="beta-badge" data-i18n-title="title\.beta-hint" title="[^"]+">BETA<\/span><\/h1>/);
  assert.match(html, /<h2>OK<span class="title-accent">O<\/span><span class="beta-badge">BETA<\/span><\/h2>/);
  assert.match(css, /\.beta-badge \{[\s\S]*?color: #ff2e2e;/, 'červená zrenice loga');
  assert.match(css, /#title-bar \.beta-badge \{[^}]*pointer-events: auto;/, 'bublina v titulku, ktorý je pointer-events: none');
  assert.match(i18n, /'title\.beta-hint': 'In development/);
  assert.match(i18n, /'title\.beta-hint': 'Aplikácia vo vývoji/);
  const sub = html.indexOf('data-i18n="title.subtitle"');
  const credit = html.indexOf('<p class="title-credit"><span class="title-credit-rule" aria-hidden="true"></span><span data-i18n="loader.made-by">made by</span> <strong>Uhrin Vladimír</strong></p>');
  assert.ok(sub > 0 && credit > sub, 'podpis pod heslom');
  assert.match(css, /#title-bar \.title-credit strong \{[^}]*color: var\(--accent\);/);
  assert.match(css, /body\.oko-karta-frame #title-bar \.title-credit \{ display: none; \}/, 'v ráme KARTA by ležal cez titulok (top 98 px)');
  assert.match(css, /body\.oko-mobile #title-bar \.title-credit,/, 'na mobile ako heslo skrytý');
});

test('preloader: podpis „made by Uhrin Vladimír" v štýle mono + azúrová linka, text lokalizovaný EN/SK', () => {
  assert.match(html, /<p class="loader-credit"><span class="loader-credit-rule" aria-hidden="true"><\/span><span><span data-i18n="loader.made-by">made by<\/span> <strong>Uhrin Vladimír<\/strong><\/span><\/p>/);
  assert.match(css, /\.loader-credit \{[\s\S]*?font-family: var\(--font-mono\);[\s\S]*?text-transform: uppercase;/);
  assert.match(css, /\.loader-credit strong \{[\s\S]*?color: var\(--accent\);/);
  assert.match(i18n, /'loader\.made-by': 'made by',/);
  assert.match(i18n, /'loader\.made-by': 'vytvoril',/);
});
