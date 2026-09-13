// OKO — build the LNG carrier allowlist from Wikidata (modul PLYN, etapa 8,
// 2026-09-13; používateľ: „LNG flotila cez AIS").
//
// Wikidata items that are instances of (a subclass of) „LNG carrier" (Q15247)
// and carry an IMO number (P458) — optionally MMSI (P587), overall length
// (P2043), inception (P571), operator (P137), flag (P8047). CC0 1.0, so the
// list is bundled in src/data/local_data/lng_fleet/lng-carriers.json and used
// by src/data/lngFleet.js to CONFIRM an AIS contact as an LNG carrier (IMO
// or MMSI match); contacts outside the list are only ever „likely" via
// name / destination / size heuristics. A manual, occasional build — the
// fleet changes on the timescale of months.
//
// Usage: node scripts/build-lng-fleet.mjs
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.join(process.cwd(), 'src', 'data', 'local_data', 'lng_fleet');
const OUT_FILE = path.join(OUT_DIR, 'lng-carriers.json');
const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'OKO-gas-build/0.1 (https://github.com/vladouh76; vladouh76@gmail.com) one-off manual snapshot';
const QUERY = `SELECT ?ship ?shipLabel ?imo ?mmsi ?len ?inception ?operatorLabel ?flagLabel WHERE {
  ?ship wdt:P31/wdt:P279* wd:Q15247 ; wdt:P458 ?imo .
  OPTIONAL { ?ship wdt:P587 ?mmsi }
  OPTIONAL { ?ship wdt:P2043 ?len }
  OPTIONAL { ?ship wdt:P571 ?inception }
  OPTIONAL { ?ship wdt:P137 ?operator }
  OPTIONAL { ?ship wdt:P8047 ?flag }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}`;

const started = Date.now();
const url = `${ENDPOINT}?query=${encodeURIComponent(QUERY)}`;
const res = await fetch(url, { headers: { Accept: 'application/sparql-results+json', 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(180_000) });
if (!res.ok) throw new Error(`Wikidata SPARQL HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
const json = await res.json();
const byImo = new Map();
for (const b of json.results.bindings) {
  const imo = String(b.imo?.value || '').replace(/\D/g, '');
  if (!/^\d{7}$/.test(imo)) continue;
  const label = String(b.shipLabel?.value || '').trim();
  const name = /^Q\d+$/.test(label) ? null : label;
  const prev = byImo.get(imo) || { imo, qid: String(b.ship.value).split('/').pop(), name, mmsi: [], lengthM: null, built: null, operator: null, flag: null };
  const mmsi = String(b.mmsi?.value || '').replace(/\D/g, '');
  if (/^\d{9}$/.test(mmsi) && !prev.mmsi.includes(mmsi)) prev.mmsi.push(mmsi);
  const len = Number(b.len?.value);
  if (Number.isFinite(len) && len > 0) prev.lengthM = Math.round(len * 10) / 10;
  if (b.inception?.value) prev.built = String(b.inception.value).slice(0, 4);
  if (b.operatorLabel?.value && !/^Q\d+$/.test(b.operatorLabel.value)) prev.operator = b.operatorLabel.value;
  if (b.flagLabel?.value && !/^Q\d+$/.test(b.flagLabel.value)) prev.flag = b.flagLabel.value;
  if (!prev.name && name) prev.name = name;
  byImo.set(imo, prev);
}
const ships = [...byImo.values()].sort((a, b) => a.imo.localeCompare(b.imo));
fs.mkdirSync(OUT_DIR, { recursive: true });
const out = {
  snapshot: new Date().toISOString(),
  source: 'Wikidata (SPARQL): instances of LNG carrier (Q15247) with an IMO number',
  license: 'CC0 1.0 — Wikidata',
  query: QUERY.replace(/\s+/g, ' ').trim(),
  ships: ships.length,
  withMmsi: ships.filter((s) => s.mmsi.length).length,
  rows: ships,
};
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 1), 'utf8');
console.log(`lng-carriers.json: ${ships.length} ships with IMO (${out.withMmsi} with MMSI) from ${json.results.bindings.length} rows in ${((Date.now() - started) / 1000).toFixed(1)} s`);
