// scripts/build-volby-obce-geo.mjs — polohy obcí pre sekciu VOĹBY (2026-10-24).
//
// Register kandidátov MV SR ani tabuľky ŠÚ SR nemajú súradnice; panel potrebuje preletieť ku
// zvolenej obci. Zdroj polôh: GeoNames (CC BY 4.0) — ten istý dump SK.txt, z ktorého vznikli mestá
// meteo mapy (public/meteo-towns). Kľúč spojenia: kód okresu (GeoNames admin2 = kód okresu ŠÚ SR,
// napr. 201 Dunajská Streda) + meno bez diakritiky; mestské časti Bratislavy a Košíc bez prefixu
// mesta. Keď obec v okrese chýba, skúsi sa jednoznačné meno v celej SR, inak stred okresu
// (presnosť „okres" — panel to povie). Výstup: src/data/local_data/volby/obce-geo.json
// { meta, rows: [[kodObce, lat, lon, presnosť], …] } — číta ho len server (volbyService.js).
//
// Spustenie: node scripts/build-volby-obce-geo.mjs [--geonames <SK.txt|SK.zip>] [--uzemie <OSO2026_SK_tab0dd.xlsx>]
//            [--mesta <OSO2026_SK_tab0dx.xlsx>] — bez parametrov sa súbory stiahnu do .gev-cache/volby-build/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZipEntries } from '../src/data/zipEntries.js';
import { readXlsxRows, tableByHeader } from '../src/data/xlsxSheet.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const cacheDir = path.join(root, '.gev-cache', 'volby-build');
fs.mkdirSync(cacheDir, { recursive: true });

const GEONAMES_URL = 'https://download.geonames.org/export/dump/SK.zip';
const UZEMIE_URL = 'https://volbysr.sk/oso/files/xlsx/OSO2026_SK_tab0dd.xlsx';
const MESTA_URL = 'https://volbysr.sk/oso/files/xlsx/OSO2026_SK_tab0dx.xlsx';

