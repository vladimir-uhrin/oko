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

/** Display threshold: echoes below this dBZ stay fully transparent. */
export const ZMAX_MIN_DISPLAY_DBZ = 4;

/**
 * dBZ → RGBA stops, ascending. Conventional radar ramp: greens (light rain)
 * through yellow/orange (showers) and red (heavy rain / hail risk) to
 * magenta/white (extreme cores).
 * @type {Array<{min: number, rgba: [number, number, number, number]}>}
 */
export const ZMAX_DBZ_PALETTE = [
  { min: 4, rgba: [110, 210, 110, 185] },
  { min: 12, rgba: [40, 160, 70, 200] },
  { min: 20, rgba: [250, 220, 70, 210] },
  { min: 28, rgba: [250, 160, 40, 220] },
  { min: 35, rgba: [235, 75, 45, 230] },
  { min: 44, rgba: [175, 25, 90, 240] },
  { min: 52, rgba: [230, 65, 230, 250] },
  { min: 60, rgba: [255, 255, 255, 255] },
];

/**
 * Color for one dBZ value, or null when below the display threshold.
 * @param {number} dbz
 * @returns {[number, number, number, number]|null}
 */
export function dbzColor(dbz) {
  if (!Number.isFinite(dbz) || dbz < ZMAX_MIN_DISPLAY_DBZ) return null;
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
export function rasterizeZmax(raw, meta) {
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
      const color = dbzColor(gain * value + offset);
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
