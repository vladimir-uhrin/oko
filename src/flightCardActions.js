// src/flightCardActions.js — Zdieľať a História letu v rohu karty lietadla (2026-10-11).
//
// Vlastník: „aj tu by si mohol dať ako u lodiach v kartičke zdieľanie atď." Karta lode má vedľa
// krížika kruhové tlačidlá (zvonček, história, zdieľanie — followedVessels.js); karta lietadla mala
// pravý horný roh prázdny. Sledovanie letu ostáva tlačidlom SLEDOVAŤ pod kartou, sem idú:
//   • Zdieľať — panel zdieľania s obrázkom/videom a textom letu (flightShare.js),
//   • História letu — panel História letov s lietadlom (rovnako ako „História tohto stroja").
// Karta je v plátne (worldOverlay) — tlačidlá sú DOM ukotvený k jej obdĺžniku, ako krížik.

import { getOverlayPaintRect } from './overlays/worldOverlay.js';
import { TRACKED_OVERLAY_SOURCE_ID, getActiveTrackedReadoutId } from './data/trackedReadout.js';
import { closeButtonPlacement, closeButtonVisibility, CARD_CLOSE_INSET_PX, CARD_CLOSE_SIZE_PX } from './cardCloseButtons.js';

/** Vrstvy, ktorých karta je let (prefix id karty sledovaného objektu). */
export const FLIGHT_CARD_PREFIXES = Object.freeze(['flights', 'military']);
const GAP_PX = 6;

/** Hex lietadla z id karty sledovaného objektu („flights:78115f") alebo null. Pure. */
export function flightCardHex(entryId) {
  const [prefix, ...rest] = String(entryId || '').split(':');
  if (!FLIGHT_CARD_PREFIXES.includes(prefix)) return null;
  const hex = rest.join(':').trim().toLowerCase();
  return /^[0-9a-f]{6}$/.test(hex) ? hex : null;
}

/**
 * Polohy tlačidiel vľavo od krížika: [0] hneď vedľa, [1] ďalej. Pure.
 * @returns {Array<{x: number, y: number}>}
 */
export function flightActionPlacements(rect, count, viewport = null, { outsideTopSafe = null } = {}) {
  const close = closeButtonPlacement(rect, CARD_CLOSE_SIZE_PX, CARD_CLOSE_INSET_PX, viewport);
  // Mobil (2026-10-12): karta je zmenšená a tlačidlá v jej rohu zakrývali koniec riadkov — idú
  // nad hornú hranu karty, zarovnané vpravo (prvé nad krížikom). Bez miesta pod hornou lištou ostanú vnútri.
  const outsideY = Math.round(rect.y - CARD_CLOSE_SIZE_PX - GAP_PX);
  if (Number.isFinite(outsideTopSafe) && outsideY >= outsideTopSafe) {
    const out = [];
    for (let i = 0; i < count; i += 1) {
      out.push({ x: Math.max(CARD_CLOSE_INSET_PX, close.x - i * (CARD_CLOSE_SIZE_PX + GAP_PX)), y: outsideY });
    }
    return out;
  }
  const out = [];
  for (let i = 1; i <= count; i += 1) {
    out.push({ x: Math.max(CARD_CLOSE_INSET_PX, close.x - i * (CARD_CLOSE_SIZE_PX + GAP_PX)), y: close.y });
  }
  return out;
}

function makeButton(doc, className, iconName, title) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = `card-close ${className}`;
  button.hidden = true;
  button.title = title;
  button.setAttribute('aria-label', title);
  const icon = doc.createElement('span');
  icon.className = 'material-symbols-outlined';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = iconName;
  button.appendChild(icon);
  return button;
}

/**
 * @param {object} viewer Cesium viewer (postRender)
 * @param {object} o
 * @param {HTMLElement} o.container
 * @param {(key: string) => string} o.translate
 * @param {(hex: string) => void} o.onShare
 * @param {(hex: string) => void} o.onHistory
 * @param {() => string|null} [o.activeId] test seam
 * @param {(sourceId: string, entryId: string) => object|null} [o.paintRect] test seam
 */
export function installFlightCardActions(viewer, {
  container,
  translate: t,
  onShare,
  onHistory,
  activeId = getActiveTrackedReadoutId,
  paintRect = getOverlayPaintRect,
}) {
  const doc = container.ownerDocument;
  const share = makeButton(doc, 'card-share card-flight-share', 'share', t('flight.share'));
  const history = makeButton(doc, 'card-history card-flight-history', 'history', t('flight.history'));
  const buttons = [share, history];
  for (const button of buttons) container.appendChild(button);
  let currentHex = null;

  function hide() {
    currentHex = null;
    for (const button of buttons) if (!button.hidden) button.hidden = true;
  }

  function sync() {
    const id = activeId();
    const hex = flightCardHex(id);
    const visible = hex ? closeButtonVisibility(paintRect(TRACKED_OVERLAY_SOURCE_ID, id)) : null;
    if (!visible) { hide(); return; }
    currentHex = hex;
    const view = doc.defaultView;
    const mobile = doc.body?.classList?.contains?.('oko-mobile') === true;
    let outsideTopSafe = null;
    if (mobile) {
      const bar = doc.getElementById?.('oko-topbar')?.getBoundingClientRect?.();
      outsideTopSafe = bar && bar.height > 0 ? Math.round(bar.bottom) + GAP_PX : 64;
    }
    const spots = flightActionPlacements(visible, buttons.length, { w: view?.innerWidth || 0, h: view?.innerHeight || 0 }, { outsideTopSafe });
    buttons.forEach((button, i) => {
      if (button.hidden) button.hidden = false;
      const opacity = String(visible.opacity);
      if (button.style.opacity !== opacity) button.style.opacity = opacity;
      const transform = `translate(${spots[i].x}px, ${spots[i].y}px)`;
      // Zapisovať len zmenu: sync beží každý snímok a zápis štýlu je mutácia pre worldOverlay.
      if (button.style.transform !== transform) button.style.transform = transform;
    });
  }

  const onShareClick = (event) => {
    event?.stopPropagation?.();
    if (currentHex) { try { onShare(currentHex); } catch { /* zdieľanie je najlepšia snaha */ } }
  };
  const onHistoryClick = (event) => {
    event?.stopPropagation?.();
    if (currentHex) { try { onHistory(currentHex); } catch { /* panel histórie je voliteľný */ } }
  };
  share.addEventListener('click', onShareClick);
  history.addEventListener('click', onHistoryClick);
  const postRender = viewer?.scene?.postRender;
  postRender?.addEventListener?.(sync);
  sync();
  return {
    share,
    history,
    sync,
    destroy() {
      postRender?.removeEventListener?.(sync);
      share.removeEventListener('click', onShareClick);
      history.removeEventListener('click', onHistoryClick);
      for (const button of buttons) button.remove();
    },
  };
}
