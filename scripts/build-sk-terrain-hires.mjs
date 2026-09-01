// OKO — hi-res vložka terénu z DMR 6.0 (0,5 m LiDAR, 2. cyklus LLS, ÚGKK
// CC-BY 4.0): vybrané LOT-y → quantized-mesh úrovne z15–z18, zliate do
// celoštátneho tilesetu z DMR 3.5 (.gev-cache/sk-terrain).
//
// Kontext (prieskum 2026-09-01): DMR 6.0 je zverejnený len pre 16 zo 73
// LOT-ov (~26 % SR, celý východ vrátane Tatier chýba — HTTP 404). Preto
// vložky po LOT-och, nie celoštátne. Default: LOT08 (Bratislava) + LOT10
// (Dunajská Streda / Žitný ostrov) — fokus projektu, oba publikované.
//
// Pipeline (resumovateľné kroky ako v build-sk-terrain.mjs):
//   1. extract   — z už stiahnutého ZIP-u len .tif + .tfw (bsdtar glob;
//                  .ovr pyramída 2–3 GiB sa preskakuje, CTB si robí vlastnú)
//   2. warp      — EPSG:8353+8357 → EPSG:4979 (JTSK03 + Bpv → elipsoid,
//                  PROJ_NETWORK gridy; rovnaký výškový kontrakt ako base)
//                  s -tr na vzorkovanie z18 (~1,2 m) — plných 0,5 m by pri
//                  strope z18 len nafúklo medzivýstup 5,8×
//   3. relabel   — deklaratívne EPSG:4326 (ctb porovnáva SRS s profilom)
//   4. vrt       — union oboch LOT-ov (susedia; jeden CTB beh, jeden šev)
//   5. maska     — union maska platnosti ~10 m/px (ENVI Byte) pre prune
//   6. ctb       — quantized-mesh z18→z15 (bez -C: korene rieši base build)
//   7. prune     — len dlaždice CELÉ vo vnútri dát (hranice LOT-ov ostávajú
//                  na hrubšom celoštátnom podklade — žiadny nodata útes)
//   8. merge     — kópia do .gev-cache/sk-terrain (z15 prekryvy prepíše —
//                  0,5 m zdroj > 10 m zdroj) + prepočet availability overlay
//
// Beh: node scripts/build-sk-terrain-hires.mjs   (Docker + stiahnuté ZIPy)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geodeticTileBbox, maskCoversTile, tileRangesForLevel } from '../src/data/skTerrain.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.gev-cache');
const DMR6_DIR = path.join(CACHE, 'sk-terrain-src', 'dmr6');
const STAGING = path.join(CACHE, 'sk-terrain-hires');
const MAIN_TILESET = path.join(CACHE, 'sk-terrain');
const GDAL_IMAGE = 'ghcr.io/osgeo/gdal:ubuntu-small-latest';
const CTB_IMAGE = 'tumgis/ctb-quantized-mesh';
const LOTS = ['LOT08', 'LOT10'];
const MAX_ZOOM = Number(process.env.SK_HIRES_MAX_ZOOM) || 18;
const MIN_ZOOM = Number(process.env.SK_HIRES_MIN_ZOOM) || 15;
/** Vzorkovanie cieľa: šírka geodetickej dlaždice z18 / 64 vzoriek ≈ 1,19 m. */
const TARGET_DEG = 180 / 2 ** MAX_ZOOM / 64;
const FORCE = process.env.SK_HIRES_FORCE === '1';

const inCache = (p) => '/cache/' + path.relative(CACHE, p).split(path.sep).join('/');

