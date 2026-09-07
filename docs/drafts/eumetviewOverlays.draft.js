// NÁVRH — NEZAPOJENÉ (odložené 2026-09-06, „odložíme na neskôr").
//
// Živé Meteosat snímky z EUMETView ako prekryv. Kód je hotový na zapojenie,
// chýba: registrácia v main.js, tokeny v layerState.js (6/7/8), i18n kľúče
// (layer.eumet-*.name, gibs.short.eumet-*, eumet.time-unknown,
// eumet.before-archive), členstvo v skupine „Zem zo satelitu"
// (gibsOverlayPanel.js), kredit v dataCredits.js, riadok v DATA_SOURCES.md,
// testy (vzor gibsOverlays.test.mjs). DÔVOD ODLOŽENIA: podmienky EUMETSAT —
// Terms of Use webu hovoria „personal and non-commercial use", satelitné
// produkty nie sú pod CC; služba sama hlási AccessConstraints none. Treba
// rozhodnutie o (ne)komerčnosti OKO. Podrobnosti: DATA_SOURCES.md, sekcia
// „Considered, deferred".
import * as Cesium from 'cesium';
import { t } from '../i18n.js';
import { governorRequestRender } from '../renderGovernor.js';
import { insertOverlayLayer } from '../imageryOrder.js';
import { densityZoomFactor } from './densityDrape.js';
import { GIBS_OVERLAY_OPACITY_STEPS, gibsOverlayFade, normalizeOverlayOpacity } from './gibsOverlays.js';
import { getGibsDayOffset, gibsDayForOffset, onGibsDayChange } from './gibsDay.js';
import { getActiveMapStack, isGlobeHiddenForStack, onActiveMapStackChange } from './activeMapStack.js';

/**
 * ŽIVÉ Meteosat snímky z EUMETView (EUMETSAT) ako prekryv nad podkladom
 * (2026-09-06, „ako by sme mohli použiť Copernicus a podobné" → EUMETView
 * prvý). To, čo denná mozaika NASA GIBS nevie: oblaky TERAZ, každých 10–15
 * minút, z geostacionárnej dráhy nad 0° — Európa, Afrika, Atlantik.
 *
 * Služba: GeoServer WMS 1.3.0 na view.eumetsat.int, keyless, CORS `*`,
 * EPSG:3857, GetCapabilities hlási `Fees: none` / `AccessConstraints: none`
 * (overené 2026-09-06). Každá vrstva má časovú dimenziu s `default` =
 * najnovší snímok a rozsahom od 2020 (MSG) / 2024 (MTG) — preto sem sadne aj
 * posuvník dňa (gibsDay.js): historický deň = poludnie UTC toho dňa.
 *
 * PREČO EXPLICITNÝ ČAS: GetMap bez TIME vracia najnovší snímok, ale odpoveď
 * má `cache-control: max-age=604800` — prehliadač by týždeň servíroval ten
 * istý obrázok. Čas sa preto číta z GetCapabilities (282 kB, zdieľaná cache
 * 5 min pre všetky vrstvy) a ide do URL; pri zlyhaní capabilities sa kreslí
 * bez TIME s cache-busterom po kadencii a riadok povie, že čas nepozná.
 *
 * PODMIENKY (DATA_SOURCES.md): Terms of Use EUMETSAT — obsah webu „for your
 * own personal and non-commercial use", kredit „©EUMETSAT [year]" povinný a
 * „may not be hidden or disassociated from the content"; satelitné dáta a
 * produkty nie sú pod CC. OKO je nekomerčné; kredit ide na riadok kreditov
 * cez provider `credit` a nesmie sa odstrániť.
 */

export const EUMETVIEW_WMS_URL = 'https://view.eumetsat.int/geoserver/wms';
export const EUMETVIEW_CAPS_URL = `${EUMETVIEW_WMS_URL}?service=WMS&request=GetCapabilities&version=1.3.0`;
/** Zdieľaná cache GetCapabilities — jedna odpoveď pre všetky vrstvy. */
export const EUMETVIEW_CAPS_TTL_MS = 5 * 60_000;
/** Kadencia snímok je 10–15 min; kontrola nového času každých 5. */
export const EUMETVIEW_UPDATE_INTERVAL_MS = 5 * 60_000;
/** Snímok starší než toto = STALE (šesť kadencií — výpadok príjmu, nie meškanie). */
export const EUMETVIEW_STALE_AFTER_MS = 90 * 60_000;
/** Disk zo stacionárnej dráhy nad 0°: mimo ±81° nemá zmysel žiadať dlaždice. */
export const EUMETVIEW_DISK_DEGREES = Object.freeze([-81, -81, 81, 81]);
/** Historický deň z posuvníka = poludnie UTC (MSG 15 min aj MTG 10 min ho majú). */
export const EUMETVIEW_HISTORICAL_TIME_UTC = 'T12:00:00Z';

