// src/data/bookmarkStore.js
/**
 * @module bookmarkStore
 * @description Záložky: uložiť si let, letisko alebo pohľad a vrátiť sa k nim.
 *
 * Čistý modul — žiadny Cesium, žiadny DOM. `localStorage` sa rieši lenivo a
 * v try/catch, lebo v súkromnom režime prehliadača hádže výnimku už samotný
 * PRÍSTUP k nemu (nie až zápis), a appka sa kvôli záložkám nesmie rozbiť.
 *
 * TOLERANTNÁ MIGRÁCIA, na rozdiel od `layerState`: tam je stav jeden atóm a
 * pri nesúhlase verzie sa zahodí celý. Tu je každá záložka samostatný záznam,
 * takže neznáma verzia alebo jeden pokazený riadok nesmie zmazať zvyšok —
 * prejde sa zoznam, čo sa nedá prečítať, sa preskočí, ostatné prežije.
 */

/** Kľúč v localStorage. Verzia je v tele dokumentu, nie v názve kľúča —
 *  migrácia tak môže starý obsah prečítať namiesto toho, aby ho stratila. */
export const BOOKMARKS_STORAGE_KEY = 'gev:bookmarks:v1';

/** Verzia formátu dokumentu. */
export const BOOKMARKS_VERSION = 1;

/** Strop počtu záložiek. Zoznam má ostať prehľadný; pri prekročení vypadne
 *  najstaršia, nie novo pridaná — inak by ukladanie ticho zlyhávalo. */
export const MAX_BOOKMARKS = 30;

/** Typy, ktoré vieme obnoviť. */
export const BOOKMARK_TYPES = Object.freeze(['flight', 'airport', 'view']);

let _seq = 0;

/** Deterministicky rastúce id (rovnaký idióm ako scény). */
function uid() {
  _seq += 1;
  return `bm-${_seq.toString(36)}-${Math.abs(Math.round(_seq * 2654435761 % 1e6)).toString(36)}`;
}

/** Test seam: čistý štart číslovania. */
export function _resetBookmarkIdsForTest() {
  _seq = 0;
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value, max = 120) {
  return String(value ?? '').trim().slice(0, max);
}

/**
 * Znormalizuje jeden záznam; vráti null, keď sa nedá použiť.
 *
 * Záložka bez cieľa nemá zmysel — na rozdiel od filmového záberu, ktorý sa dá
 * doplniť neskôr, sa na „nikam" nedá skočiť.
 * @param {object|null} raw Surový záznam.
 * @returns {object|null}
 */
export function normalizeBookmark(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = BOOKMARK_TYPES.includes(raw.type) ? raw.type : null;
  if (!type) return null;

  const camera = raw.camera && typeof raw.camera === 'object'
    ? {
      lat: num(raw.camera.lat),
      lon: num(raw.camera.lon),
      alt: num(raw.camera.alt, 1000),
      heading: num(raw.camera.heading),
      pitch: num(raw.camera.pitch, -35),
    }
    : null;
  const ref = text(raw.ref, 24) || null;

  // Let a letisko potrebujú identitu; pohľad potrebuje kameru.
  if ((type === 'flight' || type === 'airport') && !ref) return null;
  if (type === 'view' && !camera) return null;

  return {
    id: text(raw.id, 40) || uid(),
    type,
    name: text(raw.name) || ref || 'BOOKMARK',
    ref: type === 'flight' && ref ? ref.toLowerCase() : ref,
    layerId: text(raw.layerId, 40) || null,
    camera,
    createdAt: text(raw.createdAt, 40) || null,
  };
}

/**
 * Znormalizuje celý dokument. Neznáma verzia sa NEZAHADZUJE — prejde sa
 * zoznam a zachráni sa, čo sa dá.
 * @param {object|null} doc
 * @returns {object[]}
 */
export function normalizeBookmarkList(doc) {
  const items = Array.isArray(doc) ? doc : (Array.isArray(doc?.items) ? doc.items : []);
  const out = [];
  const seen = new Set();
  for (const raw of items) {
    const bookmark = normalizeBookmark(raw);
    if (!bookmark || seen.has(bookmark.id)) continue;
    seen.add(bookmark.id);
    out.push(bookmark);
    if (out.length >= MAX_BOOKMARKS) break;
  }
  return out;
}

/** Dokument na zápis. */
export function serializeBookmarks(list) {
  return JSON.stringify({ v: BOOKMARKS_VERSION, items: normalizeBookmarkList({ items: list }) });
}

/** Tolerantný opak `serializeBookmarks`. */
export function parseBookmarks(raw) {
  if (!raw) return [];
  try {
    return normalizeBookmarkList(JSON.parse(String(raw)));
  } catch {
    return []; // pokazený zápis nie je dôvod padnúť
  }
}

/**
 * Načíta záložky. Nikdy nehádže — bez úložiska vráti prázdny zoznam.
 * @param {Storage} [storage]
 * @returns {object[]}
 */
export function loadBookmarks(storage) {
  try {
    const store = storage ?? globalThis.localStorage;
    return parseBookmarks(store?.getItem(BOOKMARKS_STORAGE_KEY));
  } catch {
    return []; // súkromný režim: prístup k localStorage sám hádže
  }
}

/**
 * Uloží záložky.
 * @param {object[]} list
 * @param {Storage} [storage]
 * @returns {boolean} Či sa naozaj zapísalo.
 */
export function saveBookmarks(list, storage) {
  try {
    const store = storage ?? globalThis.localStorage;
    if (!store) return false;
    store.setItem(BOOKMARKS_STORAGE_KEY, serializeBookmarks(list));
    return true;
  } catch {
    return false;
  }
}

/**
 * Pridá záložku a vráti NOVÝ zoznam (nemutuje vstup).
 *
 * Pri strope vypadne najstaršia položka, nie novo pridaná — ukladanie, ktoré
 * ticho nič nespraví, je horšie než ukladanie, ktoré niečo vytlačí.
 * @param {object[]} list
 * @param {object} raw
 * @returns {object[]}
 */
export function addBookmark(list, raw) {
  const bookmark = normalizeBookmark(raw);
  if (!bookmark) return Array.isArray(list) ? [...list] : [];
  const current = Array.isArray(list) ? list.filter((item) => item?.id !== bookmark.id) : [];
  const next = [bookmark, ...current];
  return next.slice(0, MAX_BOOKMARKS);
}

/** Odstráni záložku podľa id; vráti nový zoznam. */
export function removeBookmark(list, id) {
  const key = text(id, 40);
  return (Array.isArray(list) ? list : []).filter((item) => item?.id !== key);
}
