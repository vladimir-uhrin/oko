// src/data/ukraineReportForms.test.mjs — tvary hlásenia GŠ, ktoré parser do
// 2026-09-23 nepoznal (našla ich karta smeru v 30-dňovom grafe): súčet
// „бойове зіткнення" / „боєзіткнення", vsuvka „— 31 —", „двічі проводив",
// „не проводив" v jednotnom čísle a súhrnná veta, ktorá nesmie byť smerom.
// Odseky sú skrátené zo skutočného hlásenia 30. 8. 2026 (ArmyInform, CC BY 4.0).
import test from 'node:test';
import assert from 'node:assert/strict';

import { REPORT_TOTAL_RE, attacksInParagraph, parseGeneralStaffReport } from './ukraineReport.js';

const AUG30 = [
  'Минулої доби на фронті відбулося 221 бойове зіткнення. Найбільше атак російські війська здійснили на Костянтинівському та Покровському напрямках.',
  'На Південно-Слобожанському напрямку українські військові відбили 10 атак противника.',
  'На Куп\'янському напрямку противник двічі проводив наступальні дії — у напрямку Радьківки та Подолів.',
  'На Краматорському напрямку штурмових дій противник не проводив.',
  'Найбільше атак за добу — 31 — російські війська здійснили на Костянтинівському напрямку . Ворог штурмував у районах Костянтинівки та Іллінівки.',
  'Ще 30 атак противник здійснив на Покровському напрямку . Окупанти намагалися просунутися в бік Білицького.',
  'На Волинському та Поліському напрямках ознак формування наступальних угруповань противника не виявлено.',
];

test('súčet frontu: všetky štyri tvary čísla', () => {
  const total = (s) => { const m = s.match(REPORT_TOTAL_RE); return m ? Number(m[1].replace(/\s/g, '')) : null; };
  assert.equal(total('відбулося 213 бойових зіткнень'), 213);
  assert.equal(total('відбулося 221 бойове зіткнення'), 221, 'číslo končí na 1');
  assert.equal(total('відбулося 242 бойові зіткнення'), 242);
  assert.equal(total('на фронті зафіксовано 261 боєзіткнення'), 261);
  assert.equal(total('зафіксовано 209 боєзіткнень'), 209);
  assert.equal(total('Найбільше бойових зіткнень відбулося на Покровському напрямку — 29'), null, 'bez čísla pred slovom to nie je súčet');
});

test('počty v nových tvaroch odseku', () => {
  assert.equal(attacksInParagraph(AUG30[4]), 31, 'vsuvka medzi pomlčkami');
  assert.equal(attacksInParagraph(AUG30[2]), 2, 'двічі проводив наступальні дії');
  assert.equal(attacksInParagraph(AUG30[3]), 0, 'не проводив (jednotné číslo) = výslovná nula');
  assert.equal(attacksInParagraph('На Придніпровському напрямку ворог наступальних дій не проводив.'), 0);
});

test('30. 8. 2026: súhrnná veta dá súčet, nie 221 útokov dvom smerom; vlastné odseky prebijú spoločný bez počtu', () => {
  const r = parseGeneralStaffReport(AUG30, { publishedAt: '2026-08-30T08:30:00Z' });
  assert.equal(r.total, 221);
  const by = Object.fromEntries(r.directions.map((d) => [d.gs, d]));
  assert.equal(by['Костянтинівський'].attacks, 31);
  assert.equal(by['Костянтинівський'].shared, false, 'spoločný odsek bez počtu nahradil vlastný');
  assert.match(by['Костянтинівський'].text, /Іллінівки/);
  assert.equal(by['Покровський'].attacks, 30);
  assert.equal(by['Куп\'янський'].attacks, 2);
  assert.equal(by['Краматорський'].attacks, 0);
  assert.equal(by['Волинський'].attacks, 0);
  assert.equal(by['Волинський'].shared, true, 'skutočne spoločný odsek ostáva spoločný');
  assert.ok(!r.directions.some((d) => d.attacks === 221), 'súčet frontu nikdy ako počet smeru');
});

test('súhrnný odsek s počtom smeru: veta so súčtom preč, smer ostane', () => {
  const r = parseGeneralStaffReport([
    'Протягом минулої доби на фронті зафіксовано 231 бойове зіткнення. Найбільше атак російські війська здійснили на Костянтинівському напрямку — 35.',
    'На Лиманському напрямку ворог п\'ять разів атакував.',
  ]);
  assert.equal(r.total, 231);
  assert.deepEqual(r.directions.map((d) => [d.gs, d.attacks]), [['Костянтинівський', 35], ['Лиманський', 5]]);
});

test('prvý výskyt s počtom sa neprepisuje neskorším', () => {
  const r = parseGeneralStaffReport([
    'На Покровському напрямку — 29.',
    'На Покровському напрямку ворог 12 разів атакував у районі Удачного.',
  ]);
  assert.equal(r.directions.length, 1);
  assert.equal(r.directions[0].attacks, 29);
});
