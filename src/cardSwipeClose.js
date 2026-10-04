// src/cardSwipeClose.js — kartu lietadla na mobile zavrie aj potiahnutie nadol (2026-10-04).
//
// Vlastník zvolil z návrhov „zatvorenie karty potiahnutím nadol" (krížik ostáva). Karta je v plátne
// (worldOverlay), preto nad ňu na mobile ide priehľadná dotyková plocha s úchytom hore (ako výsuv
// sekcií) ukotvená k jej obdĺžniku — rovnako ako krížik (cardCloseButtons.js). Gesto je to isté ako
// pri výsuve: swipeShouldClose z mobileShell.js. Plocha leží POD krížikom (z-index), takže ťuknutie
// na krížik ide stále jemu; ťah, ktorý začne na karte, neotáča mapu.

import { swipeShouldClose } from './mobileShell.js';

const DRAG_FEEDBACK_PX = 80;

function setStyle(el, prop, value) {
  if (el.style[prop] !== value) el.style[prop] = value;
}

/**
 * @param {object} viewer Cesium viewer (postRender, trackedEntityChanged)
 * @param {{doc?: Document, isMobile?: () => boolean, cardRect: () => ({x:number,y:number,w:number,h:number}|null), onClose: () => void, now?: () => number}} options
 */
export function installCardSwipeClose(viewer, {
  doc = document,
  isMobile = () => doc.body?.classList.contains('oko-mobile'),
  cardRect,
  onClose,
  now = () => Date.now(),
}) {
  const zone = doc.createElement('div');
  zone.className = 'card-swipe-zone';
  zone.hidden = true;
  zone.setAttribute('aria-hidden', 'true');
  const grabber = doc.createElement('span');
  grabber.className = 'card-swipe-grabber';
  zone.appendChild(grabber);
  doc.body.appendChild(zone);

  let start = null;

  function feedback(dy) {
    const progress = Math.max(0, Math.min(1, dy / DRAG_FEEDBACK_PX));
    zone.style.setProperty?.('--swipe', progress.toFixed(3));
  }

  function sync() {
    let rect = null;
    try { rect = isMobile() ? cardRect() : null; } catch { rect = null; }
    if (!rect) {
      if (!zone.hidden) zone.hidden = true;
      start = null;
      return;
    }
    if (zone.hidden) zone.hidden = false;
    setStyle(zone, 'left', `${Math.round(rect.x)}px`);
    setStyle(zone, 'top', `${Math.round(rect.y)}px`);
    setStyle(zone, 'width', `${Math.round(rect.w)}px`);
    setStyle(zone, 'height', `${Math.round(rect.h)}px`);
  }

  const onStart = (event) => {
    const touch = event?.touches?.[0];
    start = touch ? { y: touch.clientY, t: now() } : null;
  };
  const onMove = (event) => {
    const touch = event?.touches?.[0];
    if (!start || !touch) return;
    event.preventDefault?.(); // ťah po karte nemá otáčať glóbus
    feedback(touch.clientY - start.y);
  };
  const onEnd = (event) => {
    const touch = event?.changedTouches?.[0];
    const begun = start;
    start = null;
    feedback(0);
    if (begun && touch && swipeShouldClose({ startY: begun.y, endY: touch.clientY, elapsedMs: now() - begun.t })) {
      zone.hidden = true;
      onClose?.();
    }
  };
  zone.addEventListener('touchstart', onStart, { passive: true });
  zone.addEventListener('touchmove', onMove, { passive: false });
  zone.addEventListener('touchend', onEnd);
  zone.addEventListener('touchcancel', () => { start = null; feedback(0); });

  const postRender = viewer?.scene?.postRender;
  postRender?.addEventListener?.(sync);
  const changed = viewer?.trackedEntityChanged;
  const removeChanged = changed?.addEventListener?.(sync);
  return {
    sync,
    element: zone,
    destroy() {
      postRender?.removeEventListener?.(sync);
      if (typeof removeChanged === 'function') removeChanged();
      else changed?.removeEventListener?.(sync);
      zone.remove();
    },
  };
}