function run(cmd, args, { label }) {
  console.log(`\n→ ${label}`);
  const started = Date.now();
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${label} zlyhal (exit ${result.status ?? 'signal'})`);
  console.log(`  hotovo za ${Math.round((Date.now() - started) / 1000)} s`);
}

const docker = (args, label) => run('docker', ['run', '--rm', '-e', 'PROJ_NETWORK=ON', '-v', `${CACHE}:/cache`, ...args], { label });

function step(name, output, fn) {
  if (!FORCE && output && fs.existsSync(output)) {
    console.log(`✓ ${name} — existuje, preskakujem (${output})`);
    return;
  }
  fn();
}

fs.mkdirSync(STAGING, { recursive: true });

// Per-LOT: extract → warp → relabel.
const warped4326 = [];
for (const lot of LOTS) {
  const zip = path.join(DMR6_DIR, `${lot}_DMR6_sjtsk03_bpv.zip`);
  if (!fs.existsSync(zip)) throw new Error(`${zip} chýba — najprv stiahni archív (curl -C -).`);
  const lotDir = path.join(DMR6_DIR, lot);
  const warped = path.join(DMR6_DIR, `${lot}_wgs84_ellips.tif`);
  const relabeled = path.join(DMR6_DIR, `${lot}_wgs84_4326.tif`);

  step(`${lot} extract (.tif/.tfw, bez .ovr)`, lotDir, () => {
    fs.mkdirSync(lotDir, { recursive: true });
    run('tar', ['-xf', zip, '-C', lotDir, 'sjtsk03_bpv/*.tif', 'sjtsk03_bpv/*.tfw'], { label: `rozbaľujem ${lot} (len raster)` });
  });

  const tif = () => {
    const dir = path.join(lotDir, 'sjtsk03_bpv');
    const name = fs.readdirSync(dir).find((f) => f.endsWith('.tif'));
    if (!name) throw new Error(`${lot}: v archíve nie je .tif`);
    return path.join(dir, name);
  };

  step(`${lot} warp → EPSG:4979 @ ~${(TARGET_DEG * 111320).toFixed(2)} m`, warped, () => {
    docker([GDAL_IMAGE, 'gdalwarp', '-overwrite',
      '-s_srs', 'EPSG:8353+8357', '-t_srs', 'EPSG:4979',
      '-tr', String(TARGET_DEG), String(TARGET_DEG),
      '-r', 'bilinear', '-dstnodata', '-9999',
      '-multi', '-wo', 'NUM_THREADS=ALL_CPUS',
      '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE', '-co', 'PREDICTOR=3', '-co', 'BIGTIFF=YES',
      inCache(tif()), inCache(warped)], `gdalwarp ${lot}`);
  });

  step(`${lot} relabel EPSG:4326`, relabeled, () => {
    docker([GDAL_IMAGE, 'gdal_translate', '-a_srs', 'EPSG:4326',
      '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE', '-co', 'PREDICTOR=3', '-co', 'BIGTIFF=YES',
      inCache(warped), inCache(relabeled)], `gdal_translate ${lot}`);
  });

  warped4326.push(relabeled);
}

// Union VRT + union maska.
const VRT = path.join(DMR6_DIR, 'dmr6_union_4326.vrt');
const MASK_BIL = path.join(DMR6_DIR, 'dmr6_union_mask.bil');
const MASK_META = path.join(DMR6_DIR, 'dmr6_union_mask.json');
const CTB_DONE = path.join(STAGING, '.ctb-done');
const PRUNE_REPORT = path.join(STAGING, 'prune-report.json');

step('union VRT', VRT, () => {
  docker([GDAL_IMAGE, 'gdalbuildvrt', '-vrtnodata', '-9999',
    inCache(VRT), ...warped4326.map(inCache)], 'gdalbuildvrt LOT08+LOT10');
});

step('union maska platnosti (~10 m/px)', MASK_META, () => {
  // 12000 px na ~1,3° šírky únie ≈ 10–12 m/px — z18 dlaždica (~76 m) je
  // ~7 px masky, interiérový test má rezervu.
  docker([GDAL_IMAGE, 'gdal_translate', '-of', 'ENVI', '-ot', 'Byte',
    '-b', 'mask', '-outsize', '12000', '0',
    inCache(VRT), inCache(MASK_BIL)], 'gdal_translate union maska');
  const hdr = fs.readFileSync(MASK_BIL.replace(/\.bil$/, '.hdr'), 'utf8');
  const dim = (key) => Number(hdr.match(new RegExp(`${key}\\s*=\\s*(\\d+)`))?.[1]);
  const info = spawnSync('docker', ['run', '--rm', '-v', `${CACHE}:/cache`, GDAL_IMAGE,
    'gdalinfo', '-json', inCache(VRT)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (info.status !== 0) throw new Error('gdalinfo VRT zlyhal');
  const gj = JSON.parse(info.stdout);
  const west = gj.geoTransform[0];
  const north = gj.geoTransform[3];
  const east = west + gj.geoTransform[1] * gj.size[0];
  const south = north + gj.geoTransform[5] * gj.size[1];
  fs.writeFileSync(MASK_META, JSON.stringify({
    width: dim('samples'), height: dim('lines'), bbox: { west, south, east, north },
  }, null, 2));
  console.log(`  maska ${dim('samples')}×${dim('lines')}, bbox ${west.toFixed(3)},${south.toFixed(3)} → ${east.toFixed(3)},${north.toFixed(3)}`);
});

step(`ctb quantized-mesh z${MAX_ZOOM}→z${MIN_ZOOM}`, CTB_DONE, () => {
  // Bez -C: korene a nízke úrovne vlastní celoštátny base build.
  docker([CTB_IMAGE, 'ctb-tile', '-f', 'Mesh', '-N',
    '-s', String(MAX_ZOOM), '-e', String(MIN_ZOOM),
    '-o', inCache(STAGING), inCache(VRT)], `ctb-tile Mesh (dlhý krok — státisíce dlaždíc)`);
  fs.writeFileSync(CTB_DONE, new Date().toISOString());
});

step('prune na vnútro únie LOT-ov', PRUNE_REPORT, () => {
  const { width, height, bbox } = JSON.parse(fs.readFileSync(MASK_META, 'utf8'));
  const mask = new Uint8Array(fs.readFileSync(MASK_BIL));
  if (mask.length !== width * height) throw new Error(`maska nesedí: ${mask.length} B vs ${width}×${height}`);
  let kept = 0; let dropped = 0;
  for (const zName of fs.readdirSync(STAGING)) {
    const zDir = path.join(STAGING, zName);
    if (!/^\d+$/.test(zName) || !fs.statSync(zDir).isDirectory()) continue;
    const z = Number(zName);
    for (const xName of fs.readdirSync(zDir)) {
      const xDir = path.join(zDir, xName);
      if (!/^\d+$/.test(xName)) continue;
      for (const yFile of fs.readdirSync(xDir)) {
        const m = /^(\d+)\.terrain$/.exec(yFile);
        if (!m) continue;
        const tileBbox = geodeticTileBbox(z, Number(xName), Number(m[1]));
        if (maskCoversTile({ mask, width, height, maskBbox: bbox, tileBbox })) kept++;
        else { fs.unlinkSync(path.join(xDir, yFile)); dropped++; }
      }
      if (fs.readdirSync(xDir).length === 0) fs.rmdirSync(xDir);
    }
    if (fs.readdirSync(zDir).length === 0) fs.rmdirSync(zDir);
  }
  fs.writeFileSync(PRUNE_REPORT, JSON.stringify({ kept, dropped, at: new Date().toISOString() }, null, 2));
  console.log(`  prune: ${kept} ostáva, ${dropped} zmazaných (okraje LOT-ov → celoštátny 10 m podklad)`);
});

// merge do hlavného tilesetu + prepočet availability overlay — vždy.
{
  let copied = 0;
  for (const zName of fs.readdirSync(STAGING)) {
    if (!/^\d+$/.test(zName)) continue;
    const zDir = path.join(STAGING, zName);
    for (const xName of fs.readdirSync(zDir)) {
      const src = path.join(zDir, xName);
      const dst = path.join(MAIN_TILESET, zName, xName);
      fs.mkdirSync(dst, { recursive: true });
      for (const yFile of fs.readdirSync(src)) {
        fs.copyFileSync(path.join(src, yFile), path.join(dst, yFile));
        copied++;
      }
    }
  }
  console.log(`\nmerge: ${copied} hi-res dlaždíc skopírovaných do ${MAIN_TILESET}`);

  const UPSTREAM_MAX = 14;
  const available = {};
  let maxLevel = UPSTREAM_MAX;
  for (const zName of fs.readdirSync(MAIN_TILESET)) {
    const z = Number(zName);
    if (!Number.isInteger(z) || z <= UPSTREAM_MAX) continue;
    const zDir = path.join(MAIN_TILESET, zName);
    if (!fs.statSync(zDir).isDirectory()) continue;
    const tiles = [];
    for (const xName of fs.readdirSync(zDir)) {
      if (!/^\d+$/.test(xName)) continue;
      for (const yFile of fs.readdirSync(path.join(zDir, xName))) {
        const m = /^(\d+)\.terrain$/.exec(yFile);
        if (m) tiles.push({ x: Number(xName), y: Number(m[1]) });
      }
    }
    if (tiles.length) {
      available[z] = tileRangesForLevel(tiles);
      maxLevel = Math.max(maxLevel, z);
      console.log(`availability z${z}: ${tiles.length} dlaždíc → ${available[z].length} rozsahov`);
    }
  }
  fs.writeFileSync(
    path.join(MAIN_TILESET, 'sk-availability.json'),
    JSON.stringify({ maxzoom: maxLevel, available }, null, 1),
  );
  console.log(`✓ HI-RES BUILD OK — overlay prepísaný (maxzoom ${maxLevel}). Servíruje /api/sk-terrain (?terrain=sk).`);
}
