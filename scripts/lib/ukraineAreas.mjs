// scripts/lib/ukraineAreas.mjs
/**
 * @module ukraineAreas (build)
 * @description Plochy z OSM pre kartografický režim KARTA (etapa K2, 2026-09-20):
 * zástavba (landuse=residential/industrial), lesy (natural=wood, landuse=forest),
 * vodné plochy (natural=water) a železnice (railway=rail) po dlaždiciach 1°×1°
 * nad oknami smerov frontu. Čisté pomocné funkcie (bez siete, bez disku):
 * dlaždice, Overpass dopyt, zreťazenie relácií, Douglas–Peucker, prahy plochy,
 * vlastníctvo polygónu podľa ťažiska (polygón na hranici kreslí len jedna dlaždica).
 */

export const AREAS_QUERY_VERSION = 'v1';
/** Prahy plochy (km²) — pod nimi sa polygón zahodí (na mape by bol bodka). */
export const AREAS_MIN_KM2 = Object.freeze({ built: 0.01, forest: 0.05, water: 0.02 });
/** Douglas–Peucker tolerancia (°) ≈ 12 m. */
export const AREAS_SIMPLIFY_DEG = 0.00011;
/** Strop polygónov na dlaždicu a triedu (najväčšie prvé). */
export const AREAS_MAX_PER_CLASS = 6000;
/** Stred Donbasu — dlaždice sa sťahujú od neho von. */
export const AREAS_PRIORITY_CENTER = Object.freeze({ lat: 48.6, lon: 37.8 });

const pad = (n, w) => String(Math.abs(n)).padStart(w, '0');
/** Kľúč dlaždice 1°×1° z jej JZ rohu: N48E037. Pure. */
export function tileKey(south, west) {
  const s = Math.floor(south), w = Math.floor(west);
  return `${s < 0 ? 'S' : 'N'}${pad(s, 2)}${w < 0 ? 'W' : 'E'}${pad(w, 3)}`;
}
/** Kľúč → bbox [W, S, E, N]. Pure. */
export function tileBbox(key) {
  const m = /^([NS])(\d{2})([EW])(\d{3})$/.exec(String(key || ''));
  if (!m) return null;
  const s = (m[1] === 'S' ? -1 : 1) * Number(m[2]);
  const w = (m[3] === 'W' ? -1 : 1) * Number(m[4]);
  return [w, s, w + 1, s + 1];
}
/** Platný kľúč dlaždice? Pure. */
export function isTileKey(key) { return tileBbox(key) !== null; }

/**
 * Dlaždice pretínajúce ktorékoľvek okno smeru (bez prehľadu `overview`),
 * zoradené od stredu Donbasu von. Pure.
 * @param {Array<{rectDegrees?: number[], overview?: boolean}>} scenes
 */
export function tilesForScenes(scenes, { center = AREAS_PRIORITY_CENTER } = {}) {
  const keys = new Map();
  for (const sc of scenes || []) {
    if (!sc?.rectDegrees || sc.overview) continue;
    const [w, s, e, n] = sc.rectDegrees;
    for (let lat = Math.floor(s); lat < n; lat += 1) {
      for (let lon = Math.floor(w); lon < e; lon += 1) {
        const key = tileKey(lat, lon);
        if (!keys.has(key)) keys.set(key, { key, bbox: [lon, lat, lon + 1, lat + 1], scenes: [] });
        keys.get(key).scenes.push(sc.id);
      }
    }
  }
  const dist = (t) => Math.hypot((t.bbox[1] + 0.5 - center.lat) * 111, (t.bbox[0] + 0.5 - center.lon) * 111 * Math.cos((center.lat * Math.PI) / 180));
  return [...keys.values()].sort((a, b) => dist(a) - dist(b));
}

/** Overpass QL pre dlaždicu (bbox = S,W,N,E). Pure. */
export function buildAreasQuery([w, s, e, n], { timeout = 300 } = {}) {
  const bbox = `(${s},${w},${n},${e})`;
  return `[out:json][timeout:${timeout}];(` +
    `way["landuse"~"^(residential|industrial)$"]${bbox};relation["landuse"~"^(residential|industrial)$"]${bbox};` +
    `way["natural"="wood"]${bbox};way["landuse"="forest"]${bbox};relation["natural"="wood"]${bbox};relation["landuse"="forest"]${bbox};` +
    `way["natural"="water"]${bbox};relation["natural"="water"]${bbox};` +
    `way["railway"="rail"]${bbox};);out geom;`;
}

/** Trieda prvku podľa tagov, alebo null. Pure. */
export function areaClassOf(tags) {
  const t = tags || {};
  if (t.railway === 'rail') return 'rail';
  if (t.natural === 'water') return 'water';
  if (t.natural === 'wood' || t.landuse === 'forest') return 'forest';
  if (t.landuse === 'residential' || t.landuse === 'industrial') return 'built';
  return null;
}

