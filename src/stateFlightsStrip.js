// src/stateFlightsStrip.js — pás štátneho lietadla nad kartou sledovaného letu (2026-09-30).
//
// Vlastník: vládne lietadlá SR „aby sa ich aj spätne dalo trackovať", verejne, „ale chcem nejaký
// prepínač do karty". Keď je sledovaný stroj v overenom zozname štátnych lietadiel, nad kartou
// sa ukáže odznak (úloha, prevádzkovateľ, značka, typ) a prepínač PREDCHÁDZAJÚCE LETY: zapnutý
// ukáže jeho lety z archívu (dátum, odlet → prílet odvodený z trasy, trvanie); klik na let ho
// otvorí v paneli História letov a prehrá na glóbuse. Stav prepínača si prehliadač pamätá.
//
// Karta sa kreslí do plátna (worldOverlay), preto je pás DOM prvok ukotvený k jej obdĺžniku —
// rovnako ako pás s fotkou (trackedPhoto.js): pod kartou a pod fotkou; nad kartu ide len vtedy,
// keď dole nie je miesto a hore ho nezakryje horná lišta.
// Etická čiara: pás hovorí o stroji a jeho letoch, nikdy o tom, kto je na palube.

import { getOverlayPaintRect } from './overlays/worldOverlay.js';
import { getActiveTrackedReadoutId } from './data/trackedReadout.js';
import { photoVisibility } from './data/trackedPhoto.js';
import { governorRequestRender } from './renderGovernor.js';
import { stateAircraftLabel } from './data/stateAircraft.js';
import {
  STATE_FLIGHTS_PAGE,
  fetchStateFlights,
  loadStateAircraftList,
  stateAircraftListNow,
  stateFlightRowModel,
} from './data/stateAircraftClient.js';
import { currentLanguage, t } from './i18n.js';

export const STATE_STRIP_OPEN_KEY = 'oko.stateFlights.open';
/** Prekrytie s kartou (px) — pás prekrýva jej zaoblený okraj a číta ako jej ďalší riadok. */
export const STATE_STRIP_OVERLAP_PX = 5;
/**
 * Pod týmto okrajom od vrchu je horná lišta (logo, ikony) — pás tam nesmie. Na úzkej obrazovke
 * je karta prilepená hore a pás nad ňou zakryli ikony (naživo 2026-09-30, 702 px).
 */
export const STATE_STRIP_TOP_SAFE_PX = 64;
/**
 * Nad týmto okrajom od spodku sú hlasový dok a spodná lišta — zoznam letov sa skráti (roluje),
 * aby ich neprekryl (naživo 2026-09-30: tlačidlo STARŠIE pod dokom).
 */
export const STATE_STRIP_BOTTOM_SAFE_PX = 150;
/**
 * Na užších obrazovkách (≤ 1180 px) plávajú SLEDOVAŤ a KOKPIT vpravo dole nad dokom (style.css
 * #follow-flight / #cockpit-entry) — pás končí nad nimi.
 */
export const STATE_STRIP_BOTTOM_SAFE_NARROW_PX = 240;
export const STATE_STRIP_NARROW_MAX_W = 1180;
/** Pás sa nikdy neskráti pod túto výšku (hlavička + aspoň jeden let). */
export const STATE_STRIP_MIN_HEIGHT_PX = 110;

/** Najväčšia výška pásu, ktorá sa zmestí nad spodný dok (a na úzkej obrazovke nad plávajúce tlačidlá). Pure. */
export function stripMaxHeight(y, viewportH, viewportW = Infinity) {
  const bottomSafe = viewportW <= STATE_STRIP_NARROW_MAX_W ? STATE_STRIP_BOTTOM_SAFE_NARROW_PX : STATE_STRIP_BOTTOM_SAFE_PX;
  return Math.max(STATE_STRIP_MIN_HEIGHT_PX, Math.round(viewportH - y - bottomSafe));
}
const TRACKED_PREFIXES = ['flights:', 'military:'];

