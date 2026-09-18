// src/oilPriceChip.js
//
// Brent / WTI oil card, rendered in TWO places from one shared body builder:
//   - createOilPriceChip: a floating overlay shown WITH a chokepoint scene (the
//     "what is oil doing" context of the reveal), top-right, fixed 6-month chart.
//   - createOilPricePanel: the "CRUDE OIL / ROPA" panel in the DATA tab, next to
//     gas prices — the independent entry point, with a 1M/6M/1Y range selector.
//
// Each grade shows the price in USD and EUR, the day / week / month / year change
// (all computed series-based — robust to Yahoo's futures-roll previous close),
// its position in the 52-week range, and the Brent–WTI spread; a compact row adds
// natural gas / gasoline / diesel. Data is Yahoo Finance front-month futures
// (≈ spot) via /api/oil/prices; the footer says so. Price model: src/data/
// oilPrices.js (tested); chart via drawGasChart (gas panel).

import { buildOilModel, fetchOilPrices } from './data/oilPrices.js';
import { drawGasChart } from './gasChart.js';
import { renderOilChart } from './oilChart.js';
import { currentLanguage, t } from './i18n.js';

const DIR_GLYPH = Object.freeze({ up: '▲', down: '▼', flat: '·' });
const REFETCH_TTL_MS = 5 * 60_000;
const CHART_W = 210;
const CHART_H = 88;
const RANGE_DAYS = Object.freeze({ '1M': 31, '6M': 186, '1Y': 370 });

const makeDiv = (doc, cls, text) => { const d = doc.createElement('div'); d.className = cls; if (text != null) d.textContent = text; return d; };

function shortDate(ms, lang) {
  try { return new Intl.DateTimeFormat(lang === 'sk' ? 'sk-SK' : 'en-GB', { day: 'numeric', month: 'short' }).format(new Date(ms)); }
  catch { return ''; }
}

function gradeBlock(doc, translate, g) {
  const wrap = makeDiv(doc, 'oko-oil-grade');
  const top = makeDiv(doc, 'oko-oil-line');
  top.appendChild(makeDiv(doc, 'oko-oil-name', g.label));
  top.appendChild(makeDiv(doc, 'oko-oil-usd', g.usdText));
  if (g.eurText) top.appendChild(makeDiv(doc, 'oko-oil-eur', g.eurText));
  top.appendChild(makeDiv(doc, `oko-oil-chg oko-oil-${g.dir}`, `${DIR_GLYPH[g.dir] || ''} ${g.dayPctText}`.trim()));
  wrap.appendChild(top);

  if (g.periods?.length) {
    const per = makeDiv(doc, 'oko-oil-periods');
    for (const p of g.periods) {
      const item = makeDiv(doc, 'oko-oil-per');
      item.appendChild(makeDiv(doc, 'oko-oil-per-k', translate(`oil.p-${p.key}`)));
      item.appendChild(makeDiv(doc, `oko-oil-per-v oko-oil-${p.dir}`, p.pctText));
      per.appendChild(item);
    }
    wrap.appendChild(per);
  }

  if (g.range52) {
    const bar = makeDiv(doc, 'oko-oil-bar');
    const dot = makeDiv(doc, 'oko-oil-bar-dot');
    dot.style.left = `${(g.range52.pos * 100).toFixed(1)}%`;
    bar.appendChild(dot);
    wrap.appendChild(bar);
    wrap.appendChild(makeDiv(doc, 'oko-oil-r52', `${g.lowText}—${g.highText} · ${g.belowHighText} ${translate('oil.below-high')}`));
  }
  return wrap;
}

function sliceSeriesByRange(series, range) {
  const days = RANGE_DAYS[range] || RANGE_DAYS['6M'];
  return (series || []).map((s) => {
    const pts = s.points || [];
    if (pts.length < 2) return s;
    const cutoff = pts[pts.length - 1].t - days * 86_400_000;
    return { ...s, points: pts.filter((p) => p.t >= cutoff) };
  });
}

