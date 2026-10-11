// src/data/vesselPhoto.js
/**
 * @module vesselPhoto
 * @description Fotka vybranej lode pod jej kartou (2026-10-10, vlastník:
 * „doplň aj fotky"). Rovnaký pás ako fotka sledovaného lietadla
 * (trackedPhoto.js — umiestnenie, viditeľnosť pri vyblednutí aj zmenšení
 * karty), len zdroj je register lodí cez /api/vessel-info a fotka je väčšia,
 * na celú šírku karty. Lode nepoužívajú viewer.trackedEntity, preto vybranú
 * loď dodávajú vrstvy (`getSelected` → MMSI + zdroj a id karty v overlayi):
 * živé AIS aj oneskorené AISHub.
 */
import { getOverlayPaintRect } from '../overlays/worldOverlay.js';
import { governorRequestRender } from '../renderGovernor.js';
import { photoPlacement, photoVisibility } from './trackedPhoto.js';
import { lookupVesselInfo } from './vesselInfo.js';
import { t } from '../i18n.js';

const state = {
  root: null,
  img: null,
  credit: null,
  getSelected: null,
  lookup: lookupVesselInfo,
  currentMmsi: null,
  photo: null,
  removePostRender: null,
};

function hide() {
  if (state.root && !state.root.hidden) state.root.hidden = true;
}

function sync() {
  if (!state.root) return;
  let selected = null;
  try { selected = state.getSelected?.() || null; } catch { selected = null; }
  const mmsi = selected?.mmsi || null;
  if (!mmsi) { state.currentMmsi = null; state.photo = null; hide(); return; }
  if (mmsi !== state.currentMmsi) {
    state.currentMmsi = mmsi;
    state.photo = null;
    hide();
    Promise.resolve(state.lookup(mmsi)).then((info) => {
      if (state.currentMmsi !== mmsi || !state.root) return; // medzitým iná loď
      const src = info?.photo?.src;
      if (!src) return;
      state.photo = { src };
      state.root.href = src;
      state.root.title = t('vessel.photo-open');
      state.img.src = src;
      state.img.alt = t('vessel.photo-alt');
      // Commons: autor a licencia povinne (CC BY-SA), inak „Foto lode · register plavidiel".
      state.credit.textContent = [info.name, info.photo?.credit || t('vessel.photo-credit')].filter(Boolean).join(' · ');
      governorRequestRender('vessel-photo');
    }).catch(() => {});
  }
  if (!state.photo) return;
  const visible = photoVisibility(getOverlayPaintRect(selected.sourceId, selected.entryId));
  if (!visible) { hide(); return; }
  if (state.root.hidden) state.root.hidden = false;
  const view = state.root.ownerDocument.defaultView;
  const size = { w: visible.w, h: state.root.offsetHeight || 160 };
  const { x, y, w, above } = photoPlacement(visible, size, { w: view?.innerWidth || 0, h: view?.innerHeight || 0 });
  state.root.style.width = `${w}px`;
  state.root.style.opacity = String(visible.opacity);
  state.root.style.transform = `translate(${x}px, ${y}px)`;
  state.root.classList?.toggle?.('is-above', above);
}

/**
 * Nainštaluje fotku vybranej lode. Idempotentné.
 * @param {object} viewer Cesium viewer (scene.postRender)
 * @param {object} options
 * @param {HTMLElement} options.container rodič (typicky document.body)
 * @param {() => ({mmsi: string, sourceId: string, entryId: string}|null)} options.getSelected vybraná loď
 * @param {Function} [options.lookup] test seam (default lookupVesselInfo)
 */
export function installVesselPhoto(viewer, { container, getSelected, lookup } = {}) {
  if (state.root || !container) return;
  const doc = container.ownerDocument;
  state.getSelected = getSelected;
  if (typeof lookup === 'function') state.lookup = lookup;
  const root = doc.createElement('a');
  root.className = 'tracked-photo vessel-photo';
  root.target = '_blank';
  root.rel = 'noopener';
  root.hidden = true;
  const img = doc.createElement('img');
  img.className = 'tracked-photo-image';
  img.decoding = 'async';
  const credit = doc.createElement('span');
  credit.className = 'tracked-photo-credit';
  root.appendChild(img);
  root.appendChild(credit);
  container.appendChild(root);
  state.root = root; state.img = img; state.credit = credit;
  const postRender = viewer?.scene?.postRender;
  if (postRender?.addEventListener) {
    postRender.addEventListener(sync);
    state.removePostRender = () => postRender.removeEventListener(sync);
  }
}

/** Odstráni pás a odhlási listener. */
export function destroyVesselPhoto() {
  state.removePostRender?.();
  state.removePostRender = null;
  state.root?.remove();
  state.root = null; state.img = null; state.credit = null;
  state.currentMmsi = null; state.photo = null;
  state.getSelected = null;
  state.lookup = lookupVesselInfo;
}

/** Test seam. */
export function _syncVesselPhotoForTest() { sync(); }
export function _getVesselPhotoStateForTest() {
  return {
    installed: Boolean(state.root),
    hidden: state.root ? state.root.hidden : null,
    currentMmsi: state.currentMmsi,
    src: state.img?.src || null,
    credit: state.credit?.textContent || '',
  };
}
