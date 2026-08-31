import { EN_STRINGS, SK_STRINGS } from './i18nStrings.js';

/**
 * @module i18n
 * @description Dvojjazyčné UI (SK/EN) pre OKO — bez frameworku, v duchu repa.
 *
 * Architektúra (zámerné rozhodnutia, nedriftovať):
 *  - Rozlíšenie jazyka: localStorage override → navigator.language sk* → 'en'.
 *    V Node (testy) nie je window ani navigator → VŽDY 'en', takže pinované
 *    testy anglických reťazcov ostávajú platné bez ohľadu na stroj.
 *  - `t()` failuje OTVORENE na kľúč: chýbajúci preklad sa v UI ukáže ako
 *    surový kľúč ('panel.data-layers') — viditeľný marker, nie tichá diera.
 *    Paritu slovníkov (rovnaké množiny kľúčov EN/SK) vynucuje i18n.test.mjs.
 *  - Prepnutie jazyka = persist + reload: dynamické panely sa skladajú raz
 *    pri boote z literálov cez t(); stav pohľadu prežije v share-hashi,
 *    takže reload je lacný a poctivý — žiadne live re-render potrubie.
 *  - Statické HTML sa značkuje data-i18n / data-i18n-title a prekladá
 *    applyDomTranslations() pri boote (EN texty v HTML sú zdroj pravdy
 *    a zároveň fallback).
 *
 * MIMO lokalizácie (zámerne): GEV_REALTIME_TOOLS a všetky voice inštrukcie
 * (hovoria modelu, sú pinované sha256), licenčné/atribučné texty (právne
 * znenie), letecké/námorné jednotky a kódy (FL, kts, ETA, SQUAWK, MMSI…),
 * vlastné mená produktov a dátové hodnoty z feedov.
 */

export const LANG_STORAGE_KEY = 'oko-lang';
export const SUPPORTED_LANGS = Object.freeze(['en', 'sk']);

const DICTS = Object.freeze({ en: EN_STRINGS, sk: SK_STRINGS });

/** @type {?string} cache — jazyk sa počas života stránky nemení (reload). */
let _lang = null;

function readStoredLang() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(LANG_STORAGE_KEY);
    return SUPPORTED_LANGS.includes(raw) ? raw : null;
  } catch {
    return null; // privátne okno / zablokované úložisko — fail open na detekciu
  }
}

/**
 * Aktuálny jazyk UI podľa precedencie storage → navigator → 'en'.
 * @returns {'en'|'sk'}
 */
export function currentLanguage() {
  if (_lang) return _lang;
  const stored = readStoredLang();
  if (stored) {
    _lang = stored;
  } else if (typeof navigator !== 'undefined' && /^sk\b/i.test(String(navigator.language || ''))) {
    _lang = 'sk';
  } else {
    _lang = 'en';
  }
  return _lang;
}

/** TEST ONLY — resetne cache rozlíšenia jazyka medzi testami. */
export function _resetLanguageForTest() {
  _lang = null;
}

/**
 * Preloží kľúč v aktuálnom jazyku; `{meno}` placeholdery sa dosadia z `vars`.
 * Fallback reťaz: aktuálny jazyk → EN → surový kľúč (viditeľný marker).
 * @param {string} key
 * @param {Object<string, string|number>} [vars]
 * @returns {string}
 */
export function t(key, vars) {
  const lang = currentLanguage();
  let text = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

/**
 * Nastaví jazyk (persist) a defaultne reloadne stránku — stav pohľadu prežije
 * v share-hashi. `reload:false` len pre testy/programové použitie.
 * @param {'en'|'sk'} lang
 * @param {{reload?: boolean}} [options]
 * @returns {boolean} či bol jazyk platný a nastavený
 */
export function setLanguage(lang, { reload = true } = {}) {
  if (!SUPPORTED_LANGS.includes(lang)) return false;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch { /* best-effort — bez úložiska platí voľba len do reloadu */ }
  _lang = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  if (reload && typeof window !== 'undefined') window.location.reload();
  return true;
}

/**
 * Preloží staticky označené uzly: [data-i18n] → textContent,
 * [data-i18n-title] → title + aria-label (ak aria-label existoval),
 * [data-i18n-aria] → iba aria-label (prvky bez tooltipů — regióny, vstupy),
 * [data-i18n-placeholder] → placeholder (textové vstupy).
 * Volá sa raz pri boote; v EN je no-op nad anglickým HTML.
 * @param {ParentNode} [root]
 */
export function applyDomTranslations(root = typeof document !== 'undefined' ? document : null) {
  if (!root) return;
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.getAttribute('data-i18n'));
  }
  for (const el of root.querySelectorAll('[data-i18n-title]')) {
    const text = t(el.getAttribute('data-i18n-title'));
    el.setAttribute('title', text);
    if (el.hasAttribute('aria-label')) el.setAttribute('aria-label', text);
  }
  for (const el of root.querySelectorAll('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
  }
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
  }
  if (root === (typeof document !== 'undefined' ? document : null)) {
    document.documentElement.lang = currentLanguage();
  }
}
