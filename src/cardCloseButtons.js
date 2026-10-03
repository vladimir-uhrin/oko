// src/cardCloseButtons.js — krížik (×) v rohu kartičiek na glóbuse (2026-09-30).
//
// Vlastník: „mohol si nejako zmysluplne dať zavieranie kartičiek, lebo kliknúť vedľa, aby sa
// karta zavrela, je amaterizmus. Aspoň malé X do rohu." Kartičky sledovaného objektu (lietadlo,
// vojenský let, satelit, základňa) a vybranej lode kreslí hostiteľ worldOverlay do plátna —
// krížik je preto DOM tlačidlo ukotvené k pravému hornému rohu ich obdĺžnika, rovnako ako pás
// s fotkou (trackedPhoto.js). Zatvára tou istou cestou ako klik vedľa (vrstva zruší sledovanie
// alebo výber). Kartičky letiska a prírodnej udalosti majú vlastný krížik už predtým.

import { getOverlayPaintRect } from './overlays/worldOverlay.js';
import { photoVisibility } from './data/trackedPhoto.js';
import { governorRequestRender } from './renderGovernor.js';

/** Veľkosť tlačidla (px) a odstup od rohu karty. */
export const CARD_CLOSE_SIZE_PX = 26;
export const CARD_CLOSE_INSET_PX = 6;

/** Poloha krížika: vnútri pravého horného rohu viditeľnej karty. Pure. */
export function closeButtonPlacement(rect, size = CARD_CLOSE_SIZE_PX, inset = CARD_CLOSE_INSET_PX) {
  return { x: Math.round(rect.x + rect.w - size - inset), y: Math.round(rect.y + inset) };
}

/**
 * Nainštaluj krížiky. Každý poskytovateľ opisuje jeden druh karty.
 * @param {object} viewer Cesium viewer (postRender, trackedEntityChanged)
 * @param {object} options
 * @param {HTMLElement} options.container
 * @param {Array<{id: string, active: () => ({sourceId: string, entryId: string}|null), close: () => void}>} options.providers
 * @param {(key: string) => string} options.t
 * @param {(sourceId: string, entryId: string) => object|null} [options.paintRect] test seam
 * @returns {{sync: () => void, destroy: () => void}}
 */
export function installCardCloseButtons(viewer, { container, providers, t, paintRect = getOverlayPaintRect }) {
  const doc = container.ownerDocument;
  const buttons = new Map();
  for (const provider of providers) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'card-close';
    button.hidden = true;
    button.dataset.cardKind = provider.id;
    button.setAttribute('aria-label', t('card.close'));
    button.title = t('card.close');
    const icon = doc.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = 'close';
    button.appendChild(icon);
    button.addEventListener('click', (event) => {
      event?.stopPropagation?.();
      button.hidden = true;
      try { provider.close(); } finally { governorRequestRender('card-close'); }
    });
    container.appendChild(button);
    buttons.set(provider.id, { provider, button });
  }

  function sync() {
    for (const { provider, button } of buttons.values()) {
      let card = null;
      try { card = provider.active(); } catch { card = null; }
      const visible = card ? photoVisibility(paintRect(card.sourceId, card.entryId)) : null;
      if (!visible) {
        if (!button.hidden) button.hidden = true;
        continue;
      }
      const { x, y } = closeButtonPlacement(visible);
      if (button.hidden) button.hidden = false;
      button.style.opacity = String(visible.opacity);
      button.style.transform = `translate(${x}px, ${y}px)`;
    }
  }

  const postRender = viewer?.scene?.postRender;
  postRender?.addEventListener?.(sync);
  // Render governor kreslí len na požiadanie — po zrušení sledovania nemusí prísť snímok,
  // krížik by visel sám (to isté ako pri fotke, 2026-09-05).
  const changed = viewer?.trackedEntityChanged;
  const onChanged = () => sync();
  const removeChanged = changed?.addEventListener?.(onChanged);

  return {
    sync,
    destroy() {
      postRender?.removeEventListener?.(sync);
      if (typeof removeChanged === 'function') removeChanged();
      else changed?.removeEventListener?.(onChanged);
      for (const { button } of buttons.values()) button.remove();
      buttons.clear();
    },
  };
}
