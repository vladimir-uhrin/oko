// src/conflictExport.js
/**
 * @module conflictExport
 * @description Jadro exportu zdieľacích kartičiek naprieč konfliktmi (propagácia,
 * krok 1 — A aj B). Skladá model kartičky (Ukrajina zo živého KARTA prekryvu,
 * ostatné z katalógu), zachytí aktuálny pohľad plátna a zapečie doň rám
 * (titulok/legenda/prehľadová mapka) cez `drawKartaExport`, v troch pomeroch pre
 * FB feed / štvorec / story. Stiahnutie súboru je oddelené.
 */
import { buildConflictCardModel } from './data/conflictsCatalog.js';
import { captureShareSnapshot, snapshotStamp } from './shareSnapshot.js';
import { buildAttributionLine } from './shareTargets.js';
import { drawKartaExport } from './ukraineKartaOverlay.js';

/** Pomery kartičiek pre siete: feed (na šírku), štvorec, story (9:16). */
export const CARD_RATIOS = Object.freeze({
  feed: Object.freeze({ id: 'feed', w: 1200, h: 630 }),
  square: Object.freeze({ id: 'square', w: 1080, h: 1080 }),
  story: Object.freeze({ id: 'story', w: 1080, h: 1920 }),
});
export const CARD_RATIO_IDS = Object.freeze(['feed', 'square', 'story']);
export function cardRatio(id) { return CARD_RATIOS[id] || CARD_RATIOS.feed; }

/** Zdroje/legenda podľa druhu konfliktu (Ukrajinu dodá KARTA prekryv). Pure. */
export function defaultConflictFacts(conflict) {
  if (!conflict) return { sources: [], legend: [], legendHead: '' };
  if (conflict.kind === 'chokepoint') {
    return { sources: ['Global Fishing Watch', 'Sentinel-1', 'OpenStreetMap', 'Yahoo Finance'], legend: [], legendHead: '' };
  }
  if (conflict.kind === 'situation') {
    return { sources: ['GDELT', 'BBC', 'Al Jazeera', 'Google News'], legend: [], legendHead: '' };
  }
  return { sources: [], legend: [], legendHead: '' };
}

/**
 * Model kartičky: Ukrajinský smer berie zo živého KARTA prekryvu (má strany,
 * blesky, legendu), ostatné z katalógu. Pure (dispatch).
 */
export function conflictCardModel(conflict, { kartaOverlay = null, viewRect = null, dateText = '', sources = [], legend = [], legendHead = '', translate = (k) => k } = {}) {
  if (conflict && conflict.kind === 'ukraine-front' && kartaOverlay && typeof kartaOverlay.getModel === 'function') {
    return kartaOverlay.getModel();
  }
  return buildConflictCardModel(conflict, { viewRect, dateText, sources, legend, legendHead, translate });
}

/** Názov súboru snímky konfliktu. Pure. */
export function conflictCardFilename(conflict, ratio = 'feed', dateIso = '') {
  const id = String(conflict?.id || 'conflict').replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-');
  const day = String(dateIso || '').slice(0, 10);
  return `oko-${id}-${ratio}${day ? `-${day}` : ''}.jpg`;
}

/**
 * Zachytí kartičku: aktuálny pohľad plátna + rám cez decorate, v danom pomere.
 * Vráti snap z `captureShareSnapshot` (jpegDataUrl…), alebo null.
 */
export async function captureConflictCard({ viewer, model, ratio = 'feed', lang = 'sk', whenMs = Date.now(), creditsText = '', document: doc = globalThis.document } = {}) {
  const r = cardRatio(ratio);
  return captureShareSnapshot({
    viewer, document: doc, width: r.w, height: r.h,
    stamp: snapshotStamp(whenMs, lang),
    attribution: buildAttributionLine(creditsText),
    decorate: (ctx, w, h) => drawKartaExport(ctx, model, w, h),
  });
}

/** Stiahne snímku do súboru. */
export function downloadCardSnapshot(snap, filename, doc = globalThis.document) {
  if (!snap?.jpegDataUrl || !doc?.createElement) return false;
  const a = doc.createElement('a');
  a.href = snap.jpegDataUrl;
  a.download = filename;
  doc.body.appendChild(a); a.click(); a.remove();
  return true;
}