/** Hex sledovaného stroja z id záznamu karty (`flights:4b1805`), inak null. Pure. */
export function trackedHexFromId(id) {
  const text = String(id || '');
  const prefix = TRACKED_PREFIXES.find((p) => text.startsWith(p));
  if (!prefix) return null;
  const hex = text.slice(prefix.length).toLowerCase();
  return /^[0-9a-f]{6}$/.test(hex) ? hex : null;
}

/**
 * Poloha pásu: pod kartou (a pod pásom s fotkou, `belowOffset`), zarovnaný s jej ľavým okrajom,
 * aspoň taký široký ako karta. Keď dole nie je miesto a hore je (mimo hornej lišty), ide nad
 * kartu; inak ostane dole a posunie sa do okna. Pure.
 */
export function stripPlacement(rect, size, viewport, { belowOffset = 0, overlap = STATE_STRIP_OVERLAP_PX, topSafe = STATE_STRIP_TOP_SAFE_PX } = {}) {
  const w = Math.max(Math.round(rect.w), Math.min(size.w, Math.max(0, viewport.w - 8)));
  let x = Math.round(rect.x);
  if (x + w > viewport.w - 4) x = Math.max(4, viewport.w - 4 - w);
  const belowY = rect.y + rect.h - overlap + belowOffset;
  const aboveY = rect.y - size.h + overlap;
  if (belowY + size.h <= viewport.h - 4) return { x, y: Math.round(belowY), w, above: false };
  if (aboveY >= topSafe) return { x, y: Math.round(aboveY), w, above: true };
  return { x, y: Math.round(Math.max(topSafe, viewport.h - 4 - size.h)), w, above: false };
}

const state = {
  viewer: null,
  root: null,
  parts: null,
  storage: null,
  fetcher: null,
  onOpenLeg: null,
  onOpenAll: null,
  open: false,
  hex: null,
  flights: new Map(), // hex → { items, done, loading, error }
  removePostRender: null,
  removeTrackedChanged: null,
};

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function hide() {
  if (state.root && !state.root.hidden) state.root.hidden = true;
}

function readOpen() {
  try { return state.storage?.getItem?.(STATE_STRIP_OPEN_KEY) === '1'; } catch { return false; }
}

function writeOpen(open) {
  try { state.storage?.setItem?.(STATE_STRIP_OPEN_KEY, open ? '1' : '0'); } catch { /* súkromný režim */ }
}

async function loadMore(hex) {
  const entry = state.flights.get(hex) || { items: [], done: false, loading: false, error: false };
  state.flights.set(hex, entry);
  if (entry.loading || entry.done) return;
  entry.loading = true;
  entry.error = false;
  renderList();
  try {
    const before = entry.items.length ? entry.items[entry.items.length - 1].lastT : null;
    const page = await fetchStateFlights(hex, { before, limit: STATE_FLIGHTS_PAGE, fetcher: state.fetcher });
    entry.items.push(...page);
    if (page.length < STATE_FLIGHTS_PAGE) entry.done = true;
  } catch {
    entry.error = true;
  } finally {
    entry.loading = false;
    if (state.hex === hex) renderList();
    governorRequestRender('state-strip');
  }
}

function renderHead(aircraft) {
  const { badge, meta, toggle, toggleText } = state.parts;
  const lang = currentLanguage();
  badge.textContent = stateAircraftLabel(aircraft, lang);
  meta.textContent = [aircraft.operator?.[lang === 'en' ? 'en' : 'sk'], aircraft.reg, aircraft.typeName || aircraft.typeCode]
    .filter(Boolean).join(' · ');
  toggle.setAttribute('aria-pressed', state.open ? 'true' : 'false');
  toggleText.textContent = t('state.toggle');
  toggle.title = t('state.toggle-title');
}

