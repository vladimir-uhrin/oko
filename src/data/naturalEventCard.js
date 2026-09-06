// src/data/naturalEventCard.js
/**
 * @module naturalEventCard
 * @description DOM karta prírodnej udalosti (2026-09-06, „popis žiadny
 * udalostí"): pri kliknutí na špendlík búrky/povodne/… ukáže názov, kategóriu,
 * intenzitu (pri cyklóne so Saffir-Simpsonovým odznakom), zložený popis,
 * hlásenú aktivitu, polohu, trajektóriu a odkazy na zdroje (JTWC, NOAA NHC…).
 *
 * Rovnaké CSS triedy ako karta letiska a sopky (`.airport-card`). Otvára ju
 * vrstva udalostí udalosťou `gev:natural-event-selected`, zatvára
 * `gev:natural-event-selection-cleared`, krížik alebo Escape.
 */
import * as Cesium from 'cesium';
import { t } from '../i18n.js';
import {
  NATURAL_EVENT_CLEARED_EVENT, NATURAL_EVENT_SELECTED_EVENT, naturalEventCardModel,
} from './naturalEventInfo.js';

const CARD_OFFSET_PX = 18;

const state = {
  viewer: null, root: null, container: null, event: null, removePostRender: null,
  eventTarget: null, onSelected: null, onCleared: null, onKey: null, onClosed: null,
  occluder: null, scratch: null,
};

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function render() {
  if (!state.root || !state.event) return;
  const doc = state.root.ownerDocument;
  const model = naturalEventCardModel(state.event, Date.now(), t);
  if (!model) { hide(); return; }
  state.root.textContent = '';

  const close = el(doc, 'button', 'airport-card-close', '×');
  close.type = 'button'; close.title = t('airport.close'); close.setAttribute('aria-label', t('airport.close'));
  close.addEventListener('click', () => { hide(); state.onClosed?.(); });
  state.root.appendChild(close);

  // Farebný pásik kategórie navrchu — okamžitá identita udalosti.
  const stripe = el(doc, 'div', 'nev-card-stripe');
  stripe.style.background = model.color;
  state.root.appendChild(stripe);

  const header = el(doc, 'div', 'airport-card-header');
  const headText = el(doc, 'div', 'airport-card-headtext');
  const titleRow = el(doc, 'div', 'nev-card-titlerow');
  titleRow.appendChild(el(doc, 'div', 'airport-card-title', model.title));
  if (model.badge) {
    const badge = el(doc, 'span', 'nev-card-badge', model.badge.text);
    badge.style.color = model.badge.color;
    badge.style.borderColor = model.badge.color;
    titleRow.appendChild(badge);
  }
  headText.appendChild(titleRow);
  const sub = el(doc, 'div', 'airport-card-sub');
  sub.textContent = model.intensityLine ? `${model.subLine} · ${model.intensityLine}` : model.subLine;
  headText.appendChild(sub);
  header.appendChild(headText);
  state.root.appendChild(header);

  const details = el(doc, 'section', 'airport-card-section');
  details.appendChild(el(doc, 'h4', 'airport-card-section-title', t('natural.section.details')));
  details.appendChild(el(doc, 'div', 'airport-card-line', model.activity));
  details.appendChild(el(doc, 'div', 'airport-card-muted', model.coords));
  if (model.trackLine) details.appendChild(el(doc, 'div', 'airport-card-muted', model.trackLine));
  state.root.appendChild(details);

  if (model.description) {
    const about = el(doc, 'section', 'airport-card-section');
    about.appendChild(el(doc, 'h4', 'airport-card-section-title', t('natural.section.about')));
    about.appendChild(el(doc, 'div', 'airport-card-line nev-card-description', model.description));
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
  state.root.appendChild(el(doc, 'div', 'airport-card-muted nev-card-coverage', model.coverage));
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
  state.event = null;
  if (state.root && !state.root.hidden) state.root.hidden = true;
}

function show(event) {
  if (!event || !Number.isFinite(event.lat) || !Number.isFinite(event.lon)) { hide(); return; }
  state.event = event;
  render();
}

/**
 * Nainštaluje kartu udalosti. Idempotentné.
 * @param {object} viewer Cesium viewer
 * @param {object} options
 * @param {HTMLElement} options.container rodič (document.body)
 * @param {EventTarget} [options.eventTarget] test seam (default window)
 * @param {() => void} [options.onClosed] volané po krížiku/Escape
 */
export function installNaturalEventCard(viewer, { container, eventTarget, onClosed } = {}) {
  if (state.root || !container) return;
  const doc = container.ownerDocument;
  state.viewer = viewer; state.container = container;
  state.onClosed = typeof onClosed === 'function' ? onClosed : null;
  const root = el(doc, 'aside', 'airport-card natural-event-card');
  root.hidden = true; root.setAttribute('role', 'dialog');
  container.appendChild(root);
  state.root = root;
  const target = eventTarget || (typeof window !== 'undefined' ? window : null);
  if (target?.addEventListener) {
    state.onSelected = (e) => show(e?.detail);
    state.onCleared = () => hide();
    state.onKey = (e) => { if (e?.key === 'Escape' && state.event) { hide(); state.onClosed?.(); } };
    target.addEventListener(NATURAL_EVENT_SELECTED_EVENT, state.onSelected);
    target.addEventListener(NATURAL_EVENT_CLEARED_EVENT, state.onCleared);
    target.addEventListener('keydown', state.onKey);
    state.eventTarget = target;
  }
  const postRender = viewer?.scene?.postRender;
  if (postRender?.addEventListener) {
    postRender.addEventListener(place);
    state.removePostRender = () => postRender.removeEventListener(place);
  }
}

export function destroyNaturalEventCard() {
  hide();
  state.removePostRender?.(); state.removePostRender = null;
  if (state.eventTarget) {
    state.eventTarget.removeEventListener(NATURAL_EVENT_SELECTED_EVENT, state.onSelected);
    state.eventTarget.removeEventListener(NATURAL_EVENT_CLEARED_EVENT, state.onCleared);
    state.eventTarget.removeEventListener('keydown', state.onKey);
  }
  state.eventTarget = null; state.onSelected = null; state.onCleared = null; state.onKey = null;
  state.root?.remove(); state.root = null; state.viewer = null; state.container = null;
}

/** Test seams. */
export function _getNaturalEventCardStateForTest() {
  return { hidden: state.root ? state.root.hidden : null, text: state.root?.textContent || '' };
}
export function _resetNaturalEventCardForTest() { destroyNaturalEventCard(); state.onClosed = null; }
