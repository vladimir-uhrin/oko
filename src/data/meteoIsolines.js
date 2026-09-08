// src/data/meteoIsolines.js
// Izočiary (izobary) z mriežky — marching squares s lineárnou interpoláciou
// a spájaním úsekov do dlhých čiar (2026-09-08, fáza „polia"). Čisté, bez DOM.
//
// Mriežka: hodnoty [riadok][stĺpec], riadok 0 = sever (lat0), stĺpec 0 = lon0,
// krok dlat (záporný smerom na juh), dlon. Šev na ±180° sa nespája (čiara sa
// tam pretrhne — vizuálne nevadí, glóbus ju aj tak zakryje).

/**
 * Dekóduje 8-bitový kanál obrázka na hodnoty (dequantize) — pomôcka pre klienta.
 * @param {Uint8ClampedArray|Uint8Array} rgba
 * @param {number} channel 0..3
 * @param {[number, number]} range
 * @returns {Float32Array}
 */
export function decodeChannel(rgba, channel, range) {
  const n = rgba.length / 4;
  const out = new Float32Array(n);
  const [lo, hi] = range;
  for (let i = 0; i < n; i += 1) out[i] = lo + (rgba[i * 4 + channel] / 255) * (hi - lo);
  return out;
}

/**
 * Podvzorkovanie mriežky (každý k-tý bod). Pure.
 * @param {ArrayLike<number>} values
 * @param {number} cols
 * @param {number} rows
 * @param {number} k
 */
export function downsample(values, cols, rows, k) {
  if (k <= 1) return { values, cols, rows };
  const nc = Math.floor((cols - 1) / k) + 1;
  const nr = Math.floor((rows - 1) / k) + 1;
  const out = new Float32Array(nc * nr);
  for (let r = 0; r < nr; r += 1) for (let c = 0; c < nc; c += 1) out[r * nc + c] = values[r * k * cols + c * k];
  return { values: out, cols: nc, rows: nr };
}

/** Hladiny od `min` po `max` s krokom `step`. Pure. */
export function isolineLevels(min, max, step) {
  const out = [];
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

/**
 * Marching squares pre jednu hladinu. Vracia zoznam čiar ako polia [lon, lat].
 * @param {ArrayLike<number>} values
 * @param {number} cols
 * @param {number} rows
 * @param {number} level
 * @param {{lon0: number, lat0: number, dlon: number, dlat: number}} geo
 * @returns {Array<Array<[number, number]>>}
 */
export function isolinesForLevel(values, cols, rows, level, geo) {
  const { lon0, lat0, dlon, dlat } = geo;
  // Kľúč hrany: horizontálna hrana (r, c) medzi (r,c)-(r,c+1) → 'h' ; vertikálna (r,c)-(r+1,c) → 'v'.
  const edgePoint = new Map(); // kľúč → [lon, lat]
  const segments = []; // [keyA, keyB]
  const adjacency = new Map(); // kľúč → [segmentIndex...]
  const pt = (key, r, c, horizontal) => {
    if (edgePoint.has(key)) return;
    const a = values[r * cols + c];
    const b = horizontal ? values[r * cols + c + 1] : values[(r + 1) * cols + c];
    const f = a === b ? 0.5 : Math.min(1, Math.max(0, (level - a) / (b - a)));
    const lon = lon0 + (horizontal ? c + f : c) * dlon;
    const lat = lat0 + (horizontal ? r : r + f) * dlat;
    edgePoint.set(key, [lon, lat]);
  };
  const addSeg = (kA, kB) => {
    const idx = segments.length;
    segments.push([kA, kB]);
    for (const k of [kA, kB]) { if (!adjacency.has(k)) adjacency.set(k, []); adjacency.get(k).push(idx); }
  };
  for (let r = 0; r < rows - 1; r += 1) {
    for (let c = 0; c < cols - 1; c += 1) {
      const tl = values[r * cols + c] >= level ? 8 : 0;
      const tr = values[r * cols + c + 1] >= level ? 4 : 0;
      const br = values[(r + 1) * cols + c + 1] >= level ? 2 : 0;
      const bl = values[(r + 1) * cols + c] >= level ? 1 : 0;
      const idx = tl | tr | br | bl;
      if (idx === 0 || idx === 15) continue;
      const top = `h${r}_${c}`;
      const bottom = `h${r + 1}_${c}`;
      const left = `v${r}_${c}`;
      const right = `v${r}_${c + 1}`;
      const need = (key) => {
        if (key === top) pt(key, r, c, true);
        else if (key === bottom) pt(key, r + 1, c, true);
        else if (key === left) pt(key, r, c, false);
        else pt(key, r, c + 1, false);
      };
      const link = (k1, k2) => { need(k1); need(k2); addSeg(k1, k2); };
      switch (idx) {
        case 1: case 14: link(left, bottom); break;
        case 2: case 13: link(bottom, right); break;
        case 3: case 12: link(left, right); break;
        case 4: case 11: link(top, right); break;
        case 6: case 9: link(top, bottom); break;
        case 7: case 8: link(top, left); break;
        case 5: { // sedlo: stred rozhodne
          const centre = (values[r * cols + c] + values[r * cols + c + 1] + values[(r + 1) * cols + c + 1] + values[(r + 1) * cols + c]) / 4;
          if (centre >= level) { link(top, right); link(left, bottom); } else { link(top, left); link(bottom, right); }
          break;
        }
        case 10: {
          const centre = (values[r * cols + c] + values[r * cols + c + 1] + values[(r + 1) * cols + c + 1] + values[(r + 1) * cols + c]) / 4;
          if (centre >= level) { link(top, left); link(bottom, right); } else { link(top, right); link(left, bottom); }
          break;
        }
        default: break;
      }
    }
  }
  // Spájanie: kráčaj po úsekoch cez zdieľané hrany.
  const used = new Uint8Array(segments.length);
  const lines = [];
  for (let s = 0; s < segments.length; s += 1) {
    if (used[s]) continue;
    used[s] = 1;
    const [a, b] = segments[s];
    const chain = [a, b];
    const extend = (fromEnd) => {
      for (;;) {
        const key = fromEnd ? chain[chain.length - 1] : chain[0];
        const next = (adjacency.get(key) || []).find((i) => !used[i]);
        if (next === undefined) return;
        used[next] = 1;
        const [x, y] = segments[next];
        const other = x === key ? y : x;
        if (fromEnd) chain.push(other); else chain.unshift(other);
      }
    };
    extend(true);
    extend(false);
    lines.push(chain.map((k) => edgePoint.get(k)));
  }
  return lines;
}

/**
 * Všetky izočiary poľa. Pure.
 * @param {ArrayLike<number>} values [rows × cols], riadok 0 = lat0
 * @param {number} cols
 * @param {number} rows
 * @param {{step: number, min?: number, max?: number, minPoints?: number}} options
 * @param {{lon0: number, lat0: number, dlon: number, dlat: number}} geo
 * @returns {Array<{level: number, points: Array<[number, number]>}>}
 */
export function isolines(values, cols, rows, { step, min, max, minPoints = 6 }, geo) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < values.length; i += 1) { const v = values[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const levels = isolineLevels(Number.isFinite(min) ? Math.max(min, lo) : lo, Number.isFinite(max) ? Math.min(max, hi) : hi, step);
  const out = [];
  for (const level of levels) {
    for (const points of isolinesForLevel(values, cols, rows, level, geo)) {
      if (points.length >= minPoints) out.push({ level, points });
    }
  }
  return out;
}
