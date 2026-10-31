// src/data/lazyLayer.js — všeobecný lenivý zástupca dátovej vrstvy.
//
// PREČO (2026-10-31, lenivý štart): väčšina vrstiev je pri štarte vypnutá (zapína ich používateľ vo
// VRSTVY, odkaz alebo scéna), no ich kód — zemetrasenia, sopky, SHMÚ, OPERA, plyn, GFW, AISHub, voľby,
// lokálne datasety, požiare — išiel v hlavnom balíku (~230 KB). Zástupca nesie len to, čo správca
// číta pri registrácii (id, name, icon, source, intervaly) a zmluvu modulu; skutočný modul sa dotiahne
// dynamickým importom až v `init()`, ktorý správca awaituje tesne pred `enable()`. Vzor: meteoLazy.js.
//
// PRED dotiahnutím: životný cyklus nič nerobí, čítacie metódy vracajú prázdne hodnoty v správnom TVARE
// (getRowControls {chips, legend}, getStats {count…}), nastavovacie volania (setParams, poslucháč čipov,
// setDarkOnly, select, setColorMode…) sa podržia a po dotiahnutí sa odovzdajú v poradí, v akom prišli.
// PO dotiahnutí sa všetko deleguje. Metadáta sú v lazyLayers.js zopakované zámerne (import skutočného
// modulu by lenivosť zrušil) — proti rozídeniu stráži lazyLayers.test.mjs, ktorý ich porovná so
// skutočnými modulmi.

const LIFECYCLE = new Set(['init', 'enable', 'disable', 'update', 'destroy']);
const SPECIAL = new Set(['getStats', 'getParams', 'setParams', 'getRowControls', 'setRowControlsListener']);

/** Prázdne hodnoty v tvare, aký volajúci čakajú, kým modul nie je dotiahnutý. */
export const LAZY_DEFAULTS = Object.freeze({
  getAllPositions: () => [],
  getDetectableObjects: () => [],
  getAnalystRecords: () => [],
  getNearby: () => [],
  getContactSummary: () => null,
  getSelectedMmsi: () => null,
  getSelectedName: () => null,
  getSelectedInfo: () => null,
  getSelectedKey: () => null,
  getStrongestFire: () => null,
  getStatus: () => ({ state: 'idle' }),
  hasContact: () => false,
  countInRect: () => 0,
  isLoaded: () => false,
  isUpdating: () => false,
  selectById: () => false,
  selectContact: () => false,
  selectStation: () => false,
  selectStationByRowId: () => false,
  selectPipeline: () => false,
  prefetchContactDetails: () => undefined,
  clearSelection: () => undefined,
});

/**
 * @param {object} o
 * @param {{id: string, name: string, icon: string, source?: string, updateInterval: number,
 *   statsRefreshInterval?: number, showInTogglePanel?: boolean}} o.meta metadáta (zhodné s modulom)
 * @param {() => Promise<object>} o.load dotiahne skutočný modul (vrstvu)
 * @param {string[]} o.contract verejné metódy skutočného modulu (bez `_`); zástupca ich nesie všetky
 * @param {object|null} [o.params] predvolené getParams() modulu pred init (null = modul nemá parametre)
 * @param {{chips: object[], legend: object[]}|null} [o.rowControls] getRowControls() modulu pred init
 * @param {string[]} [o.replay] nastavovacie metódy, ktoré sa pred dotiahnutím podržia a potom odovzdajú
 * @param {Record<string, (pending: object) => any>} [o.defaults] čítacie metódy, ktorých hodnota pred
 *   dotiahnutím závisí od podržaných volaní (isDarkOnly ← setDarkOnly, getColorMode ← setColorMode)
 * @param {string[]} [o.props] zapisovateľné vlastnosti modulu (onSelect) — podržia sa a odovzdajú
 * @param {string[]} [o.awaitLoad] asynchrónne metódy, ktoré modul najprv dotiahnu a potom odovzdajú
 *   (resolveTrackingRestoreTarget — obnova sledovania z odkazu musí dostať skutočnú odpoveď)
 */
