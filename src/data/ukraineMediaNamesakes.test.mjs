// src/data/ukraineMediaNamesakes.test.mjs — menovce a oblasti v ukrajinskom texte
// (2026-09-24): poplach „Житомирщина: БпЛА … Нова Борова" stál na mape pri Borovej
// na Charkovsku (640 km vedľa) a karta zo Žitomirska visela nad Donbasom; „на
// Лиманку на Одещині" skončila v Lymane. Prípady nižšie pochádzajú z reálneho
// archívu médií (D:/OKO/gev-cache/ukraine/events/media) a z nezávislej kontroly.
import test from 'node:test';
import assert from 'node:assert/strict';

import { OBLAST_NAMESAKE_KM, OBLAST_QUALIFY_CHARS, UK_OBLAST_HINTS, locateUkText } from './ukraineMedia.js';

const at = (text) => locateUkText(text)?.name ?? null;

test('„Нова Борова" nie je Borova; bez sídla len oblasť gazetteeru (nápovedy polohu nedávajú)', () => {
  assert.equal(at('🗺 Житомирщина: 🛵 БпЛА в р—ні н.п. , Нова Борова, рухаються західним курсом'), null, 'Žitomirsko nie je v gazetteeri → bez bodu, nie Borova');
  assert.equal(at('Харківщина: БпЛА на Борову'), 'Borova', 'Borova na Charkovsku ostáva');
  assert.equal(at('Нова Одеса під обстрілом'), null, 'Нова Одеса ≠ Odesa');
  assert.equal(at('Велика Новосілка під вогнем'), 'Velyka Novosilka', 'dvojslovný kmeň ostáva');
  assert.equal(at('Нова Каховка: обстріл'), 'Nova Kakhovka');
  // Nápovedy oblastí mimo gazetteeru samy bod nedávajú (inak by pribudli stovky
  // bodov v ťažiskách oblastí vrátane príbehov o ľuďoch).
  assert.equal(at('Вибухи на Рівненщині'), null);
  assert.equal(at('Удар по Закарпатській області'), null);
  assert.equal(at('Буковинець Олександр, відомий як блогер'), null, 'obyvateľské meno nie je oblasť');
});

test('„Біля X" (pri) a „Новини X" (správy) nie sú prídavné mená pred menom sídla', () => {
  assert.equal(at('Біля Покровська тривають запеклі бої.'), 'Pokrovsk');
  assert.equal(at('Біля Харкова збито ракету.'), 'Kharkiv');
  assert.equal(at("Біля Куп'янська ворог штурмує позиції."), 'Kupiansk');
  assert.equal(at('Новини Одеси: вибухи вночі'), 'Odesa');
});

test('„X-ська область" v každom páde je oblasť, nie mesto', () => {
  assert.deepEqual(locateUkText('Донецька область: без втрат'), { name: 'Donetsk Oblast', lat: 48.3, lon: 37.5, approx: true });
  assert.equal(at('Балки Донецької області'), 'Donetsk Oblast', 'genitív s і/ї');
  assert.equal(at('Ворог атакував порт в Одеській області'), 'Odesa Oblast', 'lokál');
  assert.equal(at('Одеська область: удар по порту'), 'Odesa Oblast');
  assert.equal(at('Удар по Луганську'), 'Luhansk', 'mesto v inom tvare ostáva mestom');
  assert.equal(at("Донецька область: ворог обстріляв Слов'янськ"), 'Sloviansk', 'sídlo v oblasti vyhrá nad oblasťou');
  assert.equal(at('Тернопільщина: ударний БпЛА курсом на Чортків'), null, '„Тернопільщина" nie je mesto Ternopiľ');
});

