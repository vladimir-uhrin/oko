// src/data/gfwSarDetections.js
// Radarové detekcie lodí · Sentinel-1 (Global Fishing Watch, 4Wings
// public-global-sar-presence), 2026-09-12 — používateľ: „ako by sa dalo získať
// reálne dáta?" → „sprav tie radarové detekcie". Sentinel-1 je radar (SAR):
// vidí lode bez ohľadu na AIS, cez oblaky aj v noci, ale len pri prelete
// (každé 2–3 dni, nad zálivom ~02:00 a ~14:00 UTC) a GFW to zverejní o ~3 dni.
// GFW detekcie páruje na AIS identitu; riadok bez MMSI/ID lode = detekcia BEZ
// ZHODY (loď s vypnutým AIS, malé plavidlo, plošina…) — v UI len „BEZ AIS",
// nikdy „tmavá loď" ako fakt. Vrstva ukazuje POSLEDNÝ PRELET každého objektu
// v okne 10 dní (bunka 0,01°) s časom preletu v karte; pri rušných moriach
// proxy spadne na denné bunky 0,1° (meta.mode 'sarDay') a popisky to priznajú.
//
// Vzhľad: kosoštvorec (radarový terč) — so zhodou vo farbe typu lode a s
// bodkou, bez zhody biely prázdny; stupeň veľkosti ako trupy živých lodí, útlm
// podľa veku preletu. Mená (spoločný overlay) len pri zhode. Pravidlo 2: riadok
// v paneli nesie okno, posledný prelet, pomer so zhodou/bez AIS, licenciu
// CC BY-NC 4.0; atribúcia GFW + Copernicus je v dataCredits.js. Token GFW nikdy
// neopúšťa server (/api/gfw/sar).

import * as Cesium from 'cesium';
import { currentLanguage, t } from '../i18n.js';
import { GFW_HIGH_CELL_DEG, GFW_SAR_WINDOW_DAYS } from './gfwPresenceCore.js';
import {
  GFW_PRESENCE_MAX_CAMERA_M, GFW_PRESENCE_MOVE_DEBOUNCE_MS,
  gfwDayLabel, gfwDegLabel, gfwViewBbox, gfwWhenLabel, sameBbox,
} from './gfwPresence.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import {
  VESSEL_CARD_FADE_DISTANCE_M,
  accentForVesselType,
  applyVesselOverlayPolicy,
  mmsiFlag,
  normalizeVesselType,
  vesselOverlayCohortLimit,
  vesselTypeCss,
} from './vesselLabels.js';
import { vesselTierScale } from './aisLiveVessels.js';
import { airIconTier } from './airIconLod.js';
import { clearOverlaySource, setOverlayEntries, setOverlaySourceVisible } from '../overlays/worldOverlay.js';

export const GFW_SAR_LAYER_ID = 'gfw-sar';
export const GFW_SAR_OVERLAY_SOURCE_ID = 'gfw-sar';
export const GFW_SAR_API = '/api/gfw/sar';
/** Najviac značiek v scéne naraz (celý záliv za 10 dní = ~3 000 objektov). */
export const GFW_SAR_MAX_POINTS = 6_000;
/** Najviac popisiek mien (len detekcie so zhodou s AIS). */
export const GFW_SAR_MAX_LABELS = 200;
/** Značka nad elipsoidom (m) — len proti z-fightu. */
export const GFW_SAR_POINT_HEIGHT_M = 20;
/** Farba detekcie bez zhody s AIS: neutrálna biela, nie výstražná — nevieme, čo to je. */
export const GFW_SAR_DARK_CSS = '#f2f6ff';
/** Základná mierka terča (ikona 32 px → 16 px) pri plnom stupni. */
const ICON_BASE_SCALE = 0.5;
const DAY_MS = 86_400_000;

const ICON_CACHE = new Map();