function drawChart(doc, model, lang, range) {
  const series = sliceSeriesByRange(model.chart?.series || [], range);
  if (!series.length || !(series[0].points?.length >= 2)) return null;
  const canvas = doc.createElement('canvas');
  canvas.className = 'oko-oil-canvas';
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  canvas.width = Math.round(CHART_W * dpr);
  canvas.height = Math.round(CHART_H * dpr);
  canvas.style.width = `${CHART_W}px`;
  canvas.style.height = `${CHART_H}px`;
  try {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const first = series[0].points[0]?.t;
      const last = series[0].points.at(-1)?.t;
      drawGasChart(ctx, series, {
        width: CHART_W,
        height: CHART_H,
        lastLabel: model.brent ? `Brent ${model.brent.usdText}` : (model.wti ? `WTI ${model.wti.usdText}` : ''),
        startLabel: first ? shortDate(first, lang) : '',
        endLabel: last ? shortDate(last, lang) : '',
      });
    }
  } catch { /* canvas unavailable (jsdom) — numbers still show */ }
  return canvas;
}

function commoditiesRow(doc, list) {
  const row = makeDiv(doc, 'oko-oil-commods');
  for (const c of list) {
    const item = makeDiv(doc, 'oko-oil-commod');
    item.appendChild(makeDiv(doc, 'oko-oil-commod-k', c.label));
    item.appendChild(makeDiv(doc, 'oko-oil-commod-v', c.priceText));
    item.appendChild(makeDiv(doc, `oko-oil-commod-d oko-oil-${c.dir}`, DIR_GLYPH[c.dir] || ''));
    row.appendChild(item);
  }
  return row;
}

/**
 * The shared card BODY (no header). `onRange` present → a 1M/6M/1Y selector.
 * @returns {Node[]}
 */
export function buildOilCardNodes(model, {
  doc, translate, lang, range = '6M', onRange = null, selectedKeys = null, onToggle = null, interactive = false,
}) {
  if (!model?.ok) return [makeDiv(doc, 'oko-oil-note', translate('oil.unavailable'))];
  const nodes = [];
  if (model.brent) nodes.push(gradeBlock(doc, translate, model.brent));
  if (model.wti) nodes.push(gradeBlock(doc, translate, model.wti));
  if (model.spreadText) nodes.push(makeDiv(doc, 'oko-oil-spread', `${translate('oil.spread')} ${model.spreadText}`));
  if (interactive && model.chartable?.length) {
    // Big interactive chart with per-series toggles + the range selector inside.
    nodes.push(renderOilChart(doc, { chartable: model.chartable, selectedKeys, range, translate, lang, onToggle, onRange }));
  } else {
    // Compact static chart for the floating scene overlay.
    const canvas = drawChart(doc, model, lang, range);
    if (canvas) nodes.push(canvas);
  }
  if (model.commodities?.length) nodes.push(commoditiesRow(doc, model.commodities));
  nodes.push(makeDiv(doc, 'oko-oil-foot', model.sourceLine));
  return nodes;
}

/** Floating overlay shown with a chokepoint scene (top-right, fixed 6-month chart). */
export function createOilPriceChip({
  documentRef = globalThis.document,
  fetch: fetchImpl = fetchOilPrices,
  translate = t,
  lang = currentLanguage(),
  now = () => Date.now(),
} = {}) {
  const doc = documentRef;
  if (!doc?.createElement) return { refreshAndShow: async () => {}, hide: () => {}, element: null };

  ensureStyle(doc);
  const el = doc.createElement('aside');
  el.className = 'oko-oil-chip';
  el.hidden = true;
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-label', translate('oil.title'));
  (doc.body || doc.documentElement).appendChild(el);

  let cachedPayload = null;
  let cachedAt = 0;
  let inFlight = null;

  const closeButton = () => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'oko-oil-close';
    b.setAttribute('aria-label', translate('oil.close'));
    b.textContent = '×';
    b.addEventListener('click', hide);
    return b;
  };
  const header = () => {
    const head = makeDiv(doc, 'oko-oil-head');
    head.appendChild(makeDiv(doc, 'oko-oil-title', translate('oil.title')));
    head.appendChild(closeButton());
    return head;
  };
  const renderModel = (model) => el.replaceChildren(header(), ...buildOilCardNodes(model, { doc, translate, lang }));
  function show() { el.hidden = false; }
  function hide() { el.hidden = true; }

  async function refreshAndShow() {
    show();
    const fresh = cachedPayload && (now() - cachedAt < REFETCH_TTL_MS);
    if (fresh) { renderModel(buildOilModel(cachedPayload, { lang, translate, nowMs: now() })); return; }
    if (!cachedPayload) el.replaceChildren(header(), makeDiv(doc, 'oko-oil-note', translate('oil.loading')));
    if (!inFlight) inFlight = Promise.resolve(fetchImpl()).then((p) => { cachedPayload = p; cachedAt = now(); return p; }).finally(() => { inFlight = null; });
    try { renderModel(buildOilModel(await inFlight, { lang, translate, nowMs: now() })); }
    catch { renderModel({ ok: false }); }
  }

  return { refreshAndShow, hide, element: el };
}

