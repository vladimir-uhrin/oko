// OKO — build the bundled global ports snapshot (World Port Index).
//
// Fetches NGA's Pub 150 CSV (US government work, public domain — see the
// folder README), maps it through src/data/portsData.js and writes
// src/data/local_data/ports/ports.geojsonl. Manual, occasional build step —
// the WPI updates on a slow cadence; never an automated/CI fetch.
//
// Usage:
//   node scripts/build-ports.mjs            # stiahne CSV
//   WPI_CSV=path node scripts/build-ports.mjs  # použije lokálny súbor
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { csvObjects, parseCsv } from './lib/parse-csv.mjs';
import { portFeatureFromRow, portRowAccepted } from '../src/data/portsData.js';

const CSV_URL = 'https://msi.nga.mil/api/publications/download?type=view&key=16920959/SFH00000/UpdatedPub150.csv';
const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/data/local_data/ports');
const OUT_FILE = path.join(OUT_DIR, 'ports.geojsonl');

let csv;
if (process.env.WPI_CSV) {
  csv = fs.readFileSync(process.env.WPI_CSV, 'utf8');
} else {
  const response = await fetch(CSV_URL, { headers: { 'User-Agent': 'oko-ports-snapshot/1.0' } });
  if (!response.ok) throw new Error(`UpdatedPub150.csv HTTP ${response.status}`);
  csv = await response.text();
}

const { header, objects } = csvObjects(parseCsv(csv));
for (const required of ['Main Port Name', 'UN/LOCODE', 'Harbor Size', 'Latitude', 'Longitude']) {
  if (!header.includes(required)) {
    throw new Error(`WPI CSV bez stĺpca "${required}" — headers: ${header.slice(0, 40).join(' | ')}`);
  }
}

let seen = 0;
const sizes = {};
const lines = [];
for (const row of objects) {
  seen += 1;
  if (!portRowAccepted(row)) continue;
  const feature = portFeatureFromRow(row);
  if (!feature) continue;
  const size = feature.properties.size ?? 'Unknown';
  sizes[size] = (sizes[size] || 0) + 1;
  lines.push(JSON.stringify(feature));
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, `${lines.join('\n')}\n`);
const sizeKb = Math.round(fs.statSync(OUT_FILE).size / 1024);
console.log(`WPI riadkov: ${seen}`);
console.log(`bundel: ${lines.length} prístavov — ${sizeKb} KB`);
console.log('veľkosti:', JSON.stringify(sizes));
for (const probe of ['Rotterdam', 'Constanta', 'Hamburg', 'Koper']) {
  const hit = lines.some((line) => line.includes(`"name":"${probe}"`));
  console.log(`${probe}: ${hit ? 'OK' : 'CHÝBA!'}`);
}
