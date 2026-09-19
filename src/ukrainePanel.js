// src/ukrainePanel.js — telo panela UKRAJINA v ľavej lište DÁTA (modul
// UKRAJINA, etapa 1, 2026-09-19; plán docs/drafts/ukrajina-plan.md).
//
// Rovnaký vzor ako bulletin ZÁLIV (conflictBulletin.js): modul NIČ nepolohuje —
// kreslí do tela panela, ktoré mu podá main.js; panel vlastní umiestnenie,
// zbalenie, výšku aj mobilný výsuv. Žiadne innerHTML, DOM cez vložený
// `document`, aby sa dal testovať v Node.
//
// Obsah etapy 1: stav snímku (dátum, ODbL), tlačidlo podkladu, čipy častí
// (sídla / cesty / rieky / oblasti), zoznam smerov frontu (presety kamery)
// a poctivá poznámka, že kontrola územia, udalosti a správy ešte nie sú —
// nič v tomto paneli nie je línia frontu.

import { currentLanguage, t } from './i18n.js';
import { UKRAINE_BASE_PARTS } from './data/ukraineBase.js';
import { frontSceneLabel, listFrontScenes } from './ukraineFrontScenes.js';

const INERT = { element: null, update() {}, setActiveScene() {}, destroy() {} };

/**
 * @param {object} o
 * @param {Element|null} o.mountTarget prázdny prvok tela panela (`#ukraine-panel [data-ukraine-body]`)
 * @param {object} o.layer prekryv podkladu (createUkraineBaseLayer)
 * @param {ReadonlyArray<object>} [o.scenes] presety smerov
 * @param {(id: string) => any} [o.applyScene] spustí preset (main.js)
 * @param {Function} [o.translate]
 * @param {string} [o.lang]
 * @param {Document} [o.documentRef]
 */
export function createUkrainePanel({
  mountTarget = null,
  layer = null,
  scenes = listFrontScenes(),
  applyScene = null,
  translate = t,
  lang = currentLanguage(),
  documentRef = globalThis.document,
} = {}) {
  const doc = documentRef;
  if (!doc?.createElement || !mountTarget || !layer) return INERT;

  const el = (tag, className = '', text = null) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const button = (className, text, onClick) => {
    const b = el('button', className, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };
  const numberFormat = new Intl.NumberFormat(lang === 'sk' ? 'sk-SK' : 'en-GB');

  // ── Kostra (raz) ──────────────────────────────────────────────────────────
  const status = el('div', 'ukraine-status gas-status');
  status.dataset.state = 'idle';
  const row = el('div', 'ukraine-row');
  const toggle = button('panel-layer-toggle ukraine-toggle', translate('ukraine.base.show'), () => { void layer.toggle(); });
  toggle.setAttribute('aria-pressed', 'false');
  row.appendChild(toggle);
  const chips = el('div', 'ukraine-chips');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', translate('ukraine.base.title'));
  const chipByPart = new Map();
  for (const part of UKRAINE_BASE_PARTS) {
    const chip = button('data-toggle-chip ukraine-chip', translate(`ukraine.part.${part}`), () => {
      const parts = layer.getParts();
      layer.setPart(part, !parts[part]);
    });
    chip.dataset.part = part;
    chip.setAttribute('aria-pressed', 'true');
    chips.appendChild(chip);
    chipByPart.set(part, chip);
  }
  row.appendChild(chips);
  const counts = el('div', 'ukraine-counts');
  counts.hidden = true;
  const dirsTitle = el('div', 'ukraine-section-title gas-card-title', translate('ukraine.directions'));
  const dirs = el('div', 'ukraine-dirs');
  dirs.setAttribute('role', 'group');
  dirs.setAttribute('aria-label', translate('ukraine.directions'));
  const dirByScene = new Map();
  for (const scene of scenes) {
    const b = button(`ukraine-dir${scene.overview ? ' is-overview' : ''}`, frontSceneLabel(scene, translate), () => {
      setActiveScene(scene.id);
      if (typeof applyScene === 'function') void applyScene(scene.id);
    });
    b.dataset.front = scene.id;
    b.setAttribute('aria-pressed', 'false');
    dirs.appendChild(b);
    dirByScene.set(scene.id, b);
  }
  const note = el('p', 'ukraine-note', translate('ukraine.next-stages'));
  const namesNote = el('p', 'ukraine-note ukraine-dim', translate('ukraine.names-note'));
  mountTarget.replaceChildren(status, row, counts, dirsTitle, dirs, note, namesNote);

  // ── Stav ──────────────────────────────────────────────────────────────────
  function statusFor(state) {
    if (state.error === 'no_snapshot') return { text: translate('ukraine.base.missing'), kind: 'error' };
    if (state.error) return { text: translate('ukraine.base.error', { detail: state.error }), kind: 'error' };
    if (state.loading) return { text: translate('ukraine.base.loading'), kind: 'loading' };
    if (state.snapshotDate) return { text: translate('ukraine.base.status', { date: state.snapshotDate }), kind: state.shown ? 'ready' : 'idle' };
    return { text: translate('ukraine.base.idle'), kind: 'idle' };
  }

  function countsFor(meta) {
    const ds = meta?.datasets;
    if (!ds) return null;
    const places = (ds.places?.features || 0) + (ds.villages?.features || 0);
    const roads = ds.roads?.lengthKm || 0;
    const oblasts = meta?.counts?.oblasts || 0;
    if (!places && !roads) return null;
    return translate('ukraine.base.counts', { places: numberFormat.format(places), roads: numberFormat.format(roads), oblasts: numberFormat.format(oblasts) });
  }

  function update(state = layer.getState()) {
    const s = statusFor(state);
    status.textContent = s.text;
    status.dataset.state = s.kind;
    toggle.textContent = translate(state.shown ? 'ukraine.base.hide' : 'ukraine.base.show');
    toggle.setAttribute('aria-pressed', String(Boolean(state.shown)));
    toggle.classList?.toggle?.('active', Boolean(state.shown));
    toggle.disabled = Boolean(state.loading);
    for (const [part, chip] of chipByPart) {
      const on = Boolean(state.parts?.[part]);
      chip.classList?.toggle?.('active', on);
      chip.setAttribute('aria-pressed', String(on));
    }
    const text = countsFor(state.meta);
    counts.textContent = text || '';
    counts.hidden = !text;
  }

  let activeScene = null;
  function setActiveScene(id) {
    activeScene = id || null;
    for (const [sceneId, b] of dirByScene) {
      const on = sceneId === activeScene;
      b.classList?.toggle?.('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  const unsubscribe = layer.onChange((state) => update(state));
  update();
  // Dátum snímku je lacný a hovorí, či snímok vôbec existuje — ťahá sa hneď.
  void layer.loadMeta?.();

  return {
    element: mountTarget,
    update,
    setActiveScene,
    get activeScene() { return activeScene; },
    destroy() { unsubscribe?.(); mountTarget.replaceChildren(); },
  };
}