/** The oil panel in the DATA tab (#oil-panel), independent of any scene, with a range selector. */
export function createOilPricePanel({
  documentRef = globalThis.document,
  fetch: fetchImpl = fetchOilPrices,
  translate = t,
  lang = currentLanguage(),
  now = () => Date.now(),
} = {}) {
  const doc = documentRef;
  const panel = doc?.getElementById?.('oil-panel');
  const body = panel?.querySelector?.('[data-oil-body]');
  if (!panel || !body) return { refresh: async () => {}, element: null };

  ensureStyle(doc);
  let cachedPayload = null;
  let cachedAt = 0;
  let inFlight = null;
  let loadedOnce = false;
  let range = '6M';
  const selectedKeys = new Set(['brent', 'wti']);

  const paint = () => {
    if (!cachedPayload) return;
    body.replaceChildren(...buildOilCardNodes(buildOilModel(cachedPayload, { lang, translate, nowMs: now() }), {
      doc, translate, lang, range, onRange, selectedKeys, onToggle, interactive: true,
    }));
  };
  function onRange(next) { range = next; paint(); }
  function onToggle(key) {
    if (selectedKeys.has(key)) { if (selectedKeys.size > 1) selectedKeys.delete(key); }
    else selectedKeys.add(key);
    paint();
  }

  async function refresh() {
    const fresh = cachedPayload && (now() - cachedAt < REFETCH_TTL_MS);
    if (fresh) { paint(); return; }
    if (!cachedPayload) body.replaceChildren(makeDiv(doc, 'oko-oil-note', translate('oil.loading')));
    if (!inFlight) inFlight = Promise.resolve(fetchImpl()).then((p) => { cachedPayload = p; cachedAt = now(); return p; }).finally(() => { inFlight = null; });
    try { await inFlight; paint(); }
    catch { body.replaceChildren(makeDiv(doc, 'oko-oil-note', translate('oil.unavailable'))); }
  }

  const maybeLoad = () => {
    if (loadedOnce || panel.classList.contains('collapsed')) return;
    loadedOnce = true;
    void refresh();
  };
  try {
    const observer = new MutationObserver(maybeLoad);
    observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
  } catch { /* no MutationObserver (tests) */ }
  maybeLoad();

  return { refresh, element: panel };
}

