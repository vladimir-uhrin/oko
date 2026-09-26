// src/data/ukraineBase.js
/**
 * @module ukraineBase
 * @description Čisté pomocné funkcie podkladu modulu UKRAJINA (etapa 1 plánu
 * docs/drafts/ukrajina-plan.md, 2026-09-19): sídla, cesty, rieky a hranice
 * oblastí zo statického OSM snímku (`scripts/build-ukraine-base.mjs`,
 * `/api/ukraine/base/<dataset>`). Žiadny Cesium ani DOM — mená, stupne
 * viditeľnosti, štýly, riedenie popisov a výber kohorty obcí sa testujú v Node.
 *
 * Prečo vlastný prekryv a nie vrstva správcu: tokeny odkazu `lo=` sú plné
 * (36/36, layerState.js) a správca pri finalizácii odmietne vrstvu bez tokenu.
 * Rovnaké rozhodnutie ako hranice štátov (countryBoundaries.js).
 *
 * Mená (používateľ pri rúrach: „niektoré názvy sú v azbuke"): popisok je
 * `name:en`, keď ho OSM má, inak prepis BGN/PCGN cez latinize.js podľa jazyka
 * snímku (`lang` = uk/ru/be); originál ostáva v karte pri prechode myšou.
 */
import { latinizeForDisplay } from './latinize.js';

export const UKRAINE_BASE_API = '/api/ukraine/base';
/** Súbory snímku (villages sa ťahá lenivo, len zblízka). */
export const UKRAINE_BASE_DATASETS = Object.freeze(['places', 'villages', 'roads', 'rivers', 'oblasts']);
/** Časti prepínané čipmi v paneli (obce patria k sídlam). */
export const UKRAINE_BASE_PARTS = Object.freeze(['places', 'roads', 'rivers', 'oblasts']);
export const PLACE_CLASSES = Object.freeze(['city', 'town', 'village']);
export const ROAD_CLASSES = Object.freeze(['motorway', 'trunk', 'primary', 'secondary']);

/** Dôležitosť sídla na riedenie popisov (rovnaká škála ako letiská/prístavy: 300/150/60). */
export const PLACE_IMPORTANCE = Object.freeze({ city: 300, town: 150, village: 60 });
/**
 * Po akú vzdialenosť kamery (m) sa kreslí popisok / bod sídla. Obce (2026-09-26,
 * vlastník: „mestá bodky sú veľmi rušivé"): bod aj popisok až do 130 km — pri
 * pohľade na smer (výška ~160 km, vzdialenosť ~180 km) kreslilo 1 800 bodiek bez
 * popisu, ktoré nič nehovorili; body obcí navyše dobiehajú priesvitnosťou
 * (VILLAGE_POINT_FADE_FROM × far → far), aby sa pri približovaní nevynorili naraz.
 */
export const PLACE_LABEL_FAR_M = Object.freeze({ city: 2_500_000, town: 700_000, village: 130_000 });
export const PLACE_POINT_FAR_M = Object.freeze({ city: 4_000_000, town: 1_200_000, village: 130_000 });
export const VILLAGE_POINT_FADE_FROM = 0.65;
/** Obce sa načítajú a kreslia až pod touto výškou kamery (m); 27 000 bodov naraz by dusilo scénu. */
export const VILLAGE_LOAD_MAX_HEIGHT_M = 260_000;
/** Strop kohorty obcí v scéne (najbližšie k stredu pohľadu). */
export const VILLAGE_COHORT_MAX = 1_800;
/** Okraj okolo pohľadového obdĺžnika (°), aby pri posune nechýbal lem. */
export const VILLAGE_COHORT_MARGIN_DEG = 0.3;
/** Riedenie popisov: jeden popisok na bunku mriežky (px) — popisky sú širšie než vyššie. */
export const LABEL_GRID = Object.freeze({ widthPx: 118, heightPx: 26 });
/** Pauza po pohybe kamery pred prepočtom kohorty a riedenia (ms). */
export const CAMERA_SETTLE_MS = 250;
/** Okno snímku [W, S, E, N] — mimo neho sa kohorta ani nepočíta. */
export const UKRAINE_WINDOW = Object.freeze([22, 44, 41, 53]);
/** Výška kamery (m) po kliku na sídlo — mesto z výšky, obec zblízka. */
export const PLACE_FLY_HEIGHT_M = Object.freeze({ city: 45_000, town: 22_000, village: 9_000 });
export const PLACE_FLY_PITCH_DEG = -48;

/** Štýl sídla podľa triedy (mono OKO, uppercase mestá). */
export const PLACE_STYLE = Object.freeze({
  city: Object.freeze({ fontPx: 13, weight: 600, pointPx: 6.5, color: '#f1f5f8', uppercase: true }),
  town: Object.freeze({ fontPx: 11.5, weight: 500, pointPx: 5, color: '#dfe6ec', uppercase: false }),
  village: Object.freeze({ fontPx: 10.5, weight: 400, pointPx: 3.5, color: '#c3ccd4', uppercase: false }),
});

