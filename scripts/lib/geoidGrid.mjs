// scripts/lib/geoidGrid.mjs
// Kódovanie mriežky geoidu EGM96 pre prehliadač (2026-09-29, bod 8 „rýchlejší štart").
//
// Predtým: balík egm96-universal s plnou mriežkou 15' (721 × 1440 bodov, int16 cm
// v base64) — 2,77 MB textu, cez Cloudflare 1,85 MB gzip, načítaný hneď po glóbuse
// a súperiaci o pásmo s 3D dlaždicami. Teraz mriežka 30' (361 × 720) čítaná
// bikubicky (Catmull-Rom): voči 15' bilineárnej RMS 5 cm, max 1,0 m (Európa
// 0,57 m) — pod presnosťou výšok, ktoré geoid opravuje (barometrická výška po
// 25 ft, hladina mora ± príliv). Hodnoty v decimetroch (int16), v riadku ako
// rozdiely od suseda (plynulý geoid = malé čísla), nízke a vysoké bajty v dvoch
// blokoch (gzip ich tak lepšie zbalí) a base64 do JS modulu: ~194 KB gzip.

/** Rozmer mriežky 30': riadky od 90° S po 90° J, stĺpce od 0° V na východ. */
export const GEOID_GRID = Object.freeze({ rows: 361, cols: 720, stepDeg: 0.5, scale: 0.1 });

/**
 * Zakóduje hodnoty geoidu (metre, riadok po riadku) do base64 reťazca.
 * @param {ArrayLike<number>} valuesM rows × cols hodnôt N v metroch
 * @param {{rows: number, cols: number, scale: number}} [grid]
 * @returns {string} base64
 */
export function encodeGeoidGrid(valuesM, grid = GEOID_GRID) {
  const { rows, cols, scale } = grid;
  const n = rows * cols;
  if (valuesM.length !== n) throw new Error(`encodeGeoidGrid: čakám ${n} hodnôt, mám ${valuesM.length}`);
  const bytes = Buffer.alloc(n * 2);
  for (let r = 0; r < rows; r++) {
    let prev = 0;
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const q = Math.round(valuesM[i] / scale);
      if (!Number.isFinite(q) || q < -32768 || q > 32767) throw new Error(`encodeGeoidGrid: hodnota mimo int16 v [${r},${c}]: ${valuesM[i]}`);
      const d = c === 0 ? q : q - prev;
      if (d < -32768 || d > 32767) throw new Error(`encodeGeoidGrid: rozdiel mimo int16 v [${r},${c}]`);
      prev = q;
      bytes[i] = d & 0xff;
      bytes[n + i] = (d >> 8) & 0xff;
    }
  }
  return bytes.toString('base64');
}

/**
 * Hodnoty 30' mriežky z plnej 15' mriežky EGM96 cez verejné API egm96-universal
 * (v uzle vracia hodnotu uzla).
 * @param {(latDeg: number, lonDeg: number) => number} meanSeaLevel
 * @param {{rows: number, cols: number, stepDeg: number}} [grid]
 * @returns {Float64Array}
 */
export function sampleGeoidGrid(meanSeaLevel, grid = GEOID_GRID) {
  const { rows, cols, stepDeg } = grid;
  const out = new Float64Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    const lat = 90 - r * stepDeg;
    for (let c = 0; c < cols; c++) out[r * cols + c] = meanSeaLevel(lat, c * stepDeg);
  }
  return out;
}

/**
 * Obsah generovaného modulu src/data/local_data/geoid/egm96-30min.js.
 * @param {string} data base64 z encodeGeoidGrid
 * @param {{rows: number, cols: number, stepDeg: number, scale: number}} [grid]
 * @returns {string}
 */
export function geoidModuleSource(data, grid = GEOID_GRID) {
  return [
    '// GENEROVANÉ scripts/build-geoid-grid.mjs — neupravovať ručne (pôvod: SOURCE.md).',
    '// EGM96 (NGA, verejná doména) cez egm96-universal (MIT), mriežka 30\', decimetre,',
    '// rozdiely v riadku, nízke a vysoké bajty v dvoch blokoch, base64.',
    `export default Object.freeze({ rows: ${grid.rows}, cols: ${grid.cols}, stepDeg: ${grid.stepDeg}, scale: ${grid.scale}, data: '${data}' });`,
    '',
  ].join('\n');
}
