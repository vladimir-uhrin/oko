// scripts/lib/ukraineBase.mjs
//
// Podklad modulu UKRAJINA (etapa 1 plánu docs/drafts/ukrajina-plan.md,
// 2026-09-19): sídla, cesty, rieky a hranice oblastí z OpenStreetMap cez
// Overpass, ako statický snímok s dátumom. Knižnica je ČISTÁ (import nič
// nespustí) a testuje sa v Node; sťahovanie a zápis robí
// scripts/build-ukraine-base.mjs.
//
// Prečo OSM a nie Geofabrik PBF: PBF by potreboval parser (závislosť), Overpass
// dá presne tie tagy, čo treba, a rovnaký postup už má snímok potrubí.
// Prečo dlaždice + zlúčenie podľa id uzlov: Overpass s globálnym bbox môže
// vrátiť geometriu cesty orezanú na dlaždicu (uzly mimo = null). Zlúčenie
// cez `nodes` (id) + `geometry` z každej dlaždice, kde sa cesta objaví, dá
// celú cestu bez švov a bez dvojitého kreslenia — nech už server oreže či nie.
//
// Licencia dát: ODbL 1.0, © OpenStreetMap contributors. Snímok je VLASTNÝ
// súbor (Collective Database podľa §4.5(a)), nikdy sa nemieša s CC BY dátami.
import { lengthKm, simplify } from './pipelineSnapshot.mjs';

/** Okno snímku [S, W, N, E]: Ukrajina + pohraničie (Kursk/Belgorod na východe). */
export const UKRAINE_BBOX = Object.freeze([44, 22, 53, 41]);
/** Poludníkové pásy — každý Overpass dopyt ostane v rozumnej veľkosti. */
export const UKRAINE_TILES = Object.freeze([
  Object.freeze([44, 22, 53, 27]),
  Object.freeze([44, 27, 53, 32]),
  Object.freeze([44, 32, 53, 36.5]),
  Object.freeze([44, 36.5, 53, 41]),
]);
/**
 * Ruské pohraničie (Kurská a Belgorodská oblasť), kde bežia smery Kurský,
 * Severo- a Juhoslobožanský. Mimo územia UA, preto zvlášť: hlavný výber je
 * cez area Ukrajiny, aby sme neťahali Rumunsko, Poľsko a Bielorusko.
 */
export const RU_BORDER_STRIP = Object.freeze([50.2, 33.8, 52.6, 41]);
export const PLACE_CLASSES = Object.freeze(['city', 'town', 'village']);
export const ROAD_CLASSES = Object.freeze(['motorway', 'trunk', 'primary', 'secondary']);
/** Rieky kratšie (súčet úsekov v okne) sa do snímku nedostanú — jarky nie sú prekážka frontu. */
export const RIVER_MIN_KM = 30;
export const ROUND_POINT_DIGITS = 5;
export const ROUND_LINE_DIGITS = 4;
export const SIMPLIFY_EPS_DEG = Object.freeze({ roads: 0.0006, rivers: 0.0006, oblasts: 0.001 });

/**
 * Obrys Ukrajiny pre Overpass filter `poly:` — Natural Earth 1:50m admin-0
 * (public domain, .gev-cache/natural-earth), Douglas–Peucker 0,06°, každý vrchol
 * posunutý 0,2° od ťažiska von, aby sa hraničné sídla a cesty neodrezali.
 * [lat, lon] páry (poradie Overpassu). PREČO nie `area["ISO3166-1"="UA"]`:
 * mirror overpass.kumi.systems nemá vygenerované areas a na `(area.ua)` vrátil
 * prázdnu odpoveď (2026-09-19, rieky západnej dlaždice: 0 prvkov za 82 s) —
 * polygón funguje na každom mirrore rovnako.
 * POZOR: Natural Earth kreslí Krym de facto pod Ruskom, obrys končí na 45,23° s. š.;
 * Krym pokrýva samostatný rámec CRIMEA_BBOX.
 */
