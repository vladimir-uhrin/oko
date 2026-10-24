// src/volbyMapMode.js
/**
 * @module volbyMapMode
 * @description Volebný režim mapy (2026-10-24, vlastník: „teraz sú tam aj lietadlá, nevidno hranice obcí, žúp, nie je
 * lepšie nastaviť inú mapu po zapnutí volieb?" → „čistý podklad, hranice krajov a obcí, lietadlá a lode skryť, pri
 * zatvorení panela vrátiť späť").
 *
 * Kým je panel VOĽBY 2026 otvorený (desktop: pruh, mobil: výsuv — sleduje sa trieda `collapsed` panela):
 *  - podklad Stadia Dark (čistý tmavý; pri výpadku Stadie platí bežná záloha stadiaHealth.js),
 *  - lietadlá, vojenské lety a lode vypnuté, mapa obcí (volby-obce) zapnutá,
 *  - hranice krajov (výrazné) a obcí (jemné, od priblíženia) z OSM (public/volby/hranice-*.json, ODbL),
 *    ako GroundPolylinePrimitive — na teréne aj bez 3D dlaždíc.
 * Po zatvorení sa vráti podklad (len ak ho medzitým nezmenil návštevník) a presne tie vrstvy, ktoré boli zapnuté.
 */
import * as Cesium from 'cesium';

export const VOLBY_MAP_STACK = 'stadia-dark';
/** Vrstvy, ktoré volebný režim skryje (a potom vráti, ak boli zapnuté). */
export const VOLBY_HIDDEN_LAYERS = Object.freeze(['flights', 'military', 'ais-live-vessels', 'aishub-vessels', 'gfw-presence', 'gfw-sar']);
export const VOLBY_OBCE_LAYER = 'volby-obce';
export const BORDER_URLS = Object.freeze({ kraje: '/volby/hranice-kraje.json', obce: '/volby/hranice-obce.json' });
export const BORDER_STYLE = Object.freeze({
  kraje: Object.freeze({ color: '#ffb33c', alpha: 0.7, width: 2.2, maxDistanceM: 3_000_000 }),
  obce: Object.freeze({ color: '#cfe8ff', alpha: 0.35, width: 1.2, maxDistanceM: 260_000 }),
});

/** Plán vstupu: čo vypnúť a čo si zapamätať. Pure. */
export function planEnter({ stack, layersOn }) {
  const hide = VOLBY_HIDDEN_LAYERS.filter((id) => layersOn.includes(id));
  return { saved: { stack, layers: hide, obceWasOn: layersOn.includes(VOLBY_OBCE_LAYER) }, hide, setStack: stack === VOLBY_MAP_STACK ? null : VOLBY_MAP_STACK };
}

/** Plán návratu: podklad len ak je stále volebný, vrstvy podľa zapamätaného stavu. Pure. */
export function planExit(saved, { stack }) {
  if (!saved) return { setStack: null, show: [], hideObce: false };
  return {
    setStack: stack === VOLBY_MAP_STACK && saved.stack && saved.stack !== VOLBY_MAP_STACK ? saved.stack : null,
    show: [...saved.layers],
    hideObce: !saved.obceWasOn,
  };
}

/** Čiary hraníc z JSON (lines: [[[lon, lat], …]]) → ploché pole stupňov pre Cesium. Pure. */
export function linesToDegrees(json) {
  const out = [];
  for (const line of Array.isArray(json?.lines) ? json.lines : []) {
    if (!Array.isArray(line) || line.length < 2) continue;
    const flat = [];
    for (const p of line) if (Number.isFinite(p?.[0]) && Number.isFinite(p?.[1])) flat.push(p[0], p[1]);
    if (flat.length >= 4) out.push(flat);
  }
  return out;
}

function defaultCreatePrimitive({ lines, style }) {
  const color = Cesium.Color.fromCssColorString(style.color).withAlpha(style.alpha);
  const instances = lines.map((flat) => new Cesium.GeometryInstance({
    geometry: new Cesium.GroundPolylineGeometry({ positions: Cesium.Cartesian3.fromDegreesArray(flat), width: style.width }),
    attributes: { distanceDisplayCondition: new Cesium.DistanceDisplayConditionGeometryInstanceAttribute(0, style.maxDistanceM) },
  }));
  return new Cesium.GroundPolylinePrimitive({
    geometryInstances: instances,
    classificationType: Cesium.ClassificationType.BOTH,
    appearance: new Cesium.PolylineMaterialAppearance({ material: Cesium.Material.fromType('Color', { color }), translucent: true }),
    allowPicking: false,
    asynchronous: true,
  });
}

