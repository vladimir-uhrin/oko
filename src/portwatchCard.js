// src/portwatchCard.js
/**
 * @module portwatchCard
 * @description Karta PRECHODY ÚŽINAMI v paneli BLÍZKY VÝCHOD (etapa 5a, 2026-09-26; plán
 * docs/drafts/blizky-vychod-plan.md kap. 6): Hormuz, Báb al-Mandab, Suez a Mys dobrej nádeje
 * z IMF PortWatch — priemer lodí za posledných 7 dní, zmena voči pomenovanému oknu pred
 * krízou, mini graf za rok s prerušovanou čiarou toho priemeru, posledný deň a tankery.
 *
 * Poctivosť (CLAUDE.md pravidlo 2): sú to ODHADY MMF z AIS, predbežné, s oneskorením
 * niekoľko dní a obnovou približne raz týždenne — karta to hovorí v poznámke, pri každej
 * úžine ukazuje posledný deň a nad prahom veku jantárové ZASTARANÉ. Porovnanie s obdobím
 * pred krízou je náš výpočet (odvodené), okno je pri každej úžine pomenované dátumami.
 * Atribúcia MMF (podmienky: zdroj + odkaz) je v pätke s odkazom na dataset.
 *
 * Načítanie je lenivé ako pri bulletine: sťahuje sa až pri prvom rozbalení panela
 * (vlastník = `closest('[data-panel-id]')`, trieda `collapsed`), potom každých 30 min,
 * kým je panel otvorený. Bez DOM (Node testy) funguje s falošným dokumentom; plátno
 * bez `getContext` sa preskočí.
 */
import { currentLanguage, t } from './i18n.js';
import { ageText } from './data/ukraineFreshness.js';
import {
  PORTWATCH_DATASET_URL, PORTWATCH_KEYS, PORTWATCH_STALE_DAYS,
  fetchPortwatch, portwatchChokepoint, portwatchSummary,
} from './data/portwatch.js';

export const PORTWATCH_REFRESH_MS = 30 * 60_000;
export const PORTWATCH_SPARK_W = 168;
export const PORTWATCH_SPARK_H = 28;

const INERT = Object.freeze({ element: null, refresh: async () => {}, setActive() {}, destroy() {}, isOpen: false, loadedOnce: false, activeKey: null });

/**
 * Mini graf roka: plocha + čiara počtu prechodov, prerušovaná vodorovná čiara priemeru
 * pred krízou. Mierka = max(séria, priemer), spodok = 0 (nula prechodov je informácia).
 * Vracia false, keď nie je čo kresliť. Berie ctx, nech sa testuje na stube.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<number|null>} values
 * @param {number|null} baseline
 * @param {{width: number, height: number, line?: string, fill?: string, base?: string}} o
 */
export function drawTransitSpark(ctx, values, baseline, { width, height, line = 'rgba(57, 208, 255, 0.95)', fill = 'rgba(57, 208, 255, 0.16)', base = 'rgba(255, 181, 71, 0.9)' } = {}) {
  ctx.clearRect(0, 0, width, height);
  const pts = (values || []).map((v) => (Number.isFinite(v) ? v : null));
  const valid = pts.filter((v) => v !== null);
  if (valid.length < 2) return false;
  const top = Math.max(...valid, Number.isFinite(baseline) ? baseline : 0, 1);
  const n = pts.length;
  const x = (i) => 1 + (n > 1 ? (i / (n - 1)) * (width - 2) : 0);
  const y = (v) => height - 1 - (v / top) * (height - 3);
  let first = -1; let last = -1;
  pts.forEach((v, i) => { if (v === null) return; if (first < 0) first = i; last = i; });
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x(first), height - 1);
  pts.forEach((v, i) => { if (v !== null) ctx.lineTo(x(i), y(v)); });
  ctx.lineTo(x(last), height - 1);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  let pen = false;
  pts.forEach((v, i) => {
    if (v === null) { pen = false; return; }
    if (!pen) { ctx.moveTo(x(i), y(v)); pen = true; } else ctx.lineTo(x(i), y(v));
  });
  ctx.stroke();
  if (Number.isFinite(baseline) && baseline > 0) {
    ctx.strokeStyle = base;
    ctx.setLineDash?.([3, 3]);
    ctx.beginPath();
    ctx.moveTo(1, y(baseline));
    ctx.lineTo(width - 1, y(baseline));
    ctx.stroke();
    ctx.setLineDash?.([]);
  }
  return true;
}

