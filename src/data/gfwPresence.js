// src/data/gfwPresence.js
// Satelitné AIS · oneskorené (Global Fishing Watch, 4Wings public-global-presence),
// 2026-09-12. Používateľ: „lode okrem Európy nevidí skoro nikde… potrebujem
// aktuálne dáta alebo len trochu staré". Terestriálny AISStream v Perzskom
// zálive nemá ani jednu loď; GFW zbiera AIS aj satelitmi, ale s oneskorením
// ~72 h a v mriežke 0,1° (~11 km). Táto vrstva teda ukazuje POSLEDNÚ POZOROVANÚ
// BUNKU každej lode v okne dvoch dní pred oneskorením — nie živú polohu.
//
// Vzhľad (2026-09-12, „sprav ako ostatné lode, len pridaj poznámku
// oneskorené"): ten istý trup a farba podľa typu ako živé lode
// (shipIconDataUrl + vesselTypeCss), rovnaký stupeň veľkosti podľa výšky
// kamery, mená ako karty v spoločnom overlay-i — ale bez kurzu (bunka nemá
// smer, prova mieri na sever) a s riadkom „ONESKORENÉ ~72 h" v popiske aj v
// karte pod kurzorom. Pravidlo 2: riadok v paneli nesie obdobie, licenciu
// CC BY-NC 4.0 a ONESKORENÉ; atribúcia „Powered by Global Fishing Watch." je
// v dataCredits.js. Token GFW nikdy neopúšťa server (/api/gfw/presence).

import * as Cesium from 'cesium';
import { t } from '../i18n.js';
import { GFW_CELL_DEG, GFW_DELAY_HOURS, quantizeGfwBbox } from './gfwPresenceCore.js';
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
import { shipIconDataUrl, vesselTierScale } from './aisLiveVessels.js';
import { airIconTier } from './airIconLod.js';
import { clearOverlaySource, setOverlayEntries, setOverlaySourceVisible } from '../overlays/worldOverlay.js';

export const GFW_PRESENCE_LAYER_ID = 'gfw-presence';
export const GFW_PRESENCE_OVERLAY_SOURCE_ID = 'gfw-presence';
export const GFW_PRESENCE_API = '/api/gfw/presence';
/** Nad touto výškou kamery sa nepýtame — výrez by prekročil strop proxy (40°) a trupy by splynuli. */
export const GFW_PRESENCE_MAX_CAMERA_M = 4_000_000;
/** Najviac lodí v scéne naraz (v hustom výreze je to strop, nie cieľ). */
export const GFW_PRESENCE_MAX_POINTS = 6_000;
/** Najviac popisiek mien ponúknutých overlay-u (ten si z nich vyberie kohortu bez kolízií). */
export const GFW_PRESENCE_MAX_LABELS = 300;
/** Debounce po pohybe kamery (ms), aby sa pri plynulom zoome nestrieľali dopyty. */
export const GFW_PRESENCE_MOVE_DEBOUNCE_MS = 1_500;
/** Trup nad elipsoidom (m) — bunka 0,1° nemá presnú polohu, výška je len proti z-fightu. */
export const GFW_PRESENCE_POINT_HEIGHT_M = 20;
/** Základná mierka trupu = živá loď bez rýchlosti (shipSpeedScale < 8 kn). */
const HULL_BASE_SCALE = 0.6;
/** Jemný útlm: oneskorené lode nesmú byť výraznejšie než živé, ale musia mať tú istú farbu. */
const HULL_ALPHA = 0.88;

/**
 * Výrez z pohľadu kamery (°) alebo null nad stropom výšky / bez obdĺžnika.
 * @param {object} viewer
 * @returns {{west:number,south:number,east:number,north:number}|null}
 */
export function gfwViewBbox(viewer, maxCameraM = GFW_PRESENCE_MAX_CAMERA_M) {
  const camera = viewer?.camera;
  if (!camera || !(camera.positionCartographic?.height <= maxCameraM)) return null;
  const rect = camera.computeViewRectangle?.(Cesium.Ellipsoid.WGS84);
  if (!rect) return null;
  const west = Cesium.Math.toDegrees(rect.west);
  const east = Cesium.Math.toDegrees(rect.east);
  const south = Cesium.Math.toDegrees(rect.south);
  const north = Cesium.Math.toDegrees(rect.north);
  if (![west, east, south, north].every(Number.isFinite) || !(west < east) || !(south < north)) return null;
  return quantizeGfwBbox({ west, south, east, north });
}

