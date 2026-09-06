import * as Cesium from 'cesium';
import { t } from '../i18n.js';
import { governorRequestRender } from '../renderGovernor.js';
import { gibsImageryDayOffset } from '../gibsTime.js';
import { insertOverlayLayer } from '../imageryOrder.js';
import { densityZoomFactor } from './densityDrape.js';
import { getActiveMapStack, isGlobeHiddenForStack, onActiveMapStackChange } from './activeMapStack.js';

/**
 * Prekryvné vrstvy NASA GIBS nad ľubovoľným podkladom glóbusu (2026-09-06,
 * „NASA má veľmi pekné mapy" → „urob 2").
 *
 * Denné vedecké mozaiky — teplota mora, zrážky, sneh, aerosól, morský ľad —
 * sú PRIEHĽADNÉ PNG (nodata = alfa 0), takže nepatria do `MAP_STACKS`
 * (prepínač podkladu nahrádza), ale nad podklad ako druhá imagery vrstva
 * s vlastným krytím. Jedna továreň, päť tenkých inštancií — vzor
 * localLayers.js / densityDrape.js, aby sa lifecycle nekopíroval.
 *
 * Pravidlo 2 (stav dát viditeľný): riadok panelu nesie DEŇ mozaiky (UTC),
 * produkt a licenciu; ak včerajšok ešte nie je, vrstva ustúpi o deň a riadok
 * hlási STALE; na Google 3D fotoreáli (glóbus skrytý) hlási, že sa nemá kam
 * kresliť. Nič z toho nie je živé v zmysle minút — je to denná mozaika.
 *
 * GIBS je WMTS REST: TileMatrix/TileRow/TileCol = z/y/x, NIE z/x/y. Prehodené
 * indexy vrátia HTTP 200 s cudzou dlaždicou — rozhádzaná mapa, nie chyba.
 * Dátum mimo rozsahu vrstvy vracia HTTP 400 (XML) — preto sonda nižšie.
 */

export const GIBS_WMTS_BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
export const GIBS_CREDIT_PREFIX = 'NASA EOSDIS GIBS / Worldview';

/** Koľko dní dozadu skúsiť, kým riadok povie „nedostupné". */
export const GIBS_OVERLAY_MAX_DAYS_BACK = 4;
/** Perióda kontroly dňa: mozaika je denná, stačí hodina. */
export const GIBS_OVERLAY_UPDATE_INTERVAL_MS = 60 * 60_000;
/** Ponúkané krytia — čipy v riadku (params.opacity). */
export const GIBS_OVERLAY_OPACITY_STEPS = Object.freeze([0.4, 0.7, 1]);

/**
 * Zoom-fade (2026-09-06, po živom overení): Level 6 je ~2,4 km/px — pri
 * 700 km nad Alpami boli zrážky farebné bloky cez celú obrazovku. Dáta sa
 * zblízka nedajú zostriť, tak vrstva ustúpi ako hustota lodí
 * (densityDrape.js): pod fadeOut zmizne, nad fadeIn je plná. Prahy sú
 * odvodené z úrovne dlaždíc, aby Level 8 (4× jemnejší) ostal dlhšie:
 *   fadeOut = 200 km × 2^(8 − level), fadeIn = 3 × fadeOut
 *   → L6: 800 / 2 400 km, L7: 400 / 1 200 km, L8: 200 / 600 km.
 * Pri fadeOut je jeden dátový pixel ≈ 2–3 pixely obrazovky — hranica, kde
 * prestáva byť pole a začína byť mriežka.
 * @param {number} level GoogleMapsCompatible_Level{n}
 * @returns {{fadeOutM: number, fadeInM: number}}
 */
export function gibsOverlayFade(level) {
  const lvl = Number.isFinite(level) ? level : 6;
  const fadeOutM = 200_000 * 2 ** (8 - lvl);
  return { fadeOutM, fadeInM: fadeOutM * 3 };
}

/**
 * Katalóg. Legendy sú prepis GIBS colormáp v1.3 (odkaz `colormap`), päť
 * kotiev naprieč škálou — presné rgb z XML, hodnoty z `value` rozsahov a
 * značiek `LegendEntry`. Úrovne (`level`) sú maximá z GetCapabilities
 * (2026-09-06); bližšie Cesium dlaždice zväčšuje.
 * @typedef {object} GibsOverlayDef
 * @property {string} id id vrstvy v paneli (a v share-linku)
 * @property {string} layer identifikátor GIBS
 * @property {number} level GoogleMapsCompatible_Level{n}
 * @property {string} icon monochromatický glyf
 * @property {string} product krátky názov produktu do riadku
 * @property {string} colormap URL colormapy (dokumentácia legendy)
 * @property {Array<{color: string, label: string}>} legend
 * @property {number} opacity východiskové krytie
 */

