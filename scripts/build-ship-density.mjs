// OKO — bake the bundled global historical ship-density snapshot.
//
// Source: World Bank Data Catalog 0037580 "Global Shipping Traffic Density"
// (IMF World Seaborne Trade Monitoring System; hourly AIS positions
// Jan 2015 – Feb 2021). CC BY 4.0. A cell value is the NUMBER OF AIS
// POSITIONS reported inside that 0.005° cell (moving + stationary ships),
// i.e. an intensity of shipping activity — historical, NOT live.
//
// The source raster is a 9.8 GB uncompressed tiled BigTIFF (72006×33998 px,
// int32, 128×128 tiles, nodata 2147483647). Bundling that is impossible, so
// this script sums 50×50 px blocks into a 0.25° grid (1440×680) — TRUE
// block totals, not averages, so an open-ocean lane 1 px wide survives — then
// log-normalises against the 99.5th percentile of non-zero cells and writes
// an RGBA PNG (alpha = intensity) the layer drapes as one textured primitive.
//
// No GeoTIFF dependency: the file is uncompressed + tiled, so plain fs reads
// suffice. `sharp` (already a devDependency) only encodes the 8-bit PNG.
//
// Usage:
//   1) download https://zenodo.org/records/16894236/files/shipdensity_global.zip?download=1
//      (534.9 MB, MD5 e8f98c56fa1306225b81558c0a23da21) and unzip it
//   2) SHIP_DENSITY_TIF=/path/shipdensity_global.tif node scripts/build-ship-density.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/data/local_data/ship_density');
const OUT_PNG = path.join(OUT_DIR, 'ship-density.png');
const OUT_JSON = path.join(OUT_DIR, 'ship-density.json');
const SOURCE_MD = path.join(OUT_DIR, 'SOURCE.md');

const ZENODO_URL = 'https://zenodo.org/records/16894236/files/shipdensity_global.zip?download=1';
const ZENODO_MD5 = 'e8f98c56fa1306225b81558c0a23da21';

/** Source raster facts (verified from the BigTIFF header, 2026-09-05). */
const NODATA = 2147483647;
const PIXEL_DEG = 0.005;
/** Pixel-EDGE origin (ModelTiepoint): the raster spans lat +85.0026 → −84.9874. */
const ORIGIN_WEST = -180.015311275;
const ORIGIN_NORTH = 85.002647937;

/** Output grid: 50 source px per cell → 0.25°. */
const BLOCK = 50;
const CELL_DEG = PIXEL_DEG * BLOCK;
/** Percentile of non-zero cells used as the log ceiling (port cells are 1000× lanes). */
const CEILING_PERCENTILE = 0.995;
/**
 * Percentile of non-zero cells used as the log FLOOR. Six years of satellite
 * AIS leave ≥1 position in 61 % of all cells, and ordinary open sea carries
 * 10⁵–10⁷ — normalising from zero painted every ocean a flat opaque cyan
 * (live finding 2026-09-05, Indian Ocean on OSM). Everything at or below the
 * floor is transparent: background sea vanishes, lanes and ports rise.
 */
const FLOOR_PERCENTILE = 0.6;
/** Alpha curve exponent — >1 keeps mid-intensity haze faint, ports hot. */
const ALPHA_GAMMA = 1.4;

const TAG = { W: 256, H: 257, TW: 322, TH: 323, TILE_OFFSETS: 324, TILE_COUNTS: 325, BPS: 258, COMPRESSION: 259, SAMPLE_FORMAT: 339 };
const TYPE_SIZE = { 3: 2, 4: 4, 16: 8 };

