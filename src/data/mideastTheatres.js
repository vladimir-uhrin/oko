// src/data/mideastTheatres.js — dejiská modulu BLÍZKY VÝCHOD (etapa 1,
// 2026-09-26; plán docs/drafts/blizky-vychod-plan.md, kap. 2, 5 a 6).
//
// Dejisko = rámec pohľadu ako „smer" pri Ukrajine (ukraineFrontScenes.js):
// kamera sa postaví nad región, vypnú sa cudzie vrstvy správcu, zapnú sa
// vrstvy dejiska (pri Hormuze a Červenom mori lode z AIS, radar SAR, trasy,
// prístavy, potrubia) a hlavný modul zobrazí správy z otvorených zdrojov pre
// `newsRegion`. Nič viac — kontrola sídiel z Wikipédie (`control`), udalosti a
// časová os prídu v etapách 2–4 a budú sa na tieto presety viazať.
//
// Rovnaký tvar a filozofia ako ukraineFrontScenes.js a chokepointScenes.js:
// modul je ČISTÝ (bez Cesia, bez DOM), nepoužíva cinematic director, rámovanie
// sa vydáva POSLEDNÉ a je najlepšia snaha. Súradnice sú rámce pohľadu (návrh
// z plánu, doladia sa na obrazovke), nie línia frontu ani pozície jednotiek —
// etická čiara OKO: len udalosti a lode, žiadne osoby, tváre ani zameriavanie.

import { t } from '../i18n.js';
import { frontSceneLayersToDisable } from '../ukraineFrontScenes.js';
import { REGISTERED_LAYER_IDS } from './layerState.js';
import { SITUATION_REGIONS } from './situationNews.js';

/**
 * @typedef {object} MideastTheatre
 * @property {string} id
 * @property {string} name stabilné EN meno (fallback bez prekladu; bajtovo zhodné s `theatre.<id>.name` v EN slovníku)
 * @property {{lat: number, lon: number}} center stred dejiska (brána priblíženia meria vzdialenosť k nemu)
 * @property {ReadonlyArray<number>} rectDegrees [W, S, E, N]
 * @property {string} newsRegion kľúč `SITUATION_REGIONS` (správy z otvorených zdrojov pre dejisko)
 * @property {ReadonlyArray<string>} layerIds vrstvy správcu, ktoré dejisko zapne (id z `REGISTERED_LAYER_IDS`)
 * @property {ReadonlyArray<string>} control kľúče modulov Wikipédie pre etapu 2 (len dáta, zatiaľ bez správania)
 * @property {boolean} [overview] prehľad celého regiónu (práve jeden, prvý v katalógu)
 */

/** Námorná sada pre úžiny: lode (živé + oneskorené), radar SAR, trasy, prístavy. */
const MARITIME_LAYERS = Object.freeze(['ais-live-vessels', 'aishub-vessels', 'gfw-sar', 'local-shipping-lanes', 'local-ports']);

