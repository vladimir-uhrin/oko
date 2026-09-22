// src/data/ukraineReport.test.mjs — parser denného hlásenia GŠ ZSU (etapa 2) na
// skutočnom znení z 19. 9. 2026 (ArmyInform, CC BY 4.0,
// https://armyinform.com.ua/2026/09/19/213-boyezitknen-za-dobu-genshtab-zsu-rozpoviv-pro-sytuacziyu-na-klyuchovyh-napryamkah/).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REPORT_STAMP_DRIFT_MS,
  attacksInParagraph,
  directionNominative,
  directionsInParagraph,
  extractReportParagraphs,
  fetchUkraineReport,
  normalizeUkText,
  parseGeneralStaffReport,
  parseUkNumber,
  reportByScene,
  reportTimestamp,
  strikesInText,
} from './ukraineReport.js';
import { frontSceneByGsDirection } from '../ukraineFrontScenes.js';

const P = [
  'На фронті протягом минулої доби відбулося 213 бойових зіткнень. Найбільше атак окупанти здійснили на Покровському напрямку — 29.',
  'Про це йдеться в оперативній інформації Генерального штабу ЗСУ станом на 08:00 19 вересня.',
  'Учора російські війська завдали одного ракетного та 89 авіаційних ударів, скинувши 312 керованих авіабомб. Крім того, ворог застосував 10 588 дронів-камікадзе та здійснив 2952 обстріли населених пунктів і позицій українських військ.',
  'На Сумщині під артилерійським вогнем опинилися Писарівка, Уланове, Іскрисківщина, Лужки, Іволжанське, Яструбине, Храпівщина та Мар’їне. Авіаційних ударів зазнали райони Великої Чернеччини, Хутора Михайлівського та Сум.',
  'Українська авіація, ракетні війська й артилерія уразили вісім районів зосередження живої сили противника, два пункти управління БпЛА та один зенітний ракетний комплекс.',
  'На Північно-Слобожанському та Курському напрямках російські війська наступальних дій не проводили.',
  'На Південно-Слобожанському напрямку Сили оборони відбили 12 атак. Ворог намагався просунутися в районах Тернової, Потихонового, Стариці та Широкого, а також у напрямках Миколаївки та Зарубинки.',
  'На Куп’янському напрямку противник тричі атакував у районах Петропавлівки, Куп’янська-Вузлового та Новоосинового.',
  'П’ять атак росіяни здійснили на Лиманському напрямку — у районі Торського та в напрямках Надії й Новоселівки.',
  'На Слов’янському напрямку противник здійснив вісім штурмових дій у районах Ямполя та Кривої Луки, а також у напрямках Пискунівки та Рай-Олександрівки.',
  'На Краматорському напрямку російські війська один раз атакували в напрямку Юрківки.',
  '18 атак відбито на Костянтинівському напрямку. Ворог штурмував у районах Костянтинівки, Осикового, Новоселівки, Степанівки, Миколайпілля та Русиного Яру.',
  'Найбільше бойових зіткнень відбулося на Покровському напрямку — 29. Російські війська діяли в районах Білицького, Сергіївки та Удачного, а також намагалися просунутися в напрямках Кучерового Яру, Торецького, Степів, Добропілля, Ганнівки, Світлого, Красноподілля, Новогришиного та Новопавлівки.',
  'На Олександрівському напрямку росіяни здійснили одну атаку в напрямку Тернового.',
  '11 атак ворог провів на Гуляйпільському напрямку. Російські війська намагалися просунутися в районі Гіркого та в напрямках Рівного, Воздвижівки, Верхньої Терси, Гуляйпільського й Новоселівки.',
  'На Оріхівському напрямку українські захисники зупинили одну спробу противника просунутися в напрямку Малих Щербаків.',
  'На Придніпровському напрямку російські війська штурмових дій не проводили.',
  'На Волинському та Поліському напрямках ознак формування наступальних угруповань противника не виявлено.',
  'Загалом за минулу добу втрати російських військ становили 1520 осіб. Також українські захисники знищили один танк, п’ять бойових броньованих машин, 73 артилерійські системи.',
];