/**
 * @typedef {object} EumetviewOverlayDef
 * @property {string} id
 * @property {string} layer názov WMS vrstvy (workspace:name)
 * @property {string} icon
 * @property {string} product
 * @property {number} cadenceMin
 * @property {number} level ekvivalentná úroveň dlaždíc pre zoom-fade (MSG ~3 km ≈ L7, MTG ~1 km ≈ L8)
 * @property {number} opacity
 * @property {string} since začiatok archívu (YYYY-MM-DD) — posuvník pred ním hlási chybu
 */

/** @type {ReadonlyArray<EumetviewOverlayDef>} */
export const EUMETVIEW_OVERLAYS = Object.freeze([
  Object.freeze({
    id: 'eumet-geocolour',
    layer: 'mtg_fd:rgb_geocolour',
    icon: '◍',
    product: 'Meteosat MTG-I · Geocolour RGB',
    cadenceMin: 10,
    level: 8,
    opacity: 0.9,
    since: '2024-09-23',
  }),
  Object.freeze({
    id: 'eumet-airmass',
    layer: 'msg_fes:rgb_airmass',
    icon: '≋',
    product: 'Meteosat MSG · Airmass RGB',
    cadenceMin: 15,
    level: 7,
    opacity: 0.8,
    since: '2020-09-01',
  }),
  Object.freeze({
    id: 'eumet-ir108',
    layer: 'msg_fes:ir108',
    icon: '◐',
    product: 'Meteosat MSG · IR 10.8 µm',
    cadenceMin: 15,
    level: 7,
    opacity: 0.8,
    since: '2020-09-01',
  }),
]);

export const EUMETVIEW_LAYER_IDS = Object.freeze(EUMETVIEW_OVERLAYS.map((d) => d.id));

/**
 * Kredit podľa Terms of Use: „©EUMETSAT [year]". Pure.
 * @param {number} [nowMs]
 * @returns {string}
 */
export function eumetviewCredit(nowMs = Date.now()) {
  return `©EUMETSAT ${new Date(nowMs).getUTCFullYear()} · EUMETView`;
}

/**
 * Vytiahni časové dimenzie z GetCapabilities bez DOMParseru (beží aj v Node).
 * Pre každú vrstvu: najnovší snímok (`default`), rozsah a perióda.
 * @param {string} xml
 * @returns {Map<string, {defaultTime: string, start: string|null, end: string|null, periodMin: number|null}>}
 */
export function parseEumetviewTimes(xml) {
  const out = new Map();
  if (typeof xml !== 'string') return out;
  for (const match of xml.matchAll(/<Name>([^<]+)<\/Name>[\s\S]*?<Dimension name="time"([^>]*)>([^<]*)<\/Dimension>/g)) {
    const name = match[1];
    if (out.has(name)) continue;
    const def = (match[2].match(/default="([^"]*)"/) || [])[1] || null;
    if (!def) continue;
    const [start, end, period] = match[3].trim().split('/');
    const minutes = (period || '').match(/^PT(\d+)M$/);
    out.set(name, {
      defaultTime: def,
      start: start || null,
      end: end || null,
      periodMin: minutes ? Number(minutes[1]) : null,
    });
  }
  return out;
}

/**
 * Čas pre historický deň z posuvníka. Pure.
 * @param {string} dayIso YYYY-MM-DD
 * @returns {string}
 */
export function eumetviewTimeForDay(dayIso) {
  return `${dayIso}${EUMETVIEW_HISTORICAL_TIME_UTC}`;
}

/**
 * Je snímok starý na výpadok? Pure.
 * @param {string|null} timeIso
 * @param {number} [nowMs]
 * @returns {boolean}
 */
export function eumetviewIsStale(timeIso, nowMs = Date.now()) {
  const ms = Date.parse(timeIso || '');
  if (!Number.isFinite(ms)) return false;
  return nowMs - ms > EUMETVIEW_STALE_AFTER_MS;
}

