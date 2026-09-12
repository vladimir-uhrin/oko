// src/data/gfwPresence.js
// Satelitné AIS · oneskorené (Global Fishing Watch, 4Wings public-global-presence),
// 2026-09-12. Používateľ: „lode okrem Európy nevidí skoro nikde… potrebujem
// aktuálne dáta alebo len trochu staré". Terestriálny AISStream v Perzskom
// zálive nemá ani jednu loď; GFW zbiera AIS aj satelitmi, ale s oneskorením
// ~72 h a v mriežke 0,1° (~11 km). Táto vrstva teda ukazuje POSLEDNÚ POZOROVANÚ
// BUNKU každej lode v okne dvoch dní pred oneskorením — nie živú polohu.
// Pravidlo 2 (zdroj a stav viditeľné): riadok v paneli aj karta nesú
// „ONESKORENÉ 72 h", obdobie a licenciu CC BY-NC 4.0; atribúcia „Powered by
// Global Fishing Watch." je v dataCredits.js. Token GFW nikdy neopúšťa server
// (/api/gfw/presence, vite.config.js gfwPresenceProxy).
//
// Tvar podľa existujúcich vrstiev: init/enable/disable/update/destroy/getStats,
// getDetectableObjects (zameriavače, type 'SEA' + hovered navyše ako lode),
// getContactSummary (kartička pod kurzorom v tvare flights), hasContact,
// pick owner (klik na bod nesmie odznačiť sledované lietadlo).

import * as Cesium from 'cesium';
import { t } from '../i18n.js';
import { GFW_CELL_DEG, GFW_DELAY_HOURS, quantizeGfwBbox } from './gfwPresenceCore.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { mmsiFlag, normalizeVesselType } from './vesselLabels.js';

export const GFW_PRESENCE_LAYER_ID = 'gfw-presence';
export const GFW_PRESENCE_API = '/api/gfw/presence';
/** Nad touto výškou kamery sa nepýtame — výrez by prekročil strop proxy (40°) a body by splynuli. */
export const GFW_PRESENCE_MAX_CAMERA_M = 4_000_000;
/** Najviac bodov v scéne naraz (v hustom výreze je to strop, nie cieľ). */
export const GFW_PRESENCE_MAX_POINTS = 6_000;
/** Debounce po pohybe kamery (ms), aby sa pri plynulom zoome nestrieľali dopyty. */
export const GFW_PRESENCE_MOVE_DEBOUNCE_MS = 1_500;
/** Bod nad elipsoidom (m) — bunka 0,1° nemá presnú polohu, výška je len proti z-fightu. */
export const GFW_PRESENCE_POINT_HEIGHT_M = 20;
/** Uzly → m/s pre spoločný formátovač karty (GFW rýchlosť nedáva; ostáva null). */
const AMBER = 'rgba(255,196,84,0.95)';
const AMBER_OUTLINE = 'rgba(40,24,0,0.9)';

/**
 * Výrez z pohľadu kamery (°) alebo null nad stropom výšky / bez obdĺžnika. Pure okrem Cesia.
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

/**
 * Súhrn pre kartičku pod kurzorom v tvare flights.getContactSummary. Pure.
 * @param {object} row riadok z proxy
 * @param {{range?:{from:string,to:string}, delayHours?:number}|null} meta
 */
