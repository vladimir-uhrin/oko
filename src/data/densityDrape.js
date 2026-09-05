import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { getBasemapContrast, onContactPaletteChange } from './contactPalette.js';

/**
 * Spoločná továreň pre „historickú hustotu" — statický RGBA PNG raster
 * (0,25° mriežka, alfa = intenzita) natiahnutý ako JEDEN textúrovaný primitív
 * na glóbus. Prvá inštancia: hustota lodí (World Bank / IMF); druhá: hustota
 * letov (adsb.lol). Obe vrstvy sú tenké obaly nad touto továrňou, aby sa
 * 200 riadkov lifecycle nekopírovalo.
 *
 * HOW: RectangleGeometry + EllipsoidSurfaceAppearance s Image materiálom —
 * presne vzor SHMÚ radaru, NIE `viewer.imageryLayers` (s Google 3D môže byť
 * glóbus skrytý a drape by zmizol s ním). Nulové bunky sú v PNG priehľadné.
 *
 * Alfa má JEDINÉHO zapisovača (`syncAlpha`): kontrast podkladu (svetlý OSM =
 * plná, tmavé podklady = slabšia; contactPalette.js) × zoom-fade (dáta 0,25°
 * sa zblízka roztiahnu do „hmloviny" — od fadeIn slabne, pod fadeOut zmizne a
 * primitív sa skryje). preRender tick zapisuje len na zmenu.
 *
 * Pravidlo 2: každá inštancia nesie v riadku panelu obdobie, licenciu a slovo
 * HISTORICKÉ — operátor nesmie vrstvu považovať za živú.
 */

/** Výška drapu nad elipsoidom (m): mimo z-fightu s imagery, na oko neviditeľná. */
export const DENSITY_DRAPE_HEIGHT_M = 30;

/**
 * Alfa vrstvy podľa kontrastu podkladu. Pure.
 * @param {'dark'|'light'|string} contrast
 * @param {{light:number, dark:number}} alphas
 */
export function densityAlphaFor(contrast, { light, dark }) {
  return contrast === 'light' ? light : dark;
}

/**
 * Zoom-faktor podľa výšky kamery: 1 nad fadeIn, 0 pod fadeOut, lineárne medzi;
 * nefinitná výška = 1 (bez kamery sa nič neskrýva). Pure.
 * @param {number} heightM
 * @param {{fadeInM:number, fadeOutM:number}} fade
 */
export function densityZoomFactor(heightM, { fadeInM, fadeOutM }) {
  if (!Number.isFinite(heightM)) return 1;
  if (heightM >= fadeInM) return 1;
  if (heightM <= fadeOutM) return 0;
  return (heightM - fadeOutM) / (fadeInM - fadeOutM);
}

/**
 * Validuj sidecar a vráť hranice orezané do [−180,180]×[−90,90] — Cesium
 * Rectangle chce [−π,π] a niektoré zdroje majú pixel-edge počiatok tesne za
 * −180°. Pure.
 * @param {object} meta obsah sidecar JSON
 * @param {string} label názov sidecaru do chybovej správy
 */
export function densityBounds(meta, label = 'density.json') {
  const b = meta?.bounds || {};
  const vals = [b.west, b.south, b.east, b.north];
  if (!vals.every(Number.isFinite)) throw new Error(`${label}: bounds missing`);
  if (!(b.west < b.east && b.south < b.north)) throw new Error(`${label}: bounds inverted`);
  if (b.west < -180.1 || b.east > 180.1 || b.south < -90 || b.north > 90) throw new Error(`${label}: bounds out of range`);
  return {
    west: Math.max(-180, b.west),
    south: Math.max(-90, b.south),
    east: Math.min(180, b.east),
    north: Math.min(90, b.north),
  };
}

/** Načítaj + dekóduj PNG do elementu, ktorý Image materiál skonzumuje. */
export function loadDensityImage(url) {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') { resolve({ testImage: url }); return; } // DOM-less testy
    const img = new Image();
    img.onload = () => {
      const decoded = typeof img.decode === 'function' ? img.decode().catch(() => {}) : Promise.resolve();
      decoded.then(() => (img.naturalWidth > 0 ? resolve(img) : reject(new Error('empty image'))));
    };
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = url;
  });
}

/** Textúrovaný obdĺžnik (vzor SHMÚ). `alpha` = počiatočná alfa materiálu. */
export function createDensityDrapePrimitive({ rectangle, image, alpha = 1 }) {
  return new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: new Cesium.RectangleGeometry({
        rectangle,
        height: DENSITY_DRAPE_HEIGHT_M,
        vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT,
      }),
    }),
    appearance: new Cesium.EllipsoidSurfaceAppearance({
      material: Cesium.Material.fromType('Image', { image, color: Cesium.Color.WHITE.withAlpha(alpha) }),
      translucent: true,
    }),
    asynchronous: false,
    show: false,
  });
}

/**
 * @param {object} config
 * @param {string} config.id layer id (napr. 'local-ship-density')
 * @param {string} config.name názov v paneli
 * @param {string} config.icon monochromatický glyf
 * @param {string} config.metaUrl sidecar JSON
 * @param {string} config.pngUrl RGBA PNG
 * @param {(meta:object|null)=>string} config.sourceLabel riadok zdroja (obdobie · licencia · HISTORICKÉ)
 * @param {{light:number, dark:number}} config.alphas alfa podľa kontrastu podkladu
 * @param {{fadeInM:number, fadeOutM:number}} config.fade zoom-fade
 * @param {string} config.logTag prefix do konzoly / governora
 * @param {string} [config.sidecarLabel] názov sidecaru do chýb
 * @param {Function} [config.fetchImpl] test-inject
 * @param {Function} [config.imageLoader] test-inject
 * @param {Function} [config.primitiveFactory] test-inject
 */
