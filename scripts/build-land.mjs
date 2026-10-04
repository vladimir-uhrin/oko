// OKO — pevnina pre obrázky Štúdia (2026-10-03).
// Natural Earth ne_50m_land (public domain) → src/data/local_data/natural_earth/land.json
// Douglas-Peucker 0,02°, súradnice na 2 desatinné miesta, prstence < 0,05 °² vypustené.
//
// Usage: node scripts/build-land.mjs [cesta-k-ne_50m_land.geojson]
//        (bez argumentu stiahne súbor z pinovaného commitu natural-earth-vector)
import { readFileSync, writeFileSync } from 'node:fs';

const COMMIT = 'ca96624a56bd078437bca8184e78163e5039ad19';
const URL_SRC = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${COMMIT}/geojson/ne_50m_land.geojson`;
const OUT = new URL('../src/data/local_data/natural_earth/land.json', import.meta.url);

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
      // Uzavretý prstenec má a == b — vtedy vzdialenosť od bodu, nie od priamky.
      const d = len < 1e-9 ? Math.hypot(points[i][0] - ax, points[i][1] - ay)
        : Math.abs(dy * points[i][0] - dx * points[i][1] + bx * ay - by * ax) / len;
      if (d > max) { max = d; index = i; }
    }
    if (max > tolerance && index > 0) { keep[index] = 1; stack.push([a, index], [index, b]); }
  }
  return points.filter((_, i) => keep[i]);
}
const area = ring => Math.abs(ring.reduce((sum, [x, y], i) => { const [nx, ny] = ring[(i + 1) % ring.length]; return sum + x * ny - nx * y; }, 0) / 2);

const source = process.argv[2]
  ? JSON.parse(readFileSync(process.argv[2], 'utf8'))
  : await (await fetch(URL_SRC)).json();
const rings = [];
for (const feature of source.features) {
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  for (const polygon of polygons) {
    const outer = polygon[0];
    if (area(outer) < 0.05) continue;
    const ring = simplify(outer, 0.02).map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
    if (ring.length >= 4) rings.push(ring);
  }
}
writeFileSync(OUT, JSON.stringify({
  meta: { source: 'Natural Earth ne_50m_land', url: URL_SRC, commit: COMMIT, license: 'public domain (https://www.naturalearthdata.com/about/terms-of-use/)',
    curation: 'outer rings only, Douglas-Peucker 0.02°, 2 decimals, rings < 0.05 sq deg dropped', rings: rings.length },
  rings,
}));
console.log(`land.json: ${rings.length} rings, ${rings.reduce((n, r) => n + r.length, 0)} points`);
