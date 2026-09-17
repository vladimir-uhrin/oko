// src/oilPriceChip.js
//
// Brent / WTI oil card. It renders in TWO places from one shared body builder:
//   - createOilPriceChip: a floating overlay shown WITH a chokepoint scene (the
//     "what is oil doing" context of the reveal), top-right.
//   - createOilPricePanel: the "CRUDE OIL / ROPA" panel in the DATA tab, next to
//     gas prices — the independent entry point, because the oil price is a global
//     macro figure, not something that only matters over one strait.
//
// Data is Yahoo Finance front-month futures (≈ spot) via /api/oil/prices — the
// only free, keyless source with today's number; FRED/EIA (public domain) lags
// 1–2 days. Honesty (CLAUDE.md rule 2): the footer says "front-month ≈ spot ·
// Yahoo Finance · <time>", never a plain "live spot". The price model lives in
// src/data/oilPrices.js (tested); the chart reuses drawGasChart (gas panel).

import { buildOilModel, fetchOilPrices } from './data/oilPrices.js';
import { drawGasChart } from './gasChart.js';
import { currentLanguage, t } from './i18n.js';

const DIR_GLYPH = Object.freeze({ up: '▲', down: '▼', flat: '·' });
/** Yahoo is near-real-time; re-use a session fetch for 5 min (matches proxy TTL). */
const REFETCH_TTL_MS = 5 * 60_000;
const CHART_W = 210;
const CHART_H = 92;

const makeDiv = (doc, cls, text) => { const d = doc.createElement('div'); d.className = cls; if (text != null) d.textContent = text; return d; };

function shortDate(ms, lang) {
  try { return new Intl.DateTimeFormat(lang === 'sk' ? 'sk-SK' : 'en-GB', { day: 'numeric', month: 'short' }).format(new Date(ms)); }
  catch { return ''; }
}

function gradeRow(doc, translate, grade) {
  const wrap = makeDiv(doc, 'oko-oil-grade');
  const top = makeDiv(doc, 'oko-oil-line');
  top.appendChild(makeDiv(doc, 'oko-oil-name', grade.label));
  top.appendChild(makeDiv(doc, 'oko-oil-usd', grade.usdText));
  if (grade.eurText) top.appendChild(makeDiv(doc, 'oko-oil-eur', grade.eurText));
  const glyph = DIR_GLYPH[grade.dir] || '';
  top.appendChild(makeDiv(doc, `oko-oil-chg oko-oil-${grade.dir}`, `${glyph} ${grade.pctText}`.trim()));
  wrap.appendChild(top);
  const bits = [];
  if (grade.dayRangeText) bits.push(`${translate('oil.day')} ${grade.dayRangeText}`);
  if (grade.week52Text) bits.push(`${translate('oil.week52')} ${grade.week52Text}`);
  if (bits.length) wrap.appendChild(makeDiv(doc, 'oko-oil-range', bits.join(' · ')));
  return wrap;
}

function drawChart(doc, model, lang) {
  const series = model.chart?.series || [];
  if (!series.length) return null;
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
      const first = series[0].points?.[0]?.t;
      const last = series[0].points?.at?.(-1)?.t;
      drawGasChart(ctx, series, {
        width: CHART_W,
        height: CHART_H,
        lastLabel: model.brent ? `Brent ${model.brent.usdText}` : (model.wti ? `WTI ${model.wti.usdText}` : ''),
        startLabel: first ? shortDate(first, lang) : '',
        endLabel: last ? shortDate(last, lang) : '',
      });
    }
  } catch { /* canvas unavailable (jsdom/headless) — the numbers still show */ }
  return canvas;
}

/**
 * The shared card BODY (no header): grade rows, spread, chart, source footer.
 * @returns {Node[]}
 */
export function buildOilCardNodes(model, { doc, translate, lang }) {
  if (!model?.ok) return [makeDiv(doc, 'oko-oil-note', translate('oil.unavailable'))];
  const nodes = [];
  if (model.brent) nodes.push(gradeRow(doc, translate, model.brent));
  if (model.wti) nodes.push(gradeRow(doc, translate, model.wti));
  if (model.spreadText) nodes.push(makeDiv(doc, 'oko-oil-spread', `${translate('oil.spread')} ${model.spreadText}`));
  const canvas = drawChart(doc, model, lang);
  if (canvas) nodes.push(canvas);
  nodes.push(makeDiv(doc, 'oko-oil-foot', model.sourceLine));
  return nodes;
}