/** Rovnaký výrez = rovnaký dopyt. Pure. */
export function sameBbox(a, b) {
  return Boolean(a && b) && a.west === b.west && a.east === b.east && a.south === b.south && a.north === b.north;
}

/**
 * Riadok zdroja v paneli: obdobie okna, oneskorenie, licencia, ONESKORENÉ. Pure.
 * @param {{range?:{from:string,to:string}, delayHours?:number}|null} meta
 */
export function gfwSourceLabel(meta, translate = t) {
  const delay = Number.isFinite(meta?.delayHours) ? meta.delayHours : GFW_DELAY_HOURS;
  const period = meta?.range?.from && meta?.range?.to ? `${meta.range.from} – ${meta.range.to}` : translate('gfw.window-pending');
  return `Global Fishing Watch · ${translate('gfw.satellite-ais')} · ${period} · CC BY-NC 4.0 · ${translate('gfw.delayed', { h: delay })}`;
}

/** Zobrazované meno: meno lode, inak MMSI, inak VESSEL. Pure. */
export function gfwDisplayName(row) {
  return String(row?.name || '').trim() || String(row?.mmsi || '').trim() || 'VESSEL';
}

/**
 * Súhrn pre kartičku pod kurzorom v tvare flights.getContactSummary. Pure.
 * @param {object} row riadok z proxy
 * @param {{range?:{from:string,to:string}, delayHours?:number}|null} meta
 */
export function gfwContactSummary(row, meta, translate = t) {
  if (!row) return null;
  const mmsi = String(row.mmsi || '').trim();
  const flag = mmsiFlag(mmsi);
  const delay = Number.isFinite(meta?.delayHours) ? meta.delayHours : GFW_DELAY_HOURS;
  return {
    layerId: GFW_PRESENCE_LAYER_ID,
    id: mmsi || String(row.vesselId || row.name || ''),
    callsign: gfwDisplayName(row),
    registration: String(row.callsign || '').trim() || null,
    operator: translate('gfw.delayed', { h: delay }),
    // Typ nikdy prázdny: bez neho by karta siahla po t('aircraft.category.…').
    type: normalizeVesselType(row.type) || 'VESSEL',
    category: null,
    military: false,
    onGround: false,
    altitudeM: null,
    speedMps: null,
    verticalRateMps: null,
    trackDeg: null,
    routeInfo: null,
    progress: null,
    route: translate('gfw.cell-note', { deg: String(GFW_CELL_DEG).replace('.', ','), hours: Number.isFinite(row.hours) ? Math.round(row.hours * 10) / 10 : 0 }),
    flightIata: null,
    source: 'Global Fishing Watch',
    lastContactEpochMs: Number.isFinite(row.lastSeen) ? row.lastSeen : null,
    stale: false,
    squawk: null,
    countryIso: flag?.iso2 || null,
    originCountry: flag?.name || null,
  };
}

/**
 * Popiska mena v tvare karty živých lodí (buildVesselCard), s riadkom
 * ONESKORENÉ namiesto rýchlosti a kurzu. Pure.
 */