/** Cesty: svetlé, papierové tóny na tmavej ortofotomape; pod 4 px sharpen prepáli na bielu (merané pri rúrach) — počítame s tým. */
export const ROAD_STYLE = Object.freeze({
  motorway: Object.freeze({ width: 3.2, color: '#efe9dd', alpha: 0.9, farM: 2_200_000 }),
  trunk: Object.freeze({ width: 3.0, color: '#e6dfd2', alpha: 0.85, farM: 1_700_000 }),
  primary: Object.freeze({ width: 2.4, color: '#d2cbbf', alpha: 0.8, farM: 850_000 }),
  secondary: Object.freeze({ width: 1.8, color: '#aaa49b', alpha: 0.7, farM: 320_000 }),
});
/** Rieky: oceľová modrá; veľké rieky (≥ 200 km v okne) vidno aj z ďaleka. */
export const RIVER_STYLE = Object.freeze({ width: 2.6, color: '#6fb7e8', alpha: 0.85, farM: 1_100_000, smallFarM: 380_000, bigKm: 200 });
/** Hranice oblastí: čiarkované, svetlé — nepliesť s červenými hranicami štátov (countryBoundaries). */
export const OBLAST_STYLE = Object.freeze({ width: 1.6, color: '#d9dee3', alpha: 0.55, dashLength: 14, farM: 3_200_000, labelNearM: 260_000, labelFarM: 3_200_000 });

/**
 * Popisok sídla: `name:en`, inak prepis podľa jazyka snímku. Na území UA sa
 * mená bez `lang` prepisujú po ukrajinsky (Ужгород → Uzhhorod), ruské len tam,
 * kde snímok hovorí `lang: 'ru'` a nemá ukrajinský variant.
 * @param {object} props vlastnosti prvku snímku
 * @returns {{text: string, original: string|null}}
 */
export function placeLabel(props) {
  const p = props || {};
  const name = String(p.name || '').trim();
  if (p.en && String(p.en).trim()) return { text: String(p.en).trim(), original: name || null };
  const ukrainian = p.lang !== 'ru' || Boolean(p.uk);
  const base = (p.lang === 'ru' && p.uk) ? String(p.uk).trim() : name;
  const out = latinizeForDisplay(base, { lang: ukrainian ? 'uk' : 'ru' });
  if (!out.text) return { text: '', original: null };
  // Originál = vždy `name` zo snímku, keď sa líši od zobrazeného.
  return { text: out.text, original: name && name !== out.text ? name : out.original };
}

/** Text popisku na mape (mestá verzálkami). */
export function placeMapText(props) {
  const { text } = placeLabel(props);
  return PLACE_STYLE[props?.cls]?.uppercase ? text.toUpperCase() : text;
}

/** Popisok rieky / oblasti (`en`, inak prepis). */
export function lineLabel(props) {
  const p = props || {};
  if (p.en && String(p.en).trim()) return { text: String(p.en).trim(), original: String(p.name || '').trim() || null };
  return latinizeForDisplay(p.name, { lang: p.lang === 'ru' ? 'ru' : 'uk' });
}

/** Dôležitosť sídla: trieda + ľudnatosť (väčšie sídlo vyhráva v riedení). */
export function placeImportance(props) {
  const base = PLACE_IMPORTANCE[props?.cls] ?? 0;
  const pop = Number(props?.pop);
  return base + (Number.isFinite(pop) && pop > 0 ? Math.min(99, Math.log10(pop) * 12) : 0);
}

/** [near, far] pre popisok sídla (m). */
export function placeLabelDisplayCondition(cls) {
  return [0, PLACE_LABEL_FAR_M[cls] ?? PLACE_LABEL_FAR_M.village];
}

/** [near, far] pre bod sídla (m). */
export function placePointDisplayCondition(cls) {
  return [0, PLACE_POINT_FAR_M[cls] ?? PLACE_POINT_FAR_M.village];
}

/** Štýl čiary cesty; neznáma trieda = secondary. */
export function roadStyle(cls) {
  return ROAD_STYLE[cls] || ROAD_STYLE.secondary;
}

/** [near, far] pre rieku podľa dĺžky v okne. */
export function riverDisplayCondition(km) {
  return [0, Number(km) >= RIVER_STYLE.bigKm ? RIVER_STYLE.farM : RIVER_STYLE.smallFarM];
}

/** Sú obce v tejto výške kamery vôbec na programe? */
export function villagesWanted(cameraHeightM) {
  return Number.isFinite(cameraHeightM) && cameraHeightM < VILLAGE_LOAD_MAX_HEIGHT_M;
}

/** Leží bod v okne snímku [W, S, E, N]? */
export function inWindow(lon, lat, window = UKRAINE_WINDOW) {
  return Number.isFinite(lon) && Number.isFinite(lat) && lon >= window[0] && lon <= window[2] && lat >= window[1] && lat <= window[3];
}

