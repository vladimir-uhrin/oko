/**
 * SHMÚ radar composite (ODIM_H5 SKCOMP) — pure grid helpers.
 *
 * Server-side decode support for the `/api/shmu/radar` proxy (vite.config.js)
 * and its unit tests. This module is pure math on plain values and typed
 * arrays — no Cesium, no Node APIs, no HDF5 reader — mirroring the
 * `firmsCsv.js` pattern of sharing parse logic between the dev-server proxy
 * and the test suite. The client layer (`shmuRadar.js`) never imports it.
 *
 * Product: `zmax` (column-maximum reflectivity, quantity DBZH) from
 * opendata.shmu.sk, an ODIM composite on a spherical Mercator grid
 * (`+proj=merc +lon_0=18.7 +lat_ts=48.43 +ellps=sphere`). The corner
 * attributes give a plain lon/lat bounding box; longitude is linear in x,
 * but latitude is Mercator in y — `mercatorRowLut` resamples rows so the
 * output image is linear in latitude and can be draped on a plain
 * lon/lat rectangle without the up-to-~8 km vertical misplacement that
 * draping the raw grid would cause.
 */

/**
 * Display threshold: echoes below this dBZ stay fully transparent. 8 dBZ
 * deliberately sits above the bulk of nocturnal clear-air/biological returns
 * (typically < ~10 dBZ) while keeping drizzle bands — below this the dry-day
 * composite reads as dirt sprayed across the country, not weather.
 */
export const ZMAX_MIN_DISPLAY_DBZ = 8;

/**
 * dBZ → RGBA stops, ascending. Conventional radar ramp: greens (light rain)
 * through yellow/orange (showers) and red (heavy rain / hail risk) to
 * magenta/white (extreme cores).
 * @type {Array<{min: number, rgba: [number, number, number, number]}>}
 */
export const ZMAX_DBZ_PALETTE = [
  { min: 8, rgba: [96, 208, 130, 150] },
  { min: 15, rgba: [46, 172, 84, 175] },
  { min: 20, rgba: [250, 220, 70, 200] },
  { min: 28, rgba: [250, 160, 40, 215] },
  { min: 35, rgba: [235, 75, 45, 230] },
  { min: 44, rgba: [175, 25, 90, 240] },
  { min: 52, rgba: [230, 65, 230, 250] },
  { min: 60, rgba: [255, 255, 255, 255] },
];

/**
 * Legend model derived from the SAME palette the rasterizer paints with —
 * the on-screen legend can therefore never drift from the actual colors.
 * @returns {Array<{min: number, css: string}>} Ascending dBZ stops with CSS colors.
 */
export function radarLegendStops() {
  return ZMAX_DBZ_PALETTE.map(({ min, rgba: [r, g, b, a] }) => ({
    min,
    css: `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`,
  }));
}

/**
 * Color for one dBZ value, or null when below the display threshold.
 * @param {number} dbz
 * @returns {[number, number, number, number]|null}
 */
export function dbzColor(dbz, minDisplayDbz = ZMAX_MIN_DISPLAY_DBZ) {
  if (!Number.isFinite(dbz) || dbz < minDisplayDbz) return null;
  let hit = null;
  for (const stop of ZMAX_DBZ_PALETTE) {
    if (dbz >= stop.min) hit = stop.rgba;
    else break;
  }
  return hit;
}

/**
 * Validate and normalize the ODIM attributes this product needs.
 *
 * @param {object} input
 * @param {object} input.where - Root `/where` attrs (corners, sizes).
 * @param {object} input.datasetWhat - `/dataset1/what` attrs (gain/offset/…).
 * @returns {{width: number, height: number, gain: number, offset: number,
 *   undetectRaw: number, nodataRaw: number,
 *   bounds: {west: number, south: number, east: number, north: number}}}
 * @throws {Error} When a required attribute is missing or non-finite.
 */
