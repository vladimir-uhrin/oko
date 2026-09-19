// OKO — build the UKRAJINA base snapshot (modul UKRAJINA, etapa 1, 2026-09-19;
// plán docs/drafts/ukrajina-plan.md): settlements, roads, rivers and oblast
// boundaries from OpenStreetMap via Overpass, written as dated static files
//   .gev-cache/ukraine/base/places.json    place=city|town        (labels from far)
//   .gev-cache/ukraine/base/villages.json  place=village          (lazy, close-up only)
//   .gev-cache/ukraine/base/roads.json     motorway…secondary     (chained, simplified)
//   .gev-cache/ukraine/base/rivers.json    named rivers ≥ 30 km   (grouped by name)
//   .gev-cache/ukraine/base/oblasts.json   admin_level=4 borders + register
//   .gev-cache/ukraine/base/meta.json      provenance + counts
// The dev proxy serves them under /api/ukraine/base/<dataset>; the client
// overlay src/data/ukraineBaseLayer.js draws them. Data license: ODbL 1.0,
// © OpenStreetMap contributors (DATA_SOURCES.md) — its own file family, never
// merged with CC BY data (Collective Database, ODbL §4.5(a)).
//
// Usage:
//   node scripts/build-ukraine-base.mjs            # reuses cached raw answers
//   node scripts/build-ukraine-base.mjs --refresh  # re-download everything
//   OVERPASS_URL=https://overpass-api.de/api/interpreter node scripts/build-ukraine-base.mjs
//
// Overpass etiquette: manual, occasional build (13 queries), one at a time,
// 30 s pause between live requests (overpass-api.de answers 429 when heavy
// queries follow faster), raw answers cached on disk, endpoints rotated on
// failure, an EMPTY answer is a failure (a mirror without area data returned
// 0 rivers for a whole tile on 2026-09-19). Never automate this.
import fs from 'node:fs';
import path from 'node:path';

import {
  UKRAINE_BBOX,
  UKRAINE_TILES,
  buildOblastsQuery,
  buildPlacesQuery,
  buildRiversQuery,
  buildRoadsQuery,
  mergeWays,
  oblastFeatures,
  placeFeature,
  riverFeatures,
  roadFeatures,
  summarizeFeatures,
} from './lib/ukraineBase.mjs';

const ENDPOINTS = process.env.OVERPASS_URL
  ? [process.env.OVERPASS_URL]
  : [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  ];
const REFRESH = process.argv.includes('--refresh');
const OUT_DIR = path.join(process.cwd(), '.gev-cache', 'ukraine', 'base');
const RAW_DIR = path.join(process.cwd(), '.gev-cache', 'ukraine', 'osm-raw');
const USER_AGENT = 'OKO-ukraine-build/0.1 (https://github.com/vladouh76; vladouh76@gmail.com) one-off manual snapshot';
/**
 * Verzia dopytov v názve surovej cache — nová verzia = staré odpovede sa nepoužijú.
 * v1 = výber cez `area["ISO3166-1"="UA"]` (mirror bez areas vrátil prázdno), v2 = polygón.
 */
const QUERY_VERSION = 'v2';
/** overpass-api.de vracia 429, keď ťažké dopyty idú za sebou rýchlejšie než ~30 s. */
const PAUSE_MS = 30_000;
const RATE_LIMIT_WAIT_MS = 90_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastLiveAt = 0;

/**
 * @param {string} name kľúč surovej cache
 * @param {string} query Overpass QL
 * @param {(json: object) => string|null} [validate] vráti dôvod, prečo je odpoveď NEPLATNÁ (prázdna = mirror bez dát), inak null
 */
async function fetchOverpass(name, query, validate = (json) => ((json.elements || []).length ? null : 'empty answer (mirror without the data?)')) {
  const rawPath = path.join(RAW_DIR, `${name}-${QUERY_VERSION}.json`);
  if (!REFRESH && fs.existsSync(rawPath)) {
    console.log(`  ${name}: raw cache`);
    return JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  }
  const wait = PAUSE_MS - (Date.now() - lastLiveAt);
  if (lastLiveAt && wait > 0) await sleep(wait);
  let lastError = null;
  for (let round = 1; round <= 3; round += 1) {
    for (const endpoint of ENDPOINTS) {
      const started = Date.now();
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(420_000),
        });
        lastLiveAt = Date.now();
        const text = await res.text();
        if (!res.ok) {
          const error = new Error(`HTTP ${res.status}: ${text.slice(0, 160).replace(/\s+/g, ' ')}`);
          error.rateLimited = res.status === 429 || res.status === 504;
          throw error;
        }
        const json = JSON.parse(text);
        // Overpass hlási tiché orezanie odpovede v `remark` (runtime/memory error).
        if (json.remark) throw new Error(`remark: ${json.remark}`);
        // Prázdna odpoveď sa NIKDY necachuje — 2026-09-19 ju dal mirror bez areas
        // a build by s ňou spokojne pokračoval bez riek.
        const invalid = validate(json);
        if (invalid) throw new Error(invalid);
        fs.mkdirSync(RAW_DIR, { recursive: true });
        fs.writeFileSync(rawPath, text, 'utf8');
        const els = json.elements || [];
        console.log(`  ${name}: ${els.length} elements, ${(text.length / 1e6).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(0)} s via ${new URL(endpoint).host}`);
        return json;
      } catch (error) {
        lastError = error;
        console.error(`  ${name}: ${new URL(endpoint).host} failed (round ${round}/3): ${error?.message || error}`);
        await sleep(error?.rateLimited ? RATE_LIMIT_WAIT_MS : 30_000);
      }
    }
  }
  throw new Error(`Overpass failed for ${name}: ${lastError?.message || lastError}`);
}

