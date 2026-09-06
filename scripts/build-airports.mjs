// OKO — bake the bundled global airports snapshot (OurAirports, public domain).
//
// Two outputs in src/data/local_data/airports/:
//   airports.geojsonl      the ambient point layer (large/medium + scheduled small)
//   airport-details.json   per-airport sidecar for the click card: radio
//                          frequencies (airport-frequencies.csv), runways
//                          (runways.csv), region/GPS/local codes and links
//                          (home_link, wikipedia_link from airports.csv).
//                          Loaded lazily on the first airport selection.
//
// All three CSVs come from the canonical OurAirports data repo (public domain,
// see local_data/airports/README.md). Manual step, never CI:
//   node scripts/build-airports.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { csvObjects, parseCsv } from './lib/parse-csv.mjs';
import {
  AIRPORT_DETAILS_FILE,
  airportDetailsFromRows,
  airportFeatureFromRow,
  airportRowAccepted,
} from '../src/data/airportsData.js';

const BASE = 'https://davidmegginson.github.io/ourairports-data/';
const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/data/local_data/airports');
const OUT_FILE = path.join(OUT_DIR, 'airports.geojsonl');
const OUT_DETAILS = path.join(OUT_DIR, AIRPORT_DETAILS_FILE);

async function fetchCsv(name) {
  const response = await fetch(`${BASE}${name}`, { headers: { 'User-Agent': 'oko-airports-snapshot/1.1' } });
  if (!response.ok) throw new Error(`${name} HTTP ${response.status}`);
  return csvObjects(parseCsv(await response.text())).objects;
}

const [airportRows, frequencyRows, runwayRows] = await Promise.all([
  fetchCsv('airports.csv'), fetchCsv('airport-frequencies.csv'), fetchCsv('runways.csv'),
]);

let seen = 0;
const counts = { large: 0, medium: 0, small: 0 };
const lines = [];
const accepted = new Map(); // ident → airports.csv row
for (const row of airportRows) {
  seen += 1;
  if (!airportRowAccepted(row)) continue;
  const feature = airportFeatureFromRow(row);
  if (!feature) continue;
  counts[feature.properties.type] = (counts[feature.properties.type] || 0) + 1;
  lines.push(JSON.stringify(feature));
  accepted.set(feature.id, row);
}

const groupBy = (rows) => {
  const map = new Map();
  for (const r of rows) {
    const ident = String(r.airport_ident || '').trim();
    if (!accepted.has(ident)) continue;
    if (!map.has(ident)) map.set(ident, []);
    map.get(ident).push(r);
  }
  return map;
};
const freqByIdent = groupBy(frequencyRows);
const rwyByIdent = groupBy(runwayRows);

const details = {};
let withFreq = 0, withRwy = 0, freqCount = 0, rwyCount = 0;
for (const [ident, row] of accepted) {
  const d = airportDetailsFromRows(row, freqByIdent.get(ident) || [], rwyByIdent.get(ident) || []);
  if (d.freq.length) { withFreq += 1; freqCount += d.freq.length; }
  if (d.rwy.length) { withRwy += 1; rwyCount += d.rwy.length; }
  details[ident] = d;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, `${lines.join('\n')}\n`);
fs.writeFileSync(OUT_DETAILS, JSON.stringify({
  source: 'OurAirports (airports.csv, airport-frequencies.csv, runways.csv)',
  license: 'Public domain (Unlicense)',
  built: new Date().toISOString().split('T')[0],
  airports: details,
}));
const sizeKb = Math.round(fs.statSync(OUT_FILE).size / 1024);
const detailsKb = Math.round(fs.statSync(OUT_DETAILS).size / 1024);
console.log(`airports.csv riadkov: ${seen}`);
console.log(`bundel: ${lines.length} letísk (large ${counts.large}, medium ${counts.medium}, small ${counts.small}) — ${sizeKb} KB`);
console.log(`details: ${withFreq} letísk s frekvenciami (${freqCount} riadkov), ${withRwy} s dráhami (${rwyCount}) — ${detailsKb} KB`);
for (const probe of ['LZIB', 'LZKZ', 'LZTT', 'LZZI']) {
  const hit = lines.some((line) => line.includes(`"id":"${probe}"`));
  const d = details[probe];
  console.log(`${probe}: ${hit ? 'OK' : 'CHÝBA!'} — freq ${d?.freq.length ?? 0}, rwy ${d?.rwy.length ?? 0}, wiki ${d?.wiki ? 'áno' : 'nie'}`);
}
