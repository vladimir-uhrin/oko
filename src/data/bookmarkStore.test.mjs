// src/data/bookmarkStore.test.mjs
// Záložky (2026-09-03). Ťažisko testov je v tom, čo sa stane s POKAZENÝM
// alebo STARÝM obsahom — o uložené záložky sa nesmie prísť kvôli jednému
// zlému riadku, a appka nesmie padnúť kvôli súkromnému režimu prehliadača.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOKMARKS_STORAGE_KEY,
  MAX_BOOKMARKS,
  addBookmark,
  loadBookmarks,
  normalizeBookmark,
  normalizeBookmarkList,
  parseBookmarks,
  removeBookmark,
  saveBookmarks,
  serializeBookmarks,
  _resetBookmarkIdsForTest,
} from './bookmarkStore.js';

const CAMERA = { lat: 48.1, lon: 17.1, alt: 5000, heading: 30, pitch: -40 };
const flight = (over = {}) => ({ type: 'flight', ref: '4B1815', name: 'SWR123', ...over });

function memoryStorage(initial = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next; },
    read: () => value,
  };
}

test('let a letisko potrebujú identitu, pohľad potrebuje kameru', () => {
  // Záložka bez cieľa nemá zmysel — na „nikam" sa nedá skočiť.
  assert.ok(normalizeBookmark(flight()));
  assert.equal(normalizeBookmark({ type: 'flight' }), null, 'let bez icao24');
  assert.equal(normalizeBookmark({ type: 'airport' }), null, 'letisko bez identu');
  assert.equal(normalizeBookmark({ type: 'view' }), null, 'pohľad bez kamery');
  assert.ok(normalizeBookmark({ type: 'view', camera: CAMERA }));
  assert.equal(normalizeBookmark({ type: 'nezmysel', ref: 'x' }), null, 'neznámy typ');
  for (const bad of [null, undefined, 'text', 42, []]) {
    assert.equal(normalizeBookmark(bad), null);
  }
});

test('icao24 sa normalizuje na malé písmená — inak by skok nenašiel kontakt', () => {
  assert.equal(normalizeBookmark(flight()).ref, '4b1815');
  // Ident letiska sa NEmení: OurAirports ho nesie veľkými.
  assert.equal(normalizeBookmark({ type: 'airport', ref: 'LZIB' }).ref, 'LZIB');
});

test('jeden pokazený záznam nesmie zmazať zvyšok', () => {
  // Rozdiel oproti layerState: tam je stav jeden atóm, tu je každá záložka
  // samostatná — strata celého zoznamu kvôli jednému riadku je neprijateľná.
  const list = normalizeBookmarkList({
    v: 999, // neznáma verzia sa NEZAHADZUJE
    items: [flight(), null, { type: 'zlé' }, { type: 'view', camera: CAMERA }, 'nezmysel'],
  });
  assert.equal(list.length, 2, 'prežili obe použiteľné');
});

test('duplicitné id sa zlúči, strop drží', () => {
  _resetBookmarkIdsForTest();
  const many = Array.from({ length: MAX_BOOKMARKS + 15 }, (_, i) => flight({ id: `bm-${i}`, ref: `aaa${i}` }));
  assert.equal(normalizeBookmarkList({ items: many }).length, MAX_BOOKMARKS);
  const dupes = normalizeBookmarkList({ items: [flight({ id: 'x' }), flight({ id: 'x', name: 'iné' })] });
  assert.equal(dupes.length, 1);
});

test('pri strope vypadne NAJSTARŠIA, nie novo pridaná', () => {
  // Ukladanie, ktoré ticho nič nespraví, je horšie než ukladanie, ktoré
  // niečo vytlačí — používateľ inak nevie, že sa jeho klik stratil.
  let list = [];
  for (let i = 0; i < MAX_BOOKMARKS; i++) {
    list = addBookmark(list, flight({ id: `bm-${i}`, ref: `aaa${i}`, name: `L${i}` }));
  }
  const withNew = addBookmark(list, flight({ id: 'novy', ref: 'ffffff', name: 'NOVÝ' }));
  assert.equal(withNew.length, MAX_BOOKMARKS);
  assert.equal(withNew[0].name, 'NOVÝ', 'nová je prvá');
  assert.ok(!withNew.some((b) => b.id === 'bm-0'), 'najstaršia vypadla');
});

test('addBookmark a removeBookmark nemutujú vstup', () => {
  const original = [normalizeBookmark(flight({ id: 'a' }))];
  const added = addBookmark(original, flight({ id: 'b', ref: 'ccdd11' }));
  assert.equal(original.length, 1, 'pôvodný zoznam sa nezmenil');
  assert.equal(added.length, 2);
  const removed = removeBookmark(added, 'a');
  assert.equal(added.length, 2);
  assert.deepEqual(removed.map((b) => b.id), ['b']);
  assert.deepEqual(removeBookmark(null, 'x'), []);
});

test('serializácia a spätné načítanie zachovajú obsah', () => {
  const list = [normalizeBookmark(flight({ id: 'a' })), normalizeBookmark({ type: 'view', camera: CAMERA, name: 'BA' })];
  const round = parseBookmarks(serializeBookmarks(list));
  assert.equal(round.length, 2);
  assert.equal(round[0].ref, '4b1815');
  assert.deepEqual(round[1].camera, CAMERA);
});

test('pokazený zápis v úložisku nespôsobí pád', () => {
  for (const junk of ['{', 'null', '[]', '', 'nie je json', '{"items":"nie pole"}']) {
    assert.deepEqual(parseBookmarks(junk), [], `${junk} → prázdny zoznam`);
  }
});

test('súkromný režim: prístup k localStorage hádže a appka to prežije', () => {
  // V Safari private mode hádže už samotný PRÍSTUP, nie až zápis.
  const hostile = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceededError'); },
  };
  assert.deepEqual(loadBookmarks(hostile), [], 'čítanie nespadne');
  assert.equal(saveBookmarks([normalizeBookmark(flight())], hostile), false, 'zápis poctivo povie, že sa nepodaril');
});

test('uloženie a načítanie cez úložisko', () => {
  const storage = memoryStorage();
  const list = [normalizeBookmark(flight({ id: 'a' }))];
  assert.equal(saveBookmarks(list, storage), true);
  assert.match(String(storage.read()), /"v":1/, 'dokument nesie verziu');
  assert.equal(loadBookmarks(storage).length, 1);
  assert.equal(loadBookmarks(memoryStorage(null)).length, 0, 'prázdne úložisko');
});

test('kľúč úložiska sa nekríži s inými stavmi appky', () => {
  assert.equal(BOOKMARKS_STORAGE_KEY, 'gev:bookmarks:v1');
});
