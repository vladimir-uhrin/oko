// src/voice/voiceLazy.js — lenivý zástupca hlasového ovládania.
//
// PREČO (2026-10-31, lenivý štart): hlas (OpenAI Realtime + akcie + bezplatný hlas + anotácie
// + réžia scén) je ~200 KB kódu, ktorý na štarte nikto nepotrebuje — mikrofón sa stlačí zriedka
// a hlas je len pre prihlásených. Hlavný balík ho preto nenesie; stiahne sa pri prvom stlačení
// mikrofónu alebo medzerníka (push-to-talk) a potom sa správa presne ako doteraz.
//
// AKO: pilulka v doku (voiceControl.js) stojí od štartu — rovnaký DOM, rovnaký vzhľad (bezplatný
// motor má inú nápovedu a cenu „zadarmo"). Prvé stlačenie prepne stav na „načítavam", dotiahne
// gevRealtime.js (+ anotácie, réžiu scén), odovzdá bránu prihlásenia a zdroje hľadania, ktoré
// medzitým prišli z main.js, a stlačenie dokončí (klik → buttonHandler, držaný medzerník →
// shortcutKeyDownHandler, ak je kláves ešte stlačený). Skutočný init pilulku znovu postaví
// (reset: true), takže poslucháče zástupcu odchádzajú s jej starým DOM-om.
import { t } from '../i18n.js';
import { applyFreeVoiceUi, createVoiceControl, shouldHandlePushToTalkKeyDown, voiceEngine } from './voiceControl.js';

/** Stav zástupcu počas sťahovania — CSS `#gev-voice-control[data-status='loading']`. */
export const VOICE_LOADING_STATUS = 'loading';

let _gate = null;
let _resolvers = null;
let _loading = null;
let _controller = null;

/** Len pre testy. */
export function _resetVoiceLazyForTest() { _gate = null; _resolvers = null; _loading = null; _controller = null; }

/**
 * Brána prístupu k hlasu — rovnaký podpis ako v gevRealtime.js. Pred dotiahnutím sa len podrží,
 * po ňom sa odovzdá skutočnému modulu (a každá ďalšia zmena ide rovno doň).
 */
export function setVoiceAccessGate(gate) {
  _gate = typeof gate === 'function' ? gate : null;
  if (_controller) void _loading.then((m) => m.realtime.setVoiceAccessGate(_gate));
}

/** Je hlasový modul už dotiahnutý? Pure. */
export function isVoiceLoaded() { return _controller !== null; }

/**
 * Dotiahne hlas (raz) a spustí ho so závislosťami z `getContext()`:
 * { viewer, styleManager, dataManager, tileset, sceneDirector? }. Réžia scén sa znovu nepostaví,
 * ak ju už má vlastník (scenes/directorLazy.js); anotácie vznikajú tu, hlas je ich jediný spotrebiteľ.
 * @returns {Promise<object>} skutočný GevRealtimeController
 */
export function loadVoice(getContext, { importers = defaultImporters } = {}) {
  if (_loading) return _loading.then((m) => m.controller);
  _loading = (async () => {
    const [realtime, annotationsMod, directorMod] = await Promise.all([
      importers.realtime(), importers.annotations(), importers.director(),
    ]);
    const ctx = getContext() || {};
    const annotations = annotationsMod.initAnnotations({ viewer: ctx.viewer, tileset: ctx.tileset ?? null });
    const sceneDirector = ctx.sceneDirector || (await directorMod.loadSceneDirector(ctx));
    realtime.setVoiceAccessGate(_gate);
    const controller = realtime.initGevVoiceCommands({
      viewer: ctx.viewer, styleManager: ctx.styleManager, dataManager: ctx.dataManager, sceneDirector, annotations,
    });
    if (_resolvers) controller.freeVoice?.setResolvers?.(_resolvers);
    _controller = controller;
    const gev = typeof window !== 'undefined' ? window.__godsEyeView : null;
    if (gev) { gev.voiceCommands = controller; gev.annotations = annotations; gev.sceneDirector = sceneDirector; }
    return { realtime, controller, annotations, sceneDirector };
  })();
  _loading.catch(() => { _loading = null; }); // chyba siete: ďalšie stlačenie skúsi znova
  return _loading.then((m) => m.controller);
}

const defaultImporters = {
  realtime: () => import('./gevRealtime.js'),
  annotations: () => import('../annotations/index.js'),
  director: () => import('../scenes/directorLazy.js'),
};

/**
 * Postaví pilulku a zástupcu `voiceCommands` pre window.__godsEyeView. Zástupca nesie to, čo
 * main.js a QA skripty volajú pred dotiahnutím: `freeVoice.setResolvers`, `setStatus` (dotiahne
 * a odovzdá), `status` ('idle'), `load()`.
 * @param {() => object} getContext závislosti pre loadVoice (čítajú sa až pri dotiahnutí)
 * @param {{win?: Window, importers?: object, control?: () => object}} [o] testy podstrčia pilulku a importéry
 */
export function installLazyVoice(getContext, { win = window, importers, control = createVoiceControl } = {}) {
  const ui = control();
  if (voiceEngine() === 'free') applyFreeVoiceUi(ui, t);
  let spaceHeld = false;
  let disposed = false;

  const setLoading = () => {
    if (!ui.root?.dataset) return;
    ui.root.dataset.status = VOICE_LOADING_STATUS;
    if (ui.status) ui.status.textContent = t('voice.status.loading');
  };
  const setFailed = (error) => {
    if (!ui.root?.dataset) return;
    ui.root.dataset.status = 'error';
    if (ui.status) ui.status.textContent = t('voice.status.error');
    if (ui.errorDetail) ui.errorDetail.textContent = String(error?.message || error || '');
  };
  const load = () => {
    if (!_loading) setLoading();
    return loadVoice(getContext, importers ? { importers } : undefined);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    win.removeEventListener?.('keydown', onKeyDown, true);
    win.removeEventListener?.('keyup', onKeyUp, true);
  };
  const onClick = () => {
    load().then((controller) => { dispose(); controller.buttonHandler?.(); }, setFailed);
  };
  const onKeyDown = (event) => {
    if (!shouldHandlePushToTalkKeyDown(event)) return;
    event.preventDefault();
    if (spaceHeld) return;
    spaceHeld = true;
    load().then((controller) => {
      dispose();
      // Kláves je ešte stlačený → skutočný handler začne push-to-talk; pustený → nič (prvé stlačenie len načítalo).
      if (spaceHeld) controller.shortcutKeyDownHandler?.(event);
    }, setFailed);
  };
  const onKeyUp = (event) => { if (event?.code === 'Space' || event?.key === ' ') spaceHeld = false; };
  ui.button?.addEventListener('click', onClick);
  win.addEventListener?.('keydown', onKeyDown, true);
  win.addEventListener?.('keyup', onKeyUp, true);

  const stub = {
    lazy: true,
    get status() { return _controller ? _controller.status : 'idle'; },
    get freeVoice() {
      return _controller?.freeVoice || { setResolvers(next) { _resolvers = { ..._resolvers, ...(next || {}) }; } };
    },
    setStatus(...args) { return load().then((c) => c.setStatus(...args)); },
    load,
    isLoaded: () => _controller !== null,
    ui,
    _dispose: dispose,
  };
  return stub;
}