/** Parse the first IFD of a little-endian BigTIFF; returns tile geometry + offset arrays. */
export function readBigTiffLayout(fd) {
  const hdr = Buffer.alloc(16);
  fs.readSync(fd, hdr, 0, 16, 0);
  if (hdr.toString('ascii', 0, 2) !== 'II' || hdr.readUInt16LE(2) !== 43) {
    throw new Error('expected a little-endian BigTIFF (II, magic 43)');
  }
  const ifd = Number(hdr.readBigUInt64LE(8));
  const cnt = Buffer.alloc(8);
  fs.readSync(fd, cnt, 0, 8, ifd);
  const n = Number(cnt.readBigUInt64LE(0));
  const ents = Buffer.alloc(n * 20);
  fs.readSync(fd, ents, 0, n * 20, ifd + 8);
  const tags = {};
  for (let i = 0; i < n; i++) {
    const o = i * 20;
    const tag = ents.readUInt16LE(o);
    const typ = ents.readUInt16LE(o + 2);
    const count = Number(ents.readBigUInt64LE(o + 4));
    const inline = ents.readBigUInt64LE(o + 12);
    tags[tag] = { typ, count, inline, off: Number(inline), v32: Number(inline & 0xffffffffn) };
  }
  const need = (t) => { if (!tags[t]) throw new Error(`missing TIFF tag ${t}`); return tags[t]; };
  const readArray = (t) => {
    const sz = TYPE_SIZE[t.typ];
    if (!sz) throw new Error(`unsupported tag type ${t.typ}`);
    const b = Buffer.alloc(t.count * sz);
    fs.readSync(fd, b, 0, t.count * sz, t.off);
    const a = new Float64Array(t.count);
    for (let i = 0; i < t.count; i++) {
      a[i] = sz === 8 ? Number(b.readBigUInt64LE(i * 8)) : sz === 4 ? b.readUInt32LE(i * 4) : b.readUInt16LE(i * 2);
    }
    return a;
  };
  const layout = {
    width: need(TAG.W).v32,
    height: need(TAG.H).v32,
    tileW: need(TAG.TW).v32,
    tileH: need(TAG.TH).v32,
    compression: tags[TAG.COMPRESSION]?.v32 ?? 1,
    bitsPerSample: tags[TAG.BPS]?.v32 ?? 0,
    sampleFormat: tags[TAG.SAMPLE_FORMAT]?.v32 ?? 1,
    tileOffsets: readArray(need(TAG.TILE_OFFSETS)),
    tileByteCounts: readArray(need(TAG.TILE_COUNTS)),
  };
  if (layout.compression !== 1) throw new Error(`compressed TIFF (${layout.compression}) — this reader only handles uncompressed tiles`);
  if (layout.bitsPerSample !== 32 || layout.sampleFormat !== 2) throw new Error('expected int32 samples');
  return layout;
}

/**
 * Sum every valid source pixel into a coarse grid. Pure function over a
 * tile-reading callback so the aggregation is unit-testable without a 10 GB file.
 * @param {{width:number,height:number,tileW:number,tileH:number,tileOffsets:Float64Array}} layout
 * @param {(tileIndex:number, into:Buffer)=>void} readTile fills `into` with the tile bytes
 * @param {(rowsDone:number, rowsTotal:number)=>void} [onProgress]
 */
export function aggregateToGrid(layout, readTile, onProgress) {
  const { width, height, tileW, tileH } = layout;
  const cols = Math.floor(width / BLOCK);
  const rows = Math.ceil(height / BLOCK);
  const sum = new Float64Array(cols * rows);
  const across = Math.ceil(width / tileW);
  const down = Math.ceil(height / tileH);
  const tile = Buffer.alloc(tileW * tileH * 4);
  const maxX = cols * BLOCK;
  for (let ty = 0; ty < down; ty++) {
    for (let tx = 0; tx < across; tx++) {
      readTile(ty * across + tx, tile);
      const x0 = tx * tileW;
      const y0 = ty * tileH;
      for (let py = 0; py < tileH; py++) {
        const y = y0 + py;
        if (y >= height) break;
        const cy = Math.floor(y / BLOCK);
        for (let px = 0; px < tileW; px++) {
          const x = x0 + px;
          if (x >= maxX) break;
          const v = tile.readInt32LE((py * tileW + px) * 4);
          if (v <= 0 || v === NODATA) continue;
          sum[cy * cols + Math.floor(x / BLOCK)] += v;
        }
      }
    }
    if (onProgress && (ty % 10 === 0 || ty === down - 1)) onProgress(ty + 1, down);
  }
  return { cols, rows, sum };
}

/**
 * Log-normalise cell totals to 0..1 between a percentile FLOOR and CEILING.
 * Cells at or below the floor (ordinary background sea) map to 0 =
 * transparent; the ceiling clamps ports so they cannot dim the lanes. Pure.
 */