/** @type {ReadonlyArray<GibsOverlayDef>} */
export const GIBS_OVERLAYS = Object.freeze([
  Object.freeze({
    id: 'gibs-sst',
    layer: 'GHRSST_L4_MUR_Sea_Surface_Temperature',
    level: 7,
    icon: '≈',
    product: 'GHRSST MUR L4',
    colormap: 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/GHRSST_Sea_Surface_Temperature.xml',
    legend: Object.freeze([
      { color: 'rgb(43,0,26)', label: '<0 °C' },
      { color: 'rgb(30,18,78)', label: '8' },
      { color: 'rgb(47,166,242)', label: '16' },
      { color: 'rgb(255,175,0)', label: '24' },
      { color: 'rgb(107,2,0)', label: '32+ °C' },
    ]),
    opacity: 0.7,
  }),
  Object.freeze({
    id: 'gibs-precip',
    layer: 'IMERG_Precipitation_Rate',
    level: 6,
    icon: '∴',
    product: 'GPM IMERG',
    colormap: 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/GPM_Precipitation_Rate.xml',
    legend: Object.freeze([
      { color: 'rgb(0,118,78)', label: '0,1 mm/h' },
      { color: 'rgb(78,195,0)', label: '0,5' },
      { color: 'rgb(255,152,15)', label: '2' },
      { color: 'rgb(212,0,0)', label: '10' },
      { color: 'rgb(51,0,0)', label: '50+ mm/h' },
    ]),
    opacity: 0.85,
  }),
  Object.freeze({
    id: 'gibs-snow',
    layer: 'MODIS_Terra_NDSI_Snow_Cover',
    level: 8,
    icon: '❄︎',
    product: 'MODIS Terra NDSI',
    colormap: 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_NDSI_Snow_Cover.xml',
    legend: Object.freeze([
      { color: 'rgb(240,240,128)', label: '0 %' },
      { color: 'rgb(240,210,133)', label: '25' },
      { color: 'rgb(240,180,138)', label: '50' },
      { color: 'rgb(240,150,143)', label: '75' },
      { color: 'rgb(255,0,0)', label: '100 %' },
    ]),
    opacity: 0.7,
  }),
  Object.freeze({
    id: 'gibs-aerosol',
    layer: 'MODIS_Combined_Value_Added_AOD',
    level: 6,
    icon: '⁂',
    product: 'MODIS Aqua+Terra AOD',
    colormap: 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_Combined_Value_Added_AOD.xml',
    legend: Object.freeze([
      { color: 'rgb(255,253,205)', label: '0' },
      { color: 'rgb(255,203,78)', label: '' },
      { color: 'rgb(255,112,30)', label: '' },
      { color: 'rgb(225,16,11)', label: '' },
      { color: 'rgb(125,0,14)', label: '5 AOD' },
    ]),
    opacity: 0.7,
  }),
  Object.freeze({
    id: 'gibs-sea-ice',
    layer: 'GHRSST_L4_MUR_Sea_Ice_Concentration',
    level: 7,
    icon: '⬡',
    product: 'GHRSST MUR L4',
    colormap: 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/GHRSST_Sea_Ice_Concentration.xml',
    legend: Object.freeze([
      { color: 'rgb(17,17,17)', label: '0 %' },
      { color: 'rgb(92,0,255)', label: '25' },
      { color: 'rgb(0,212,127)', label: '50' },
      { color: 'rgb(255,198,0)', label: '75' },
      { color: 'rgb(255,255,255)', label: '100 %' },
    ]),
    opacity: 0.8,
  }),
]);

export const GIBS_OVERLAY_LAYER_IDS = Object.freeze(GIBS_OVERLAYS.map((d) => d.id));

/**
 * URL šablóna dlaždíc pre deň. Pure.
 * @param {GibsOverlayDef} def
 * @param {string} dayIso YYYY-MM-DD
 * @returns {string}
 */
export function gibsOverlayUrl(def, dayIso) {
  return `${GIBS_WMTS_BASE}/${def.layer}/default/${dayIso}/GoogleMapsCompatible_Level${def.level}/{z}/{y}/{x}.png`;
}

/**
 * Sonda dostupnosti dňa: jedna malá dlaždica (z=2, y=1, x=1 — severná
 * pologuľa, kde majú všetky produkty dáta). 400 = deň mimo rozsahu vrstvy.
 * @param {GibsOverlayDef} def
 * @param {string} dayIso
 * @returns {string}
 */