/**
 * Radarový terč ako SVG data URL: kosoštvorec s tmavým podkladom; so zhodou
 * s AIS má bodku v strede. Vnútro má jemnú výplň (12 %): Cesium pickuje len
 * nepriehľadné pixely a prázdny stred by kurzor minul — naživo 2026-09-12 sa
 * karta BEZ AIS neotvárala, kým bol kosoštvorec dutý. Pure (cache podľa farby a zhody).
 * @param {string} cssColor
 * @param {boolean} [matched]
 */
export function sarIconDataUrl(cssColor, matched = false) {
  const key = `${cssColor}|${matched ? 1 : 0}`;
  let url = ICON_CACHE.get(key);
  if (!url) {
    const dot = matched ? `<circle cx="16" cy="16" r="3.2" fill="${cssColor}"/>` : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">`
      + `<path d="M16 3 L29 16 L16 29 L3 16 Z" fill="${cssColor}" fill-opacity="0.12" stroke="#06131f" stroke-width="5" stroke-linejoin="round" opacity="0.7"/>`
      + `<path d="M16 3 L29 16 L16 29 L3 16 Z" fill="none" stroke="${cssColor}" stroke-width="2.4" stroke-linejoin="round"/>${dot}</svg>`;
    url = `data:image/svg+xml;base64,${btoa(svg)}`;
    ICON_CACHE.set(key, url);
  }
  return url;
}

/** Útlm podľa veku preletu: do 3 dní plný, do 6 dní stredný, staršie slabé. Pure. */
export function sarAgeAlpha(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs <= 3 * DAY_MS) return 0.95;
  if (ageMs <= 6 * DAY_MS) return 0.75;
  return 0.55;
}

const cellDegOf = (meta) => (Number.isFinite(meta?.cellDeg) ? meta.cellDeg : GFW_HIGH_CELL_DEG);
const daysOf = (meta) => (Number.isFinite(meta?.days) ? meta.days : GFW_SAR_WINDOW_DAYS);
const isDayMode = (meta) => meta?.mode === 'sarDay';
const isoDayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** „RADAR · 9. 9. 02:00 UTC" (hodinové bunky) alebo „RADAR · 9. 9." (denné). Pure. */
export function sarPassLabel(row, meta, translate = t, lang = currentLanguage()) {
  if (!Number.isFinite(row?.lastSeen)) return translate('sar.no-pass');
  if (isDayMode(meta)) return translate('sar.pass-short', { day: gfwDayLabel(isoDayOf(row.lastSeen), lang) });
  return translate('sar.pass', { when: gfwWhenLabel(row.lastSeen, lang) });
}

/** Krátka verzia pre popisky a zameriavače: „RADAR · 9. 9.". Pure. */
export function sarPassShortLabel(row, translate = t, lang = currentLanguage()) {
  if (!Number.isFinite(row?.lastSeen)) return translate('sar.no-pass');
  return translate('sar.pass-short', { day: gfwDayLabel(isoDayOf(row.lastSeen), lang) });
}

/** Zobrazované meno: meno lode, inak MMSI, inak VESSEL (so zhodou) alebo BEZ AIS. Pure. */
export function sarDisplayName(row, translate = t) {
  const name = String(row?.name || '').trim() || String(row?.mmsi || '').trim();
  if (name) return name;
  return row?.matched ? 'VESSEL' : translate('sar.dark');
}

/**
 * Riadok zdroja v paneli: okno, bunky, posledný prelet, pomer so zhodou/bez
 * AIS, licencia. Pure.
 * @param {{days?:number, cellDeg?:number, mode?:string, latestDay?:string|null}|null} meta
 * @param {{matched?:number, dark?:number}} [counts]
 */
export function sarSourceLabel(meta, counts = null, translate = t, lang = currentLanguage()) {
  const deg = gfwDegLabel(cellDegOf(meta), lang);
  const days = daysOf(meta);
  const pass = meta?.latestDay ? translate('sar.latest-pass', { day: gfwDayLabel(meta.latestDay, lang) }) : translate('sar.no-pass');
  const split = counts && (counts.matched || counts.dark)
    ? ` · ${translate('sar.split', { matched: counts.matched || 0, dark: counts.dark || 0 })}`
    : '';
  return `Global Fishing Watch · ${translate('sar.source', { deg, days })} · ${pass}${split} · CC BY-NC 4.0`;
}

