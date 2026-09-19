// OKO — build the CRUDE OIL transmission pipeline snapshot (etapa 2, 2026-09-19;
// používateľ: „ropovody všade kde som dal aj plynovody").
//
// Fetches `man_made=pipeline` + `substance~oil` ways from OpenStreetMap via
// Overpass over the SAME 12 tiles the gas snapshot uses, clips each way to its
// tile, simplifies (Douglas–Peucker ~200 m), and writes
//   .gev-cache/oil/pipelines.geojsonl   (one Feature per line)
//   .gev-cache/oil/pipelines.meta.json  (snapshot provenance + counts)
// Data license: ODbL 1.0, © OpenStreetMap contributors (DATA_SOURCES.md).
//
// WHY ITS OWN FILE AND NEVER MERGED INTO THE GAS SNAPSHOT — this is a licence
// requirement, not tidiness. Merging the two would make the whole a Derivative
// Database under ODbL; two independent databases distributed together are a
// Collective Database, exempt under ODbL section 4.5(a).
//
// SUBSTANCES: `^(oil|crude_oil|petroleum)$`. Measured over this footprint,
// only `oil` actually occurs (14 145 ways); crude_oil and petroleum are zero
// here and 20 / 7 worldwide, kept purely as cheap insurance against a new tag.
// DELIBERATELY EXCLUDED:
//   substance=fuel (1 677 ways here) — the OSM wiki defines it as "Refined
//     petroleum products" and notes such lines are switched between gasoline,
//     diesel and heating oil. A products pipeline is a different commodity
//     from crude, so it is not a ropovod.
//   substance=hydrocarbons (549 ways here) — an unseparated multiphase well
//     stream, i.e. field infrastructure upstream of a separator, the same
//     category as gathering and flowline which we already drop.
//   ngl, condensate, lpg, naphtha, diesel, gasoline, jet_fuel — 44 ways total.
//
// KNOWN AND HONEST INCOMPLETENESS (project rule 2, must be stated in the UI):
// this query sees 3 339 of the 14 145 oil ways mapped here — 23.6 %. The other
// 76 % are completely bare: no usage, no name, no ref, no diameter, no
// operator, so no query branch can see them and no tag can tell a bare trunk
// line from a bare well tie-in. The layer therefore shows the attributed
// quarter, which in the Persian Gulf is thin: the user declined the Global
// Energy Monitor tracker (it is behind a form asking for personal data), and
// OSM alone has almost no named Gulf oil lines.
//
// Usage:
//   node scripts/build-oil-pipelines.mjs            # uses cached raw tiles when present
//   node scripts/build-oil-pipelines.mjs --refresh  # re-download every tile
//
// Be a good Overpass citizen: manual, occasional build — never automated,
// 20 s between tiles, raw responses cached. NEVER run --refresh casually: the
// inter-tile pause is skipped when the next tile is already cached, so a
// refresh fires every query back to back.
import path from 'node:path';

import { buildPipelineSnapshot } from './lib/pipelineSnapshot.mjs';
import { makeClassifier } from './lib/pipelineTags.mjs';

const OVERPASS_URL = process.env.OVERPASS_URL || 'https://maps.mail.ru/osm/tools/overpass/api/interpreter';
const REFRESH = process.argv.includes('--refresh');
const CACHE_DIR = path.join(process.cwd(), '.gev-cache', 'oil');
const RAW_DIR = path.join(CACHE_DIR, 'osm-pipelines');
const USER_AGENT = 'OKO-oil-build/0.1 (https://github.com/vladouh76; vladouh76@gmail.com) one-off manual snapshot';
const QUERY_VERSION = 'v1';

/** Same 12 tiles as the gas snapshot: [S, W, N, E]. */
const TILES = [
  [34, -12, 75, 20],
  [34, 20, 75, 52],
  [34, 52, 75, 84],
  [34, 84, 75, 116],
  [34, 116, 75, 148],
  [34, 148, 75, 180],
  [0, -12, 34, 20],
  [0, 20, 34, 52],
  [0, 52, 34, 84],
  [0, 84, 34, 116],
  [0, 116, 34, 148],
  [0, 148, 34, 180],
];