/** @type {ReadonlyArray<MideastTheatre>} */
export const MIDEAST_THEATRES = Object.freeze([
  Object.freeze({
    id: 'overview',
    name: 'Regional overview',
    center: Object.freeze({ lat: 29.0, lon: 45.0 }),
    rectDegrees: Object.freeze([30, 11, 63, 40]),
    newsRegion: 'mideast',
    layerIds: Object.freeze([]),
    control: Object.freeze([]),
    overview: true,
  }),
  Object.freeze({
    id: 'hormuz',
    name: 'Hormuz and the blockade',
    center: Object.freeze({ lat: 26.6, lon: 56.3 }),
    rectDegrees: Object.freeze([54, 24.5, 58.5, 28]),
    newsRegion: 'gulf',
    layerIds: Object.freeze([...MARITIME_LAYERS, 'gas-pipelines']),
    control: Object.freeze([]),
  }),
  Object.freeze({
    id: 'gulf',
    name: 'Gulf — energy infrastructure',
    center: Object.freeze({ lat: 26.5, lon: 52.0 }),
    rectDegrees: Object.freeze([47, 23, 57, 30.5]),
    newsRegion: 'gulf',
    // `local-energy` je snímok SLOVENSKEJ prenosovej siete (skEnergy.js) — na
    // Zálive nemá čo robiť (nález oponentúry 2026-09-26); potrubia nesú aj ropu.
    layerIds: Object.freeze(['gas-pipelines', 'local-ports']),
    control: Object.freeze([]),
  }),
  Object.freeze({
    id: 'iran',
    name: 'Iran — strikes',
    center: Object.freeze({ lat: 32.5, lon: 53.5 }),
    rectDegrees: Object.freeze([44, 25, 63.5, 39.8]),
    newsRegion: 'mideast',
    layerIds: Object.freeze([]),
    control: Object.freeze([]),
  }),
  Object.freeze({
    id: 'south-lebanon',
    name: 'South Lebanon',
    center: Object.freeze({ lat: 33.3, lon: 35.45 }),
    rectDegrees: Object.freeze([35.0, 32.95, 36.2, 33.7]),
    newsRegion: 'mideast',
    layerIds: Object.freeze([]),
    control: Object.freeze(['israel-palestine', 'lebanon']),
  }),
  Object.freeze({
    id: 'gaza',
    name: 'Gaza',
    center: Object.freeze({ lat: 31.42, lon: 34.38 }),
    rectDegrees: Object.freeze([34.15, 31.2, 34.6, 31.65]),
    newsRegion: 'mideast',
    layerIds: Object.freeze([]),
    control: Object.freeze(['israel-palestine']),
  }),
  Object.freeze({
    id: 'israel',
    name: 'Israel — alerts and impacts',
    center: Object.freeze({ lat: 31.8, lon: 35.0 }),
    rectDegrees: Object.freeze([34.2, 29.4, 35.95, 33.4]),
    newsRegion: 'mideast',
    layerIds: Object.freeze([]),
    // Plán kap. 2: kontrola „—" (Izrael sám nemá sporné sídla; Gaza a Západný
    // breh majú vlastné dejiská s modulom IP).
    control: Object.freeze([]),
  }),
  Object.freeze({
    id: 'west-bank',
    name: 'West Bank',
    center: Object.freeze({ lat: 31.95, lon: 35.25 }),
    rectDegrees: Object.freeze([34.85, 31.3, 35.6, 32.6]),
    newsRegion: 'mideast',
    layerIds: Object.freeze([]),
    control: Object.freeze(['israel-palestine']),
  }),
  Object.freeze({
    id: 'red-sea',
    name: 'Yemen and Bab al-Mandab',
    center: Object.freeze({ lat: 14.5, lon: 43.0 }),
    rectDegrees: Object.freeze([41, 11.5, 46, 17.5]),
    newsRegion: 'mideast',
    layerIds: Object.freeze([...MARITIME_LAYERS]),
    control: Object.freeze(['yemen']),
  }),
  Object.freeze({
    id: 'yemen',
    name: 'Yemen',
    center: Object.freeze({ lat: 15.5, lon: 47.5 }),
    rectDegrees: Object.freeze([42, 12, 54, 19]),
    newsRegion: 'mideast',
    layerIds: Object.freeze([]),
    control: Object.freeze(['yemen']),
  }),
  Object.freeze({
    id: 'south-syria',
    name: 'South Syria',
    center: Object.freeze({ lat: 33.0, lon: 36.0 }),
    rectDegrees: Object.freeze([35.6, 32.3, 36.9, 33.8]),
    newsRegion: 'mideast',
    layerIds: Object.freeze([]),
    control: Object.freeze(['syria']),
  }),
  Object.freeze({
    id: 'iraq',
    name: 'Iraq',
    center: Object.freeze({ lat: 33.3, lon: 44.4 }),
    rectDegrees: Object.freeze([38.8, 29, 48.6, 37.4]),
    newsRegion: 'mideast',
    layerIds: Object.freeze([]),
    control: Object.freeze([]),
  }),
]);

/**
 * Zlyhaj hlasno pri načítaní modulu, ak katalóg nedáva zmysel: platné a
 * jedinečné id, [W,S,E,N] so stredom vnútri, vrstvy registrované v správcovi,
 * región správ známy serveru (inak /api/situation-news vráti 400 a karty ticho
 * zmiznú), práve jeden prehľad a ten prvý.
 * @param {ReadonlyArray<MideastTheatre>} [theatres]
 * @returns {true}
 */