/** „bunka 0,01° · N detekcií za 10 dní" so slovenským množným číslom (1 / 2–4 / 5+). Pure. */
export function sarCellNote(row, meta, translate = t, lang = currentLanguage()) {
  const n = Math.max(1, Math.round(Number(row?.detections) || 0));
  const key = n === 1 ? 'sar.cell-note-one' : (n <= 4 ? 'sar.cell-note-few' : 'sar.cell-note');
  return translate(key, { deg: gfwDegLabel(cellDegOf(meta), lang), n, days: daysOf(meta) });
}

/**
 * Súhrn pre kartičku pod kurzorom v tvare flights.getContactSummary. Pure.
 * @param {object} row riadok z proxy (key, matched, detections, lastSeen, …)
 * @param {object|null} meta
 */
export function sarContactSummary(row, meta, translate = t, lang = currentLanguage()) {
  if (!row) return null;
  const mmsi = String(row.mmsi || '').trim();
  const flag = mmsiFlag(mmsi);
  const matched = Boolean(row.matched);
  return {
    layerId: GFW_SAR_LAYER_ID,
    id: String(row.key || ''),
    callsign: sarDisplayName(row, translate),
    registration: String(row.callsign || '').trim() || null,
    // Bez zhody je titulkom BEZ AIS — v riadku stroja to neopakovať.
    operator: matched ? `${sarPassLabel(row, meta, translate, lang)} · ${translate('sar.matched')}` : sarPassLabel(row, meta, translate, lang),
    // Typ nikdy prázdny: bez neho by karta siahla po t('aircraft.category.…').
    type: matched ? (normalizeVesselType(row.type) || 'VESSEL') : translate('sar.type'),
    category: null,
    military: false,
    onGround: false,
    altitudeM: null,
    speedMps: null,
    verticalRateMps: null,
    trackDeg: null,
    routeInfo: null,
    progress: null,
    route: sarCellNote(row, meta, translate, lang),
    flightIata: null,
    source: 'Global Fishing Watch · Sentinel-1',
    lastContactEpochMs: Number.isFinite(row.lastSeen) ? row.lastSeen : null,
    stale: false,
    squawk: null,
    countryIso: flag?.iso2 || null,
    originCountry: flag?.name || null,
  };
}

/**
 * Popiska mena (len so zhodou s AIS) v tvare karty živých lodí: meno, vlajka,
 * „TYP · RADAR · deň". Novší prelet má prednosť. Pure.
 */
export function sarLabelCard(row, position, meta, translate = t, lang = currentLanguage(), nowMs = Date.now()) {
  const type = normalizeVesselType(row.type);
  const name = sarDisplayName(row, translate);
  const ageDays = Number.isFinite(row.lastSeen) ? Math.max(0, (nowMs - row.lastSeen) / DAY_MS) : 30;
  return {
    id: `sar:${row.key || `${row.lat},${row.lon}`}`,
    actionable: false,
    position,
    gapPx: 10,
    accent: accentForVesselType(row.type),
    title: name.length > 26 ? `${name.slice(0, 25)}…` : name,
    titleFlag: mmsiFlag(row.mmsi)?.iso2 || null,
    details: [[type, sarPassShortLabel(row, translate, lang)].filter(Boolean).join(' · ')],
    selected: false,
    priority: (row.name ? 1000 : 0) + (row.type ? 40 : 0) + Math.max(0, 400 - ageDays * 40),
  };
}

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

/**
 * Továreň vrstvy. Injektovateľné pre testy: fetchImpl, collectionFactory,
 * overlayHost, now.
 */