export const UKRAINE_OUTLINE = Object.freeze([
  [47.051, 38.41], [47.029, 37.738], [46.652, 36.985], [46.699, 36.748], [46.547, 36.011], [45.996, 35.182], [46.181, 35.454], [46.346, 35.407],
  [46.079, 35.016], [45.606, 35.104], [45.856, 34.846], [45.838, 34.604], [46.071, 33.952], [46.078, 33.801], [45.949, 33.73], [45.904, 33.558],
  [46.018, 33.326], [45.902, 32.559], [46.086, 31.871], [46.128, 31.816], [46.239, 32.066], [46.355, 31.573], [46.295, 32.448], [46.447, 32.685],
  [46.386, 32.444], [46.454, 32.112], [47.021, 31.815], [46.737, 31.977], [46.456, 31.924], [46.465, 31.549], [46.578, 31.584], [46.429, 31.405],
  [46.36, 30.739], [46.076, 30.595], [45.684, 30.138], [45.553, 29.522], [45.082, 29.614], [45.251, 29.296], [45.155, 28.655], [45.078, 28.636],
  [45.312, 28.068], [45.374, 28.36], [45.526, 28.349], [45.908, 28.807], [46.33, 28.805], [46.39, 29.038], [46.24, 29.061], [46.327, 29.162],
  [46.294, 29.58], [46.188, 29.721], [46.252, 30.028], [46.378, 29.805], [46.68, 29.744], [46.835, 29.42], [47.16, 29.373], [47.408, 28.952],
  [47.712, 29.021], [47.918, 28.931], [47.908, 28.728], [48.091, 28.576], [48.063, 28.265], [48.222, 28.092], [48.477, 27.349], [48.365, 27.029],
  [48.382, 26.647], [48.192, 26.106], [47.973, 25.964], [47.891, 25.265], [47.694, 24.695], [47.931, 24.285], [47.89, 23.978], [48.077, 22.94],
  [47.934, 22.677], [48.101, 22.569], [48.403, 21.932], [48.57, 21.943], [49.086, 22.339], [49.052, 22.64], [49.187, 22.506], [49.631, 22.508],
  [50.425, 23.517], [50.46, 23.779], [50.584, 23.897], [50.845, 23.787], [50.935, 23.906], [51.378, 23.477], [51.685, 23.423], [51.668, 23.794],
  [51.954, 24.182], [52.02, 25.756], [51.874, 26.983], [51.718, 27.137], [51.7, 27.536], [51.604, 27.544], [51.724, 27.708], [51.747, 28.04],
  [51.69, 28.464], [51.582, 28.597], [51.789, 28.984], [51.546, 29.231], [51.663, 30.085], [51.456, 30.487], [51.549, 30.582], [51.789, 30.48],
  [51.883, 30.535], [52.245, 30.958], [52.246, 32.163], [52.5, 32.489], [52.44, 32.877], [52.515, 33.84], [51.928, 34.533], [51.831, 34.252],
  [51.48, 34.418], [51.395, 34.357], [51.322, 35.225], [51.173, 35.324], [51.153, 35.48], [50.824, 35.615], [50.63, 35.59], [50.45, 35.774],
  [50.483, 36.302], [50.271, 36.81], [50.472, 37.614], [50.158, 37.898], [49.962, 38.242], [50.096, 38.454], [49.859, 39.115], [49.89, 39.372],
  [49.597, 39.979], [49.601, 40.279], [49.269, 40.308], [49.02, 39.886], [48.83, 40.203], [48.815, 39.993], [48.593, 39.845], [48.544, 40.036],
  [48.298, 40.047], [48.264, 40.158], [47.873, 39.978], [47.838, 39.1], [47.643, 38.839], [47.585, 38.567], [47.287, 38.398], [47.242, 38.478],
  [47.051, 38.41],
]);
/** Krym [S, W, N, E] — mimo obrysu Natural Earth, patrí do mapy Ukrajiny. */
export const CRIMEA_BBOX = Object.freeze([44.3, 32.4, 46.3, 36.7]);
const UKRAINE_POLY = UKRAINE_OUTLINE.map(([lat, lon]) => `${lat} ${lon}`).join(' ');
const PLACE_RE = `^(${PLACE_CLASSES.join('|')})$`;
const ROAD_RE = `^(${ROAD_CLASSES.join('|')})$`;

