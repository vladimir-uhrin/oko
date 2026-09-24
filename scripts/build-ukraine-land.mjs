// scripts/build-ukraine-land.mjs — obrys pevniny Ukrajiny pre líniu kontaktu
// (2026-09-24): z Natural Earth 1:50m admin-0 (public domain) do malého modulu
// src/data/ukraineLand.js. Klient ním rozlišuje, či za okrajom okupovaného územia
// leží ukrajinská pevnina (= front), alebo Rusko či more (= nie front).
// Natural Earth zobrazuje de facto hranice — Krym v polygóne Ukrajiny nie je; pre
// líniu kontaktu to nevadí (Krym je celý okupovaný, jeho okraje sú pobrežie).
//
//   node scripts/build-ukraine-land.mjs
// Vstup: .gev-cache/natural-earth/ne_50m_admin_0_countries.geojson (ten istý súbor
// ako pri potrubiach). Súradnice sa zaokrúhľujú na 4 desatinné miesta (~10 m).
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const src = path.join(root, '.gev-cache', 'natural-earth', 'ne_50m_admin_0_countries.geojson');
const out = path.join(root, 'src', 'data', 'ukraineLand.js');
if (!fs.existsSync(src)) { console.error(`chýba ${src} (stiahni ne_50m_admin_0_countries.geojson z nvkelso/natural-earth-vector)`); process.exit(1); }
const json = JSON.parse(fs.readFileSync(src, 'utf8'));
const ua = json.features.find((f) => f.properties?.ADM0_A3 === 'UKR');
if (!ua) { console.error('Ukrajina v súbore nie je'); process.exit(1); }
const polys = ua.geometry.type === 'Polygon' ? [ua.geometry.coordinates] : ua.geometry.coordinates;
const round = (v) => Math.round(v * 1e4) / 1e4;
const rings = polys.map((p) => p[0].map(([lon, lat]) => [round(lon), round(lat)]));
let w = 180; let s = 90; let e = -180; let n = -90;
for (const r of rings) for (const [lon, lat] of r) { w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); n = Math.max(n, lat); }
const body = `// src/data/ukraineLand.js — VYGENEROVANÉ skriptom scripts/build-ukraine-land.mjs; neupravovať ručne.
/**
 * @module ukraineLand
 * @description Pevnina Ukrajiny (de facto, bez Krymu) z Natural Earth 1:50m admin-0
 * (public domain, naturalearthdata.com). Slúži len na rozlíšenie okrajov okupovaného
 * územia: za frontom je ukrajinská pevnina, za štátnou hranicou Rusko, za pobrežím more.
 */
export const UKRAINE_LAND_SOURCE = 'Natural Earth 1:50m admin-0 (public domain)';
export const UKRAINE_LAND_BBOX = Object.freeze([${round(w)}, ${round(s)}, ${round(e)}, ${round(n)}]);
export const UKRAINE_LAND_RINGS = Object.freeze([
${rings.map((r) => `  Object.freeze(${JSON.stringify(r)}),`).join('\n')}
]);
`;
fs.writeFileSync(out, body);
console.log(`ukraineLand.js: ${rings.length} prstence, ${rings.reduce((a, r) => a + r.length, 0)} vrcholov, ${body.length} B`);