export function createGfwSarLayer({
  fetchImpl = null,
  collectionFactory = () => new Cesium.BillboardCollection(),
  overlayHost = DEFAULT_OVERLAY_HOST,
  now = () => Date.now(),
} = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  let _viewer = null;
  let _enabled = false;
  let _loading = false;
  let _error = null;
  let _status = 'idle'; // 'idle' | 'zoom-in' | 'live' | 'empty' | 'no_key'
  let _collection = null;
  let _rows = [];
  let _byId = new Map();
  let _meta = null;
  let _lastUpdate = null;
  let _bbox = null;
  let _iconTier = 'full';
  let _moveRemove = null;
  let _changedRemove = null;
  let _moveTimer = null;
  let _requestToken = 0;
  let _labelCount = 0;
  let _counts = { matched: 0, dark: 0 };
  const _scratchObjects = new Map();

  function iconScale() {
    return ICON_BASE_SCALE * vesselTierScale(_iconTier);
  }

  function clearBillboards() {
    if (_collection) _collection.removeAll?.();
    _byId = new Map();
    _scratchObjects.clear();
  }

  function renderRows(rows) {
    clearBillboards();
    if (!_collection) return;
    // Novší prelet a zhoda s AIS majú pri strope prednosť.
    const ordered = rows.slice().sort((a, b) => ((b.lastSeen ?? 0) - (a.lastSeen ?? 0)) || ((b.matched ? 1 : 0) - (a.matched ? 1 : 0)));
    const limit = Math.min(ordered.length, GFW_SAR_MAX_POINTS);
    const scale = iconScale();
    const nowMs = now();
    let matched = 0;
    let dark = 0;
    for (let i = 0; i < limit; i++) {
      const row = ordered[i];
      const key = String(row.key || `${row.lat},${row.lon}`);
      if (_byId.has(key)) continue;
      const isMatched = Boolean(row.matched);
      if (isMatched) matched += 1; else dark += 1;
      const css = isMatched ? vesselTypeCss(row.type) : GFW_SAR_DARK_CSS;
      const billboard = _collection.add({
        position: Cesium.Cartesian3.fromDegrees(row.lon, row.lat, GFW_SAR_POINT_HEIGHT_M),
        image: sarIconDataUrl(css, isMatched),
        scale,
        rotation: 0,
        alignedAxis: Cesium.Cartesian3.ZERO,
        color: Cesium.Color.WHITE.withAlpha(sarAgeAlpha(Number.isFinite(row.lastSeen) ? nowMs - row.lastSeen : Infinity)),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        id: { sar: true, key, mmsi: row.mmsi || '', name: row.name || '', matched: isMatched },
      });
      _byId.set(key, { row, billboard });
    }
    _counts = { matched, dark };
  }

  function syncTier() {
    const height = _viewer?.camera?.positionCartographic?.height;
    const next = airIconTier(height, _iconTier);
    if (next === _iconTier) return;
    _iconTier = next;
    const scale = iconScale();
    for (const { billboard } of _byId.values()) billboard.scale = scale;
    _viewer?.scene?.requestRender?.();
  }

  /** Popisky: len detekcie so zhodou, na obrazovke, podľa priority, strop GFW_SAR_MAX_LABELS. */
  function publishLabels() {
    if (!_enabled || !_byId.size) {
      _labelCount = 0;
      overlayHost.clearSource(GFW_SAR_OVERLAY_SOURCE_ID);
      return;
    }
    const scene = _viewer?.scene;
    const canvas = scene?.canvas;
    const width = Number(canvas?.clientWidth) || 0;
    const height = Number(canvas?.clientHeight) || 0;
    const project = typeof scene?.cartesianToCanvasCoordinates === 'function'
      ? (position) => scene.cartesianToCanvasCoordinates(position)
      : null;
    const nowMs = now();
    const cards = [];
    for (const { row, billboard } of _byId.values()) {
      if (!row.matched) continue;
      if (project && width && height) {
        const win = project(billboard.position);
        if (!win || win.x < 0 || win.y < 0 || win.x > width || win.y > height) continue;
      }
      cards.push(sarLabelCard(row, billboard.position, _meta, t, currentLanguage(), nowMs));
    }
    cards.sort((a, b) => b.priority - a.priority);
    const entries = cards.slice(0, GFW_SAR_MAX_LABELS).map((card) => applyVesselOverlayPolicy(card, VESSEL_CARD_FADE_DISTANCE_M));
    _labelCount = entries.length;
    const ambientLimit = vesselOverlayCohortLimit(width, height, GFW_SAR_MAX_LABELS);
    overlayHost.setEntries(GFW_SAR_OVERLAY_SOURCE_ID, entries, {
      cohortLimit: Math.max(1, ambientLimit),
      collisionCapacity: ambientLimit,
      moving: false,
    });
    overlayHost.setVisible(GFW_SAR_OVERLAY_SOURCE_ID, true);
  }

  async function load(bbox) {
    const token = ++_requestToken;
    _loading = true;
    _error = null;
    try {
      const url = `${GFW_SAR_API}?bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
      const response = await doFetch(url, { cache: 'no-store' });
      if (token !== _requestToken) return; // prekonaný novším dopytom
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        if (json?.error === 'no_key') { _status = 'no_key'; _error = t('gfw.no-key'); }
        else if (json?.error === 'budget' || response.status === 429) { _error = t('gfw.budget'); }
        else { _error = `HTTP ${response.status}`; }
        return;
      }
      const rows = Array.isArray(json?.rows) ? json.rows : [];
      _rows = rows;
      _meta = json?.meta || null;
      _bbox = bbox;
      _lastUpdate = now();
      _status = rows.length ? 'live' : 'empty';
      syncTier();
      renderRows(rows);
      publishLabels();
    } catch (err) {
      if (token === _requestToken) _error = err?.message || String(err);
    } finally {
      if (token === _requestToken) _loading = false;
      _viewer?.scene?.requestRender?.();
    }
  }

  function refreshForView({ force = false } = {}) {
    if (!_enabled || !_viewer) return;
    syncTier();
    const bbox = gfwViewBbox(_viewer, GFW_PRESENCE_MAX_CAMERA_M);
    if (!bbox) {
      _status = 'zoom-in';
      publishLabels();
      return;
    }
    if (!force && sameBbox(bbox, _bbox)) { publishLabels(); return; }
    void load(bbox);
  }

  function onMoveEnd() {
    syncTier();
    clearTimeout(_moveTimer);
    _moveTimer = setTimeout(() => refreshForView(), GFW_PRESENCE_MOVE_DEBOUNCE_MS);
  }

  const layer = {
    id: GFW_SAR_LAYER_ID,
    get name() { return t('layer.gfw-sar.name'); },
    icon: '◈',
    // Nový prelet pribudne najviac raz za deň; obnova rieši pohyb kamery.
    updateInterval: 60 * 60 * 1000,

    init(viewer) {
      _viewer = viewer;
      _collection = collectionFactory();
      _collection.show = false;
      viewer?.scene?.primitives?.add?.(_collection);
    },

    async enable() {
      _enabled = true;
      if (_collection) _collection.show = true;
      registerPickOwner(GFW_SAR_LAYER_ID, (pickedId) => layer.hasContact(pickedId));
      if (!_moveRemove && _viewer?.camera?.moveEnd?.addEventListener) {
        _moveRemove = _viewer.camera.moveEnd.addEventListener(onMoveEnd);
      }
      if (!_changedRemove && _viewer?.camera?.changed?.addEventListener) {
        _changedRemove = _viewer.camera.changed.addEventListener(syncTier);
      }
      refreshForView({ force: true });
    },

    disable() {
      _enabled = false;
      clearTimeout(_moveTimer);
      _moveTimer = null;
      _moveRemove?.();
      _moveRemove = null;
      _changedRemove?.();
      _changedRemove = null;
      unregisterPickOwner(GFW_SAR_LAYER_ID);
      if (_collection) _collection.show = false;
      _labelCount = 0;
      overlayHost.clearSource(GFW_SAR_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(GFW_SAR_OVERLAY_SOURCE_ID, false);
      _viewer?.scene?.requestRender?.();
    },

    update() {
      // Manažérsky tik: ak pribudol nový prelet, obnov ten istý výrez.
      if (_enabled && _bbox) void load(_bbox);
    },

    destroy(viewer) {
      layer.disable();
      const scene = viewer?.scene || _viewer?.scene;
      if (_collection && scene?.primitives?.remove) scene.primitives.remove(_collection);
      _collection = null;
      _rows = [];
      _byId = new Map();
      _meta = null;
      _viewer = null;
    },

    getStats() {
      const stats = {
        count: _rows.length,
        lastUpdate: _lastUpdate,
        loading: _loading,
        error: _error,
        source: sarSourceLabel(_meta, _rows.length ? _counts : null),
        status: _status === 'zoom-in' ? 'zoom-in' : (_status === 'empty' ? 'empty' : undefined),
      };
      if (_status === 'zoom-in') stats.loadingLabel = t('gfw.zoom-in');
      else if (_status === 'empty' && !_loading) stats.loadingLabel = t('sar.empty', { days: daysOf(_meta) });
      return stats;
    },

    hasContact(id) {
      const key = String(id ?? '').trim();
      return Boolean(key) && _byId.has(key);
    },

    getContactSummary(id) {
      const entry = _byId.get(String(id ?? '').trim());
      return entry ? sarContactSummary(entry.row, _meta) : null;
    },

    /**
     * Zameriavače: type 'SEA', klass = typ lode alebo RADAR, metric = prelet.
     * Objekt pod kurzorom ide vždy, ako v aisLiveVessels (2026-09-12).
     */
    getDetectableObjects(options = {}) {
      if (!_enabled || !_collection || !_collection.show) return [];
      const entries = [..._byId.values()];
      if (!entries.length) return [];
      const maxCount = Number.isFinite(options.maxCount) ? Math.max(1, Math.floor(options.maxCount)) : entries.length;
      const seed = Number.isFinite(options.seed) ? Math.floor(options.seed) : 0;
      const stride = Math.max(1, Math.ceil(entries.length / maxCount));
      const start = seed % stride;
      const forced = new Set();
      if (Array.isArray(options.hovered)) {
        for (const c of options.hovered) {
          if (c && String(c.layerId) === GFW_SAR_LAYER_ID && c.sourceId != null) forced.add(String(c.sourceId));
        }
      }
      const toObject = (entry) => {
        const { row, billboard } = entry;
        const key = String(row.key || `${row.lat},${row.lon}`);
        let object = _scratchObjects.get(key);
        if (!object) { object = { sourceId: key, type: 'SEA' }; _scratchObjects.set(key, object); }
        object.position = billboard.position;
        object.id = sarDisplayName(row);
        object.skipLabel = Boolean(row.matched); // meno má overlay; bez zhody nech zameriavač ukáže BEZ AIS
        object.klass = row.matched ? (normalizeVesselType(row.type) || 'VESSEL') : t('sar.type');
        object.metric = sarPassShortLabel(row);
        return object;
      };
      const isForced = (entry) => forced.has(String(entry.row.key || `${entry.row.lat},${entry.row.lon}`));
      const result = [];
      for (const entry of entries) if (isForced(entry)) result.push(toObject(entry));
      let budget = maxCount;
      for (let i = start; i < entries.length && budget > 0; i += stride) {
        const entry = entries[i];
        if (isForced(entry)) continue;
        result.push(toObject(entry));
        budget -= 1;
      }
      return result;
    },

    _getStateForTest() {
      return { enabled: _enabled, loading: _loading, error: _error, status: _status, rows: _rows.length, bbox: _bbox, meta: _meta, points: _byId.size, labels: _labelCount, iconTier: _iconTier, counts: { ..._counts } };
    },
  };

  return layer;
}

const gfwSarDetectionsLayer = createGfwSarLayer();
export default gfwSarDetectionsLayer;
