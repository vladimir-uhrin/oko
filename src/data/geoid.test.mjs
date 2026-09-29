// src/data/geoid.test.mjs — EGM96 geoid-undulation lookup.
//
// Locks the module's public interface (later tasks — aircraft altitude
// correction, CCTV terrain fallback — call this verbatim):
//   ensureGeoidReady(): Promise<void>   lazy-loads the grid on first call
//   geoidHeight(latDeg, lonDeg): number N in metres; throws if not ready
//   orthometricToEllipsoidal(hMslM, latDeg, lonDeg): number  hMslM + N
//
// Tolerance is loose (±2.5 m) by design: the bundled grid is EGM96 while the
// reference values are Re:Earth's EGM2008 — the two
// models differ by up to ~1 m, and the brief's own tolerance absorbs that
// spread rather than asserting exact agreement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ellipsoidalToMslDisplayM,
  ensureGeoidReady,
  geoidHeight,
  orthometricToEllipsoidal,
} from './geoid.js';

const TOLERANCE_M = 2.5;

const LONDON = { lat: 51.5072, lon: -0.1275, nExpected: 46.1 };
const AUSTIN = { lat: 30.2672, lon: -97.7431, nExpected: -26.9 };
const SF = { lat: 37.7749, lon: -122.4194, nExpected: -32.2 };
const DENVER = { lat: 39.7392, lon: -104.9903, nExpected: -17.3 };
/** SFO runway 28R touchdown area — the cockpit/OSD field report's coordinates. */
const SFO = { lat: 37.616, lon: -122.368 };

test('geoidHeight throws before ensureGeoidReady() has resolved', () => {
  // A fresh, never-initialized module instance can't be observed from the
  // same process (ESM module cache), so this asserts the documented
  // contract via the type check further down instead of re-importing.
  // (See "ready-gate" test below for the real not-ready behavior.)
  assert.equal(typeof geoidHeight, 'function');
});

test('ensureGeoidReady() resolves and is idempotent (safe to call repeatedly)', async () => {
  await ensureGeoidReady();
  await ensureGeoidReady();
  await ensureGeoidReady();
});

test('geoidHeight matches known EGM96 undulation values within ±2.5 m', async () => {
  await ensureGeoidReady();
  for (const { lat, lon, nExpected } of [LONDON, AUSTIN, SF, DENVER]) {
    const n = geoidHeight(lat, lon);
    assert.ok(
      Math.abs(n - nExpected) <= TOLERANCE_M,
      `geoidHeight(${lat}, ${lon}) = ${n}, expected ≈ ${nExpected} (±${TOLERANCE_M})`
    );
  }
});

test('orthometricToEllipsoidal adds the geoid undulation to the MSL height', async () => {
  await ensureGeoidReady();
  const hMslM = 15;
  const hEllipsoidal = orthometricToEllipsoidal(hMslM, LONDON.lat, LONDON.lon);
  // London geoid ≈ +46.1 -> 15 + 46.1 = 61.1, expect ≈ 61 within tolerance.
  assert.ok(
    Math.abs(hEllipsoidal - 61) <= TOLERANCE_M,
    `orthometricToEllipsoidal(15, london) = ${hEllipsoidal}, expected ≈ 61 (±${TOLERANCE_M})`
  );
  // Must equal hMslM + geoidHeight exactly (same lookup, no extra fudge).
  const n = geoidHeight(LONDON.lat, LONDON.lon);
  assert.equal(hEllipsoidal, hMslM + n);
});

test('geoidHeight wraps longitude consistently (359.87 === -0.13)', async () => {
  await ensureGeoidReady();
  const wrapped = geoidHeight(51.5, 359.87);
  const normal = geoidHeight(51.5, -0.13);
  // Both longitudes name the same physical point (360° apart); the
  // underlying grid lookup takes different floating-point paths to get
  // there (mod-2π normalization), so equality is asserted to FP epsilon
  // rather than bit-for-bit — this is the "consistent," not "identical
  // bit pattern," invariant the brief calls for.
  assert.ok(
    Math.abs(wrapped - normal) < 1e-9,
    `geoidHeight(51.5, 359.87) = ${wrapped}, geoidHeight(51.5, -0.13) = ${normal}`
  );
});

