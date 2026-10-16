// OKO — hranice štátov a body popisiek štátov z Natural Earth 1:50m (public domain), 2026-10-16.
//
//   ne_50m_admin_0_boundary_lines_land → src/data/local_data/boundaries/boundaries.geojsonl
//     jedna LineString na riadok (MultiLineString rozdelený), súradnice na 4 desatinné miesta,
//     properties { l, r, cls }: ISO2 štátu vľavo/vpravo (dopočítané bodom v polygóne zo
//     ne_50m_admin_0_countries — čiary 1:50m kódy nenesú, len 1:10m) a trieda čiary:
//     'international' alebo 'disputed' (sporná, línia kontroly, neurčitá, neuznaná podľa ISO —
//     na mape čiarkovane ako na mapách OSN). Hranice uznané medzinárodne (postoj OSN): čiary,
//     ktoré Ukrajina klasifikuje ako vnútorné a Rusko ako medzinárodné (Perekop — Natural Earth
//     kreslí Krym de facto pod Ruskom), sa VYNECHAJÚ; čiary, ktoré Ukrajina klasifikuje ako
//     medzinárodné (Kerč), sú medzinárodné. Pre ostatné platí FEATURECLA.
//   ne_50m_admin_0_countries → src/data/local_data/natural_earth/country-labels.json
//     { iso2, a3, lon, lat, rank, minLabel, maxLabel, tiny, pop, nameEn } pre štáty s platným
//     ISO_A2_EH (Somaliland, Severný Cyprus, Siačen bez kódu sa vynechajú).
//
// Usage: node scripts/build-boundaries.mjs [lines.geojson countries.geojson]
//        (bez argumentov stiahne oba súbory z pinovaného commitu natural-earth-vector)
import { readFileSync, writeFileSync } from 'node:fs';
import {
  classifyBoundary, countryLabelRecord, pointInMultiPolygon, sideSamples,
} from './lib/boundaries.mjs';

const COMMIT = 'ca96624a56bd078437bca8184e78163e5039ad19';
const BASE = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${COMMIT}/geojson/`;
const URL_LINES = `${BASE}ne_50m_admin_0_boundary_lines_land.geojson`;
const URL_COUNTRIES = `${BASE}ne_50m_admin_0_countries.geojson`;
const OUT_LINES = new URL('../src/data/local_data/boundaries/boundaries.geojsonl', import.meta.url);
const OUT_LABELS = new URL('../src/data/local_data/natural_earth/country-labels.json', import.meta.url);

const load = async (arg, url) => (arg ? JSON.parse(readFileSync(arg, 'utf8')) : (await fetch(url)).json());
const lines = await load(process.argv[2], URL_LINES);
const countries = await load(process.argv[3], URL_COUNTRIES);

// štáty: polygóny + kód (ISO2, pri neplatnom ADM0_A3)
const polys = countries.features.map((f) => ({
  code: /^[A-Z]{2}$/.test(f.properties.ISO_A2_EH) ? f.properties.ISO_A2_EH : f.properties.ADM0_A3,
  rings: f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates,
  bbox: bboxOf(f.geometry),
}));
function bboxOf(geometry) {
  let w = 180; let s = 90; let e = -180; let n = -90;
  const walk = (c) => { if (typeof c[0] === 'number') { if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0]; if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1]; } else for (const x of c) walk(x); };
  walk(geometry.coordinates);
  return [w, s, e, n];
}
function countryAt(lon, lat) {
  for (const p of polys) {
    const [w, s, e, n] = p.bbox;
    if (lon < w || lon > e || lat < s || lat > n) continue;
    if (pointInMultiPolygon(lon, lat, p.rings)) return p.code;
  }
  return null;
}
function majority(codes) {
  const m = new Map();
  for (const c of codes) if (c) m.set(c, (m.get(c) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

const out = [];
let id = 0; let dropped = 0; let disputed = 0;
for (const feature of lines.features) {
  const cls = classifyBoundary(feature.properties);
  if (!cls) { dropped += 1; continue; }
  if (cls === 'disputed') disputed += 1;
  const parts = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  for (const part of parts) {
    const coords = part.map(([lon, lat]) => [Math.round(lon * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4]);
    if (coords.length < 2) continue;
    const { left, right } = sideSamples(part);
    const l = majority(left.map(([lon, lat]) => countryAt(lon, lat)));
    const r = majority(right.map(([lon, lat]) => countryAt(lon, lat)));
    out.push(JSON.stringify({ type: 'Feature', id: id++, geometry: { type: 'LineString', coordinates: coords }, properties: { l, r, cls } }));
  }
}
writeFileSync(OUT_LINES, `${out.join('\n')}\n`);

const labels = countries.features.map((f) => countryLabelRecord(f.properties)).filter(Boolean)
  .sort((a, b) => a.rank - b.rank || b.pop - a.pop);
writeFileSync(OUT_LABELS, `${JSON.stringify({
  meta: {
    source: 'Natural Earth ne_50m_admin_0_countries (LABEL_X/LABEL_Y, LABELRANK, MIN_LABEL/MAX_LABEL)', url: URL_COUNTRIES, commit: COMMIT,
    license: 'public domain (https://www.naturalearthdata.com/about/terms-of-use/)',
    curation: 'len štáty s platným ISO_A2_EH; mená dá prehliadač (Intl.DisplayNames), nameEn ako záloha (scripts/build-boundaries.mjs)',
  },
  labels,
}, null, 0)}\n`);

const unattributed = out.filter((l) => /"l":null|"r":null/.test(l)).length;
console.log(`${out.length} čiar (${disputed} sporných zdrojových, ${dropped} vynechaných) → ${OUT_LINES.pathname}; bez kódu na jednej strane: ${unattributed}`);
console.log(`${labels.length} popisiek štátov → ${OUT_LABELS.pathname}`);
