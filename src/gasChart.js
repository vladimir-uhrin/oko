// src/gasChart.js
/**
 * @module gasChart
 * @description Časový graf pre panel PLYN (2026-09-13): 1–3 rady bodov
 * {t, v} na skutočnej časovej osi (denné ACER aj mesačné IMF sa dajú
 * prekryť), prvý rad ako plocha + čiara v akcente, ďalšie tenké jantárové /
 * biele čiary — tá istá paleta a mriežka ako graf histórie letov
 * (flightHistoryChart.js), aby panel vyzeral ako zvyšok OKO. Berie ctx, nech
 * sa testuje na stube; popisky dostáva sformátované (gasPrices.js).
 */
import { CHART_COLORS, CHART_PAD } from './flightHistoryChart.js';

export const GAS_CHART_HEIGHT_PX = 120;

/** Štýl radu podľa poradia: prvý = akcent s plochou, druhý jantár, tretí biely. */
export const GAS_SERIES_STYLES = Object.freeze([
  Object.freeze({ line: CHART_COLORS.altLine, fill: CHART_COLORS.altFill, width: 1.5 }),
  Object.freeze({ line: CHART_COLORS.gsLine, fill: null, width: 1 }),
  Object.freeze({ line: CHART_COLORS.cursor, fill: null, width: 1 }),
]);

export function seriesStyle(index) {
  return GAS_SERIES_STYLES[Math.min(index, GAS_SERIES_STYLES.length - 1)];
}

/**
 * Mini-graf pre riadok toku (posledných ~14 dní): plocha + čiara v akcente,
 * spodok = 0 (nula toku je informácia, nie „min"), 1 px okraj. Vracia
 * false, keď nie je čo kresliť (menej než 2 hodnoty).
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<number|null>} values
 * @param {{width: number, height: number, color?: string, fill?: string}} o
 */
export function drawSparkline(ctx, values, { width, height, color = CHART_COLORS.altLine, fill = CHART_COLORS.altFill } = {}) {
  ctx.clearRect(0, 0, width, height);
  const pts = (values || []).map((v) => (Number.isFinite(v) ? v : null));
  const valid = pts.filter((v) => v !== null);
  if (valid.length < 2) return false;
  const max = Math.max(...valid, 0);
  const span = max > 0 ? max : 1;
  const n = pts.length;
  const x = (i) => 1 + (n > 1 ? (i / (n - 1)) * (width - 2) : 0);
  const y = (v) => height - 1 - (v / span) * (height - 2);
  let first = -1; let last = -1;
  pts.forEach((v, i) => { if (v === null) return; if (first < 0) first = i; last = i; });
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x(first), height - 1);
  pts.forEach((v, i) => { if (v !== null) ctx.lineTo(x(i), y(v)); });
  ctx.lineTo(x(last), height - 1);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  let pen = false;
  pts.forEach((v, i) => {
    if (v === null) { pen = false; return; }
    if (!pen) { ctx.moveTo(x(i), y(v)); pen = true; } else ctx.lineTo(x(i), y(v));
  });
  ctx.stroke();
  return true;
}

/**
 * Spoločný rozsah času a hodnôt všetkých radov (+8 % zvislej rezervy;
 * plochý rad dostane rezervu 10 % hodnoty, aby sa nedelilo nulou).
 * @param {Array<{points: Array<{t: number, v: number}>}>} series
 * @returns {{t0: number, t1: number, vMin: number, vMax: number, rawMin: number, rawMax: number, count: number}|null}
 */
export function chartExtent(series) {
  let t0 = Infinity; let t1 = -Infinity; let vMin = Infinity; let vMax = -Infinity; let count = 0;
  for (const s of series || []) {
    for (const p of s?.points || []) {
      if (!Number.isFinite(p?.t) || !Number.isFinite(p?.v)) continue;
      count += 1;
      if (p.t < t0) t0 = p.t;
      if (p.t > t1) t1 = p.t;
      if (p.v < vMin) vMin = p.v;
      if (p.v > vMax) vMax = p.v;
    }
  }
  if (!count) return null;
  if (t1 === t0) t1 = t0 + 1;
  const span = vMax - vMin;
  const pad = span > 0 ? span * 0.08 : Math.max(1, Math.abs(vMax) * 0.1);
  return { t0, t1, vMin: vMin - pad, vMax: vMax + pad, rawMin: vMin, rawMax: vMax, count };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{key?: string, points: Array<{t: number, v: number}>}>} series
 * @param {object} o
 * @param {number} o.width CSS px
 * @param {number} o.height CSS px
 * @param {string} [o.maxLabel] vľavo hore, napr. „max 92,3 €/MWh“
 * @param {string} [o.lastLabel] vpravo hore v akcente, napr. „posledná 79,5 €/MWh“
 * @param {string} [o.startLabel] vľavo dole (dátum)
 * @param {string} [o.endLabel] vpravo dole (dátum)
 * @param {string} [o.font]
 * @returns {ReturnType<typeof chartExtent>}
 */
