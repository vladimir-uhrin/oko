// src/conflictSummary.test.mjs — textový prehľad konfliktov (propagácia, krok 2).
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildUkraineDigest, frontAttacks, frontDigestLines } from './conflictSummary.js';

const REPORT = {
  ok: true, total: 213, reportedAtText: '08:00 20.9.', source: 'ArmyInform · CC BY 4.0', url: 'https://x',
  directions: [
    { gs: 'Лиманський', attacks: 5, text: 'Лиман' },
    { gs: 'Покровський', attacks: 29, text: 'Покровськ' },
    { gs: 'Оріхівський', attacks: null, text: 'Оріхів' },
    { gs: 'Курський', attacks: 0, text: 'Курськ' },
  ],
};
const tr = (k, v) => {
  if (k === 'summary.ukraine.head') return `Ukrajina · ${v.date}`;
  if (k === 'summary.ukraine.total') return `Spolu: ${v.n}`;
  if (k === 'summary.ukraine.source') return 'Zdroj: GŠ ZSU';
  return k; // front.<id>.name → identita → frontSceneLabel spadne na scene.name
};

test('frontDigestLines: zoradené podľa útokov, neuvedené na koniec, mená smerov', () => {
  const lines = frontDigestLines(REPORT, { translate: tr });
  assert.equal(lines.length, 4);
  assert.equal(lines[0].attacks, 29, 'najviac útokov prvé');
  assert.equal(lines[0].label, 'Pokrovsk direction');
  assert.equal(lines[1].attacks, 5);
  assert.equal(lines.at(-1).attacks, null, 'neuvedené (Orichiv) na konci');
});

test('frontAttacks: počet pre smer, null pre neuvedený', () => {
  assert.equal(frontAttacks(REPORT, 'lyman'), 5);
  assert.equal(frontAttacks(REPORT, 'pokrovsk'), 29);
  assert.equal(frontAttacks(REPORT, 'orikhiv'), null);
  assert.equal(frontAttacks(REPORT, 'neexistuje'), null);
});

test('buildUkraineDigest: hlavička + smery s útokmi > 0 + súčet + zdroj', () => {
  const d = buildUkraineDigest({ report: REPORT, translate: tr });
  assert.equal(d.total, 213);
  assert.match(d.text, /^Ukrajina · 08:00 20\.9\./m);
  assert.match(d.text, /• Pokrovsk direction: 29/);
  assert.match(d.text, /• Lyman direction: 5/);
  assert.doesNotMatch(d.text, /Orikhiv/, 'neuvedený smer nie je v tele');
  assert.doesNotMatch(d.text, /Sumy direction: 0/, 'nulový smer nie je v tele');
  assert.match(d.text, /Spolu: 213/);
  assert.match(d.text, /Zdroj: GŠ ZSU/);
});

test('buildUkraineDigest: prázdne hlásenie = hlavička + zdroj, bez pádu', () => {
  const d = buildUkraineDigest({ report: null, translate: tr });
  assert.deepEqual(d.lines, []);
  assert.equal(d.total, null);
  assert.match(d.text, /Zdroj: GŠ ZSU/);
  assert.doesNotMatch(d.text, /•/, 'žiadne riadky smerov');
});