async function fetchTo(url, file) {
  if (fs.existsSync(file)) return file;
  const res = await fetch(url, { headers: { 'User-Agent': 'OKO-okolive.sk/1.0 (+https://okolive.sk)' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const geonamesPath = args.get('geonames') || await fetchTo(GEONAMES_URL, path.join(cacheDir, 'SK.zip'));
const uzemiePath = args.get('uzemie') || await fetchTo(UZEMIE_URL, path.join(cacheDir, 'OSO2026_SK_tab0dd.xlsx'));
const mestaPath = args.get('mesta') || await fetchTo(MESTA_URL, path.join(cacheDir, 'OSO2026_SK_tab0dx.xlsx'));

let geonamesText;
if (geonamesPath.endsWith('.zip')) {
  const entry = readZipEntries(fs.readFileSync(geonamesPath)).find((e) => e.name === 'SK.txt');
  if (!entry) throw new Error('SK.zip bez SK.txt');
  geonamesText = entry.read().toString('utf8');
} else geonamesText = fs.readFileSync(geonamesPath, 'utf8');

// GeoNames: 0 id, 1 name, 2 ascii, 3 alternatenames, 4 lat, 5 lon, 6 class, 7 code, 8 cc, 10 admin1, 11 admin2, 14 population, 18 modified
const byOkres = new Map(); // `${okres}|${fold}` → place
const byName = new Map(); // fold → place[] (celá SR)
let newest = '';
let places = 0;
const rank = (p) => (p.code === 'PPLC' ? 4 : p.code.startsWith('PPLA') ? 3 : p.code === 'PPL' ? 2 : 1);
const better = (a, b) => !b || rank(a) > rank(b) || (rank(a) === rank(b) && a.pop > b.pop);
for (const line of geonamesText.split('\n')) {
  const c = line.split('\t');
  if (c[6] !== 'P') continue;
  places += 1;
  const place = { name: c[1], lat: Number(c[4]), lon: Number(c[5]), code: c[7], okres: c[11], pop: Number(c[14]) || 0 };
  if (c[18] > newest) newest = c[18];
  const names = new Set([c[1], c[2], ...String(c[3] || '').split(',')].map(fold).filter(Boolean));
  for (const n of names) {
    const key = `${place.okres}|${n}`;
    if (better(place, byOkres.get(key))) byOkres.set(key, place);
    const list = byName.get(n) || [];
    if (!list.includes(place)) list.push(place);
    byName.set(n, list);
  }
}

const uzemie = tableByHeader(readXlsxRows(fs.readFileSync(uzemiePath)), ['Kód okresu', 'Kód obce', 'Názov obce']);
const mesta = tableByHeader(readXlsxRows(fs.readFileSync(mestaPath)), ['Kód mesta', 'Názov mesta']);
if (!uzemie || !mesta) throw new Error('územné členenie ŠÚ SR: hlavička nenájdená');

const rows = [];
const counts = { obec: 0, name: 0, okres: 0, none: 0 };
const okresPoints = new Map();
const pending = [];
for (const r of uzemie.records) {
  const code = String(r['Kód obce']).trim();
  const okres = String(r['Kód okresu']).trim();
  const full = String(r['Názov obce']).trim();
  const bare = full.replace(/^(Bratislava|Košice) - /, '');
  const hit = byOkres.get(`${okres}|${fold(bare)}`) || byOkres.get(`${okres}|${fold(full)}`);
  if (hit) {
    rows.push([code, +hit.lat.toFixed(4), +hit.lon.toFixed(4), 'obec']);
    counts.obec += 1;
    const pts = okresPoints.get(okres) || [];
    pts.push(hit);
    okresPoints.set(okres, pts);
  } else pending.push({ code, okres, full, bare });
}
for (const p of pending) {
  const list = (byName.get(fold(p.bare)) || []).filter((x) => x.code.startsWith('PPL'));
  if (list.length === 1) {
    rows.push([p.code, +list[0].lat.toFixed(4), +list[0].lon.toFixed(4), 'name']);
    counts.name += 1;
    continue;
  }
  const pts = okresPoints.get(p.okres);
  if (pts?.length) {
    const lat = pts.reduce((a, x) => a + x.lat, 0) / pts.length;
    const lon = pts.reduce((a, x) => a + x.lon, 0) / pts.length;
    rows.push([p.code, +lat.toFixed(4), +lon.toFixed(4), 'okres']);
    counts.okres += 1;
  } else {
    counts.none += 1;
    console.warn('bez polohy:', p.okres, p.full);
  }
}
// Mestá Bratislava a Košice (primátor, mestské zastupiteľstvo) — najväčšie sídlo toho mena v SR.
for (const m of mesta.records) {
  const list = (byName.get(fold(m['Názov mesta'])) || []).sort((a, b) => b.pop - a.pop);
  if (list[0]) { rows.push([String(m['Kód mesta']).trim(), +list[0].lat.toFixed(4), +list[0].lon.toFixed(4), 'obec']); counts.obec += 1; }
}
rows.sort((a, b) => a[0].localeCompare(b[0]));

const outDir = path.join(root, 'src', 'data', 'local_data', 'volby');
fs.mkdirSync(outDir, { recursive: true });
const out = {
  meta: {
    description: 'Polohy obcí SR pre sekciu VOĹBY: kód obce ŠÚ SR → zemepisná šírka a dĺžka (4 des. miesta) a presnosť (obec = sídlo v tom istom okrese, name = jednoznačné meno v SR, okres = stred nájdených obcí okresu).',
    sources: [
      { name: 'GeoNames SK.txt', url: GEONAMES_URL, licence: 'CC BY 4.0', newestRecord: newest, populatedPlaces: places },
      { name: 'ŠÚ SR — Územné členenie (OSO 2026, tab0dd a tab0dx)', url: 'https://volbysr.sk/oso/sk/uzemne_clenenie.html' },
    ],
    built: new Date().toISOString().slice(0, 10),
    counts,
    columns: ['kodObce', 'lat', 'lon', 'presnost'],
  },
  rows,
};
fs.writeFileSync(path.join(outDir, 'obce-geo.json'), JSON.stringify(out));
console.log(`obce-geo.json: ${rows.length} obcí`, counts);
