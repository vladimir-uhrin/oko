// src/data/windowProjector.js
// Premietanie svet → okno (CSS px) jednou maticou pre prechody nad tisíckami
// bodov naraz.
//
// Meranie 2026-09-29 (vlastník: „plynulosť pri pohľade na celý svet"): výber
// štítkov lodí (aisLiveVessels.js updateClusteredLabels) premietal každých
// 800 ms všetkých ~27 000 lodí cez Cesium SceneTransforms.worldToWindowCoordinates
// — 30–40 ms naraz, viditeľné trhnutie. Cesium pri každom bode klonuje polohu,
// počíta dve násobenia maticou, normalizuje vektor očného posunu a skladá
// transformáciu výrezu nanovo. Tu sa P·V zloží raz a bod stojí 16 násobení.
//
// Zrkadlí Cesium v 3D s perspektívou (volajúci overí režim a druh frustum,
// inak použije Cesium): clip = P·V·[p, 1]; clip.z < 0 → za kamerou (Cesium
// vracia undefined); ndc = clip / clip.w; x = (ndc.x + 1) / 2 · šírka,
// y = výška − (ndc.y + 1) / 2 · výška (okno má y dole). Matice sú v poradí
// stĺpcov ako Cesium.Matrix4.

/**
 * @returns {{
 *   prepare: (projectionMatrix: ArrayLike<number>, viewMatrix: ArrayLike<number>, cssWidth: number, cssHeight: number) => void,
 *   project: (position: {x: number, y: number, z: number}, out: {x: number, y: number}) => boolean,
 * }}
 */
export function createWindowProjector() {
  const vp = new Float64Array(16);
  let halfW = 0;
  let halfH = 0;
  let height = 0;
  return {
    /** P·V a rozmer okna pre tento prechod (po každom pohybe kamery znova). */
    prepare(projectionMatrix, viewMatrix, cssWidth, cssHeight) {
      multiplyMatrix4(projectionMatrix, viewMatrix, vp);
      halfW = cssWidth * 0.5;
      halfH = cssHeight * 0.5;
      height = cssHeight;
    },
    /**
     * @returns {boolean} false = bod je za kamerou (ako Cesium undefined); out sa nemení.
     */
    project(p, out) {
      const x = p.x; const y = p.y; const z = p.z;
      const cz = vp[2] * x + vp[6] * y + vp[10] * z + vp[14];
      if (cz < 0) return false;
      const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
      const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
      const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
      out.x = (cx / cw + 1) * halfW;
      out.y = height - (cy / cw + 1) * halfH;
      return true;
    },
  };
}

/**
 * a · b pre 4×4 v poradí stĺpcov (ako Cesium.Matrix4.multiply). Pure.
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 * @param {Float64Array|number[]} out
 * @returns {Float64Array|number[]} out
 */
export function multiplyMatrix4(a, b, out) {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4]; const b1 = b[c * 4 + 1]; const b2 = b[c * 4 + 2]; const b3 = b[c * 4 + 3];
    out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}
