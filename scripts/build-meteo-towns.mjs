// scripts/build-meteo-towns.mjs
// Mestá a dediny pre meteo mapu (2026-10-07, vlastník: „pri zoomovaní aby sa objavovali viac miest
// a dedín až po maximum, ako to má Windy"). Z GeoNames (CC BY 4.0, https://www.geonames.org/):
//   cities500.txt — svet, sídla nad 500 obyvateľov a sídla správnych celkov (~236 000),
//   SK.txt        — Slovensko celé, z neho len obce a mestá (trieda P: PPL, PPLA*, PPLC), aj bez počtu.
// Výstup do public/meteo-towns/ (servíruje dev aj statický server, do prehliadača ide len to, čo je v zábere):
//   a.json            — sídla 15 000 – 99 999 obyvateľov celého sveta (načíta sa raz pod 2 500 km),
//   b/<lat>_<lon>.json — menšie sídla v dlaždiciach 2° × 2° (načítajú sa len viditeľné, pod 400 km).
// Riadok = [meno, lat, lon, obyvatelia, slovenské meno?] (slovenské tvary: GeoNames alternateNamesV2, jazyk sk, scripts/build-sk-place-names.mjs); ne-sk.json = slovenské mená miest z places.json podľa indexu riadku. Sídla nad 100 000 a tie do 8 km od mesta z places.json
// (Natural Earth, bodky s kartou) sa vynechajú — tie majú meno už pri bodke.
//
// Spustenie (súbory stiahnuť z https://download.geonames.org/export/dump/ a rozbaliť):
//   node scripts/build-meteo-towns.mjs <cesta>/cities500.txt <cesta>/SK.txt
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLACE_CELL_DEG, PLACE_TIER_A_MIN, PLACE_TIER_A_MAX, placeCellKey } from '../src/data/meteoPlaceLabels.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [citiesPath, skPath, skNamesPath] = process.argv.slice(2);
// Voliteľne slovenské tvary mien (scripts/build-sk-place-names.mjs) — piaty prvok riadku, len ak sa líši.
const skNames = skNamesPath ? JSON.parse(fs.readFileSync(skNamesPath, 'utf8')) : {};
if (!citiesPath || !skPath) { console.error('použitie: node scripts/build-meteo-towns.mjs cities500.txt SK.txt'); process.exit(2); }

const SK_CODES = new Set(['PPL', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4', 'PPLC']);
const ne = JSON.parse(fs.readFileSync(path.join(root, 'src/data/local_data/natural_earth/places.json'), 'utf8')).places;

function nearNe(lat, lon) {
  for (const [, nlat, nlon] of ne) {
    const dLat = (lat - nlat) * 111;
    if (Math.abs(dLat) > 8) continue;
    const dLon = (lon - nlon) * 111 * Math.cos((lat * Math.PI) / 180);
    if (dLat * dLat + dLon * dLon < 64) return true;
  }
  return false;
}

const byId = new Map();
function take(file, accept) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const c = line.split('\t');
    if (c.length < 15) continue;
    const [id, name, , , latS, lonS, cls, code, country] = c;
    const pop = Number(c[14]) || 0;
    if (!accept({ cls, code, country, pop })) continue;
    const lat = Number(latS);
    const lon = Number(lonS);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const row = [name, Math.round(lat * 1000) / 1000, Math.round(lon * 1000) / 1000, pop];
    const sk = skNames[id];
    if (sk && sk !== name) row.push(sk);
    byId.set(id, row);
  }
}
take(citiesPath, () => true);
take(skPath, ({ cls, code }) => cls === 'P' && SK_CODES.has(code));

const tierA = [];
const cells = new Map();
let skipped = 0;
for (const row of byId.values()) {
  const [, lat, lon, pop] = row;
  if (pop > PLACE_TIER_A_MAX || nearNe(lat, lon)) { skipped += 1; continue; }
  if (pop >= PLACE_TIER_A_MIN) { tierA.push(row); continue; }
  const key = placeCellKey(lat, lon);
  if (!cells.has(key)) cells.set(key, []);
  cells.get(key).push(row);
}
const byPop = (a, b) => b[3] - a[3];
const outDir = path.join(root, 'public', 'meteo-towns');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 'b'), { recursive: true });
fs.writeFileSync(path.join(outDir, 'a.json'), JSON.stringify(tierA.sort(byPop)));
// Slovenské mená veľkých miest z places.json (Natural Earth má len anglické): najväčšie sídlo
// GeoNames do 20 km od mesta; { index riadku places.json: meno }.
const neSk = {};
const all = [...byId.values()];
ne.forEach(([name, lat, lon], index) => {
  let best = null;
  for (const row of all) {
    const dLat = (row[1] - lat) * 111;
    if (Math.abs(dLat) > 20) continue;
    const dLon = (row[2] - lon) * 111 * Math.cos((lat * Math.PI) / 180);
    if (dLat * dLat + dLon * dLon > 400) continue;
    if (!best || row[3] > best[3]) best = row;
  }
  // Slovenský tvar, inak meno GeoNames, ak je to to isté meno s diakritikou („Kosice" → „Košice").
  const plain = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const pick = best && (best[4] || (plain(best[0]) === plain(name) ? best[0] : null));
  if (pick && pick !== name) neSk[index] = pick;
});
fs.writeFileSync(path.join(outDir, 'ne-sk.json'), JSON.stringify(neSk));
console.log(`ne-sk.json: ${Object.keys(neSk).length} slovenských mien veľkých miest`);
let bBytes = 0;
for (const [key, rows] of cells) {
  const text = JSON.stringify(rows.sort(byPop));
  bBytes += text.length;
  fs.writeFileSync(path.join(outDir, 'b', `${key}.json`), text);
}
fs.writeFileSync(path.join(outDir, 'SOURCE.md'), `# Mestá a dediny pre meteo mapu\n\nZdroj: GeoNames (https://www.geonames.org/), licencia CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).\nSúbory cities500.txt a SK.txt z https://download.geonames.org/export/dump/ (stiahnuté ${new Date().toISOString().slice(0, 10)}).\nPostavené skriptom scripts/build-meteo-towns.mjs: a.json = ${PLACE_TIER_A_MIN}–${PLACE_TIER_A_MAX} obyvateľov, b/ = menšie sídla v dlaždiciach ${PLACE_CELL_DEG}° × ${PLACE_CELL_DEG}°. Riadok = [meno, lat, lon, obyvatelia].\n`);
console.log(`a.json: ${tierA.length} sídiel, ${(fs.statSync(path.join(outDir, 'a.json')).size / 1024).toFixed(0)} kB`);
console.log(`b/: ${cells.size} dlaždíc, ${[...cells.values()].reduce((s, r) => s + r.length, 0)} sídiel, ${(bBytes / 1024 / 1024).toFixed(1)} MB; vynechané ${skipped}`);
