// src/straitTrafficChip.js
//
// Live "vessels in the strait now" counter, shown top-left with a chokepoint
// scene (the oil-price chip is top-right). It polls the vessel layers every few
// seconds because the feeds arrive asynchronously — the delayed AISHub layer
// only loads after the scene flies in, and live AIS trickles in over the
// websocket — so a one-shot read would undercount. The pure counting lives in
// src/straitTraffic.js (tested); this is DOM + timer glue.

import { buildStraitTrafficModel } from './straitTraffic.js';
import { t } from './i18n.js';

const DEFAULT_INTERVAL_MS = 4000;

/**
 * @param {object} [deps]
 * @param {Document} [deps.documentRef]
 * @param {() => Array<object>} [deps.getLivePositions]
 * @param {() => Array<object>} [deps.getDelayedPositions]
 * @param {(key: string, vars?: object) => string} [deps.translate]
 * @param {number} [deps.intervalMs]
 * @param {(fn: Function, ms: number) => any} [deps.setIntervalImpl]
 * @param {(handle: any) => void} [deps.clearIntervalImpl]
 * @returns {{ showFor: (o: {rect: ReadonlyArray<number>, label?: string}) => void, hide: () => void, refresh: () => void, element: HTMLElement|null }}
 */
export function createStraitTrafficChip({
  documentRef = globalThis.document,
  getLivePositions = () => [],
  getDelayedPositions = () => [],
  translate = t,
  intervalMs = DEFAULT_INTERVAL_MS,
  setIntervalImpl = (fn, ms) => setInterval(fn, ms),
  clearIntervalImpl = (handle) => clearInterval(handle),
} = {}) {
  const doc = documentRef;
  if (!doc?.createElement) return { showFor: () => {}, hide: () => {}, refresh: () => {}, element: null };

  ensureStyle(doc);
  const el = doc.createElement('aside');
  el.className = 'oko-strait-chip';
  el.hidden = true;
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-label', translate('strait-traffic.title'));
  (doc.body || doc.documentElement).appendChild(el);

  let rect = null;
  let sceneLabel = '';
  let timer = null;

  const div = (cls, text) => { const d = doc.createElement('div'); d.className = cls; if (text != null) d.textContent = text; return d; };
  const closeButton = () => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'oko-strait-close';
    b.setAttribute('aria-label', translate('strait-traffic.close'));
    b.textContent = '×';
    b.addEventListener('click', hide);
    return b;
  };
  const header = () => {
    const head = div('oko-strait-head');
    const titles = div('oko-strait-titles');
    titles.appendChild(div('oko-strait-title', translate('strait-traffic.title')));
    if (sceneLabel) titles.appendChild(div('oko-strait-scene', sceneLabel));
    head.appendChild(titles);
    head.appendChild(closeButton());
    return head;
  };

  const safe = (getter) => { try { const v = getter(); return Array.isArray(v) ? v : []; } catch { return []; } };

  function render(model, { loading = false } = {}) {
    const nodes = [header()];
    if (loading) {
      nodes.push(div('oko-strait-note', translate('strait-traffic.loading')));
      el.replaceChildren(...nodes);
      return;
    }
    const big = div('oko-strait-count');
    big.appendChild(div('oko-strait-num', String(model.total)));
    big.appendChild(div('oko-strait-unit', translate('strait-traffic.vessels')));
    nodes.push(big);
    nodes.push(div('oko-strait-split', translate('strait-traffic.split', { live: model.live, delayed: model.delayed })));
    nodes.push(div('oko-strait-note', translate('strait-traffic.tracked')));
    el.replaceChildren(...nodes);
  }

  function refresh() {
    if (el.hidden || !rect) return;
    const live = safe(getLivePositions);
    const delayed = safe(getDelayedPositions);
    if (!live.length && !delayed.length) { render(null, { loading: true }); return; }
    render(buildStraitTrafficModel({ live, delayed }, rect));
  }

  function showFor({ rect: nextRect, label = '' } = {}) {
    if (!Array.isArray(nextRect) || nextRect.length !== 4) return;
    rect = nextRect;
    sceneLabel = String(label || '');
    el.hidden = false;
    refresh();
    if (timer) clearIntervalImpl(timer);
    timer = setIntervalImpl(refresh, intervalMs);
    timer?.unref?.();
  }

  function hide() {
    el.hidden = true;
    if (timer) { clearIntervalImpl(timer); timer = null; }
  }

  return { showFor, hide, refresh, element: el };
}

function ensureStyle(doc) {
  if (!doc?.getElementById || doc.getElementById('oko-strait-chip-style')) return;
  const style = doc.createElement('style');
  style.id = 'oko-strait-chip-style';
  style.textContent = `
.oko-strait-chip{position:fixed;top:52px;left:10px;z-index:60;min-width:150px;max-width:220px;
  padding:8px 10px;border-radius:10px;background:rgba(11,22,34,.82);border:1px solid rgba(57,208,255,.28);
  box-shadow:0 6px 22px rgba(0,0,0,.45);backdrop-filter:blur(6px);
  font-family:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;color:#dbeafe;pointer-events:auto;}
.oko-strait-chip[hidden]{display:none;}
.oko-strait-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;}
.oko-strait-title{font-size:10px;font-weight:600;letter-spacing:.14em;color:#39d0ff;text-transform:uppercase;}
.oko-strait-scene{font-size:10px;color:#8aa0b6;margin-top:1px;letter-spacing:.02em;}
.oko-strait-close{appearance:none;background:none;border:0;color:#8aa0b6;font-size:16px;line-height:1;cursor:pointer;padding:0 2px;}
.oko-strait-close:hover{color:#dbeafe;}
.oko-strait-count{display:flex;align-items:baseline;gap:6px;margin:4px 0 2px;}
.oko-strait-num{font-size:26px;font-weight:700;line-height:1;color:#eaf2ff;font-variant-numeric:tabular-nums;}
.oko-strait-unit{font-size:10px;color:#8aa0b6;letter-spacing:.04em;}
.oko-strait-split{font-size:11px;color:#aebfd2;font-variant-numeric:tabular-nums;}
.oko-strait-note{font-size:9px;color:#6f8398;letter-spacing:.03em;margin-top:4px;text-transform:uppercase;}
`;
  (doc.head || doc.documentElement).appendChild(style);
}