/**
 * Floating overlay shown with a chokepoint scene (top-right).
 * @returns {{ refreshAndShow: () => Promise<void>, hide: () => void, element: HTMLElement|null }}
 */
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

  function renderModel(model) { el.replaceChildren(header(), ...buildOilCardNodes(model, { doc, translate, lang })); }
  function show() { el.hidden = false; }
  function hide() { el.hidden = true; }

  async function refreshAndShow() {
    show();
    const fresh = cachedPayload && (now() - cachedAt < REFETCH_TTL_MS);
    if (fresh) { renderModel(buildOilModel(cachedPayload, { lang, translate, nowMs: now() })); return; }
    if (!cachedPayload) el.replaceChildren(header(), makeDiv(doc, 'oko-oil-note', translate('oil.loading')));
    if (!inFlight) {
      inFlight = Promise.resolve(fetchImpl()).then((p) => { cachedPayload = p; cachedAt = now(); return p; }).finally(() => { inFlight = null; });
    }
    try { renderModel(buildOilModel(await inFlight, { lang, translate, nowMs: now() })); }
    catch { renderModel({ ok: false }); }
  }

  return { refreshAndShow, hide, element: el };
}

/**
 * The oil panel in the DATA tab (#oil-panel), independent of any scene. Renders
 * the same card body into [data-oil-body] and lazy-fetches the first time the
 * panel is expanded (or immediately if it starts open).
 * @returns {{ refresh: () => Promise<void>, element: HTMLElement|null }}
 */
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

  async function refresh() {
    const fresh = cachedPayload && (now() - cachedAt < REFETCH_TTL_MS);
    if (fresh) { body.replaceChildren(...buildOilCardNodes(buildOilModel(cachedPayload, { lang, translate, nowMs: now() }), { doc, translate, lang })); return; }
    if (!cachedPayload) body.replaceChildren(makeDiv(doc, 'oko-oil-note', translate('oil.loading')));
    if (!inFlight) {
      inFlight = Promise.resolve(fetchImpl()).then((p) => { cachedPayload = p; cachedAt = now(); return p; }).finally(() => { inFlight = null; });
    }
    try { body.replaceChildren(...buildOilCardNodes(buildOilModel(await inFlight, { lang, translate, nowMs: now() }), { doc, translate, lang })); }
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
  } catch { /* no MutationObserver (tests) — refresh() can still be called directly */ }
  maybeLoad();

  return { refresh, element: panel };
}

function ensureStyle(doc) {
  if (!doc?.getElementById || doc.getElementById('oko-oil-chip-style')) return;
  const style = doc.createElement('style');
  style.id = 'oko-oil-chip-style';
  style.textContent = `
.oko-oil-chip{position:fixed;top:52px;right:10px;z-index:60;width:262px;max-width:calc(100vw - 20px);
  padding:9px 11px;border-radius:11px;background:rgba(11,22,34,.85);border:1px solid rgba(57,208,255,.28);
  box-shadow:0 8px 26px rgba(0,0,0,.5);backdrop-filter:blur(7px);
  font-family:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;color:#dbeafe;letter-spacing:.02em;pointer-events:auto;}
.oko-oil-chip[hidden]{display:none;}
.oko-oil-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;}
.oko-oil-title{font-size:10px;font-weight:600;letter-spacing:.14em;color:#ffb547;text-transform:uppercase;}
.oko-oil-close{appearance:none;background:none;border:0;color:#8aa0b6;font-size:16px;line-height:1;cursor:pointer;padding:0 2px;}
.oko-oil-close:hover{color:#dbeafe;}
.oko-oil-grade{margin:3px 0;}
.oko-oil-line{display:flex;align-items:baseline;gap:7px;font-size:12px;}
.oko-oil-name{flex:0 0 40px;color:#8aa0b6;letter-spacing:.06em;}
.oko-oil-usd{color:#eaf2ff;font-variant-numeric:tabular-nums;}
.oko-oil-eur{color:#aebfd2;font-size:11px;font-variant-numeric:tabular-nums;}
.oko-oil-chg{margin-left:auto;font-size:11px;font-variant-numeric:tabular-nums;}
.oko-oil-up{color:#4ade80;}
.oko-oil-down{color:#f87171;}
.oko-oil-flat{color:#8aa0b6;}
.oko-oil-range{font-size:9px;color:#6f8398;letter-spacing:.02em;margin-top:1px;}
.oko-oil-spread{font-size:10px;color:#aebfd2;margin:4px 0 2px;font-variant-numeric:tabular-nums;}
.oko-oil-canvas{display:block;width:210px;height:92px;max-width:100%;margin:4px auto 2px;}
.oko-oil-note{font-size:11px;color:#8aa0b6;padding:2px 0;}
.oko-oil-foot{margin-top:5px;font-size:9px;line-height:1.3;color:#6f8398;letter-spacing:.02em;}
@media (max-width:520px){.oko-oil-chip{top:48px;right:8px;width:238px;}}
`;
  (doc.head || doc.documentElement).appendChild(style);
}
