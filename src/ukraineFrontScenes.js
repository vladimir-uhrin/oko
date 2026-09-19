// src/ukraineFrontScenes.js — presety „smerov" frontu na Ukrajine (modul
// UKRAJINA, etapa 1, 2026-09-19; plán docs/drafts/ukrajina-plan.md).
//
// Smer = rámec pohľadu ako na situačných mapách („Lymanský smer"): kamera sa
// postaví nad úsek frontu, zapne sa podklad (sídla, cesty, rieky, oblasti)
// a panel UKRAJINA vyznačí aktívny smer. Nič viac — kontrola územia, udalosti
// a hlásenia prídu v etapách 2–4 a budú sa na tieto presety viazať cez `gs`
// (mená smerov z denných hlásení Generálneho štábu ZSU, 19. 9. 2026: 13 smerov).
//
// Rovnaký tvar a filozofia ako chokepointScenes.js: modul je ČISTÝ (bez Cesia,
// bez DOM), nepoužíva cinematic director, rámovanie sa vydáva POSLEDNÉ.
// Kotvy sú SÍDLA (nie jednotky — čl. 114-2 TZ Ukrajiny a etická čiara OKO).
// Súradnice sú rámce pohľadu, nie línia frontu; `approx: true` značí kotvu,
// ktorú treba ešte overiť proti hláseniam (Oleksandrivský smer).

import { t } from './i18n.js';

/**
 * @typedef {object} FrontScene
 * @property {string} id
 * @property {string} name stabilné EN meno (fallback bez prekladu)
 * @property {{lat: number, lon: number}} center
 * @property {ReadonlyArray<number>} rectDegrees [W, S, E, N]
 * @property {ReadonlyArray<string>} gs mená smerov v hláseniach GŠ ZSU (ukrajinsky)
 * @property {boolean} [approx] kotva ešte neoverená
 * @property {boolean} [overview] prehľad celého frontu
 */

/** @type {ReadonlyArray<FrontScene>} */
export const FRONT_SCENES = Object.freeze([
  Object.freeze({
    id: 'front',
    name: 'Whole front',
    center: Object.freeze({ lat: 48.4, lon: 36.6 }),
    rectDegrees: Object.freeze([32.0, 45.6, 40.4, 51.6]),
    gs: Object.freeze([]),
    overview: true,
  }),
  Object.freeze({
    id: 'sumy',
    name: 'Sumy direction',
    center: Object.freeze({ lat: 51.0, lon: 34.85 }),
    rectDegrees: Object.freeze([33.9, 50.55, 35.8, 51.5]),
    gs: Object.freeze(['Північно-Слобожанський', 'Курський']),
  }),
  Object.freeze({
    id: 'vovchansk',
    name: 'Vovchansk – north of Kharkiv',
    center: Object.freeze({ lat: 50.2, lon: 36.9 }),
    rectDegrees: Object.freeze([36.1, 49.85, 37.75, 50.55]),
    gs: Object.freeze(['Південно-Слобожанський']),
  }),
  Object.freeze({
    id: 'kupiansk',
    name: 'Kupiansk direction',
    center: Object.freeze({ lat: 49.7, lon: 37.65 }),
    rectDegrees: Object.freeze([36.9, 49.3, 38.35, 50.1]),
    gs: Object.freeze(['Куп\'янський']),
  }),
  Object.freeze({
    id: 'lyman',
    name: 'Lyman direction',
    center: Object.freeze({ lat: 49.0, lon: 37.85 }),
    rectDegrees: Object.freeze([37.15, 48.62, 38.5, 49.4]),
    gs: Object.freeze(['Лиманський']),
  }),
  Object.freeze({
    id: 'sloviansk-kramatorsk',
    name: 'Sloviansk – Kramatorsk',
    center: Object.freeze({ lat: 48.78, lon: 37.7 }),
    rectDegrees: Object.freeze([37.05, 48.4, 38.35, 49.1]),
    gs: Object.freeze(['Слов\'янський', 'Краматорський']),
  }),
  Object.freeze({
    id: 'kostiantynivka',
    name: 'Kostiantynivka direction',
    center: Object.freeze({ lat: 48.5, lon: 37.8 }),
    rectDegrees: Object.freeze([37.2, 48.2, 38.35, 48.9]),
    gs: Object.freeze(['Костянтинівський']),
  }),
  Object.freeze({
    id: 'pokrovsk',
    name: 'Pokrovsk direction',
    center: Object.freeze({ lat: 48.3, lon: 37.2 }),
    rectDegrees: Object.freeze([36.55, 47.9, 37.9, 48.65]),
    gs: Object.freeze(['Покровський']),
  }),
  Object.freeze({
    id: 'oleksandrivka',
    name: 'Oleksandrivka direction',
    center: Object.freeze({ lat: 48.0, lon: 36.6 }),
    rectDegrees: Object.freeze([35.9, 47.6, 37.25, 48.4]),
    gs: Object.freeze(['Олександрівський']),
    approx: true,
  }),
  Object.freeze({
    id: 'huliaipole',
    name: 'Huliaipole direction',
    center: Object.freeze({ lat: 47.66, lon: 36.3 }),
    rectDegrees: Object.freeze([35.6, 47.3, 36.95, 48.0]),
    gs: Object.freeze(['Гуляйпільський']),
  }),
  Object.freeze({
    id: 'orikhiv',
    name: 'Orikhiv – Zaporizhzhia',
    center: Object.freeze({ lat: 47.6, lon: 35.6 }),
    rectDegrees: Object.freeze([34.85, 47.2, 36.3, 47.95]),
    gs: Object.freeze(['Оріхівський']),
  }),
  Object.freeze({
    id: 'kherson',
    name: 'Dnipro left bank – Kherson',
    center: Object.freeze({ lat: 46.65, lon: 32.8 }),
    rectDegrees: Object.freeze([31.9, 46.2, 33.75, 47.1]),
    gs: Object.freeze(['Придніпровський']),
  }),
]);