export function gibsOverlayProbeUrl(def, dayIso) {
  return gibsOverlayUrl(def, dayIso).replace('{z}', '2').replace('{y}', '1').replace('{x}', '1');
}

/**
 * Krytie z params: číslo 0..1, inak null (odmietnuté).
 * @param {unknown} value
 * @returns {number|null}
 */
export function normalizeOverlayOpacity(value) {
  // Number(null) je 0 — prázdna hodnota by potichu zhasla vrstvu.
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}

/**
 * Riadok zdroja pre panel: produkt · deň (UTC) · licencia. Pure.
 * @param {GibsOverlayDef} def
 * @param {string|null} dayIso
 * @returns {string}
 */
export function gibsOverlaySourceLabel(def, dayIso) {
  const day = dayIso ? ` · ${dayIso} UTC` : '';
  return `NASA GIBS · ${def.product}${day} (${t('gibs.license')})`;
}

/**
 * Továreň jednej prekryvnej vrstvy. Závislosti sú injektovateľné pre testy.
 * @param {GibsOverlayDef} def
 * @param {object} [deps]
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {() => number} [deps.now]
 * @param {(def: GibsOverlayDef, day: string) => object} [deps.providerFactory]
 * @param {(provider: object) => object} [deps.layerFactory]
 */