function ensureStyle(doc) {
  if (!doc?.getElementById || doc.getElementById('oko-oil-chip-style')) return;
  const style = doc.createElement('style');
  style.id = 'oko-oil-chip-style';
  style.textContent = `
/* The chip BOX (position, size, z-index) lives in style.css — see
   "Scene chips" there. Only its inner styling stays here. */
.oko-oil-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;}
.oko-oil-title{font-size:10px;font-weight:600;letter-spacing:.14em;color:#ffb547;text-transform:uppercase;}
.oko-oil-close{appearance:none;background:none;border:0;color:#8aa0b6;font-size:16px;line-height:1;cursor:pointer;padding:0 2px;}
.oko-oil-close:hover{color:#dbeafe;}
.oko-oil-grade{margin:4px 0 6px;}
.oko-oil-line{display:flex;align-items:baseline;gap:7px;font-size:12px;}
.oko-oil-name{flex:0 0 40px;color:#8aa0b6;letter-spacing:.06em;}
.oko-oil-usd{color:#eaf2ff;font-variant-numeric:tabular-nums;}
.oko-oil-eur{color:#aebfd2;font-size:11px;font-variant-numeric:tabular-nums;}
.oko-oil-chg{margin-left:auto;font-size:11px;font-variant-numeric:tabular-nums;}
.oko-oil-periods{display:flex;flex-wrap:wrap;gap:4px 8px;margin:2px 0 3px;font-size:9.5px;}
.oko-oil-per{display:flex;gap:3px;}
.oko-oil-per-k{color:#6f8398;}
.oko-oil-per-v{font-variant-numeric:tabular-nums;}
.oko-oil-bar{position:relative;height:4px;border-radius:2px;background:linear-gradient(90deg,#37507055,#39d0ff55);margin:3px 0 2px;}
.oko-oil-bar-dot{position:absolute;top:50%;width:7px;height:7px;border-radius:50%;background:#eaf2ff;transform:translate(-50%,-50%);box-shadow:0 0 4px rgba(0,0,0,.6);}
.oko-oil-r52{font-size:9px;color:#6f8398;font-variant-numeric:tabular-nums;}
.oko-oil-up{color:#4ade80;}
.oko-oil-down{color:#f87171;}
.oko-oil-flat{color:#8aa0b6;}
.oko-oil-spread{font-size:10px;color:#aebfd2;margin:4px 0 2px;font-variant-numeric:tabular-nums;}
.oko-oil-ranges{display:flex;gap:5px;margin:4px 0 2px;}
.oko-oil-range{appearance:none;background:rgba(57,208,255,.08);border:1px solid rgba(57,208,255,.25);color:#8aa0b6;
  font:inherit;font-size:9.5px;letter-spacing:.05em;padding:2px 8px;border-radius:6px;cursor:pointer;}
.oko-oil-range:hover{color:#dbeafe;}
.oko-oil-range.is-active{background:rgba(57,208,255,.22);color:#eaf2ff;border-color:rgba(57,208,255,.5);}
.oko-oil-canvas{display:block;width:210px;height:88px;max-width:100%;margin:3px auto 3px;}
.oko-oil-commods{display:flex;flex-wrap:wrap;gap:4px 10px;margin:3px 0 2px;font-size:9.5px;color:#c8d6e6;}
.oko-oil-commod{display:flex;gap:4px;align-items:baseline;}
.oko-oil-commod-k{color:#6f8398;}
.oko-oil-commod-v{font-variant-numeric:tabular-nums;}
.oko-oil-note{font-size:11px;color:#8aa0b6;padding:2px 0;}
.oko-oil-foot{margin-top:5px;font-size:9px;line-height:1.3;color:#6f8398;letter-spacing:.02em;}
.oko-oilc{margin:5px 0 3px;}
.oko-oilc-legend{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:4px;}
.oko-oilc-chip{appearance:none;background:transparent;border:1px solid var(--c);color:var(--c);opacity:.42;
  font:inherit;font-size:9.5px;letter-spacing:.03em;padding:1px 7px;border-radius:9px;cursor:pointer;}
.oko-oilc-chip.is-on{opacity:1;background:color-mix(in srgb, var(--c) 18%, transparent);}
.oko-oilc-ranges{display:flex;gap:5px;margin-bottom:4px;}
.oko-oilc-range{appearance:none;background:rgba(57,208,255,.08);border:1px solid rgba(57,208,255,.25);color:#8aa0b6;
  font:inherit;font-size:9.5px;letter-spacing:.05em;padding:2px 8px;border-radius:6px;cursor:pointer;}
.oko-oilc-range:hover{color:#dbeafe;}
.oko-oilc-range.is-on{background:rgba(57,208,255,.22);color:#eaf2ff;border-color:rgba(57,208,255,.5);}
.oko-oilc-holder{position:relative;width:100%;}
.oko-oilc-canvas{display:block;width:100%;cursor:ew-resize;touch-action:none;}
.oko-oilc-tip{position:absolute;pointer-events:none;background:rgba(6,14,22,.95);border:1px solid rgba(57,208,255,.3);
  border-radius:7px;padding:5px 7px;font-size:9.5px;color:#dbeafe;white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.5);z-index:2;}
.oko-oilc-tip[hidden]{display:none;}
.oko-oilc-tip-d{color:#8aa0b6;margin-bottom:2px;}
.oko-oilc-tip-r{display:flex;align-items:center;gap:5px;font-variant-numeric:tabular-nums;}
.oko-oilc-tip-sw{width:8px;height:8px;border-radius:2px;flex:0 0 auto;}
`;
  (doc.head || doc.documentElement).appendChild(style);
}
