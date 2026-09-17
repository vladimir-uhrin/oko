// src/oilPriceChip.js
//
// Compact Brent / WTI oil-price chip shown with a chokepoint scene — the
// "here's the strait, here's what oil is doing" context from the upstream
// reveal (variant B). Self-contained chrome: it injects its own element + style
// and is driven by main.js, which calls refreshAndShow() whenever a chokepoint
// scene is applied (URL, picker or window API). The pure price model lives in
// src/data/oilPrices.js (tested); this file is thin DOM glue.
//
// Honesty (CLAUDE.md rule 2): these are SPOT prices, labelled as such with the
// print date and a stale marker when the last print is old — never dressed up as
// live futures.

import { buildOilModel, fetchOilPrices } from './data/oilPrices.js';
import { currentLanguage, t } from './i18n.js';

const DIR_GLYPH = Object.freeze({ up: '▲', down: '▼', flat: '·' });
/** Reuse a session fetch for this long before hitting the proxy again (matches proxy TTL). */
const REFETCH_TTL_MS = 3 * 60 * 60_000;

/**
 * @param {object} [deps]
 * @param {Document} [deps.documentRef]
 * @param {() => Promise<any>} [deps.fetch] Injectable price fetch (tests).
 * @param {(key: string, vars?: object) => string} [deps.translate]
 * @param {string} [deps.lang]
 * @param {() => number} [deps.now]
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

  const div = (cls, text) => { const d = doc.createElement('div'); d.className = cls; if (text != null) d.textContent = text; return d; };
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
    const head = div('oko-oil-head');
    head.appendChild(div('oko-oil-title', translate('oil.title')));
    head.appendChild(closeButton());
    return head;
  };

  function renderLoading() {
    el.replaceChildren(header(), div('oko-oil-note', translate('oil.loading')));
  }
  function renderModel(model) {
    if (!model?.ok) { el.replaceChildren(header(), div('oko-oil-note', translate('oil.unavailable'))); return; }
    const nodes = [header()];
    for (const grade of [model.brent, model.wti]) {
      if (!grade) continue;
      const line = div('oko-oil-line');
      line.appendChild(div('oko-oil-name', grade.label));
      line.appendChild(div('oko-oil-price', grade.text));
      const glyph = DIR_GLYPH[grade.dir] || '';
      line.appendChild(div(`oko-oil-chg oko-oil-${grade.dir}`, `${glyph} ${grade.pctText}`.trim()));
      nodes.push(line);
    }
    const footText = model.sourceLine + (model.freshness?.stale ? ` · ${translate('oil.stale')}` : '');
    nodes.push(div('oko-oil-foot', footText));
    el.replaceChildren(...nodes);
  }

  function show() { el.hidden = false; }
  function hide() { el.hidden = true; }

  async function refreshAndShow() {
    show();
    const fresh = cachedPayload && (now() - cachedAt < REFETCH_TTL_MS);
    if (fresh) { renderModel(buildOilModel(cachedPayload, { lang, translate, nowMs: now() })); return; }
    if (!cachedPayload) renderLoading();
    if (!inFlight) {
      inFlight = Promise.resolve(fetchImpl())
        .then((payload) => { cachedPayload = payload; cachedAt = now(); return payload; })
        .finally(() => { inFlight = null; });
    }
    try {
      const payload = await inFlight;
      renderModel(buildOilModel(payload, { lang, translate, nowMs: now() }));
    } catch {
      renderModel({ ok: false });
    }
  }

  return { refreshAndShow, hide, element: el };
}

function ensureStyle(doc) {
  if (!doc?.getElementById || doc.getElementById('oko-oil-chip-style')) return;
  const style = doc.createElement('style');
  style.id = 'oko-oil-chip-style';
  style.textContent = `
.oko-oil-chip{position:fixed;top:52px;right:10px;z-index:60;min-width:186px;max-width:260px;
  padding:8px 10px;border-radius:10px;background:rgba(11,22,34,.82);border:1px solid rgba(57,208,255,.28);
  box-shadow:0 6px 22px rgba(0,0,0,.45);backdrop-filter:blur(6px);
  font-family:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;color:#dbeafe;
  letter-spacing:.02em;pointer-events:auto;}
.oko-oil-chip[hidden]{display:none;}
.oko-oil-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:5px;}
.oko-oil-title{font-size:10px;font-weight:600;letter-spacing:.14em;color:#ffb547;text-transform:uppercase;}
.oko-oil-close{appearance:none;background:none;border:0;color:#8aa0b6;font-size:16px;line-height:1;cursor:pointer;padding:0 2px;}
.oko-oil-close:hover{color:#dbeafe;}
.oko-oil-line{display:flex;align-items:baseline;gap:8px;font-size:12px;margin:2px 0;}
.oko-oil-name{flex:0 0 42px;color:#8aa0b6;letter-spacing:.08em;}
.oko-oil-price{flex:1 1 auto;font-variant-numeric:tabular-nums;color:#eaf2ff;}
.oko-oil-chg{flex:0 0 auto;font-size:11px;font-variant-numeric:tabular-nums;}
.oko-oil-up{color:#4ade80;}
.oko-oil-down{color:#f87171;}
.oko-oil-flat{color:#8aa0b6;}
.oko-oil-note{font-size:11px;color:#8aa0b6;padding:2px 0;}
.oko-oil-foot{margin-top:6px;font-size:9px;line-height:1.3;color:#6f8398;letter-spacing:.03em;}
@media (max-width:520px){.oko-oil-chip{top:48px;right:8px;min-width:170px;}}
`;
  (doc.head || doc.documentElement).appendChild(style);
}
