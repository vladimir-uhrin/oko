// OKO — bake the bundled volcano sidecar from OpenStreetMap (ODbL 1.0).
//
// Output: src/data/local_data/volcanoes/osm-volcanoes.json — every named
// `natural=volcano` node worldwide with the fields the volcano card needs:
// name (English when tagged), position, elevation, volcano:type,
// volcano:status, Wikipedia article. Joined at runtime to NASA EONET events by
// proximity + name (src/data/volcanoInfo.js). Smithsonian GVP was considered
// and rejected: its terms allow non-commercial use only (2026-09-05).
//
// Manual step, never CI. Overpass fair-use: one request, identifying UA.
//   node scripts/build-volcanoes.mjs            # fetch from Overpass
//   node scripts/build-volcanoes.mjs --from f   # reuse a saved Overpass JSON
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/data/local_data/volcanoes');
const OUT_FILE = path.join(OUT_DIR, 'osm-volcanoes.json');
const QUERY = '[out:json][timeout:160];node[natural=volcano][name];out tags center;';

async function load() {
  const i = process.argv.indexOf('--from');
  if (i > 0 && process.argv[i + 1]) return JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8'));
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'oko-volcanoes-snapshot/1.0' },
    body: 'data=' + encodeURIComponent(QUERY),
  });
  if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
  return response.json();
}

const clean = (v) => (v === undefined || v === null ? '' : String(v).trim());
const num = (v) => { const cleaned = String(v ?? '').replace(/[^0-9.+-]/g, ''); if (!cleaned) return null; const n = Number(cleaned); return Number.isFinite(n) ? n : null; };

const raw = await load();
const records = [];
for (const el of raw.elements || []) {
  const tags = el.tags || {};
  const lat = Number(el.lat ?? el.center?.lat), lon = Number(el.lon ?? el.center?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  const name = clean(tags['name:en']) || clean(tags.name);
  if (!name) continue;
  const rec = { id: el.id, name, lat: Number(lat.toFixed(4)), lon: Number(lon.toFixed(4)) };
  if (clean(tags.name) && clean(tags.name) !== name) rec.localName = clean(tags.name);
  const ele = num(tags.ele); if (ele !== null && Math.abs(ele) < 9000) rec.eleM = Math.round(ele);
  const type = clean(tags['volcano:type']).toLowerCase(); if (type) rec.type = type;
  const status = clean(tags['volcano:status']).toLowerCase(); if (status) rec.status = status;
  const wiki = clean(tags['wikipedia:en'] ? `en:${tags['wikipedia:en']}` : tags.wikipedia); if (/^[a-z]{2,3}:/.test(wiki)) rec.wikipedia = wiki;
  if (clean(tags.wikidata)) rec.wikidata = clean(tags.wikidata);
  const desc = clean(tags.description); if (desc) rec.description = desc.slice(0, 200);
  records.push(rec);
}
records.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify({
  source: 'OpenStreetMap contributors (Overpass API), ODbL 1.0',
  query: QUERY,
  builtAt: new Date().toISOString().slice(0, 10),
  osmBase: raw.osm3s?.timestamp_osm_base || null,
  volcanoes: records,
}));
const stat = fs.statSync(OUT_FILE);
console.log(`osm-volcanoes.json: ${records.length} volcanoes, ${(stat.size / 1024).toFixed(0)} kB; ele ${records.filter((r) => r.eleM != null).length}, type ${records.filter((r) => r.type).length}, wikipedia ${records.filter((r) => r.wikipedia).length}`);