export function normaliseGrid(sum, percentile = CEILING_PERCENTILE, floorPercentile = FLOOR_PERCENTILE) {
  const nonzero = [];
  let total = 0;
  let max = 0;
  for (let i = 0; i < sum.length; i++) {
    const v = sum[i];
    if (v > 0) { nonzero.push(v); total += v; if (v > max) max = v; }
  }
  nonzero.sort((a, b) => a - b);
  const pick = (p) => (nonzero.length ? nonzero[Math.min(nonzero.length - 1, Math.floor(nonzero.length * p))] : 1);
  const ceiling = pick(percentile);
  const floor = Math.min(pick(floorPercentile), ceiling);
  const logFloor = Math.log1p(floor);
  const span = Math.max(1e-9, Math.log1p(ceiling) - logFloor);
  const out = new Float32Array(sum.length);
  for (let i = 0; i < sum.length; i++) {
    const v = sum[i];
    if (v <= floor) continue; // background sea (and zero) → transparent
    out[i] = Math.min(1, (Math.log1p(v) - logFloor) / span);
  }
  return { norm: out, ceiling, floor, max, total, cellsNonzero: nonzero.length };
}

/** Cyan heat ramp → RGBA bytes; alpha carries the intensity. Pure. */
export function paintRgba(norm) {
  const rgba = Buffer.alloc(norm.length * 4);
  for (let i = 0; i < norm.length; i++) {
    const a = norm[i];
    const o = i * 4;
    if (a <= 0) continue; // fully transparent — no sea/land tint at all
    // dark teal (0,120,160) → pale cyan (140,245,255); alpha eases in so
    // faint lanes read as haze, ports as hot cores.
    rgba[o] = Math.round(0 + 140 * a);
    rgba[o + 1] = Math.round(120 + 125 * a);
    rgba[o + 2] = Math.round(160 + 95 * a);
    rgba[o + 3] = Math.round(255 * Math.pow(a, ALPHA_GAMMA));
  }
  return rgba;
}

