// src/data/volcanoCard.js
/**
 * @module volcanoCard
 * @description DOM karta sopky (2026-09-05, „prerob aj informácie"): fotka z
 * Wikipédie (len slobodné licencie, s kreditom), názov, typ · výška · krajina,
 * stav, hlásená aktivita z EONET, popis, odkazy na zdroje. Rovnaké CSS triedy
 * ako karta letiska (`.airport-card`), takže štýl je jeden.
 *
 * Otvára ju vrstva vulkánov udalosťou `gev:volcano-selected` (detail = záznam),
 * zatvára `gev:volcano-selection-cleared`, krížik alebo Escape. Kotví sa na
 * premietnutý bod v postRender ako karta letiska.
 *
 * Sidecar OSM (~600 kB) sa ťahá lenivo pri prvom otvorení, nie pri štarte.
 */
import * as Cesium from 'cesium';
import { t } from '../i18n.js';
import { fetchAirportPhoto, photoCreditText } from './airportPhoto.js';
import { buildVolcanoIndex, matchOsmVolcano, volcanoCardModel } from './volcanoInfo.js';

export const VOLCANO_SELECTED_EVENT = 'gev:volcano-selected';
export const VOLCANO_CLEARED_EVENT = 'gev:volcano-selection-cleared';
const CARD_OFFSET_PX = 18;
const sidecarUrlDefault = new URL('./local_data/volcanoes/osm-volcanoes.json', import.meta.url).href;

const state = {
  viewer: null, root: null, container: null, event: null, match: null,
  index: null, indexPromise: null, sidecarUrl: sidecarUrlDefault, fetchImpl: null,
  photo: null, photoEl: null, removePostRender: null, eventTarget: null,
  onSelected: null, onCleared: null, onKey: null, occluder: null, scratch: null,
};

