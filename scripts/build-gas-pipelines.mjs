// OKO — build the gas transmission pipeline snapshot for Europe + the former
// USSR (modul PLYN, etapa 5, 2026-09-13; používateľ: „ropovody a plynovody aj
// s Ruskom a Ukrajinou", „pokračuj ďalšou etapou").
//
// Fetches `man_made=pipeline` + `substance~gas` + `usage=transmission` ways
// from OpenStreetMap via Overpass, tile by tile (tall 32° × 41° bboxes from
// 12° W to 180° E, 34° N to 75° N — Slovakia, the EU, Ukraine, Russia to the
// Pacific, the Caucasus and Central Asia), clips each way to its tile,
// simplifies (Douglas–Peucker ~200 m), and writes
//   .gev-cache/gas/pipelines.geojsonl   (one Feature per line, ~MBs)
//   .gev-cache/gas/pipelines.meta.json  (snapshot provenance + counts)
// The dev proxy serves the file at /api/gas/pipelines; the layer
// src/data/gasPipelinesLayer.js draws it. Data license: ODbL 1.0,
// © OpenStreetMap contributors (DATA_SOURCES.md).
//
// Usage:
//   node scripts/build-gas-pipelines.mjs            # uses cached raw tiles when present
//   node scripts/build-gas-pipelines.mjs --refresh  # re-download every tile
//   OVERPASS_URL=https://overpass-api.de/api/interpreter node scripts/build-gas-pipelines.mjs
//
// Be a good Overpass citizen: this is a manual, occasional build (pipelines
// change on the timescale of years) — never automated, 20 s between tiles,
// raw responses cached on disk so a re-run never re-downloads.
import fs from 'node:fs';
import path from 'node:path';

const OVERPASS_URL = process.env.OVERPASS_URL || 'https://maps.mail.ru/osm/tools/overpass/api/interpreter';
const REFRESH = process.argv.includes('--refresh');
const CACHE_DIR = path.join(process.cwd(), '.gev-cache', 'gas');
const RAW_DIR = path.join(CACHE_DIR, 'osm-pipelines');
const OUT_FILE = path.join(CACHE_DIR, 'pipelines.geojsonl');
const META_FILE = path.join(CACHE_DIR, 'pipelines.meta.json');
/** Douglas–Peucker tolerance in degrees (~200 m) — continental scale. */
const SIMPLIFY_EPS_DEG = 0.002;
const ROUND = 3; // ~110 m
const PAUSE_MS = 20_000;
/** Tiles: [S, W, N, E]. Tall bands keep each Overpass answer bounded. */
const TILES = [
  [34, -12, 75, 20],
  [34, 20, 75, 52],
  [34, 52, 75, 84],
  [34, 84, 75, 116],
  [34, 116, 75, 148],
  [34, 148, 75, 180],
];
const USER_AGENT = 'OKO-gas-build/0.1 (https://github.com/vladouh76; vladouh76@gmail.com) one-off manual snapshot';
/** Verzia dopytu v názve surovej cache — nová verzia = staré dlaždice sa nepoužijú. */
const QUERY_VERSION = 'v2';

/**
 * Výber (2026-09-13, používateľ: „niekde sú len fragmenty a hluché miesta"):
 * prieskum SK/AT/CZ/HU ukázal 5 249 plynových potrubí, z toho len 566 s
 * `usage=transmission`; 1 926 bez `usage` — medzi nimi 132 úsekov FGSZ,
 * 94 ONTRAS, 22 Gaz-System (prepravcovia), a 246 pomenovaných. Dlhé trasy
 * (OPAL, WAG, Urengoj–Pomary–Užhorod) sú navyše relácie `route=pipeline`,
 * ktorých členské úseky často nemajú ani `substance`. Preto: prepravné =
 * `usage=transmission`, alebo člen plynovej relácie, alebo bez `usage` a
 * (DN ≥ 300, alebo meno/ref, alebo prevádzkovateľ = prepravca). Distribúcia,
 * areály a prípojky von; známy priemer < 150 mm von.
 */
