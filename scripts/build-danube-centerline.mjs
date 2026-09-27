// OKO — build the DANUBE centreline snapshot used to orient moored vessels (2026-09-27).
//
// Vlastník: „začni a poctivo" (body 1–3 k siluetám lodí). Stojace riečne lode väčšinou nehlásia
// smer prídi (heading null) a ich COG pri nulovej rýchlosti je šum (DOBRA 355°, HARMONIA 287°,
// SARIS 193° vedľa seba pri tom istom nábreží). Lode, ktoré heading hlásia (Vikingy, AMADEUS
// AUREA), stoja v Bratislave na 268–273° — prídou PROTI PRÚDU, ako sa riečne lode vyväzujú.
// Runtime (src/data/riverDirection.js) preto stojacej lodi bez headingu pri Dunaji dá smer proti
// prúdu z najbližšieho úseku osi rieky.
//
// Zdroj: OpenStreetMap, relácia 89652 (Danube), všetky členské cesty `waterway=river`. OSM kreslí
// vodné toky V SMERE TOKU (konvencia wiki Key:waterway), takže každý úsek nesie smer po prúde
// bez skladania do jednej čiary. Zjednodušenie Douglas–Peucker ~30 m, súradnice na 5 desatinných.
//
// Výstup: src/data/local_data/rivers/danube.json (+ README.md). Licencia ODbL 1.0,
// © OpenStreetMap contributors (DATA_SOURCES.md).
//
// Usage:
//   node scripts/build-danube-centerline.mjs            # použije uloženú surovú odpoveď, ak je
//   node scripts/build-danube-centerline.mjs --refresh  # stiahne znova (jedna otázka na Overpass)
//
// Slušne k Overpassu: ručný, občasný build — nikdy automaticky; surová odpoveď sa ukladá.
import fs from 'node:fs';
import path from 'node:path';

import { simplify } from './lib/pipelineSnapshot.mjs';

const OVERPASS_URL = process.env.OVERPASS_URL || 'https://maps.mail.ru/osm/tools/overpass/api/interpreter';
const REFRESH = process.argv.includes('--refresh');
const RELATION_ID = 89652;
const CACHE_DIR = path.join(process.cwd(), '.gev-cache', 'rivers');
const RAW_FILE = path.join(CACHE_DIR, 'danube-raw.json');
const OUT_DIR = path.join(process.cwd(), 'src', 'data', 'local_data', 'rivers');
const OUT_FILE = path.join(OUT_DIR, 'danube.json');
const USER_AGENT = 'OKO-river-build/0.1 (https://oko.uhrin.digital) one-off manual snapshot';
/** ~30 m v stupňoch (zemepisná šírka); na 48° s. š. je dĺžka o tretinu presnejšia — stačí. */
const SIMPLIFY_DEG = 0.00027;

const QUERY = `[out:json][timeout:300];rel(${RELATION_ID});way(r)["waterway"="river"];out geom;`;

async function loadRaw() {
  if (!REFRESH && fs.existsSync(RAW_FILE)) return JSON.parse(fs.readFileSync(RAW_FILE, 'utf8'));
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    body: new URLSearchParams({ data: QUERY }),
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const raw = await res.json();
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(RAW_FILE, JSON.stringify(raw));
  return raw;
}

const round5 = (v) => Math.round(v * 1e5) / 1e5;

const raw = await loadRaw();
const ways = (raw.elements || []).filter((e) => e.type === 'way' && Array.isArray(e.geometry) && e.geometry.length >= 2);
const lines = [];
let rawPoints = 0;
for (const way of ways) {
  const coords = way.geometry.map((p) => [p.lon, p.lat]);
  rawPoints += coords.length;
  const simple = simplify(coords, SIMPLIFY_DEG).map(([lon, lat]) => [round5(lon), round5(lat)]);
  if (simple.length >= 2) lines.push(simple);
}
const points = lines.reduce((n, l) => n + l.length, 0);

// Kontrola smeru: v Bratislave tečie Dunaj na východ — úseky tam musia ísť prevažne na východ.
let east = 0; let west = 0;
for (const line of lines) {
  for (let i = 1; i < line.length; i++) {
    const [lon, lat] = line[i];
    if (lat < 48.10 || lat > 48.18 || lon < 17.0 || lon > 17.3) continue;
    if (line[i][0] > line[i - 1][0]) east += 1; else west += 1;
  }
}
if (!(east > west * 3)) throw new Error(`smer toku v Bratislave nesedí (na východ ${east}, na západ ${west}) — OSM ways nie sú po prúde?`);

const out = {
  source: `OpenStreetMap relation ${RELATION_ID} (Danube), member ways waterway=river, drawn downstream`,
  license: 'ODbL 1.0 — © OpenStreetMap contributors',
  snapshot: raw.osm3s?.timestamp_osm_base || null,
  simplifyDeg: SIMPLIFY_DEG,
  ways: lines.length,
  points,
  lines,
};
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(out));
console.log(`danube: ${ways.length} ways, ${rawPoints} → ${points} points, ${(fs.statSync(OUT_FILE).size / 1024).toFixed(0)} KB, BA segments east ${east} / west ${west}, snapshot ${out.snapshot}`);
