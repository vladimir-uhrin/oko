// src/data/meteoLazy.js — lenivý zástupca meteo vrstvy.
//
// PREČO: obmedzenie zadania hovorí, že OKO nesmie načítať weather kód ani dáta,
// kým sa vrstva neotvorí. `meteoLayer.js` sa však INŠTANCIUJE už pri importe
// (`export default createMeteoLayer()`), takže statický import v main.js ťahal
// pri každom štarte 6 modulov: meteoField, meteoIsolines, meteoLayer,
// meteoPlaces, meteoTimeline, windParticles. Namerané `scripts/check-lazy.js`.
//
// AKO: správca číta metadáta (id/name/icon) hneď pri registrácii, aby vrstvu
// vedel ukázať v zozname — tie teda musí zástupca niesť sám. Skutočný modul sa
// dotiahne dynamickým importom až v `init()`, ktorý správca AWAITUJE a volá
// tesne pred `enable()`. Po dotiahnutí sa všetko deleguje.
//
// Metadáta sú tu zámerne zopakované (nie importované z meteoLayer.js — ten by
// sa tým načítal a účel by padol). Proti rozídeniu stráži meteoLazy.test.mjs,
// ktorý ich porovná so skutočnou vrstvou.

/** Musí sa zhodovať s `layer` v meteoLayer.js — stráži test. */
export const METEO_LAZY_META = Object.freeze({
  id: 'meteo-gfs',
  name: 'Meteorológia · vietor a teplota (GFS)',
  icon: '≋',
  updateInterval: 30 * 60 * 1000,
});

/** Predvolené parametre pred dotiahnutím — zhodné s `_field`/`_particlesOn`. */
export const METEO_LAZY_PARAMS = Object.freeze({ field: 'wind', particles: true });

let _real = null;
let _loading = null;
let _rowListener = null;

/** Dotiahne skutočnú vrstvu (raz). Exportované kvôli testu. */
export async function loadMeteoLayer() {
  if (_real) return _real;
  if (!_loading) _loading = import('./meteoLayer.js').then((m) => { _real = m.default; return _real; });
  return _loading;
}

/** Je skutočná vrstva už načítaná? Pure. */
export function isMeteoLoaded() { return _real !== null; }

/** Len pre testy — zabudne dotiahnutý modul. */
export function _resetMeteoLazyForTest() { _real = null; _loading = null; _rowListener = null; }

const layer = {
  ...METEO_LAZY_META,

  // Pred dotiahnutím nevymýšľame beh ani model — povieme len, čo je isté.
  get source() {
    return _real ? _real.source : 'NOAA/NCEP GFS 0,25° · NSF Unidata THREDDS';
  },

  async init(viewer, options) {
    const real = await loadMeteoLayer();
    if (_rowListener) real.setRowControlsListener?.(_rowListener);
    return real.init?.(viewer, options);
  },

  enable(viewer, options) { return _real?.enable(viewer, options); },
  disable(viewer, options) { return _real?.disable(viewer, options); },
  update(viewer, options) { return _real?.update?.(viewer, options); },

  destroy(viewer) {
    const out = _real?.destroy?.(viewer);
    _real = null;
    _loading = null;
    return out;
  },

  setParams(params) { return _real?.setParams?.(params); },
  getParams() { return _real ? _real.getParams() : { ...METEO_LAZY_PARAMS }; },

  // Poslucháč môže prísť pred dotiahnutím — podržíme ho a odovzdáme v init().
  setRowControlsListener(fn) {
    _rowListener = typeof fn === 'function' ? fn : null;
    _real?.setRowControlsListener?.(_rowListener);
  },

  // Čipy patria aktívnej vrstve; kým nie je načítaná, niet čo ponúkať — ale
  // TVAR musí sedieť ({chips, legend}), inak UI spadne na .chips z prázdneho
  // poľa. Prázdne pole tu bola chyba, ktorú odhalilo až volanie z prehliadača.
  getRowControls() { return _real ? _real.getRowControls() : { chips: [], legend: [] }; },

  getStats() {
    return _real ? _real.getStats() : { count: 0, loading: false, error: null };
  },
};

export default layer;
