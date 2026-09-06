// src/data/naturalEventInfo.test.mjs
// Popis a klasifikácia prírodnej udalosti (2026-09-06): Saffir-Simpson z vetra,
// zložený popis keď EONET popis chýba, farby a odznaky kategórií.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CYCLONE_STEPS, NATURAL_EVENT_COLORS,
  categoryColor, cycloneClass, magnitudeText, naturalEventCardModel, windKt,
} from './naturalEventInfo.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';
import { NATURAL_EVENT_CATEGORIES } from './naturalEvents.js';

const tr = (strings) => (k, vars) => { let s = strings[k] || k; for (const [a, b] of Object.entries(vars || {})) s = s.replaceAll(`{${a}}`, String(b)); return s; };
const en = tr(EN_STRINGS), sk = tr(SK_STRINGS);

test('cyklón: Saffir-Simpson z vetra v uzloch', () => {
  assert.equal(cycloneClass(150).key, 'natural.cyclone.cat5');
  assert.equal(cycloneClass(115).cat, 4);
  assert.equal(cycloneClass(96).cat, 3);
  assert.equal(cycloneClass(83).cat, 2);
  assert.equal(cycloneClass(64).cat, 1);
  assert.equal(cycloneClass(50).key, 'natural.cyclone.ts');
  assert.equal(cycloneClass(20).key, 'natural.cyclone.td');
  assert.equal(cycloneClass(null), null);
  assert.equal(windKt({ value: 80, unit: 'kts' }), 80);
  assert.equal(windKt({ value: 12, unit: 'm' }), null, 'metre nie sú uzly');
  assert.equal(magnitudeText({ value: 80, unit: 'kts' }), '80 kts');
  assert.equal(magnitudeText(null), '');
  assert.deepEqual(CYCLONE_STEPS.map((s) => s.cat), [5, 4, 3, 2, 1, 0, 0]);
});

test('farby: každá kategória má vlastnú, cyklón červený a odlíšený', () => {
  for (const c of NATURAL_EVENT_CATEGORIES) assert.match(categoryColor(c), /^#[0-9a-f]{6}$/i, c);
  assert.equal(categoryColor('severeStorms'), NATURAL_EVENT_COLORS.severeStorms);
  assert.notEqual(categoryColor('severeStorms'), categoryColor('floods'));
  assert.equal(categoryColor('nonsense'), '#ffc46b', 'neznáma = default akcent');
});

test('karta: hurikán — intenzita, Saffir-Simpson odznak, popis ZLOŽENÝ z dát keď EONET popis chýba', () => {
  const now = Date.parse('2026-09-06T12:00:00Z');
  const event = {
    id: 'EONET_23612', title: 'Hurricane Lowell', category: 'severeStorms', lat: 21.6, lon: -120.1,
    time: now - 6 * 3600_000, firstTime: Date.parse('2026-08-27T00:00:00Z'), reports: 38,
    magnitude: { value: 80, unit: 'kts' }, peakKt: 115, description: '',
    track: Array.from({ length: 38 }, () => [0, 0]),
    sources: [{ id: 'JTWC', url: 'https://www.metoc.navy.mil/jtwc/x' }, { id: 'NOAA_NHC', url: 'https://www.nhc.noaa.gov/x' }],
  };
  const m = naturalEventCardModel(event, now, en);
  assert.equal(m.title, 'Hurricane Lowell');
  assert.equal(m.subLine, 'Severe storms · Category 1');
  assert.equal(m.intensityLine, '80 kt sustained · peak 115 kt');
  assert.deepEqual(m.badge, { text: 'CAT 1', color: NATURAL_EVENT_COLORS.severeStorms });
  assert.equal(m.description, 'Tropical cyclone, currently 80 kt (category 1), peak 115 kt. Tracked over 38 positions from 27. 8. 2026 to 6. 9. 2026.');
  assert.equal(m.activity, 'Tracked since 27. 8. 2026 · latest today · 38 fixes');
  assert.equal(m.trackLine, EN_STRINGS['natural.track-points'].replace('{n}', '38'));
  assert.deepEqual(m.links.map((l) => l.label), ['JTWC', 'NOAA NHC', 'NASA EONET']);
  assert.equal(m.color, NATURAL_EVENT_COLORS.severeStorms);
  assert.match(m.coords, /21\.600°, -120\.100°/);
});

test('karta: tropická búrka bez odznaku CAT, a nebúrková udalosť má generický popis', () => {
  const now = Date.parse('2026-09-06T00:00:00Z');
  // 45 kt = tropická búrka (prah TS je 34 kt); 30 kt by bola depresia (TD).
  const ts = naturalEventCardModel({ id: 'x', title: 'Tropical Storm Edouard', category: 'severeStorms', lat: 20, lon: -90, time: now, firstTime: now - 86_400_000, reports: 6, magnitude: { value: 45, unit: 'kts' }, peakKt: 50, sources: [] }, now, sk);
  assert.equal(ts.badge.text, 'TS');
  assert.match(ts.subLine, /Tropická búrka/);
  assert.match(ts.description, /Tropický cyklón, aktuálne 45 kt/);
  assert.equal(cycloneClass(30).key, 'natural.cyclone.td', '30 kt je depresia, nie búrka');
  const flood = naturalEventCardModel({ id: 'f', title: 'Flood in Region', category: 'floods', lat: 10, lon: 10, time: now, firstTime: now - 3 * 86_400_000, reports: 4, sources: [] }, now, sk);
  assert.equal(flood.badge, null, 'len cyklóny majú CAT odznak');
  assert.equal(flood.intensityLine, '');
  assert.match(flood.description, /Hlásená udalosť \(povodne\), sledovaná cez 4 polôh/);
  assert.equal(flood.subLine, 'Povodne');
  // Skutočný popis z EONET má prednosť pred zloženým.
  const real = naturalEventCardModel({ id: 'r', title: 'X', category: 'floods', lat: 1, lon: 1, time: now, description: 'Heavy monsoon flooding.', sources: [] }, now, en);
  assert.equal(real.description, 'Heavy monsoon flooding.');
  assert.equal(naturalEventCardModel(null, now, en), null);
});

test('i18n: cyklónové triedy, popisy a sekcie v EN aj SK', () => {
  for (const k of ['natural.cyclone.td', 'natural.cyclone.ts', 'natural.cyclone.cat1', 'natural.cyclone.cat5',
    'natural.desc.cyclone', 'natural.desc.default', 'natural.section.details', 'natural.section.about',
    'natural.wind-now', 'natural.peak', 'natural.activity-since']) {
    assert.ok(EN_STRINGS[k] && SK_STRINGS[k], k);
  }
  const src = readFileSync(new URL('./naturalEventInfo.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /fetch\(|document\.|import \* as Cesium/, 'čistý modul');
});