test('oblasť rozhodne o menovcovi len keď sídlo naozaj kvalifikuje', () => {
  assert.equal(OBLAST_NAMESAKE_KM, 250);
  assert.equal(OBLAST_QUALIFY_CHARS, 60);
  // Za sídlom len cez predložku.
  // 2026-09-26 (so súhlasom): kmeň Lymanu už nematchuje „Лиманка" (iné sídlo), preto
  // menovec = Лиман na Odesku (obec pri Tatarbunaroch), nie Лиманка.
  const r = locateUkText('Реактивний БпЛА на Лиман на Одещині з моря. На Одесу!');
  assert.equal(r.name, 'Odesa Oblast', 'Лиман na Odesku ≠ Lyman na Donbase');
  assert.equal(locateUkText('Реактивний БпЛА на Лиманку на Одещині з моря. На Одесу!')?.name, 'Odesa', 'Лиманка nie je Lyman — ostáva mesto Odesa z vety');
  assert.equal(r.approx, true);
  assert.equal(at('Бої за Лиман тривають, Донеччина'), 'Lyman', 'čiarka a sloveso medzi = nekvalifikuje');
  // Pred sídlom v tom istom úseku (aj s emoji hneď za nadpisom oblasti).
  assert.equal(at('Львівщина: вибухи у Покровську'), 'Lviv Oblast');
  assert.equal(at('Сумщина: обстріл Конотопа'), 'Konotop', 'blízka oblasť potvrdí sídlo');
  // Iná veta, iná položka zoznamu (emoji), zoznam oblastí → nerozhoduje (reálne kpszsu).
  assert.equal(at('Київ: постраждали 16 людей. Дніпропетровщина: загинули 5 людей'), 'Kyiv');
  assert.equal(at('Дніпропетровщини, курс на захід. 🏍 Реактивний БпЛА курсом на Київ'), 'Kyiv');
  assert.equal(at('КАБи на Запорізьку область. 🛵 БпЛА в напрямку Харкова'), 'Kharkiv');
  assert.equal(at('🏍 Реактивний БпЛА на півночі Одещини в напрямку Вінниччини 🏍 Реактивний БпЛА південніше Кривого Рогу курсом на північ'), 'Kryvyi Rih', 'emoji začína novú položku');
  assert.ok(Object.keys(UK_OBLAST_HINTS).length >= 17, 'všetky oblasti mimo gazetteeru');
  for (const [name, h] of Object.entries(UK_OBLAST_HINTS)) {
    assert.ok(Number.isFinite(h.lat) && Number.isFinite(h.lon) && h.lat > 44 && h.lat < 53 && h.lon > 22 && h.lon < 41, `${name} v Ukrajine`);
  }
  // Nápovedy s ošetrenými koncovkami: „Буковина" áno (ako kvalifikácia), „Буковинець" nie.
  assert.equal(at('Буковина: вибухи у Покровську'), 'Chernivtsi Oblast');
  assert.equal(at('Буковинець: вибухи у Покровську'), 'Pokrovsk');
  assert.equal(at('Закарпатська область: вибухи у Покровську'), 'Zakarpattia Oblast');
});

test('tvar a predložka oblasti: odkiaľ/kam nekvalifikuje, nadpis a lokál áno (reálne hlásenia Vzdušných síl)', () => {
  // odkiaľ / vlastník pred mestom
  assert.equal(at('🏍 Реактивний БпЛА з Одещини на Вінницю'), 'Vinnytsia');
  assert.equal(at('Рятувальники Сумщини допомагають у Харкові'), 'Kharkiv');
  // kam za mestom
  assert.equal(at('🏍 Реактивний БпЛА повз Полтаву на Київщину.'), 'Poltava');
  assert.equal(at('🏍 Реактивний БпЛА повз Кропивницький на Вінниччину.'), 'Kropyvnytskyi');
  // nadpis s emoji a skratky „н.п.", „р-ні" — menovec z inej oblasti
  assert.equal(at('🗺 Житомирщина: 🛵 БпЛА в р—ні Борової, рухаються західним курсом'), 'Zhytomyr Oblast');
  assert.equal(at('🗺 Житомирщина: 🛵 БпЛА в р-ні н.п. Борова, курс західний'), 'Zhytomyr Oblast');
  // genitív za sídlom bez predložky kvalifikuje
  assert.equal(at('🛵 БпЛА у напрямку Новомиколаївки Запорізької області із півдня'), 'Zaporizhzhia Oblast');
  // „обл." a súradné prídavné mená s množným „областей"
  assert.equal(at('Реактивний БпЛА на межі Вінницької та Черкаської областей'), null, 'nie mesto Vinnycia');
  assert.equal(at('БпЛА на межі Одеської та Миколаївської областей'), 'Odesa Oblast');
  assert.equal(at('з Брянської обл., рф - на Чернігівщину'), null, 'nie mesto Briansk');
  assert.equal(at('у Києві та Київській області прогнозують дощі'), 'Kyiv', 'mesto a oblasť spolu — mesto ostáva');
});

test('regióny a prídavné tvary miest na -ськ', () => {
  assert.equal(at('Вибухи у Старому Криму'), 'Crimea', 'Старий Крим leží na Kryme');
  assert.equal(at('Ворог просунувся поблизу Нового Донбасу'), 'Donbas');
  assert.equal(at('Селище Покровське майже вщент зруйноване'), null, 'dedina Покровське ≠ Pokrovsk');
  assert.equal(at('У Покровському районі тривають бої'), 'Pokrovsk');
  assert.equal(at('з Краматорського відтинку поблизу Федорівки'), 'Kramatorsk', 'úsek frontu nesie meno mesta');
  assert.equal(at('Вибухи у Кропивницькому'), 'Kropyvnytskyi', 'meno mesta je samo prídavné meno');
  assert.equal(at('у районах Луганського та Покровська Донецької області'), 'Pokrovsk', 'Луганське (dedina) ≠ Luhansk');
});
