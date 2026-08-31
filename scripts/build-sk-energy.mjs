// OKO — build the bundled SK energy-infrastructure snapshot (Fáza 4a).
//
// Fetches Slovakia's high-voltage transmission lines (400/220 kV) and gas
// transmission pipelines from OpenStreetMap via Overpass, applies a
// deterministic simplification, and writes
// src/data/local_data/sk_energy/sk-energy.geojsonl (one feature per line —
// the same shape the other bundled datasets use). Provenance and license
// (ODbL 1.0, © OpenStreetMap contributors) live in the folder's SOURCE.md.
//
// Usage:
//   node scripts/build-sk-energy.mjs
//   OVERPASS_URL=https://maps.mail.ru/osm/tools/overpass/api/interpreter node scripts/build-sk-energy.mjs
//
// Be a good Overpass citizen: this is a manual, occasional build step (the
// grid changes on the timescale of years), never an automated/CI fetch.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
// Slovakia + a small margin; cross-border continuations of transit lines are
// welcome context, and a bbox works on every mirror (areas do not).
const BBOX = '47.70,16.80,49.65,22.60';
const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/data/local_data/sk_energy');
const OUT_FILE = path.join(OUT_DIR, 'sk-energy.geojsonl');
/** Douglas–Peucker tolerance in degrees (~40 m) — plenty for country-scale lines. */
const SIMPLIFY_EPS_DEG = 0.0004;
const ROUND = 4; // ~11 m — matches the tolerance above

const QUERY = `[out:json][timeout:180][bbox:${BBOX}];
way["power"="line"]["voltage"~"400000|220000"]->.pw;
way["man_made"="pipeline"]["substance"~"gas"]["usage"="transmission"]->.gas;
.pw out tags geom;
.gas out tags geom;`;

/** Perpendicular distance of point p from segment a–b, in degrees. */
function pointSegDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Iterative Douglas–Peucker (stack-based; some transit ways are long). */
function simplify(coords, eps) {
  if (coords.length <= 2) return coords;
  const keep = new Uint8Array(coords.length);
  keep[0] = 1;
  keep[coords.length - 1] = 1;
  const stack = [[0, coords.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop();
    let maxDist = 0;
    let maxAt = -1;
    for (let i = from + 1; i < to; i++) {
      const d = pointSegDist(coords[i], coords[from], coords[to]);
      if (d > maxDist) { maxDist = d; maxAt = i; }
    }
    if (maxDist > eps && maxAt !== -1) {
      keep[maxAt] = 1;
      stack.push([from, maxAt], [maxAt, to]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

const round = (n) => Number(n.toFixed(ROUND));

// Overpass returns the FULL geometry of any way touching the bbox, so a
// transit corridor mapped as one long way drags hundreds of km of neighbour
// territory into the bundle. Clip to the query bbox (+ a hair of slack):
// runs outside are dropped, boundary crossings are interpolated, and a way
// that re-enters yields multiple parts.
const [CLIP_S, CLIP_W, CLIP_N, CLIP_E] = BBOX.split(',').map(Number);
const inside = ([lon, lat]) => lon >= CLIP_W && lon <= CLIP_E && lat >= CLIP_S && lat <= CLIP_N;

/** Intersection of segment a→b with the bbox boundary, from the `a` side. */
function boundaryPoint(a, b) {
  let t = 1;
  const clamp = (limit, axis) => {
    const da = axis === 0 ? a[0] : a[1];
    const db = axis === 0 ? b[0] : b[1];
    if (da === db) return;
    const tt = (limit - da) / (db - da);
    if (tt >= 0 && tt < t) t = tt;
  };
  if (b[0] < CLIP_W) clamp(CLIP_W, 0);
  if (b[0] > CLIP_E) clamp(CLIP_E, 0);
  if (b[1] < CLIP_S) clamp(CLIP_S, 1);
  if (b[1] > CLIP_N) clamp(CLIP_N, 1);
  return [round(a[0] + (b[0] - a[0]) * t), round(a[1] + (b[1] - a[1]) * t)];
}

/** Split a coordinate run into the parts inside the bbox. */
function clipToBbox(coords) {
  const parts = [];
  let run = [];
  for (let i = 0; i < coords.length; i++) {
    const point = coords[i];
    if (inside(point)) {
      if (!run.length && i > 0 && !inside(coords[i - 1])) {
        run.push(boundaryPoint(point, coords[i - 1]));
      }
      run.push(point);
    } else if (run.length) {
      run.push(boundaryPoint(coords[i - 1], point));
      if (run.length >= 2) parts.push(run);
      run = [];
    }
  }
  if (run.length >= 2) parts.push(run);
  return parts;
}

function toFeatures(el) {
  const tags = el.tags || {};
  const isGas = tags.man_made === 'pipeline';
  const coords = (el.geometry || []).map((pt) => [round(pt.lon), round(pt.lat)]);
  const properties = {
    kind: isGas ? 'gas' : 'power',
    name: tags.name || tags.ref || null,
    operator: tags.operator || null,
  };
  if (isGas) properties.substance = tags.substance || 'gas';
  else properties.voltage = tags.voltage || null;
  return clipToBbox(coords)
    .map((part) => simplify(part, SIMPLIFY_EPS_DEG))
    .filter((part) => part.length >= 2)
    .map((part, index, parts) => ({
      type: 'Feature',
      id: parts.length === 1 ? `osm-way-${el.id}` : `osm-way-${el.id}.${index}`,
      properties,
      geometry: { type: 'LineString', coordinates: part },
    }));
}

// A few polite retries: Overpass mirrors 504 under load, and hammering them
// is exactly what the etiquette note above forbids.
let json = null;
for (let attempt = 1; attempt <= 3; attempt++) {
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'OKO-gev-fork-build/0.1 (one-off manual snapshot build)',
    },
    body: 'data=' + encodeURIComponent(QUERY),
    signal: AbortSignal.timeout(300000),
  });
  if (res.ok) {
    json = await res.json();
    break;
  }
  console.error(`Overpass ${OVERPASS_URL} -> HTTP ${res.status} (attempt ${attempt}/3)`);
  if (attempt === 3) {
    console.error((await res.text()).slice(0, 500));
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 45_000));
}
const features = (json.elements || [])
  .filter((el) => el.type === 'way')
  .flatMap(toFeatures)
  .sort((a, b) => (a.properties.kind === b.properties.kind
    ? a.id.localeCompare(b.id)
    : a.properties.kind.localeCompare(b.properties.kind)));

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, features.map((f) => JSON.stringify(f)).join('\n') + '\n', 'utf8');

const counts = features.reduce((acc, f) => {
  acc[f.properties.kind] = (acc[f.properties.kind] || 0) + 1;
  return acc;
}, {});
const points = features.reduce((n, f) => n + f.geometry.coordinates.length, 0);
console.log(`sk-energy.geojsonl: ${features.length} features (${JSON.stringify(counts)}), ${points} points, ${fs.statSync(OUT_FILE).size} B`);
console.log(`source timestamp: ${json.osm3s?.timestamp_osm_base || 'unknown'} via ${OVERPASS_URL}`);