export const round = (n, digits) => Number(Number(n).toFixed(digits));
const roundPoint = ([lon, lat], digits) => [round(lon, digits), round(lat, digits)];
const clean = (value) => {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s || null;
};

/** Prienik dvoch [S,W,N,E] boxov alebo null, keď sa nepretínajú. */
export function intersectBbox(a, b) {
  const S = Math.max(a[0], b[0]);
  const W = Math.max(a[1], b[1]);
  const N = Math.min(a[2], b[2]);
  const E = Math.min(a[3], b[3]);
  return S < N && W < E ? [S, W, N, E] : null;
}

const bboxText = ([S, W, N, E]) => `${S},${W},${N},${E}`;

/**
 * Výber pre dlaždicu: prvky v obryse Ukrajiny + (ak sa dlaždica pretína
 * s Krymom či ruským pohraničím) prvky v tom prieniku. Explicitný bbox
 * v statemente NAHRÁDZA globálny, preto sa rámcom dáva len ich prienik
 * s dlaždicou — inak by každá dlaždica stiahla celý rámec štyrikrát.
 */
function unionFor(selector, tile) {
  const lines = [`  ${selector}(poly:"${UKRAINE_POLY}");`];
  for (const box of [CRIMEA_BBOX, RU_BORDER_STRIP]) {
    const part = intersectBbox(tile, box);
    if (part) lines.push(`  ${selector}(${bboxText(part)});`);
  }
  return `(\n${lines.join('\n')}\n);`;
}

/** Sídla (uzly place=city|town|village): `out body` = id, lat, lon, tagy. */
export function buildPlacesQuery(tile) {
  return `[out:json][timeout:300][bbox:${bboxText(tile)}];\n${unionFor(`node["place"~"${PLACE_RE}"]`, tile)}\nout body;`;
}

/** Cesty (motorway…secondary): `out body geom` = uzly (id) + geometria, kvôli zlúčeniu cez dlaždice. */
export function buildRoadsQuery(tile) {
  return `[out:json][timeout:300][bbox:${bboxText(tile)}];\n${unionFor(`way["highway"~"${ROAD_RE}"]`, tile)}\nout body geom;`;
}

/** Pomenované rieky. */
export function buildRiversQuery(tile) {
  return `[out:json][timeout:300][bbox:${bboxText(tile)}];\n${unionFor('way["waterway"="river"]["name"]', tile)}\nout body geom;`;
}

/**
 * Oblasti: relácie admin_level=4 s kódom ISO3166-2 UA-xx (24 oblastí + Krym +
 * Kyjev + Sevastopoľ = 27) s ťažiskom (`center`) pre popisok, a ich vonkajšie
 * hraničné cesty s geometriou. Jeden dopyt na celé okno.
 */
export function buildOblastsQuery(bbox = UKRAINE_BBOX) {
  return `[out:json][timeout:300][bbox:${bboxText(bbox)}];\nrel["boundary"="administrative"]["admin_level"="4"]["ISO3166-2"~"^UA"]->.o;\n.o out body center;\nway(r.o:"outer");\nout body geom;`;
}

/** Jazyk `name` podľa zhody s name:uk / name:ru / name:be (pre latinizáciu v klientovi). */
export function nameLang(tags) {
  const name = clean(tags?.name);
  if (!name) return null;
  if (clean(tags['name:uk']) === name) return 'uk';
  if (clean(tags['name:ru']) === name) return 'ru';
  if (clean(tags['name:be']) === name) return 'be';
  return null;
}

