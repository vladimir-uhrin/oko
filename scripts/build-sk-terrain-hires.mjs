// OKO — hi-res vložka terénu z DMR 6.0 (0,5 m LiDAR, 2. cyklus LLS, ÚGKK
// CC-BY 4.0): vybrané LOT-y → quantized-mesh úrovne z15–z18, zliate do
// celoštátneho tilesetu z DMR 3.5 (.gev-cache/sk-terrain).
//
// Kontext (prieskum 2026-09-01, aktualizácia 2026-09-12): DMR 6.0 je
// zverejnený pre 16 zo 73 LOT-ov (~26 % SR; celý východ vrátane Tatier
// chýba — HTTP 404). Preto vložky po LOT-och, nie celoštátne. Default od
// 2026-09-12 („chcem čo najväčšiu ostrosť"): VŠETKY publikované LOT-y
// (SK_HIRES_LOTS=LOT08,LOT10 zúži). Zoznam a URL: GKÚ „ZBGIS – na
// stiahnutie", sekcia 2. cyklus LLS:
//   https://opendata.skgeodesy.sk/static/LLS/2_cyklus/<LOT>/<LOT>_DMR6_sjtsk03_bpv.zip
//
// Pipeline (resumovateľné kroky ako v build-sk-terrain.mjs), per LOT:
//   0. download  — curl -C - (resumovateľné) do .part, potom premenovanie;
//                  hotový LOT (relabeled .tif existuje) sa nesťahuje
//   1. extract   — zo ZIP-u len .tif + .tfw (bsdtar glob; .ovr pyramída
//                  2–3 GiB sa preskakuje, CTB si robí vlastnú)
//   2. warp      — EPSG:8353+8357 → EPSG:4979 (JTSK03 + Bpv → elipsoid,
//                  PROJ_NETWORK gridy; rovnaký výškový kontrakt ako base)
//                  s -tr na vzorkovanie z18 (~1,2 m) — plných 0,5 m by pri
//                  strope z18 len nafúklo medzivýstup 5,8×
//   3. relabel   — deklaratívne EPSG:4326 (ctb porovnáva SRS s profilom)
//   3b. cleanup  — rozbalený raster (~30 GB), medzivýstup warp a ZIP sa
//                  zmažú (SK_HIRES_KEEP_ZIP=1 ZIP nechá): 16 LOT-ov by inak
//                  zabralo ~700 GB, takto špička ~55 GB na LOT
//   4. vrt       — union všetkých LOT-ov (susedia; jeden CTB beh, jeden šev);
//                  názvy union súborov a staging nesú hash zoznamu LOT-ov,
//                  aby iný výber LOT-ov nepoužil staré medzivýsledky
//   5. maska     — union maska platnosti ~10 m/px (ENVI Byte) pre prune
//   6. ctb       — quantized-mesh z18→z15 (bez -C: korene rieši base build)
//   7. prune     — len dlaždice CELÉ vo vnútri dát (hranice LOT-ov ostávajú
//                  na hrubšom celoštátnom podklade — žiadny nodata útes)
//   8. merge     — kópia do .gev-cache/sk-terrain (z15 prekryvy prepíše —
//                  0,5 m zdroj > 10 m zdroj) + prepočet availability overlay
//
// Beh: node scripts/build-sk-terrain-hires.mjs   (Docker; ZIPy si stiahne sám)
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geodeticTileBbox, maskCoversTile, tileRangesForLevel } from '../src/data/skTerrain.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.gev-cache');
const DMR6_DIR = path.join(CACHE, 'sk-terrain-src', 'dmr6');
const MAIN_TILESET = path.join(CACHE, 'sk-terrain');
const GDAL_IMAGE = 'ghcr.io/osgeo/gdal:ubuntu-small-latest';
const CTB_IMAGE = 'tumgis/ctb-quantized-mesh';
/** Všetky LOT-y DMR 6.0 zverejnené ÚGKK k 2026-09-12 (HEAD 200, spolu ~210 GB ZIP). */
export const PUBLISHED_LOTS = Object.freeze(['LOT04', 'LOT06', 'LOT07', 'LOT08', 'LOT09', 'LOT10', 'LOT11', 'LOT12', 'LOT13', 'LOT16', 'LOT17', 'LOT20', 'LOT27', 'LOT29', 'LOT31', 'LOT32']);
const LOTS = String(process.env.SK_HIRES_LOTS || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
if (!LOTS.length) LOTS.push(...PUBLISHED_LOTS);
for (const lot of LOTS) if (!/^LOT\d\d$/.test(lot)) throw new Error(`Neplatný LOT: ${lot}`);
const LOT_SET_HASH = createHash('sha1').update(LOTS.join(',')).digest('hex').slice(0, 8);
const STAGING = path.join(CACHE, LOTS.length === 2 && LOTS[0] === 'LOT08' && LOTS[1] === 'LOT10' ? 'sk-terrain-hires' : `sk-terrain-hires-${LOT_SET_HASH}`);
const LOT_URL = (lot) => `https://opendata.skgeodesy.sk/static/LLS/2_cyklus/${lot}/${lot}_DMR6_sjtsk03_bpv.zip`;
const KEEP_ZIP = process.env.SK_HIRES_KEEP_ZIP === '1';
const MAX_ZOOM = Number(process.env.SK_HIRES_MAX_ZOOM) || 18;
const MIN_ZOOM = Number(process.env.SK_HIRES_MIN_ZOOM) || 15;
/** Vzorkovanie cieľa: šírka geodetickej dlaždice z18 / 64 vzoriek ≈ 1,19 m. */
const TARGET_DEG = 180 / 2 ** MAX_ZOOM / 64;
const FORCE = process.env.SK_HIRES_FORCE === '1';

const inCache = (p) => '/cache/' + path.relative(CACHE, p).split(path.sep).join('/');
// .gev-cache je od 2026-09-13 junction na D:\OKO\gev-cache (C: sa plnil):
// Node cez junction píše normálne, ale Docker bind mount dostane reálnu cestu.
const CACHE_REAL = fs.realpathSync.native(CACHE);

function run(cmd, args, { label }) {
  console.log(`\n→ ${label}`);
  const started = Date.now();
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${label} zlyhal (exit ${result.status ?? 'signal'})`);
  console.log(`  hotovo za ${Math.round((Date.now() - started) / 1000)} s`);
}

const docker = (args, label) => run('docker', ['run', '--rm', '-e', 'PROJ_NETWORK=ON', '-v', `${CACHE_REAL}:/cache`, ...args], { label });

/**
 * Prerušený krok (Ctrl+C, reštart, zabitý kontajner) nesmie nechať polovičný
 * výstup, ktorý by `step()` nabudúce preskočil ako hotový (naživo 2026-09-13:
 * 1,5 GB torzo gdalwarp LOT04). Výstup ide do `<cieľ>.tmp` a premenuje sa až
 * po úspechu; staré .tmp sa pri štarte zahodí.
 */
function viaTmp(target, fn) {
  const tmp = target + '.tmp';
  fs.rmSync(tmp, { recursive: true, force: true });
  fn(tmp);
  fs.renameSync(tmp, target);
}

function step(name, output, fn) {
  if (!FORCE && output && fs.existsSync(output)) {
    console.log(`✓ ${name} — existuje, preskakujem (${output})`);
    return;
  }
  fn();
}

fs.mkdirSync(STAGING, { recursive: true });
fs.mkdirSync(DMR6_DIR, { recursive: true });
console.log(`LOT-y (${LOTS.length}): ${LOTS.join(', ')} · staging ${STAGING}`);

// Siroty CTB kontajnerov (lekcia 2026-09-02): každý zabitý build nechal svoj
// kontajner bežať a písal do toho istého výstupu — pred novým behom zastav.
{
  const ps = spawnSync('docker', ['ps', '--filter', `ancestor=${CTB_IMAGE}`, '--format', '{{.ID}}'], { encoding: 'utf8' });
  const ids = String(ps.stdout || '').split(/\s+/).filter(Boolean);
  if (ids.length) throw new Error(`Beží CTB kontajner (${ids.join(', ')}) — najprv docker kill, inak dva buildy píšu do jedného výstupu.`);
}

// Per-LOT: download → extract → warp → relabel → cleanup. Hotový LOT
// (relabeled .tif) preskočí všetko vrátane sťahovania.
const warped4326 = [];
for (const lot of LOTS) {
  const zip = path.join(DMR6_DIR, `${lot}_DMR6_sjtsk03_bpv.zip`);
  const lotDir = path.join(DMR6_DIR, lot);
  const warped = path.join(DMR6_DIR, `${lot}_wgs84_ellips.tif`);
  const relabeled = path.join(DMR6_DIR, `${lot}_wgs84_4326.tif`);
  if (!FORCE && fs.existsSync(relabeled)) {
    console.log(`✓ ${lot} — relabeled .tif existuje, preskakujem celý LOT`);
    warped4326.push(relabeled);
    continue;
  }

  step(`${lot} download (${LOT_URL(lot)})`, zip, () => {
    const part = `${zip}.part`;
    run('curl', ['-L', '--fail', '--retry', '8', '--retry-all-errors', '--retry-delay', '20', '-C', '-', '-o', part, LOT_URL(lot)], { label: `sťahujem ${lot} (resumovateľne)` });
    const size = fs.statSync(part).size;
    if (size < 1024 * 1024 * 1024) throw new Error(`${lot}: stiahnutý ZIP má len ${size} B — asi chybová stránka`);
    fs.renameSync(part, zip);
    console.log(`  ${lot}: ${(size / 1e9).toFixed(1)} GB`);
  });

  step(`${lot} extract (.tif/.tfw, bez .ovr)`, lotDir, () => viaTmp(lotDir, (tmp) => {
    fs.mkdirSync(tmp, { recursive: true });
    run('tar', ['-xf', zip, '-C', tmp, 'sjtsk03_bpv/*.tif', 'sjtsk03_bpv/*.tfw'], { label: `rozbaľujem ${lot} (len raster)` });
  }));

  const tif = () => {
    const dir = path.join(lotDir, 'sjtsk03_bpv');
    const name = fs.readdirSync(dir).find((f) => f.endsWith('.tif'));
    if (!name) throw new Error(`${lot}: v archíve nie je .tif`);
    return path.join(dir, name);
  };

  step(`${lot} warp → EPSG:4979 @ ~${(TARGET_DEG * 111320).toFixed(2)} m`, warped, () => viaTmp(warped, (tmp) => {
    docker([GDAL_IMAGE, 'gdalwarp', '-overwrite',
      '-s_srs', 'EPSG:8353+8357', '-t_srs', 'EPSG:4979',
      '-tr', String(TARGET_DEG), String(TARGET_DEG),
      '-r', 'bilinear', '-dstnodata', '-9999',
      '-multi', '-wo', 'NUM_THREADS=ALL_CPUS',
      '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE', '-co', 'PREDICTOR=3', '-co', 'BIGTIFF=YES',
      '-of', 'GTiff',
      inCache(tif()), inCache(tmp)], `gdalwarp ${lot}`);
  }));

  // Relabel = len GeoTIFF kľúče (EPSG:4979 → 2D EPSG:4326, aby to CTB zobral):
  // gdal_edit ich prepíše na mieste za sekundy; gdal_translate prekódovával celý
  // raster (LOT04 naživo: warp 29 min, translate po ďalších ~10 min stále na 30 %,
  // 1,6 GB torzo). Warp výstup má už rovnaké creation options, nič sa nestráca.
  step(`${lot} relabel EPSG:4326`, relabeled, () => {
    docker([GDAL_IMAGE, 'gdal_edit.py', '-a_srs', 'EPSG:4326', inCache(warped)], `gdal_edit ${lot}`);
    fs.renameSync(warped, relabeled);
  });

  // 3b. cleanup: rozbalený raster (~30 GB) a medzivýstup warp už netreba;
  // ZIP tiež nie (relabeled .tif je jediný vstup do únie a build je odtiaľ
  // resumovateľný bez sťahovania).
  step(`${lot} cleanup`, null, () => {
    for (const p of [lotDir, warped, KEEP_ZIP ? null : zip]) {
      if (!p || !fs.existsSync(p)) continue;
      fs.rmSync(p, { recursive: true, force: true });
      console.log(`  zmazané ${path.basename(p)}`);
    }
  });

  warped4326.push(relabeled);
}

// Union VRT + union maska (názvy nesú hash zoznamu LOT-ov).
const UNION_SUFFIX = STAGING.endsWith('sk-terrain-hires') ? '' : `_${LOT_SET_HASH}`;
const VRT = path.join(DMR6_DIR, `dmr6_union_4326${UNION_SUFFIX}.vrt`);
const MASK_BIL = path.join(DMR6_DIR, `dmr6_union_mask${UNION_SUFFIX}.bil`);
const MASK_META = path.join(DMR6_DIR, `dmr6_union_mask${UNION_SUFFIX}.json`);
const CTB_DONE = path.join(STAGING, '.ctb-done');
const PRUNE_REPORT = path.join(STAGING, 'prune-report.json');

step('union VRT', VRT, () => {
  docker([GDAL_IMAGE, 'gdalbuildvrt', '-vrtnodata', '-9999',
    inCache(VRT), ...warped4326.map(inCache)], `gdalbuildvrt ${LOTS.join('+')}`);
});

step('union maska platnosti (~10 m/px)', MASK_META, () => {
  // ~10 m/px masky: pri 2 LOT-och (~1,3°) 12 000 px; pri 16 LOT-och je únia
  // ~4° široká → 36 000 px, aby z18 dlaždica (~76 m) mala ~7 px rezervu.
  const maskPx = Math.max(12_000, Math.min(48_000, 9_000 * Math.ceil(Math.sqrt(warped4326.length))));
  docker([GDAL_IMAGE, 'gdal_translate', '-of', 'ENVI', '-ot', 'Byte',
    '-b', 'mask', '-outsize', String(maskPx), '0',
    inCache(VRT), inCache(MASK_BIL)], 'gdal_translate union maska');
  const hdr = fs.readFileSync(MASK_BIL.replace(/\.bil$/, '.hdr'), 'utf8');
  const dim = (key) => Number(hdr.match(new RegExp(`${key}\\s*=\\s*(\\d+)`))?.[1]);
  const info = spawnSync('docker', ['run', '--rm', '-v', `${CACHE_REAL}:/cache`, GDAL_IMAGE,
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