export function drawGasChart(ctx, series, {
  width, height, maxLabel = '', lastLabel = '', startLabel = '', endLabel = '',
  font = '500 9px "JetBrains Mono", monospace',
} = {}) {
  ctx.clearRect(0, 0, width, height);
  const x0 = CHART_PAD.left;
  const y0 = CHART_PAD.top;
  const w = Math.max(1, width - CHART_PAD.left - CHART_PAD.right);
  const h = Math.max(1, height - CHART_PAD.top - CHART_PAD.bottom);
  ctx.strokeStyle = CHART_COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 4; i += 1) {
    const y = Math.round(y0 + (h * i) / 4) + 0.5;
    ctx.moveTo(x0, y); ctx.lineTo(x0 + w, y);
    const x = Math.round(x0 + (w * i) / 4) + 0.5;
    ctx.moveTo(x, y0); ctx.lineTo(x, y0 + h);
  }
  ctx.stroke();
  const extent = chartExtent(series);
  if (!extent) return null;
  const { t0, t1, vMin, vMax } = extent;
  const px = (p) => x0 + ((p.t - t0) / (t1 - t0)) * w;
  const py = (p) => y0 + h - ((p.v - vMin) / (vMax - vMin)) * h;
  (series || []).forEach((s, index) => {
    const pts = (s?.points || []).filter((p) => Number.isFinite(p?.t) && Number.isFinite(p?.v));
    if (pts.length < 2) return;
    const style = seriesStyle(index);
    if (style.fill) {
      ctx.fillStyle = style.fill;
      ctx.beginPath();
      ctx.moveTo(px(pts[0]), y0 + h);
      for (const p of pts) ctx.lineTo(px(p), py(p));
      ctx.lineTo(px(pts[pts.length - 1]), y0 + h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = style.line;
    ctx.lineWidth = style.width;
    ctx.beginPath();
    pts.forEach((p, i) => { if (i === 0) ctx.moveTo(px(p), py(p)); else ctx.lineTo(px(p), py(p)); });
    ctx.stroke();
  });
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = CHART_COLORS.textDim;
  ctx.textAlign = 'left';
  if (maxLabel) ctx.fillText(maxLabel, x0, y0 - 4);
  ctx.fillStyle = seriesStyle(0).line;
  ctx.textAlign = 'right';
  if (lastLabel) ctx.fillText(lastLabel, x0 + w, y0 - 4);
  ctx.fillStyle = CHART_COLORS.textDim;
  ctx.textAlign = 'left';
  if (startLabel) ctx.fillText(startLabel, x0, y0 + h + 12);
  ctx.textAlign = 'right';
  if (endLabel) ctx.fillText(endLabel, x0 + w, y0 + h + 12);
  return extent;
}

/**
 * Skladaný plošný graf (dovoz podľa pôvodu): vrstvy s rovnako vzdialenými
 * mesiacmi na osi x, plochy sa skladajú zdola v poradí vrstiev, spodok = 0,
 * strop = najvyšší súčet + 8 %; hore tenká čiara súčtu v akcente. Popisky
 * ako drawGasChart. Vracia { n, max } alebo null (menej než 2 stĺpce).
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{key?: string, color: string, values: Array<number|null>}>} layers
 * @param {{width: number, height: number, maxLabel?: string, lastLabel?: string, startLabel?: string, endLabel?: string, font?: string}} o
 */
export function drawStackedChart(ctx, layers, {
  width, height, maxLabel = '', lastLabel = '', startLabel = '', endLabel = '',
  font = '500 9px "JetBrains Mono", monospace',
} = {}) {
  ctx.clearRect(0, 0, width, height);
  const x0 = CHART_PAD.left;
  const y0 = CHART_PAD.top;
  const w = Math.max(1, width - CHART_PAD.left - CHART_PAD.right);
  const h = Math.max(1, height - CHART_PAD.top - CHART_PAD.bottom);
  ctx.strokeStyle = CHART_COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 4; i += 1) {
    const y = Math.round(y0 + (h * i) / 4) + 0.5;
    ctx.moveTo(x0, y); ctx.lineTo(x0 + w, y);
    const x = Math.round(x0 + (w * i) / 4) + 0.5;
    ctx.moveTo(x, y0); ctx.lineTo(x, y0 + h);
  }
  ctx.stroke();
  const n = Math.max(0, ...(layers || []).map((l) => l?.values?.length || 0));
  if (n < 2) return null;
  const val = (l, i) => (Number.isFinite(l?.values?.[i]) ? Math.max(0, l.values[i]) : 0);
  const totals = Array.from({ length: n }, (_, i) => (layers || []).reduce((acc, l) => acc + val(l, i), 0));
  const max = Math.max(...totals, 0);
  const top = max > 0 ? max * 1.08 : 1;
  const px = (i) => x0 + (i / (n - 1)) * w;
  const py = (v) => y0 + h - (v / top) * h;
  const below = Array(n).fill(0);
  for (const layer of layers || []) {
    const upper = below.map((b, i) => b + val(layer, i));
    ctx.fillStyle = layer.color;
    ctx.beginPath();
    ctx.moveTo(px(0), py(below[0]));
    for (let i = 0; i < n; i += 1) ctx.lineTo(px(i), py(upper[i]));
    for (let i = n - 1; i >= 0; i -= 1) ctx.lineTo(px(i), py(below[i]));
    ctx.closePath();
    ctx.fill();
    for (let i = 0; i < n; i += 1) below[i] = upper[i];
  }
  ctx.strokeStyle = CHART_COLORS.altLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < n; i += 1) { if (i === 0) ctx.moveTo(px(i), py(totals[i])); else ctx.lineTo(px(i), py(totals[i])); }
  ctx.stroke();
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = CHART_COLORS.textDim;
  ctx.textAlign = 'left';
  if (maxLabel) ctx.fillText(maxLabel, x0, y0 - 4);
  ctx.fillStyle = CHART_COLORS.altLine;
  ctx.textAlign = 'right';
  if (lastLabel) ctx.fillText(lastLabel, x0 + w, y0 - 4);
  ctx.fillStyle = CHART_COLORS.textDim;
  ctx.textAlign = 'left';
  if (startLabel) ctx.fillText(startLabel, x0, y0 + h + 12);
  ctx.textAlign = 'right';
  if (endLabel) ctx.fillText(endLabel, x0 + w, y0 + h + 12);
  return { n, max };
}