function loadIndex() {
  if (state.index) return Promise.resolve(state.index);
  if (!state.indexPromise) {
    const fetchImpl = state.fetchImpl || ((url) => fetch(url));
    state.indexPromise = Promise.resolve(fetchImpl(state.sidecarUrl))
      .then((res) => (res?.ok ? res.json() : null))
      .then((json) => { state.index = buildVolcanoIndex(json?.volcanoes || []); return state.index; })
      .catch(() => { state.indexPromise = null; return null; });
  }
  return state.indexPromise;
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function render() {
  if (!state.root || !state.event) return;
  const doc = state.root.ownerDocument;
  const model = volcanoCardModel(state.event, state.match, Date.now(), t);
  if (!model) { hide(); return; }
  state.root.textContent = '';

  const close = el(doc, 'button', 'airport-card-close', '×');
  close.type = 'button'; close.title = t('airport.close'); close.setAttribute('aria-label', t('airport.close'));
  close.addEventListener('click', () => { hide(); state.onClosed?.(); });
  state.root.appendChild(close);

  if (state.photo) {
    if (!state.photoEl || state.photoEl.dataset?.src !== state.photo.thumb) {
      const img = el(doc, 'img', 'airport-card-photo');
      img.src = state.photo.thumb; img.alt = ''; img.decoding = 'async'; img.loading = 'lazy';
      if (img.dataset) img.dataset.src = state.photo.thumb;
      state.photoEl = img;
    }
    const figure = el(doc, 'figure', 'airport-card-figure');
    figure.appendChild(state.photoEl);
    const credit = el(doc, 'a', 'airport-card-photo-credit', photoCreditText(state.photo, t));
    credit.href = state.photo.filePage || state.photo.articleUrl; credit.target = '_blank'; credit.rel = 'noopener';
    figure.appendChild(credit);
    state.root.appendChild(figure);
  }

  const header = el(doc, 'div', 'airport-card-header');
  const headText = el(doc, 'div', 'airport-card-headtext');
  headText.appendChild(el(doc, 'div', 'airport-card-title', model.title));
  if (model.localName) headText.appendChild(el(doc, 'div', 'airport-card-sub', model.localName));
  if (model.factsLine) headText.appendChild(el(doc, 'div', 'airport-card-sub', model.factsLine));
  header.appendChild(headText);
  state.root.appendChild(header);

  const activity = el(doc, 'section', 'airport-card-section');
  activity.appendChild(el(doc, 'h4', 'airport-card-section-title', t('volcano.section.activity')));
  if (model.statusLabel) activity.appendChild(el(doc, 'div', 'airport-card-line volcano-card-status', model.statusLabel));
  activity.appendChild(el(doc, 'div', 'airport-card-line', model.activity));
  activity.appendChild(el(doc, 'div', 'airport-card-muted', model.coords));
  if (model.matchNote) activity.appendChild(el(doc, 'div', 'airport-card-muted', model.matchNote));
  state.root.appendChild(activity);

  if (model.description) {
    const about = el(doc, 'section', 'airport-card-section');
    about.appendChild(el(doc, 'h4', 'airport-card-section-title', t('volcano.section.about')));
    about.appendChild(el(doc, 'div', 'airport-card-line volcano-card-description', model.description));
    state.root.appendChild(about);
  }

  if (model.links.length) {
    const links = el(doc, 'div', 'airport-card-links');
    for (const l of model.links) {
      const a = el(doc, 'a', 'airport-card-link', `${l.label} ↗`);
      a.href = l.href; a.target = '_blank'; a.rel = 'noopener';
      links.appendChild(a);
    }
    state.root.appendChild(links);
  }
  const note = el(doc, 'div', 'airport-card-muted volcano-card-coverage', model.coverage);
  state.root.appendChild(note);
  state.root.hidden = false;
  place();
}

function place() {
  if (!state.root || state.root.hidden || !state.viewer || !state.event) return;
  const scene = state.viewer.scene;
  const position = Cesium.Cartesian3.fromDegrees(state.event.lon, state.event.lat);
  try {
    state.occluder = state.occluder || new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, scene.camera.positionWC);
    state.occluder.cameraPosition = scene.camera.positionWC;
    if (scene.mode === Cesium.SceneMode.SCENE3D && !state.occluder.isPointVisible(position)) { state.root.style.visibility = 'hidden'; return; }
  } catch { /* occluder je len komfort */ }
  state.scratch = state.scratch || new Cesium.Cartesian2();
  let win = null;
  try { win = Cesium.SceneTransforms.worldToWindowCoordinates(scene, position, state.scratch); } catch { win = null; }
  if (!win || !Number.isFinite(win.x) || !Number.isFinite(win.y)) { state.root.style.visibility = 'hidden'; return; }
  state.root.style.visibility = 'visible';
  const view = state.root.ownerDocument.defaultView;
  const w = state.root.offsetWidth || 320, h = state.root.offsetHeight || 200;
  const vw = view?.innerWidth || 0, vh = view?.innerHeight || 0;
  let x = win.x + CARD_OFFSET_PX;
  if (x + w > vw - 8) x = win.x - CARD_OFFSET_PX - w;
  let y = win.y - h / 2;
  x = Math.max(8, Math.min(x, Math.max(8, vw - w - 8)));
  y = Math.max(8, Math.min(y, Math.max(8, vh - h - 8)));
  state.root.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function hide() {
  state.event = null; state.match = null; state.photo = null; state.photoEl = null;
  if (state.root && !state.root.hidden) state.root.hidden = true;
}

function show(event) {
  if (!event || !Number.isFinite(event.lat) || !Number.isFinite(event.lon)) { hide(); return; }
  state.event = event; state.match = null; state.photo = null; state.photoEl = null;
  render();
  loadIndex().then((index) => {
    if (state.event !== event || !index) return;
    state.match = matchOsmVolcano(index, event.lat, event.lon, event.title);
    render();
    const wiki = state.match?.volcano?.wikipedia;
    const model = volcanoCardModel(event, state.match, Date.now(), t);
    if (wiki && model?.wikipediaUrl) {
      fetchAirportPhoto(model.wikipediaUrl, state.fetchImpl ? { fetchImpl: state.fetchImpl, storage: null } : {}).then((photo) => {
        if (state.event !== event) return;
        state.photo = photo;
        if (photo) render();
      });
    }
  });
}

/**
 * Nainštaluje kartu sopky. Idempotentné.
 * @param {object} viewer Cesium viewer
 * @param {object} options
 * @param {HTMLElement} options.container rodič (document.body)
 * @param {Function} [options.fetchImpl] test seam
 * @param {string} [options.sidecarUrl] test seam
 * @param {EventTarget} [options.eventTarget] test seam (default window)
 * @param {() => void} [options.onClosed] volané po krížiku/Escape (vrstva zruší výber)
 */
export function installVolcanoCard(viewer, { container, fetchImpl, sidecarUrl, eventTarget, onClosed } = {}) {
  if (state.root || !container) return;
  const doc = container.ownerDocument;
  state.viewer = viewer; state.container = container;
  state.fetchImpl = fetchImpl || null;
  if (sidecarUrl) state.sidecarUrl = sidecarUrl;
  state.onClosed = typeof onClosed === 'function' ? onClosed : null;
  const root = el(doc, 'aside', 'airport-card volcano-card');
  root.hidden = true; root.setAttribute('role', 'dialog');
  container.appendChild(root);
  state.root = root;
  const target = eventTarget || (typeof window !== 'undefined' ? window : null);
  if (target?.addEventListener) {
    state.onSelected = (e) => show(e?.detail);
    state.onCleared = () => hide();
    state.onKey = (e) => { if (e?.key === 'Escape' && state.event) { hide(); state.onClosed?.(); } };
    target.addEventListener(VOLCANO_SELECTED_EVENT, state.onSelected);
    target.addEventListener(VOLCANO_CLEARED_EVENT, state.onCleared);
    target.addEventListener('keydown', state.onKey);
    state.eventTarget = target;
  }
  const postRender = viewer?.scene?.postRender;
  if (postRender?.addEventListener) {
    postRender.addEventListener(place);
    state.removePostRender = () => postRender.removeEventListener(place);
  }
}

export function destroyVolcanoCard() {
  hide();
  state.removePostRender?.(); state.removePostRender = null;
  if (state.eventTarget) {
    state.eventTarget.removeEventListener(VOLCANO_SELECTED_EVENT, state.onSelected);
    state.eventTarget.removeEventListener(VOLCANO_CLEARED_EVENT, state.onCleared);
    state.eventTarget.removeEventListener('keydown', state.onKey);
  }
  state.eventTarget = null; state.onSelected = null; state.onCleared = null; state.onKey = null;
  state.root?.remove(); state.root = null; state.viewer = null; state.container = null;
}

/** Test seams. */
export function _getVolcanoCardStateForTest() {
  return { hidden: state.root ? state.root.hidden : null, hasMatch: Boolean(state.match), text: state.root?.textContent || '', hasPhoto: Boolean(state.photo) };
}
export function _resetVolcanoCardForTest() {
  destroyVolcanoCard();
  state.index = null; state.indexPromise = null; state.sidecarUrl = sidecarUrlDefault; state.fetchImpl = null; state.onClosed = null;
}