test('číslovky, lokál → nominatív, čas hlásenia', () => {
  assert.equal(parseUkNumber('10 588'), 10588);
  assert.equal(parseUkNumber('2952'), 2952);
  assert.equal(parseUkNumber('вісім'), 8);
  assert.equal(parseUkNumber('одну'), 1);
  assert.equal(parseUkNumber('П’ять'), 5, 'typografický apostrof');
  assert.equal(parseUkNumber('слово'), null);
  assert.equal(directionNominative('Лиманському'), 'Лиманський');
  assert.equal(directionNominative('Північно-Слобожанському'), 'Північно-Слобожанський');
  assert.equal(directionNominative('Куп’янському'), "Куп'янський");
  const stamp = reportTimestamp(P[1], { year: 2026 });
  assert.deepEqual({ time: stamp.time, day: stamp.day, month: stamp.month }, { time: '08:00', day: 19, month: 9 });
  assert.equal(stamp.iso, '2026-09-19T05:00:00.000Z', '08:00 Kyjev (EEST) = 05:00 UTC');
  assert.equal(reportTimestamp('bez času'), null);
});

test('smery a počty útokov v jednotlivých odsekoch', () => {
  assert.deepEqual(directionsInParagraph(P[5]), ['Північно-Слобожанський', 'Курський']);
  assert.equal(attacksInParagraph(P[5]), 0, 'naступальних дій не проводили');
  assert.deepEqual(directionsInParagraph(P[6]), ['Південно-Слобожанський']);
  assert.equal(attacksInParagraph(P[6]), 12);
  assert.equal(attacksInParagraph(P[7]), 3, 'тричі атакував');
  assert.equal(attacksInParagraph(P[8]), 5, 'П’ять атак');
  assert.deepEqual(directionsInParagraph(P[8]), ['Лиманський']);
  assert.equal(attacksInParagraph(P[9]), 8, 'вісім штурмових дій');
  assert.equal(attacksInParagraph(P[10]), 1, 'один раз атакували');
  assert.equal(attacksInParagraph(P[11]), 18, '18 атак відбито');
  assert.equal(attacksInParagraph(P[12]), 29, 'napрямку — 29');
  assert.equal(attacksInParagraph(P[13]), 1, 'одну атаку');
  assert.equal(attacksInParagraph(P[14]), 11);
  assert.equal(attacksInParagraph(P[15]), 1, 'одну спробу');
  assert.equal(attacksInParagraph(P[16]), 0);
  assert.equal(attacksInParagraph(P[17]), 0, 'не виявлено');
  assert.equal(attacksInParagraph('Про це йдеться в оперативній інформації.'), null, 'bez čísla a bez negácie = neznáme');
  assert.deepEqual(directionsInParagraph(P[3]), [], 'Sumščina bez slova „naprямок" nie je smer');
});

test('celé hlásenie: 213 stretov, 13 smerov + Volyň/Polissia, každý smer sedí na preset scény, údery', () => {
  const report = parseGeneralStaffReport(P, { publishedAt: '2026-09-19T06:28:03Z', url: 'https://armyinform.com.ua/x', title: '213 боєзіткнень за добу' });
  assert.equal(report.ok, true);
  assert.equal(report.total, 213);
  assert.equal(report.reportedAt, '2026-09-19T05:00:00.000Z');
  assert.equal(report.reportedAtText, '08:00 19.9.');
  assert.deepEqual(report.strikes, { missileStrikes: 1, airStrikes: 89, guidedBombs: 312, kamikazeDrones: 10588, shellings: 2952 });
  const byGs = Object.fromEntries(report.directions.map((d) => [d.gs, d.attacks]));
  assert.deepEqual(byGs, {
    'Північно-Слобожанський': 0, 'Курський': 0, 'Південно-Слобожанський': 12, "Куп'янський": 3, 'Лиманський': 5,
    "Слов'янський": 8, 'Краматорський': 1, 'Костянтинівський': 18, 'Покровський': 29, 'Олександрівський': 1,
    'Гуляйпільський': 11, 'Оріхівський': 1, 'Придніпровський': 0, 'Волинський': 0, 'Поліський': 0,
  });
  assert.equal(report.directions.length, 15);
  assert.equal(report.directionsWithActivity, 10);
  const sum = report.directions.filter((d) => !d.shared).reduce((n, d) => n + (d.attacks || 0), 0);
  assert.ok(sum <= 213, 'súčet smerov neprekročí celok (súhrn ráta aj inde)');
  for (const d of report.directions) {
    if (['Волинський', 'Поліський'].includes(d.gs)) continue;
    assert.ok(frontSceneByGsDirection(d.gs), `smer bez presetu scény: ${d.gs}`);
  }
  assert.equal(report.directions.find((d) => d.gs === 'Курський').shared, true);
  assert.equal(report.source, 'ArmyInform (Ministry of Defence of Ukraine) · CC BY 4.0');
  assert.equal(report.official, 'ua');
  assert.equal(parseGeneralStaffReport([]).ok, false);
});

