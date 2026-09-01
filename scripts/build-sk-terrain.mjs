// OKO — Fáza 1b: build SK terénu z DMR 3.5 (ÚGKK, CC BY 4.0) na Cesium
// quantized-mesh dlaždice pre merge proxy /api/sk-terrain (vite.config.js).
//
// Pipeline (každý krok je resumovateľný — existujúci výstup sa preskočí,
// SK_TERRAIN_FORCE=1 vynúti rebuild od warp kroku ďalej):
//
//   1. download  dmr3_5-10.zip (~2,3 GB) z opendata.skgeodesy.sk
//   2. unzip     dmr3_5_10.tif — 10 m grid, S-JTSK/Krovak EN + Bpv výšky
//   3. warp      → EPSG:4979 (WGS84 3D): horizontálne 4326, výšky
//                Bpv→ELIPSOIDNÉ (PROJ_NETWORK=ON stiahne transformačné
//                gridy z cdn.proj.org). Elipsoidné výšky sú povinné:
//                Re:Earth terén, s ktorým sa mergujeme, je elipsoidný
//                (výškový kontrakt docs/CURRENT-STATE.md §1a).
//   4. relabel   → deklaratívne EPSG:4326 (hodnoty nezmenené) — ctb-tile
//                porovnáva SRS s geodetickým profilom.
//   5. mask      → hrubá binárna maska platnosti dát (ENVI Byte ~4096 px)
//                pre prune krok.
//   6. ctb       → quantized-mesh pyramída z0–z14 (-C root tily, -N
//                oct-encoded normály) do .gev-cache/sk-terrain.
//   7. layerjson → CTB layer.json (LEN ako núdzový SK-only fallback —
//                servírovaný layer.json je Re:Earth-ov, pozri proxy).
//   8. prune     → zmaž každú dlaždicu, ktorá NIE JE celá vo vnútri
//                dátového footprintu (maskCoversTile s eróziou) — hranice
//                SR tak vždy servíruje Re:Earth a útes na 0 m z nodata
//                nikdy nevznikne.
//   9. verify    → gzip magic vzorky, súhrn.
//
// Potrebuje Docker (obrazy ghcr.io/osgeo/gdal:ubuntu-small-latest
// a tumgis/ctb-quantized-mesh) a sieť. Beh: node scripts/build-sk-terrain.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geodeticTileBbox, maskCoversTile, tileRangesForLevel } from '../src/data/skTerrain.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.gev-cache');
const SRC_DIR = path.join(CACHE, 'sk-terrain-src');
const OUT_DIR = path.join(CACHE, 'sk-terrain');
const ZIP_URL = 'https://opendata.skgeodesy.sk/static/DMR3_5/dmr3_5-10.zip';
const ZIP_PATH = path.join(SRC_DIR, 'dmr3_5-10.zip');
const RAW_TIF = path.join(SRC_DIR, 'dmr3_5-10', 'dmr3_5_10.tif');
const WARPED = path.join(SRC_DIR, 'dmr35_wgs84_ellips.tif');
const RELABELED = path.join(SRC_DIR, 'dmr35_wgs84_4326.tif');
const MASK_BIL = path.join(SRC_DIR, 'dmr35_mask.bil');
const MASK_META = path.join(SRC_DIR, 'dmr35_mask.json');
const CTB_DONE = path.join(OUT_DIR, '.ctb-done');
const PRUNE_REPORT = path.join(OUT_DIR, 'prune-report.json');
const GDAL_IMAGE = 'ghcr.io/osgeo/gdal:ubuntu-small-latest';
const CTB_IMAGE = 'tumgis/ctb-quantized-mesh';
const MAX_ZOOM = Number(process.env.SK_TERRAIN_MAX_ZOOM) || 14;
const FORCE = process.env.SK_TERRAIN_FORCE === '1';

// Docker mount: celý .gev-cache ako /cache, cesty v kontajneri odvodené.
const inCache = (p) => '/cache/' + path.relative(CACHE, p).split(path.sep).join('/');