export function gfwContactSummary(row, meta, translate = t) {
  if (!row) return null;
  const mmsi = String(row.mmsi || '').trim();
  const flag = mmsiFlag(mmsi);
  const typeLabel = normalizeVesselType(row.type) || 'VESSEL';
  const delay = Number.isFinite(meta?.delayHours) ? meta.delayHours : GFW_DELAY_HOURS;
  return {
    layerId: GFW_PRESENCE_LAYER_ID,
    id: mmsi || String(row.vesselId || row.name || ''),
    callsign: String(row.name || '').trim() || mmsi || 'VESSEL',
    registration: null,
    operator: translate('gfw.delayed', { h: delay }),
    type: typeLabel,
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
 * Továreň vrstvy. Injektovateľné pre testy: fetchImpl, collectionFactory, now.
 */
export function createGfwPresenceLayer({
  fetchImpl = null,
  collectionFactory = () => new Cesium.PointPrimitiveCollection(),
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
  let _moveRemove = null;
  let _moveTimer = null;
  let _requestToken = 0;
  const _scratchObjects = new Map();

  function clearPoints() {
    if (_collection) _collection.removeAll?.();
    _byId = new Map();
  }

  function rowKey(row) {
    return String(row.mmsi || row.vesselId || `${row.lat},${row.lon}`);
  }

  function renderRows(rows) {
    clearPoints();
    if (!_collection) return;
    const limit = Math.min(rows.length, GFW_PRESENCE_MAX_POINTS);
    for (let i = 0; i < limit; i++) {
      const row = rows[i];
      const id = { mmsi: String(row.mmsi || ''), gfw: true, name: row.name || '', key: rowKey(row) };
      const point = _collection.add({
        id,
        position: Cesium.Cartesian3.fromDegrees(row.lon, row.lat, GFW_PRESENCE_POINT_HEIGHT_M),
        // Prázdny kosoštvorec v jantárovej: odlíšiteľné od cyanových živých lodí,
        // farba nesie „historické/oneskorené" ako pri hustote letov.
        pixelSize: 7,
        color: Cesium.Color.fromCssColorString('rgba(255,196,84,0.18)'),
        outlineColor: Cesium.Color.fromCssColorString(AMBER),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(200_000, 1.4, 4_000_000, 0.6),
      });
      _byId.set(id.key, { row, point });
    }
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
      renderRows(rows);
    } catch (err) {
      if (token === _requestToken) _error = err?.message || String(err);
    } finally {
      if (token === _requestToken) _loading = false;
      _viewer?.scene?.requestRender?.();
    }
  }

  function refreshForView({ force = false } = {}) {
    if (!_enabled || !_viewer) return;
    const bbox = gfwViewBbox(_viewer);
    if (!bbox) {
      _status = 'zoom-in';
      return;
    }
    if (!force && sameBbox(bbox, _bbox)) return;
    void load(bbox);
  }

  function onMoveEnd() {
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
      registerPickOwner(GFW_PRESENCE_LAYER_ID, (pickedId) => _byId.has(String(pickedId)) || [..._byId.values()].some((e) => e.row.mmsi === String(pickedId)));
      if (!_moveRemove && _viewer?.camera?.moveEnd?.addEventListener) {
        _moveRemove = _viewer.camera.moveEnd.addEventListener(onMoveEnd);
      }
      refreshForView({ force: true });
    },

    disable() {
      _enabled = false;
      clearTimeout(_moveTimer);
      _moveTimer = null;
      _moveRemove?.();
      _moveRemove = null;
      unregisterPickOwner(GFW_PRESENCE_LAYER_ID);
      if (_collection) _collection.show = false;
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
        const { row, point } = entry;
        const key = rowKey(row);
        let object = _scratchObjects.get(key);
        if (!object) {
          object = { sourceId: row.mmsi || key, type: 'SEA', skipLabel: false };
          _scratchObjects.set(key, object);
        }
        object.position = point.position;
        object.id = row.name || row.mmsi || 'VESSEL';
        object.klass = row.type ? normalizeVesselType(row.type).toUpperCase().slice(0, 14) || undefined : undefined;
        object.metric = t('gfw.delayed', { h: delay });
        return object;
      };
      const result = [];
      for (const entry of entries) {
        if (forced.has(String(entry.row.mmsi)) || forced.has(rowKey(entry.row))) result.push(toObject(entry));
      }
      let sampled = 0;
      for (let idx = 0; idx < entries.length; idx += 1) {
        if (((idx - start) % stride) !== 0) continue;
        const entry = entries[idx];
        if (forced.has(String(entry.row.mmsi)) || forced.has(rowKey(entry.row))) continue;
        result.push(toObject(entry));
        sampled += 1;
        if (sampled >= maxCount) break;
      }
      return result;
    },

    _getStateForTest() {
      return { enabled: _enabled, loading: _loading, error: _error, status: _status, rows: _rows.length, bbox: _bbox, meta: _meta, points: _byId.size };
    },
  };

  return layer;
}

const gfwPresenceLayer = createGfwPresenceLayer();
export default gfwPresenceLayer;
