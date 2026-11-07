// OKO — build the high-voltage power grid snapshot (ELEKTRINA, 2026-11-06;
// používateľ: „plynovody, elektrinu a všetko na vrchol vylepšenia").
//
// Fetches `power=line` and `power=cable` ways with a voltage of 220 kV or
// more (plus the member ways of `route=power` relations at that voltage)
// from OpenStreetMap via Overpass, tile by tile, clips each way to its tile,
// simplifies (Douglas–Peucker ~200 m), and writes
//   .gev-cache/power/lines.geojsonl   (one Feature per line, ~MBs)
//   .gev-cache/power/lines.meta.json  (snapshot provenance + counts)
// The proxy serves the file at /api/power/lines; the layer
// src/data/powerGridLayer.js draws it. Data license: ODbL 1.0,
// © OpenStreetMap contributors (DATA_SOURCES.md).
//
// Same window as the pipelines (0–75° N × −12…180° E), but Europe is cut
// into 8° × 8° tiles: a single 8° × 32° band over France/Germany timed out
// on both public instances (towers are mapped as nodes — a 220 kV+ grid has
// ~20× the vertices of the gas network over the same ground).
//
// Usage:
//   node scripts/build-power-lines.mjs            # uses cached raw tiles when present
//   node scripts/build-power-lines.mjs --refresh  # re-download every tile
//   OVERPASS_URL=https://maps.mail.ru/osm/tools/overpass/api/interpreter node scripts/build-power-lines.mjs
//
// Be a good Overpass citizen: this is a manual, occasional build (the grid
// changes on the timescale of years) — never automated, 20 s between tiles,
// raw responses cached on disk so a re-run never re-downloads. NEVER run
// --refresh casually: the inter-tile pause is skipped when the next tile is
// already cached, so a refresh fires every query back to back.
import path from 'node:path';

import { buildPipelineSnapshot } from './lib/pipelineSnapshot.mjs';
import { POWER_KINDS, powerKind } from '../src/data/powerGrid.js';
import { loadCountryIndex } from './lib/pipelineCountries.mjs';
import { classifyPowerLine, powerLineProperties } from './lib/powerTags.mjs';
import { WORLD_TILES_FINE } from './lib/worldTiles.mjs';

// Hlavná inštancia: zrkadlo maps.mail.ru vracalo na husté dlaždice 504 / „server too busy".
const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const REFRESH = process.argv.includes('--refresh');
const CACHE_DIR = path.join(process.cwd(), '.gev-cache', 'power');
const RAW_DIR = path.join(CACHE_DIR, 'osm-power');
const USER_AGENT = 'OKO-power-build/0.1 (https://github.com/vladouh76; vladouh76@gmail.com) one-off manual snapshot';
/** Verzia dopytu v názve surovej cache — nová verzia = staré dlaždice sa nepoužijú. */
const QUERY_VERSION = 'v1';

/**
 * Tiles: [S, W, N, E]. Európa (34–75° N × −12…52° E) po 8° × 8°, zvyšok
 * okna v širokých pásoch ako pri potrubiach — na východ od Uralu a na juh
 * od 34° s. š. je zmapovaných vedení rádovo menej. Hranice sú inkluzívne, dotýkajúce
 * sa dlaždice zdieľajú len okraj (clipToBbox), preto sa pásy neprekrývajú.
 */
const TILES = [];
for (const [S, N] of [[34, 42], [42, 50], [50, 58], [58, 66], [66, 75]]) {
  for (let W = -12; W < 52; W += 8) TILES.push([S, W, N, W + 8]);
}
TILES.push([34, 52, 75, 84], [34, 84, 75, 116], [34, 116, 75, 148], [34, 148, 75, 180]);
TILES.push([0, -12, 34, 20], [0, 20, 34, 52], [0, 52, 34, 84], [0, 84, 34, 116], [0, 116, 34, 148], [0, 148, 34, 180]);
// Celý svet (2026-11-07): Amerika (jadro USA po 8° × 16°), Island, juh Afriky, Indonézia,
// Austrália — na KONCI, aby sa nezmenili prípony '#N' existujúcich úsekov.
TILES.push(...WORLD_TILES_FINE);

/**
 * ≥ 220 kV: hodnota `voltage` je jedno číslo alebo viac čísel cez bodkočiarku
 * („400000;110000") — stačí, keď aspoň jedno je 220 000 a viac (225 kV
 * Francúzsko, 330 kV ex-ZSSR, 380 kV DE/CH, 400, 500, 750, 765, 1 150 kV).
 */
const VOLTAGE_RE = '(^|;)(2[2-9][0-9]{4}|[3-9][0-9]{5}|[0-9]{7,})(;|$)';
const buildQuery = ([S, W, N, E]) => `[out:json][timeout:300][bbox:${S},${W},${N},${E}];
(
  way["power"="line"]["voltage"~"${VOLTAGE_RE}"];
  way["power"="cable"]["voltage"~"${VOLTAGE_RE}"];
)->.w;
rel["route"="power"]["voltage"~"${VOLTAGE_RE}"]->.r;
way(r.r)->.m;
(.w; .m;);
out tags geom;
.r out body;`;

// Krajiny úseku (vlajky v karte) z Natural Earth — len v builde, do snímku idú ISO2 kódy.
const countryIndex = await loadCountryIndex({ cacheDir: path.join(process.cwd(), '.gev-cache', 'natural-earth') });

await buildPipelineSnapshot({
  countryIndex,
  label: 'power',
  tiles: TILES,
  queryVersion: QUERY_VERSION,
  cacheDir: CACHE_DIR,
  rawDir: RAW_DIR,
  outFile: path.join(CACHE_DIR, 'lines.geojsonl'),
  metaFile: path.join(CACHE_DIR, 'lines.meta.json'),
  buildQuery,
  classify: classifyPowerLine,
  mapProperties: powerLineProperties,
  basisKeys: ['line', 'cable'],
  queryDescription: `${QUERY_VERSION}: way[power=line|cable][voltage ≥ 220 kV] plus members of rel[route=power][voltage ≥ 220 kV]; kept by classifyPowerLine (own voltage ≥ 220 kV, lines and cables only)`,
  overpassUrl: OVERPASS_URL,
  userAgent: USER_AGENT,
  refresh: REFRESH,
  cachedOnly: process.argv.includes('--cached-only'),
  // Bunky 5° × 5° (2026-11-06): snímok má stovky tisíc úsekov — server ho nesmie
  // parsovať za behu (blokoval by hlavné vlákno oko-api), preto ho rozdelí build:
  // `.gev-cache/power/cells/<id>.geojsonl` + `index.json` (writeCells v engine).
  cells: { dir: path.join(CACHE_DIR, 'cells'), kinds: POWER_KINDS, kindOf: powerKind },
});
