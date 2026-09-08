// scripts/build-meteo-places.mjs
// Popisky miest pre meteorológiu (2026-09-08): z Natural Earth 10m populated places
// (verejná doména) vyberie mestá s pop_max ≥ 100 000 alebo hlavné mestá a uloží
// kompaktný JSON do src/data/local_data/natural_earth/places.json.
//   node scripts/build-meteo-places.mjs <cesta k ne_10m_populated_places_simple.geojson>
// Zdroj: https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_populated_places_simple.geojson
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const MIN_POP = 100_000;
const src = process.argv[2];
if (!src) { console.error('použitie: node scripts/build-meteo-places.mjs <ne_10m_populated_places_simple.geojson>'); process.exit(1); }
const geo = JSON.parse(readFileSync(src, 'utf8'));
const rows = [];
for (const f of geo.features) {
  const p = f.properties || {};
  const [lon, lat] = f.geometry?.coordinates || [];
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
  const pop = Number(p.pop_max) || 0;
  const capital = p.adm0cap === 1;
  if (pop < MIN_POP && !capital) continue;
  const name = String(p.name || p.nameascii || '').trim();
  if (!name || /Dragons/i.test(name)) continue;
  // [meno, lat, lon, populácia (tis.), scalerank, ISO2, hlavné mesto]
  rows.push([name, Number(lat.toFixed(3)), Number(lon.toFixed(3)), Math.round(pop / 1000), Number(p.scalerank) || 10, String(p.iso_a2 || ''), capital ? 1 : 0]);
}
rows.sort((a, b) => b[3] - a[3]);
const out = {
  meta: {
    source: 'Natural Earth 10m populated places (ne_10m_populated_places_simple.geojson) via github.com/nvkelso/natural-earth-vector',
    license: 'public domain (https://www.naturalearthdata.com/about/terms-of-use/)',
    fetched: new Date().toISOString(),
    curation: `pop_max >= ${MIN_POP} alebo hlavné mesto (adm0cap); polia [name, lat, lon, popThousands, scalerank, iso2, capital]`,
    count: rows.length,
  },
  places: rows,
};
const dest = path.join('src', 'data', 'local_data', 'natural_earth', 'places.json');
writeFileSync(dest, JSON.stringify(out));
console.log(`places: ${rows.length} → ${dest} (${Math.round(JSON.stringify(out).length / 1024)} kB)`);
