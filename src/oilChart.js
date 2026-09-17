// src/oilChart.js
//
// Bigger, interactive multi-series price chart for the oil card. Any of Brent /
// WTI / natural gas / gasoline / diesel can be toggled on. Because the series
// have different units ($/bbl vs $/MMBtu vs $/gal), when more than one unit is
// on the chart it rebases every line to an index (100 at the range start) so a
// mixed comparison is honest ("relative performance"); a single unit is shown in
// absolute price. Hover (or touch) gives a crosshair and a tooltip with the date
// and each series' value. The pure geometry helpers are exported for tests.

import { currentLanguage, t } from './i18n.js';

export const OIL_SERIES_COLORS = Object.freeze({
  brent: '#39d0ff', wti: '#ffb547', natgas: '#4ade80', gasoline: '#f472b6', diesel: '#f87171',
});
export const OIL_RANGE_DAYS = Object.freeze({ '1M': 31, '6M': 186, '1Y': 370 });

/** Points within the last `days` of the series' own last timestamp. Pure. */
export function sliceSeriesPoints(points, range) {
  const days = OIL_RANGE_DAYS[range] || OIL_RANGE_DAYS['6M'];
  const pts = Array.isArray(points) ? points : [];
  if (pts.length < 2) return pts;
  const cutoff = pts[pts.length - 1].t - days * 86_400_000;
  return pts.filter((p) => p.t >= cutoff);
}