export function validateMideastTheatres(theatres = MIDEAST_THEATRES) {
  if (!Array.isArray(theatres) || theatres.length === 0) throw new Error('Theatre catalog empty');
  const registered = new Set(REGISTERED_LAYER_IDS);
  const ids = new Set();
  let overviews = 0;
  theatres.forEach((scene, index) => {
    if (!scene || typeof scene.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(scene.id)) throw new Error('Theatre bad id');
    if (ids.has(scene.id)) throw new Error(`Duplicate theatre id: ${scene.id}`);
    ids.add(scene.id);
    if (typeof scene.name !== 'string' || !scene.name.trim()) throw new Error(`Theatre without name: ${scene.id}`);
    const { lat, lon } = scene.center || {};
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`Theatre bad center: ${scene.id}`);
    const rect = scene.rectDegrees || [];
    if (rect.length !== 4 || !rect.every(Number.isFinite)) throw new Error(`Theatre bad rect: ${scene.id}`);
    const [west, south, east, north] = rect;
    if (!(west < east) || !(south < north)) throw new Error(`Theatre inverted rect: ${scene.id}`);
    if (lon < west || lon > east || lat < south || lat > north) throw new Error(`Theatre center outside rect: ${scene.id}`);
    if (!Array.isArray(scene.layerIds)) throw new Error(`Theatre layerIds missing: ${scene.id}`);
    for (const layerId of scene.layerIds) {
      if (!registered.has(layerId)) throw new Error(`Theatre ${scene.id} layer not registered: ${layerId}`);
    }
    if (typeof scene.newsRegion !== 'string' || !Object.hasOwn(SITUATION_REGIONS, scene.newsRegion)) {
      throw new Error(`Theatre ${scene.id} unknown news region: ${scene.newsRegion}`);
    }
    if (!Array.isArray(scene.control) || !scene.control.every((k) => typeof k === 'string' && k)) {
      throw new Error(`Theatre control not a list of keys: ${scene.id}`);
    }
    if (scene.overview) {
      overviews += 1;
      if (index !== 0) throw new Error(`Theatre overview must be first: ${scene.id}`);
    }
  });
  if (overviews !== 1) throw new Error(`Theatre catalog needs exactly one overview, got ${overviews}`);
  return true;
}

validateMideastTheatres();

/** Všetky dejiská v poradí z plánu (prehľad prvý). */
export function listMideastTheatres() {
  return MIDEAST_THEATRES;
}

/** Dejisko podľa id (bez ohľadu na veľkosť písmen a medzery), inak null. */
export function theatreById(id) {
  const key = String(id ?? '').trim().toLowerCase();
  if (!key) return null;
  return MIDEAST_THEATRES.find((scene) => scene.id === key) || null;
}

/** Preložené meno dejiska (`theatre.<id>.name`), inak stabilné EN meno. */
export function theatreLabel(scene, translate = t) {
  if (!scene) return '';
  const key = `theatre.${scene.id}.name`;
  const translated = translate(key);
  return translated === key ? scene.name : translated;
}

/** Preložený jednoriadkový podtitul (`theatre.<id>.subtitle`), inak ''. */
export function theatreSubtitle(scene, translate = t) {
  if (!scene) return '';
  const key = `theatre.${scene.id}.subtitle`;
  const translated = translate(key);
  return translated === key ? '' : translated;
}

/**
 * Prah brány priblíženia (`createSceneRevealGate` má rovnakú predvolenú hodnotu):
 * do tejto VZDIALENOSTI kamery od stredu dejiska sa karty a čipy ukazujú, ďalej
 * sa schovajú. Brána meria Cartesian3 vzdialenosť ku stredu, NIE výšku kamery —
 * preto rámovanie stráži výšku aj odstup na juh naraz.
 */
export const THEATRE_REVEAL_GATE_M = 1_500_000;

/**
 * Strop výšky kamery. Front má 1,4 M m, ale pri prehľade regiónu (rámec 33° × 29°)
 * kamera stojí ~3° južne od stredu rámca a stred dejiska (29° N, 45° E) je od
 * stredu rámca (25,5° N, 46,5° E) ďalších ~4°; s 1,4 M m by vzdialenosť ku stredu
 * bola ~1,7 M m a brána by pin, čipy aj karty schovala hneď po prílete. S 1,0 M m
 * a odstupom max. 3° vychádza prehľad na ~1,28 M m (rezerva 15 %); najtesnejšie
 * je dejisko Irán (rámec 19,5° × 14,8°, odstup 7° na juh) s ~1,31 M m (12,6 %) —
 * merané cez Cesium v mideastTheatres.test.mjs, 2026-09-26.
 * Cena: prehľad nezaberie celý rámec naraz — číta sa ako široký šikmý pohľad.
 */
