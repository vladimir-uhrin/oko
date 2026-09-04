// src/data/aircraftCategoryFilter.test.mjs
// Filter kategórií v leteckých vrstvách (2026-09-03, „vieš rozdeliť lietadlá
// na komerčné, malé, vrtuľníky a podobne?"). Testy sú TRIPWIRE nad zdrojom:
// obe vrstvy sú Cesium-viazané moduly, ktoré sa v Node nedajú inicializovať,
// tak sa pinuje kontrakt — nosné vlastnosti, na ktorých filter stojí.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AIRCRAFT_CATEGORY_IDS } from './aircraftCategories.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';

const SOURCES = [
  ['flights', readFileSync(new URL('./flights.js', import.meta.url), 'utf8')],
  ['military', readFileSync(new URL('./militaryFlights.js', import.meta.url), 'utf8')],
];

test('obe letecké vrstvy filtrujú cez TÚ ISTÚ bránu ako horizont', () => {
  // Jedno pravidlo o `bb.show`, nie dve konkurenčné: druhý zapisovač by sa
  // s horizontovým cullingom pretekal tick po ticku (kontakt by blikal).
  for (const [name, source] of SOURCES) {
    // 2026-09-04: do tej istej brány pribudol režim hustoty (flights.js) —
    // pin preto overuje, že filter je JEDNÝM z jej členov, nie že je prvý.
    assert.match(
      source,
      /const beyondHorizon = [\s\S]{0,160}?!_categoryVisible\(.*\)\s*\n\s*\|\| !occluder\.isPointVisible/,
      `${name}: skrytá kategória sa skladá do beyondHorizon`,
    );
    assert.match(source, /function _categoryVisible\(klass\)/, `${name}: má bránu kategórie`);
  }
});

test('filter skrýva sprite, NIKDY nezahadzuje dáta', () => {
  // Panel musí ukazovať zloženie oblohy, nie zloženie filtra — inak vypnutá
  // kategória spadne na nulu a operátor ju nemá podľa čoho zapnúť späť.
  for (const [name, source] of SOURCES) {
    assert.match(
      source,
      /for \(const meta of _flightData\.values\(\)\) classes\.push\(meta\?\.klass\)/,
      `${name}: rozpis počíta VŠETKY kontakty vrstvy`,
    );
    assert.doesNotMatch(
      source,
      /_categoryVisible[\s\S]{0,200}?_flightData\.delete/,
      `${name}: filter nesmie evictovať kontakty`,
    );
  }
});

test('setParams prijme filter a hneď vynúti prekreslenie', () => {
  for (const [name, source] of SOURCES) {
    assert.match(source, /Object\.hasOwn\(params, 'hiddenAircraftCategories'\)/, `${name}: číta param`);
    assert.match(source, /normalizeHiddenCategories\(params\.hiddenAircraftCategories\)/, `${name}: normalizuje`);
    // Bez týchto dvoch by klik v paneli čakal na najbližší tik (až 30 s).
    assert.match(source, /_hiddenCategories = next;\s*\n(\s*\/\/[^\n]*\n)*\s*_lastFleetTickMs = 0;/, `${name}: vynúti tik`);
    assert.match(source, /getParams\(\)[\s\S]{0,400}?hiddenAircraftCategories: \[\.\.\._hiddenCategories\]/, `${name}: stav je čitateľný späť`);
  }
});

test('čipy: len kategórie s kontaktmi alebo skryté, klik prepína', () => {
  for (const [name, source] of SOURCES) {
    assert.match(source, /getRowControls\(\) \{ return _categoryChips\(\); \}/, `${name}: vystavuje čipy`);
    // Kategória s nulou, ktorá NIE JE skrytá, sa nezobrazuje; skrytá áno —
    // inak by po odlete posledného stroja zmizla aj cesta, ako ju vrátiť.
    assert.match(source, /if \(count === 0 && !hidden\) continue;/, `${name}: skrytá nula ostáva v paneli`);
    assert.match(source, /if \(hidden\) next\.delete\(id\); else next\.add\(id\);/, `${name}: čip prepína`);
  }
});

test('filter NEPREŽÍVA reštart ani zdieľaný odkaz', () => {
  // Skrytá kategória, ktorá pricestuje v odkaze alebo prežije F5, je tá istá
  // pasca ako detekcia bootujúca do OFF: chýbajú lietadlá a nevidno prečo.
  // layerState kóduje len explicitne deklarované options — tento pin praskne,
  // keby niekto filter do kodéra pridal.
  const layerState = readFileSync(new URL('./layerState.js', import.meta.url), 'utf8');
  assert.doesNotMatch(layerState, /hiddenAircraftCategories/, 'filter nepatrí do share odkazu');
  for (const [name, source] of SOURCES) {
    assert.doesNotMatch(
      source,
      /localStorage[^\n]*[Cc]ategor/,
      `${name}: filter sa neukladá do localStorage`,
    );
  }
});

test('každá kategória má preklad v OBOCH jazykoch', () => {
  for (const id of AIRCRAFT_CATEGORY_IDS) {
    const key = `aircraft.category.${id}`;
    assert.ok(EN_STRINGS[key], `EN chýba ${key}`);
    assert.ok(SK_STRINGS[key], `SK chýba ${key}`);
  }
  for (const key of ['aircraft.category.hide', 'aircraft.category.show']) {
    assert.match(EN_STRINGS[key], /\{name\}[\s\S]*\{n\}/, `EN ${key} nesie obe premenné`);
    assert.match(SK_STRINGS[key], /\{name\}[\s\S]*\{n\}/, `SK ${key} nesie obe premenné`);
  }
});