/** `population` býva „12 345" aj „12345 (2001)" — číslo alebo null. */
export function parsePopulation(value) {
  const match = String(value ?? '').match(/\d[\d\s.,]*/);
  if (!match) return null;
  const n = Number.parseInt(match[0].replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Uzol sídla → GeoJSON bod. Mená: `name` (originál), `en`/`uk`/`ru` len keď
 * sa líšia od `name` (menší súbor), `lang` pre prepis, `pop`, `wd` (Wikidata).
 * @returns {object|null}
 */
export function placeFeature(el) {
  const tags = el?.tags || {};
  const cls = tags.place;
  if (!PLACE_CLASSES.includes(cls)) return null;
  if (!Number.isFinite(el.lat) || !Number.isFinite(el.lon)) return null;
  const name = clean(tags.name) || clean(tags['name:uk']) || clean(tags['name:en']);
  if (!name) return null;
  const properties = { id: el.id, cls, name };
  const lang = nameLang(tags);
  if (lang) properties.lang = lang;
  for (const [key, tag] of [['en', 'name:en'], ['uk', 'name:uk'], ['ru', 'name:ru']]) {
    const value = clean(tags[tag]);
    if (value && value !== name) properties[key] = value;
  }
  const pop = parsePopulation(tags.population);
  if (pop) properties.pop = pop;
  if (clean(tags.wikidata)) properties.wd = clean(tags.wikidata);
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: roundPoint([el.lon, el.lat], ROUND_POINT_DIGITS) },
    properties,
  };
}

/**
 * Zlúč výskyty tej istej cesty z viacerých dlaždíc: súradnice podľa id uzla,
 * poradie podľa `nodes`. Uzly bez súradnice v žiadnej dlaždici (mimo okna) sa
 * preskočia. Bez `nodes` (starší `out geom`) sa vezme geometria priamo.
 * @param {Array<object>} elements Overpass prvky (len `way` sa použijú)
 * @returns {Array<{id:number, tags:object, coords:number[][]}>}
 */
export function mergeWays(elements) {
  const byId = new Map();
  for (const el of elements || []) {
    if (el?.type !== 'way') continue;
    let way = byId.get(el.id);
    if (!way) {
      way = { id: el.id, tags: el.tags || {}, nodes: [], coordsByNode: new Map(), rawCoords: [] };
      byId.set(el.id, way);
    }
    if (el.tags && !Object.keys(way.tags).length) way.tags = el.tags;
    const nodes = Array.isArray(el.nodes) ? el.nodes : [];
    const geometry = Array.isArray(el.geometry) ? el.geometry : [];
    if (nodes.length) {
      if (!way.nodes.length) way.nodes = nodes;
      for (let i = 0; i < nodes.length; i += 1) {
        const g = geometry[i];
        if (g && Number.isFinite(g.lat) && Number.isFinite(g.lon)) way.coordsByNode.set(nodes[i], [g.lon, g.lat]);
      }
    } else if (!way.rawCoords.length) {
      way.rawCoords = geometry.filter((g) => g && Number.isFinite(g.lat) && Number.isFinite(g.lon)).map((g) => [g.lon, g.lat]);
    }
  }
  const out = [];
  for (const way of byId.values()) {
    const coords = way.nodes.length
      ? way.nodes.map((n) => way.coordsByNode.get(n)).filter(Boolean)
      : way.rawCoords;
    if (coords.length >= 2) out.push({ id: way.id, tags: way.tags, coords });
  }
  return out;
}

/**
 * Pospájaj úseky so zhodným koncovým bodom do dlhších čiar (hladný algoritmus,
 * smer úseku sa podľa potreby obráti). Volajúci už zoskupil úseky podľa kľúča
 * (trieda cesty + ref, meno rieky). Súradnice musia byť zaokrúhlené ROVNAKO,
 * inak sa ten istý uzol z dvoch dlaždíc nestretne.
 * @param {Array<number[][]>} lines
 * @returns {Array<number[][]>}
 */