function renderList() {
  const { list, foot, more, all, note, status } = state.parts;
  const doc = list.ownerDocument;
  list.hidden = !state.open;
  foot.hidden = !state.open;
  status.hidden = true;
  if (!state.open || !state.hex) return;
  const entry = state.flights.get(state.hex);
  list.textContent = '';
  const lang = currentLanguage();
  for (const flight of entry?.items || []) {
    const row = stateFlightRowModel(flight, lang);
    const li = el(doc, 'li', `state-strip-flight${row.alert ? ' is-alert' : ''}`);
    const btn = el(doc, 'button', 'state-strip-flight-btn');
    btn.type = 'button';
    btn.append(el(doc, 'span', 'state-strip-route', row.route), el(doc, 'span', 'state-strip-sub', row.sub));
    if (row.alert) btn.appendChild(el(doc, 'span', 'state-strip-alert', `SQUAWK ${row.alert}`));
    btn.addEventListener('click', () => state.onOpenLeg?.(flight));
    li.appendChild(btn);
    list.appendChild(li);
  }
  if (entry?.loading) { status.textContent = t('state.loading'); status.hidden = false; }
  else if (entry?.error) { status.textContent = t('state.unavailable'); status.hidden = false; }
  else if (entry && !entry.items.length) { status.textContent = t('state.empty'); status.hidden = false; }
  more.hidden = !entry || entry.done || entry.loading || !entry.items.length;
  more.textContent = t('state.more');
  all.textContent = t('state.all-in-history');
  note.textContent = t('state.derived-note');
}

function sync() {
  if (!state.root) return;
  const hex = trackedHexFromId(getActiveTrackedReadoutId());
  const list = stateAircraftListNow();
  const aircraft = hex && list ? list.byHex.get(hex) : null;
  if (!aircraft) { state.hex = null; hide(); return; }
  if (state.hex !== hex) {
    state.hex = hex;
    renderHead(aircraft);
    renderList();
    if (state.open && !state.flights.has(hex)) void loadMore(hex);
  }
  const id = getActiveTrackedReadoutId();
  const visible = photoVisibility(getOverlayPaintRect('tracked', id));
  if (!visible) { hide(); return; }
  if (state.root.hidden) state.root.hidden = false;
  const view = state.root.ownerDocument.defaultView;
  const size = { w: state.root.offsetWidth || 320, h: state.root.offsetHeight || 40 };
  const photo = state.root.ownerDocument.querySelector?.('.tracked-photo:not([hidden])');
  const { x, y, w, above } = stripPlacement(visible, size, { w: view?.innerWidth || 0, h: view?.innerHeight || 0 }, {
    belowOffset: photo ? Math.max(0, (photo.offsetHeight || 0) - STATE_STRIP_OVERLAP_PX) : 0,
  });
  state.root.style.minWidth = `${w}px`;
  state.root.style.maxHeight = above ? '' : `${stripMaxHeight(y, view?.innerHeight || 0, view?.innerWidth || 0)}px`;
  state.root.style.opacity = String(visible.opacity);
  state.root.style.transform = `translate(${x}px, ${y}px)`;
  state.root.classList?.toggle?.('is-above', above);
}

/**
 * Nainštaluj pás štátneho lietadla. Idempotentné.
 * @param {object} viewer Cesium viewer
 * @param {object} options
 * @param {HTMLElement} options.container
 * @param {(flight: object) => void} options.onOpenLeg otvor let v paneli História letov
 * @param {(hex: string) => void} options.onOpenAll všetky lety stroja v paneli
 * @param {Storage|null} [options.storage]
 * @param {Function} [options.fetcher]
 */