/**
 * Riadok zdroja: produkt · čas snímku UTC · kredit. Pure.
 * @param {EumetviewOverlayDef} def
 * @param {string|null} timeIso
 * @param {number} [nowMs]
 * @returns {string}
 */
export function eumetviewSourceLabel(def, timeIso, nowMs = Date.now()) {
  const when = timeIso
    ? ` · ${timeIso.slice(0, 10)} ${timeIso.slice(11, 16)} UTC`
    : ` · ${t('eumet.time-unknown')}`;
  return `EUMETSAT EUMETView · ${def.product}${when} (${eumetviewCredit(nowMs)})`;
}

/**
 * Parametre GetMap. Bez známeho času ide cache-buster po kadencii, inak by
 * prehliadač (max-age 7 dní) držal starý obrázok. Pure.
 * @param {EumetviewOverlayDef} def
 * @param {string|null} timeIso
 * @param {number} [nowMs]
 * @returns {Record<string, string>}
 */
export function eumetviewWmsParameters(def, timeIso, nowMs = Date.now()) {
  const params = { format: 'image/png', transparent: 'true' };
  if (timeIso) params.time = timeIso;
  else params._ = String(Math.floor(nowMs / (def.cadenceMin * 60_000)));
  return params;
}

/** Zdieľaná cache GetCapabilities (jedna pre všetky vrstvy, TTL 5 min). */
let _capsCache = { at: 0, promise: null };

/** Test-only. */
export function _resetEumetviewCapsForTest() { _capsCache = { at: 0, promise: null }; }

/**
 * Časy vrstiev z GetCapabilities, s TTL. Zlyhanie sa necachuje.
 * @param {object} [deps]
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {() => number} [deps.now]
 * @returns {Promise<Map<string, object>>}
 */
export function fetchEumetviewTimes({ fetchImpl = null, now = () => Date.now() } = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  const nowMs = now();
  if (_capsCache.promise && nowMs - _capsCache.at < EUMETVIEW_CAPS_TTL_MS) return _capsCache.promise;
  const promise = (async () => {
    const response = await doFetch(EUMETVIEW_CAPS_URL);
    if (!response?.ok) throw new Error(`EUMETView GetCapabilities HTTP ${response?.status ?? '?'}`);
    return parseEumetviewTimes(await response.text());
  })();
  _capsCache = { at: nowMs, promise };
  promise.catch(() => { if (_capsCache.promise === promise) _capsCache = { at: 0, promise: null }; });
  return promise;
}

/**
 * Továreň jednej živej vrstvy. Závislosti injektovateľné pre testy.
 * @param {EumetviewOverlayDef} def
 * @param {object} [deps]
 */
