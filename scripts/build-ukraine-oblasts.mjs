// scripts/build-ukraine-oblasts.mjs — polygóny oblastí Ukrajiny pre vrstvu hrozieb
// podľa Vzdušných síl (2026-09-26): Natural Earth 1:10m admin-1 (public domain)
// → zjednodušené a zaokrúhlené prstence do public/data/ukraine-oblasts.json.
// Kľúč oblasti = meno, ktoré používa lokátor správ (UK_OBLAST_HINTS / gazetteer):
// „Zhytomyr Oblast", „Kyiv Oblast"… (Sevastopoľ ku Krymu).
//
//   node scripts/build-ukraine-oblasts.mjs [--tolerance 0.01]
// Vstup sa stiahne raz do .gev-cache/natural-earth/ (41 MB), výstup ~100 kB.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const cacheDir = path.join(root, '.gev-cache', 'natural-earth');
const src = path.join(cacheDir, 'ne_10m_admin_1_states_provinces.geojson');
const URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson';
const out = path.join(root, 'public', 'data', 'ukraine-oblasts.json');
const tolArg = process.argv.indexOf('--tolerance');
const TOLERANCE = tolArg > 0 ? Number(process.argv[tolArg + 1]) : 0.01;

/**
 * ISO 3166-2 → meno oblasti v lokátore. Mesto Kyjev (UA-30) je v Natural Earth diera
 * v Kyjevskej oblasti — berieme len vonkajší prstenec oblasti, ktorý ho pokrýva, takže
 * mesto sa nepridáva (inak dvojité tieňovanie). Sevastopoľ (UA-40) ku Krymu.
 */
export const ISO_TO_OBLAST = Object.freeze({
  'UA-05': 'Vinnytsia Oblast', 'UA-07': 'Volyn Oblast', 'UA-09': 'Luhansk Oblast', 'UA-12': 'Dnipropetrovsk Oblast',
  'UA-14': 'Donetsk Oblast', 'UA-18': 'Zhytomyr Oblast', 'UA-21': 'Zakarpattia Oblast', 'UA-23': 'Zaporizhzhia Oblast',
  'UA-26': 'Ivano-Frankivsk Oblast', 'UA-32': 'Kyiv Oblast', 'UA-35': 'Kirovohrad Oblast',
  'UA-40': 'Crimea', 'UA-43': 'Crimea', 'UA-46': 'Lviv Oblast', 'UA-48': 'Mykolaiv Oblast', 'UA-51': 'Odesa Oblast',
  'UA-53': 'Poltava Oblast', 'UA-56': 'Rivne Oblast', 'UA-59': 'Sumy Oblast', 'UA-61': 'Ternopil Oblast',
  'UA-63': 'Kharkiv Oblast', 'UA-65': 'Kherson Oblast', 'UA-68': 'Khmelnytskyi Oblast', 'UA-71': 'Cherkasy Oblast',
  'UA-74': 'Chernihiv Oblast', 'UA-77': 'Chernivtsi Oblast',
});

/** Douglas–Peucker nad [lon,lat] (rovinne), prstenec ostáva uzavretý. */
function simplify(points, tol) {
  if (points.length <= 4) return points;
  const keep = new Uint8Array(points.length); keep[0] = 1; keep[points.length - 1] = 1;
  // Uzavretý prstenec (prvý = posledný bod): úsečka nulovej dĺžky by nezachovala nič —
  // rozdeľ ho v bode najďalej od začiatku.
  let far = 0; let farD = -1;
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = Math.hypot(points[i][0] - points[0][0], points[i][1] - points[0][1]);
    if (d > farD) { farD = d; far = i; }
  }
  keep[far] = 1;
  const stack = [[0, far], [far, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [x1, y1] = points[a]; const [x2, y2] = points[b];
    const dx = x2 - x1; const dy = y2 - y1; const len = Math.hypot(dx, dy) || 1e-12;
    let best = -1; let bestD = 0;
    for (let i = a + 1; i < b; i += 1) {
      const d = Math.abs(dy * points[i][0] - dx * points[i][1] + x2 * y1 - y2 * x1) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best > 0 && bestD > tol) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return points.filter((_, i) => keep[i]);
}
const round = (v) => Math.round(v * 1e4) / 1e4;

async function main() {
  if (!fs.existsSync(src)) {
    fs.mkdirSync(cacheDir, { recursive: true });
    console.log(`sťahujem ${URL} …`);
    const res = await fetch(URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const tmp = `${src}.tmp`;
    fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    fs.renameSync(tmp, src);
  }
  const json = JSON.parse(fs.readFileSync(src, 'utf8'));
  const byName = new Map();
  for (const f of json.features) {
    const p = f.properties || {};
    const name = ISO_TO_OBLAST[p.iso_3166_2];
    if (!name) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const rings = polys.map((poly) => simplify(poly[0], TOLERANCE).map(([lon, lat]) => [round(lon), round(lat)])).filter((r) => r.length >= 4);
    const cur = byName.get(name) || { name, iso: [], rings: [] };
    cur.iso.push(p.iso_3166_2);
    cur.rings.push(...rings);
    byName.set(name, cur);
  }
  const oblasts = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  const missing = [...new Set(Object.values(ISO_TO_OBLAST))].filter((n) => !byName.has(n));
  const body = {
    source: 'Natural Earth 1:10m admin-1 states/provinces (public domain), simplified',
    tolerance: TOLERANCE,
    builtAt: new Date().toISOString(),
    oblasts,
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(body));
  const verts = oblasts.reduce((a, o) => a + o.rings.reduce((b, r) => b + r.length, 0), 0);
  console.log(`ukraine-oblasts.json: ${oblasts.length} oblastí, ${verts} vrcholov, ${fs.statSync(out).size} B${missing.length ? ` · CHÝBA: ${missing.join(', ')}` : ''}`);
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('build-ukraine-oblasts.mjs')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