export function createDensityDrapeLayer(config) {
  const {
    id, name, icon, metaUrl, pngUrl, sourceLabel, alphas, fade, logTag,
    sidecarLabel = `${id}.json`,
    fetchImpl = null,
    imageLoader = loadDensityImage,
    primitiveFactory = createDensityDrapePrimitive,
  } = config;
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  const governorId = logTag.toLowerCase();
  let _viewer = null;
  let _primitive = null;
  let _meta = null;
  let _enabled = false;
  let _loaded = false;
  let _loading = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _paletteUnsub = null;
  let _preRenderRemover = null;
  let _lastAlpha = -1;

  function currentAlpha() {
    const height = _viewer?.camera?.positionCartographic?.height;
    return densityAlphaFor(getBasemapContrast(), alphas) * densityZoomFactor(height, fade);
  }

  /** JEDINÝ zapisovač alfy: kontrast × zoom; pri 0 primitív skryť. */
  function syncAlpha() {
    const uniforms = _primitive?.appearance?.material?.uniforms;
    if (!uniforms) return;
    const alpha = currentAlpha();
    if (Math.abs(alpha - _lastAlpha) < 0.004) return;
    _lastAlpha = alpha;
    uniforms.color = Cesium.Color.WHITE.withAlpha(alpha);
    _primitive.show = _enabled && alpha > 0;
    governorRequestRender(governorId);
    _viewer?.scene?.requestRender?.();
  }

  async function load() {
    // 'no-cache' = revalidácia: sidecar sa mení každým prebake-om a
    // 'force-cache' podal starú štatistiku (živý nález 2026-09-05).
    const response = await doFetch(metaUrl, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const meta = await response.json();
    const b = densityBounds(meta, sidecarLabel);
    const image = await imageLoader(pngUrl);
    const rectangle = Cesium.Rectangle.fromDegrees(b.west, b.south, b.east, b.north);
    const primitive = primitiveFactory({ rectangle, image, alpha: densityAlphaFor(getBasemapContrast(), alphas) });
    if (_primitive) _viewer?.scene?.primitives?.remove?.(_primitive);
    _primitive = primitive;
    _paletteUnsub?.();
    _paletteUnsub = onContactPaletteChange(() => syncAlpha());
    _preRenderRemover?.();
    _preRenderRemover = _viewer?.scene?.preRender?.addEventListener?.(syncAlpha) ?? null;
    _viewer?.scene?.primitives?.add?.(primitive);
    primitive.show = _enabled;
    _lastAlpha = -1;
    syncAlpha();
    _meta = meta;
    _loaded = true;
    // Vek = dátum SNÍMKY, nie fetchu — panel má hlásiť, aké staré sú dáta.
    const builtMs = Date.parse(meta.built || '');
    _lastUpdate = Number.isFinite(builtMs) ? builtMs : Date.now();
    _lastError = null;
    governorRequestRender(governorId);
    console.log(`[Data:${logTag}] Loaded ${meta.grid?.cols}×${meta.grid?.rows} grid, ${meta.stats?.cellsNonzero} non-zero cells (built ${meta.built})`);
  }

  function startLoad() {
    if (_loaded || _loading) return _loading;
    _loading = load().catch((err) => {
      _lastError = err.message;
      console.error(`[Data:${logTag}] Load error:`, err);
    }).finally(() => {
      _loading = null;
    });
    return _loading;
  }

  const layer = {
    id,
    name,
    icon,
    get source() { return sourceLabel(_meta); },
    // Statická snímka: manažér update() volá, no po načítaní je to no-op.
    updateInterval: 24 * 60 * 60 * 1000,

    init(viewer) {
      _viewer = viewer;
      _enabled = false;
      _loaded = false;
      _loading = null;
      _meta = null;
      _primitive = null;
      _lastError = null;
    },

    async enable() {
      _enabled = true;
      if (_primitive) {
        _primitive.show = true;
        _lastAlpha = -1;
        syncAlpha(); // show rešpektuje zoom-fade hneď
        governorRequestRender(governorId);
      }
      const pending = startLoad();
      if (pending) await pending;
    },

    disable() {
      _enabled = false;
      if (_primitive) {
        _primitive.show = false;
        governorRequestRender(governorId);
      }
    },

    async update() {
      if (_enabled && !_loaded && !_loading) await startLoad();
    },

    destroy(viewer) {
      _paletteUnsub?.();
      _paletteUnsub = null;
      _preRenderRemover?.();
      _preRenderRemover = null;
      _lastAlpha = -1;
      if (_primitive) (viewer || _viewer)?.scene?.primitives?.remove?.(_primitive);
      _primitive = null;
      _viewer = null;
      _enabled = false;
      _loaded = false;
      _loading = null;
      _meta = null;
      _lastUpdate = null;
      _lastError = null;
    },

    isLoaded() { return _loaded; },
    isUpdating() { return Boolean(_loading); },

    getStatus() {
      if (_lastError) return { state: 'error', message: _lastError };
      if (_loaded) return { state: 'ready', count: _meta?.stats?.cellsNonzero ?? 0 };
      if (_loading) return { state: 'loading' };
      return { state: 'idle' };
    },

    getStats() {
      return {
        source: layer.source,
        lastUpdate: _lastUpdate,
        count: _meta?.stats?.cellsNonzero ?? 0,
        error: _lastError,
        loading: Boolean(_loading),
      };
    },

    /** Test-only peek. */
    _getStateForTest() {
      return { enabled: _enabled, loaded: _loaded, hasPrimitive: Boolean(_primitive), shown: _primitive?.show ?? null, meta: _meta };
    },
  };

  return layer;
}
