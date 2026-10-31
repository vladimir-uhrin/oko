// src/conflictScenesLazy.js — lenivá brána scén konfliktov (src/conflictScenes.js).
//
// PREČO (2026-10-31, lenivý štart): úžiny, UKRAJINA, BLÍZKY VÝCHOD a kartičky konfliktov sú ~400 KB kódu
// a desiatky vrstiev, ktoré pri štarte nikto nevidí. Hlavný balík ich nenesie; modul sa dotiahne pri
// prvom podnete a potom sa správa ako doteraz (všetky window.__godsEyeView.* doplní sám).
//
// PODNETY: rozbalenie panela UKRAJINA alebo BLÍZKY VÝCHOD (klik, výsuv na mobile, obnova z odkazu či
// z uloženého stavu — sleduje sa trieda `collapsed`), výber v paneli Prelety kamerou, konflikt v hľadaní
// (run/frame), odkaz ?front= / ?chokepoint= / ?mideast= (platné id), telo stránky vlastníka
// (body.oko-owner — kartičky konfliktov). Kým sa modul sťahuje, telo panela ukazuje „Načítavam…".
import { chokepointSceneById } from './chokepointScenes.js';
import { frontSceneById } from './ukraineFrontScenes.js';
import { theatreById } from './data/mideastTheatres.js';
import { conflictById } from './data/conflictsCatalog.js';

/** Panely, ktorých rozbalenie modul dotiahne, a telá, kam ide stav „načítavam". */
export const CONFLICT_PANELS = Object.freeze([
  Object.freeze({ id: 'ukraine-panel', body: '[data-ukraine-body]' }),
  Object.freeze({ id: 'mideast-panel', body: '[data-mideast-body]' }),
]);

/**
 * Má sa modul dotiahnuť hneď po štarte kvôli odkazu? Len PLATNÉ id (preklep štart nezaťaží). Pure.
 * @param {string} search window.location.search
 */
export function urlWantsConflictScenes(search) {
  let params;
  try { params = new URLSearchParams(String(search || '')); } catch { return false; }
  return Boolean(frontSceneById(params.get('front') || '') || chokepointSceneById(params.get('chokepoint') || '') || theatreById(params.get('mideast') || ''));
}

/** Je panel rozbalený (nemá triedu collapsed)? Pure. */
export function panelExpanded(el) {
  return Boolean(el && !el.classList?.contains?.('collapsed'));
}

/**
 * @param {object} o
 * @param {() => object} o.getDeps závislosti pre initConflictScenes (čítajú sa až pri dotiahnutí)
 * @param {(key: string) => string} o.translate
 * @param {() => void} [o.onLoaded] po inicializácii (napr. premerať ľavý stĺpec)
 * @param {() => Promise<{initConflictScenes: Function}>} [o.importer] testy podstrčia modul
 * @param {Document} [o.doc]
 */
export function createConflictScenesGate({ getDeps, translate = (k) => k, onLoaded = null, importer = () => import('./conflictScenes.js'), doc = typeof document !== 'undefined' ? document : null }) {
  let loading = null;
  let api = null;
  const observers = [];
  const placeholders = [];

  const showLoading = () => {
    if (!doc?.querySelector) return;
    for (const panel of CONFLICT_PANELS) {
      const body = doc.querySelector(`#${panel.id} ${panel.body}`);
      if (!body || body.childElementCount > 0) continue;
      const status = doc.createElement('p');
      status.className = 'oko-lazy-status';
      status.dataset.state = 'loading';
      status.textContent = translate('lazy.loading');
      body.appendChild(status);
      placeholders.push(status);
    }
  };
  const clearLoading = () => { for (const el of placeholders.splice(0)) { try { el.remove(); } catch { /* už preč */ } } };

  const load = () => {
    if (api) return Promise.resolve(api);
    if (!loading) {
      showLoading();
      loading = importer().then((m) => {
        clearLoading();
        api = m.initConflictScenes(getDeps());
        for (const o of observers.splice(0)) { try { o.disconnect(); } catch { /* */ } }
        try { onLoaded?.(api); } catch (error) { console.warn('[conflicts] onLoaded', error); }
        return api;
      });
      loading.catch((error) => {
        loading = null;
        for (const el of placeholders) { el.dataset.state = 'error'; el.textContent = translate('lazy.error'); }
        placeholders.length = 0;
        console.warn('[conflicts] scény konfliktov sa nepodarilo dotiahnuť:', error?.message || error);
      });
    }
    return loading;
  };

  /** Spustí scénu podľa druhu ('front' | 'chokepoint' | 'mideast') — po dotiahnutí. */
  const run = (kind, id) => load().then((m) => {
    if (kind === 'front') return m.runFrontScene(id);
    if (kind === 'chokepoint') return m.runChokepointScene(id);
    if (kind === 'mideast') return m.runMideastTheatre(id);
    throw new Error(`unknown scene kind: ${kind}`);
  });
  /** Zarámuje konflikt z katalógu (hľadanie, kartičky). */
  const frame = (conflict) => load().then((m) => m.frameConflict(typeof conflict === 'string' ? conflictById(conflict) : conflict));

  /**
   * Zapojí podnety: panely, vlastník, odkaz. Volá sa raz po vzniku glóbusu a panelov.
   * @param {{search?: string}} [o]
   */
  const install = ({ search = '' } = {}) => {
    if (!doc) return;
    const MO = typeof MutationObserver === 'function' ? MutationObserver : null;
    for (const panel of CONFLICT_PANELS) {
      const el = doc.getElementById?.(panel.id);
      if (!el) continue;
      if (panelExpanded(el)) { void load(); continue; }
      if (!MO) continue;
      const o = new MO(() => { if (panelExpanded(el)) void load(); });
      o.observe(el, { attributes: true, attributeFilter: ['class'] });
      observers.push(o);
    }
    const body = doc.body;
    const ownerCheck = () => { if (body?.classList?.contains?.('oko-owner')) void load(); };
    ownerCheck();
    if (MO && body && !api) {
      const o = new MO(ownerCheck);
      o.observe(body, { attributes: true, attributeFilter: ['class'] });
      observers.push(o);
    }
    if (urlWantsConflictScenes(search)) void load();
  };

  return {
    load, run, frame, install,
    get loaded() { return api !== null; },
    get api() { return api; },
  };
}
