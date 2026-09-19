// src/data/ukraineReportPlaces.test.mjs — sídla z hlásenia GŠ: vytiahnutie zoznamov,
// genitív → nominatív, index a výber podľa blízkosti; odseky z hlásenia 19. 9. 2026.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlaceIndex, directionPlaces, extractPlaceMentions, nameCandidates, nominativeCandidates, placeKey, resolvePlace } from './ukraineReportPlaces.js';

test('vytiahnutie mien za spojeniami (čiarky, та/й/і, pomlčky, viac slov, koniec pri „а також")', () => {
  assert.deepEqual(extractPlaceMentions('На Куп’янському напрямку противник тричі атакував у районах Петропавлівки, Куп’янська-Вузлового та Новоосинового.'), ['Петропавлівки', 'Куп’янська-Вузлового', 'Новоосинового']);
  assert.deepEqual(extractPlaceMentions('На Слов’янському напрямку противник здійснив вісім штурмових дій у районах Ямполя та Кривої Луки, а також у напрямках Пискунівки та Рай-Олександрівки.'), ['Ямполя', 'Кривої Луки', 'Пискунівки', 'Рай-Олександрівки']);
  assert.deepEqual(extractPlaceMentions('П’ять атак росіяни здійснили на Лиманському напрямку — у районі Торського та в напрямках Надії й Новоселівки.'), ['Торського', 'Надії', 'Новоселівки']);
  assert.deepEqual(extractPlaceMentions('Російські війська діяли в районах Білицького, Сергіївки та Удачного, а також намагалися просунутися в напрямках Кучерового Яру, Торецького, Степів, Добропілля, Ганнівки, Світлого, Красноподілля, Новогришиного та Новопавлівки.'), ['Білицького', 'Сергіївки', 'Удачного', 'Кучерового Яру', 'Торецького', 'Степів', 'Добропілля', 'Ганнівки', 'Світлого', 'Красноподілля', 'Новогришиного', 'Новопавлівки']);
  assert.deepEqual(extractPlaceMentions('На Оріхівському напрямку українські захисники зупинили одну спробу противника просунутися в напрямку Малих Щербаків.'), ['Малих Щербаків']);
  assert.deepEqual(extractPlaceMentions('На Придніпровському напрямку російські війська штурмових дій не проводили.'), []);
  assert.deepEqual(extractPlaceMentions('Ворог здійснив 2952 обстріли населених пунктів і позицій українських військ.'), [], 'bez veľkého písmena nič');
  assert.deepEqual(extractPlaceMentions('На Південно-Слобожанському напрямку Сили оборони відбили 12 атак. Ворог намагався просунутися в районах Тернової, Потихонового, Стариці та Широкого, а також у напрямках Миколаївки та Зарубинки.'), ['Тернової', 'Потихонового', 'Стариці', 'Широкого', 'Миколаївки', 'Зарубинки']);
});

test('genitív → nominatív: pravidlá a výnimky', () => {
  const has = (w, n) => assert.ok(nominativeCandidates(w).includes(n), `${w} → ${n} (${nominativeCandidates(w).join('|')})`);
  has('Петропавлівки', 'Петропавлівка'); has('Новоосинового', 'Новоосинове'); has('Торського', 'Торське'); has('Надії', 'Надія'); has('Ямполя', 'Ямпіль');
  has('Стариці', 'Стариця'); has('Тернової', 'Тернова'); has('Широкого', 'Широке'); has('Мирнограда', 'Мирноград'); has('Покровська', 'Покровськ');
  has('Степів', 'Степи'); has('Терси', 'Терса'); has('Малих', 'Малі'); has('Щербаків', 'Щербаки'); has('Кучерового', 'Кучерів'); has('Верхньої', 'Верхня'); has('Харкова', 'Харків'); has('Яру', 'Яр');
  assert.deepEqual(nameCandidates('Часового Яру'), ['Часів Яр']);
  assert.ok(nameCandidates('Кривої Луки').includes('Крива Лука'));
  assert.ok(nameCandidates('Куп’янська-Вузлового').includes('Куп’янськ-Вузловий'));
  assert.ok(nameCandidates('Рай-Олександрівки').includes('Рай-Олександрівка'));
  assert.ok(nameCandidates('Малих Щербаків').includes('Малі Щербаки'));
  assert.equal(placeKey("Куп'янськ"), placeKey('Куп’янськ'), 'apostrofy zjednotené');
});

