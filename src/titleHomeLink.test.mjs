// src/titleHomeLink.test.mjs — logo a názov OKO v ľavom hornom rohu sú odkaz na začiatok (2026-10-31, vlastník:
// „označenú časť sprav klikateľnú do základného nastavenia"): / bez odkazu a parametrov = glóbus, úvodný prelet
// a základné rozloženie ako pri prvej návšteve. #title-bar udalosti neprijíma (pointer-events: none), odkaz áno.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EN_STRINGS, SK_STRINGS } from './i18nStrings.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('index.html: celý nadpis (logo, OKO, BETA) je v odkaze #title-home na /', () => {
  const html = read('../index.html');
  const h1 = html.match(/<div id="title-bar">[\s\S]*?<h1>([\s\S]*?)<\/h1>/);
  assert.ok(h1, 'h1 v #title-bar');
  assert.match(h1[1], /^<a id="title-home" href="\/" data-i18n-title="title\.home" title="[^"]+">/, 'odkaz obaľuje celý obsah h1');
  assert.match(h1[1], /<\/a>$/);
  assert.match(h1[1], /class="title-logo brand-logo"[\s\S]*OK<span class="title-accent">O<\/span>[\s\S]*class="beta-badge"/, 'logo, názov aj BETA ostávajú vnútri');
});

test('style.css: odkaz je klikateľný napriek pointer-events: none na #title-bar a drží riadok nadpisu', () => {
  const css = read('../style.css');
  assert.match(css, /#title-bar \{[^}]*pointer-events: none;/);
  const rule = css.match(/\n#title-bar h1 #title-home \{([^}]*)\}/);
  assert.ok(rule, 'pravidlo #title-bar h1 #title-home');
  for (const decl of ['display: inline-flex;', 'align-items: center;', 'gap: inherit;', 'color: inherit;', 'text-decoration: none;', 'pointer-events: auto;', 'cursor: var(--cursor-pointer);']) {
    assert.ok(rule[1].includes(decl), decl);
  }
  assert.match(css, /#title-bar h1 #title-home:focus-visible \{ outline: 1px solid var\(--accent\);/);
});

test('i18n: titulok odkazu v oboch jazykoch, po slovensky bez emoji', () => {
  assert.equal(SK_STRINGS['title.home'], 'Späť na začiatok: glóbus, prelet a základné rozloženie');
  assert.ok(EN_STRINGS['title.home']?.startsWith('Back to the start'));
});