/**
 * @param {{mountTarget?: Element|null, keys?: string[], fetchImpl?: Function, translate?: Function, lang?: string,
 *   documentRef?: Document, now?: () => number, refreshMs?: number, setTimer?: Function, clearTimer?: Function,
 *   observerFactory?: (fn: Function) => {observe: Function, disconnect: Function}}} [opts]
 */
export function createPortwatchCard({
  mountTarget = null,
  keys = PORTWATCH_KEYS,
  fetchImpl = fetchPortwatch,
  translate = t,
  lang = currentLanguage(),
  documentRef = globalThis.document,
  now = () => Date.now(),
  refreshMs = PORTWATCH_REFRESH_MS,
  setTimer = (fn, ms) => setInterval(fn, ms),
  clearTimer = (id) => clearInterval(id),
  observerFactory = (fn) => new MutationObserver(fn),
} = {}) {
  const doc = documentRef;
  if (!doc?.createElement || !mountTarget) return INERT;
  const el = (tag, className = '', text = null) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const locale = lang === 'sk' ? 'sk-SK' : 'en-GB';
  const num1 = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const num0 = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const pctFormat = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' });
  const dayFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const fmtDay = (day) => { const ms = Date.parse(`${day}T00:00:00Z`); return Number.isFinite(ms) ? dayFormat.format(new Date(ms)) : String(day || ''); };
  const fmt1 = (v) => (Number.isFinite(v) ? num1.format(v) : '—');

  // ── Kostra ────────────────────────────────────────────────────────────────
  const root = el('div', 'oko-pw');
  const status = el('div', 'oko-pw-status gas-status', translate('mideast.pw.loading'));
  status.dataset.state = 'idle';
  const rows = el('div', 'oko-pw-rows');
  rows.setAttribute('role', 'list');
  const note = el('p', 'oko-pw-note', translate('mideast.pw.note'));
  const foot = el('p', 'oko-pw-src');
  root.appendChild(status);
  root.appendChild(rows);
  root.appendChild(note);
  root.appendChild(foot);
  mountTarget.replaceChildren(root);

  let activeKey = null;
  let lastPayload = null;
  let open = false;
  let loadedOnce = false;
  let timer = null;
  let observer = null;
  let inFlight = null;
  const rowByKey = new Map();

  function setState(state, text) {
    status.dataset.state = state;
    status.textContent = text;
    status.hidden = state === 'ready';
  }

  function renderRow(c) {
    const cp = portwatchChokepoint(c.key);
    const s = portwatchSummary(c.rows, cp, {
      nowMs: now(), staleDays: PORTWATCH_STALE_DAYS,
      baselineMean: c.baseline?.mean ?? null, baselineTankerMean: c.baseline?.meanTanker ?? null, baselineDays: c.baseline?.days ?? null,
    });
    const row = el('div', 'oko-pw-row');
    row.setAttribute('role', 'listitem');
    row.dataset.key = c.key;
    row.classList?.toggle?.('is-active', c.key === activeKey);
    row.classList?.toggle?.('is-stale', s.stale);
    const head = el('div', 'oko-pw-head');
    const nameKey = `mideast.pw.${c.key}`;
    const name = translate(nameKey);
    head.appendChild(el('span', 'oko-pw-name', name === nameKey ? (cp?.name || c.key) : name));
    head.appendChild(el('span', 'oko-pw-avg', translate('mideast.pw.avg7', { n: fmt1(s.avg7) })));
    if (s.pctVsBaseline !== null) {
      const pct = el('span', `oko-pw-pct ${s.pctVsBaseline < 0 ? 'is-down' : (s.pctVsBaseline > 0 ? 'is-up' : 'is-flat')}`, pctFormat.format(s.pctVsBaseline / 100));
      pct.title = translate('mideast.pw.pct-tip');
      head.appendChild(pct);
    }
    row.appendChild(head);
    const canvas = el('canvas', 'oko-pw-spark');
    canvas.width = PORTWATCH_SPARK_W;
    canvas.height = PORTWATCH_SPARK_H;
    canvas.setAttribute('aria-hidden', 'true');
    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (ctx) drawTransitSpark(ctx, s.spark.map((p) => p.total), s.baseline?.mean ?? null, { width: PORTWATCH_SPARK_W, height: PORTWATCH_SPARK_H });
    row.appendChild(canvas);
    if (s.lastDay) {
      row.appendChild(el('div', 'oko-pw-sub', translate('mideast.pw.last', { date: fmtDay(s.lastDay), n: num0.format(s.lastTotal), k: fmt1(s.avg7Tanker) })));
    }
    if (s.baseline && Number.isFinite(s.baseline.mean)) {
      row.appendChild(el('div', 'oko-pw-base', translate(`mideast.pw.baseline.${s.baseline.id}`, { n: fmt1(s.baseline.mean), k: fmt1(s.baseline.meanTanker) })));
    }
    return { row, summary: s };
  }

  function render(payload) {
    lastPayload = payload;
    rowByKey.clear();
    const list = (payload?.chokepoints || []).filter((c) => keys.includes(c.key));
    const built = list.map((c) => { const r = renderRow(c); rowByKey.set(c.key, r.row); return r; });
    rows.replaceChildren(...built.map((r) => r.row));
    // Pätka: najnovší deň zo všetkých úžin + vek + ZASTARANÉ + odkaz na dataset MMF.
    const lastDays = built.map((r) => r.summary.lastDay).filter(Boolean).sort();
    const newest = lastDays.at(-1) || null;
    const newestSummary = built.find((r) => r.summary.lastDay === newest)?.summary || null;
    const parts = [];
    if (newest) parts.push(el('span', 'oko-pw-since', translate('mideast.pw.since', { date: fmtDay(newest) })));
    const age = newestSummary ? ageText(newestSummary.ageDays, translate) : '';
    if (age) parts.push(el('span', 'oko-pw-age', `· ${age}`));
    if (newestSummary?.stale) {
      const badge = el('span', 'oko-pw-age is-stale', translate('ukraine.src.stale'));
      badge.title = translate('ukraine.src.stale-note');
      parts.push(badge);
    }
    const link = el('a', 'oko-pw-link', translate('mideast.pw.source'));
    link.href = PORTWATCH_DATASET_URL;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = payload?.attribution || '';
    parts.push(link);
    foot.replaceChildren(...parts);
    setState(built.length ? 'ready' : 'empty', built.length ? '' : translate('mideast.pw.missing'));
  }

  async function refresh() {
    if (inFlight) return inFlight;
    if (!lastPayload) setState('loading', translate('mideast.pw.loading'));
    inFlight = Promise.resolve()
      .then(() => fetchImpl(keys))
      .then((payload) => { loadedOnce = true; render(payload); })
      .catch((error) => {
        loadedOnce = true;
        // Porucha pri už zobrazených číslach: čísla ostávajú (s vekom), stav hlási poruchu aj to,
        // že ide o posledné načítané; bez nich len poruchu.
        if (error?.status === 404 && !lastPayload) setState('empty', translate('mideast.pw.missing'));
        else setState('error', lastPayload ? `${translate('mideast.pw.error')} · ${translate('mideast.pw.kept')}` : translate('mideast.pw.error'));
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  }

  function show() {
    if (open) return;
    open = true;
    void refresh();
    if (refreshMs > 0) timer = setTimer(() => { void refresh(); }, refreshMs);
  }
  function hide() {
    if (!open) return;
    open = false;
    if (timer !== null) { clearTimer(timer); timer = null; }
  }

  // Panel vlastní otvorené/zavreté; prvé sťahovanie až pri prvom rozbalení.
  const ownerPanel = typeof mountTarget.closest === 'function' ? mountTarget.closest('[data-panel-id]') : null;
  if (ownerPanel) {
    const sync = () => { if (ownerPanel.classList.contains('collapsed')) hide(); else show(); };
    try {
      observer = observerFactory(sync);
      observer.observe(ownerPanel, { attributes: true, attributeFilter: ['class'] });
    } catch { observer = null; }
    sync();
  } else {
    show();
  }

  function setActive(key) {
    activeKey = keys.includes(key) ? key : null;
    for (const [k, row] of rowByKey) row.classList?.toggle?.('is-active', k === activeKey);
  }

  return {
    element: root,
    refresh,
    setActive,
    get isOpen() { return open; },
    get loadedOnce() { return loadedOnce; },
    get activeKey() { return activeKey; },
    destroy() {
      hide();
      try { observer?.disconnect?.(); } catch { /* */ }
      rowByKey.clear();
      mountTarget.replaceChildren();
    },
  };
}