export const THEATRE_HEIGHT_CAP_M = 1_000_000;

/** Najväčší odstup kamery na juh od stredu rámca pri prehľade (stupne šírky). */
export const OVERVIEW_BACKOFF_MAX_DEG = 3;

/**
 * Rámovanie kamery pre dejisko: šikmý pohľad na sever (heading 0) z juhu, ako
 * pri smeroch frontu (číta sa ako mapa, nie panoráma). Výška rastie s rozpätím
 * rámca po strop `THEATRE_HEIGHT_CAP_M`; prehľad je strmší a odstup na juh má
 * vlastný strop, aby kamera ostala pod prahom brány (pozri konštanty vyššie).
 * @param {ReadonlyArray<number>} rectDegrees [W, S, E, N]
 * @param {{overview?: boolean}} [o]
 * @returns {{lon: number, lat: number, heightM: number, pitchDeg: number, headingDeg: number}}
 */
export function theatreFraming(rectDegrees, { overview = false } = {}) {
  const [w, s, e, n] = rectDegrees;
  const lon = (w + e) / 2;
  const lat = (s + n) / 2;
  const spanDeg = Math.max(Math.abs(e - w), Math.abs(n - s));
  // Strmšie než úžiny (−32°): pohľad k horizontu núti Google 3D dlaždice
  // streamovať obrovskú plochu (Ukrajina 2026-09-19: vysoké CPU).
  const pitchDeg = overview ? -72 : -64;
  // ~1° rámca ≈ 110 km → 118 km výšky na 1° drží rámec v zábere pri −64°.
  const heightM = Math.min(THEATRE_HEIGHT_CAP_M, Math.max(70_000, spanDeg * 118_000));
  const backoffDeg = overview ? Math.min(spanDeg * 0.18, OVERVIEW_BACKOFF_MAX_DEG) : spanDeg * 0.36;
  return { lon, lat: lat - backoffDeg, heightM, pitchDeg, headingDeg: 0 };
}

/**
 * Použi dejisko. Poradie vedľajších účinkov je zmluva:
 *  1. vypnúť všetky ZAPNUTÉ vrstvy správcu viditeľné v paneli (rovnaký filter ako
 *     smery frontu — po Hormuze inak ostanú lode a potrubia nad ďalším dejiskom),
 *     okrem tých, ktoré dejisko o chvíľu zapne (žiadne blikanie ani zbytočný zápis
 *     do stavu),
 *  2. zapnúť `layerIds` dejiska (naraz, zlyhané id sa vrátia),
 *  3. voliteľne ukázať nesprávcovské prekryvy modulu (`showOverlays`, etapy 2+),
 *  4. rámovať POSLEDNÉ a ako najlepšiu snahu — anotácie a zapínanie vrstiev
 *     vedia pohnúť kamerou, let musí vyhrať; zlyhaný let dejisko nezhodí.
 * Všetky vedľajšie účinky sú vložené; main.js drží Cesium aj správcu vrstiev.
 * @param {string} id
 * @param {{
 *   listLayers?: () => ReadonlyArray<{id: string, enabled?: boolean, showInTogglePanel?: boolean}>,
 *   disableLayer?: (layerId: string) => Promise<boolean|void>|boolean|void,
 *   setLayerEnabled?: (layerId: string) => Promise<boolean|void>|boolean|void,
 *   showOverlays?: (scene: MideastTheatre) => Promise<any>|any,
 *   flyToRegion?: (scene: MideastTheatre) => Promise<any>|any,
 * }} deps
 * @returns {Promise<{ok: boolean, id: string, scene?: MideastTheatre, disabledLayerIds: string[], failedLayerIds: string[], overlaysShown: boolean, error?: string}>}
 */
