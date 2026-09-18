// src/straitTrafficChip.js
//
// "Strait overview" card shown top-left with a chokepoint scene. It answers
// "what is this strait and what is moving through it right now":
//   - curated facts: what it connects, its shores, its narrowest width, what
//     flows through it (static, from the chokepoint catalog);
//   - live from AIS: vessels in view now (live + delayed AISHub, deduped), a
//     type breakdown (tankers / cargo / passenger / other), and movement
//     (share under way, average speed);
//   - "no AIS (radar)": Sentinel-1 SAR detections with no AIS match, DELAYED
//     (per-pass), labelled as such — never mixed into the live "now" count.
//
// The pure counting lives in src/straitTraffic.js (tested); the facts in
// src/chokepointScenes.js (tested). This is DOM + a 4 s poll, because the feeds
// arrive asynchronously after the scene flies in.

import { buildStraitTrafficModel } from './straitTraffic.js';
import { t } from './i18n.js';

const DEFAULT_INTERVAL_MS = 4000;

export function createStraitTrafficChip({
  documentRef = globalThis.document,
  getLivePositions = () => [],
  getDelayedPositions = () => [],
  getDarkPositions = () => [],
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
  let label = '';
  let facts = null;
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
  const factRow = (labelKey, value) => {
    const row = div('oko-strait-fact');
    row.appendChild(div('oko-strait-fact-k', translate(labelKey)));
    row.appendChild(div('oko-strait-fact-v', value));
    return row;
  };

  const safe = (getter) => { try { const v = getter(); return Array.isArray(v) ? v : []; } catch { return []; } };

  function header() {
    const head = div('oko-strait-head');
    head.appendChild(div('oko-strait-title', label || translate('strait-traffic.title')));
    head.appendChild(closeButton());
    return head;
  }

  function factsBlock() {
    const nodes = [];
    if (facts?.subtitle) nodes.push(div('oko-strait-sub', facts.subtitle));
    if (facts?.connects) nodes.push(factRow('chokepoint.connects', facts.connects));
    if (facts?.shores) nodes.push(factRow('chokepoint.shores', facts.shores));
    const tail = [];
    if (facts?.narrowest) tail.push(`${translate('chokepoint.narrowest')} ${facts.narrowest}`);
    if (facts?.carries) tail.push(`${translate('chokepoint.carries')} ${facts.carries}`);
    if (tail.length) nodes.push(div('oko-strait-fact-tail', tail.join(' · ')));
    return nodes;
  }

  function liveBlock(model, loading) {
    if (loading) return [div('oko-strait-note', translate('strait-traffic.loading'))];
    const nodes = [];
    const count = div('oko-strait-count');
    count.appendChild(div('oko-strait-num', String(model.total)));
    count.appendChild(div('oko-strait-unit', translate('strait-traffic.vessels')));
    nodes.push(count);
    nodes.push(div('oko-strait-split', translate('strait-traffic.split', { live: model.live, delayed: model.delayed })));
    if (model.total > 0) {
      const ty = model.types;
      let typesText = `${translate('strait-traffic.types-label')}: `
        + `${translate('strait-traffic.tanker')} ${ty.tanker} · ${translate('strait-traffic.cargo')} ${ty.cargo}`
        + ` · ${translate('strait-traffic.passenger')} ${ty.passenger} · ${translate('strait-traffic.other')} ${ty.other}`;
      if (ty.unknown > 0) typesText += ` · ${translate('strait-traffic.unknown')} ${ty.unknown}`;
      nodes.push(div('oko-strait-types', typesText));
    }
    if (model.hasMovement && model.movingPct !== null) {
      nodes.push(div('oko-strait-move', translate('strait-traffic.moving', { pct: model.movingPct, kts: model.avgSpeedKts ?? '—' })));
    }
    if (model.dark > 0) nodes.push(div('oko-strait-dark', translate('strait-traffic.dark', { n: model.dark })));
    nodes.push(div('oko-strait-note', translate('strait-traffic.tracked')));
    return nodes;
  }

  function render(model, { loading = false } = {}) {
    el.replaceChildren(header(), ...factsBlock(), div('oko-strait-rule'), ...liveBlock(model, loading));
  }

  function refresh() {
    if (el.hidden || !rect) return;
    const live = safe(getLivePositions);
    const delayed = safe(getDelayedPositions);
    const sar = safe(getDarkPositions);
    if (!live.length && !delayed.length) { render(null, { loading: true }); return; }
    render(buildStraitTrafficModel({ live, delayed, sar }, rect));
  }

  function showFor({ rect: nextRect, label: nextLabel = '', facts: nextFacts = null } = {}) {
    if (!Array.isArray(nextRect) || nextRect.length !== 4) return;
    rect = nextRect;
    label = String(nextLabel || '');
    facts = nextFacts;
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
/* The chip BOX (position, size, z-index) lives in style.css — see
   "Scene chips" there. Only its inner styling stays here. */
.oko-strait-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;}
.oko-strait-title{font-size:11px;font-weight:600;letter-spacing:.1em;color:#39d0ff;text-transform:uppercase;line-height:1.2;}
.oko-strait-close{appearance:none;background:none;border:0;color:#8aa0b6;font-size:16px;line-height:1;cursor:pointer;padding:0 2px;}
.oko-strait-close:hover{color:#dbeafe;}
.oko-strait-sub{font-size:10px;color:#aebfd2;margin:3px 0 4px;line-height:1.3;}
.oko-strait-fact{display:flex;gap:6px;font-size:10px;line-height:1.35;}
.oko-strait-fact-k{flex:0 0 auto;color:#6f8398;}
.oko-strait-fact-v{color:#c8d6e6;}
.oko-strait-fact-tail{font-size:9px;color:#8aa0b6;line-height:1.35;margin-top:1px;}
.oko-strait-rule{height:1px;background:rgba(57,208,255,.18);margin:6px 0 5px;}
.oko-strait-count{display:flex;align-items:baseline;gap:6px;}
.oko-strait-num{font-size:26px;font-weight:700;line-height:1;color:#eaf2ff;font-variant-numeric:tabular-nums;}
.oko-strait-unit{font-size:10px;color:#8aa0b6;letter-spacing:.04em;}
.oko-strait-split{font-size:11px;color:#aebfd2;font-variant-numeric:tabular-nums;margin-top:2px;}
.oko-strait-types{font-size:10px;color:#c8d6e6;font-variant-numeric:tabular-nums;margin-top:3px;line-height:1.3;}
.oko-strait-move{font-size:10px;color:#aebfd2;font-variant-numeric:tabular-nums;margin-top:2px;}
.oko-strait-dark{font-size:10px;color:#ffb547;font-variant-numeric:tabular-nums;margin-top:2px;}
.oko-strait-note{font-size:9px;color:#6f8398;letter-spacing:.03em;margin-top:4px;text-transform:uppercase;}
`;
  (doc.head || doc.documentElement).appendChild(style);
}