export function chainLines(lines) {
  const key = (p) => `${p[0]},${p[1]}`;
  const starts = new Map();
  const ends = new Map();
  const push = (map, k, i) => { const list = map.get(k); if (list) list.push(i); else map.set(k, [i]); };
  lines.forEach((coords, i) => { push(starts, key(coords[0]), i); push(ends, key(coords[coords.length - 1]), i); });
  const used = new Uint8Array(lines.length);
  const take = (list, self) => {
    if (!list) return -1;
    for (const j of list) if (!used[j] && j !== self) return j;
    return -1;
  };
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (used[i]) continue;
    used[i] = 1;
    let coords = [...lines[i]];
    // dopredu
    for (;;) {
      const k = key(coords[coords.length - 1]);
      let j = take(starts.get(k), i);
      if (j >= 0) { used[j] = 1; coords = coords.concat(lines[j].slice(1)); continue; }
      j = take(ends.get(k), i);
      if (j >= 0) { used[j] = 1; coords = coords.concat([...lines[j]].reverse().slice(1)); continue; }
      break;
    }
    // dozadu
    for (;;) {
      const k = key(coords[0]);
      let j = take(ends.get(k), i);
      if (j >= 0) { used[j] = 1; coords = lines[j].slice(0, -1).concat(coords); continue; }
      j = take(starts.get(k), i);
      if (j >= 0) { used[j] = 1; coords = [...lines[j]].reverse().slice(0, -1).concat(coords); continue; }
      break;
    }
    out.push(coords);
  }
  return out;
}

/** Zaokrúhli, odstráň po sebe idúce duplikáty (vznikajú zaokrúhlením), zjednoduš. */
function tidyLine(coords, eps) {
  const rounded = [];
  for (const p of coords) {
    const q = roundPoint(p, ROUND_LINE_DIGITS);
    const last = rounded[rounded.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) rounded.push(q);
  }
  if (rounded.length < 2) return null;
  const simplified = simplify(rounded, eps);
  return simplified.length >= 2 ? simplified : null;
}

const lineFeature = (coords, properties) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties });

/**
 * Cesty → čiary zoskupené podľa (trieda, ref), pospájané a zjednodušené.
 * Meno cesty sa zámerne neukladá (na mape sa nepopisuje); `ref` (M-03, H-20) áno.
 */
export function roadFeatures(ways, { eps = SIMPLIFY_EPS_DEG.roads } = {}) {
  const groups = new Map();
  for (const way of ways) {
    const cls = way.tags?.highway;
    if (!ROAD_CLASSES.includes(cls)) continue;
    const ref = clean(way.tags.ref) || '';
    const k = `${cls}|${ref}`;
    let group = groups.get(k);
    if (!group) { group = { cls, ref, lines: [] }; groups.set(k, group); }
    const rounded = way.coords.map((p) => roundPoint(p, ROUND_LINE_DIGITS));
    if (rounded.length >= 2) group.lines.push(rounded);
  }
  const features = [];
  for (const group of groups.values()) {
    for (const chain of chainLines(group.lines)) {
      const coords = tidyLine(chain, eps);
      if (!coords) continue;
      const properties = { cls: group.cls };
      if (group.ref) properties.ref = group.ref;
      features.push(lineFeature(coords, properties));
    }
  }
  return features;
}

/**
 * Rieky → zoskupené podľa mena (name:uk, inak name), spolu ≥ minKm, pospájané.
 * Tagy (meno, en, jazyk) nesie najdlhší úsek skupiny.
 */