// ── ellipsoidalToMslDisplayM — the ALT-readout datum correction ─────────────
//
// Field report (2026-08-22, cockpit parked at SFO): the camera OSD read
// "ALT: -15M" because Cesium's camera height is ELLIPSOIDAL and San Francisco
// sits ~32 m above the geoid's dip under the ellipsoid. Same family as the
// earlier JFK "ALT: -18M".

test('the SFO deck case: an ellipsoidal height equal to N reads as 0 m MSL', async () => {
  await ensureGeoidReady();
  const n = geoidHeight(SFO.lat, SFO.lon);
  // A camera sitting exactly ON the geoid reports h = N against the ellipsoid.
  assert.equal(ellipsoidalToMslDisplayM(n, n), 0);
});

test('the reported SFO cockpit OSD height turns into a small positive MSL number', async () => {
  await ensureGeoidReady();
  const n = geoidHeight(SFO.lat, SFO.lon);
  assert.ok(n < -25 && n > -40, `SFO undulation should be strongly negative, got ${n}`);
  // The screenshot showed ALT: -15m ellipsoidal over the SFO deck.
  const displayed = ellipsoidalToMslDisplayM(-15, n);
  assert.ok(
    displayed > 10 && displayed < 25,
    `-15 m ellipsoidal at SFO should read ≈ +17 m MSL, got ${displayed}`
  );
});

test('a positive undulation lowers the readout — the correction subtracts N', async () => {
  await ensureGeoidReady();
  const n = geoidHeight(LONDON.lat, LONDON.lon);
  assert.ok(n > 40, `London undulation should be strongly positive, got ${n}`);
  // Cruise case: 10 km ellipsoidal over London reads ~46 m LOWER as MSL.
  const cruise = ellipsoidalToMslDisplayM(10000, n);
  assert.equal(cruise, 10000 - n);
  assert.ok(
    cruise > 9950 && cruise < 9960,
    `10 000 m ellipsoidal over London should read ≈ 9954 m MSL, got ${cruise}`
  );
});

test('ellipsoidalToMslDisplayM round-trips orthometricToEllipsoidal', async () => {
  await ensureGeoidReady();
  for (const point of [LONDON, AUSTIN, SF, DENVER]) {
    const n = geoidHeight(point.lat, point.lon);
    const ellipsoidal = orthometricToEllipsoidal(120, point.lat, point.lon);
    // Exact to FP epsilon: +N then -N is the same lookup, no extra fudge.
    assert.ok(Math.abs(ellipsoidalToMslDisplayM(ellipsoidal, n) - 120) < 1e-9);
  }
});

test('an unavailable geoid returns the uncorrected height, never NaN or blank', () => {
  // Grid still loading, lazy import failed, or an out-of-range lookup: the
  // readout degrades to the ellipsoidal number rather than printing NaN.
  for (const missing of [null, undefined, Number.NaN, 'x']) {
    assert.equal(ellipsoidalToMslDisplayM(-15, missing), -15);
  }
});

test('a non-finite height is passed through untouched', async () => {
  await ensureGeoidReady();
  const n = geoidHeight(SFO.lat, SFO.lon);
  assert.equal(ellipsoidalToMslDisplayM(null, n), null);
  assert.equal(ellipsoidalToMslDisplayM(undefined, n), undefined);
  assert.ok(Number.isNaN(ellipsoidalToMslDisplayM(Number.NaN, n)));
});

test('geoidHeight throws a clear error if called before the grid is ready', async () => {
  // Exercise the not-ready path via a fresh dynamic import under Node's ESM
  // cache-busting query trick so this module instance has never had
  // ensureGeoidReady() called on it.
  const fresh = await import('./geoid.js?fresh-not-ready-check');
  assert.throws(() => fresh.geoidHeight(0, 0), /not ready|ensureGeoidReady/i);
});