export function gfwLabelCard(row, position, meta, translate = t) {
  const delay = Number.isFinite(meta?.delayHours) ? meta.delayHours : GFW_DELAY_HOURS;
  const type = normalizeVesselType(row.type);
  const name = gfwDisplayName(row);
  return {
    id: `gfw:${row.mmsi || row.vesselId || `${row.lat},${row.lon}`}`,
    actionable: false,
    position,
    gapPx: 10,
    accent: accentForVesselType(row.type),
    title: name.length > 26 ? `${name.slice(0, 25)}…` : name,
    titleFlag: mmsiFlag(row.mmsi)?.iso2 || null,
    details: [[type, translate('gfw.delayed', { h: delay })].filter(Boolean).join(' · ')],
    selected: false,
    priority: (row.name ? 1000 : 0) + (row.type ? 40 : 0) + Math.min(400, Math.max(0, Number(row.hours) || 0) * 10),
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
export function createGfwPresenceLayer({
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
  const _scratchObjects = new Map();

  function rowKey(row) {
    return String(row.mmsi || row.vesselId || `${row.lat},${row.lon}`);
  }

  function hullScale() {
    return HULL_BASE_SCALE * vesselTierScale(_iconTier);
  }

  function clearBillboards() {
    if (_collection) _collection.removeAll?.();
    _byId = new Map();
  }

  function renderRows(rows) {
    clearBillboards();
    if (!_collection) return;
    const limit = Math.min(rows.length, GFW_PRESENCE_MAX_POINTS);
    const scale = hullScale();
    for (let i = 0; i < limit; i++) {
      const row = rows[i];
      const id = { mmsi: String(row.mmsi || ''), gfw: true, name: row.name || '', key: rowKey(row) };
      const billboard = _collection.add({
        id,
        position: Cesium.Cartesian3.fromDegrees(row.lon, row.lat, GFW_PRESENCE_POINT_HEIGHT_M),
        // Ten istý trup a farba podľa typu ako živé lode; bez kurzu ostáva
        // prova na sever (rotation 0), lebo bunka 0,1° smer nemá.
        image: shipIconDataUrl(vesselTypeCss(row.type)),
        scale,
        rotation: 0,
        alignedAxis: Cesium.Cartesian3.ZERO,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        color: Cesium.Color.WHITE.withAlpha(HULL_ALPHA),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
      _byId.set(id.key, { row, billboard });
    }
  }

  function syncTier() {
    const height = _viewer?.camera?.positionCartographic?.height;
    const next = airIconTier(height, _iconTier);
    if (next === _iconTier) return;
    _iconTier = next;
    const scale = hullScale();
    for (const { billboard } of _byId.values()) billboard.scale = scale;
    _viewer?.scene?.requestRender?.();
  }

  /** Popisky: len lode na obrazovke, zoradené podľa priority, strop GFW_PRESENCE_MAX_LABELS. */
  function publishLabels() {
    if (!_enabled || !_byId.size) {
      _labelCount = 0;
      overlayHost.clearSource(GFW_PRESENCE_OVERLAY_SOURCE_ID);
      return;
    }
    const scene = _viewer?.scene;
    const canvas = scene?.canvas;
    const width = Number(canvas?.clientWidth) || 0;
    const height = Number(canvas?.clientHeight) || 0;
    const project = typeof scene?.cartesianToCanvasCoordinates === 'function'
      ? (position) => scene.cartesianToCanvasCoordinates(position)
      : null;
    const cards = [];
    for (const { row, billboard } of _byId.values()) {
      if (project && width && height) {
        const win = project(billboard.position);
        if (!win || win.x < 0 || win.y < 0 || win.x > width || win.y > height) continue;
      }
      cards.push(gfwLabelCard(row, billboard.position, _meta));
    }
    cards.sort((a, b) => b.priority - a.priority);
    const entries = cards.slice(0, GFW_PRESENCE_MAX_LABELS).map((card) => applyVesselOverlayPolicy(card, VESSEL_CARD_FADE_DISTANCE_M));
    _labelCount = entries.length;
    const ambientLimit = vesselOverlayCohortLimit(width, height, GFW_PRESENCE_MAX_LABELS);
    overlayHost.setEntries(GFW_PRESENCE_OVERLAY_SOURCE_ID, entries, {
      cohortLimit: Math.max(1, ambientLimit),
      collisionCapacity: ambientLimit,
      moving: false,
    });
    overlayHost.setVisible(GFW_PRESENCE_OVERLAY_SOURCE_ID, true);
  }

  async function load(bbox) {
    const token = ++_requestToken;
    _loading = true;
    _error = null;
    try {
      const url = `${GFW_PRESENCE_API}?bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
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
    const bbox = gfwViewBbox(_viewer);
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
    id: GFW_PRESENCE_LAYER_ID,
    get name() { return t('layer.gfw-presence.name'); },
    icon: '◇',
    // Dáta sa menia raz denne; obnova rieši pohyb kamery, nie interval.
    updateInterval: 30 * 60 * 1000,

    init(viewer) {
      _viewer = viewer;
      _collection = collectionFactory();
      _collection.show = false;
      viewer?.scene?.primitives?.add?.(_collection);
    },

    async enable() {
      _enabled = true;
      if (_collection) _collection.show = true;
      registerPickOwner(GFW_PRESENCE_LAYER_ID, (pickedId) => layer.hasContact(pickedId));
      if (!_moveRemove && _viewer?.camera?.moveEnd?.addEventListener) {
        _moveRemove = _viewer.camera.moveEnd.addEventListener(onMoveEnd);
      }
      // Stupeň trupu sleduje kameru už počas letu ako pri živých lodiach, nie až
      // po moveEnd + debounce dopytu (naživo 2026-09-12: pri 220 km ostal micro).
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
      unregisterPickOwner(GFW_PRESENCE_LAYER_ID);
      if (_collection) _collection.show = false;
      _labelCount = 0;
      overlayHost.clearSource(GFW_PRESENCE_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(GFW_PRESENCE_OVERLAY_SOURCE_ID, false);
      _viewer?.scene?.requestRender?.();
    },

    update() {
      // Manažérsky tik: ak sa deň otočil, okno sa posunulo — obnov ten istý výrez.
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
        source: gfwSourceLabel(_meta),
        status: _status === 'zoom-in' ? 'zoom-in' : (_status === 'empty' ? 'empty' : undefined),
      };
      if (_status === 'zoom-in') stats.loadingLabel = t('gfw.zoom-in');
      else if (_status === 'empty' && !_loading) stats.loadingLabel = t('gfw.empty');
      return stats;
    },

    hasContact(id) {
      const key = String(id ?? '').trim();
      if (!key) return false;
      return _byId.has(key) || _rows.some((r) => String(r.mmsi) === key);
    },

    getContactSummary(id) {
      const key = String(id ?? '').trim();
      const entry = _byId.get(key) || [..._byId.values()].find((e) => String(e.row.mmsi) === key);
      return entry ? gfwContactSummary(entry.row, _meta) : null;
    },

    /**
     * Zameriavače: type 'SEA', klass = typ lode, metric = oneskorenie.
     * Loď pod kurzorom ide vždy, rovnako ako v aisLiveVessels (2026-09-12).
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
          if (c && String(c.layerId) === GFW_PRESENCE_LAYER_ID && c.sourceId != null) forced.add(String(c.sourceId));
        }
      }
      const delay = Number.isFinite(_meta?.delayHours) ? _meta.delayHours : GFW_DELAY_HOURS;
      const toObject = (entry) => {
        const { row, billboard } = entry;
        const key = rowKey(row);
        let object = _scratchObjects.get(key);
        if (!object) {
          object = { sourceId: row.mmsi || key, type: 'SEA', skipLabel: false };
          _scratchObjects.set(key, object);
        }
        object.position = billboard.position;
        object.id = gfwDisplayName(row);
        object.klass = row.type ? normalizeVesselType(row.type).toUpperCase().slice(0, 14) || undefined : undefined;
        object.metric = t('gfw.delayed', { h: delay });
        return object;
      };
      const isForced = (entry) => forced.has(String(entry.row.mmsi)) || forced.has(rowKey(entry.row));
      const result = [];
      for (const entry of entries) if (isForced(entry)) result.push(toObject(entry));
      let sampled = 0;
      for (let idx = 0; idx < entries.length; idx += 1) {
        if (((idx - start) % stride) !== 0) continue;
        const entry = entries[idx];
        if (isForced(entry)) continue;
        result.push(toObject(entry));
        sampled += 1;
        if (sampled >= maxCount) break;
      }
      return result;
    },

    _getStateForTest() {
      return { enabled: _enabled, loading: _loading, error: _error, status: _status, rows: _rows.length, bbox: _bbox, meta: _meta, points: _byId.size, labels: _labelCount, iconTier: _iconTier };
    },
  };

  return layer;
}

const gfwPresenceLayer = createGfwPresenceLayer();
export default gfwPresenceLayer;
