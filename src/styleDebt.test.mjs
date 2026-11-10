// Dlh štýlov smie klesať, nie rásť (2026-11-10, audit UI — krok 2).
//
// style.css narástol na stovky natvrdo zapísaných farieb, 57 veľkostí písma a 50 hodnôt z-index, lebo každá
// úprava pridala „ešte jednu" hodnotu. Od zavedenia tokenov (:root v style.css: --accent-rgb, --color-warn,
// --color-ok, --color-danger, --fs-*, --sp-*, --radius-*, --z-*) sa nové pravidlá píšu cez ne. Tento test drží stropy na
// dnešných počtoch: keď niektorý počet znížiš, zníž aj strop; keď test padne, použi token namiesto novej hodnoty.
//
// Farby vo vzorkách legiend (selektory s -sw, legend, -ctl-item, is-rp-, -marker, -key, -dot) sú zámerne
// doslovné — zhodujú sa s farbami kreslenými v JS a porovnávajú ich testy vrstiev.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { styleDebt } from '../scripts/lib/styleDebt.mjs';

const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const debt = styleDebt(css);

/** Stropy = stav po kroku 2 (2026-11-10). Znižovať áno, zvyšovať nie. */
const CEILING = Object.freeze({
  distinctHex: 188,
  distinctRgbTriples: 187,
  accentLiterals: 0,
  fontSizesUnder10px: 356,
  distinctFontSizes: 53,
  distinctZIndex: 48,
  outlineNone: 55,
  important: 104,
});

test('tokeny farieb, písma, odstupov, rohov a vrstiev sú v :root', () => {
  const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
  for (const name of ['--accent', '--accent-rgb', '--color-warn', '--color-warn-rgb', '--color-ok', '--color-danger', '--fs-2xs', '--fs-xs', '--fs-sm', '--fs-md', '--sp-1', '--sp-4', '--radius-sm', '--radius-lg', '--z-chrome', '--z-menu', '--shadow-panel']) {
    assert.match(root, new RegExp(`\\n\\s*${name}:`), `chýba token ${name}`);
  }
  assert.match(root, /--accent-rgb: 0, 212, 255;/, 'trojica zodpovedá --accent #00d4ff');
});

test('značková modrá je jedna: paralelné odtiene sa do pravidiel nevracajú', () => {
  // #39d0ff (mobilná lišta, Ukrajina, voľby), 54,220,255 (súhlas, dok) a #00dcff (karty) boli tri „skoro akcenty".
  assert.equal(debt.accentLiterals, CEILING.accentLiterals,
    `doslovný zápis modrej mimo tokenov: ${debt.accentLiteralSamples.join(' | ')}`);
});

test('dlh štýlov nerastie', () => {
  for (const key of Object.keys(CEILING)) {
    assert.ok(debt[key] <= CEILING[key], `${key}: ${debt[key]} > strop ${CEILING[key]} — použi token (pozri :root v style.css)`);
  }
});

test('obsahové stránky, súkromie a zdieľaná stránka majú tú istú modrú ako aplikácia', () => {
  const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  assert.match(read('../public/content.css'), /--accent: #00d4ff;/);
  for (const rel of ['../public/content.css', '../public/privacy.html', './shareStore.js']) {
    assert.doesNotMatch(read(rel), /#39d0ff|rgba\(57, 208, 255/i, `${rel} má starý odtieň`);
  }
});