test('index a výber: viac rovnakých mien → najbližšie k stredu smeru; nezhoda = neurčené', () => {
  const feats = [
    { geometry: { type: 'Point', coordinates: [37.20337, 48.35399] }, properties: { name: 'Родинське', lang: 'uk', en: 'Rodynske', cls: 'town', pop: 9000 } },
    { geometry: { type: 'Point', coordinates: [37.86, 48.98] }, properties: { name: 'Торське', lang: 'uk', cls: 'village', pop: 2000 } },
    { geometry: { type: 'Point', coordinates: [30.1, 50.1] }, properties: { name: 'Новоселівка', lang: 'uk', cls: 'village', pop: 300 } },
    { geometry: { type: 'Point', coordinates: [37.7, 49.0] }, properties: { name: 'Новоселівка', lang: 'uk', cls: 'village', pop: 400 } },
    { geometry: { type: 'Point', coordinates: [37.95, 48.95] }, properties: { name: 'Ямпіль', lang: 'uk', cls: 'town', pop: 2000 } },
    { geometry: { type: 'Point', coordinates: [22.08, 48.41] }, properties: { name: 'Čierna nad Tisou', cls: 'town', pop: 4000 } },
    { geometry: { type: 'Point', coordinates: [37.08, 48.47] }, properties: { name: 'Добропілля', lang: 'uk', cls: 'town', pop: 31701 } },
    { geometry: { type: 'Point', coordinates: [37.30, 48.15] }, properties: { name: 'Добропілля', lang: 'uk', cls: 'village', pop: 1084 } },
  ];
  const index = buildPlaceIndex(feats);
  assert.equal(index.size, 5, 'latinské meno mimo, duplicitné meno v jednom kľúči');
  assert.equal(resolvePlace('Добропілля', index, { center: { lat: 48.3, lon: 37.2 } }).cls, 'town', 'mesto 21 km vyhrá nad obcou 18 km (bonus triedy)');
  assert.equal(resolvePlace('Добропілля', index, { center: { lat: 48.15, lon: 37.31 } }).cls, 'village', 'obec tesne pri strede vyhrá');
  assert.equal(index.get('новоселівка').length, 2);
  const lyman = { lat: 48.99, lon: 37.8 };
  assert.equal(resolvePlace('Торського', index, { center: lyman }).name, 'Торське');
  assert.equal(resolvePlace('Новоселівки', index, { center: lyman }).lon, 37.7, 'bližšia Novoselivka');
  assert.equal(resolvePlace('Новоселівки', index, { center: { lat: 50, lon: 30 } }).lon, 30.1);
  assert.equal(resolvePlace('Новоселівки', index, { center: { lat: 44, lon: 22 } }), null, 'ďalej než 120 km = nič');
  assert.equal(resolvePlace('Новоселівки', index).pop, 400, 'bez stredu = najľudnatejšie');
  assert.equal(resolvePlace('Ямполя', index, { center: lyman }).name, 'Ямпіль');
  const r = directionPlaces(['П’ять атак росіяни здійснили на Лиманському напрямку — у районі Торського та в напрямках Надії й Новоселівки.', 'Ще одна атака у районі Торського.'], index, lyman);
  assert.deepEqual(r.places.map((p) => `${p.name}:${p.mentions}`), ['Торське:2', 'Новоселівка:1']);
  assert.deepEqual(r.unresolved, ['Надії']);
});
