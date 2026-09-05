// OKO — bake the bundled historical AIR-traffic density snapshot.
//
// Source: adsb.lol globe_history (github.com/adsblol/globe_history_2026), one
// day of readsb `heatmap/` slices — every aircraft the network heard, one
// position per aircraft per 10 s, 48 half-hour files. ODbL 1.0 + CC0 1.0
// (LICENSE-ODbL.txt / LICENSE-cc0.txt shipped inside the archive and copied
// into the bundle folder). HISTORICAL, one day, never live.
//
// readsb heatEntry (16 B, little-endian, packed):
//   int32 hex, int32 lat, int32 lon, int16 alt, int16 gs
//   lat/lon are degrees × 1e6.  Three non-position record kinds must be
//   skipped, all verified on real data 2026-09-05:
//   • separator: hex == 0x0e7f7c9d (one per 10-s interval; lon carries a time)
//   • info entry: lat >= 2^30 (squawk/callsign packed) — NOTE: test the SIGNED
//     value against 2^30, not `lat & (1<<30)`: negative latitudes have bit 30
//     set too and the naive mask erased the whole southern hemisphere.
//   • placeholder: lat == 0 && lon == 0 (one per separator)
//   Files are gzip (magic 1f8b) despite the .bin.ttf name.
//
// Same pipeline as the ship density: positions are COUNTED into a 0.25° grid
// (1440×720, full ±90), log-normalised between a floor and a ceiling
// percentile, painted as RGBA (alpha = intensity) in an AMBER ramp so it reads
// apart from the cyan ships. Zero cells are transparent.
//
// Ocean bridging (2026-09-05, user: "hustotu letov nevieš spraviť nad Atlantikom?"):
// terrestrial ADS-B has no mid-ocean receivers, so every airframe that leaves
// coverage at cruise and re-appears far away is followed across the hole along
// the GREAT CIRCLE between its last and first heard position, at the same 10-s
// cadence as real samples. Bridged only when the gap is ≥ 500 km, the implied
// speed is 500–1050 km/h (one continuous flight — never a landing and a later
// departure) and both ends are ≥ 10 000 ft. INTERPOLATED and labelled so in the
// panel row and the sidecar: real tracks (NAT organised tracks, weather routing)
// deviate from the great circle by up to a few hundred km. The clock is the
// separator record: lat = high 32 bits, lon = low 32 bits of Unix ms.
// Verified on the 2026-09-04 day: alt is int16 of feet/25 (cruise cluster
// 1320–1480 = FL330–370), gs is knots × 10.
//
// Usage:
//   1) download a day from the release page, concatenate the split tar,
//      extract ./heatmap ./LICENSE-ODbL.txt ./LICENSE-cc0.txt ./README.txt
//   2) AIR_DENSITY_HEATMAP_DIR=/path/extract node scripts/build-air-density.mjs
//      (AIR_DENSITY_DAY=2026-09-04 AIR_DENSITY_RELEASE=v2026.09.04-planes-readsb-prod-0)

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { normaliseGrid } from './build-ship-density.mjs';

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/data/local_data/air_density');
const OUT_PNG = path.join(OUT_DIR, 'air-density.png');
const OUT_JSON = path.join(OUT_DIR, 'air-density.json');
const SOURCE_MD = path.join(OUT_DIR, 'SOURCE.md');

export const HEAT_RECORD_BYTES = 16;
export const HEAT_SEPARATOR_HEX = 0x0e7f7c9d;
export const HEAT_INFO_LAT_MIN = 1 << 30;
export const HEAT_DEG_SCALE = 1e6;

const CELL_DEG = 0.25;
const COLS = Math.round(360 / CELL_DEG); // 1440
const ROWS = Math.round(180 / CELL_DEG); // 720
/** Percentile floor/ceiling for the log normalisation (see ship script). */
const FLOOR_PERCENTILE = 0.6;
const CEILING_PERCENTILE = 0.995;
const ALPHA_GAMMA = 1.4;

// ---- Ocean bridging ---------------------------------------------------------
/** readsb packs barometric altitude / 25 into the int16 (verified on real data). */
export const HEAT_ALT_FT_PER_UNIT = 25;
/** Shorter gaps are ordinary receiver hand-offs (≈300 km reach), not ocean holes. */
export const BRIDGE_MIN_KM = 500;
/** Implied-speed window for ONE continuous flight across the gap. */
export const BRIDGE_MIN_KMH = 500;
export const BRIDGE_MAX_KMH = 1050;
/** Both ends ≥ 10 000 ft (400 × 25) — never bridge a landing to the next departure. */
export const BRIDGE_MIN_ALT_UNITS = 400;
/** Synthetic samples at the same cadence as observed ones. */
export const BRIDGE_SAMPLE_MS = 10_000;
const EARTH_RADIUS_KM = 6371.0088;

