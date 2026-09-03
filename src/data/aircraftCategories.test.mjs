// src/data/aircraftCategories.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AIRCRAFT_CATEGORIES,
  AIRCRAFT_CATEGORY_IDS,
  categoryForClass,
  normalizeHiddenCategories,
  tallyByCategory,
} from './aircraftCategories.js';
import { CLASS_SCALE_2D } from './aircraftClass.js';

test('každá trieda z classifyAircraft má práve jednu kategóriu', () => {
  // CLASS_SCALE_2D je autoritatívny zoznam tried (jeden kľúč na triedu).
  // Tento pin praskne, keď pribudne nová trieda a zabudne sa zaradiť —
  // inak by ticho spadla do 'commercial' a v paneli by sa nedala nájsť.
  const classes = Object.keys(CLASS_SCALE_2D);
  const mapped = new Set(AIRCRAFT_CATEGORIES.flatMap((c) => c.classes));
  for (const klass of classes) {
    assert.ok(mapped.has(klass), `trieda ${klass} nemá kategóriu`);
  }
  assert.equal(mapped.size, classes.length, 'kategórie nesmú niesť neexistujúcu triedu');
  // Žiadna trieda nesmie byť v dvoch kategóriách naraz.
  const all = AIRCRAFT_CATEGORIES.flatMap((c) => c.classes);
  assert.equal(all.length, mapped.size, 'trieda je zaradená viackrát');
});

test('categoryForClass: zoskupenie dopravných, zvyšok samostatne', () => {
  assert.equal(categoryForClass('airliner'), 'commercial');
  assert.equal(categoryForClass('widebody'), 'commercial');
  assert.equal(categoryForClass('quadjet'), 'commercial');
  assert.equal(categoryForClass('helicopter'), 'helicopter');
  assert.equal(categoryForClass('light'), 'light');
  assert.equal(categoryForClass('bizjet'), 'bizjet');
  // Neznáme padá tam, kam defaultuje aj classifyAircraft() — nikdy „nikam".
  assert.equal(categoryForClass('nieco-nove'), 'commercial');
  assert.equal(categoryForClass(null), 'commercial');
  assert.equal(categoryForClass(undefined), 'commercial');
});

test('tallyByCategory: rozpis nesie aj nuly', () => {
  const tally = tallyByCategory(['airliner', 'airliner', 'widebody', 'helicopter', null]);
  assert.equal(tally.commercial, 4, '3 dopravné + neznáme');
  assert.equal(tally.helicopter, 1);
  assert.equal(tally.glider, 0, 'prázdna kategória je 0, nie undefined');
  assert.deepEqual(Object.keys(tally), [...AIRCRAFT_CATEGORY_IDS], 'stabilné poradie kľúčov');
  assert.deepEqual(tallyByCategory([]), tallyByCategory(null), 'prázdny vstup ≡ žiadny vstup');
});

test('normalizeHiddenCategories: zahodí neznáme a nikdy neskryje všetko', () => {
  assert.deepEqual([...normalizeHiddenCategories(['helicopter', 'zmyslene'])], ['helicopter']);
  assert.deepEqual([...normalizeHiddenCategories(null)], []);
  // Skryť VŠETKY = pasca (vrstva zapnutá, nevidno nič a panel nedá ako späť).
  assert.equal(normalizeHiddenCategories(AIRCRAFT_CATEGORY_IDS).size, 0);
  // O jednu menej než všetky je legitímny stav (napr. „len vrtuľníky").
  assert.equal(
    normalizeHiddenCategories(AIRCRAFT_CATEGORY_IDS.filter((id) => id !== 'helicopter')).size,
    AIRCRAFT_CATEGORY_IDS.length - 1,
  );
});
