// OKO — build the gas transmission pipeline snapshot (modul PLYN, etapa 5,
// 2026-09-13; používateľ: „ropovody a plynovody aj s Ruskom a Ukrajinou").
//
// Fetches `man_made=pipeline` + `substance~gas` + `usage=transmission` ways
// from OpenStreetMap via Overpass, tile by tile, clips each way to its tile,
// simplifies (Douglas–Peucker ~200 m), and writes
//   .gev-cache/gas/pipelines.geojsonl   (one Feature per line, ~MBs)
//   .gev-cache/gas/pipelines.meta.json  (snapshot provenance + counts)
// The dev proxy serves the file at /api/gas/pipelines; the layer
// src/data/gasPipelinesLayer.js draws it. Data license: ODbL 1.0,
// © OpenStreetMap contributors (DATA_SOURCES.md).
//
// Coverage (2026-09-19, etapa 1): 12 tiles, 34–75° N and 0–34° N, both
// −12…180° E. The southern band was added because the Middle East, North
// Africa and South/South-East Asia sat entirely below the old 34° N floor, so
// the Hormuz, Suez, Bab-el-Mandeb and Malacca scenes drew nothing.
//
// Usage:
//   node scripts/build-gas-pipelines.mjs            # uses cached raw tiles when present
//   node scripts/build-gas-pipelines.mjs --refresh  # re-download every tile
//   OVERPASS_URL=https://overpass-api.de/api/interpreter node scripts/build-gas-pipelines.mjs
//
// Be a good Overpass citizen: this is a manual, occasional build (pipelines
// change on the timescale of years) — never automated, 20 s between tiles,
// raw responses cached on disk so a re-run never re-downloads. NEVER run
// --refresh casually: the inter-tile pause is skipped when the next tile is
// already cached, so a refresh fires every query back to back.
import path from 'node:path';

import { buildPipelineSnapshot } from './lib/pipelineSnapshot.mjs';
import { makeClassifier } from './lib/pipelineTags.mjs';

const OVERPASS_URL = process.env.OVERPASS_URL || 'https://maps.mail.ru/osm/tools/overpass/api/interpreter';
const REFRESH = process.argv.includes('--refresh');
const CACHE_DIR = path.join(process.cwd(), '.gev-cache', 'gas');
const RAW_DIR = path.join(CACHE_DIR, 'osm-pipelines');
const USER_AGENT = 'OKO-gas-build/0.1 (https://github.com/vladouh76; vladouh76@gmail.com) one-off manual snapshot';
/** Verzia dopytu v názve surovej cache — nová verzia = staré dlaždice sa nepoužijú. */
const QUERY_VERSION = 'v2';

/** Tiles: [S, W, N, E]. Tall bands keep each Overpass answer bounded. */
const TILES = [
  [34, -12, 75, 20],
  [34, 20, 75, 52],
  [34, 52, 75, 84],
  [34, 84, 75, 116],
  [34, 116, 75, 148],
  [34, 148, 75, 180],
  // Juh (2026-09-19, etapa 1): rovník → 34° s. š., rovnaké poludníkové rezy ako sever.
  // PRIPÁJA SA NA KONIEC — suffix '#N' pri dlaždicových duplikátoch sa prideľuje
  // v poradí TILES, takže predradenie by z existujúcich id spravilo '#2'.
  // Severná hranica je presne 34, nie 35: clipToBbox má inkluzívne hranice, takže
  // dotýkajúce sa pásy zdieľajú len hraničný bod; prekryv by tú istú zem nakreslil dvakrát.
  // Rovník, nie 12° s. š.: pás 0–12° stojí cez celé okno 53 ways (+8 %) a je jediná
  // hranica, ktorá pokryje rám scény Malacca (spodok 1,0° s. š.).
  [0, -12, 34, 20],
  [0, 20, 34, 52],
  [0, 52, 34, 84],
  [0, 84, 34, 116],
  [0, 116, 34, 148],
  [0, 148, 34, 180],
];

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
  // ── Juh (2026-09-19, etapa 1) ─────────────────────────────────────────────
  // Každá hodnota overená v taginfo na reálnych hodnotách tagu `operator`; čo sa
  // nedalo pozorovať, tu nie je. Hranice slova \b len okolo krátkych latinkových
  // tokenov — bez nich by 'grtg' chytilo francúzsky GRTgaz, 'gail' Gailtalbahn
  // a Gaildorf, 'moge' Limoges a 'kar group' Hawkar Group.
  'sonatrach', 'سوناطراك', String.raw`\bgrtg\b`, 'dolphin energy', String.raw`\bkar group\b`, String.raw`\bnigc\b`,
  String.raw`\bgail\b`, String.raw`\biocl\b`, 'indian oil', 'petronas gas', 'perta arun',
  String.raw`\bmoge\b`, 'trans thai-malaysia', '国家管网',
  // Irán: `operator` sa tam systematicky používa ako POPIS trasy, nie ako firma.
  // Bez týchto dvoch nechytíme napr. 505 km plynovod Mier (خط لوله گاز صلح).
  'لوله گاز', 'انتقال گاز',
].join('|'), 'i');

/**
 * Prečo úsek patrí do prepravnej siete (alebo null = von).
 * Logika aj čítanie priemeru žijú v scripts/lib/pipelineTags.mjs, aby ich ropný
 * build nemusel kopírovať — `diameterMm` mala chybu v čítaní palcov a dva domovy
 * pre jeden defekt sú presne to, čomu sa vyhýbame.
 */
// Tá istá diera ako pri rope: členská cesta relácie má vlastnú látku.
// substance=cng je stlačený zemný plyn a v snímku je jedna taká cesta —
// necháva sa, aby oprava nemenila výstup; ide o uzavretie diery, nie
// o prefiltrovanie snímku.
const GAS_SUBSTANCE_RE = /^(gas|natural_gas|cng)$/i;
export const classifyPipeline = makeClassifier({ excludedUsage: EXCLUDED_USAGE, operatorRe: TSO_RE, substanceRe: GAS_SUBSTANCE_RE });

/**
 * Všetky kandidátske úseky (prepravné, alebo bez `usage` s priemerom, menom
 * či prevádzkovateľom — o zaradení rozhodne classifyPipeline) + členské úseky
 * plynových relácií route=pipeline (dlhé trasy); relácie samotné idú
 * s členstvom (`out body`), aby úseky zdedili meno a prevádzkovateľa.
 */
const buildQuery = ([S, W, N, E]) => `[out:json][timeout:300][bbox:${S},${W},${N},${E}];
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

await buildPipelineSnapshot({
  label: 'gas',
  tiles: TILES,
  queryVersion: QUERY_VERSION,
  cacheDir: CACHE_DIR,
  rawDir: RAW_DIR,
  outFile: path.join(CACHE_DIR, 'pipelines.geojsonl'),
  metaFile: path.join(CACHE_DIR, 'pipelines.meta.json'),
  buildQuery,
  classify: classifyPipeline,
  queryDescription: `${QUERY_VERSION}: way[man_made=pipeline][substance~gas] with usage=transmission, or no usage + (diameter|name|operator), plus members of rel[route=pipeline][substance~gas]; kept by classifyPipeline`,
  overpassUrl: OVERPASS_URL,
  userAgent: USER_AGENT,
  refresh: REFRESH,
});