const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
/** Zreťazí úseky (polia [lon,lat]) podľa spoločných koncov do uzavretých prstencov. Pure. */
export function chainRings(ways) {
  const rings = [];
  const pool = (ways || []).filter((w) => Array.isArray(w) && w.length >= 2).map((w) => w.slice());
  while (pool.length) {
    let ring = pool.shift();
    let guard = 0;
    while (!same(ring[0], ring[ring.length - 1]) && guard++ < 5000) {
      const end = ring[ring.length - 1];
      let idx = pool.findIndex((w) => same(w[0], end));
      let rev = false;
      if (idx < 0) { idx = pool.findIndex((w) => same(w[w.length - 1], end)); rev = true; }
      if (idx < 0) break;
      const w = pool.splice(idx, 1)[0];
      ring = ring.concat((rev ? w.slice().reverse() : w).slice(1));
    }
    if (ring.length >= 4 && same(ring[0], ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}

const geomToRing = (geometry) => (geometry || []).map((p) => [p.lon, p.lat]);
/**
 * Prvok Overpass (`out geom`) → prstence [vonkajší, ...vnútorné] (polygón) alebo
 * pre železnicu jedna lomená čiara. Pure.
 * @returns {{ rings?: number[][][], line?: number[][] } | null}
 */
export function ringsFromElement(el) {
  if (!el) return null;
  if (el.type === 'way' && Array.isArray(el.geometry)) {
    const ring = geomToRing(el.geometry);
    if (areaClassOf(el.tags) === 'rail') return ring.length >= 2 ? { line: ring } : null;
    if (ring.length < 4 || !same(ring[0], ring[ring.length - 1])) return null;
    return { rings: [ring] };
  }
  if (el.type === 'relation' && Array.isArray(el.members)) {
    const outer = chainRings(el.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => geomToRing(m.geometry)));
    const inner = chainRings(el.members.filter((m) => m.type === 'way' && m.role === 'inner' && m.geometry).map((m) => geomToRing(m.geometry)));
    if (!outer.length) return null;
    return { rings: [...outer, ...inner] };
  }
  return null;
}

/** Plocha prstenca (km², lokálna rovina). Pure. */
export function ringAreaKm2(ring) {
  if (!ring || ring.length < 3) return 0;
  const lat0 = (ring[0][1] * Math.PI) / 180;
  const kx = 111.32 * Math.cos(lat0), ky = 111.32;
  let s = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    s += a[0] * kx * (b[1] * ky) - b[0] * kx * (a[1] * ky);
  }
  return Math.abs(s) / 2;
}
/** Ťažisko prstenca (priemer vrcholov). Pure. */
export function ringCentroid(ring) {
  let x = 0, y = 0, n = 0;
  for (const [lon, lat] of ring) { x += lon; y += lat; n += 1; }
  return n ? [x / n, y / n] : [NaN, NaN];
}

function perpDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
/** Douglas–Peucker (iteratívne), zachová prvý a posledný bod. Pure. */
export function simplifyLine(points, tol = AREAS_SIMPLIFY_DEG) {
  if (!points || points.length <= 2 || tol <= 0) return points ? points.slice() : [];
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i += 1) { const d = perpDist(points[i], points[s], points[e]); if (d > maxD) { maxD = d; idx = i; } }
    if (idx >= 0 && maxD > tol) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return points.filter((_, i) => keep[i]);
}
/** Zjednodušenie uzavretého prstenca (prvý bod = posledný ostáva). Pure. */
export function simplifyRing(ring, tol = AREAS_SIMPLIFY_DEG) {
  const out = simplifyLine(ring, tol);
  return out.length >= 4 ? out : ring.slice();
}
const rnd = (v) => Math.round(v * 1e5) / 1e5;
const roundRing = (ring) => ring.map(([lon, lat]) => [rnd(lon), rnd(lat)]);
const inBbox = ([lon, lat], [w, s, e, n]) => lon >= w && lon < e && lat >= s && lat < n;

/**
 * Prvky Overpass jednej dlaždice → kompaktné plochy. Vlastníctvo podľa ťažiska
 * vonkajšieho prstenca (bbox dlaždice), prahy plochy, zjednodušenie, zaokrúhlenie,
 * strop na triedu (najväčšie prvé). Železnice: úseky s aspoň jedným bodom v dlaždici. Pure.
 * @param {object[]} elements
 * @param {{ bbox: number[] }} tile
 * @returns {{ built: number[][][][], forest: number[][][][], water: number[][][][], rail: number[][][], counts: object, dropped: object }}
 */
export function elementsToAreas(elements, { bbox, minKm2 = AREAS_MIN_KM2, tol = AREAS_SIMPLIFY_DEG, maxPerClass = AREAS_MAX_PER_CLASS } = {}) {
  const buckets = { built: [], forest: [], water: [] };
  const rail = [];
  const dropped = { tiny: 0, foreign: 0, broken: 0 };
  for (const el of elements || []) {
    const cls = areaClassOf(el.tags);
    if (!cls) continue;
    const geo = ringsFromElement(el);
    if (!geo) { dropped.broken += 1; continue; }
    if (cls === 'rail') {
      if (!geo.line.some((p) => inBbox(p, bbox))) { dropped.foreign += 1; continue; }
      rail.push(roundRing(simplifyLine(geo.line, tol)));
      continue;
    }
    const outer = geo.rings[0];
    if (!inBbox(ringCentroid(outer), bbox)) { dropped.foreign += 1; continue; }
    const km2 = ringAreaKm2(outer);
    if (km2 < minKm2[cls]) { dropped.tiny += 1; continue; }
    const rings = geo.rings.map((r) => roundRing(simplifyRing(r, tol))).filter((r) => r.length >= 4);
    if (!rings.length) { dropped.broken += 1; continue; }
    buckets[cls].push({ km2, rings });
  }
  const out = { rail, counts: {}, dropped };
  for (const cls of ['built', 'forest', 'water']) {
    const sorted = buckets[cls].sort((a, b) => b.km2 - a.km2);
    if (sorted.length > maxPerClass) dropped[`cap_${cls}`] = sorted.length - maxPerClass;
    out[cls] = sorted.slice(0, maxPerClass).map((p) => p.rings);
    out.counts[cls] = out[cls].length;
  }
  out.counts.rail = rail.length;
  return out;
}
