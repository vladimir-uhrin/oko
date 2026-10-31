// src/scenes/directorLazy.js — réžia scén až keď ju niekto potrebuje.
//
// PREČO (2026-10-31, lenivý štart): SceneDirector (scenes/director.js, ~25 KB) je nástroj vlastníka
// (panel Prelety kamerou, .oko-owner-only) a nástroj hlasu (sceneDirector pre akcie). Návštevník ho
// nikdy nespustí — hlavný balík ho nenesie. Dotiahne sa, keď sa telo stránky stane vlastníkovým
// (body.oko-owner — main.js) alebo keď sa dotiahne hlas (voiceLazy.js); obaja dostanú tú istú inštanciu.
let _loading = null;
let _director = null;

/** Len pre testy. */
export function _resetSceneDirectorForTest() { _loading = null; _director = null; }

/** Už postavená réžia (alebo null). Pure. */
export function sceneDirectorIfLoaded() { return _director; }

/**
 * Dotiahne modul a postaví SceneDirector(viewer, styleManager, dataManager) — raz.
 * @param {{viewer: object, styleManager: object, dataManager: object}} ctx
 * @param {{importer?: () => Promise<{SceneDirector: Function}>}} [o]
 */
export function loadSceneDirector(ctx, { importer = () => import('./director.js') } = {}) {
  if (_director) return Promise.resolve(_director);
  if (!_loading) {
    _loading = importer().then((m) => {
      _director = new m.SceneDirector(ctx.viewer, ctx.styleManager, ctx.dataManager);
      if (typeof window !== 'undefined' && window.__godsEyeView) window.__godsEyeView.sceneDirector = _director;
      return _director;
    });
    _loading.catch(() => { _loading = null; });
  }
  return _loading;
}
