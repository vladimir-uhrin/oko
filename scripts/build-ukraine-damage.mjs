// OKO — škody na budovách modulu UKRAJINA (etapa 5, 2026-09-19): statický snímok zo
// Zenodo záznamu ETH Zürich (Dietrich et al. 2025, CC BY 4.0, https://zenodo.org/records/15088349)
//   .gev-cache/ukraine/damage/raw/n_buildings_damaged_adm3_t0_655.geojson  (61 MB, hromady)
//   .gev-cache/ukraine/damage/raw/unosat_labels.geojson                    (7 MB, UNOSAT body)
// →
//   .gev-cache/ukraine/damage/adm3.json    kruhy v ťažiskách hromád (počet, podiel)
//   .gev-cache/ukraine/damage/unosat.json  body UNOSAT s triedou a dátumom
//   .gev-cache/ukraine/damage/meta.json    provenance, súhrn
// Surové súbory sa stiahnu, ak chýbajú (Zenodo API `files/<name>/content`). Statické —
// dáta končia februárom 2024; UI to hlási. Servíruje ukraineEventsProxy
// (`/api/ukraine/events/damage/<adm3|unosat>`), kreslí src/ukraineDamageLayer.js.
//
// Usage: node scripts/build-ukraine-damage.mjs [--refresh]
import fs from 'node:fs';
import path from 'node:path';

import { DAMAGE_PERIOD, adm3Item, damageSummary, unosatItem } from '../src/data/ukraineDamage.js';

const ROOT = process.cwd();
const DIR = path.join(ROOT, '.gev-cache', 'ukraine', 'damage');
const RAW = path.join(DIR, 'raw');
const ZENODO = 'https://zenodo.org/api/records/15088349/files/';
const FILES = ['n_buildings_damaged_adm3_t0_655.geojson', 'unosat_labels.geojson'];
const UA = 'OKO-ukraine/0.1 (https://github.com/vladouh76; vladouh76@gmail.com)';
const refresh = process.argv.includes('--refresh');

fs.mkdirSync(RAW, { recursive: true });
for (const name of FILES) {
  const file = path.join(RAW, name);
  if (!refresh && fs.existsSync(file) && fs.statSync(file).size > 1000) continue;
  console.log(`sťahujem ${name} …`);
  const res = await fetch(`${ZENODO}${name}/content`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

const adm3Raw = JSON.parse(fs.readFileSync(path.join(RAW, FILES[0]), 'utf8'));
const unosatRaw = JSON.parse(fs.readFileSync(path.join(RAW, FILES[1]), 'utf8'));
const adm3 = adm3Raw.features.map(adm3Item).filter(Boolean).sort((a, b) => b.damaged - a.damaged);
const unosat = unosatRaw.features.map(unosatItem).filter(Boolean).sort((a, b) => a.t - b.t);
const summary = damageSummary(adm3, unosat);
const builtAt = new Date().toISOString();
const write = (name, obj) => { const tmp = path.join(DIR, `${name}.tmp`); fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, path.join(DIR, name)); };
write('adm3.json', { kind: 'adm3', builtAt, period: DAMAGE_PERIOD, source: 'ETH Zürich, Dietrich et al. 2025 (Zenodo 15088349), Sentinel-1 model', license: 'CC BY 4.0', count: adm3.length, damaged: summary.damaged, items: adm3 });
write('unosat.json', { kind: 'unosat', builtAt, source: 'UNOSAT/UNITAR damage assessments 2022–2023 (labels packaged in Zenodo 15088349)', license: 'CC BY-SA (UNOSAT) — own file', count: unosat.length, byClass: summary.byClass, cities: summary.cities, items: unosat });
write('meta.json', { builtAt, period: DAMAGE_PERIOD, adm3: { count: adm3.length, damaged: summary.damaged, top: adm3.slice(0, 10).map((a) => `${a.name}: ${a.damaged}`) }, unosat: { count: unosat.length, byClass: summary.byClass, cities: Object.keys(summary.cities).length, from: unosat[0] ? new Date(unosat[0].t).toISOString().slice(0, 10) : null, to: unosat.at(-1) ? new Date(unosat.at(-1).t).toISOString().slice(0, 10) : null } });
console.log(`hromady so škodami: ${adm3.length} (${summary.damaged} pravdepodobne poškodených budov, do 02/2024); UNOSAT body: ${unosat.length} ${JSON.stringify(summary.byClass)} v ${Object.keys(summary.cities).length} mestách`);
console.log('top:', adm3.slice(0, 5).map((a) => `${a.name} ${a.damaged}`).join(', '));
