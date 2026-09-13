// src/gasPanel.js
/**
 * @module gasPanel
 * @description Panel „PLYN“ (2026-09-13, používateľ: „potrebujem plyn
 * kompletne EÚ a ZSSR … ceny na burzách, história, zásobníky, prietoky“,
 * „platiť nechcem“): ľavá lišta vedľa Histórie letov, karty pribúdajú po
 * etapách. Etapa 1 = karta CENY: TTF front-month odvodený z ACER (denne,
 * pracovné dni), ceny LNG pre EÚ/SZ/J, graf 1M / 1R / MAX (MAX = mesačný
 * IMF rad od 1992 + denný ACER), vysvetlivka pre laika (ct/kWh) a poctivé
 * označenie zdroja a čerstvosti. Žiadne burzové kotácie — tie sú platené.
 *
 * DOM sa skladá tu z literálov (ako historyPanel.js); dáta a modely sú v
 * data/gasPrices.js, kreslenie v gasChart.js — obe čisté a testované.
 */
import { currentLanguage } from './i18n.js';
import {
  GAS_PRICE_RANGES, buildPricesModel, fetchGasPrices, formatDateLabel, formatEurMwh,
} from './data/gasPrices.js';
import { GAS_CHART_HEIGHT_PX, drawGasChart } from './gasChart.js';

export const GAS_PANEL_ID = 'gas-panel';
/** Ceny sa menia raz denne; obnova každých 30 min stačí (proxy má TTL 6 h). */
export const GAS_PANEL_REFRESH_MS = 30 * 60 * 1000;

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * @param {object} options
 * @param {Document} [options.doc]
 * @param {(k: string, v?: object) => string} options.t
 * @param {object} [options.api] { prices } (test seam)
 * @param {string|null} [options.lang] pevný jazyk (testy); inak currentLanguage()
 * @param {() => number} [options.nowMs]
 * @param {number} [options.refreshMs] 0 = bez periodickej obnovy
 * @param {(collapsed: boolean) => void} [options.setCollapsed]
 * @param {Function} [options.setIntervalImpl]
 * @param {Function} [options.clearIntervalImpl]
 */
