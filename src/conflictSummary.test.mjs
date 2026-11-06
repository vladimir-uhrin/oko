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

// ── BLÍZKY VÝCHOD etapa 7 (2026-11-06): denný sumár modulu ───────────────────
import { buildMideastDigest } from './conflictSummary.js';
import { EN_STRINGS, SK_STRINGS } from './i18nStrings.js';

const NOW_ME = Date.parse('2026-11-06T12:00:00Z');
const tSk = (k, v) => { const s = SK_STRINGS[k] ?? k; return v ? s.replace(/\{(\w+)\}/g, (m, n) => (n in v ? String(v[n]) : m)) : s; };
const plain = (s) => String(s).replace(/[  ]/g, ' ');

test('buildMideastDigest: udalosti 24 h / 7 d, poplachy posledného dňa + týždeň, Gaza a Libanon, internet len so zmenou', () => {
  const d = buildMideastDigest({
    incidents: { days: { '2026-11-06': { total: 3 }, '2026-11-05': { total: 2 }, '2026-11-01': { total: 7 }, '2026-10-20': { total: 99 } } },
    alerts: { days: { '2026-11-04': { r: 4, w: 9, d: 1 }, '2026-10-28': { r: 0, w: 5, d: 0 }, '2026-10-15': { r: 2, w: 0, d: 0 } } },
    humanitarian: { summary: { gaza: { killed: 74618, injured: 175925, lastUpdate: '2026-11-05' }, lebanon: { killed: 8436, lastUpdate: '2026-10-30' } } },
    internet: { countries: { IR: { level: 'worse', recent: 55.2, baseline: 40.1 }, IQ: { level: 'same', recent: 7, baseline: 7 }, YE: { level: 'quiet', recent: null, baseline: 11 } } },
    translate: tSk, nowMs: NOW_ME,
  });
  assert.deepEqual(d.counts, { incidents24h: 5, incidents7d: 12, alarms: 5, alarmDay: '2026-11-04' });
  const lines = d.lines.map(plain);
  assert.equal(lines.length, 6);
  assert.equal(lines[0], '• overené udalosti (GeoConfirmed · UCDP): 5 za 24 h · 12 za 7 dní');
  assert.equal(lines[1], '• poplachy Velenia domáceho frontu v Izraeli: 5 dňa 4. 11. 2026 (posledný deň s poplachom) · 5 za 7 dní · história, nie varovný systém');
  assert.equal(lines[2], '• Gaza: 74 618 zabitých · 175 925 zranených (ministerstvo zdravotníctva v Gaze cez OCHA, hlásenie k 5. 11. 2026)');
  assert.equal(lines[3], '• Libanon: 8 436 zabitých (libanonské ministerstvo zdravotníctva, hlásenie k 30. 10. 2026)');
  assert.equal(lines[4], '• internet Irán: blokovanie rastie — 55,2 % meraní OONI za 7 dní proti 40,1 % predtým');
  assert.equal(lines[5], '• internet Jemen: málo meraní OONI za 7 dní — možný výpadok');
  assert.doesNotMatch(d.lines.join('\n'), /Irak/, 'bez zmeny sa nepíše');
});

test('buildMideastDigest: bez dát prázdne; poplachy bez dňa = „žiadny"; výpadok jedného zdroja len vynechá riadok', () => {
  assert.deepEqual(buildMideastDigest({ translate: tSk, nowMs: NOW_ME }), { lines: [], counts: { incidents24h: null, incidents7d: null, alarms: null, alarmDay: null } });
  const d = buildMideastDigest({ alerts: { days: { '2026-11-01': { r: 0, w: 3, d: 0 } } }, humanitarian: { summary: { gaza: { killed: null } } }, translate: tSk, nowMs: NOW_ME });
  assert.deepEqual(d.lines, ['• poplachy Velenia domáceho frontu v Izraeli: za 30 dní žiadny (história z mirroru)']);
  const future = buildMideastDigest({ alerts: { days: { '2026-11-09': { r: 5, w: 0, d: 0 } } }, translate: tSk, nowMs: NOW_ME });
  assert.equal(future.counts.alarmDay, null, 'deň po dnešku sa neráta');
});

test('buildConflictDigest: sekcia BLÍZKY VÝCHOD nesie správy aj riadky sumáru a zdroje modulu; bez oboch chýba', () => {
  const me = buildMideastDigest({ incidents: { days: { '2026-11-06': { total: 1 } } }, translate: tSk, nowMs: NOW_ME });
  const d = buildConflictDigest({ report: REPORT, gulfCount: 12, mideast: me, translate: trAll, dateText: 'x' });
  assert.match(d.text, /BLÍZKY VÝCHOD:\n12 správ\n• overené udalosti[^\n]*\nsummary\.mideast\.sources/);
  assert.equal(d.sections.mideast, 1);
  const only = buildConflictDigest({ report: REPORT, gulfCount: null, mideast: me, translate: trAll, dateText: 'x' });
  assert.match(only.text, /BLÍZKY VÝCHOD:\n• overené udalosti/);
  const none = buildConflictDigest({ report: REPORT, gulfCount: null, mideast: { lines: [] }, translate: trAll, dateText: 'x' });
  assert.doesNotMatch(none.text, /BLÍZKY VÝCHOD:/);
  for (const k of ['summary.mideast.incidents', 'summary.mideast.alerts', 'summary.mideast.alerts-none', 'summary.mideast.gaza', 'summary.mideast.lebanon', 'summary.mideast.net.worse', 'summary.mideast.net.better', 'summary.mideast.net.quiet', 'summary.mideast.sources']) {
    assert.ok(EN_STRINGS[k] && SK_STRINGS[k], k);
    assert.doesNotMatch(SK_STRINGS[k], /\p{Emoji_Presentation}/u);
  }
  assert.match(SK_STRINGS['summary.mideast.alerts'], /nie varovný systém/);
});