/**
 * Zlyhaj hlasno pri načítaní modulu, ak katalóg nedáva zmysel: jedinečné id,
 * platné [W,S,E,N] so stredom vnútri, aspoň jedno GŠ meno mimo prehľadu.
 * @param {ReadonlyArray<FrontScene>} [scenes]
 * @returns {true}
 */
export function validateFrontScenes(scenes = FRONT_SCENES) {
  const ids = new Set();
  const gsNames = new Set();
  for (const scene of scenes) {
    if (!scene || typeof scene.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(scene.id)) throw new Error('Front scene bad id');
    if (ids.has(scene.id)) throw new Error(`Duplicate front scene id: ${scene.id}`);
    ids.add(scene.id);
    const { lat, lon } = scene.center || {};
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`Front scene bad center: ${scene.id}`);
    const rect = scene.rectDegrees || [];
    if (rect.length !== 4 || !rect.every(Number.isFinite)) throw new Error(`Front scene bad rect: ${scene.id}`);
    const [west, south, east, north] = rect;
    if (!(west < east) || !(south < north)) throw new Error(`Front scene inverted rect: ${scene.id}`);
    if (lon < west || lon > east || lat < south || lat > north) throw new Error(`Front scene center outside rect: ${scene.id}`);
    if (!Array.isArray(scene.gs)) throw new Error(`Front scene gs missing: ${scene.id}`);
    if (!scene.overview && scene.gs.length === 0) throw new Error(`Front scene without GS direction: ${scene.id}`);
    for (const name of scene.gs) {
      if (gsNames.has(name)) throw new Error(`GS direction mapped twice: ${name}`);
      gsNames.add(name);
    }
  }
  return true;
}

validateFrontScenes();

/** Všetky presety v poradí sever → juh (prehľad prvý). */
export function listFrontScenes() {
  return FRONT_SCENES;
}

/** Preset podľa id (bez ohľadu na veľkosť písmen a medzery), inak null. */
export function frontSceneById(id) {
  const key = String(id ?? '').trim().toLowerCase();
  if (!key) return null;
  return FRONT_SCENES.find((scene) => scene.id === key) || null;
}

/** Preset podľa mena smeru z hlásenia GŠ (ukrajinsky, s apostrofom ’ aj '), inak null. */
export function frontSceneByGsDirection(name) {
  const norm = (s) => String(s ?? '').replace(/[’ʼ`]/g, '\'').replace(/\s+/g, ' ').trim().toLowerCase();
  const key = norm(name);
  if (!key) return null;
  return FRONT_SCENES.find((scene) => scene.gs.some((gs) => norm(gs) === key)) || null;
}

/** Preložené meno smeru (`front.<id>.name`), inak stabilné EN meno. */
export function frontSceneLabel(scene, translate = t) {
  if (!scene) return '';
  const key = `front.${scene.id}.name`;
  const translated = translate(key);
  return translated === key ? scene.name : translated;
}

/**
 * Rámovanie kamery pre smer: šikmý pohľad na sever (heading 0) z juhu, strmší
 * než pri úžinách (front sa číta ako mapa, nie ako panoráma). Výška rastie
 * s rozpätím rámca; prehľad celého frontu je vysoko a ešte strmšie.
 * @param {ReadonlyArray<number>} rectDegrees [W, S, E, N]
 * @param {{overview?: boolean}} [o]
 * @returns {{lon: number, lat: number, heightM: number, pitchDeg: number, headingDeg: number}}
 */
export function frontSceneFraming(rectDegrees, { overview = false } = {}) {
  const [w, s, e, n] = rectDegrees;
  const lon = (w + e) / 2;
  const lat = (s + n) / 2;
  const spanDeg = Math.max(Math.abs(e - w), Math.abs(n - s));
  // Strmšie než úžiny (−32°): pohľad k horizontu núti Google 3D dlaždice
  // streamovať obrovskú plochu (používateľ 2026-09-19: vysoké CPU) a front sa
  // číta ako mapa, nie panoráma.
  const pitchDeg = overview ? -72 : -64;
  // ~1° rámca ≈ 110 km → 130 km výšky pri −58° drží celý rámec v zábere.
  const heightM = Math.min(1_400_000, Math.max(70_000, spanDeg * 118_000));
  const backoffDeg = overview ? spanDeg * 0.18 : spanDeg * 0.36;
  return { lon, lat: lat - backoffDeg, heightM, pitchDeg, headingDeg: 0 };
}

/**
 * Použi preset: zapni podklad (kľúčové), potom zarámuj (posledné, najlepšia
 * snaha — zlyhaný let scénu nezhodí). Všetky vedľajšie účinky sú vložené.
 * @param {string} id
 * @param {{showBase?: () => Promise<any>|any, flyToRegion?: (scene: FrontScene) => any}} deps
 * @returns {Promise<{ok: boolean, id: string, scene?: FrontScene, baseShown: boolean, error?: string}>}
 */
export async function applyFrontScene(id, { showBase, flyToRegion } = {}) {
  const scene = frontSceneById(id);
  if (!scene) return { ok: false, id: String(id ?? ''), baseShown: false, error: 'unknown-front' };
  let baseShown = false;
  if (typeof showBase === 'function') {
    try { baseShown = (await showBase()) !== false; } catch { baseShown = false; }
  }
  if (typeof flyToRegion === 'function') {
    try { await flyToRegion(scene); } catch { /* rámovanie je najlepšia snaha */ }
  }
  return { ok: true, id: scene.id, scene, baseShown };
}
