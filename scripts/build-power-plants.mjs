#!/usr/bin/env node
// scripts/build-power-plants.mjs
/**
 * Elektrárne sveta ≥ 100 MW pre vrstvu `local-power-plants`
 * (src/data/local_data/power_plants/power-plants.geojsonl).
 *
 * Zdroj: WRI Global Power Plant Database 1.3.0 (CC BY 4.0), stav 2021 —
 * statický snímok, nie živý register. Overené zmeny po vydaní (zatvorené
 * uhoľné elektrárne SR, Mochovce 3) sú v `PLANT_OVERRIDES` s odkazom na zdroj.
 *
 *   node scripts/build-power-plants.mjs [cesta/k/global_power_plant_database.csv | .zip]
 *
 * Bez argumentu stiahne oficiálny ZIP (4 MB) do .gev-cache/power-plants/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlantFeatures, extractZipEntry, parseCsv, MIN_PLANT_MW } from './lib/powerPlantsBuild.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ZIP_URL = 'https://wri-dataportal-prod.s3.amazonaws.com/manual/global_power_plant_database_v_1_3.zip';
const CSV_NAME = 'global_power_plant_database.csv';
const CACHE_DIR = path.join(ROOT, '.gev-cache', 'power-plants');
const OUT_DIR = path.join(ROOT, 'src', 'data', 'local_data', 'power_plants');
const OUT = path.join(OUT_DIR, 'power-plants.geojsonl');

async function readCsv(arg) {
  if (arg && arg.toLowerCase().endsWith('.csv')) return fs.readFileSync(arg, 'utf8');
  let zipPath = arg;
  if (!zipPath) {
    zipPath = path.join(CACHE_DIR, 'gppd-1.3.0.zip');
    if (!fs.existsSync(zipPath)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      console.log(`[power-plants] sťahujem ${ZIP_URL}`);
      const res = await fetch(ZIP_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
    }
  }
  return extractZipEntry(fs.readFileSync(zipPath), CSV_NAME).toString('utf8');
}

const rows = parseCsv(await readCsv(process.argv[2]));
const features = buildPlantFeatures(rows);
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, `${features.map((f) => JSON.stringify(f)).join('\n')}\n`);
const byFuel = {};
for (const f of features) byFuel[f.properties.fuel] = (byFuel[f.properties.fuel] || 0) + 1;
const gw = features.reduce((s, f) => s + f.properties.mw, 0) / 1000;
console.log(`[power-plants] ${rows.length} riadkov → ${features.length} elektrární ≥ ${MIN_PLANT_MW} MW, ${gw.toFixed(0)} GW`);
console.log(`[power-plants] palivá: ${JSON.stringify(byFuel)}`);
console.log(`[power-plants] bez vlajky: ${features.filter((f) => !f.properties.cc).length}; ${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB → ${path.relative(ROOT, OUT)}`);