function run(cmd, args, { label }) {
  console.log(`\n→ ${label}`);
  const started = Date.now();
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${label} zlyhal (exit ${result.status ?? 'signal'})`);
  }
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

fs.mkdirSync(SRC_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

step('download', ZIP_PATH, () => {
  run('curl', ['-sS', '-L', '--retry', '3', '-o', ZIP_PATH, ZIP_URL], { label: `sťahujem ${ZIP_URL}` });
});

step('unzip', RAW_TIF, () => {
  fs.mkdirSync(path.dirname(RAW_TIF), { recursive: true });
  run('tar', ['-xf', ZIP_PATH, '-C', path.dirname(RAW_TIF)], { label: 'rozbaľujem zip' });
});

step('warp (Krovak+Bpv → WGS84 elipsoidné)', WARPED, () => {
  docker([GDAL_IMAGE, 'gdalwarp', '-overwrite',
    '-s_srs', 'EPSG:5514+8357', '-t_srs', 'EPSG:4979',
    '-r', 'bilinear', '-dstnodata', '-9999',
    '-multi', '-wo', 'NUM_THREADS=ALL_CPUS',
    '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE', '-co', 'PREDICTOR=3', '-co', 'BIGTIFF=YES',
    inCache(RAW_TIF), inCache(WARPED)], 'gdalwarp → EPSG:4979');
});

step('relabel na EPSG:4326', RELABELED, () => {
  docker([GDAL_IMAGE, 'gdal_translate', '-a_srs', 'EPSG:4326',
    '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE', '-co', 'PREDICTOR=3', '-co', 'BIGTIFF=YES',
    inCache(WARPED), inCache(RELABELED)], 'gdal_translate -a_srs EPSG:4326');
});

step('maska platnosti dát', MASK_META, () => {
  // 18000 px na ~445 km šírky SR ≈ 25 m/px. Pôvodných 4096 px (~110 m/px)
  // stačilo na prune do z14; z16–z18 dlaždice (76–19 m) by boli menšie než
  // pixel masky a interiérový test by bol slepý. 18000×~6300 Byte ≈ 113 MB —
  // Node ju číta celú, v pohode.
  docker([GDAL_IMAGE, 'gdal_translate', '-of', 'ENVI', '-ot', 'Byte',
    '-b', 'mask', '-outsize', '18000', '0',
    inCache(WARPED), inCache(MASK_BIL)], 'gdal_translate maska → ENVI');
  // Rozmery z ENVI .hdr; bbox z gdalinfo -json warpnutého rastra.
  const hdr = fs.readFileSync(MASK_BIL.replace(/\.bil$/, '.hdr'), 'utf8');
  const dim = (key) => Number(hdr.match(new RegExp(`${key}\\s*=\\s*(\\d+)`))?.[1]);
  const info = spawnSync('docker', ['run', '--rm', '-v', `${CACHE}:/cache`, GDAL_IMAGE,
    'gdalinfo', '-json', inCache(WARPED)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (info.status !== 0) throw new Error('gdalinfo zlyhal');
  const gj = JSON.parse(info.stdout);
  const [west, north] = gj.geoTransform ? [gj.geoTransform[0], gj.geoTransform[3]] : [null, null];
  const east = west + gj.geoTransform[1] * gj.size[0];
  const south = north + gj.geoTransform[5] * gj.size[1];
  fs.writeFileSync(MASK_META, JSON.stringify({
    width: dim('samples'), height: dim('lines'),
    bbox: { west, south, east, north },
  }, null, 2));
  console.log(`  maska ${dim('samples')}×${dim('lines')}, bbox ${west.toFixed(3)},${south.toFixed(3)} → ${east.toFixed(3)},${north.toFixed(3)}`);
});

step('ctb quantized-mesh pyramída', CTB_DONE, () => {
  docker([CTB_IMAGE, 'ctb-tile', '-f', 'Mesh', '-C', '-N',
    '-s', String(MAX_ZOOM), '-e', '0',
    '-o', inCache(OUT_DIR), inCache(RELABELED)], `ctb-tile Mesh z${MAX_ZOOM}→0 (dlhý krok)`);
  fs.writeFileSync(CTB_DONE, new Date().toISOString());
});

step('ctb layer.json (SK-only fallback)', path.join(OUT_DIR, 'layer.json'), () => {
  docker([CTB_IMAGE, 'ctb-tile', '-f', 'Mesh', '-C', '-N', '-l',
    '-s', String(MAX_ZOOM), '-e', '0',
    '-o', inCache(OUT_DIR), inCache(RELABELED)], 'ctb-tile -l layer.json');
});

step('prune na vnútro footprintu', PRUNE_REPORT, () => {
  const { width, height, bbox } = JSON.parse(fs.readFileSync(MASK_META, 'utf8'));
  const mask = new Uint8Array(fs.readFileSync(MASK_BIL));
  if (mask.length !== width * height) {
    throw new Error(`maska nesedí: ${mask.length} B vs ${width}×${height}`);
  }
  let kept = 0;
  let dropped = 0;
  for (const zName of fs.readdirSync(OUT_DIR)) {
    const zDir = path.join(OUT_DIR, zName);
    if (!/^\d+$/.test(zName) || !fs.statSync(zDir).isDirectory()) continue;
    const z = Number(zName);
    for (const xName of fs.readdirSync(zDir)) {
      const xDir = path.join(zDir, xName);
      if (!/^\d+$/.test(xName)) continue;
      for (const yFile of fs.readdirSync(xDir)) {
        const m = /^(\d+)\.terrain$/.exec(yFile);
        if (!m) continue;
        const tileBbox = geodeticTileBbox(z, Number(xName), Number(m[1]));
        if (maskCoversTile({ mask, width, height, maskBbox: bbox, tileBbox })) {
          kept++;
        } else {
          fs.unlinkSync(path.join(xDir, yFile));
          dropped++;
        }
      }
      if (fs.readdirSync(xDir).length === 0) fs.rmdirSync(xDir);
    }
    if (fs.readdirSync(zDir).length === 0) fs.rmdirSync(zDir);
  }
  fs.writeFileSync(PRUNE_REPORT, JSON.stringify({ kept, dropped, at: new Date().toISOString() }, null, 2));
  console.log(`  prune: ${kept} dlaždíc ostáva, ${dropped} zmazaných (hranice → Re:Earth)`);
});

// Availability overlay — vždy po prune (lacné, deterministicky z disku).
// Re:Earth layer.json hlási maxzoom 14; bez tohto by si Cesium úrovne 15+
// NIKDY nevypýtal a jemnejší build by bol neviditeľný. Proxy overlay zlúči
// do layer.json (mergeTerrainAvailability); rozsahy sú PRESNÉ — availability
// je prísľub existencie dlaždice a 404 na sľúbenej je render chyba.
{
  const UPSTREAM_MAX = 14;
  const available = {};
  let maxLevel = UPSTREAM_MAX;
  for (const zName of fs.readdirSync(OUT_DIR)) {
    const z = Number(zName);
    if (!Number.isInteger(z) || z <= UPSTREAM_MAX) continue;
    const zDir = path.join(OUT_DIR, zName);
    if (!fs.statSync(zDir).isDirectory()) continue;
    const tiles = [];
    for (const xName of fs.readdirSync(zDir)) {
      if (!/^\d+$/.test(xName)) continue;
      const x = Number(xName);
      for (const yFile of fs.readdirSync(path.join(zDir, xName))) {
        const m = /^(\d+)\.terrain$/.exec(yFile);
        if (m) tiles.push({ x, y: Number(m[1]) });
      }
    }
    if (tiles.length) {
      available[z] = tileRangesForLevel(tiles);
      maxLevel = Math.max(maxLevel, z);
      console.log(`  availability z${z}: ${tiles.length} dlaždíc → ${available[z].length} rozsahov`);
    }
  }
  const overlayPath = path.join(OUT_DIR, 'sk-availability.json');
  if (Object.keys(available).length) {
    fs.writeFileSync(overlayPath, JSON.stringify({ maxzoom: maxLevel, available }, null, 1));
    console.log(`  → ${overlayPath}`);
  } else {
    fs.rmSync(overlayPath, { force: true });
    console.log('  žiadne úrovne nad z14 — overlay sa nezapisuje');
  }
}

// verify — vždy (lacné): gzip magic náhodnej dlaždice + súhrn.
{
  const report = JSON.parse(fs.readFileSync(PRUNE_REPORT, 'utf8'));
  let sample = null;
  outer: for (const zName of fs.readdirSync(OUT_DIR).filter((n) => /^\d+$/.test(n)).sort((a, b) => b - a)) {
    const zDir = path.join(OUT_DIR, zName);
    for (const xName of fs.readdirSync(zDir)) {
      const files = fs.readdirSync(path.join(zDir, xName));
      if (files.length) { sample = path.join(zDir, xName, files[0]); break outer; }
    }
  }
  if (!sample) throw new Error('po prune neostala žiadna dlaždica — maska je zlá');
  const head = fs.readFileSync(sample).subarray(0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) {
    throw new Error(`dlaždica ${sample} nie je gzip (CTB kontrakt) — proxy by ju servírovala zle`);
  }
  console.log(`\n✓ BUILD OK — ${report.kept} dlaždíc v ${OUT_DIR}`);
  console.log(`  vzorka ${path.relative(OUT_DIR, sample)} je gzip, Content-Encoding: gzip sedí.`);
  console.log('  Servíruje vite proxy /api/sk-terrain (merge s Re:Earth) — spusti dev server a prepni na globe stack.');
}