export function createGibsOverlayLayer(def, {
  fetchImpl = null,
  now = () => Date.now(),
  providerFactory = (d, day) => new Cesium.UrlTemplateImageryProvider({
    url: gibsOverlayUrl(d, day),
    tileWidth: 256,
    tileHeight: 256,
    maximumLevel: d.level,
    credit: `${GIBS_CREDIT_PREFIX} · ${d.product}`,
  }),
  layerFactory = (provider) => new Cesium.ImageryLayer(provider),
} = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  let _viewer = null;
  let _enabled = false;
  let _opacity = def.opacity;
  /** Deň, ktorý vrstva práve kreslí (YYYY-MM-DD) — null pred prvým enable. */
  let _day = null;
  let _stale = false;
  let _lastError = null;
  let _lastUpdate = null;
  let _imageryLayer = null;
  let _rowControlsListener = null;
  let _unbindStack = null;
  /** Remover preRender listenera zoom-fadu (jedna clamp na frame, zápis len pri zmene). */
  let _fadeRemover = null;
  const fade = gibsOverlayFade(def.level);

  const globeHidden = () => isGlobeHiddenForStack(getActiveMapStack());

  /** Jediný zapisovač alfy: krytie × zoom-faktor podľa výšky kamery. */
  const applyAlpha = () => {
    if (!_imageryLayer) return;
    const alpha = _opacity * densityZoomFactor(_viewer?.scene?.camera?.positionCartographic?.height, fade);
    if (Math.abs((_imageryLayer.alpha ?? 1) - alpha) > 0.005) {
      _imageryLayer.alpha = alpha;
      governorRequestRender(`gibs-overlay:${def.id}`);
    }
  };

  const attachFade = () => {
    applyAlpha();
    if (_fadeRemover) return;
    const preRender = _viewer?.scene?.preRender;
    if (typeof preRender?.addEventListener !== 'function') return;
    _fadeRemover = preRender.addEventListener(applyAlpha);
  };

  const detachFade = () => {
    if (typeof _fadeRemover === 'function') _fadeRemover();
    _fadeRemover = null;
  };

  const removeLayer = () => {
    if (_imageryLayer && _viewer?.imageryLayers) _viewer.imageryLayers.remove(_imageryLayer, true);
    _imageryLayer = null;
  };

  /** Jediný zapisovač imagery vrstvy: (znovu)postaví ju pre `_day`. */
  const mountLayer = () => {
    if (!_viewer?.imageryLayers || !_day) return;
    removeLayer();
    _imageryLayer = layerFactory(providerFactory(def, _day));
    _imageryLayer.alpha = _opacity;
    insertOverlayLayer(_viewer.imageryLayers, _imageryLayer);
    attachFade();
    governorRequestRender(`gibs-overlay:${def.id}`);
  };

  /**
   * Nájdi najnovší dostupný deň: včera, inak späť po GIBS_OVERLAY_MAX_DAYS_BACK.
   * @returns {Promise<{day: string|null, stale: boolean, error: string|null}>}
   */
  const resolveDay = async () => {
    const nowMs = now();
    let lastStatus = null;
    for (let back = 1; back <= GIBS_OVERLAY_MAX_DAYS_BACK; back += 1) {
      const day = gibsImageryDayOffset(back, nowMs);
      try {
        const response = await doFetch(gibsOverlayProbeUrl(def, day));
        if (response?.ok) return { day, stale: back > 1, error: null };
        lastStatus = response?.status ?? null;
        // 400 = deň mimo rozsahu (ešte nespracovaný) → skúsiť starší; iný
        // kód (5xx, 429) je porucha služby, nie chýbajúci deň.
        if (lastStatus !== 400 && lastStatus !== 404) break;
      } catch (error) {
        return { day: null, stale: false, error: t('gibs.network-error') };
      }
    }
    return { day: null, stale: false, error: t('gibs.unavailable', { status: lastStatus ?? '?' }) };
  };

  const layer = {
    id: def.id,
    name: def.id,
    icon: def.icon,
    get source() { return gibsOverlaySourceLabel(def, _day); },
    updateInterval: GIBS_OVERLAY_UPDATE_INTERVAL_MS,
    /** Pre panel skupiny a dokumentáciu — descriptor je verejný, nemení sa. */
    def,

    init(viewer) {
      _viewer = viewer;
      _enabled = false;
      _day = null;
      _stale = false;
      _lastError = null;
      _lastUpdate = null;
      _imageryLayer = null;
      // Prepnutie na fotoreál / späť mení, čo riadok hovorí — prekresliť ho.
      _unbindStack?.();
      _unbindStack = onActiveMapStackChange(() => { _rowControlsListener?.(); });
    },

    enable() {
      _enabled = true;
      // Kresliť hneď, s najpravdepodobnejším dňom (včera); update() ho overí
      // a prípadne ustúpi. Prázdny glóbus do prvej sondy by vyzeral ako chyba.
      if (!_day) _day = gibsImageryDayOffset(1, now());
      mountLayer();
    },

    disable() {
      _enabled = false;
      detachFade();
      removeLayer();
      governorRequestRender(`gibs-overlay:${def.id}`);
    },

    async update() {
      const resolved = await resolveDay();
      if (!resolved.day) {
        _lastError = resolved.error;
        return false;
      }
      _lastError = null;
      _stale = resolved.stale;
      // Deň mozaiky = čas produktu (00:00 UTC), nie čas našej sondy — vek
      // v paneli má hovoriť, aké staré je počasie, nie ako dávno sme sa pýtali.
      _lastUpdate = Date.parse(`${resolved.day}T00:00:00Z`);
      if (resolved.day !== _day) {
        _day = resolved.day;
        if (_enabled) mountLayer();
      }
      _rowControlsListener?.();
      return true;
    },

    destroy() {
      _enabled = false;
      detachFade();
      removeLayer();
      _unbindStack?.();
      _unbindStack = null;
      _viewer = null;
      _day = null;
      _lastError = null;
      _lastUpdate = null;
    },

    getParams() {
      return { opacity: _opacity };
    },

    /**
     * @param {{opacity?: number}} params
     * @returns {boolean} false = odmietnuté (manažér to hlási ako chybu)
     */
    setParams(params = {}) {
      if (!('opacity' in (params || {}))) return true;
      const opacity = normalizeOverlayOpacity(params.opacity);
      if (opacity === null) return false;
      _opacity = opacity;
      applyAlpha();
      return true;
    },

    getRowControls() {
      return {
        chips: GIBS_OVERLAY_OPACITY_STEPS.map((step) => ({
          id: `opacity-${Math.round(step * 100)}`,
          label: `${Math.round(step * 100)} %`,
          active: Math.abs(_opacity - step) < 0.005,
          title: t('gibs.opacity-title', { pct: Math.round(step * 100) }),
          params: { opacity: step },
        })),
        // Legenda je gradient, nie počty — prázdny count, nech manažér
        // nevypíše „undefined".
        legend: def.legend.map((entry) => ({ color: entry.color, label: entry.label, count: '' })),
      };
    },

    setRowControlsListener(listener) {
      _rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    getStats() {
      // Fotoreál: glóbus je skrytý, vrstva nemá povrch. Hlásiť to ako stav,
      // nie mlčať — používateľ inak hľadá chybu v dátach.
      const hidden = _enabled && globeHidden();
      return {
        count: 0,
        lastUpdate: _lastUpdate,
        stale: _stale,
        error: hidden ? t('gibs.globe-only') : _lastError,
        day: _day,
      };
    },
  };
  return layer;
}

/** Päť vrstiev pre registráciu v main.js (vzor localLayers.js). */
const gibsOverlayLayers = GIBS_OVERLAYS.map((def) => createGibsOverlayLayer(def));

export default gibsOverlayLayers;
