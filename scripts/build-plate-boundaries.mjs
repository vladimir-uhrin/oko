// Hranice litosférických platní pre vrstvu zemetrasení (2026-11-06).
// Vstup: PB2002_boundaries.json z https://github.com/fraxen/tectonicplates (GeoJSON/PB2002_boundaries.json),
// konverzia datasetu Peter Bird (2003), licencia ODC-By 1.0. Výstup: kompaktný JS modul
// src/data/local_data/plates/pb2002Boundaries.js (načíta sa až po zapnutí čipu Platne).
// Použitie: node scripts/build-plate-boundaries.mjs <cesta k PB2002_boundaries.json>
import fs from 'node:fs';
import path from 'node:path';

const input = process.argv[2];
if (!input) { console.error('usage: node scripts/build-plate-boundaries.mjs <PB2002_boundaries.json>'); process.exit(2); }
const json = JSON.parse(fs.readFileSync(input, 'utf8'));
const round = (v) => Math.round(v * 1000) / 1000;
const lines = [];
for (const feature of json.features || []) {
  if (feature?.geometry?.type !== 'LineString') continue;
  const coords = [];
  let prev = null;
  for (const [lon, lat] of feature.geometry.coordinates) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const point = [round(lon), round(lat)];
    if (prev && prev[0] === point[0] && prev[1] === point[1]) continue;
    coords.push(point[0], point[1]);
    prev = point;
  }
  if (coords.length < 4) continue;
  const name = String(feature.properties?.Name || '').replace(/[^A-Za-z0-9\/\-]/g, '').slice(0, 12);
  lines.push({ n: name, s: feature.properties?.Type === 'subduction' ? 1 : 0, c: coords });
}
const out = path.resolve('src/data/local_data/plates/pb2002Boundaries.js');
const header = `// VYGENEROVANÉ scripts/build-plate-boundaries.mjs (${new Date().toISOString().slice(0, 10)}) — nemeniť ručne.\n`
  + '// PB2002 (Peter Bird 2003, doi:10.1029/2001GC000252) cez fraxen/tectonicplates (Hugo Ahlenius, Nordpil), ODC-By 1.0.\n'
  + '// n = hranica (platňa-platňa), s = 1 subdukčná zóna, c = [dĺžka, šírka, …] v stupňoch.\n';
fs.writeFileSync(out, `${header}export const PB2002_BOUNDARIES = ${JSON.stringify(lines)};\n`);
console.log(`${lines.length} čiar, ${lines.reduce((n, l) => n + l.c.length / 2, 0)} bodov → ${out} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