export function installStateFlightsStrip(viewer, { container, onOpenLeg, onOpenAll, storage, fetcher } = {}) {
  if (state.root || !container) return;
  const doc = container.ownerDocument;
  state.viewer = viewer;
  state.storage = storage !== undefined ? storage : (typeof localStorage !== 'undefined' ? localStorage : null);
  state.fetcher = fetcher || ((url) => fetch(url));
  state.onOpenLeg = onOpenLeg || null;
  state.onOpenAll = onOpenAll || null;
  state.open = readOpen();

  const root = el(doc, 'section', 'state-strip');
  root.hidden = true;
  const head = el(doc, 'div', 'state-strip-head');
  const star = el(doc, 'span', 'material-symbols-outlined state-strip-icon', 'verified');
  star.setAttribute('aria-hidden', 'true');
  const titleWrap = el(doc, 'span', 'state-strip-title');
  const badge = el(doc, 'span', 'state-strip-badge');
  const meta = el(doc, 'span', 'state-strip-meta');
  titleWrap.append(badge, meta);
  const toggle = el(doc, 'button', 'state-strip-toggle');
  toggle.type = 'button';
  const toggleIcon = el(doc, 'span', 'material-symbols-outlined', 'history');
  toggleIcon.setAttribute('aria-hidden', 'true');
  const toggleText = el(doc, 'span', '');
  const knob = el(doc, 'span', 'state-strip-switch');
  knob.setAttribute('aria-hidden', 'true');
  toggle.append(toggleIcon, toggleText, knob);
  head.append(star, titleWrap, toggle);
  const status = el(doc, 'div', 'state-strip-status');
  status.hidden = true;
  const list = el(doc, 'ol', 'state-strip-list');
  list.hidden = true;
  list.setAttribute('aria-live', 'polite');
  const foot = el(doc, 'div', 'state-strip-foot');
  foot.hidden = true;
  const more = el(doc, 'button', 'state-strip-more');
  more.type = 'button';
  const all = el(doc, 'button', 'state-strip-all');
  all.type = 'button';
  const note = el(doc, 'span', 'state-strip-note');
  foot.append(more, all, note);
  root.append(head, status, list, foot);
  container.appendChild(root);
  state.root = root;
  state.parts = { badge, meta, toggle, toggleText, list, foot, more, all, note, status };

  toggle.addEventListener('click', () => {
    state.open = !state.open;
    writeOpen(state.open);
    toggle.setAttribute('aria-pressed', state.open ? 'true' : 'false');
    if (state.open && state.hex && !state.flights.has(state.hex)) void loadMore(state.hex);
    renderList();
    governorRequestRender('state-strip');
  });
  more.addEventListener('click', () => { if (state.hex) void loadMore(state.hex); });
  all.addEventListener('click', () => { if (state.hex) state.onOpenAll?.(state.hex); });

  // Zoznam štátnych strojov (malý, 30 min v pamäti) — pás sa ukáže až po jeho načítaní.
  void loadStateAircraftList({ fetcher: state.fetcher }).then(() => governorRequestRender('state-strip'));
  const postRender = viewer?.scene?.postRender;
  if (postRender?.addEventListener) {
    postRender.addEventListener(sync);
    state.removePostRender = () => postRender.removeEventListener(sync);
  }
  const changed = viewer?.trackedEntityChanged;
  if (changed?.addEventListener) {
    const onChanged = () => {
      if (!viewer.trackedEntity) { state.hex = null; hide(); return; }
      sync();
    };
    const remove = changed.addEventListener(onChanged);
    state.removeTrackedChanged = typeof remove === 'function' ? remove : () => changed.removeEventListener?.(onChanged);
  }
}

/** Odstráň pás (teardown viewera). */
export function destroyStateFlightsStrip() {
  state.removePostRender?.();
  state.removePostRender = null;
  state.removeTrackedChanged?.();
  state.removeTrackedChanged = null;
  state.root?.remove();
  state.root = null;
  state.parts = null;
  state.hex = null;
  state.flights.clear();
  state.viewer = null;
}

/** Test seam. */
export function _syncStateFlightsStripForTest() { sync(); }
export function _stateFlightsStripForTest() {
  return { root: state.root, open: state.open, hex: state.hex, flights: state.flights };
}
