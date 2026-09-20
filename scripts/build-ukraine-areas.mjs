// scripts/build-ukraine-areas.mjs
// Plochy OSM pre kartografický režim KARTA (etapa K2): zástavba, lesy, vodné
// plochy a železnice po dlaždiciach 1°×1° nad oknami smerov frontu
// (src/ukraineFrontScenes.js). Výstup:
//   .gev-cache/ukraine/base/areas/<N48E037>.json   kompaktné polygóny dlaždice
//   .gev-cache/ukraine/base/areas/meta.json        zoznam dlaždíc + počty + dátum
//   .gev-cache/ukraine/osm-raw/areas/<key>-v1.json  surová odpoveď (opakovanie bez siete)
// Spustenie:
//   node scripts/build-ukraine-areas.mjs                 # všetky dlaždice od Donbasu von
//   node scripts/build-ukraine-areas.mjs --tiles N48E037,N48E038
//   node scripts/build-ukraine-areas.mjs --limit 4 --refresh
//   node scripts/build-ukraine-areas.mjs --list
// Overpass etiketa ako pri build-ukraine-base.mjs: jeden dopyt naraz, 30 s pauza
// medzi živými dopytmi, 429/504 = 90 s čakanie a ďalší server. Dopyt na dlaždicu
// (`out geom` na lesy) trvá 1–4 min a vracia 20–40 MB — preto raw cache.
import fs from 'node:fs';
import path from 'node:path';
import { listFrontScenes } from '../src/ukraineFrontScenes.js';
import { AREAS_QUERY_VERSION, buildAreasQuery, elementsToAreas, isTileKey, tileBbox, tilesForScenes } from './lib/ukraineAreas.mjs';

const ENDPOINTS = process.env.OVERPASS_URL
  ? [process.env.OVERPASS_URL]
  : ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const OUT_DIR = path.join(process.cwd(), '.gev-cache', 'ukraine', 'base', 'areas');
const RAW_DIR = path.join(process.cwd(), '.gev-cache', 'ukraine', 'osm-raw', 'areas');
const USER_AGENT = 'OKO-ukraine-build/0.1 (https://github.com/vladouh76; vladouh76@gmail.com) one-off manual snapshot';
const PAUSE_MS = 30_000;
const RATE_LIMIT_WAIT_MS = 90_000;
const REFRESH = process.argv.includes('--refresh');
const argValue = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; };

let lastLiveAt = 0;
async function fetchOverpass(name, query) {
  const rawPath = path.join(RAW_DIR, `${name}-${AREAS_QUERY_VERSION}.json`);
  if (!REFRESH && fs.existsSync(rawPath)) {
    console.log(`  ${name}: raw cache`);
    return JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  }
  let lastError = null;
  for (let round = 1; round <= 3; round += 1) {
    for (const endpoint of ENDPOINTS) {
      const wait = PAUSE_MS - (Date.now() - lastLiveAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const started = Date.now();
      lastLiveAt = started;
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(420_000),
        });
        const text = await res.text();
        if (!res.ok || !text.startsWith('{')) {
          const error = new Error(`HTTP ${res.status}: ${text.slice(0, 160).replace(/\s+/g, ' ')}`);
          error.rateLimited = res.status === 429 || res.status === 504 || res.status === 502;
          throw error;
        }
        const json = JSON.parse(text);
        if (json.remark) throw new Error(`remark: ${json.remark}`);
        fs.mkdirSync(RAW_DIR, { recursive: true });
        fs.writeFileSync(rawPath, text, 'utf8');
        console.log(`  ${name}: ${(json.elements || []).length} elements, ${(text.length / 1e6).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(0)} s via ${new URL(endpoint).host}`);
        return json;
      } catch (error) {
        lastError = error;
        console.error(`  ${name}: ${new URL(endpoint).host} failed (round ${round}/3): ${error?.message || error}`);
        if (error?.rateLimited) await new Promise((r) => setTimeout(r, RATE_LIMIT_WAIT_MS));
      }
    }
  }
  throw new Error(`Overpass failed for ${name}: ${lastError?.message || lastError}`);
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), 'utf8');
  fs.renameSync(tmp, file);
}
function readMeta() {
  try { return JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'meta.json'), 'utf8')); } catch { return null; }
}

const all = tilesForScenes(listFrontScenes());
const wanted = argValue('--tiles') ? argValue('--tiles').split(',').map((s) => s.trim()).filter(isTileKey).map((key) => ({ key, bbox: tileBbox(key), scenes: [] })) : all;
const limit = Number(argValue('--limit')) || Infinity;
if (process.argv.includes('--list')) {
  for (const t of all) console.log(`${t.key} ${t.bbox.join(',')} ${t.scenes.join('/')}${fs.existsSync(path.join(OUT_DIR, `${t.key}.json`)) ? ' (hotová)' : ''}`);
  process.exit(0);
}
console.log(`UKRAJINA plochy K2: ${wanted.length} dlaždíc (${all.length} nad oknami smerov) via ${ENDPOINTS.map((e) => new URL(e).host).join(' → ')}${REFRESH ? ' (refresh)' : ''}`);
let done = 0;
for (const tile of wanted) {
  if (done >= limit) break;
  const outFile = path.join(OUT_DIR, `${tile.key}.json`);
  if (!REFRESH && fs.existsSync(outFile)) { console.log(`${tile.key}: hotová, preskakujem`); continue; }
  console.log(`${tile.key} [${tile.bbox.join(', ')}] ${tile.scenes.join('/')}`);
  let raw;
  try { raw = await fetchOverpass(`areas-${tile.key}`, buildAreasQuery(tile.bbox)); } catch (error) { console.error(`${tile.key}: ${error.message} — pokračujem ďalšou`); continue; }
  const areas = elementsToAreas(raw.elements || [], { bbox: tile.bbox });
  const record = { key: tile.key, bbox: tile.bbox, queryVersion: AREAS_QUERY_VERSION, builtAt: new Date().toISOString(), source: 'OpenStreetMap contributors via Overpass API', license: 'ODbL 1.0', counts: areas.counts, dropped: areas.dropped, built: areas.built, forest: areas.forest, water: areas.water, rail: areas.rail };
  writeJsonAtomic(outFile, record);
  const bytes = fs.statSync(outFile).size;
  const meta = readMeta() || { kind: 'ukraine-areas', queryVersion: AREAS_QUERY_VERSION, snapshot: new Date().toISOString(), source: 'OpenStreetMap contributors via Overpass API', license: 'ODbL 1.0', attribution: '© OpenStreetMap contributors', classes: ['built', 'forest', 'water', 'rail'], tiles: {} };
  meta.tiles[tile.key] = { bbox: tile.bbox, counts: areas.counts, bytes, builtAt: record.builtAt };
  meta.updatedAt = record.builtAt;
  meta.tileCount = Object.keys(meta.tiles).length;
  writeJsonAtomic(path.join(OUT_DIR, 'meta.json'), meta);
  console.log(`  → ${tile.key}.json ${(bytes / 1e6).toFixed(1)} MB · ${JSON.stringify(areas.counts)} · zahodené ${JSON.stringify(areas.dropped)}`);
  done += 1;
}
console.log(`hotovo: ${done} nových dlaždíc, meta má ${readMeta()?.tileCount ?? 0}`);
