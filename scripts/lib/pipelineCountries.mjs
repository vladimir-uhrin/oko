// scripts/lib/pipelineCountries.mjs
//
// Krajiny úseku potrubia zo súradníc (etapa 3b, 2026-09-19; používateľ:
// „informácie v kartičkách vyžmíkaj viac aj s vlajkami"). Vlajka potrebuje
// štát a OSM cesta štát nenesie, preto sa dopočíta v BUILDE bodom v polygóne
// nad Natural Earth 1:50m admin-0 countries (public domain). Do snímku ide len
// zoznam ISO2 kódov; polygóny (3 MB) sa do prehliadača nikdy neposielajú.
//
// Pri chýbajúcom súbore sa raz stiahne z github.com/nvkelso/natural-earth-vector
// (žiadny kľúč, žiadne podmienky) a uloží do .gev-cache/natural-earth/.
//
// Modul je knižnica: import nič nespustí.
import fs from 'node:fs';
import path from 'node:path';

export const NE_COUNTRIES_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';
export const NE_COUNTRIES_FILE = 'ne_50m_admin_0_countries.geojson';

/** Even-odd bod v prstenci; ring = [[lon, lat], …]. */
export function pointInRing(ring, lon, lat) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * ISO2 krajiny z vlastností Natural Earth: `ISO_A2_EH` je opravená verzia
 * (Nórsko, Francúzsko, Kosovo = XK), `ISO_A2` má pri nich -99. Bez kódu
 * (Somaliland, severný Cyprus, Siachen) → null, úsek tam ostane bez vlajky.
 */
export function isoOf(properties = {}) {
  for (const key of ['ISO_A2_EH', 'ISO_A2']) {
    const v = String(properties[key] || '').toUpperCase();
    if (/^[A-Z]{2}$/.test(v)) return v;
  }
  return null;
}

function bboxOf(ring) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of ring) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return [minX, minY, maxX, maxY];
}

/**
 * Index polygónov: každý polygón = vonkajší prstenec + diery + bbox, s ISO2.
 * @param {object} geojson FeatureCollection Natural Earth admin-0
 * @returns {{polygons: Array<{iso: string, bbox: number[], outer: number[][], holes: number[][][]}>, count: number}}
 */
export function buildCountryIndex(geojson) {
  const polygons = [];
  for (const feature of geojson?.features || []) {
    const iso = isoOf(feature.properties);
    if (!iso) continue;
    const g = feature.geometry;
    const polys = g?.type === 'Polygon' ? [g.coordinates] : (g?.type === 'MultiPolygon' ? g.coordinates : []);
    for (const rings of polys) {
      if (!rings?.[0]?.length) continue;
      polygons.push({ iso, bbox: bboxOf(rings[0]), outer: rings[0], holes: rings.slice(1) });
    }
  }
  return { polygons, count: polygons.length };
}

/**
 * ISO2 krajiny pre bod, alebo null (more, územie bez kódu).
 * @param {{polygons: any[]}} index
 * @param {number} lon
 * @param {number} lat
 */
export function countryAt(index, lon, lat) {
  for (const p of index.polygons) {
    const [minX, minY, maxX, maxY] = p.bbox;
    if (lon < minX || lon > maxX || lat < minY || lat > maxY) continue;
    if (!pointInRing(p.outer, lon, lat)) continue;
    if (p.holes.some((hole) => pointInRing(hole, lon, lat))) continue;
    return p.iso;
  }
  return null;
}

/**
 * Krajiny úseku: vzorkuje prvý, stredný a posledný bod a pri dlhších úsekoch
 * každý ~50. km po ceste, aby úsek cez hranicu dostal obe krajiny. Poradie =
 * poradie výskytu pozdĺž úseku, bez duplikátov.
 * @param {{polygons: any[]}} index
 * @param {number[][]} coords [lon, lat][]
 * @returns {string[]}
 */
export function countriesForCoords(index, coords) {
  if (!index || !Array.isArray(coords) || coords.length === 0) return [];
  const samples = new Set([0, Math.floor(coords.length / 2), coords.length - 1]);
  // ~50 km ≈ 0,45° — hrubá vzorka stačí, hranice sú od seba spravidla ďalej.
  let acc = 0;
  for (let i = 1; i < coords.length; i += 1) {
    acc += Math.hypot(coords[i][0] - coords[i - 1][0], (coords[i][1] - coords[i - 1][1]));
    if (acc >= 0.45) { samples.add(i); acc = 0; }
  }
  const out = [];
  for (const i of [...samples].sort((a, b) => a - b)) {
    const iso = countryAt(index, coords[i][0], coords[i][1]);
    if (iso && !out.includes(iso)) out.push(iso);
  }
  return out;
}

/**
 * Načítaj (a pri prvom použití stiahni) Natural Earth a vráť index; pri
 * zlyhaní siete vráti null a build pokračuje bez krajín — s varovaním, nie
 * ticho.
 * @param {{cacheDir: string, fetchImpl?: typeof fetch, log?: Function}} o
 */
export async function loadCountryIndex({ cacheDir, fetchImpl = (...a) => fetch(...a), log = console.log }) {
  const file = path.join(cacheDir, NE_COUNTRIES_FILE);
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
    log(`countries: sťahujem Natural Earth 1:50m admin-0 (public domain) → ${file}`);
    try {
      const res = await fetchImpl(NE_COUNTRIES_URL, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      JSON.parse(text);
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(file, text, 'utf8');
    } catch (error) {
      console.warn(`countries: Natural Earth sa nepodarilo stiahnuť (${error?.message || error}) — snímok bude BEZ krajín/vlajok`);
      return null;
    }
  }
  const index = buildCountryIndex(JSON.parse(fs.readFileSync(file, 'utf8')));
  log(`countries: ${index.count} polygónov Natural Earth 1:50m`);
  return index;
}
