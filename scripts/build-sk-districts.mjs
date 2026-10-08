// scripts/build-sk-districts.mjs
// Polygóny 79 okresov SR pre výstrahy SHMÚ (2026-10-08). Zdroj: geoBoundaries gbOpen SVK ADM2
// (OpenStreetMap, ODbL 1.0), zjednodušená verzia:
//   https://www.geoboundaries.org/api/current/gbOpen/SVK/ADM2/ → simplifiedGeometryGeoJSON
// Mená v súbore majú poškodenú diakritiku („District of Kolice I"), preto sa polygón priraďuje
// oficiálnemu kódu (src/data/skDistricts.js) bodom sídla okresu v polygóne (GeoNames SK.txt) a mestské
// okresy Bratislava I–V / Košice I–IV a Košice-okolie podľa rímskeho čísla / „okolie" v mene.
// Výstup: public/meteo-warnings/sk-okresy.json = { "<kód>": { name, rings: [[[lon,lat]…]…] } } + SOURCE.md.
//   node scripts/build-sk-districts.mjs <geoBoundaries-SVK-ADM2_simplified.geojson> <GeoNames SK.txt>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SK_DISTRICTS, foldName } from '../src/data/skDistricts.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [geoPath, skPath] = process.argv.slice(2);
if (!geoPath || !skPath) { console.error('použitie: node scripts/build-sk-districts.mjs ADM2_simplified.geojson SK.txt'); process.exit(2); }

const geo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));
const round = (v) => Math.round(v * 1e4) / 1e4;
const polys = geo.features.map((f) => {
  const g = f.geometry;
  const parts = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  return { name: f.properties.shapeName, parts };
});

// Sídla okresov z GeoNames (najväčšie sídlo s tým menom, trieda P).
const seats = new Map();
for (const line of fs.readFileSync(skPath, 'utf8').split('\n')) {
  const c = line.split('\t');
  if (c.length < 15 || c[6] !== 'P') continue;
  const key = foldName(c[1]);
  const pop = Number(c[14]) || 0;
  const prev = seats.get(key);
  if (!prev || pop > prev.pop) seats.set(key, { lat: Number(c[4]), lon: Number(c[5]), pop });
}

function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPoly = (p, lon, lat) => p.parts.some((rings) => inRing(lon, lat, rings[0]) && !rings.slice(1).some((h) => inRing(lon, lat, h)));

const out = {};
const used = new Set();
// Mená v súbore sú poškodené a často skrátené („Liptovsk", „Pilina" = Žilina) — vzdialenosť mien
// porovná len rovnako dlhú predponu. Sídlo v polygóne je druhé kritérium (zjednodušená hranica
// môže sídlo pri okraji okresu „presunúť" do suseda — Komárno), preto len zníži skóre.
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) for (let j = 1; j <= b.length; j += 1) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const shortName = (p) => foldName(p.name.replace(/^District of /, '').replace(/\*$/, ''));
const assign = (code, name, idx) => {
  if (idx < 0) throw new Error(`okres ${code} ${name}: polygón nenájdený`);
  if (used.has(idx)) throw new Error(`okres ${code} ${name}: polygón ${polys[idx].name} už použitý`);
  used.add(idx);
  if (process.env.DEBUG) console.log(code, name, '←', polys[idx].name);
  out[code] = { name, rings: polys[idx].parts.map((rings) => rings[0].map(([x, y]) => [round(x), round(y)])) };
};
// 1) mestské okresy a Košice-okolie podľa čísla / „okolie"
for (const [code, name, seat] of SK_DISTRICTS) {
  if (seat) continue;
  let idx;
  if (code === '806') idx = polys.findIndex((p) => /okolie/i.test(p.name));
  else {
    const roman = /\s(I|II|III|IV|V)$/.exec(name)[1];
    const city = name.startsWith('Bratislava') ? /bratislava/i : /^District of K\w*ice /i;
    idx = polys.findIndex((p, i) => !used.has(i) && city.test(p.name) && !/okolie/i.test(p.name) && p.name.endsWith(` ${roman}`));
  }
  assign(code, name, idx);
}
// 2) ostatné: globálne najlepšie páry (meno + sídlo)
const pairs = [];
for (const [code, name, seat] of SK_DISTRICTS) {
  if (!seat) continue;
  const s = seats.get(foldName(seat));
  if (!s) throw new Error(`sídlo ${seat} nie je v SK.txt`);
  const want = foldName(name);
  polys.forEach((p, i) => {
    if (used.has(i)) return;
    const got = shortName(p);
    const nameScore = lev(want.slice(0, got.length), got) / Math.max(1, got.length);
    pairs.push({ code, name, i, score: nameScore + (inPoly(p, s.lon, s.lat) ? 0 : 0.35) });
  });
}
pairs.sort((a, b) => a.score - b.score);
for (const pr of pairs) {
  if (out[pr.code] || used.has(pr.i)) continue;
  if (pr.score > 0.6) throw new Error(`okres ${pr.code} ${pr.name}: najlepší kandidát ${polys[pr.i].name} má skóre ${pr.score.toFixed(2)}`);
  assign(pr.code, pr.name, pr.i);
}
for (const [code, name] of SK_DISTRICTS) if (!out[code]) throw new Error(`okres ${code} ${name}: nepriradený`);
if (used.size !== polys.length) throw new Error(`nepriradené polygóny: ${polys.filter((_, i) => !used.has(i)).map((p) => p.name).join(', ')}`);

const dir = path.join(root, 'public', 'meteo-warnings');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'sk-okresy.json'), JSON.stringify(out));
fs.writeFileSync(path.join(dir, 'SOURCE.md'), `# Okresy SR pre výstrahy SHMÚ\n\nZdroj: geoBoundaries gbOpen SVK ADM2 (https://www.geoboundaries.org), dáta © prispievatelia OpenStreetMap,\nlicencia Open Data Commons Open Database License 1.0 (https://opendatacommons.org/licenses/odbl/1-0/).\nZjednodušená geometria (simplifiedGeometryGeoJSON), stiahnuté ${new Date().toISOString().slice(0, 10)}; súradnice zaokrúhlené na 4 desatinné miesta,\nbez dier (okresy SR diery nemajú). Kódy okresov ŠÚ SR priradené skriptom scripts/build-sk-districts.mjs\n(sídlo okresu z GeoNames v polygóne). Kľúč = kód okresu, hodnota = { name, rings }.\n`);
console.log(`okresy: ${Object.keys(out).length}, ${(fs.statSync(path.join(dir, 'sk-okresy.json')).size / 1024).toFixed(0)} kB`);