const EXCLUDED_USAGE = /^(distribution|household_distribution|facility|gathering|service|industrial|storage)$/;
const TSO_RE = new RegExp([
  'eustream', 'transgas', 'net4gas', 'gaz[- ]?system', 'fgsz', 'transgaz', 'bulgartransgaz', 'desfa', 'snam', 'enag[aá]s', 'grtgaz', 'ter[eé]ga',
  'fluxys', 'gasunie', String.raw`\bgts\b`, 'open grid', String.raw`\boge\b`, 'thyssengas', 'gascade', 'bayernets', 'ontras', 'nowega', 'terranets',
  'ferngas', 'jordgas', 'gastransport', 'gas connect', String.raw`\btag\b`, 'trans austria', 'west austria', 'penta west', 'plinacro', 'gasgrid',
  'energinet', 'swedegas', 'elering', 'conexus', 'amber grid', String.raw`\bgtsou\b`, 'gas tso of ukraine', 'ukrtransgaz', 'naftogaz', 'gazprom',
  'газпром', 'трансгаз', 'beltransgaz', 'moldovatransgaz', 'vestmoldtransgaz', 'kaztransgas', 'qazaqgaz', 'intergas', 'uztransgaz', 'turkmengaz',
  'socar', 'bota[sş]', 'national grid', 'gas networks ireland', String.raw`\bgni\b`, 'nord stream', 'turkstream', 'balkan stream', 'interconnector',
  String.raw`\bbbl\b`, 'baltic pipe', String.raw`\btap\b`, 'trans adriatic', 'tanap', 'eugal', String.raw`\bopal\b`, String.raw`\bnel\b`, 'megal',
  String.raw`\bwag\b`, 'transitgas', 'swissgas', 'reganosa', 'ren gasodutos', 'geoplin', 'plinovodi', 'srbijagas', 'transportgas', 'gastrade', 'icgb',
  'omv gas', 'transmission', 'prenos', 'přeprav', 'preprav', 'transport gazu', 'gasleitung',
].join('|'), 'i');

const round = (n) => Number(n.toFixed(ROUND));

/** Priemer v mm z tagu `diameter` („1400", „1.4", „DN 800", „700 mm"). */
function diameterMm(tags) {
  const raw = String(tags.diameter || '').replace(',', '.');
  const num = Number(raw.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(num) || num <= 0) return null;
  return num < 10 ? Math.round(num * 1000) : Math.round(num);
}

/**
 * Prečo úsek patrí do prepravnej siete (alebo null = von).
 * @param {Record<string, string>} tags zlúčené tagy (relácia ako predvolené, way navrchu)
 * @param {boolean} inRelation člen plynovej relácie route=pipeline
 * @returns {'transmission'|'relation'|'diameter'|'name'|'operator'|null}
 */
export function classifyPipeline(tags, inRelation) {
  const usage = String(tags.usage || '').toLowerCase();
  if (usage === 'transmission') return 'transmission';
  if (usage && EXCLUDED_USAGE.test(usage)) return null;
  if (inRelation) return 'relation';
  const d = diameterMm(tags);
  if (d !== null && d < 150) return null;
  if (d !== null && d >= 300) return 'diameter';
  if (tags.name || tags['name:en'] || tags.ref) return 'name';
  if (tags.operator && TSO_RE.test(tags.operator)) return 'operator';
  return null;
}

function pointSegDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Iterative Douglas–Peucker (stack-based; transit ways are long). */
function simplify(coords, eps) {
  if (coords.length <= 2) return coords;
  const keep = new Uint8Array(coords.length);
  keep[0] = 1;
  keep[coords.length - 1] = 1;
  const stack = [[0, coords.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop();
    let maxDist = 0;
    let maxAt = -1;
    for (let i = from + 1; i < to; i++) {
      const d = pointSegDist(coords[i], coords[from], coords[to]);
      if (d > maxDist) { maxDist = d; maxAt = i; }
    }
    if (maxDist > eps && maxAt !== -1) {
      keep[maxAt] = 1;
      stack.push([from, maxAt], [maxAt, to]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

/** Clip a coordinate run to a bbox (runs outside dropped, crossings interpolated). */
function clipToBbox(coords, [S, W, N, E]) {
  const inside = ([lon, lat]) => lon >= W && lon <= E && lat >= S && lat <= N;
  const boundaryPoint = (a, b) => {
    let t = 1;
    const clamp = (limit, axis) => {
      const da = a[axis]; const db = b[axis];
      if (da === db) return;
      const tt = (limit - da) / (db - da);
      if (tt >= 0 && tt < t) t = tt;
    };
    if (b[0] < W) clamp(W, 0);
    if (b[0] > E) clamp(E, 0);
    if (b[1] < S) clamp(S, 1);
    if (b[1] > N) clamp(N, 1);
    return [round(a[0] + (b[0] - a[0]) * t), round(a[1] + (b[1] - a[1]) * t)];
  };
  const parts = [];
  let run = [];
  for (let i = 0; i < coords.length; i++) {
    const point = coords[i];
    if (inside(point)) {
      if (!run.length && i > 0 && !inside(coords[i - 1])) run.push(boundaryPoint(point, coords[i - 1]));
      run.push(point);
    } else if (run.length) {
      run.push(boundaryPoint(coords[i - 1], point));
      if (run.length >= 2) parts.push(run);
      run = [];
    }
  }
  if (run.length >= 2) parts.push(run);
  return parts;
}

const haversineKm = (a, b) => {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const lengthKm = (coords) => coords.reduce((sum, p, i) => (i ? sum + haversineKm(coords[i - 1], p) : 0), 0);

function toFeatures(el, tile, relTags = null) {
  // Tagy relácie (meno, prevádzkovateľ, priemer, látka) ako predvolené hodnoty
  // pre členské úseky, ktoré ich nemajú; tagy úseku majú prednosť.
  const tags = { ...(relTags || {}), ...(el.tags || {}) };
  const coords = (el.geometry || []).map((pt) => [round(pt.lon), round(pt.lat)]);
  const properties = {
    name: tags.name || tags['name:en'] || tags.ref || null,
    nameEn: tags['name:en'] || null,
    operator: tags.operator || null,
    ref: tags.ref || null,
    diameterMm: diameterMm(tags),
    substance: tags.substance || 'gas',
    location: tags.location || null,
    status: tags.disused === 'yes' || tags['disused:man_made'] ? 'disused' : (tags.construction === 'yes' || tags.proposed === 'yes' ? 'planned' : 'operating'),
    osm: el.id,
  };
  return clipToBbox(coords, tile)
    .map((part) => simplify(part, SIMPLIFY_EPS_DEG))
    .filter((part) => part.length >= 2)
    .map((part, index, parts) => ({
      type: 'Feature',
      id: parts.length === 1 ? `osm-way-${el.id}` : `osm-way-${el.id}.${index}`,
      properties: { ...properties, lengthKm: Math.round(lengthKm(part) * 10) / 10 },
      geometry: { type: 'LineString', coordinates: part },
    }));
}

async function fetchTile(tile) {
  const [S, W, N, E] = tile;
  const rawPath = path.join(RAW_DIR, `tile-${QUERY_VERSION}-${S}_${W}_${N}_${E}.json`);
  if (!REFRESH && fs.existsSync(rawPath)) {
    console.log(`  tile ${tile.join(',')}: raw cache`);
    return JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  }
  // Všetky kandidátske úseky (prepravné, alebo bez `usage` s priemerom, menom
  // či prevádzkovateľom — o zaradení rozhodne classifyPipeline) + členské
  // úseky plynových relácií route=pipeline (dlhé trasy); relácie samotné
  // idú s členstvom (`out body`), aby úseky zdedili meno a prevádzkovateľa.
  const query = `[out:json][timeout:300][bbox:${S},${W},${N},${E}];
(
  way["man_made"="pipeline"]["substance"~"^(gas|natural_gas)$"]["usage"="transmission"];
  way["man_made"="pipeline"]["substance"~"^(gas|natural_gas)$"][!"usage"]["diameter"];
  way["man_made"="pipeline"]["substance"~"^(gas|natural_gas)$"][!"usage"]["name"];
  way["man_made"="pipeline"]["substance"~"^(gas|natural_gas)$"][!"usage"]["operator"];
)->.w;
rel["route"="pipeline"]["substance"~"^(gas|natural_gas)$"]["usage"!~"^(distribution|household_distribution|facility|gathering)$"]->.r;
way(r.r)->.m;
(.w; .m;);
out tags geom;
.r out body;`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = Date.now();
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
      body: 'data=' + encodeURIComponent(query),
      signal: AbortSignal.timeout(360_000),
    });
    if (res.ok) {
      const text = await res.text();
      const json = JSON.parse(text);
      fs.mkdirSync(RAW_DIR, { recursive: true });
      fs.writeFileSync(rawPath, text, 'utf8');
      const els = json.elements || [];
      console.log(`  tile ${tile.join(',')}: ${els.filter((e) => e.type === 'way').length} ways, ${els.filter((e) => e.type === 'relation').length} relations, ${(text.length / 1e6).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(0)} s`);
      return json;
    }
    console.error(`  tile ${tile.join(',')}: Overpass HTTP ${res.status} (attempt ${attempt}/3)`);
    if (attempt === 3) throw new Error(`Overpass failed for tile ${tile.join(',')}: ${(await res.text()).slice(0, 300)}`);
    await new Promise((resolve) => setTimeout(resolve, 45_000));
  }
  return null;
}

const started = Date.now();
console.log(`gas pipelines snapshot: ${TILES.length} tiles via ${OVERPASS_URL}${REFRESH ? ' (refresh)' : ''}`);
const features = [];
const tileMeta = [];
const basis = { transmission: 0, relation: 0, diameter: 0, name: 0, operator: 0, excluded: 0 };
for (let i = 0; i < TILES.length; i++) {
  const tile = TILES[i];
  const json = await fetchTile(tile);
  const elements = json.elements || [];
  const relTagsByWay = new Map();
  for (const rel of elements) {
    if (rel.type !== 'relation') continue;
    for (const m of rel.members || []) if (m.type === 'way' && !relTagsByWay.has(m.ref)) relTagsByWay.set(m.ref, rel.tags || {});
  }
  const ways = elements.filter((el) => el.type === 'way');
  const seenWays = new Set();
  const parts = [];
  for (const el of ways) {
    if (seenWays.has(el.id)) continue; // úsek môže byť v .w aj .m
    seenWays.add(el.id);
    const relTags = relTagsByWay.get(el.id) || null;
    const rule = classifyPipeline({ ...(relTags || {}), ...(el.tags || {}) }, relTags !== null);
    if (!rule) { basis.excluded += 1; continue; }
    basis[rule] += 1;
    parts.push(...toFeatures(el, tile, relTags));
  }
  features.push(...parts);
  tileMeta.push({ bbox: tile, ways: ways.length, relations: relTagsByWay.size ? elements.filter((el) => el.type === 'relation').length : 0, features: parts.length, osmBase: json.osm3s?.timestamp_osm_base || null });
  if (i < TILES.length - 1 && !fs.existsSync(path.join(RAW_DIR, `tile-${QUERY_VERSION}-${TILES[i + 1].join('_')}.json`))) {
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }
}
// Ten istý way môže ležať v dvoch dlaždiciach — každá dá svoj orezaný kus
// s rovnakým OSM id; entity id vo vrstve musia byť jedinečné → druhý a ďalší
// výskyt dostane príponu #2, #3 … (deterministicky podľa poradia dlaždíc).
const seen = new Map();
let renamed = 0;
for (const f of features) {
  const n = (seen.get(f.id) || 0) + 1;
  seen.set(f.id, n);
  if (n > 1) { f.id = `${f.id}#${n}`; renamed += 1; }
}
features.sort((a, b) => a.id.localeCompare(b.id));
fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, features.map((f) => JSON.stringify(f)).join('\n') + '\n', 'utf8');
const points = features.reduce((n, f) => n + f.geometry.coordinates.length, 0);
const km = Math.round(features.reduce((n, f) => n + f.properties.lengthKm, 0));
const named = features.filter((f) => f.properties.name).length;
const meta = {
  snapshot: new Date().toISOString(),
  source: 'OpenStreetMap via Overpass API',
  license: 'ODbL 1.0 — © OpenStreetMap contributors',
  endpoint: OVERPASS_URL,
  query: `${QUERY_VERSION}: way[man_made=pipeline][substance~gas] with usage=transmission, or no usage + (diameter|name|operator), plus members of rel[route=pipeline][substance~gas]; kept by classifyPipeline`,
  basis,
  tiles: tileMeta,
  simplifyEpsDeg: SIMPLIFY_EPS_DEG,
  round: ROUND,
  features: features.length,
  named,
  crossTileDuplicatesRenamed: renamed,
  points,
  lengthKm: km,
  bytes: fs.statSync(OUT_FILE).size,
};
fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2), 'utf8');
console.log(`pipelines.geojsonl: ${features.length} features (${named} named), ${points} points, ${km} km, ${(meta.bytes / 1e6).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(0)} s`);