export function riverFeatures(ways, { minKm = RIVER_MIN_KM, eps = SIMPLIFY_EPS_DEG.rivers } = {}) {
  const groups = new Map();
  for (const way of ways) {
    const tags = way.tags || {};
    const label = clean(tags['name:uk']) || clean(tags.name);
    if (!label) continue;
    const k = label.toLowerCase();
    let group = groups.get(k);
    if (!group) { group = { km: 0, lines: [], tags: null, longest: -1, en: null, uk: null }; groups.set(k, group); }
    const km = lengthKm(way.coords);
    group.km += km;
    // Tagy z najdlhšieho úseku (pri zhode prvý); en/uk z ktoréhokoľvek, ktorý ich má —
    // krátky úsek pri prameni ich máva, dlhý stredný nie.
    if (km > group.longest) { group.longest = km; group.tags = tags; }
    if (!group.en) group.en = clean(tags['name:en']);
    if (!group.uk) group.uk = clean(tags['name:uk']);
    const rounded = way.coords.map((p) => roundPoint(p, ROUND_LINE_DIGITS));
    if (rounded.length >= 2) group.lines.push(rounded);
  }
  const features = [];
  for (const group of groups.values()) {
    if (group.km < minKm) continue;
    const tags = group.tags || {};
    const name = clean(tags.name) || clean(tags['name:uk']);
    const properties = { name, km: Math.round(group.km) };
    const lang = nameLang(tags);
    if (lang) properties.lang = lang;
    if (!properties.lang && group.uk === name) properties.lang = 'uk';
    if (group.en && group.en !== name) properties.en = group.en;
    for (const chain of chainLines(group.lines)) {
      const coords = tidyLine(chain, eps);
      if (coords) features.push(lineFeature(coords, properties));
    }
  }
  return features;
}

/**
 * Oblasti: register relácií (meno, en, ISO, ťažisko) + vonkajšie hraničné čiary
 * (každá spoločná hranica raz, s id oboch oblastí). Členy s rolou inner,
 * admin_centre či label sa nekreslia.
 */
export function oblastFeatures(elements, { eps = SIMPLIFY_EPS_DEG.oblasts } = {}) {
  const relations = (elements || []).filter((el) => el?.type === 'relation');
  const relsByWay = new Map();
  const index = [];
  for (const rel of relations) {
    const tags = rel.tags || {};
    const name = clean(tags.name) || clean(tags['name:uk']);
    const entry = { id: rel.id, name, iso: clean(tags['ISO3166-2']) };
    const lang = nameLang(tags);
    if (lang) entry.lang = lang;
    const en = clean(tags['name:en']);
    if (en && en !== name) entry.en = en;
    if (rel.center && Number.isFinite(rel.center.lat) && Number.isFinite(rel.center.lon)) {
      entry.center = roundPoint([rel.center.lon, rel.center.lat], ROUND_POINT_DIGITS);
    }
    index.push(entry);
    for (const member of rel.members || []) {
      if (member?.type !== 'way') continue;
      if (member.role !== 'outer' && member.role !== '') continue;
      const list = relsByWay.get(member.ref);
      if (list) { if (!list.includes(rel.id)) list.push(rel.id); } else relsByWay.set(member.ref, [rel.id]);
    }
  }
  const features = [];
  for (const way of mergeWays(elements)) {
    const rels = relsByWay.get(way.id);
    if (!rels) continue;
    const coords = tidyLine(way.coords, eps);
    if (coords) features.push(lineFeature(coords, { rels: [...rels].sort((a, b) => a - b) }));
  }
  index.sort((a, b) => String(a.iso).localeCompare(String(b.iso)));
  return { features, index };
}

/** Zhrnutie do meta: počet prvkov, súradníc, km (čiary). */
export function summarizeFeatures(features) {
  let coords = 0;
  let km = 0;
  for (const f of features) {
    const g = f.geometry;
    if (g.type === 'Point') coords += 1;
    else if (g.type === 'LineString') { coords += g.coordinates.length; km += lengthKm(g.coordinates); }
  }
  return { features: features.length, coordinates: coords, lengthKm: Math.round(km) };
}
