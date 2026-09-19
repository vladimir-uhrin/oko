// src/data/latinize.test.mjs
// Prepis cyriliky pre popisky potrubí (2026-09-19): ruština, ukrajinčina
// (h/y a є/ї/і/ґ), bieloruština, kazaština, verzálky, miešaný text; latinka,
// arabčina a čínština sa nedotýkajú; originál ostáva na druhý riadok.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasCyrillic, latinizeCyrillic, latinizeForDisplay, scriptOf } from './latinize.js';

test('ruské názvy potrubí zo snímku', () => {
  assert.equal(latinizeCyrillic('Уренгой — Помары — Ужгород'), 'Urengoy — Pomary — Uzhgorod');
  assert.equal(latinizeCyrillic('Ямбург — Западная граница'), 'Yamburg — Zapadnaya granitsa');
  assert.equal(latinizeCyrillic('Сила Сибири'), 'Sila Sibiri');
  assert.equal(latinizeCyrillic('ООО «Газпром трансгаз Югорск»'), 'OOO «Gazprom transgaz Yugorsk»');
  assert.equal(latinizeCyrillic('Восточная Сибирь - Тихий океан'), 'Vostochnaya Sibir - Tikhiy okean');
  assert.equal(latinizeCyrillic('Щёлково'), 'Shchyolkovo');
  assert.equal(latinizeCyrillic('Объект'), 'Obekt', 'tvrdý a mäkký znak sa vynechajú');
});

test('ukrajinčina podľa ukrajinských písmen alebo jazyka zo snímku: г → h, и → y, є/ї/і', () => {
  // Bez ukrajinských písmen a bez nápovedy padne text na ruštinu — poctivá
  // hranica bez slovníka; s `lang: 'uk'` (name:uk = name v OSM) je to správne.
  assert.equal(latinizeCyrillic('Уренгой — Помари — Ужгород'), 'Urengoy — Pomari — Uzhgorod');
  assert.equal(latinizeCyrillic('Уренгой — Помари — Ужгород', { lang: 'uk' }), 'Urenhoy — Pomary — Uzhhorod', 'ukrajinský variant toho istého plynovodu');
  assert.equal(latinizeCyrillic('Долина-Ужгород-Державний кордон', { lang: 'uk' }), 'Dolyna-Uzhhorod-Derzhavnyy kordon');
  assert.equal(latinizeCyrillic('Долина-Ужгород-Державний кордон', { lang: 'ru' }), 'Dolina-Uzhgorod-Derzhavniy kordon');
  assert.equal(latinizeCyrillic('Магістральний газопровід СОЮЗ'), 'Mahistralnyy hazoprovid SOYUZ');
  assert.equal(latinizeCyrillic('Київ'), 'Kyyiv');
  assert.equal(latinizeCyrillic('Гомель – Горкі'), 'Homel – Horki', 'bieloruské і prepne ukrajinské pravidlá — h namiesto g');
});

test('kazaština, srbčina, verzálky a miešaný text', () => {
  assert.equal(latinizeCyrillic('Бұхара — Орал 1'), 'Bukhara — Oral 1');
  assert.equal(latinizeCyrillic('Қазақстан'), 'Qazaqstan');
  assert.equal(latinizeCyrillic('Ђердап'), 'Djerdap');
  assert.equal(latinizeCyrillic('ВСТО'), 'VSTO');
  assert.equal(latinizeCyrillic('"Союз"'), '"Soyuz"');
  assert.equal(latinizeCyrillic('Buxoro — Ural 1 / Бұхара — Орал 1 / Бухара — Урал 1'), 'Buxoro — Ural 1 / Bukhara — Oral 1 / Bukhara — Ural 1');
  assert.equal(latinizeCyrillic('Nord Stream 1'), 'Nord Stream 1', 'latinka bez zmeny');
  assert.equal(latinizeCyrillic(''), '');
  assert.equal(latinizeCyrillic(null), '');
});

test('scriptOf a latinizeForDisplay: latinka bez originálu, cyrilika s originálom, arabčina a čínština nedotknuté', () => {
  assert.equal(scriptOf('Trans Adriatic Pipeline'), 'latin');
  assert.equal(scriptOf('Družba'), 'latin');
  assert.equal(scriptOf('Дружба'), 'cyrillic');
  assert.equal(scriptOf('خط لوله گاز'), 'arabic');
  assert.equal(scriptOf('西气东输'), 'cjk');
  assert.equal(hasCyrillic('Türk Akımı'), false);
  assert.deepEqual(latinizeForDisplay('Дружба'), { text: 'Druzhba', original: 'Дружба' });
  assert.deepEqual(latinizeForDisplay('  Transgas '), { text: 'Transgas', original: null });
  assert.deepEqual(latinizeForDisplay('西气东输'), { text: '西气东输', original: null }, 'čínština sa neprepisuje — karta uprednostní name:en');
  assert.deepEqual(latinizeForDisplay(undefined), { text: '', original: null });
});
