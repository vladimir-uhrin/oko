// Výber akčných záberov pre „Deň na fronte" — skutočné nadpisy ArmyInform (1.–5. 10. 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyClip, pickActionClips } from './frontDayClips.js';

const NOW = Date.parse('2026-10-05T07:30:00Z');
let n = 0;
const ai = (title, hoursAgo = 3) => ({ provider: 'file', id: `ai:https://armyinform.com.ua/x/${++n}`, url: `https://armyinform.com.ua/x/${n}`,
  videoUrl: `https://armyinform.stream/v/${n}.mp4`, title, publishedAt: NOW - hoursAgo * 3600_000 });
const caption = title => classifyClip(ai(title))?.captionSk ?? null;

test('akčné videá: sloveso, cieľ a smer z ukrajinského nadpisu, popis po slovensky', () => {
  assert.equal(caption('«Гвоздика» відцвіла: ЗСУ знищили ворожу САУ на Гуляйпільському напрямку'), 'Ukrajinské sily zničili ruskú samohybnú húfnicu');
  assert.equal(classifyClip(ai('«Гвоздика» відцвіла: ЗСУ знищили ворожу САУ на Гуляйпільському напрямку')).direction, 'huliaipole');
  assert.equal(caption('Сили оборони уразили ворожий ЗРК, РЛС та артилерійську установку'), 'Ukrajinské sily zasiahli ruské protilietadlové systémy');
  assert.equal(caption('Дрон «Гарту» наздогнав та уразив ворожий танк на Південно-Слобожанському напрямку'), 'Ukrajinské sily zasiahli ruský tank');
  assert.equal(caption('Новітня російська розробка: Сили оборони збили ворожий БПЛА «Молнія-13»'), 'Ukrajinské sily zostrelili ruský dron');
  assert.equal(caption('Позиції «Іскандерів» на Брянщині потрапили під український удар — Володимир Зеленський'), 'Ukrajinské sily zasiahli ruské komplety Iskander');
  assert.equal(caption('Бригада «Форпост» повернула під контроль понад 10 км² української території'), 'Ukrajinské sily oslobodili ďalšie územie');
});

test('cieľ = predmet za slovesom; slovo od začiatku (rozbitá ≠ zostrelená)', () => {
  assert.equal(caption('За 20 хвилин знищив два «Ланцети» з АКC: прикордонник «Тарх» працює з РЛС та захищає небо'), 'Ukrajinské sily zničili ruský dron', 'Lancety, nie radar');
  assert.equal(caption('«Хижак» знищив ворожу РЛС, яка виявляла українські дрони та авіацію'), 'Ukrajinské sily zničili ruský radar', 'radar, nie drony');
  assert.equal(caption('Спалена техніка, розбита піхота: 7-й корпус ДШВ показав відбиття «пробного» механізованого штурму на Запоріжжі'),
    'Ukrajinské sily zničili ruskú techniku', '„розбита" nie je „збит" (zostrelenie)');
});

test('rozhovory, príbehy a návštevy nie sú akčný záber; zásah ľudí je povolený, ale citlivý', () => {
  for (const title of ['«Вони реально хапнули там»: боєць «Лакі» про спробу окупантів контратакувати в районі Карпівки',
    'Підірвався на ОЗМ-72 і заново вчився ходити: історія оператора ССО «Якута»',
    'Попри повітряну тривогу Фрідріх Мерц відвідав у Києві місце удару рф по Національній академії наук',
    '«Ворога не годуємо, але і своїх не кидаємо»: морпіхи проводять в Олешках масштабну гуманітарну місію']) {
    assert.equal(classifyClip(ai(title)), null, title);
  }
  const people = classifyClip(ai('Намагаються просочуватися: «Гарт» знищує окупантів на Південно-Слобожанському напрямку'));
  assert.deepEqual([people.captionSk, people.sensitive], ['Ukrajinské sily zničili ruských vojakov', true], 'vlastník 2026-10-05: ľudia povolení, len citlivé');
  assert.equal(classifyClip({ ...ai('ЗСУ знищили ворожу САУ'), provider: 'telegram' }), null, 'len stiahnuteľné MP4 ArmyInform');
  assert.equal(classifyClip({ ...ai('ЗСУ знищили ворожу САУ'), videoUrl: 'http://x/v.mp4' }), null, 'len https');
});

test('výber dňa: smer príbehu navrchu, citlivé nižšie, čerstvé, každý cieľ raz', () => {
  const media = [
    ai('Дрон «Гарту» наздогнав та уразив ворожий танк на Південно-Слобожанському напрямку', 2),
    ai('«Давно ворог їх не підтягував»: бійці «Фенікса» уразили на Торецькому напрямку російський танк', 1),
    ai('«Гвоздика» відцвіла: ЗСУ знищили ворожу САУ на Гуляйпільському напрямку', 18),
    ai('Намагаються просочуватися: «Гарт» знищує окупантів на Південно-Слобожанському напрямку', 0.5),
    ai('Новітня російська розробка: Сили оборони збили ворожий БПЛА «Молнія-13»', 40),
  ];
  const picked = pickActionClips(media, { now: NOW, max: 2, focusDirections: ['huliaipole', 'pokrovsk'] });
  assert.equal(picked[0].captionSk, 'Ukrajinské sily zničili ruskú samohybnú húfnicu', 'smer príbehu dňa prvý');
  assert.equal(picked[1].captionSk, 'Ukrajinské sily zasiahli ruský tank', 'druhý: iný cieľ');
  assert.ok(!picked.some(c => c.sensitive), 'citlivé len keď nie je nič iné');
  assert.ok(!picked.some(c => c.title.includes('Молнія')), 'staršie než 30 h nie');
  assert.deepEqual(pickActionClips([media[3]], { now: NOW }).map(c => c.sensitive), [true], 'citlivý ide, ak nie je iný');
});
