// src/cardChromeFade.js — pravá horná ponuka ustúpi karte sledovaného objektu (2026-10-12).
//
// Vlastník (snímka 2026-10-11): karta lietadla vysoko na obrazovke ležala pod nápismi „Aktívny štýl",
// „Jazyk SK·EN", „Články", „Súkromie" — text cez text. Ponuka je pre umiestňovanie kariet len mäkká
// prekážka (worldOverlay: nad ňu karta ide, keď pod lietadlom nie je miesto — hlasový ovládač, dok).
// Namiesto zásahu do umiestňovania: kým karta ponuku prekrýva, ponuka sa takmer stratí a nechytá kliky;
// keď karta odíde (zatvorenie, posun), vráti sa. Trieda sa mení len pri zmene stavu.

import { trackedCardRect } from './cardActionBar.js';

export const CARD_CHROME_SELECTORS = Object.freeze(['#lang-switch', '#style-indicator']);
export const CARD_CHROME_CLASS = 'oko-under-card';

/** Prekrývajú sa dva obdĺžniky (x, y, w, h vs. DOMRect)? Pure. */
export function rectsOverlap(card, box) {
  if (!card || !box) return false;
  const left = Number(box.left ?? box.x);
  const top = Number(box.top ?? box.y);
  const width = Number(box.width ?? box.w);
  const height = Number(box.height ?? box.h);
  if (!(width > 0) || !(height > 0)) return false;
  return card.x < left + width && card.x + card.w > left && card.y < top + height && card.y + card.h > top;
}

/**
 * @param {object} viewer Cesium viewer (postRender)
 * @param {{doc?: Document, cardRect?: () => object|null}} [options] test seams
 */
export function installCardChromeFade(viewer, { doc = document, cardRect = trackedCardRect } = {}) {
  const state = new Map(); // element → je pod kartou

  function sync() {
    let card = null;
    try { card = cardRect(); } catch { card = null; }
    for (const selector of CARD_CHROME_SELECTORS) {
      const el = doc.getElementById?.(selector.slice(1)) || doc.querySelector?.(selector);
      if (!el) continue;
      // Čítanie rozloženia pred zápisom; zápis len pri zmene.
      const under = Boolean(card) && rectsOverlap(card, el.getBoundingClientRect?.());
      if (state.get(el) === under) continue;
      state.set(el, under);
      el.classList.toggle(CARD_CHROME_CLASS, under);
    }
  }

  const postRender = viewer?.scene?.postRender;
  postRender?.addEventListener?.(sync);
  sync();
  return {
    sync,
    destroy() {
      postRender?.removeEventListener?.(sync);
      for (const el of state.keys()) el.classList.remove(CARD_CHROME_CLASS);
      state.clear();
    },
  };
}
