// src/data/pipelineHoverCard.js
/**
 * @module pipelineHoverCard
 * @description Hover karta potrubia (etapa 3, 2026-09-19; používateľ: „pri
 * prechode myšou cez rúru chcem vyskakovacie okno s názvom rúry … a keď sa
 * dá, reálne dáta koľko tečie a kam"). Vzor `earthquakeHoverCard.js`: jedna
 * DOM sekcia na body, bez innerHTML, umiestnená pri kurzore, zrolovateľná,
 * ostáva pri prechode myšou dnu (odkazy sa dajú kliknúť), zavrie ju Escape,
 * ×, odchod kurzora alebo klik do scény.
 *
 * Model je čistá funkcia (`pipelineHoverModel`), aby sa testoval bez DOM.
 * Živý tok príde asynchrónne: `show()` nakreslí „načítavam", vrstva potom
 * zavolá `setFlows()` s odpoveďou proxy `/api/gas/flows` — ak medzitým kurzor
 * odišiel na inú rúru, výsledok sa zahodí (generácia).
 */
import { pipelineDetailsRows, pipelineKind, pipelineTitle } from './gasPipelines.js';
import { pipelineFlowPointIds, pipelineFlowRows } from './pipelineFlowLinks.js';

/**
 * @param {object} feature prvok zo snímku (id, properties)
 * @param {{translate?: (k: string, v?: object) => string, lang?: string}} [o]
 * @returns {{kind: 'gas'|'oil', kindText: string, title: string, rows: Array<[string, string]>, osmUrl: string|null, flowIds: string[]}|null}
 */
export function pipelineHoverModel(feature, { translate = (k) => k, lang = 'sk' } = {}) {
  if (!feature?.properties) return null;
  const p = feature.properties;
  const kind = pipelineKind(p);
  const osm = Number(p.osm);
  return {
    kind,
    kindText: translate('gas.pipeline-kind-' + kind),
    title: pipelineTitle(p, translate),
    rows: pipelineDetailsRows(p, translate, lang),
    osmUrl: Number.isFinite(osm) && osm > 0 ? `https://www.openstreetmap.org/way/${osm}` : null,
    flowIds: pipelineFlowPointIds(p),
  };
}

/**
 * @param {{document?: Document, translate?: Function, lang?: () => string}} [o]
 */
export function createPipelineHoverCard({ document: doc = globalThis.document, translate = (k) => k, lang = () => 'sk' } = {}) {
  if (!doc?.body) return { show() {}, setFlows() {}, hide() {}, destroy() {}, isHovered: () => false, current: () => null };
  const root = doc.createElement('section');
  root.className = 'pipeline-hover-card';
  root.hidden = true;
  doc.body.appendChild(root);
  let current = null;
  let generation = 0;
  let hovered = false;
  let flowRoot = null;
  const el = (tag, text, parent = root) => { const node = doc.createElement(tag); if (text) node.textContent = text; parent.appendChild(node); return node; };
  const link = (text, url, parent) => {
    if (!/^https:\/\//.test(url || '')) return el('span', text, parent);
    const node = el('a', text, parent); node.href = url; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node;
  };
  function hide() { generation += 1; current = null; hovered = false; flowRoot = null; root.hidden = true; }
  function place(at) {
    const w = doc.documentElement?.clientWidth || 0;
    const h = doc.documentElement?.clientHeight || 0;
    const width = root.offsetWidth || 0;
    const height = root.offsetHeight || 0;
    root.style.left = Math.max(8, Math.min(at.x + 18, w - width - 8)) + 'px';
    root.style.top = Math.max(8, Math.min(at.y + 16, h - height - 8)) + 'px';
  }
  function renderFlows(result) {
    if (!flowRoot) return;
    flowRoot.replaceChildren();
    el('h4', translate('gas.pipeline-flow-title'), flowRoot);
    if (result === undefined) { el('p', translate('gas.pipeline-flow-loading'), flowRoot).className = 'pipeline-hover-note'; return; }
    if (result === null) { el('p', translate('gas.pipeline-flow-unavailable'), flowRoot).className = 'pipeline-hover-note'; return; }
    for (const row of result.rows) {
      const point = el('div', '', flowRoot); point.className = 'pipeline-hover-flow-point';
      el('div', `${row.name} · ${row.route}`, point);
      const value = el('div', '', point);
      el('strong', row.text, value);
      const tail = [row.mcmText, row.dateText, row.statusText].filter(Boolean).join(' · ');
      if (tail) el('span', ' ' + tail, value);
      if (row.note) el('p', row.note, point).className = 'pipeline-hover-note';
    }
    el('p', translate('gas.pipeline-flow-note'), flowRoot).className = 'pipeline-hover-note';
    if (result.citation) el('p', result.citation, flowRoot).className = 'pipeline-hover-note';
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
     * @param {object} feature
     * @param {{x: number, y: number}} at
     * @returns {string[]} id bodov ENTSOG, ktoré karta čaká cez setFlows (prázdne = nič nečaká)
     */
    show(feature, at) {
      const model = pipelineHoverModel(feature, { translate, lang: lang() });
      if (!model) { hide(); return []; }
      if (current === feature) { place(at); return []; }
      hide();
      current = feature;
      generation += 1;
      root.replaceChildren();
      root.hidden = false;
      root.dataset.kind = model.kind;
      const close = el('button', '×'); close.className = 'pipeline-hover-close'; close.setAttribute('aria-label', translate('gas.pipeline-close')); close.addEventListener('click', hide);
      el('span', model.kindText).className = 'pipeline-hover-kind';
      el('h3', model.title);
      const list = el('dl');
      for (const [label, value] of model.rows) { el('dt', label, list); el('dd', value, list); }
      if (model.osmUrl) { el('dt', translate('gas.pipeline-osm-source'), list); const dd = el('dd', '', list); link(`OSM way ${feature.properties.osm}`, model.osmUrl, dd); el('span', ' · © OpenStreetMap contributors · ODbL', dd); }
      flowRoot = el('div'); flowRoot.className = 'pipeline-hover-flow';
      if (model.kind === 'oil') {
        el('h4', translate('gas.pipeline-flow-title'), flowRoot);
        el('p', translate('gas.pipeline-flow-oil-none'), flowRoot).className = 'pipeline-hover-note';
      } else if (!model.flowIds.length) {
        el('h4', translate('gas.pipeline-flow-title'), flowRoot);
        el('p', translate('gas.pipeline-flow-none'), flowRoot).className = 'pipeline-hover-note';
      } else {
        renderFlows(undefined);
      }
      el('p', translate('gas.pipeline-hover-hint')).className = 'pipeline-hover-note';
      place(at);
      return model.kind === 'gas' ? model.flowIds : [];
    },
    /**
     * Doplň živý tok. `payload` je odpoveď proxy alebo null (chyba).
     * Ignoruje sa, keď kurzor medzitým prešiel inam.
     */
    setFlows(feature, payload) {
      if (current !== feature || !flowRoot) return false;
      const ids = pipelineFlowPointIds(feature.properties);
      if (!ids.length) return false;
      renderFlows(payload ? pipelineFlowRows(payload, ids, { lang: lang(), translate }) : null);
      return true;
    },
    destroy() { hide(); root.remove(); doc.removeEventListener?.('keydown', keydown); },
  };
}
