// src/data/aircraftCategories.js
/**
 * UI zoskupenie tried z `classifyAircraft()` do kategórií, ktoré dávajú zmysel
 * v paneli vrstiev (požiadavka 2026-09-03: „vieš rozdeliť lietadlá na komerčné,
 * malé, vrtuľníky a podobne?").
 *
 * PREČO ZOSKUPENIE a nie priamo 10 tried: taxonómia siluet je vizuálna
 * (širokotrupý vs. úzkotrupý vs. štvormotorový majú iný glyf), ale operátor
 * v paneli rozmýšľa v prevádzkových kategóriách — dopravné lietadlo je jedna
 * vec bez ohľadu na počet motorov. Panel preto nesmie byť kópiou internej
 * taxonómie. Rozlíšenie siluet ostáva nedotknuté.
 *
 * Modul je ZÁMERNE bez i18n: vracia id kategórie, preklad rieši UI vrstva
 * (rovnaký kontrakt ako zvyšok src/data — dátové moduly nepoznajú jazyk).
 */

/** Kategórie v poradí, v akom sa majú zobraziť. Poradie je stabilné (nie podľa
 *  počtu) — skákajúci zoznam sa nedá klikať a rozpis sa mení každý poll. */
export const AIRCRAFT_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'commercial', classes: Object.freeze(['airliner', 'widebody', 'quadjet']) }),
  Object.freeze({ id: 'bizjet', classes: Object.freeze(['bizjet']) }),
  Object.freeze({ id: 'turboprop', classes: Object.freeze(['turboprop']) }),
  Object.freeze({ id: 'light', classes: Object.freeze(['light']) }),
  Object.freeze({ id: 'helicopter', classes: Object.freeze(['helicopter']) }),
  Object.freeze({ id: 'glider', classes: Object.freeze(['glider']) }),
  Object.freeze({ id: 'fastjet', classes: Object.freeze(['fastjet']) }),
  Object.freeze({ id: 'uav', classes: Object.freeze(['uav']) }),
]);

/** Zoznam id kategórií (stabilné poradie). */
export const AIRCRAFT_CATEGORY_IDS = Object.freeze(AIRCRAFT_CATEGORIES.map((c) => c.id));

const _CLASS_TO_CATEGORY = new Map();
for (const category of AIRCRAFT_CATEGORIES) {
  for (const klass of category.classes) _CLASS_TO_CATEGORY.set(klass, category.id);
}

/**
 * Kategória pre triedu z `classifyAircraft()`.
 *
 * Neznáma trieda padá na 'commercial' — presne ako `classifyAircraft()` sama
 * defaultuje na 'airliner'. Filter tak nikdy nezhltne kontakt do neviditeľnej
 * kategórie, ktorú operátor nemá ako zapnúť.
 * @param {string|null|undefined} klass Trieda kontaktu.
 * @returns {string} Id kategórie.
 */
export function categoryForClass(klass) {
  return _CLASS_TO_CATEGORY.get(String(klass || '')) || 'commercial';
}

/**
 * Rozpis počtov podľa kategórie.
 * @param {Iterable<string|null|undefined>} classes Triedy kontaktov.
 * @returns {Record<string, number>} Počet na kategóriu; kategórie bez kontaktu
 *   nesú 0, takže volajúci vie rozlíšiť „nula lietadiel" od „kategória zanikla".
 */
export function tallyByCategory(classes) {
  const tally = {};
  for (const id of AIRCRAFT_CATEGORY_IDS) tally[id] = 0;
  for (const klass of classes || []) tally[categoryForClass(klass)] += 1;
  return tally;
}

/**
 * Normalizuje uloženú/zdieľanú množinu SKRYTÝCH kategórií.
 *
 * Neznáme id sa zahadzujú (starý share odkaz alebo preklep v localStorage
 * nesmie skryť nič neurčité), a keby boli skryté VŠETKY, vráti prázdnu
 * množinu — vrstva zapnutá s nulou viditeľných kategórií je pasca, z ktorej
 * sa operátor v paneli nedostane klikom na vrstvu.
 * @param {Iterable<string>|null|undefined} hidden Kandidáti na skrytie.
 * @returns {Set<string>} Platná množina skrytých kategórií.
 */
export function normalizeHiddenCategories(hidden) {
  const valid = new Set();
  for (const id of hidden || []) {
    if (AIRCRAFT_CATEGORY_IDS.includes(id)) valid.add(id);
  }
  if (valid.size >= AIRCRAFT_CATEGORY_IDS.length) return new Set();
  return valid;
}