const tileName = ([S, W, N, E]) => `${S}_${W}_${N}_${E}`.replace(/\./g, 'p');

function writeJson(file, value) {
  const text = JSON.stringify(value);
  fs.writeFileSync(file, text, 'utf8');
  return Buffer.byteLength(text);
}

const started = Date.now();
console.log(`UKRAJINA base snapshot: ${UKRAINE_TILES.length} tiles × 3 datasets + oblasts via ${ENDPOINTS.map((e) => new URL(e).host).join(' → ')}${REFRESH ? ' (refresh)' : ''}`);
fs.mkdirSync(OUT_DIR, { recursive: true });

const placeNodes = new Map();
const roadElements = [];
const riverElements = [];
for (const tile of UKRAINE_TILES) {
  const suffix = tileName(tile);
  const places = await fetchOverpass(`places-${suffix}`, buildPlacesQuery(tile));
  for (const el of places.elements || []) if (el.type === 'node' && !placeNodes.has(el.id)) placeNodes.set(el.id, el);
  const roads = await fetchOverpass(`roads-${suffix}`, buildRoadsQuery(tile));
  roadElements.push(...(roads.elements || []));
  const rivers = await fetchOverpass(`rivers-${suffix}`, buildRiversQuery(tile));
  riverElements.push(...(rivers.elements || []));
}
const oblastsRaw = await fetchOverpass('oblasts', buildOblastsQuery(), (json) => {
  const relations = (json.elements || []).filter((el) => el.type === 'relation').length;
  return relations >= 27 ? null : `only ${relations} oblast relations (expected 27: 24 oblasts + Crimea + Kyiv + Sevastopol)`;
});

// Sídla: mestá + mestečká vždy, dediny zvlášť (klient ich ťahá len zblízka).
const placeFeatures = [...placeNodes.values()].map(placeFeature).filter(Boolean);
const towns = placeFeatures.filter((f) => f.properties.cls !== 'village');
const villages = placeFeatures.filter((f) => f.properties.cls === 'village');
const roads = roadFeatures(mergeWays(roadElements));
const rivers = riverFeatures(mergeWays(riverElements));
const oblasts = oblastFeatures(oblastsRaw.elements || []);

const datasets = {};
const emit = (key, file, collection) => {
  const bytes = writeJson(path.join(OUT_DIR, file), collection);
  datasets[key] = { file, bytes, ...summarizeFeatures(collection.features) };
  console.log(`  ${key}: ${datasets[key].features} features, ${datasets[key].coordinates} coordinates${datasets[key].lengthKm ? `, ${datasets[key].lengthKm} km` : ''}, ${(bytes / 1e6).toFixed(2)} MB → ${file}`);
};
emit('places', 'places.json', { type: 'FeatureCollection', features: towns });
emit('villages', 'villages.json', { type: 'FeatureCollection', features: villages });
emit('roads', 'roads.json', { type: 'FeatureCollection', features: roads });
emit('rivers', 'rivers.json', { type: 'FeatureCollection', features: rivers });
emit('oblasts', 'oblasts.json', { type: 'FeatureCollection', features: oblasts.features, oblasts: oblasts.index });

const byClass = (features, key) => features.reduce((acc, f) => { const k = f.properties[key]; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
const meta = {
  snapshot: new Date().toISOString(),
  source: 'OpenStreetMap contributors via Overpass API',
  license: 'ODbL 1.0',
  attribution: '© OpenStreetMap contributors',
  bbox: UKRAINE_BBOX,
  tiles: UKRAINE_TILES,
  queryVersion: QUERY_VERSION,
  queries: {
    places: 'node[place~^(city|town|village)$] on the Ukraine area (+ Kursk/Belgorod border strip)',
    roads: 'way[highway~^(motorway|trunk|primary|secondary)$] on the Ukraine area (+ border strip), chained by (class, ref), Douglas–Peucker 0.0006°',
    rivers: 'way[waterway=river][name] on the Ukraine area (+ border strip), grouped by name, kept when ≥ 30 km in the window',
    oblasts: 'rel[boundary=administrative][admin_level=4][ISO3166-2~^UA] outer ways, Douglas–Peucker 0.001°',
  },
  counts: {
    placesByClass: byClass(placeFeatures, 'cls'),
    roadsByClass: byClass(roads, 'cls'),
    oblasts: oblasts.index.length,
  },
  datasets,
  builtInMs: Date.now() - started,
};
writeJson(path.join(OUT_DIR, 'meta.json'), meta);
console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)} s; oblasts: ${oblasts.index.map((o) => o.iso).join(' ')}`);