export function installGasPanel({
  doc = globalThis.document,
  t,
  api = { prices: fetchGasPrices },
  lang = null,
  nowMs = () => Date.now(),
  refreshMs = GAS_PANEL_REFRESH_MS,
  setCollapsed = null,
  setIntervalImpl = globalThis.setInterval,
  clearIntervalImpl = globalThis.clearInterval,
} = {}) {
  const root = doc?.getElementById?.(GAS_PANEL_ID);
  const body = root?.querySelector?.('[data-gas-body]');
  if (!root || !body) return null;
  const language = () => lang || currentLanguage();
  let payload = null;
  let model = null;
  let range = '1m';
  let loadToken = 0;
  let lastError = null;

  const status = el(doc, 'div', 'gas-status', t('gas.loading'));
  status.dataset.state = 'loading';

  // ── karta CENY ──────────────────────────────────────────────────
  const card = el(doc, 'section', 'gas-card');
  card.dataset.card = 'prices';
  const cardTitle = el(doc, 'h3', 'gas-card-title', t('gas.prices'));
  const headline = el(doc, 'div', 'gas-headline');
  const headValue = el(doc, 'span', 'gas-headline-value', '—');
  const headDelta = el(doc, 'span', 'gas-delta', '');
  const headLabel = el(doc, 'span', 'gas-headline-label', '');
  headline.append(headValue, headDelta, headLabel);
  const subrows = el(doc, 'div', 'gas-subrows');
  const ranges = el(doc, 'div', 'gas-ranges');
  const rangeBtns = GAS_PRICE_RANGES.map((r) => {
    const b = el(doc, 'button', 'gas-range', t(`gas.range-${r}`));
    b.type = 'button';
    b.dataset.range = r;
    b.setAttribute('aria-pressed', r === range ? 'true' : 'false');
    b.addEventListener('click', () => { range = r; render(); });
    ranges.appendChild(b);
    return b;
  });
  const canvas = el(doc, 'canvas', 'gas-chart');
  canvas.height = GAS_CHART_HEIGHT_PX;
  const laic = el(doc, 'div', 'gas-laic', '');
  const note = el(doc, 'div', 'gas-note', '');
  const source = el(doc, 'div', 'gas-source', '');
  card.append(cardTitle, headline, subrows, ranges, canvas, laic, note, source);
  body.append(status, card);

  // ── render ──────────────────────────────────────────────────────
  function drawChart() {
    const ctx = canvas.getContext?.('2d');
    if (!ctx || !model?.ok) return;
    const width = Math.max(120, Math.floor(canvas.clientWidth || body.clientWidth || 320));
    const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
    if (canvas.height !== Math.round(GAS_CHART_HEIGHT_PX * dpr)) canvas.height = Math.round(GAS_CHART_HEIGHT_PX * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${GAS_CHART_HEIGHT_PX}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const series = model.chart.series;
    const lng = language();
    // „posledná“ = najnovší bod cez všetky rady (v MAX je to denný TTF, nie
    // mesačný IMF priemer spred dvoch mesiacov).
    let t0 = Infinity; let t1 = -Infinity; let vMax = -Infinity; let last = null;
    for (const s of series) for (const p of s.points) { if (p.t < t0) t0 = p.t; if (p.t > t1) { t1 = p.t; last = p; } if (p.v > vMax) vMax = p.v; }
    drawGasChart(ctx, series, {
      width,
      height: GAS_CHART_HEIGHT_PX,
      maxLabel: Number.isFinite(vMax) ? t('gas.max-label', { v: formatEurMwh(vMax, lng) }) : '',
      lastLabel: last ? t('gas.last-label', { v: formatEurMwh(last.v, lng) }) : '',
      startLabel: Number.isFinite(t0) ? formatDateLabel(isoDay(t0), lng, { year: range !== '1m' }) : '',
      endLabel: Number.isFinite(t1) ? formatDateLabel(isoDay(t1), lng, { year: range !== '1m' }) : '',
    });
  }

  function renderSubrows(rows) {
    subrows.textContent = '';
    for (const row of rows) {
      const cell = el(doc, 'span', 'gas-subrow');
      cell.dataset.key = row.key;
      cell.append(el(doc, 'span', 'gas-subrow-label', row.label), el(doc, 'span', 'gas-subrow-value', row.text));
      subrows.appendChild(cell);
    }
  }

  function render() {
    for (const b of rangeBtns) {
      const active = b.dataset.range === range;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    if (!payload) return;
    const lng = language();
    model = buildPricesModel(payload, { range, nowMs: nowMs(), lang: lng, translate: t });
    if (!model.ok) {
      status.textContent = t('gas.unavailable');
      status.dataset.state = 'error';
      return;
    }
    const head = model.headline;
    headValue.textContent = head ? head.text : '—';
    headDelta.textContent = head && head.pct !== null ? head.pctText : '';
    headDelta.dataset.dir = head ? head.dir : 'flat';
    headLabel.textContent = head ? `${head.label} · ${head.dateText}` : '';
    renderSubrows(model.rows);
    laic.textContent = model.laic;
    note.textContent = model.note;
    source.textContent = model.sourceLines.join(' · ');
    const latest = model.freshness.latestDate ? formatDateLabel(model.freshness.latestDate, lng) : '';
    status.textContent = model.freshness.stale ? t('gas.stale', { date: latest }) : t('gas.updated', { date: latest });
    status.dataset.state = model.freshness.stale ? 'stale' : 'ok';
    drawChart();
  }

  async function load() {
    const token = ++loadToken;
    try {
      const fresh = await api.prices();
      if (token !== loadToken) return;
      payload = fresh;
      lastError = null;
      render();
    } catch (error) {
      if (token !== loadToken) return;
      lastError = error?.message || String(error);
      if (!payload) {
        status.textContent = t('gas.unavailable');
        status.dataset.state = 'error';
      }
    }
  }

  const timer = refreshMs > 0 && typeof setIntervalImpl === 'function' ? setIntervalImpl(() => { void load(); }, refreshMs) : null;
  void load();

  return {
    /** Otvor panel (hlasový alias, kontextové menu). */
    open() { setCollapsed?.(false); },
    refresh: load,
    setRange(next) { if (GAS_PRICE_RANGES.includes(next)) { range = next; render(); } },
    _getStateForTest() {
      return {
        range, loaded: Boolean(payload), ok: Boolean(model?.ok), status: status.dataset.state, lastError,
        headline: model?.headline?.text ?? null, series: model?.chart?.series?.map((s) => s.key) ?? [],
      };
    },
    destroy() { if (timer !== null && typeof clearIntervalImpl === 'function') clearIntervalImpl(timer); },
  };
}