export function createEumetviewOverlayLayer(def, {
  fetchImpl = null,
  now = () => Date.now(),
  providerFactory = (d, params) => new Cesium.WebMapServiceImageryProvider({
    url: EUMETVIEW_WMS_URL,
    layers: d.layer,
    parameters: params,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    tileWidth: 256,
    tileHeight: 256,
    maximumLevel: d.level,
    rectangle: Cesium.Rectangle.fromDegrees(...EUMETVIEW_DISK_DEGREES),
    enablePickFeatures: false,
    credit: eumetviewCredit(),
  }),
  layerFactory = (provider) => new Cesium.ImageryLayer(provider),
} = {}) {
  let _viewer = null;
  let _enabled = false;
  let _opacity = def.opacity;
  /** ISO čas kresleného snímku; null = najnovší bez známeho času. */
  let _time = null;
  let _historical = false;
  let _lastError = null;
  let _imageryLayer = null;
  let _rowControlsListener = null;
  let _unbindStack = null;
  let _unbindDay = null;
  let _fadeRemover = null;
  const fade = gibsOverlayFade(def.level);

  const globeHidden = () => isGlobeHiddenForStack(getActiveMapStack());

  const applyAlpha = () => {
    if (!_imageryLayer) return;
    const alpha = _opacity * densityZoomFactor(_viewer?.scene?.camera?.positionCartographic?.height, fade);
    if (Math.abs((_imageryLayer.alpha ?? 1) - alpha) > 0.005) {
      _imageryLayer.alpha = alpha;
      governorRequestRender(`eumetview:${def.id}`);
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
  /** Jediný zapisovač imagery vrstvy: (znovu)postaví ju pre `_time`. */
  const mountLayer = () => {
    if (!_viewer?.imageryLayers) return;
    removeLayer();
    _imageryLayer = layerFactory(providerFactory(def, eumetviewWmsParameters(def, _time, now())));
    _imageryLayer.alpha = _opacity;
    insertOverlayLayer(_viewer.imageryLayers, _imageryLayer);
    attachFade();
    governorRequestRender(`eumetview:${def.id}`);
  };

  /**
   * Čas, ktorý sa má kresliť: posuvník na n → poludnie toho dňa (chyba pred
   * začiatkom archívu); na 0 → `default` z capabilities (pri zlyhaní null =
   * najnovší bez známeho času, riadok to povie).
   * @returns {Promise<{time: string|null, historical: boolean, error: string|null}>}
   */
  const resolveTime = async () => {
    const offset = getGibsDayOffset();
    if (offset > 0) {
      const day = gibsDayForOffset(offset, now());
      if (day < def.since) return { time: null, historical: true, error: t('eumet.before-archive', { day, since: def.since }) };
      return { time: eumetviewTimeForDay(day), historical: true, error: null };
    }
    try {
      const times = await fetchEumetviewTimes({ fetchImpl, now });
      const entry = times.get(def.layer);
      if (!entry?.defaultTime) return { time: null, historical: false, error: t('eumet.time-unknown') };
      return { time: entry.defaultTime, historical: false, error: null };
    } catch (error) {
      return { time: null, historical: false, error: t('eumet.time-unknown') };
    }
  };

  const layer = {
    id: def.id,
    name: def.id,
    icon: def.icon,
    get source() { return eumetviewSourceLabel(def, _time, now()); },
    updateInterval: EUMETVIEW_UPDATE_INTERVAL_MS,
    def,

    init(viewer) {
      _viewer = viewer;
      _enabled = false;
      _time = null;
      _historical = false;
      _lastError = null;
      _imageryLayer = null;
      _unbindStack?.();
      _unbindStack = onActiveMapStackChange(() => { _rowControlsListener?.(); });
      _unbindDay?.();
      _unbindDay = onGibsDayChange(() => { if (_enabled) layer.update(); });
    },

    enable() {
      _enabled = true;
      // Kresliť hneď: s posledným známym časom, alebo najnovší bez času
      // (cache-buster) — prázdny disk do prvej odpovede capabilities by
      // vyzeral ako chyba. update() čas doplní a vrstvu prestaví.
      mountLayer();
    },

    disable() {
      _enabled = false;
      detachFade();
      removeLayer();
      governorRequestRender(`eumetview:${def.id}`);
    },

    async update() {
      const resolved = await resolveTime();
      _lastError = resolved.error;
      _historical = resolved.historical;
      if (resolved.error && resolved.historical) {
        // Deň pred archívom: vrstva ostáva, riadok hlási dôvod.
        _rowControlsListener?.();
        return false;
      }
      if (resolved.time !== _time) {
        _time = resolved.time;
        if (_enabled) mountLayer();
      }
      _rowControlsListener?.();
      return !resolved.error;
    },

    destroy() {
      _enabled = false;
      detachFade();
      removeLayer();
      _unbindStack?.();
      _unbindStack = null;
      _unbindDay?.();
      _unbindDay = null;
      _viewer = null;
      _time = null;
      _lastError = null;
    },

    getParams() { return { opacity: _opacity }; },

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
        // RGB kompozit nemá škálu hodnôt — legenda by klamala.
        legend: [],
      };
    },

    setRowControlsListener(listener) {
      _rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    getStats() {
      const hidden = _enabled && globeHidden();
      const timeMs = Date.parse(_time || '');
      return {
        count: 0,
        lastUpdate: Number.isFinite(timeMs) ? timeMs : null,
        // Historický deň nie je výpadok; STALE len pri „najnovšom" snímku.
        stale: !_historical && eumetviewIsStale(_time, now()),
        error: hidden ? t('gibs.globe-only') : _lastError,
        day: _time ? _time.slice(0, 10) : null,
        time: _time,
        historical: _historical,
      };
    },
  };
  return layer;
}

const eumetviewOverlayLayers = EUMETVIEW_OVERLAYS.map((def) => createEumetviewOverlayLayer(def));

export default eumetviewOverlayLayers;