async function main() {
  const tifPath = process.env.SHIP_DENSITY_TIF;
  if (!tifPath || !fs.existsSync(tifPath)) {
    console.error('[Build:ShipDensity] SHIP_DENSITY_TIF must point at the extracted shipdensity_global.tif');
    console.error(`  download: ${ZENODO_URL}`);
    console.error(`  md5:      ${ZENODO_MD5}`);
    process.exit(2);
  }
  const fd = fs.openSync(tifPath, 'r');
  const layout = readBigTiffLayout(fd);
  console.log(`[Build:ShipDensity] ${layout.width}×${layout.height} int32, ${layout.tileOffsets.length} tiles of ${layout.tileW}×${layout.tileH}`);

  const t0 = Date.now();
  const { cols, rows, sum } = aggregateToGrid(layout, (i, into) => {
    fs.readSync(fd, into, 0, layout.tileByteCounts[i], layout.tileOffsets[i]);
  }, (done, total) => {
    const pct = ((100 * done) / total).toFixed(1);
    console.log(`[Build:ShipDensity] tile rows ${done}/${total} (${pct}%) ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  });
  fs.closeSync(fd);

  const { norm, ceiling, floor, max, total, cellsNonzero } = normaliseGrid(sum);
  const rgba = paintRgba(norm);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  await sharp(rgba, { raw: { width: cols, height: rows, channels: 4 } })
    .png({ compressionLevel: 9, palette: false })
    .toFile(OUT_PNG);
  const sizeKb = Math.round(fs.statSync(OUT_PNG).size / 1024);

  const bounds = {
    west: ORIGIN_WEST,
    east: ORIGIN_WEST + cols * CELL_DEG,
    north: ORIGIN_NORTH,
    south: ORIGIN_NORTH - rows * CELL_DEG,
  };
  const built = new Date().toISOString().split('T')[0];
  const meta = {
    id: 'ship-density',
    title: 'Global Shipping Traffic Density (historical, 2015–2021)',
    source: 'World Bank Data Catalog 0037580 · IMF World Seaborne Trade Monitoring System',
    license: 'CC BY 4.0',
    period: '2015-01 to 2021-02',
    valueMeaning: 'sum of AIS positions reported inside the cell (moving + stationary ships)',
    grid: { cols, rows, cellDeg: CELL_DEG, sourcePixelDeg: PIXEL_DEG, blockPx: BLOCK },
    bounds,
    stats: {
      cellsNonzero, total, max,
      ceilingPercentile: CEILING_PERCENTILE, ceiling,
      floorPercentile: FLOOR_PERCENTILE, floor,
      alphaGamma: ALPHA_GAMMA,
    },
    built,
    zenodo: { url: ZENODO_URL, md5: ZENODO_MD5 },
  };
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  fs.writeFileSync(SOURCE_MD, `# Global Shipping Traffic Density (historical snapshot)

## Provenance
- **Source:** [World Bank Data Catalog 0037580 — Global Shipping Traffic Density](https://datacatalog.worldbank.org/search/dataset/0037580/Global-Shipping-Traffic-Density), obtained via the World Bank's partnership with the IMF (World Seaborne Trade Monitoring System). Stable archive used for the build: Zenodo record 16894236 (\`shipdensity_global.zip\`, 534.9 MB, MD5 \`${ZENODO_MD5}\`).
- **Citation:** Cerdeiro, Komaromi, Liu, Saeed (2020), *World Seaborne Trade in Real Time: A Proof of Concept for Building AIS-based Nowcasts from Scratch*, IMF WP/20/57.
- **What a value is:** the **number of AIS positions** reported by ships inside a 0.005° cell between **Jan 2015 and Feb 2021** — moving and stationary ships alike, so it reads as *intensity of shipping activity*. **Historical, not live.** Terrestrial + satellite AIS as collected by the IMF pipeline; it is not a measure of our live feed's coverage.
- **License:** **CC BY 4.0** (stated on both the World Bank catalog entry and the Zenodo record). Attribution required; modifications must be indicated — see below.

## Build (= the modification)
- **Built:** ${built} by \`scripts/build-ship-density.mjs\`.
- Source raster: 72006×33998 px int32 BigTIFF (uncompressed, 128×128 tiles, nodata 2147483647), 9.8 GB. Not bundled.
- Transform: 50×50 px blocks are **summed** into a 0.25° grid (${cols}×${rows}) — true block totals, so a 1-px open-ocean lane survives — then **log-normalised between a floor and a ceiling**: the floor is the ${(FLOOR_PERCENTILE * 100).toFixed(0)}th percentile of non-zero cells (${Math.round(floor).toLocaleString('en-US')} positions — ordinary background sea, rendered fully transparent so the basemap shows through), the ceiling the ${(CEILING_PERCENTILE * 100).toFixed(1)}th percentile (${Math.round(ceiling).toLocaleString('en-US')} positions; raw max ${Math.round(max).toLocaleString('en-US')}, clamped so ports cannot dim the lanes). Painted as an RGBA PNG whose alpha is intensity^${ALPHA_GAMMA} (mid-range stays faint haze, ports hot). Zero cells and everything at or below the floor are fully transparent.
- Raster extent: lon ${bounds.west.toFixed(4)} → ${bounds.east.toFixed(4)}, lat ${bounds.north.toFixed(4)} → ${bounds.south.toFixed(4)} (the source stops at ±85°).

## Known artefacts (in the SOURCE data — not build bugs)
- **Zero block over the central Sahara / N. Africa** (~lon 10–40, lat 15–35): the IMF raster holds exact zeros there instead of the usual land noise. Land is transparent in the drape anyway, so it is invisible in-app; noted so nobody hunts for a tiling bug.
- **Speckle over land**: sparse non-zero cells inland are real river/lake traffic (Rhine, Danube, Mississippi, Yangtze, Great Lakes…) plus AIS position noise/spoofing. Kept as data; below the normalisation floor they are transparent.
- **Coverage ends at ±85°**: the source raster does not reach the poles (see extent above).

## Content
- **Grid:** ${cols} × ${rows} cells of ${CELL_DEG}°
- **Non-zero cells:** ${cellsNonzero.toLocaleString('en-US')}
- **Total positions:** ${Math.round(total).toLocaleString('en-US')}
- **File size:** ~${sizeKb} KB (PNG)
`, 'utf8');

  console.log(`[Build:ShipDensity] wrote ${OUT_PNG} (${sizeKb} KB), ${cols}×${rows}, ${cellsNonzero} non-zero cells, ceiling ${Math.round(ceiling)} (max ${Math.round(max)}) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error('[Build:ShipDensity] Failed:', err);
    process.exit(1);
  });
}