test('reportByScene: dva GŠ smery na jeden preset, zdieľaný odsek raz, neuvedený počet = unknown', () => {
  const report = parseGeneralStaffReport(P, { publishedAt: '2026-09-19T06:28:03Z' });
  const byScene = reportByScene(report, frontSceneByGsDirection);
  assert.equal(byScene.get('sumy').attacks, 0, 'Severoslobožanský + Kurský zdieľajú odsek „bez akcií" → 0, nie 0+0 a nie null');
  assert.deepEqual(byScene.get('sumy').gs, ['Північно-Слобожанський', 'Курський']);
  assert.equal(byScene.get('sumy').texts.length, 1);
  assert.equal(byScene.get('sloviansk-kramatorsk').attacks, 9, 'Slovianský 8 + Kramatorský 1 = dva odseky sa sčítajú');
  assert.equal(byScene.get('lyman').attacks, 5);
  assert.equal(byScene.get('pokrovsk').attacks, 29);
  assert.equal(byScene.has('front'), false, 'prehľad nemá GŠ smer');
  assert.equal(byScene.size, 11);
  const unknown = reportByScene({ directions: [{ gs: 'Лиманський', attacks: null, text: 'x' }] }, frontSceneByGsDirection);
  assert.equal(unknown.get('lyman').attacks, null);
  assert.equal(unknown.get('lyman').unknown, true);
  assert.equal(reportByScene(null, frontSceneByGsDirection).size, 0);
});

test('extractReportParagraphs: len odseky hlásenia z div.single-content, koniec pri stratách / inzerátoch', () => {
  const html = `<html><body><p>Menu Меню навігації тут</p><div class="single-content"><p>${P[0]}</p><p><strong>${P[1]}</strong></p>
    <p>${P[5]}</p><p>Короткий</p><p>${P[18]}</p></div><p>Gemini ChatGPT Claude Генеральний штаб ЗСУ</p><p>від 20000 до 120000 грн</p></body></html>`;
  const paragraphs = extractReportParagraphs(html);
  // Odseky vychádzajú normalizované (typografický apostrof → ').
  assert.deepEqual(paragraphs, [P[0], P[1], P[5], P[18]].map(normalizeUkText));
  const cut = extractReportParagraphs(`<div class="single-content"><p>${P[0]}</p><p>Gemini ChatGPT Claude</p><p>${P[6]}</p></div>`);
  assert.deepEqual(cut, [normalizeUkText(P[0])], 'zdieľacie tlačidlá ukončia hlásenie');
  assert.deepEqual(extractReportParagraphs(''), []);
});

test('fetchUkraineReport: JSON alebo výnimka so statusom', async () => {
  const ok = await fetchUkraineReport({ fetcher: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, total: 213 }) }) });
  assert.equal(ok.total, 213);
  await assert.rejects(
    fetchUkraineReport({ fetcher: async () => ({ ok: false, status: 502, json: async () => ({ error: 'upstream' }) }) }),
    (e) => e.message === 'upstream' && e.status === 502,
  );
});

