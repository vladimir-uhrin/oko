// src/flightHistoryChart.js
/**
 * @module flightHistoryChart
 * @description Graf výšky a rýchlosti prehrávaného letu (2026-09-07) —
 * čisté kreslenie do Canvas 2D v štýle HUD: výška ako plocha + čiara v
 * akcente, rýchlosť ako tenká jantárová čiara, kurzor aktuálneho času.
 * Berie ctx, nech sa testuje na stube; popisky dostáva už sformátované
 * (units.js rozhoduje o ft/m a kts/km/h).
 */

export const CHART_COLORS = Object.freeze({
  grid: 'rgba(120, 190, 210, 0.18)',
  altFill: 'rgba(57, 208, 255, 0.16)',
  altLine: 'rgba(57, 208, 255, 0.95)',
  gsLine: 'rgba(255, 179, 71, 0.9)',
  cursor: 'rgba(255, 255, 255, 0.85)',
  text: 'rgba(200, 236, 244, 0.9)',
  textDim: 'rgba(150, 175, 185, 0.8)',
});
export const CHART_PAD = Object.freeze({ left: 8, right: 8, top: 14, bottom: 16 });

function strokeSeries(ctx, values, x0, y0, w, h, color, width) {
  const n = values.length;
  if (n < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  let pen = false;
  for (let i = 0; i < n; i += 1) {
    const v = values[i];
    if (v === null || v === undefined) { pen = false; continue; }
    const x = x0 + (i / (n - 1)) * w;
    const y = y0 + h - v * h;
    if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{alt: Array<number|null>, gs: Array<number|null>}} series výstup chartSeries()
 * @param {object} o
 * @param {number} o.width CSS px
 * @param {number} o.height CSS px
 * @param {number} [o.cursorFrac] 0..1 aktuálny čas
 * @param {string} [o.altLabel] napr. „max FL340"
 * @param {string} [o.gsLabel] napr. „max 480 kts"
 * @param {string} [o.startLabel] HH:MM
 * @param {string} [o.endLabel] HH:MM
 * @param {string} [o.font]
 */
export function drawFlightChart(ctx, series, {
  width, height, cursorFrac = null, altLabel = '', gsLabel = '', startLabel = '', endLabel = '',
  font = '500 9px "JetBrains Mono", monospace',
} = {}) {
  ctx.clearRect(0, 0, width, height);
  const x0 = CHART_PAD.left;
  const y0 = CHART_PAD.top;
  const w = Math.max(1, width - CHART_PAD.left - CHART_PAD.right);
  const h = Math.max(1, height - CHART_PAD.top - CHART_PAD.bottom);
  // mriežka: 4 vodorovné, 4 zvislé
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
  if (!series) return;
  // výška: plocha
  const alt = series.alt || [];
  if (alt.length >= 2) {
    ctx.fillStyle = CHART_COLORS.altFill;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + h);
    for (let i = 0; i < alt.length; i += 1) {
      const v = alt[i] ?? 0;
      ctx.lineTo(x0 + (i / (alt.length - 1)) * w, y0 + h - v * h);
    }
    ctx.lineTo(x0 + w, y0 + h);
    ctx.closePath();
    ctx.fill();
  }
  strokeSeries(ctx, series.gs || [], x0, y0, w, h, CHART_COLORS.gsLine, 1);
  strokeSeries(ctx, alt, x0, y0, w, h, CHART_COLORS.altLine, 1.5);
  // kurzor
  if (Number.isFinite(cursorFrac)) {
    const cx = x0 + Math.max(0, Math.min(1, cursorFrac)) * w;
    ctx.strokeStyle = CHART_COLORS.cursor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, y0 - 4);
    ctx.lineTo(cx, y0 + h + 4);
    ctx.stroke();
  }
  // popisky
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = CHART_COLORS.altLine;
  ctx.textAlign = 'left';
  if (altLabel) ctx.fillText(altLabel, x0, y0 - 4);
  ctx.fillStyle = CHART_COLORS.gsLine;
  ctx.textAlign = 'right';
  if (gsLabel) ctx.fillText(gsLabel, x0 + w, y0 - 4);
  ctx.fillStyle = CHART_COLORS.textDim;
  ctx.textAlign = 'left';
  if (startLabel) ctx.fillText(startLabel, x0, y0 + h + 12);
  ctx.textAlign = 'right';
  if (endLabel) ctx.fillText(endLabel, x0 + w, y0 + h + 12);
}