export function normalizeOdimComposite({ where = {}, datasetWhat = {} } = {}) {
  const num = (v, label) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`ODIM composite: missing/invalid ${label}`);
    return n;
  };
  const width = Math.trunc(num(where.xsize, 'where/xsize'));
  const height = Math.trunc(num(where.ysize, 'where/ysize'));
  if (width <= 0 || height <= 0) throw new Error('ODIM composite: non-positive grid size');

  // Corner attrs are per-corner; the drape box is their envelope.
  const west = Math.min(num(where.LL_lon, 'where/LL_lon'), num(where.UL_lon, 'where/UL_lon'));
  const east = Math.max(num(where.LR_lon, 'where/LR_lon'), num(where.UR_lon, 'where/UR_lon'));
  const south = Math.min(num(where.LL_lat, 'where/LL_lat'), num(where.LR_lat, 'where/LR_lat'));
  const north = Math.max(num(where.UL_lat, 'where/UL_lat'), num(where.UR_lat, 'where/UR_lat'));
  if (!(west < east && south < north)) throw new Error('ODIM composite: degenerate bounds');

  // nodata is declared as a signed value (-1) but the payload is <u1 — mask
  // both sentinels into the byte domain the raw array actually uses.
  const toByte = (v) => ((Math.trunc(v) % 256) + 256) % 256;
  return {
    width,
    height,
    gain: num(datasetWhat.gain, 'dataset1/what/gain'),
    offset: num(datasetWhat.offset, 'dataset1/what/offset'),
    undetectRaw: toByte(num(datasetWhat.undetect, 'dataset1/what/undetect')),
    nodataRaw: toByte(num(datasetWhat.nodata, 'dataset1/what/nodata')),
    bounds: { west, south, east, north },
  };
}

/** Spherical Mercator vertical coordinate. */
function mercatorPsi(latDeg) {
  return Math.log(Math.tan(Math.PI / 4 + (latDeg * Math.PI / 180) / 2));
}

/**
 * Row lookup table: output row (linear in latitude, row 0 = north) →
 * source row (linear in Mercator ψ, row 0 = north). Nearest neighbor.
 *
 * @param {number} height - Grid height in rows (source and output alike).
 * @param {number} south - Southern bound, degrees.
 * @param {number} north - Northern bound, degrees.
 * @returns {Int32Array}
 */
export function mercatorRowLut(height, south, north) {
  const lut = new Int32Array(height);
  const psiN = mercatorPsi(north);
  const psiS = mercatorPsi(south);
  const span = psiN - psiS;
  for (let row = 0; row < height; row++) {
    // Latitude at the centre of this output row (linear in degrees).
    const lat = north - ((row + 0.5) / height) * (north - south);
    const frac = (psiN - mercatorPsi(lat)) / span;
    let src = Math.round(frac * height - 0.5);
    if (src < 0) src = 0;
    else if (src >= height) src = height - 1;
    lut[row] = src;
  }
  return lut;
}

/**
 * Rasterize a zmax composite into an RGBA image that is linear in latitude.
 *
 * @param {Uint8Array|Uint8ClampedArray|number[]} raw - width×height bytes, row 0 = north.
 * @param {ReturnType<typeof normalizeOdimComposite>} meta
 * @returns {{rgba: Uint8ClampedArray, echoPixels: number}} `echoPixels` counts
 *   cells at/above the display threshold — the layer's honest "how much echo".
 */
export function rasterizeZmax(raw, meta, { minDisplayDbz = ZMAX_MIN_DISPLAY_DBZ } = {}) {
  const { width, height, gain, offset, undetectRaw, nodataRaw, bounds } = meta;
  if (!raw || raw.length !== width * height) {
    throw new Error(`ODIM composite: data length ${raw?.length} != ${width * height}`);
  }
  const lut = mercatorRowLut(height, bounds.south, bounds.north);
  const rgba = new Uint8ClampedArray(width * height * 4);
  let echoPixels = 0;
  for (let row = 0; row < height; row++) {
    const srcBase = lut[row] * width;
    const outBase = row * width * 4;
    for (let col = 0; col < width; col++) {
      const value = raw[srcBase + col];
      if (value === undetectRaw || value === nodataRaw) continue;
      const color = dbzColor(gain * value + offset, minDisplayDbz);
      if (!color) continue;
      const at = outBase + col * 4;
      rgba[at] = color[0];
      rgba[at + 1] = color[1];
      rgba[at + 2] = color[2];
      rgba[at + 3] = color[3];
      echoPixels++;
    }
  }
  return { rgba, echoPixels };
}