export async function applyMideastTheatre(id, { listLayers, disableLayer, setLayerEnabled, showOverlays, flyToRegion } = {}) {
  const scene = theatreById(id);
  if (!scene) {
    return { ok: false, id: String(id ?? ''), disabledLayerIds: [], failedLayerIds: [], overlaysShown: false, error: 'unknown-theatre' };
  }

  // 1. upratať mapu
  const disabledLayerIds = [];
  if (typeof listLayers === 'function' && typeof disableLayer === 'function') {
    const keep = new Set(scene.layerIds);
    let ids = [];
    try { ids = frontSceneLayersToDisable(listLayers()).filter((layerId) => !keep.has(layerId)); } catch { ids = []; }
    for (const layerId of ids) {
      try { if ((await disableLayer(layerId)) !== false) disabledLayerIds.push(layerId); } catch { /* ďalšia vrstva */ }
    }
  }

  // 2. zapnúť vrstvy dejiska
  let failedLayerIds = [];
  if (scene.layerIds.length > 0) {
    if (typeof setLayerEnabled !== 'function') {
      failedLayerIds = [...scene.layerIds];
    } else {
      const outcomes = await Promise.all(scene.layerIds.map(async (layerId) => {
        try {
          return { layerId, ok: (await setLayerEnabled(layerId)) !== false };
        } catch {
          return { layerId, ok: false };
        }
      }));
      failedLayerIds = outcomes.filter((entry) => !entry.ok).map((entry) => entry.layerId);
    }
  }

  // 3. prekryvy modulu (nesprávcovské vrstvy neskorších etáp)
  let overlaysShown = false;
  if (typeof showOverlays === 'function') {
    try { overlaysShown = (await showOverlays(scene)) !== false; } catch { overlaysShown = false; }
  }

  // 4. rámovanie POSLEDNÉ
  if (typeof flyToRegion === 'function') {
    try { await flyToRegion(scene); } catch { /* rámovanie je najlepšia snaha */ }
  }

  return { ok: failedLayerIds.length === 0, id: scene.id, scene, disabledLayerIds, failedLayerIds, overlaysShown };
}

/**
 * Zloženie textu na porovnanie LATINKOU: diakritika preč, apostrofy preč,
 * ostatné oddeľovače na medzeru. (Kópia súkromného pomocníka z
 * ukraineFrontScenes.js — tam sa neexportuje; arabčinu/perzštinu/hebrejčinu
 * zámerne neskladá, mená dejísk sú latinkou.) Pure.
 * @param {unknown} value
 * @returns {string}
 */
function foldLatin(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’ʼ'`]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Dejisko podľa toho, ako ho človek povie: id (`gaza`), anglické meno
 * (`South Lebanon`) alebo preložené meno (`Južný Libanon`). Skladá diakritiku,
 * takže „juzny libanon" sedí tiež.
 *
 * Hľadá od najpresnejšieho k najvoľnejšiemu a **pri nejednoznačnej zhode vráti
 * `null`** — pri hlase je lepšie spýtať sa než odletieť na iné dejisko
 * („Jemen" sedí presne na `yemen`, nie čiastočne na `red-sea`). Pure.
 *
 * @param {unknown} query
 * @param {(key: string) => string} [translate]
 * @returns {MideastTheatre|null}
 */
export function resolveTheatre(query, translate = t) {
  const raw = String(query ?? '').trim();
  if (!raw) return null;
  const exactId = theatreById(raw);
  if (exactId) return exactId;

  const key = foldLatin(raw);
  if (!key) return null;
  const candidates = MIDEAST_THEATRES.map((scene) => ({
    scene,
    names: [scene.id, scene.name, theatreLabel(scene, translate)].map(foldLatin).filter(Boolean),
  }));

  const exact = candidates.filter((c) => c.names.includes(key));
  if (exact.length === 1) return exact[0].scene;
  if (exact.length > 1) return null;

  const prefix = candidates.filter((c) => c.names.some((n) => n.startsWith(key)));
  if (prefix.length === 1) return prefix[0].scene;
  if (prefix.length > 1) return null;

  const partial = candidates.filter((c) => c.names.some((n) => n.includes(key)));
  return partial.length === 1 ? partial[0].scene : null;
}

/**
 * Zoznam dejísk pre hlas, paletu a rozbaľovačku: id + čitateľné meno. Pure.
 * @param {(key: string) => string} [translate]
 * @returns {Array<{id: string, label: string}>}
 */
export function theatreChoices(translate = t) {
  return MIDEAST_THEATRES.map((scene) => ({ id: scene.id, label: theatreLabel(scene, translate) }));
}