/** Separator record carries Unix ms: lat = high 32 bits, lon = low 32 bits. */
export function heatSeparatorTimeMs(buf, o) {
  return buf.readUInt32LE(o + 4) * 4294967296 + buf.readUInt32LE(o + 8);
}

export function haversineKm(la0, lo0, la1, lo1) {
  const p = Math.PI / 180;
  const dLa = (la1 - la0) * p, dLo = (lo1 - lo0) * p;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la0 * p) * Math.cos(la1 * p) * Math.sin(dLo / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Grid cell index for a lat/lon (clamped to the grid). */
export function cellIndex(latDeg, lonDeg, cols = COLS, rows = ROWS, cellDeg = CELL_DEG) {
  let col = Math.floor((lonDeg + 180) / cellDeg);
  let row = Math.floor((90 - latDeg) / cellDeg);
  if (col >= cols) col = cols - 1; if (col < 0) col = 0;
  if (row >= rows) row = rows - 1; if (row < 0) row = 0;
  return row * cols + col;
}

/**
 * Should the hole between two consecutive positions of one airframe be bridged?
 * Pure — exported for tests. `prev`/`cur` = { lat, lon, alt (int16 units), t (ms) }.
 * @returns {{bridge:boolean, reason:'bridge'|'notime'|'short'|'slow'|'fast'|'low', km?:number, kmh?:number, dtMs?:number}}
 */
export function gapBridgeDecision(prev, cur) {
  if (!prev || prev.t == null || cur.t == null) return { bridge: false, reason: 'notime' };
  const km = haversineKm(prev.lat, prev.lon, cur.lat, cur.lon);
  if (km < BRIDGE_MIN_KM) return { bridge: false, reason: 'short', km };
  const dtMs = cur.t - prev.t;
  if (dtMs <= 0) return { bridge: false, reason: 'notime', km };
  const kmh = km / (dtMs / 3.6e6);
  if (kmh < BRIDGE_MIN_KMH) return { bridge: false, reason: 'slow', km, kmh };
  if (kmh > BRIDGE_MAX_KMH) return { bridge: false, reason: 'fast', km, kmh };
  if (prev.alt < BRIDGE_MIN_ALT_UNITS || cur.alt < BRIDGE_MIN_ALT_UNITS) return { bridge: false, reason: 'low', km, kmh };
  return { bridge: true, reason: 'bridge', km, kmh, dtMs };
}

/**
 * n interior points of the great circle from (la0,lo0) to (la1,lo1), evenly
 * spaced in arc — spherical linear interpolation on unit vectors, so the
 * antimeridian and the poles need no special casing. Returns Float64Array of
 * [lat, lon, lat, lon, …] in degrees. Pure — exported for tests.
 */
export function greatCirclePoints(la0, lo0, la1, lo1, n) {
  const p = Math.PI / 180;
  const toVec = (la, lo) => [Math.cos(la * p) * Math.cos(lo * p), Math.cos(la * p) * Math.sin(lo * p), Math.sin(la * p)];
  const a = toVec(la0, lo0), b = toVec(la1, lo1);
  const omega = Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  const sinO = Math.sin(omega);
  const out = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const f = (i + 1) / (n + 1);
    let x = a[0], y = a[1], z = a[2];
    if (sinO > 1e-9) {
      const wa = Math.sin((1 - f) * omega) / sinO, wb = Math.sin(f * omega) / sinO;
      x = wa * a[0] + wb * b[0]; y = wa * a[1] + wb * b[1]; z = wa * a[2] + wb * b[2];
    }
    out[i * 2] = Math.atan2(z, Math.hypot(x, y)) / p;
    out[i * 2 + 1] = Math.atan2(y, x) / p;
  }
  return out;
}

/**
 * Per-airframe tracker that paints bridged great-circle samples into its own
 * grid (kept apart from observed samples so the bake can report the share).
 */