test('čas hlásenia: ArmyInform píše hodinu raz s dvojbodkou, raz s bodkou', () => {
  // Skutočné vety zo zdroja. 21. 9. 2026 mala dvojbodku, 22. 9. bodku — kým sme
  // brali len dvojbodku, hlásenie na doméne nevedelo povedať, kedy platí
  // (reportedAt aj reportedAtText boli null).
  const dot = reportTimestamp(
    'Про це йдеться у зведенні Генерального штабу ЗСУ з оперативною інформацією станом на 08.00 22 вересня.',
    { year: 2026 },
  );
  assert.ok(dot, 'bodkový tvar sa musí nájsť');
  assert.deepEqual({ time: dot.time, day: dot.day, month: dot.month }, { time: '08:00', day: 22, month: 9 });
  assert.equal(dot.iso, '2026-09-22T05:00:00.000Z');

  // Oddeľovač zdroja sa nesmie presakovať do popisku — vždy HH:MM.
  assert.equal(reportTimestamp('станом на 8:00 1 січня', { year: 2026 }).time, '08:00', 'jednociferná hodina sa doplní nulou');
  assert.equal(reportTimestamp('станом на 8.00 1 січня', { year: 2026 }).time, '08:00');

  // Čokoľvek iné než dvojbodka/bodka nie je čas.
  assert.equal(reportTimestamp('станом на 08,00 22 вересня', { year: 2026 }), null);
  assert.equal(reportTimestamp('станом на 0800 22 вересня', { year: 2026 }), null);
});

test('keď „станом на" utečie od vydania článku, rozhoduje vydanie', () => {
  // Skutočný prípad: článok z 11. 9. 2026 doslova píše „станом на 8:00 11 серпня".
  // Kým sme značke verili, septembrové hlásenie sa tvárilo ako augustové a
  // v archíve prepísalo skutočný 11. august.
  const ps = [
    'Протягом минулої доби загалом зафіксовано 235 бойових зіткнень.',
    'Про це йдеться в оперативній інформації Генерального штабу ЗСУ станом на 8:00 11 серпня.',
    'На Лиманському напрямку ворог 12 разів атакував наші позиції.',
  ];
  const r = parseGeneralStaffReport(ps, { publishedAt: '2026-09-11T05:11:49.000Z', url: 'u', title: 't' });
  assert.equal(r.stampDrifted, true);
  assert.equal(r.reportedAt, '2026-09-11T05:11:49.000Z', 'deň vydania je kotva');
  assert.equal(r.reportedAtText, '11.9.', 'hodinu nepoznáme, tak ju netvrdíme');
  assert.equal(r.sourceStampText, '08:00 11.8.', 'čo tvrdil zdroj, ostáva k dispozícii');
});

test('bežný rozdiel v minútach značku nezhodí', () => {
  const ps = [
    'Протягом минулої доби загалом зафіксовано 248 бойових зіткнень.',
    'Про це йдеться у зведенні Генерального штабу ЗСУ станом на 08.00 22 вересня.',
    'На Лиманському напрямку ворог 12 разів атакував наші позиції.',
  ];
  const r = parseGeneralStaffReport(ps, { publishedAt: '2026-09-22T05:11:23.000Z', url: 'u', title: 't' });
  assert.equal(r.stampDrifted, false);
  assert.equal(r.reportedAtText, '08:00 22.9.', 'dôveryhodná značka sa zobrazí aj s hodinou');
  assert.equal(r.reportedAt, '2026-09-22T05:00:00.000Z');
});

test('prah posunu je práve na hranici tolerantný', () => {
  const ps = ['Загалом 100 бойових зіткнень.', 'станом на 08:00 11 вересня.', 'На Лиманському напрямку ворог 1 раз атакував.'];
  const base = Date.parse('2026-09-11T05:00:00.000Z');
  const at = (ms) => parseGeneralStaffReport(ps, { publishedAt: new Date(base + ms).toISOString(), url: 'u', title: 't' });
  assert.equal(at(REPORT_STAMP_DRIFT_MS).stampDrifted, false, 'presne na prahu ešte veríme');
  assert.equal(at(REPORT_STAMP_DRIFT_MS + 60_000).stampDrifted, true);
});

test('bez času publikovania niet s čím porovnávať — značka platí', () => {
  const ps = ['Загалом 100 бойових зіткнень.', 'станом на 08:00 11 серпня.', 'На Лиманському напрямку ворог 1 раз атакував.'];
  const r = parseGeneralStaffReport(ps, { url: 'u', title: 't' });
  assert.equal(r.stampDrifted, false);
  assert.equal(r.reportedAtText, '08:00 11.8.');
});
