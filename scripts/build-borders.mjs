// OKO — hranice štátov pre mapu Naživo v admine (2026-10-04).
// Natural Earth ne_50m_admin_0_boundary_lines_land (public domain) → src/data/local_data/natural_earth/borders.json
// Douglas-Peucker 0,02°, súradnice na 2 desatinné miesta (rovnako ako land.json).
//
// Usage: node scripts/build-borders.mjs [cesta-k-ne_50m_admin_0_boundary_lines_land.geojson]
//        (bez argumentu stiahne súbor z pinovaného commitu natural-earth-vector)
import { readFileSync, writeFileSync } from 'node:fs';

const COMMIT = 'ca96624a56bd078437bca8184e78163e5039ad19';
const URL_SRC = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${COMMIT}/geojson/ne_50m_admin_0_boundary_lines_land.geojson`;
const OUT = new URL('../src/data/local_data/natural_earth/borders.json', import.meta.url);

function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a]; const [bx, by] = points[b];
    const dx = bx - ax; const dy = by - ay; const len = Math.hypot(dx, dy);
    let max = 0; let index = -1;
    for (let i = a + 1; i < b; i++) {
      const d = len < 1e-9 ? Math.hypot(points[i][0] - ax, points[i][1] - ay)
        : Math.abs(dy * points[i][0] - dx * points[i][1] + bx * ay - by * ax) / len;
      if (d > max) { max = d; index = i; }
    }
    if (max > tolerance && index > 0) { keep[index] = 1; stack.push([a, index], [index, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

const source = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : await (await fetch(URL_SRC)).json();
const lines = [];
for (const feature of source.features) {
  const parts = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  for (const part of parts) {
    const line = simplify(part, 0.02).map(([lon, lat]) => [Math.round(lon * 100) / 100, Math.round(lat * 100) / 100]);
    if (line.length >= 2) lines.push(line);
  }
}
writeFileSync(OUT, JSON.stringify({
  meta: { source: 'Natural Earth ne_50m_admin_0_boundary_lines_land', url: URL_SRC, commit: COMMIT,
    license: 'public domain (https://www.naturalearthdata.com/about/terms-of-use/)',
    curation: 'Douglas-Peucker 0.02°, 2 decimals; map in admin Naživo (scripts/build-borders.mjs)' },
  lines,
}));
console.log(`${lines.length} línií → ${OUT.pathname}`);
