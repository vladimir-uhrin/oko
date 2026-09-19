// src/data/pipelineHoverCard.js
/**
 * @module pipelineHoverCard
 * @description Hover karta potrubia (etapa 3, 2026-09-19; používateľ: „pri
 * prechode myšou cez rúru chcem vyskakovacie okno s názvom rúry … a keď sa
 * dá, reálne dáta koľko tečie a kam"; etapa 3b: „informácie v kartičkách
 * vyžmíkaj viac aj s vlajkami, štýl OKO"). Vizuál podľa karty kontaktu
 * (`contactHoverCard.js`): mono písmo, sklo, tenký ľavý lem vo farbe látky,
 * vlajky 12×9 z bundlovaných SVG. Jedna DOM sekcia na body, bez innerHTML,
 * pri kurzore, zrolovateľná, ostáva pri prechode myšou dnu (odkazy sa dajú
 * kliknúť), zavrie ju Escape, ×, odchod kurzora alebo klik do scény.
 *
 * Model je čistá funkcia (`pipelineHoverModel`), aby sa testoval bez DOM.
 * Živý tok príde asynchrónne: `show()` nakreslí „načítavam", vrstva potom
 * zavolá `setFlows()` s odpoveďou proxy `/api/gas/flows` — ak medzitým kurzor
 * odišiel na inú rúru, výsledok sa zahodí (generácia).
 */
import { pipelineDetailsRows, pipelineDisplayName, pipelineKind, pipelineOperator, pipelineTitle } from './gasPipelines.js';
import { pipelineFlowPointIds, pipelineFlowRows } from './pipelineFlowLinks.js';
import { flagUrl as flagUrlDefault } from './countryFlags.js';
import { regionDisplayName } from './trackedCardModel.js';
import { drawSparkline } from '../gasChart.js';

const SPARK_W = 120;
const SPARK_H = 22;

/**
 * @param {object} feature prvok zo snímku (id, properties)
 * @param {{translate?: (k: string, v?: object) => string, lang?: string}} [o]
 * @returns {{kind: 'gas'|'oil', kindText: string, title: string, original: string|null, operator: {text: string, original: string|null}, countries: string[], rows: Array<[string, string]>, osmUrl: string|null, flowIds: string[]}|null}
 */
export function pipelineHoverModel(feature, { translate = (k) => k, lang = 'sk' } = {}) {
  if (!feature?.properties) return null;
  const p = feature.properties;
  const kind = pipelineKind(p);
  const osm = Number(p.osm);
  const name = pipelineDisplayName(p);
  return {
    kind,
    kindText: translate('gas.pipeline-kind-' + kind),
    title: pipelineTitle(p, translate),
    original: name.original,
    operator: pipelineOperator(p),
    countries: Array.isArray(p.countries) ? p.countries.filter((iso) => /^[A-Z]{2}$/.test(String(iso))) : [],
    // Prevádzkovateľ je v karte zvlášť (s originálom), preto tu bez neho.
    rows: pipelineDetailsRows(p, translate, lang).filter(([label]) => label !== translate('gas.pipeline-operator')),
    osmUrl: Number.isFinite(osm) && osm > 0 ? `https://www.openstreetmap.org/way/${osm}` : null,
    flowIds: pipelineFlowPointIds(p),
  };
}

/**
 * @param {{document?: Document, translate?: Function, lang?: () => string, regionName?: (iso: string, lang: string) => string, flagUrl?: (iso: string) => string|null, drawSpark?: Function, snapshotDate?: () => string|null}} [o]
 */