/**
 * Drop incoherent echo cells (clear-air returns, insects, clutter) from the
 * raw grid. A cell survives only when at least `minNeighbors` other
 * displayable echoes sit within its `radius`-cell window — real precipitation
 * is spatially coherent, speckle is not. The defaults (5×5 window, ≥6
 * neighbors) let a ≥3×3 cluster — a real shower core at this grid's
 * ~330×480 m cells — through, while 1–4-cell biological clumps die. On a dry
 * summer day this is the difference between a readable overlay and dirt
 * sprayed across the country.
 *
 * @param {Uint8Array|Uint8ClampedArray} raw - width×height bytes (row 0 = north).
 * @param {ReturnType<typeof normalizeOdimComposite>} meta
 * @param {{minNeighbors?: number, radius?: number}} [opts]
 * @returns {Uint8Array} New grid with speckle cells reset to `undetectRaw`.
 */
export function despeckleZmax(raw, meta, { minNeighbors = 6, radius = 2, minDisplayDbz = ZMAX_MIN_DISPLAY_DBZ } = {}) {
  const { width, height, gain, offset, undetectRaw, nodataRaw } = meta;
  // Raw value at/above which a cell is a displayable echo.
  const thresholdRaw = Math.ceil((minDisplayDbz - offset) / gain);
  const isEcho = (v) => v !== undetectRaw && v !== nodataRaw && v >= thresholdRaw;
  const out = Uint8Array.from(raw);
  for (let row = 0; row < height; row++) {
    const base = row * width;
    for (let col = 0; col < width; col++) {
      const v = raw[base + col];
      if (!isEcho(v)) continue;
      let neighbors = 0;
      for (let dr = -radius; dr <= radius && neighbors < minNeighbors; dr++) {
        const r = row + dr;
        if (r < 0 || r >= height) continue;
        const nBase = r * width;
        for (let dc = -radius; dc <= radius; dc++) {
          if (dr === 0 && dc === 0) continue;
          const c = col + dc;
          if (c < 0 || c >= width) continue;
          if (isEcho(raw[nBase + c])) neighbors++;
        }
      }
      if (neighbors < minNeighbors) out[base + col] = undetectRaw;
    }
  }
  return out;
}

/**
 * Soften a sparse RGBA raster into smooth blobs: one max-dilation pass grows
 * single cells to visible size, then a separable box blur (run `passes`
 * times ≈ gaussian) feathers the edges. Blur runs on PREMULTIPLIED channels —
 * blurring straight RGBA against transparent black smears dark fringes
 * around every echo, which reads as mold rather than rain.
 *
 * @param {Uint8ClampedArray} rgba - width×height×4, transparent background.
 * @param {number} width
 * @param {number} height
 * @param {{dilate?: number, blurRadius?: number, passes?: number}} [opts]
 * @returns {Uint8ClampedArray} New softened raster (input untouched).
 */
