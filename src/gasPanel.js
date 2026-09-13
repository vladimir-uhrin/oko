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
import { buildFlowsModel, fetchGasFlows, formatGwhDay } from './data/gasFlows.js';
import { GAS_STORAGE_RANGES, buildLngModel, buildStorageModel, fetchGasLng, fetchGasStorage, formatPctFull } from './data/gasStorage.js';
import { GAS_CHART_HEIGHT_PX, drawGasChart, drawSparkline } from './gasChart.js';

export const GAS_SPARK_W = 64;
export const GAS_SPARK_H = 18;

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
  api = { prices: fetchGasPrices, flows: fetchGasFlows, storage: fetchGasStorage, lng: fetchGasLng },
  lang = null,
  nowMs = () => Date.now(),
  refreshMs = GAS_PANEL_REFRESH_MS,
  setCollapsed = null,
  onFlyTo = null,
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

  // ── karta TOKY (ENTSOG, predbežné D−1) ──────────────────────────
  const flowsCard = el(doc, 'section', 'gas-card');
  flowsCard.dataset.card = 'flows';
  const flowsTitle = el(doc, 'h3', 'gas-card-title', t('gas.flows'));
  const flowsStatus = el(doc, 'div', 'gas-status', t('gas.flows-loading'));
  flowsStatus.dataset.state = 'loading';
  const flowsBody = el(doc, 'div', 'gas-flows');
  const flowsNote = el(doc, 'div', 'gas-note', '');
  const flowsSource = el(doc, 'div', 'gas-source', '');
  flowsCard.append(flowsTitle, flowsStatus, flowsBody, flowsNote, flowsSource);

  // ── karta ZÁSOBNÍKY (GIE AGSI+) ─────────────────────────────────
  let storageRange = '1y';
  const storageCard = el(doc, 'section', 'gas-card');
  storageCard.dataset.card = 'storage';
  const storageTitle = el(doc, 'h3', 'gas-card-title', t('gas.storage'));
  const storageStatus = el(doc, 'div', 'gas-status', t('gas.storage-loading'));
  storageStatus.dataset.state = 'loading';
  const storageHead = el(doc, 'div', 'gas-headline');
  const storageValue = el(doc, 'span', 'gas-headline-value', '—');
  const storageDelta = el(doc, 'span', 'gas-delta', '');
  const storageLabel = el(doc, 'span', 'gas-headline-label', '');
  const storageSub = el(doc, 'span', 'gas-headline-sub', '');
  storageHead.append(storageValue, storageDelta, storageLabel, storageSub);
  const storageRanges = el(doc, 'div', 'gas-ranges');
  const storageRangeBtns = GAS_STORAGE_RANGES.map((r) => {
    const b = el(doc, 'button', 'gas-range', t(`gas.range-${r}`));
    b.type = 'button';
    b.dataset.range = r;
    b.setAttribute('aria-pressed', r === storageRange ? 'true' : 'false');
    b.addEventListener('click', () => { storageRange = r; renderStorage(); });
    storageRanges.appendChild(b);
    return b;
  });
  const storageCanvas = el(doc, 'canvas', 'gas-chart');
  storageCanvas.height = GAS_CHART_HEIGHT_PX;
  const storageRows = el(doc, 'div', 'gas-flows');
  const storageNote = el(doc, 'div', 'gas-note', '');
  const storageSource = el(doc, 'div', 'gas-source', '');
  storageCard.append(storageTitle, storageStatus, storageHead, storageRanges, storageCanvas, storageRows, storageNote, storageSource);

  // ── karta LNG (GIE ALSI) ────────────────────────────────────────
  const lngCard = el(doc, 'section', 'gas-card');
  lngCard.dataset.card = 'lng';
  const lngTitle = el(doc, 'h3', 'gas-card-title', t('gas.lng'));
  const lngStatus = el(doc, 'div', 'gas-status', t('gas.lng-loading'));
  lngStatus.dataset.state = 'loading';
  const lngHead = el(doc, 'div', 'gas-headline');
  const lngValue = el(doc, 'span', 'gas-headline-value', '—');
  const lngLabel = el(doc, 'span', 'gas-headline-label', '');
  const lngSub = el(doc, 'span', 'gas-headline-sub', '');
  lngHead.append(lngValue, lngLabel, lngSub);
  const lngCanvas = el(doc, 'canvas', 'gas-chart');
  lngCanvas.height = GAS_CHART_HEIGHT_PX;
  const lngRows = el(doc, 'div', 'gas-flows');
  const lngNote = el(doc, 'div', 'gas-note', '');
  const lngSource = el(doc, 'div', 'gas-source', '');
  lngCard.append(lngTitle, lngStatus, lngHead, lngCanvas, lngRows, lngNote, lngSource);

  body.append(status, card, flowsCard, storageCard, lngCard);

  // ── render ──────────────────────────────────────────────────────
  /**
   * Spoločné kreslenie časového grafu do plátna karty (ceny, zásobníky, LNG).
   * „posledná“ = najnovší bod cez všetky rady (v MAX cien je to denný TTF, nie
   * mesačný IMF priemer spred dvoch mesiacov).
   */
  function paintSeries(target, series, { format = (v) => String(v), withYear = true } = {}) {
    const ctx = target.getContext?.('2d');
    if (!ctx) return;
    const width = Math.max(120, Math.floor(target.clientWidth || body.clientWidth || 320));
    const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
    if (target.width !== Math.round(width * dpr)) target.width = Math.round(width * dpr);
    if (target.height !== Math.round(GAS_CHART_HEIGHT_PX * dpr)) target.height = Math.round(GAS_CHART_HEIGHT_PX * dpr);
    target.style.width = `${width}px`;
    target.style.height = `${GAS_CHART_HEIGHT_PX}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const lng = language();
    let t0 = Infinity; let t1 = -Infinity; let vMax = -Infinity; let last = null;
    for (const s of series || []) for (const p of s.points) { if (p.t < t0) t0 = p.t; if (p.t > t1) { t1 = p.t; last = p; } if (p.v > vMax) vMax = p.v; }
    drawGasChart(ctx, series || [], {
      width,
      height: GAS_CHART_HEIGHT_PX,
      maxLabel: Number.isFinite(vMax) ? t('gas.max-label', { v: format(vMax) }) : '',
      lastLabel: last ? t('gas.last-label', { v: format(last.v) }) : '',
      startLabel: Number.isFinite(t0) ? formatDateLabel(isoDay(t0), lng, { year: withYear }) : '',
      endLabel: Number.isFinite(t1) ? formatDateLabel(isoDay(t1), lng, { year: withYear }) : '',
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
    paintSeries(canvas, model.chart.series, { format: (v) => formatEurMwh(v, lng), withYear: range !== '1m' });
  }

  async function loadPrices() {
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

  // ── toky ────────────────────────────────────────────────────────
  let flowsPayload = null;
  let flowsModel = null;
  let flowsToken = 0;
  let flowsError = null;

  function renderFlows() {
    if (!flowsPayload) return;
    const lng = language();
    flowsModel = buildFlowsModel(flowsPayload, { lang: lng, translate: t, nowMs: nowMs() });
    flowsBody.textContent = '';
    if (!flowsModel.ok) {
      flowsStatus.textContent = t('gas.flows-unavailable');
      flowsStatus.dataset.state = 'error';
      return;
    }
    for (const group of flowsModel.groups) {
      const g = el(doc, 'div', 'gas-flow-group');
      g.dataset.group = group.key;
      g.appendChild(el(doc, 'h4', 'gas-flow-group-title', group.title));
      for (const row of group.rows) {
        const r = el(doc, 'div', 'gas-flow-row');
        r.dataset.level = row.level;
        r.dataset.id = row.id;
        const head = el(doc, 'div', 'gas-flow-head');
        head.append(el(doc, 'span', 'gas-flow-route', `${row.route} · ${row.name}`), el(doc, 'span', 'gas-flow-value', row.text));
        const spark = el(doc, 'canvas', 'gas-spark');
        spark.width = GAS_SPARK_W;
        spark.height = GAS_SPARK_H;
        const sub = el(doc, 'span', 'gas-flow-sub', [row.mcmText, row.avg7Text, row.dateText, row.statusText].filter(Boolean).join(' · '));
        r.append(head, spark, sub);
        if (row.note) r.appendChild(el(doc, 'span', 'gas-flow-note', row.note));
        if (onFlyTo && Number.isFinite(row.lat) && Number.isFinite(row.lon)) {
          // Klik na riadok = prelet kamery k stanici (a zapnutie vrstvy tokov).
          r.dataset.fly = 'true';
          r.setAttribute('role', 'button');
          r.setAttribute('tabindex', '0');
          r.setAttribute('title', t('gas.flow-fly'));
          const fly = () => onFlyTo({ id: row.id, name: row.name, lat: row.lat, lon: row.lon });
          r.addEventListener('click', fly);
          r.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fly(); } });
        }
        g.appendChild(r);
        const ctx = spark.getContext?.('2d');
        if (ctx) drawSparkline(ctx, row.spark, { width: GAS_SPARK_W, height: GAS_SPARK_H });
      }
      flowsBody.appendChild(g);
    }
    flowsNote.textContent = flowsModel.note;
    flowsSource.textContent = flowsModel.sourceLine;
    const latest = flowsModel.freshness.latestDate ? formatDateLabel(flowsModel.freshness.latestDate, lng) : '';
    flowsStatus.textContent = flowsModel.freshness.stale ? t('gas.stale', { date: latest || '—' }) : t('gas.flows-updated', { date: latest });
    flowsStatus.dataset.state = flowsModel.freshness.stale ? 'stale' : 'ok';
  }

  async function loadFlows() {
    const token = ++flowsToken;
    try {
      const fresh = await api.flows();
      if (token !== flowsToken) return;
      flowsPayload = fresh;
      flowsError = null;
      renderFlows();
    } catch (error) {
      if (token !== flowsToken) return;
      flowsError = error?.message || String(error);
      if (!flowsPayload) {
        flowsStatus.textContent = t('gas.flows-unavailable');
        flowsStatus.dataset.state = 'error';
      }
    }
  }

  // ── zásobníky a LNG ─────────────────────────────────────────────
  let storagePayload = null; let storageModel = null; let storageToken = 0; let storageError = null;
  let lngPayload = null; let lngModel = null; let lngToken = 0; let lngError = null;

  /** Riadky krajín: meno + hodnota, voliteľný pás naplnenia (% pracovného objemu), podriadok. */
  function renderCountryRows(container, rows, { valueOf, barOf = null }) {
    container.textContent = '';
    for (const row of rows) {
      const r = el(doc, 'div', 'gas-flow-row');
      r.dataset.level = row.level;
      r.dataset.id = row.code;
      const head = el(doc, 'div', 'gas-flow-head');
      head.append(el(doc, 'span', 'gas-flow-route', row.name), el(doc, 'span', 'gas-flow-value', valueOf(row)));
      const pct = barOf ? barOf(row) : null;
      const bar = el(doc, 'span', 'gas-bar');
      const fill = el(doc, 'span', 'gas-bar-fill');
      fill.style.width = `${Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0}%`;
      bar.appendChild(fill);
      bar.hidden = !Number.isFinite(pct);
      r.append(head, bar, el(doc, 'span', 'gas-flow-sub', row.sub || ''));
      container.appendChild(r);
    }
  }

  function renderStorage() {
    for (const b of storageRangeBtns) {
      const active = b.dataset.range === storageRange;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    if (!storagePayload) return;
    const lng = language();
    storageModel = buildStorageModel(storagePayload, { lang: lng, translate: t, nowMs: nowMs(), range: storageRange });
    if (!storageModel.ok) {
      storageStatus.textContent = t('gas.storage-unavailable');
      storageStatus.dataset.state = 'error';
      return;
    }
    const h = storageModel.headline;
    storageValue.textContent = h.fullText;
    storageDelta.textContent = h.netText;
    storageDelta.dataset.dir = h.dir;
    storageLabel.textContent = [t('gas.storage-eu'), h.dateText, h.statusText].filter(Boolean).join(' · ');
    storageSub.textContent = [h.twhText, h.yearAgoText, h.daysText].filter(Boolean).join(' · ');
    renderCountryRows(storageRows, storageModel.rows, { valueOf: (r) => r.fullText, barOf: (r) => r.fullPct });
    storageNote.textContent = storageModel.note;
    storageSource.textContent = storageModel.sourceLine;
    const latest = storageModel.freshness.latestDate ? formatDateLabel(storageModel.freshness.latestDate, lng) : '';
    storageStatus.textContent = storageModel.freshness.stale ? t('gas.stale', { date: latest || '—' }) : t('gas.storage-updated', { date: latest });
    storageStatus.dataset.state = storageModel.freshness.stale ? 'stale' : 'ok';
    paintSeries(storageCanvas, storageModel.chart.series, { format: (v) => formatPctFull(v, lng), withYear: true });
  }

  function renderLng() {
    if (!lngPayload) return;
    const lng = language();
    lngModel = buildLngModel(lngPayload, { lang: lng, translate: t, nowMs: nowMs() });
    if (!lngModel.ok) {
      lngStatus.textContent = t('gas.lng-unavailable');
      lngStatus.dataset.state = 'error';
      return;
    }
    const h = lngModel.headline;
    lngValue.textContent = h.sendOutText;
    lngLabel.textContent = [t('gas.lng-eu'), h.dateText, h.statusText].filter(Boolean).join(' · ');
    lngSub.textContent = h.inventoryText;
    renderCountryRows(lngRows, lngModel.rows, { valueOf: (r) => r.sendOutText });
    lngNote.textContent = lngModel.note;
    lngSource.textContent = lngModel.sourceLine;
    const latest = lngModel.freshness.latestDate ? formatDateLabel(lngModel.freshness.latestDate, lng) : '';
    lngStatus.textContent = lngModel.freshness.stale ? t('gas.stale', { date: latest || '—' }) : t('gas.lng-updated', { date: latest });
    lngStatus.dataset.state = lngModel.freshness.stale ? 'stale' : 'ok';
    paintSeries(lngCanvas, lngModel.chart.series, { format: (v) => formatGwhDay(v, lng), withYear: true });
  }

  const gieErrorKey = (error, fallback) => (error?.code === 'no_key' ? 'gas.gie-no-key' : fallback);

  async function loadStorage() {
    const token = ++storageToken;
    try {
      const fresh = await api.storage();
      if (token !== storageToken) return;
      storagePayload = fresh;
      storageError = null;
      renderStorage();
    } catch (error) {
      if (token !== storageToken) return;
      storageError = error?.message || String(error);
      if (!storagePayload) {
        storageStatus.textContent = t(gieErrorKey(error, 'gas.storage-unavailable'));
        storageStatus.dataset.state = 'error';
      }
    }
  }

  async function loadLng() {
    const token = ++lngToken;
    try {
      const fresh = await api.lng();
      if (token !== lngToken) return;
      lngPayload = fresh;
      lngError = null;
      renderLng();
    } catch (error) {
      if (token !== lngToken) return;
      lngError = error?.message || String(error);
      if (!lngPayload) {
        lngStatus.textContent = t(gieErrorKey(error, 'gas.lng-unavailable'));
        lngStatus.dataset.state = 'error';
      }
    }
  }

  function load() {
    return Promise.all([loadPrices(), loadFlows(), loadStorage(), loadLng()]);
  }

  const timer = refreshMs > 0 && typeof setIntervalImpl === 'function' ? setIntervalImpl(() => { void load(); }, refreshMs) : null;
  void load();

  return {
    /** Otvor panel (hlasový alias, kontextové menu). */
    open() { setCollapsed?.(false); },
    refresh: load,
    setRange(next) { if (GAS_PRICE_RANGES.includes(next)) { range = next; render(); } },
    setStorageRange(next) { if (GAS_STORAGE_RANGES.includes(next)) { storageRange = next; renderStorage(); } },
    _getStateForTest() {
      return {
        range, loaded: Boolean(payload), ok: Boolean(model?.ok), status: status.dataset.state, lastError,
        headline: model?.headline?.text ?? null, series: model?.chart?.series?.map((s) => s.key) ?? [],
        flows: {
          loaded: Boolean(flowsPayload), ok: Boolean(flowsModel?.ok), status: flowsStatus.dataset.state, lastError: flowsError,
          rows: flowsModel?.groups?.reduce((n, g) => n + g.rows.length, 0) ?? 0,
        },
        storage: {
          loaded: Boolean(storagePayload), ok: Boolean(storageModel?.ok), status: storageStatus.dataset.state, lastError: storageError,
          range: storageRange, headline: storageModel?.headline?.fullText ?? null, rows: storageModel?.rows?.length ?? 0,
          points: storageModel?.chart?.series?.[0]?.points?.length ?? 0,
        },
        lng: {
          loaded: Boolean(lngPayload), ok: Boolean(lngModel?.ok), status: lngStatus.dataset.state, lastError: lngError,
          headline: lngModel?.headline?.sendOutText ?? null, rows: lngModel?.rows?.length ?? 0,
        },
      };
    },
    destroy() { if (timer !== null && typeof clearIntervalImpl === 'function') clearIntervalImpl(timer); },
  };
}
