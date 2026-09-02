// OKO — build the bundled global airports snapshot (letecký balík 2).
//
// Fetches OurAirports' airports.csv (public domain / Unlicense — see the
// folder README), filters it through src/data/airportsData.js (large +
// medium always, small only with scheduled service, closed excluded) and
// writes src/data/local_data/airports/airports.geojsonl — one feature per
// line, the same shape as the other bundled datasets.
//
// Usage:
//   node scripts/build-airports.mjs
//
// Manual, occasional build step — OurAirports regenerates daily but airport
// openings happen on the timescale of months; never an automated/CI fetch.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { airportFeatureFromRow, airportRowAccepted } from '../src/data/airportsData.js';

const CSV_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/data/local_data/airports');
const OUT_FILE = path.join(OUT_DIR, 'airports.geojsonl');

/**
 * Minimal RFC-4180 CSV parser. The name/keywords/municipality columns are
 * quoted and can contain commas and doubled quotes — naive split corrupts
 * them (the repo rule from the WPI/OurAirports research: always a real
 * parser, never String.split(',')).
 * @param {string} text Whole CSV body.
 * @returns {string[][]}
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const response = await fetch(CSV_URL, { headers: { 'User-Agent': 'oko-airports-snapshot/1.0' } });
if (!response.ok) throw new Error(`airports.csv HTTP ${response.status}`);
const csv = await response.text();
const rows = parseCsv(csv);
const header = rows.shift();
const toObject = (cells) => Object.fromEntries(header.map((key, i) => [key, cells[i] ?? '']));

let seen = 0;
const counts = { large: 0, medium: 0, small: 0 };
const lines = [];
for (const cells of rows) {
  seen += 1;
  const row = toObject(cells);
  if (!airportRowAccepted(row)) continue;
  const feature = airportFeatureFromRow(row);
  if (!feature) continue;
  counts[feature.properties.type] = (counts[feature.properties.type] || 0) + 1;
  lines.push(JSON.stringify(feature));
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, `${lines.join('\n')}\n`);
const sizeKb = Math.round(fs.statSync(OUT_FILE).size / 1024);
console.log(`airports.csv riadkov: ${seen}`);
console.log(`bundel: ${lines.length} letísk (large ${counts.large}, medium ${counts.medium}, small ${counts.small}) — ${sizeKb} KB`);
for (const probe of ['LZIB', 'LZKZ', 'LZTT', 'LZZI']) {
  const hit = lines.some((line) => line.includes(`"id":"${probe}"`));
  console.log(`${probe}: ${hit ? 'OK' : 'CHÝBA!'}`);
}