export function createGapTracker(cols = COLS, rows = ROWS, cellDeg = CELL_DEG) {
  const last = new Map();
  const sum = new Float64Array(cols * rows);
  const stats = { gaps: 0, samples: 0, maxKm: 0, rejected: { notime: 0, slow: 0, fast: 0, low: 0 } };
  return {
    last, sum, stats,
    observe(hex, lat, lon, alt, t) {
      const cur = { lat, lon, alt, t };
      const prev = last.get(hex);
      last.set(hex, cur);
      if (!prev) return;
      const d = gapBridgeDecision(prev, cur);
      if (!d.bridge) { if (d.reason !== 'short') stats.rejected[d.reason] += 1; return; }
      const n = Math.max(1, Math.round(d.dtMs / BRIDGE_SAMPLE_MS) - 1);
      const pts = greatCirclePoints(prev.lat, prev.lon, lat, lon, n);
      for (let i = 0; i < n; i++) sum[cellIndex(pts[i * 2], pts[i * 2 + 1], cols, rows, cellDeg)] += 1;
      stats.gaps += 1; stats.samples += n; if (d.km > stats.maxKm) stats.maxKm = d.km;
    },
  };
}

/**
 * Classify one 16-byte heat record. Pure — exported for tests.
 * @returns {'separator'|'info'|'placeholder'|'bad'|'position'}
 */
export function classifyHeatRecord(hex, lat, lon) {
  if (hex === HEAT_SEPARATOR_HEX) return 'separator';
  if (lat >= HEAT_INFO_LAT_MIN) return 'info';
  if (lat === 0 && lon === 0) return 'placeholder';
  if (Math.abs(lat) > 90 * HEAT_DEG_SCALE || Math.abs(lon) > 180 * HEAT_DEG_SCALE) return 'bad';
  return 'position';
}

/**
 * Count positions from one decompressed slice into the grid. Pure over the
 * buffer — exported for tests.
 * @param {Buffer} buf gunzipped slice
 * @param {Float64Array} sum COLS*ROWS accumulator
 * @param {object} tally running counts per record kind
 * @param {ReturnType<typeof createGapTracker>|null} tracker optional ocean-bridging tracker
 */
export function accumulateHeatSlice(buf, sum, tally, cols = COLS, rows = ROWS, cellDeg = CELL_DEG, tracker = null) {
  let t = null; // wall clock of the current 10-s interval, from the last separator
  for (let o = 0; o + HEAT_RECORD_BYTES <= buf.length; o += HEAT_RECORD_BYTES) {
    const hex = buf.readUInt32LE(o);
    const lat = buf.readInt32LE(o + 4);
    const lon = buf.readInt32LE(o + 8);
    const kind = classifyHeatRecord(hex, lat, lon);
    tally[kind] = (tally[kind] || 0) + 1;
    if (kind === 'separator') { t = heatSeparatorTimeMs(buf, o); continue; }
    if (kind !== 'position') continue;
    const latDeg = lat / HEAT_DEG_SCALE;
    const lonDeg = lon / HEAT_DEG_SCALE;
    sum[cellIndex(latDeg, lonDeg, cols, rows, cellDeg)] += 1;
    if (tracker) tracker.observe(hex & 0xffffff, latDeg, lonDeg, buf.readInt16LE(o + 12), t);
  }
}

/** Amber heat ramp → RGBA; alpha = intensity^gamma. Pure — exported for tests. */
export function paintAmberRgba(norm, gamma = ALPHA_GAMMA) {
  const rgba = Buffer.alloc(norm.length * 4);
  for (let i = 0; i < norm.length; i++) {
    const a = norm[i];
    if (a <= 0) continue;
    const o = i * 4;
    // deep amber (150,80,0) → pale gold (255,225,150)
    rgba[o] = Math.round(150 + 105 * a);
    rgba[o + 1] = Math.round(80 + 145 * a);
    rgba[o + 2] = Math.round(0 + 150 * a);
    rgba[o + 3] = Math.round(255 * Math.pow(a, gamma));
  }
  return rgba;
}