export function createPipelineHoverCard({
  document: doc = globalThis.document,
  translate = (k) => k,
  lang = () => 'sk',
  regionName = regionDisplayName,
  flagUrl = flagUrlDefault,
  drawSpark = drawSparkline,
  snapshotDate = () => null,
} = {}) {
  if (!doc?.body) return { show() {}, setFlows() {}, hide() {}, destroy() {}, isHovered: () => false, current: () => null };
  const root = doc.createElement('section');
  root.className = 'pipeline-hover-card';
  root.hidden = true;
  doc.body.appendChild(root);
  let current = null;
  let generation = 0;
  let hovered = false;
  let flowRoot = null;
  const el = (tag, text, parent = root, className = '') => {
    const node = doc.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    parent.appendChild(node);
    return node;
  };
  const link = (text, url, parent) => {
    if (!/^https:\/\//.test(url || '')) return el('span', text, parent);
    const node = el('a', text, parent); node.href = url; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node;
  };
  const flag = (iso, parent) => {
    const src = flagUrl(iso);
    if (!src) return null;
    const img = el('img', '', parent, 'pipeline-hover-flag');
    img.src = src; img.alt = iso; img.width = 12; img.height = 9;
    return img;
  };
  /** Vlajka + meno štátu v jazyku UI (`TR` → „Turecko"), bez mena ostane kód. */
  const country = (iso, parent) => {
    const span = el('span', '', parent, 'pipeline-hover-country');
    flag(iso, span);
    el('span', regionName(iso, lang()) || iso, span);
    return span;
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
    if (result === undefined) { el('p', translate('gas.pipeline-flow-loading'), flowRoot, 'pipeline-hover-note'); return; }
    if (result === null) { el('p', translate('gas.pipeline-flow-unavailable'), flowRoot, 'pipeline-hover-note'); return; }
    for (const row of result.rows) {
      const point = el('div', '', flowRoot, 'pipeline-hover-flow-point');
      const head = el('div', '', point, 'pipeline-hover-flow-head');
      if (row.fromIso) flag(row.fromIso, head);
      el('span', row.fromIso ? `${row.fromIso} → ` : `${row.route.split(' → ')[0]} → `, head);
      if (row.toIso) flag(row.toIso, head);
      el('span', row.toIso ? `${row.toIso} · ${row.name}` : `${row.route.split(' → ')[1]} · ${row.name}`, head);
      const value = el('div', '', point, 'pipeline-hover-flow-value');
      el('strong', row.text, value);
      const tail = [row.mcmText, row.dateText, row.statusText].filter(Boolean).join(' · ');
      if (tail) el('span', ' ' + tail, value);
      if (row.avg7Text) el('div', row.avg7Text, point, 'pipeline-hover-flow-avg');
      const validSpark = (row.spark || []).filter((v) => Number.isFinite(v));
      if (validSpark.length >= 2 && typeof doc.createElement === 'function') {
        const canvas = el('canvas', '', point, 'pipeline-hover-spark');
        canvas.width = SPARK_W; canvas.height = SPARK_H;
        canvas.title = translate('gas.pipeline-flow-spark');
        const ctx = canvas.getContext?.('2d');
        if (ctx) { try { drawSpark(ctx, row.spark, { width: SPARK_W, height: SPARK_H }); } catch { /* bez sparkline */ } }
      }
      if (row.note) el('p', row.note, point, 'pipeline-hover-note');
    }
    el('p', translate('gas.pipeline-flow-note'), flowRoot, 'pipeline-hover-note');
    if (result.citation) el('p', result.citation, flowRoot, 'pipeline-hover-note');
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
      const close = el('button', '×', root, 'pipeline-hover-close');
      close.setAttribute('aria-label', translate('gas.pipeline-close'));
      close.addEventListener('click', hide);
      el('span', model.kindText, root, 'pipeline-hover-kind');
      el('h3', model.title, root, 'pipeline-hover-title');
      if (model.original) el('p', `${translate('gas.pipeline-original-name')}: ${model.original}`, root, 'pipeline-hover-original');
      if (model.operator.text) {
        const op = el('p', model.operator.text, root, 'pipeline-hover-operator');
        if (model.operator.original) el('span', ` · ${model.operator.original}`, op, 'pipeline-hover-dim');
      }
      if (model.countries.length) {
        const countries = el('div', '', root, 'pipeline-hover-countries');
        model.countries.forEach((iso, i) => { if (i) el('span', ' · ', countries, 'pipeline-hover-dim'); country(iso, countries); });
      }
      const list = el('dl', '', root, 'pipeline-hover-rows');
      for (const [label, value] of model.rows) { el('dt', label, list); el('dd', value, list); }
      flowRoot = el('div', '', root, 'pipeline-hover-flow');
      if (model.kind === 'oil') {
        el('h4', translate('gas.pipeline-flow-title'), flowRoot);
        el('p', translate('gas.pipeline-flow-oil-none'), flowRoot, 'pipeline-hover-note');
      } else if (!model.flowIds.length) {
        el('h4', translate('gas.pipeline-flow-title'), flowRoot);
        el('p', translate('gas.pipeline-flow-none'), flowRoot, 'pipeline-hover-note');
      } else {
        renderFlows(undefined);
      }
      const foot = el('p', '', root, 'pipeline-hover-foot');
      if (model.osmUrl) { link(`OSM way ${feature.properties.osm}`, model.osmUrl, foot); el('span', ' · ', foot); }
      el('span', '© OpenStreetMap contributors · ODbL', foot);
      const snap = snapshotDate();
      if (snap) el('span', ` · ${translate('gas.pipeline-snapshot', { date: String(snap).slice(0, 10) })}`, foot);
      el('span', ` · ${translate('gas.pipeline-hover-hint')}`, foot, 'pipeline-hover-dim');
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
