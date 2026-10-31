// src/lazyPanel.js — panel ľavého stĺpca, ktorého kód príde až pri prvom rozbalení.
//
// PREČO (2026-10-31, lenivý štart): História letov, VOĽBY a PLYN sú panely, ktoré návštevník otvára
// zriedka, no ich kód (~120 KB spolu) išiel v hlavnom balíku. Hlavička panela (pilulka) je v index.html,
// telo si panel stavia sám pri inštalácii — stačí teda inštaláciu odložiť, kým panel nie je rozbalený
// (klik, výsuv na mobile, obnova z odkazu alebo uloženého stavu — sleduje sa trieda `collapsed`), alebo
// kým ho niekto nezavolá cez fasádu (odkaz `event=`, karta lietadla, mapa obcí…). Kým sa modul sťahuje,
// telo panela nesie riadok „Načítavam…" (.oko-lazy-status, rovnaký ako pri scénach konfliktov).
import { t } from './i18n.js';

/** Je panel rozbalený (nemá triedu collapsed)? Pure. */
export function panelExpanded(el) {
  return Boolean(el && !el.classList?.contains?.('collapsed'));
}

/**
 * @param {object} o
 * @param {string} o.panelId id panela v index.html (napr. 'history-panel')
 * @param {string} o.bodySelector telo panela, kam ide stav „načítavam" (napr. '[data-history-body]')
 * @param {() => Promise<any>} o.install dotiahne modul a panel nainštaluje; vráti jeho API
 * @param {(key: string) => string} [o.translate]
 * @param {Document|null} [o.doc]
 * @returns {{load: () => Promise<any>, install: () => void, loaded: boolean, value: any}}
 */
export function createLazyPanel({ panelId, bodySelector, install, translate = t, doc = typeof document !== 'undefined' ? document : null }) {
  let loading = null;
  let value = null;
  let observer = null;
  let placeholder = null;

  const showLoading = () => {
    const body = doc?.querySelector?.(`#${panelId} ${bodySelector}`);
    if (!body || body.childElementCount > 0) return;
    placeholder = doc.createElement('p');
    placeholder.className = 'oko-lazy-status';
    placeholder.dataset.state = 'loading';
    placeholder.textContent = translate('lazy.loading');
    body.appendChild(placeholder);
  };
  const clearLoading = () => { try { placeholder?.remove(); } catch { /* už preč */ } placeholder = null; };

  const load = () => {
    if (value) return Promise.resolve(value);
    if (!loading) {
      showLoading();
      loading = Promise.resolve().then(install).then((api) => {
        clearLoading();
        value = api ?? {};
        try { observer?.disconnect(); } catch { /* */ }
        observer = null;
        return value;
      });
      loading.catch((error) => {
        loading = null;
        if (placeholder) { placeholder.dataset.state = 'error'; placeholder.textContent = translate('lazy.error'); placeholder = null; }
        console.warn(`[lazy] ${panelId}: modul sa nepodarilo dotiahnuť:`, error?.message || error);
      });
    }
    return loading;
  };

  /** Sleduje rozbalenie panela; už rozbalený panel dotiahne hneď. */
  const installTrigger = () => {
    const el = doc?.getElementById?.(panelId);
    if (!el || value) return;
    if (panelExpanded(el)) { void load(); return; }
    if (typeof MutationObserver !== 'function') return;
    observer = new MutationObserver(() => { if (panelExpanded(el)) void load(); });
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
  };

  return {
    load,
    install: installTrigger,
    get loaded() { return value !== null; },
    get value() { return value; },
  };
}

/**
 * Fasáda metódy panela: dotiahne modul a volanie odovzdá (výsledok ako Promise).
 * @param {{load: () => Promise<any>}} lazy
 * @param {string} method
 * @param {(api: any) => any} [pick] keď panel API nie je priamo výsledok install (napr. { history, ship })
 */
export function lazyMethod(lazy, method, pick = (api) => api) {
  return (...args) => lazy.load().then((api) => pick(api)?.[method]?.(...args));
}
