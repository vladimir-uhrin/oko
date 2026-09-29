// src/data/geoid.js — bundled EGM96 geoid-undulation lookup.
//
// h = H + N: the globe (Cesium ellipsoid) needs ELLIPSOIDAL height (h);
// most real-world elevation sources (barometric altitude, MSL survey data,
// Caltrans/TfL camera priors) give ORTHOMETRIC height (H, "height above mean
// sea level"). N is the local geoid undulation — the gap between the WGS84
// ellipsoid and the geoid (~mean sea level) surface, ranging roughly
// -106..+85 m worldwide. See docs/CURRENT-STATE.md.
//
// Mriežka (2026-09-29, „rýchlejší štart"): EGM96 30' (361 × 720) zo zbaleného
// modulu local_data/geoid/egm96-30min.js (generuje scripts/build-geoid-grid.mjs
// z balíka egm96-universal, pôvod v SOURCE.md), čítaná bikubicky (Catmull-Rom).
// Voči predošlej plnej 15' mriežke egm96-universal (bilineárne): RMS 5 cm,
// max 1,0 m na svete, 0,57 m v Európe — pod presnosťou výšok, ktoré geoid
// opravuje. Prenos klesol z 1,85 MB na ~194 KB gzip. Lazy dynamic import
// ostáva: dáta sú v samostatnom chunku, nie v hlavnom balíku.

let grid = null;
let readyPromise = null;

/**
 * Lazily loads the EGM96 grid (dynamic import — code-split by Vite so the
 * grid stays out of the eager main bundle). Safe to call many times; the
 * underlying import only happens once and subsequent calls resolve
 * immediately from the cached promise.
 * @returns {Promise<void>}
 */
export async function ensureGeoidReady() {
  if (!readyPromise) {
    readyPromise = import('./local_data/geoid/egm96-30min.js').then((mod) => {
      grid = decodeGeoidGrid(mod.default);
    });
  }
  return readyPromise;
}

/**
 * Dekóduje zbalenú mriežku (base64, decimetre, rozdiely v riadku, nízke
 * a vysoké bajty v dvoch blokoch — scripts/lib/geoidGrid.mjs). Pure.
 * @param {{rows: number, cols: number, stepDeg: number, scale: number, data: string}} packed
 * @returns {{rows: number, cols: number, stepDeg: number, values: Float32Array}}
 */
export function decodeGeoidGrid({ rows, cols, stepDeg, scale, data }) {
  const bin = atob(data);
  const n = rows * cols;
  if (bin.length !== n * 2) throw new Error(`geoid.js: mriežka má ${bin.length} B, čakám ${n * 2}`);
  const values = new Float32Array(n);
  for (let r = 0; r < rows; r++) {
    let acc = 0;
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      let d = bin.charCodeAt(i) | (bin.charCodeAt(n + i) << 8);
      if (d & 0x8000) d -= 0x10000;
      acc = c === 0 ? d : acc + d;
      values[i] = acc * scale;
    }
  }
  return { rows, cols, stepDeg, values };
}

/** Catmull-Rom medzi p1 a p2 (t ∈ [0, 1]); v uzloch presne hodnota uzla. */
function catmullRom(p0, p1, p2, p3, t) {
  return 0.5 * ((2 * p1) + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * (p1 - p2) + p3 - p0) * t * t * t);
}

/**
 * N v bode mriežky: bikubicky zo 4 × 4 susedov, riadky orezané na póloch,
 * stĺpce dookola (dĺžka sa zabalí). Pure nad dekódovanou mriežkou.
 * @param {{rows: number, cols: number, stepDeg: number, values: Float32Array}} g
 * @param {number} latDeg
 * @param {number} lonDeg
 * @returns {number}
 */
export function sampleGeoidGrid(g, latDeg, lonDeg) {
  const { rows, cols, stepDeg, values } = g;
  let r = (90 - latDeg) / stepDeg;
  if (r < 0) r = 0; else if (r > rows - 1) r = rows - 1;
  let c = (lonDeg / stepDeg) % cols;
  if (c < 0) c += cols;
  let r0 = Math.floor(r);
  if (r0 > rows - 2) r0 = rows - 2;
  const c0 = Math.floor(c);
  const fr = r - r0;
  const fc = c - c0;
  const rowVal = (rr) => {
    const row = (rr < 0 ? 0 : rr > rows - 1 ? rows - 1 : rr) * cols;
    const cm = c0 === 0 ? cols - 1 : c0 - 1;
    const c1 = c0 + 1 >= cols ? c0 + 1 - cols : c0 + 1;
    const c2 = c0 + 2 >= cols ? c0 + 2 - cols : c0 + 2;
    return catmullRom(values[row + cm], values[row + c0], values[row + c1], values[row + c2], fc);
  };
  return catmullRom(rowVal(r0 - 1), rowVal(r0), rowVal(r0 + 1), rowVal(r0 + 2), fr);
}

/**
 * Geoid undulation N at a given point, in metres, relative to the WGS84
 * ellipsoid (positive = geoid above ellipsoid). Throws if
 * `ensureGeoidReady()` has not resolved yet.
 * @param {number} latDeg
 * @param {number} lonDeg
 * @returns {number}
 */
export function geoidHeight(latDeg, lonDeg) {
  if (!grid) {
    throw new Error(
      'geoid.js: geoidHeight() called before ensureGeoidReady() resolved — ' +
        'await ensureGeoidReady() first.'
    );
  }
  return sampleGeoidGrid(grid, latDeg, lonDeg);
}

/**
 * Converts an orthometric (mean-sea-level) height to an ellipsoidal
 * (WGS84 globe-relative) height: h = H + N.
 * @param {number} hMslM - orthometric height in metres (height above MSL)
 * @param {number} latDeg
 * @param {number} lonDeg
 * @returns {number} ellipsoidal height in metres
 */
export function orthometricToEllipsoidal(hMslM, latDeg, lonDeg) {
  return hMslM + geoidHeight(latDeg, lonDeg);
}

/**
 * READOUT-ONLY inverse of {@link orthometricToEllipsoidal}: H = h - N.
 *
 * Cesium reports camera and entity heights against the WGS84 ELLIPSOID, but a
 * viewer reads "ALT" as height above mean sea level — so over San Francisco
 * (N ≈ -32 m) a camera sitting 17 m above the SFO deck reports a startling
 * -15 m until the undulation is taken back out.
 *
 * Takes N as an argument instead of calling {@link geoidHeight} itself, so it
 * stays a pure function a display surface can call every tick against a cached
 * cell, and so it degrades safely: a non-finite N (grid still loading, or the
 * lazy import failed) returns the UNCORRECTED height rather than NaN — a
 * readout that is ~30 m off for a beat beats a readout that blanks.
 *
 * This converts the DATUM of a height that is ALREADY ellipsoidal. It must
 * never be applied to a barometric/aviation altitude: those are MSL-referenced
 * already, and subtracting N there would introduce the very error it removes
 * here, sign-flipped.
 *
 * @param {number} hEllipsoidalM - height above the WGS84 ellipsoid, in metres
 * @param {number|null|undefined} geoidUndulationM - N at that point, in metres
 * @returns {number} height above MSL in metres, or the input when N is unknown
 */
export function ellipsoidalToMslDisplayM(hEllipsoidalM, geoidUndulationM) {
  if (!Number.isFinite(hEllipsoidalM)) return hEllipsoidalM;
  if (!Number.isFinite(geoidUndulationM)) return hEllipsoidalM;
  return hEllipsoidalM - geoidUndulationM;
}
