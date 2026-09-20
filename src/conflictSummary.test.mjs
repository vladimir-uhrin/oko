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

import { buildConflictDigest, oilDigestLine } from './conflictSummary.js';

const trAll = (k, v) => {
  const m = {
    'summary.head': `OKO · Prehľad · ${v?.date}`,
    'summary.head-nodate': 'OKO · Prehľad',
    'summary.section.ukraine': 'UKRAJINA:',
    'summary.section.oil': 'ROPA:',
    'summary.section.gulf': 'BLÍZKY VÝCHOD:',
    'summary.gulf.count': `${v?.n} správ`,
    'summary.ukraine.total': `Spolu: ${v?.n}`,
    'summary.sources': 'Zdroje: …',
  };
  return m[k] ?? k;
};

test('oilDigestLine: Brent + WTI, prázdny model = ""', () => {
  assert.equal(oilDigestLine({ ok: true, brent: { usdText: '$74.20/bbl' }, wti: { usdText: '$70.10/bbl' } }), 'Brent $74.20/bbl · WTI $70.10/bbl');
  assert.equal(oilDigestLine({ ok: true, brent: { usdText: '$74/bbl' } }), 'Brent $74/bbl');
  assert.equal(oilDigestLine({ ok: false }), '');
  assert.equal(oilDigestLine(null), '');
});

test('buildConflictDigest: viac sekcií (Ukrajina + ropa + Blízky východ), prázdne sa vynechajú', () => {
  const d = buildConflictDigest({
    report: REPORT,
    oilModel: { ok: true, brent: { usdText: '$74.20/bbl' }, wti: { usdText: '$70.10/bbl' } },
    gulfCount: 12,
    translate: trAll,
    dateText: '20. 9. 2026',
  });
  assert.match(d.text, /^OKO · Prehľad · 20\. 9\. 2026/);
  assert.match(d.text, /UKRAJINA:/);
  assert.match(d.text, /• Pokrovsk direction: 29/);
  assert.match(d.text, /Spolu: 213/);
  assert.match(d.text, /ROPA:\nBrent \$74\.20\/bbl · WTI \$70\.10\/bbl/);
  assert.match(d.text, /BLÍZKY VÝCHOD:\n12 správ/);
  assert.match(d.text, /Zdroje: …/);
  assert.equal(d.sections.oil, true);
  assert.equal(d.sections.gulf, 12);
  // bez ropy a zálivu → tie sekcie chýbajú
  const d2 = buildConflictDigest({ report: REPORT, oilModel: null, gulfCount: null, translate: trAll, dateText: 'x' });
  assert.doesNotMatch(d2.text, /ROPA:/);
  assert.doesNotMatch(d2.text, /BLÍZKY VÝCHOD:/);
  assert.match(d2.text, /UKRAJINA:/);
});
