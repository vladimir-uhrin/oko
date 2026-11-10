// src/dialogFocus.js — spoločné správanie fokusu pre okná nad mapou (2026-11-10, audit UI — krok 2).
//
// Audit našiel 7 implementácií dialógov; paleta, okno zdieľania a výsuv telefónu po zavretí fokus nevracali
// tam, odkiaľ sa otvorili (klávesnica ostala „nikde"), a Escape z palety prebublal k poslucháčom za ňou
// (zrušenie sledovania letu, zavretie výsuvu). Tieto tri funkcie sú čisté — žiadne poslucháče, žiadne uzly —
// a znesú aj falošný DOM z testov. Súhlas, účet, ponuka Viac a uvítanie majú vlastné riešenie a nemenia sa.

const SKIP_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Prvok, ktorý mal fokus pred otvorením okna — alebo null, keď by návrat fokusu škodil
 * (pole na písanie by na telefóne znova vytiahlo klávesnicu; body nie je cieľ).
 * @param {Document} doc
 * @returns {HTMLElement|null}
 */
export function rememberOpener(doc) {
  const el = doc?.activeElement;
  if (!el || typeof el.focus !== 'function') return null;
  if (el === doc.body || el === doc.documentElement) return null;
  if (SKIP_TAGS.has(el.tagName) || el.isContentEditable) return null;
  return el;
}

/**
 * Vráti fokus; ticho, keď prvok medzitým zmizol.
 * @param {HTMLElement|null} el
 * @returns {boolean} true, keď sa fokus vrátil
 */
export function restoreOpener(el) {
  if (!el || el.isConnected === false || typeof el.focus !== 'function') return false;
  try { el.focus({ preventScroll: true }); return true; } catch { return false; }
}

/** Escape patrí najvrchnejšiemu oknu: nepustiť ho k poslucháčom za ním. */
export function claimEscape(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
}