/**
 * Pohľad kamery po kliku na sídlo: šikmo z juhu, výška podľa triedy. Odstup
 * na juh ≈ výška × tan(90° − |pitch|) prevedená na stupne, aby sídlo sedelo
 * v strede obrazu, nie pod kamerou.
 * @param {number} lon
 * @param {number} lat
 * @param {string} cls
 * @returns {{lon: number, lat: number, heightM: number, pitchDeg: number, headingDeg: number}}
 */
export function placeFlyView(lon, lat, cls) {
  const heightM = PLACE_FLY_HEIGHT_M[cls] ?? PLACE_FLY_HEIGHT_M.village;
  const backoffM = heightM * Math.tan(((90 + PLACE_FLY_PITCH_DEG) * Math.PI) / 180);
  return { lon, lat: lat - backoffM / 111_000, heightM, pitchDeg: PLACE_FLY_PITCH_DEG, headingDeg: 0 };
}

/**
 * Kohorta obcí pre pohľad: body v obdĺžniku pohľadu (+ okraj), najbližšie
 * k stredu, najviac `max`. Vzdialenosť v rovine so zohľadnením zemepisnej
 * šírky (stačí na zoradenie).
 * @param {Array<object>} features GeoJSON body (villages.json)
 * @param {number[]} rect [W, S, E, N] v stupňoch
 * @param {{lon: number, lat: number}} center stred pohľadu
 * @returns {Array<object>}
 */
export function selectVillageCohort(features, rect, center, { max = VILLAGE_COHORT_MAX, marginDeg = VILLAGE_COHORT_MARGIN_DEG } = {}) {
  if (!Array.isArray(features) || !Array.isArray(rect) || rect.length !== 4) return [];
  const [W, S, E, N] = rect;
  const west = W - marginDeg;
  const south = S - marginDeg;
  const east = E + marginDeg;
  const north = N + marginDeg;
  const cosLat = Math.cos(((Number(center?.lat) || (S + N) / 2) * Math.PI) / 180) || 1;
  const cx = Number(center?.lon) || (W + E) / 2;
  const cy = Number(center?.lat) || (S + N) / 2;
  const inside = [];
  for (const f of features) {
    const c = f?.geometry?.coordinates;
    if (!c || c[0] < west || c[0] > east || c[1] < south || c[1] > north) continue;
    const dx = (c[0] - cx) * cosLat;
    const dy = c[1] - cy;
    inside.push({ f, d: dx * dx + dy * dy });
  }
  if (inside.length > max) inside.sort((a, b) => a.d - b.d);
  return inside.slice(0, max).map((entry) => entry.f);
}

/**
 * Riedenie popisov: zoradiť podľa dôležitosti, jeden popisok na bunku mriežky.
 * Vstup sú už PREMIETNUTÉ body (x, y v px); mimo obrazovky sa nepočítajú.
 * @param {Array<{id: string, importance: number, x: number, y: number}>} items
 * @param {{width: number, height: number, cellW?: number, cellH?: number}} o
 * @returns {Set<string>} id viditeľných popiskov
 */
export function declutterLabels(items, { width, height, cellW = LABEL_GRID.widthPx, cellH = LABEL_GRID.heightPx }) {
  const visible = new Set();
  if (!Array.isArray(items) || !items.length) return visible;
  const sorted = [...items].filter((it) => Number.isFinite(it.x) && Number.isFinite(it.y)).sort((a, b) => b.importance - a.importance);
  const taken = new Set();
  for (const it of sorted) {
    if (it.x < 0 || it.y < 0 || it.x > width || it.y > height) continue;
    // Popisok je vpravo od bodu: bunka sa počíta od bodu + polovica šírky, aby
    // susedia vľavo/vpravo nezdieľali bunku len preto, že bod sedí na jej okraji.
    const col = Math.floor((it.x + cellW / 2) / cellW);
    const row = Math.floor(it.y / cellH);
    const key = `${col},${row}`;
    if (taken.has(key)) continue;
    taken.add(key);
    visible.add(it.id);
  }
  return visible;
}

/**
 * Stav snímku pre panel: dátum + čo je načítané, ľudsky (pure).
 * @param {object|null} meta meta.json
 * @param {{lang?: string}} [o]
 * @returns {{dateText: string|null, snapshotIso: string|null}}
 */
export function snapshotDateText(meta, { lang = 'sk' } = {}) {
  const iso = meta?.snapshot ? String(meta.snapshot) : null;
  if (!iso) return { dateText: null, snapshotIso: null };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { dateText: null, snapshotIso: iso };
  const text = new Intl.DateTimeFormat(lang === 'sk' ? 'sk-SK' : 'en-GB', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(date);
  return { dateText: text.replace(/\s+/g, ' ').trim(), snapshotIso: iso };
}