/**
 * Oil adds `flowline`, `flare_header` and `collection` to the gas exclusions.
 * They are oil-field plumbing upstream of the trunk network and were never in
 * the gas list because gas fields rarely use those values.
 */
const EXCLUDED_USAGE = /^(distribution|household_distribution|facility|gathering|service|industrial|storage|flowline|flare_header|collection)$/;

/**
 * Crude-oil transmission operators. Every value was verified against real
 * `operator` values in taginfo — nothing here is a plausible-sounding company
 * name that was never observed, because a wrong fragment silently pulls in
 * refinery yards and city distribution.
 *
 * Word boundaries are load-bearing on short Latin tokens: a bare 'mero' would
 * match Merano and Meroux, 'pern' Pernik and Perner, 'spse' nothing but is
 * kept symmetrical, 'tal' (Transalpine) is spelled out as 'transalpine'
 * precisely because the three-letter form matches hundreds of German place
 * names. No boundaries around Cyrillic or CJK, where \b does not apply.
 */
const OIL_OPERATOR_RE = new RegExp([
  // Ex-USSR
  'транснефть', 'нефтепровод', 'укртранснафта', 'kaztransoil', 'caspian pipeline',
  // Caucasus / Türkiye
  'btc co', 'bota[sş]',
  // Central and Eastern Europe
  'transalpine', 'adria[- ]wien', 'pipeline sud', String.raw`\bspse\b`, String.raw`\bmero\b`,
  String.raw`\bpern\b`, 'transpetrol', String.raw`\bjanaf\b`,
  // Middle East and North Africa
  'arab petroleum pipeline', String.raw`\bsumed\b`, 'north oil company',
  'petroleum development oman', String.raw`\bnioc\b`, 'sonatrach',
  // Sub-Saharan Africa
  String.raw`\bcotco\b`, String.raw`\bagoco\b`,
  // East Asia
  '国家管网', 'pipechina',
].join('|'), 'i');

const OIL_SUBSTANCE_RE = /^(oil|crude_oil|petroleum)$/i;
export const classifyOilPipeline = makeClassifier({ excludedUsage: EXCLUDED_USAGE, operatorRe: OIL_OPERATOR_RE, substanceRe: OIL_SUBSTANCE_RE });

/** Same four-branch shape as gas, with the oil substances. */
const buildQuery = ([S, W, N, E]) => `[out:json][timeout:300][bbox:${S},${W},${N},${E}];
(
  way["man_made"="pipeline"]["substance"~"^(oil|crude_oil|petroleum)$"]["usage"="transmission"];
  way["man_made"="pipeline"]["substance"~"^(oil|crude_oil|petroleum)$"][!"usage"]["diameter"];
  way["man_made"="pipeline"]["substance"~"^(oil|crude_oil|petroleum)$"][!"usage"]["name"];
  way["man_made"="pipeline"]["substance"~"^(oil|crude_oil|petroleum)$"][!"usage"]["operator"];
)->.w;
rel["route"="pipeline"]["substance"~"^(oil|crude_oil|petroleum)$"]["usage"!~"^(distribution|household_distribution|facility|gathering|flowline|collection)$"]->.r;
way(r.r)->.m;
(.w; .m;);
out tags geom;
.r out body;`;

await buildPipelineSnapshot({
  label: 'oil',
  tiles: TILES,
  queryVersion: QUERY_VERSION,
  cacheDir: CACHE_DIR,
  rawDir: RAW_DIR,
  outFile: path.join(CACHE_DIR, 'pipelines.geojsonl'),
  metaFile: path.join(CACHE_DIR, 'pipelines.meta.json'),
  buildQuery,
  classify: classifyOilPipeline,
  queryDescription: `${QUERY_VERSION}: way[man_made=pipeline][substance~^(oil|crude_oil|petroleum)$] with usage=transmission, or no usage + (diameter|name|operator), plus members of rel[route=pipeline][substance~oil]; kept by classifyOilPipeline. Excludes substance=fuel (refined products) and substance=hydrocarbons (multiphase well stream).`,
  overpassUrl: OVERPASS_URL,
  userAgent: USER_AGENT,
  refresh: REFRESH,
});
