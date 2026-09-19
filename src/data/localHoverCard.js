// src/data/localHoverCard.js
/**
 * @module localHoverCard
 * @description Vyskakovacia karta pre značky lokálnych vrstiev — prístavy,
 * letiská, dátové centrá, priehrady (2026-09-19; používateľ ukázal na bodku
 * prístavu Mariupol na ropovode: „tam kde som označil daj X alebo aj tie
 * uzly sprav vyskakovacie"). Z diaľky sú to len bodky bez mena (stupne
 * popisu ich zúžia na kód alebo nič), takže prechod myšou má povedať, čo to
 * je, bez kliku a bez priblíženia. Rovnaká reč ako karta rúr
 * (`pipelineHoverCard.js`): mono, sklo, ľavý lem vo farbe vrstvy, vlajka.
 *
 * Model je čistý (`localHoverModel`), DOM bez innerHTML nad vloženým
 * `document`, aby sa testoval v Node.
 */
import { flagUrl as flagUrlDefault } from './countryFlags.js';

/**
 * @param {{layerId: string, kindText: string, title: string, titleFlag?: string|null, details?: string[], source?: string}} input
 * @returns {{layerId: string, kind: string, kindText: string, title: string, flag: string|null, details: string[], source: string}|null}
 */
export function localHoverModel(input) {
  if (!input || !input.title) return null;
  return {
    layerId: String(input.layerId || ''),
    kind: String(input.layerId || '').replace(/^local-/, ''),
    kindText: String(input.kindText || ''),
    title: String(input.title),
    flag: input.titleFlag && /^[a-z]{2}$/i.test(String(input.titleFlag)) ? String(input.titleFlag).toLowerCase() : null,
    details: Array.isArray(input.details) ? input.details.filter(Boolean).map(String) : [],
    source: String(input.source || ''),
  };
}

/**
 * @param {{document?: Document, translate?: Function, flagUrl?: (iso: string) => string|null}} [o]
 */
export function createLocalHoverCard({ document: doc = globalThis.document, translate = (k) => k, flagUrl = flagUrlDefault } = {}) {
  if (!doc?.body) return { show() { return false; }, hide() {}, destroy() {}, isHovered: () => false, current: () => null };
  const root = doc.createElement('section');
  // Zdieľaný vizuál s kartou rúr; data-kind volí farbu lemu (style.css).
  root.className = 'pipeline-hover-card local-hover-card';
  root.hidden = true;
  doc.body.appendChild(root);
  let current = null;
  let hovered = false;
  const el = (tag, text, parent = root, className = '') => {
    const node = doc.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    parent.appendChild(node);
    return node;
  };
  function hide() { current = null; hovered = false; root.hidden = true; }
  function place(at) {
    const w = doc.documentElement?.clientWidth || 0;
    const h = doc.documentElement?.clientHeight || 0;
    root.style.left = Math.max(8, Math.min(at.x + 18, w - (root.offsetWidth || 0) - 8)) + 'px';
    root.style.top = Math.max(8, Math.min(at.y + 16, h - (root.offsetHeight || 0) - 8)) + 'px';
  }
  root.addEventListener('pointerenter', () => { hovered = true; });
  root.addEventListener('pointerleave', () => { hovered = false; hide(); });
  function keydown(e) { if (e.key === 'Escape') hide(); }
  doc.addEventListener?.('keydown', keydown);
  return {
    isHovered: () => hovered || (doc.activeElement ? root.contains(doc.activeElement) : false),
    current: () => current,
    hide,
    /**
     * @param {object} input viď localHoverModel
     * @param {{x: number, y: number}} at
     * @param {string} [key] identita záznamu — tá istá = len presun
     * @returns {boolean} true, keď sa karta ukázala
     */
    show(input, at, key = null) {
      const model = localHoverModel(input);
      if (!model) { hide(); return false; }
      const identity = key ?? model.title;
      if (current === identity) { place(at); return true; }
      hide();
      current = identity;
      root.replaceChildren();
      root.hidden = false;
      root.dataset.kind = model.kind;
      const close = el('button', '×', root, 'pipeline-hover-close');
      close.setAttribute('aria-label', translate('gas.pipeline-close'));
      close.addEventListener('click', hide);
      el('span', model.kindText, root, 'pipeline-hover-kind');
      const title = el('h3', '', root, 'pipeline-hover-title');
      const src = model.flag ? flagUrl(model.flag) : null;
      if (src) { const img = el('img', '', title, 'pipeline-hover-flag'); img.src = src; img.alt = model.flag.toUpperCase(); img.width = 12; img.height = 9; }
      el('span', model.title, title);
      for (const line of model.details) el('p', line, root, 'pipeline-hover-operator');
      const foot = el('p', '', root, 'pipeline-hover-foot');
      if (model.source) el('span', model.source + ' · ', foot);
      el('span', translate('local.hover-hint'), foot, 'pipeline-hover-dim');
      place(at);
      return true;
    },
    destroy() { hide(); root.remove(); doc.removeEventListener?.('keydown', keydown); },
  };
}