async function main() {
  const dir = process.env.AIR_DENSITY_HEATMAP_DIR;
  const day = process.env.AIR_DENSITY_DAY || '2026-09-04';
  const release = process.env.AIR_DENSITY_RELEASE || 'v2026.09.04-planes-readsb-prod-0';
  if (!dir || !fs.existsSync(path.join(dir, 'heatmap'))) {
    console.error('[Build:AirDensity] AIR_DENSITY_HEATMAP_DIR must point at the extracted day (containing heatmap/)');
    process.exit(2);
  }
  const files = fs.readdirSync(path.join(dir, 'heatmap')).filter((f) => f.endsWith('.bin.ttf')).sort();
  if (!files.length) throw new Error('no heatmap slices found');
  const observed = new Float64Array(COLS * ROWS);
  const tally = {};
  const tracker = createGapTracker(); // per-airframe (24-bit address; upper hex bits are readsb flags)
  const t0 = Date.now();
  for (const [i, f] of files.entries()) {
    const buf = zlib.gunzipSync(fs.readFileSync(path.join(dir, 'heatmap', f)));
    accumulateHeatSlice(buf, observed, tally, COLS, ROWS, CELL_DEG, tracker);
    if (i % 8 === 0 || i === files.length - 1) console.log(`[Build:AirDensity] slice ${i + 1}/${files.length} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  if ((tally.bad || 0) > 0.001 * (tally.position || 1)) throw new Error(`too many out-of-range records: ${tally.bad}`);
  const aircraft = tracker.last;

  // observed + bridged → one grid; the bridged share is reported, never hidden
  const sum = new Float64Array(COLS * ROWS);
  let cellsOnlyBridged = 0, cellsObserved = 0;
  for (let i = 0; i < sum.length; i++) {
    sum[i] = observed[i] + tracker.sum[i];
    if (observed[i] > 0) cellsObserved += 1; else if (tracker.sum[i] > 0) cellsOnlyBridged += 1;
  }
  const bridged = {
    gaps: tracker.stats.gaps, samples: tracker.stats.samples,
    shareOfSamples: +(tracker.stats.samples / (tracker.stats.samples + (tally.position || 0))).toFixed(4),
    maxGapKm: Math.round(tracker.stats.maxKm), cellsOnlyBridged, cellsObserved,
    rejectedGaps: tracker.stats.rejected,
    rules: { minGapKm: BRIDGE_MIN_KM, speedKmh: [BRIDGE_MIN_KMH, BRIDGE_MAX_KMH], minAltFt: BRIDGE_MIN_ALT_UNITS * HEAT_ALT_FT_PER_UNIT, sampleIntervalS: BRIDGE_SAMPLE_MS / 1000, path: 'great circle between last and first heard position' },
  };
  console.log(`[Build:AirDensity] bridged ${bridged.gaps} gaps → ${bridged.samples} synthetic samples (${(bridged.shareOfSamples * 100).toFixed(1)} %), ${cellsOnlyBridged} cells bridged-only; rejected ${JSON.stringify(bridged.rejectedGaps)}`);

  const { norm, ceiling, floor, max, total, cellsNonzero } = normaliseGrid(sum, CEILING_PERCENTILE, FLOOR_PERCENTILE);
  const rgba = paintAmberRgba(norm);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await sharp(rgba, { raw: { width: COLS, height: ROWS, channels: 4 } }).png({ compressionLevel: 9, palette: false }).toFile(OUT_PNG);
  const sizeKb = Math.round(fs.statSync(OUT_PNG).size / 1024);

  // Licence + provenance copies travel with the bundle (ODbL notice retention).
  for (const name of ['LICENSE-ODbL.txt', 'LICENSE-cc0.txt', 'README.txt']) {
    const src = path.join(dir, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT_DIR, name === 'README.txt' ? 'README-adsblol.txt' : name));
  }

  const built = new Date().toISOString().split('T')[0];
  const bounds = { west: -180, east: 180, north: 90, south: -90 };
  const meta = {
    id: 'air-density',
    title: `Historical air-traffic density (adsb.lol, ${day})`,
    source: `adsb.lol globe_history_2026 · release ${release}`,
    license: 'ODbL 1.0 + CC0 1.0',
    period: day,
    day,
    release,
    valueMeaning: 'count of 10-second ADS-B position samples inside the cell (all aircraft heard by adsb.lol that day) + INTERPOLATED 10-second samples along the great circle wherever one airframe left coverage at cruise and re-appeared ≥ 500 km away at a plausible speed (ocean bridging — see stats.bridged)',
    grid: { cols: COLS, rows: ROWS, cellDeg: CELL_DEG, sampleIntervalS: 10 },
    bounds,
    stats: {
      slices: files.length, records: Object.values(tally).reduce((a, b) => a + b, 0), positions: tally.position || 0,
      separators: tally.separator || 0, infoEntries: tally.info || 0, placeholders: tally.placeholder || 0, badRecords: tally.bad || 0,
      uniqueAircraft: aircraft.size, cellsNonzero, total, max,
      ceilingPercentile: CEILING_PERCENTILE, ceiling, floorPercentile: FLOOR_PERCENTILE, floor, alphaGamma: ALPHA_GAMMA,
      bridged,
    },
    built,
  };
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  fs.writeFileSync(SOURCE_MD, `# Historical air-traffic density (adsb.lol, one day)

## Provenance
- **Source:** [adsb.lol globe_history_2026](https://github.com/adsblol/globe_history_2026), GitHub release \`${release}\` — the network's daily \`/var/globe_history\` dump (readsb). Day: **${day}**. The archive's own \`README.txt\` is kept here as \`README-adsblol.txt\`.
- **What a value is:** the **number of 10-second ADS-B position samples** inside a 0.25° cell for every aircraft adsb.lol heard that day (readsb \`heatmap/\` slices, 48 × 30 min). **Historical, one day, not live.** Coverage follows the feeder network: strong over Europe, North America and East Asia, weak over oceans and Africa — the picture is honest about flights *and* receivers.
- **License:** **ODbL 1.0 + CC0 1.0** (dual, as published in the repository and shipped inside the archive: \`LICENSE-ODbL.txt\`, \`LICENSE-cc0.txt\`, copied here). Attribution: "adsb.lol feeders".

## Ocean bridging (interpolation — the part that is NOT observed)
- Terrestrial ADS-B has no mid-ocean receivers. Every airframe that left coverage and re-appeared **≥ ${BRIDGE_MIN_KM} km** away at an implied speed of **${BRIDGE_MIN_KMH}–${BRIDGE_MAX_KMH} km/h** (one continuous flight, not a landing and a later departure) with both ends **≥ ${BRIDGE_MIN_ALT_UNITS * HEAT_ALT_FT_PER_UNIT} ft** is followed across the hole along the **great circle** between its last and first heard position, sampled every ${BRIDGE_SAMPLE_MS / 1000} s like the observed data.
- **${bridged.gaps.toLocaleString('en-US')} gaps bridged**, ${bridged.samples.toLocaleString('en-US')} synthetic samples = **${(bridged.shareOfSamples * 100).toFixed(1)} %** of all samples; ${cellsOnlyBridged.toLocaleString('en-US')} cells hold *only* interpolated samples (vs ${cellsObserved.toLocaleString('en-US')} with observations). Longest bridged gap ${bridged.maxGapKm.toLocaleString('en-US')} km. Rejected long gaps: ${JSON.stringify(bridged.rejectedGaps)}.
- **Caveat:** real ocean tracks (North Atlantic organised tracks, Pacific PACOTS, weather routing) deviate from the great circle by up to a few hundred km — the corridors are real flights of that day, their exact path over water is modelled. The panel row says so.

## Build (= the modification)
- **Built:** ${built} by \`scripts/build-air-density.mjs\`.
- Input: ${files.length} gzip slices (≈910 MB), ${meta.stats.records.toLocaleString('en-US')} records → ${meta.stats.positions.toLocaleString('en-US')} positions from ${aircraft.size.toLocaleString('en-US')} airframes; skipped ${meta.stats.separators} separators, ${meta.stats.infoEntries.toLocaleString('en-US')} info entries, ${meta.stats.placeholders} placeholders, ${meta.stats.badRecords} out-of-range.
- Record format: 16 B \`int32 hex, int32 lat, int32 lon, int16 alt, int16 gs\`, degrees × 1e6. Info entries are \`lat >= 2^30\` on the SIGNED value — the naive bit-30 mask also matches negative latitudes and erased the southern hemisphere on the first attempt.
- Transform: positions **counted** into a 0.25° grid (${COLS}×${ROWS}), then **log-normalised between a floor and a ceiling**: floor = ${(FLOOR_PERCENTILE * 100).toFixed(0)}th percentile of non-zero cells (${Math.round(floor).toLocaleString('en-US')} samples → transparent background), ceiling = ${(CEILING_PERCENTILE * 100).toFixed(1)}th (${Math.round(ceiling).toLocaleString('en-US')}; raw max ${Math.round(max).toLocaleString('en-US')}, clamped so hubs cannot dim the routes). Painted as RGBA, amber ramp, alpha = intensity^${ALPHA_GAMMA}.

## Content
- **Grid:** ${COLS} × ${ROWS} cells of ${CELL_DEG}°
- **Non-zero cells:** ${cellsNonzero.toLocaleString('en-US')}
- **Total samples:** ${Math.round(total).toLocaleString('en-US')} (observed ${(tally.position || 0).toLocaleString('en-US')} + bridged ${bridged.samples.toLocaleString('en-US')})
- **File size:** ~${sizeKb} KB (PNG)
`, 'utf8');

  console.log(`[Build:AirDensity] wrote ${OUT_PNG} (${sizeKb} KB) ${COLS}×${ROWS}; positions ${meta.stats.positions} (+${bridged.samples} bridged), aircraft ${aircraft.size}, cells ${cellsNonzero}, floor ${Math.round(floor)}, ceiling ${Math.round(ceiling)}, max ${Math.round(max)} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error('[Build:AirDensity] Failed:', err);
    process.exit(1);
  });
}
