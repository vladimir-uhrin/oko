// src/hudSummaryPolicy.js
// Kedy má HUD prestať pýtať AI súhrn (2026-09-14, verejná adresa: konzola
// plná `POST /api/openai/hud-summary 503` každých 15 s, lebo na serveri nie je
// kľúč OpenAI). Čistá funkcia bez DOM — HUD ju volá po neúspešnej odpovedi.
//
// 'disabled' = trvalý stav servera (kľúč chýba, alebo je súhrn na tejto adrese
//              zakázaný) → do konca relácie už nepýtať, ukázať lokálny súhrn.
// 'retry'    = prechodná chyba (502 z tunela, preťažený model, sieť, timeout)
//              → ďalší tik to skúsi znova ako doteraz.

/** Text chyby, ktorý proxy vracia, keď nie je nastavený OPENAI_API_KEY. */
export const SUMMARY_UNCONFIGURED_RE = /OPENAI_API_KEY is not set|not configured/i;

/**
 * @param {{ status?: number|null, error?: unknown }} failure HTTP stav a telo chyby (`data.error`)
 * @returns {'disabled'|'retry'}
 */
export function classifySummaryFailure({ status = null, error = null } = {}) {
  const text = typeof error === 'string'
    ? error
    : (error && typeof error === 'object' && 'message' in error ? String(error.message ?? '') : '');
  if (status === 503 && SUMMARY_UNCONFIGURED_RE.test(text)) return 'disabled';
  if (status === 403 || status === 401) return 'disabled';
  // Denný strop OpenAI na serveri (429 {error:'budget'}, 2026-10-03): do
  // polnoci UTC sa nič nezmení — netĺcť každých 15 s, ostať pri lokálnom súhrne.
  if (status === 429 && text === 'budget') return 'disabled';
  return 'retry';
}