/**
 * @param {object} o
 * @param {object} [o.viewer] Cesium.Viewer (scene.groundPrimitives)
 * @param {() => string} o.getStack
 * @param {(id: string) => any} o.setStack
 * @param {(id: string) => boolean} o.isLayerOn
 * @param {(id: string, on: boolean) => any} o.setLayer
 * @param {Function} [o.fetchImpl]
 * @param {Function} [o.createPrimitive] test seam (bez WebGL)
 */
export function createVolbyMapMode({
  viewer = null, getStack, setStack, isLayerOn, setLayer, fetchImpl = (...a) => globalThis.fetch(...a), createPrimitive = defaultCreatePrimitive,
  setTimeoutImpl = globalThis.setTimeout, reassertDelays = [1500, 5000, 12000],
} = {}) {
  let active = false;
  let saved = null;
  const prims = {}; // kraje, obce
  let loading = null;
  let observer = null;

  async function loadBorders() {
    if (loading) return loading;
    loading = (async () => {
      for (const [key, url] of Object.entries(BORDER_URLS)) {
        try {
          const res = await fetchImpl(url, { cache: 'force-cache' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const lines = linesToDegrees(await res.json());
          if (!lines.length) continue;
          const prim = createPrimitive({ lines, style: BORDER_STYLE[key], key });
          prim.show = active;
          viewer?.scene?.groundPrimitives?.add?.(prim);
          prims[key] = prim;
        } catch (error) {
          console.warn(`[volby] hranice ${key}: ${error?.message || error}`);
        }
      }
    })();
    return loading;
  }

  function showBorders(on) {
    for (const p of Object.values(prims)) p.show = on;
    viewer?.scene?.requestRender?.();
  }

  async function enter() {
    if (active) return false;
    active = true;
    const layersOn = [...VOLBY_HIDDEN_LAYERS, VOLBY_OBCE_LAYER].filter((id) => isLayerOn(id));
    const plan = planEnter({ stack: getStack(), layersOn });
    saved = plan.saved;
    if (plan.setStack) await setStack(plan.setStack);
    for (const id of plan.hide) await setLayer(id, false);
    if (!saved.obceWasOn) await setLayer(VOLBY_OBCE_LAYER, true);
    showBorders(true);
    void loadBorders().then(() => showBorders(active));
    // Obnova stavu z odkazu či úložiska môže lietadlá a lode zapnúť až po vstupe — opakovane dorovnať.
    for (const ms of reassertDelays) setTimeoutImpl(() => { void reassert(); }, ms);
    return true;
  }

  /** Počas režimu: skryté vrstvy, ktoré sa medzitým zapli, vypnúť (a zapamätať na návrat); mapa obcí zapnutá. */
  async function reassert() {
    if (!active || !saved) return 0;
    let n = 0;
    for (const id of VOLBY_HIDDEN_LAYERS) {
      if (!isLayerOn(id)) continue;
      if (!saved.layers.includes(id)) saved.layers.push(id);
      await setLayer(id, false);
      n += 1;
    }
    if (!isLayerOn(VOLBY_OBCE_LAYER)) { await setLayer(VOLBY_OBCE_LAYER, true); n += 1; }
    return n;
  }

  async function exit() {
    if (!active) return false;
    active = false;
    const plan = planExit(saved, { stack: getStack() });
    saved = null;
    showBorders(false);
    if (plan.hideObce) await setLayer(VOLBY_OBCE_LAYER, false);
    for (const id of plan.show) await setLayer(id, true);
    if (plan.setStack) await setStack(plan.setStack);
    return true;
  }

  /** Sleduje panel: otvorený (bez triedy collapsed) = režim zapnutý. */
  function observe(panel, MutationObserverImpl = globalThis.MutationObserver) {
    if (!panel || typeof MutationObserverImpl !== 'function') return false;
    const sync = () => { if (panel.classList.contains('collapsed')) void exit(); else void enter(); };
    observer = new MutationObserverImpl(sync);
    observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
    sync();
    return true;
  }

  function destroy() {
    observer?.disconnect?.();
    for (const p of Object.values(prims)) viewer?.scene?.groundPrimitives?.remove?.(p);
  }

  return { enter, exit, observe, destroy, reassert, get active() { return active; }, get saved() { return saved; }, _prims: prims };
}