export function createLazyLayer({ meta, load, contract, params = null, rowControls = null, replay = [], defaults = {}, props = [], awaitLoad = [] }) {
  let real = null;
  let loading = null;
  let rowListener = null;
  let pendingParams = null;
  const pendingCalls = []; // [name, args] v poradí
  const pendingProps = {};
  const replaySet = new Set(replay);
  const awaitSet = new Set(awaitLoad);

  const ensure = async () => {
    if (real) return real;
    if (!loading) {
      loading = Promise.resolve(load()).then((module) => {
        if (!module || typeof module !== 'object') throw new Error(`${meta.id}: lazy loader returned no layer module`);
        real = module;
        for (const key of Object.keys(pendingProps)) { try { real[key] = pendingProps[key]; } catch { /* modul bez tejto vlastnosti */ } }
        if (pendingParams && typeof real.setParams === 'function') real.setParams({ ...pendingParams });
        if (rowListener && typeof real.setRowControlsListener === 'function') real.setRowControlsListener(rowListener);
        for (const [name, args] of pendingCalls.splice(0)) { try { real[name]?.(...args); } catch (error) { console.warn(`[lazy] ${meta.id}.${name} replay:`, error); } }
        return real;
      });
      loading.catch(() => { loading = null; }); // ďalší init skúsi znova (sieť)
    }
    return loading;
  };

  const layer = {
    ...meta,
    async init(viewer, options) {
      const module = await ensure();
      return module.init?.(viewer, options);
    },
    enable(viewer, options) { return real?.enable?.(viewer, options); },
    disable(viewer, options) { return real?.disable?.(viewer, options); },
    update(viewer, options) { return real?.update?.(viewer, options); },
    destroy(viewer) {
      const out = real?.destroy?.(viewer);
      real = null;
      loading = null;
      return out;
    },
  };
  const has = (name) => contract.includes(name);
  if (has('getStats')) {
    layer.getStats = () => (real ? real.getStats() : { count: 0, lastUpdate: null, loading: false, error: null });
  }
  if (has('getParams')) {
    layer.getParams = () => (real ? real.getParams() : { ...(params || {}), ...(pendingParams || {}) });
  }
  if (has('setParams')) {
    layer.setParams = (next, options) => {
      if (real) return real.setParams(next, options);
      pendingParams = { ...(pendingParams || {}), ...(next || {}) };
      return true;
    };
  }
  if (has('getRowControls')) {
    layer.getRowControls = () => (real ? real.getRowControls() : (rowControls ? structuredClone(rowControls) : { chips: [], legend: [] }));
  }
  if (has('setRowControlsListener')) {
    layer.setRowControlsListener = (fn) => {
      rowListener = typeof fn === 'function' ? fn : null;
      real?.setRowControlsListener?.(rowListener);
    };
  }
  for (const name of contract) {
    if (LIFECYCLE.has(name) || SPECIAL.has(name) || name in layer) continue;
    if (awaitSet.has(name)) {
      layer[name] = async (...args) => { const module = await ensure(); return module[name]?.(...args); };
    } else if (replaySet.has(name)) {
      layer[name] = (...args) => {
        if (real) return real[name]?.(...args);
        pendingCalls.push([name, args]);
        return undefined;
      };
    } else {
      const fallback = defaults[name] || LAZY_DEFAULTS[name] || (() => undefined);
      layer[name] = (...args) => (real ? real[name]?.(...args) : fallback(pendingState(), ...args));
    }
  }
  function pendingState() {
    const out = { params: pendingParams };
    for (const [name, args] of pendingCalls) out[name] = args;
    return out;
  }
  for (const key of props) {
    Object.defineProperty(layer, key, {
      enumerable: true,
      get() { return real ? real[key] : (pendingProps[key] ?? null); },
      set(value) { pendingProps[key] = value; if (real) real[key] = value; },
    });
  }
  // Len pre testy a QA: je modul dotiahnutý? / skutočný modul
  Object.defineProperty(layer, '_lazyLoaded', { get: () => real !== null });
  Object.defineProperty(layer, '_lazyReal', { get: () => real });
  return layer;
}