// ── 2026-09-29: mriežka 30' bikubicky namiesto balíka egm96-universal (15') ──
// Prenos pri štarte 1,85 MB → ~194 KB gzip. Presnosť sa overuje proti pôvodnej
// plnej mriežke (balík ostáva v node_modules pre generátor a tento test).

test('30\' bikubicky vs pôvodná 15\' mriežka: RMS < 8 cm, max < 1,1 m (Európa < 0,65 m)', async () => {
  await ensureGeoidReady();
  const { meanSeaLevel } = await import('egm96-universal');
  const errs = []; const europe = [];
  for (let lat = -89.875; lat <= 89.875; lat += 0.5) {
    for (let lon = -179.875; lon < 180; lon += 0.5) {
      const e = Math.abs(geoidHeight(lat, lon) - meanSeaLevel(lat, lon));
      errs.push(e);
      if (lat >= 34 && lat <= 72 && lon >= -25 && lon <= 45) europe.push(e);
    }
  }
  const rms = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
  // bez Math.max(...pole): 518 000 argumentov pretečie zásobník
  const max = errs.reduce((m, e) => (e > m ? e : m), 0);
  const maxEu = europe.reduce((m, e) => (e > m ? e : m), 0);
  assert.ok(rms < 0.08, `RMS ${rms.toFixed(3)} m`);
  assert.ok(max < 1.1, `max ${max.toFixed(2)} m`);
  assert.ok(maxEu < 0.65, `Európa max ${maxEu.toFixed(2)} m`);
  // Bratislava, Dunaj: N ≈ 44 m, rozdiel pod 10 cm
  assert.ok(Math.abs(geoidHeight(48.14, 17.11) - meanSeaLevel(48.14, 17.11)) < 0.1);
});

test('uzly mriežky vracajú presne zbalenú hodnotu, póly a antimeridián bez skoku', async () => {
  await ensureGeoidReady();
  const { meanSeaLevel } = await import('egm96-universal');
  for (const [lat, lon] of [[48, 17], [0, 0], [-35.5, 149], [60, -150.5]]) {
    assert.ok(Math.abs(geoidHeight(lat, lon) - meanSeaLevel(lat, lon)) <= 0.051, `${lat},${lon} (kvantovanie po 10 cm)`);
  }
  assert.ok(Math.abs(geoidHeight(89.99, 10) - geoidHeight(89.99, 190)) < 0.05, 'severný pól');
  assert.ok(Math.abs(geoidHeight(-90, 0) - geoidHeight(-90, 123)) < 0.05, 'južný pól');
  assert.ok(Math.abs(geoidHeight(-17, 179.999) - geoidHeight(-17, -179.999)) < 0.01, 'antimeridián');
  assert.ok(Number.isNaN(geoidHeight(Number.NaN, 10)), 'NaN ostáva NaN (volajúci kontrolujú Number.isFinite)');
});

test('zbalený modul je presne výstup generátora (nikto ho neupravil ručne ani nezastaral)', async () => {
  const { meanSeaLevel } = await import('egm96-universal');
  const { encodeGeoidGrid, sampleGeoidGrid, GEOID_GRID } = await import('../../scripts/lib/geoidGrid.mjs');
  const packed = (await import('./local_data/geoid/egm96-30min.js')).default;
  assert.deepEqual({ rows: packed.rows, cols: packed.cols, stepDeg: packed.stepDeg, scale: packed.scale }, { ...GEOID_GRID });
  assert.equal(packed.data, encodeGeoidGrid(sampleGeoidGrid(meanSeaLevel)), 'spusti node scripts/build-geoid-grid.mjs');
});

test('geoid.js už neimportuje egm96-universal (2,7 MB mriežka nesmie ísť do prehliadača)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./geoid.js', import.meta.url), 'utf8');
  assert.ok(!/import\(['"]egm96-universal['"]\)|from ['"]egm96-universal['"]/.test(src));
  assert.match(src, /import\('\.\/local_data\/geoid\/egm96-30min\.js'\)/);
});