/** Index of the point whose t is nearest to `target`. Pure. */
export function nearestIndex(ts, target) {
  if (!Array.isArray(ts) || !ts.length) return -1;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < ts.length; i += 1) {
    const d = Math.abs(ts[i] - target);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function fmtDate(ms, lang, withYear = false) {
  try {
    return new Intl.DateTimeFormat(lang === 'sk' ? 'sk-SK' : 'en-GB', { day: 'numeric', month: 'short', ...(withYear ? { year: '2-digit' } : {}) }).format(new Date(ms));
  } catch { return ''; }
}

/**
 * Build the interactive chart element (legend + optional range row + canvas +
 * tooltip). Rebuilt on each repaint; state (selectedKeys, range) is owned by the
 * caller and passed back through onToggle / onRange.
 * @returns {HTMLElement}
 */
export function renderOilChart(doc, {
  chartable = [],
  selectedKeys,
  range = '6M',
  translate = t,
  lang = currentLanguage(),
  onToggle = null,
  onRange = null,
  height = 158,
} = {}) {
  const wrap = doc.createElement('div');
  wrap.className = 'oko-oilc';
  const selected = selectedKeys instanceof Set ? selectedKeys : new Set(selectedKeys || ['brent', 'wti']);

  // Legend toggle chips
  const legend = doc.createElement('div');
  legend.className = 'oko-oilc-legend';
  for (const c of chartable) {
    const chip = doc.createElement('button');
    chip.type = 'button';
    chip.className = `oko-oilc-chip${selected.has(c.key) ? ' is-on' : ''}`;
    chip.style.setProperty('--c', OIL_SERIES_COLORS[c.key] || '#8aa0b6');
    chip.textContent = c.label;
    if (onToggle) chip.addEventListener('click', () => onToggle(c.key));
    legend.appendChild(chip);
  }
  wrap.appendChild(legend);

  if (onRange) {
    const ranges = doc.createElement('div');
    ranges.className = 'oko-oilc-ranges';
    for (const r of ['1M', '6M', '1Y']) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = `oko-oilc-range${r === range ? ' is-on' : ''}`;
      b.textContent = r === '1Y' ? translate('oil.range-year') : r;
      b.addEventListener('click', () => onRange(r));
      ranges.appendChild(b);
    }
    wrap.appendChild(ranges);
  }

  const holder = doc.createElement('div');
  holder.className = 'oko-oilc-holder';
  holder.style.height = `${height}px`;
  const canvas = doc.createElement('canvas');
  canvas.className = 'oko-oilc-canvas';
  const tip = doc.createElement('div');
  tip.className = 'oko-oilc-tip';
  tip.hidden = true;
  holder.appendChild(canvas);
  holder.appendChild(tip);
  wrap.appendChild(holder);

  // Prepare the active, sliced, possibly-indexed series.
  const active = chartable.filter((c) => selected.has(c.key)).map((c) => ({ ...c, points: sliceSeriesPoints(c.points, range) })).filter((c) => c.points.length >= 2);
  const indexed = new Set(active.map((c) => c.unit)).size > 1;
  const seriesVals = active.map((c) => {
    const base = c.points[0].v;
    return {
      key: c.key,
      label: c.label,
      unit: c.unit,
      color: OIL_SERIES_COLORS[c.key] || '#8aa0b6',
      ts: c.points.map((p) => p.t),
      vs: c.points.map((p) => (indexed && base ? (p.v / base) * 100 : p.v)),
    };
  });

  const PAD = { l: 6, r: 6, t: 8, b: 16 };
  let geo = null;

  function drawBase() {
    const cssW = Math.max(140, Math.floor(canvas.clientWidth || holder.clientWidth || 300));
    const cssH = height;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = '100%';
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (!seriesVals.length) {
      ctx.fillStyle = '#6f8398';
      ctx.font = '10px "IBM Plex Mono",monospace';
      ctx.fillText(translate('oil.pick-series'), PAD.l + 2, cssH / 2);
      geo = null;
      return ctx;
    }
    const w = cssW - PAD.l - PAD.r;
    const h = cssH - PAD.t - PAD.b;
    let t0 = Infinity; let t1 = -Infinity; let vMin = Infinity; let vMax = -Infinity;
    for (const s of seriesVals) {
      for (let i = 0; i < s.ts.length; i += 1) {
        t0 = Math.min(t0, s.ts[i]); t1 = Math.max(t1, s.ts[i]);
        vMin = Math.min(vMin, s.vs[i]); vMax = Math.max(vMax, s.vs[i]);
      }
    }
    if (!(t1 > t0) || !(vMax > vMin)) { geo = null; return ctx; }
    const padV = (vMax - vMin) * 0.08;
    vMin -= padV; vMax += padV;
    const px = (tt) => PAD.l + ((tt - t0) / (t1 - t0)) * w;
    const py = (v) => PAD.t + h - ((v - vMin) / (vMax - vMin)) * h;
    // grid + y labels
    ctx.font = '9px "IBM Plex Mono",monospace';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 3; i += 1) {
      const yy = PAD.t + (h * i) / 3;
      ctx.strokeStyle = 'rgba(120,150,180,.14)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD.l, yy + 0.5); ctx.lineTo(PAD.l + w, yy + 0.5); ctx.stroke();
      const v = vMax - ((vMax - vMin) * i) / 3;
      ctx.fillStyle = '#6f8398'; ctx.textAlign = 'left';
      ctx.fillText(indexed ? v.toFixed(0) : v.toFixed(v < 10 ? 2 : 1), PAD.l + 2, yy - 6);
    }
    // x date labels
    ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#6f8398';
    ctx.textAlign = 'left'; ctx.fillText(fmtDate(t0, lang), PAD.l, cssH - 4);
    ctx.textAlign = 'right'; ctx.fillText(fmtDate(t1, lang), PAD.l + w, cssH - 4);
    if (indexed) { ctx.textAlign = 'center'; ctx.fillStyle = '#5b6f84'; ctx.fillText(translate('oil.indexed'), PAD.l + w / 2, cssH - 4); }
    // lines
    for (const s of seriesVals) {
      ctx.strokeStyle = s.color; ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i < s.ts.length; i += 1) { const X = px(s.ts[i]); const Y = py(s.vs[i]); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); }
      ctx.stroke();
    }
    geo = { w, h, cssW, cssH, t0, t1, px, py };
    return ctx;
  }

  function onMove(pt) {
    const ctx = drawBase();
    if (!ctx || !geo) { tip.hidden = true; return; }
    const rect = canvas.getBoundingClientRect();
    const x = pt.clientX - rect.left;
    const frac = Math.max(0, Math.min(1, (x - PAD.l) / geo.w));
    const tt = geo.t0 + frac * (geo.t1 - geo.t0);
    const cx = geo.px(tt);
    ctx.strokeStyle = 'rgba(219,234,254,.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, PAD.t); ctx.lineTo(cx, PAD.t + geo.h); ctx.stroke();
    const rows = [];
    for (const s of seriesVals) {
      const bi = nearestIndex(s.ts, tt);
      if (bi < 0) continue;
      const X = geo.px(s.ts[bi]); const Y = geo.py(s.vs[bi]);
      ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(X, Y, 2.6, 0, Math.PI * 2); ctx.fill();
      rows.push({ color: s.color, label: s.label, val: indexed ? s.vs[bi].toFixed(1) : s.vs[bi].toFixed(2), unit: s.unit, t: s.ts[bi] });
    }
    tip.replaceChildren();
    const d = doc.createElement('div'); d.className = 'oko-oilc-tip-d'; d.textContent = fmtDate(rows[0]?.t ?? tt, lang, true); tip.appendChild(d);
    for (const r of rows) {
      const line = doc.createElement('div'); line.className = 'oko-oilc-tip-r';
      const sw = doc.createElement('span'); sw.className = 'oko-oilc-tip-sw'; sw.style.background = r.color; line.appendChild(sw);
      line.appendChild(doc.createTextNode(`${r.label} ${r.val}${indexed ? '' : ` ${r.unit}`}`));
      tip.appendChild(line);
    }
    tip.hidden = false;
    const tw = tip.offsetWidth || 130;
    let left = x + 12;
    if (left + tw > geo.cssW) left = x - tw - 12;
    tip.style.left = `${Math.max(2, left)}px`;
    tip.style.top = '2px';
  }
  const hide = () => { tip.hidden = true; drawBase(); };

  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', hide);
  canvas.addEventListener('touchstart', (e) => { if (e.touches[0]) onMove(e.touches[0]); }, { passive: true });
  canvas.addEventListener('touchmove', (e) => { if (e.touches[0]) onMove(e.touches[0]); }, { passive: true });

  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => drawBase());
  else drawBase();

  return wrap;
}
