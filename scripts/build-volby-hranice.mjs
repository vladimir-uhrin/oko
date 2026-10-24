// scripts/build-volby-hranice.mjs — hranice krajov a obcí SR pre volebný režim mapy (2026-10-24, vlastník:
// „nevidno hranice obcí, žúp, nie je lepšie nastaviť inú mapu po zapnutí volieb?").
// Zdroj: OpenStreetMap (Overpass), administratívne hranice admin_level 4 (kraje), 8 (obce) a 9 (mestské časti),
// © OpenStreetMap contributors, ODbL 1.0. Čiary (nie polygóny) — každá hranica raz; zjednodušené Douglas-Peucker
// (kraje 0,0006°, obce 0,0004° ≈ 30–45 m), 5 desatinných miest. Výstup public/volby/hranice-{kraje,obce}.json:
// { meta, lines: [[[lon, lat], …], …] } — číta ho klient (src/volbyMapMode.js) až po zapnutí volebného režimu.
//
//   node scripts/build-volby-hranice.mjs   (surové odpovede sa cachujú v .gev-cache/volby-build/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = path.join(root, '.gev-cache', 'volby-build');
const outDir = path.join(root, 'public', 'volby');
fs.mkdirSync(cacheDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const r5 = (v) => Math.round(v * 1e5) / 1e5;
function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); const [ax, ay] = pts[a]; const [bx, by] = pts[b];
    const dx = bx - ax; const dy = by - ay; const L = Math.hypot(dx, dy) || 1e-12;
    let md = -1; let mi = -1;
    for (let i = a + 1; i < b; i += 1) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

async function overpass(name, query) {
  const file = path.join(cacheDir, `osm-hranice-${name}.json`);
  if (fs.existsSync(file) && fs.statSync(file).size > 10_000) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const res = await fetch(process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'OKO-okolive.sk/1.0 (+https://okolive.sk)' },
    body: `data=${encodeURIComponent(query)}`,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`overpass ${name}: HTTP ${res.status} ${text.slice(0, 200)}`);
  fs.writeFileSync(file, text);
  return JSON.parse(text);
}

const COS = Math.cos(48.7 * Math.PI / 180);
// V slovenskom OSM: kraj = 4, okres = 7, obec = 8, mestská časť Bratislavy a Košíc = 9 (overené 24. 10.: 2 888 rel. na úrovni 8).
for (const [name, level, tol] of [['kraje', '4', 0.0006], ['obce', '8|9', 0.0004]]) {
  const q = `[out:json][timeout:300];area["ISO3166-1"="SK"][admin_level=2]->.sk;rel(area.sk)["boundary"="administrative"]["admin_level"~"^(${level})$"];way(r);out geom;`;
  const osm = await overpass(name, q);
  const lines = [];
  let pts = 0;
  for (const el of osm.elements || []) {
    if (el.type !== 'way' || !el.geometry) continue;
    const line = dp(el.geometry.map((p) => [p.lon * COS, p.lat]), tol).map(([x, y]) => [r5(x / COS), r5(y)]);
    if (line.length >= 2) { lines.push(line); pts += line.length; }
  }
  const out = { meta: { source: 'OpenStreetMap (Overpass), boundary=administrative admin_level=' + level, licence: 'ODbL 1.0, © OpenStreetMap contributors', built: new Date().toISOString().slice(0, 10), lines: lines.length, points: pts }, lines };
  const f = path.join(outDir, `hranice-${name}.json`);
  fs.writeFileSync(f, JSON.stringify(out));
  console.log(name, lines.length, 'čiar', pts, 'bodov', (fs.statSync(f).size / 1e6).toFixed(2), 'MB');
}
