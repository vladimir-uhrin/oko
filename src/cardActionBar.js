// src/cardActionBar.js — SLEDOVAŤ a KOKPIT ako lišta akcií pod kartou lietadla na mobile (2026-10-04).
//
// Vlastník: „je tam také že sledovať a kokpit, čo s tým, navrhni" → zvolil „pod kartu". Na telefóne
// na výšku viseli obe tlačidlá (~130×44 px) vpravo dole nad hlasovou pilulkou, ďaleko od karty, a
// zakrývali mapu. Na mobile sa preto pripnú pod kartu (pod pás s fotkou / pás štátneho lietadla),
// rovnakou šírkou ako karta, každé na podiel šírky. Keď pod kartou nie je miesto (dok, spodná
// lišta), idú nad ňu. Na počítači ostáva umiestnenie zo style.css. Karta je v plátne (worldOverlay)
// — lišta je DOM ukotvený k jej obdĺžniku, rovnako ako krížik (cardCloseButtons.js).

import { getOverlayPaintRect } from './overlays/worldOverlay.js';
import { TRACKED_OVERLAY_SOURCE_ID, getActiveTrackedReadoutId } from './data/trackedReadout.js';
import { closeButtonVisibility } from './cardCloseButtons.js';

export const CARD_ACTION_HEIGHT_PX = 44;
export const CARD_ACTION_GAP_PX = 6;
/** Pod týmto okrajom od vrchu je horná lišta (logo, ikony). */
export const CARD_ACTION_TOP_SAFE_PX = 64;
/** Nad týmto okrajom od spodku je hlasový dok a spodná lišta sekcií. */
export const CARD_ACTION_BOTTOM_SAFE_PX = 150;
const ACTION_CLASS = 'oko-card-action';

/**
 * Poloha lišty (pure): pod najnižším z obdĺžnikov karty a jej pásov, inak nad kartou, inak null
 * (tlačidlá ostanú na svojom mieste zo style.css).
 * @param {{x:number,y:number,w:number,h:number}} card obdĺžnik karty (v mierke kresby)
 * @param {Array<{top:number,bottom:number}>} attached pásy pod kartou (fotka, štátne lietadlo)
 * @param {{w:number,h:number}} viewport
 * @returns {?{x:number,y:number,w:number,above:boolean}}
 */
export function cardActionBarPlacement(card, attached, viewport, {
  height = CARD_ACTION_HEIGHT_PX, gap = CARD_ACTION_GAP_PX, topSafe = CARD_ACTION_TOP_SAFE_PX, bottomSafe = CARD_ACTION_BOTTOM_SAFE_PX,
} = {}) {
  if (!card || !(card.w > 0) || !(viewport?.h > 0)) return null;
  let bottom = card.y + card.h;
  let top = card.y;
  for (const rect of attached || []) {
    if (!rect) continue;
    bottom = Math.max(bottom, rect.bottom);
    top = Math.min(top, rect.top);
  }
  const x = Math.round(card.x);
  const w = Math.round(card.w);
  const below = bottom + gap;
  if (below + height <= viewport.h - bottomSafe) return { x, y: Math.round(below), w, above: false };
  const above = top - gap - height;
  if (above >= topSafe) return { x, y: Math.round(above), w, above: true };
  return null;
}

function setStyle(el, prop, value) {
  if (el.style[prop] !== value) el.style[prop] = value;
}

function clearInline(button) {
  if (!button.classList.contains(ACTION_CLASS)) return;
  button.classList.remove(ACTION_CLASS);
  for (const prop of ['left', 'top', 'right', 'bottom', 'width']) button.style[prop] = '';
}

/** Obdĺžnik viditeľnej karty sledovaného objektu (v mierke kresby) alebo null. */
export function trackedCardRect() {
  const id = getActiveTrackedReadoutId();
  return id ? closeButtonVisibility(getOverlayPaintRect(TRACKED_OVERLAY_SOURCE_ID, id)) : null;
}

/**
 * Nainštaluj lištu. Bez mobilu, bez karty alebo bez miesta vráti tlačidlá na pôvodné miesto.
 * @param {object} viewer Cesium viewer (postRender, trackedEntityChanged)
 * @param {{doc?: Document, isMobile?: () => boolean, cardRect?: () => object|null}} [options] test seams
 */
export function installCardActionBar(viewer, {
  doc = document,
  isMobile = () => doc.body?.classList.contains('oko-mobile'),
  cardRect = trackedCardRect,
} = {}) {
  const ids = ['follow-flight', 'cockpit-entry'];

  function sync() {
    const buttons = ids.map((id) => doc.getElementById(id)).filter(Boolean);
    const shown = buttons.filter((b) => !b.hidden);
    const view = doc.defaultView;
    const card = isMobile() && shown.length ? cardRect() : null;
    const attached = card
      // Pásy sú position: fixed — offsetParent je null aj pri viditeľnom, preto rozmer a štýl.
      ? [...doc.querySelectorAll('.tracked-photo, .state-strip')]
        .filter((el) => !el.hidden && view?.getComputedStyle?.(el).display !== 'none')
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.height > 0 && r.width > 0)
      : [];
    // Nad kartu len pod hornú lištu (mobil, #oko-topbar), inak pod logo a ikony.
    const topbar = card ? doc.getElementById('oko-topbar')?.getBoundingClientRect?.() : null;
    const topSafe = topbar && topbar.height > 0 ? Math.max(CARD_ACTION_TOP_SAFE_PX, Math.round(topbar.bottom) + CARD_ACTION_GAP_PX) : CARD_ACTION_TOP_SAFE_PX;
    const placed = card ? cardActionBarPlacement(card, attached, { w: view?.innerWidth || 0, h: view?.innerHeight || 0 }, { topSafe }) : null;
    if (!placed) {
      for (const b of buttons) clearInline(b);
      return;
    }
    const each = (placed.w - CARD_ACTION_GAP_PX * (shown.length - 1)) / shown.length;
    shown.forEach((b, i) => {
      if (!b.classList.contains(ACTION_CLASS)) b.classList.add(ACTION_CLASS);
      // Zapisovať len zmenu: sync beží každý snímok a zápis štýlu je mutácia, ktorú pozoruje
      // hostiteľ prekrytia (worldOverlay) — zbytočne by prepočítaval rozloženie.
      setStyle(b, 'left', `${Math.round(placed.x + i * (each + CARD_ACTION_GAP_PX))}px`);
      setStyle(b, 'top', `${placed.y}px`);
      setStyle(b, 'right', 'auto');
      setStyle(b, 'bottom', 'auto');
      setStyle(b, 'width', `${Math.round(each)}px`);
    });
    for (const b of buttons) if (b.hidden) clearInline(b);
  }

  const postRender = viewer?.scene?.postRender;
  postRender?.addEventListener?.(sync);
  const changed = viewer?.trackedEntityChanged;
  const removeChanged = changed?.addEventListener?.(sync);
  return {
    sync,
    destroy() {
      postRender?.removeEventListener?.(sync);
      if (typeof removeChanged === 'function') removeChanged();
      else changed?.removeEventListener?.(sync);
      for (const id of ids) {
        const b = doc.getElementById(id);
        if (b) clearInline(b);
      }
    },
  };
}