export function softenRgba(rgba, width, height, { dilate = 1, blurRadius = 2, passes = 2 } = {}) {
  const px = width * height;
  // Premultiply into float buffers (alpha-weighted color).
  let cr = new Float32Array(px);
  let cg = new Float32Array(px);
  let cb = new Float32Array(px);
  let ca = new Float32Array(px);
  for (let i = 0; i < px; i++) {
    const a = rgba[i * 4 + 3] / 255;
    if (a === 0) continue;
    cr[i] = rgba[i * 4] * a;
    cg[i] = rgba[i * 4 + 1] * a;
    cb[i] = rgba[i * 4 + 2] * a;
    ca[i] = a;
  }

  if (dilate > 0) {
    const dr2 = new Float32Array(px);
    const dg2 = new Float32Array(px);
    const db2 = new Float32Array(px);
    const da2 = new Float32Array(px);
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        let br = 0; let bg = 0; let bb = 0; let ba = -1;
        for (let dr = -dilate; dr <= dilate; dr++) {
          const r = row + dr;
          if (r < 0 || r >= height) continue;
          for (let dc = -dilate; dc <= dilate; dc++) {
            const c = col + dc;
            if (c < 0 || c >= width) continue;
            const i = r * width + c;
            if (ca[i] > ba) { ba = ca[i]; br = cr[i]; bg = cg[i]; bb = cb[i]; }
          }
        }
        const o = row * width + col;
        dr2[o] = br; dg2[o] = bg; db2[o] = bb; da2[o] = Math.max(ba, 0);
      }
    }
    cr = dr2; cg = dg2; cb = db2; ca = da2;
  }

  // Separable box blur, horizontal then vertical, repeated `passes` times.
  const blurAxis = (src, horizontal) => {
    const out = new Float32Array(px);
    const window = 2 * blurRadius + 1;
    const lineLen = horizontal ? width : height;
    const lines = horizontal ? height : width;
    for (let line = 0; line < lines; line++) {
      const at = (i) => (horizontal ? line * width + i : i * width + line);
      let sum = 0;
      for (let i = -blurRadius; i <= blurRadius; i++) {
        sum += src[at(Math.min(lineLen - 1, Math.max(0, i)))];
      }
      for (let i = 0; i < lineLen; i++) {
        out[at(i)] = sum / window;
        const drop = Math.max(0, i - blurRadius);
        const add = Math.min(lineLen - 1, i + blurRadius + 1);
        sum += src[at(add)] - src[at(drop)];
      }
    }
    return out;
  };
  for (let pass = 0; pass < passes; pass++) {
    cr = blurAxis(cr, true); cr = blurAxis(cr, false);
    cg = blurAxis(cg, true); cg = blurAxis(cg, false);
    cb = blurAxis(cb, true); cb = blurAxis(cb, false);
    ca = blurAxis(ca, true); ca = blurAxis(ca, false);
  }

  // Unpremultiply back into bytes.
  const out = new Uint8ClampedArray(px * 4);
  for (let i = 0; i < px; i++) {
    const a = ca[i];
    if (a <= 1 / 255) continue;
    out[i * 4] = cr[i] / a;
    out[i * 4 + 1] = cg[i] / a;
    out[i * 4 + 2] = cb[i] / a;
    out[i * 4 + 3] = a * 255;
  }
  return out;
}

/**
 * Full presentation pipeline for one zmax composite: despeckle the raw grid,
 * rasterize (Mercator→linear latitude + dBZ palette), then soften into
 * readable blobs. The one entry point the proxy uses; the primitives stay
 * exported for focused tests.
 *
 * @param {Uint8Array|Uint8ClampedArray} raw
 * @param {ReturnType<typeof normalizeOdimComposite>} meta
 * @returns {{rgba: Uint8ClampedArray, echoPixels: number}} `echoPixels` counts
 *   displayable cells AFTER despeckle (before softening spreads them).
 */
export function renderZmax(raw, meta, opts = {}) {
  const cleaned = despeckleZmax(raw, meta, opts);
  const { rgba, echoPixels } = rasterizeZmax(cleaned, meta, opts);
  return { rgba: softenRgba(rgba, meta.width, meta.height), echoPixels };
}

/**
 * Parse ODIM `what` date/time attrs ("YYYYMMDD", "HHMMSS") into an ISO-8601
 * UTC timestamp, or null when malformed.
 * @param {string} date
 * @param {string} time
 * @returns {string|null}
 */
export function odimTimestampIso(date, time) {
  const d = String(date ?? '').replace(/\0+$/, '').trim();
  const t = String(time ?? '').replace(/\0+$/, '').trim();
  if (!/^\d{8}$/.test(d) || !/^\d{6}$/.test(t)) return null;
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}
