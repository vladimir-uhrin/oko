// src/data/gfwPresence.js
// Satelitné AIS · oneskorené (Global Fishing Watch, 4Wings public-global-presence),
// 2026-09-12. Používateľ: „lode okrem Európy nevidí skoro nikde… potrebujem
// aktuálne dáta alebo len trochu staré". Terestriálny AISStream v Perzskom
// zálive nemá ani jednu loď; GFW zbiera AIS aj satelitmi, ale s oneskorením
// (posledný úplný deň je D−4) a v bunkách mriežky. Vrstva ukazuje POSLEDNÚ
// HODINOVÚ BUNKU 0,01° (~1 km) každej lode v ten deň — nie živú polohu; pri
// rušných moriach proxy spadne na denné bunky 0,1° a meta.mode to povie
// (2026-09-12, „prečo nemajú pozície?" — v mriežke 0,1° stáli lode v stĺpcoch).
//
// Vzhľad (2026-09-12, „sprav ako ostatné lode, len pridaj poznámku
// oneskorené"): ten istý trup a farba podľa typu ako živé lode
// (shipIconDataUrl + vesselTypeCss), rovnaký stupeň veľkosti podľa výšky
// kamery, mená ako karty v spoločnom overlay-i — ale bez kurzu (bunka nemá
// smer, prova mieri na sever) a s riadkom „ONESKORENÉ · deň" v popiske aj v
// karte pod kurzorom. Pravidlo 2: riadok v paneli nesie bunky, režim, licenciu
// CC BY-NC 4.0 a deň dát; atribúcia „Powered by Global Fishing Watch." je
// v dataCredits.js. Token GFW nikdy neopúšťa server (/api/gfw/presence).

import * as Cesium from 'cesium';
import { currentLanguage, t } from '../i18n.js';
import { GFW_CELL_DEG, GFW_HIGH_CELL_DEG, quantizeGfwBbox } from './gfwPresenceCore.js';
import { isOwnedByOtherLayer, registerPickOwner, resolvePickId, unregisterPickOwner } from './pickRegistry.js';
import { HISTORY_LINE_STYLE, createVesselVoyageLine, historyLinePositionsDeg } from './vesselVoyageLine.js';
import { buildVesselTrackedEntry, clearVesselEstimateFor, syncVesselEstimate } from './vesselTrackedCard.js';
import { seaRoutePositionsDeg, seaRouteSync } from './seaRoute.js';
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
import { localizedTypeDetail, newerPositionLine, portHistoryLine, vesselHullParts, vesselRegistryParts, vesselVoyageModel, voyageDepartureLine, voyageRouteInfo } from './vesselCardDetails.js';
import { cachedVesselInfo, lookupVesselInfo } from './vesselInfo.js';
import { cachedPortIndex } from './vesselPortIndex.js';
import { clearOverlaySource, hitTestWorldOverlay, setOverlayEntries, setOverlaySourceVisible } from '../overlays/worldOverlay.js';

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
/** Po 429 (GFW odmietol súbežný report, proxy limit) jeden tichý pokus bez pohybu kamery. */
export const GFW_PRESENCE_RETRY_MS = 30_000;
/** Trup nad elipsoidom (m) — bunka nemá presnú polohu, výška je len proti z-fightu. */
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

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** „2026-09-08" → „8. 9." (sk) / „8 Sep" (en). Pure. */
export function gfwDayLabel(isoDay, lang = currentLanguage()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDay || ''));
  if (!m) return String(isoDay || '');
  const d = Number(m[3]);
  const mo = Number(m[2]);
  return lang === 'sk' ? `${d}. ${mo}.` : `${d} ${EN_MONTHS[mo - 1] || mo}`;
}

/** Veľkosť bunky: 0.01 → „0,01" (sk) / „0.01" (en). Pure. */
export function gfwDegLabel(deg, lang = currentLanguage()) {
  const text = String(Number.isFinite(deg) ? deg : GFW_CELL_DEG);
  return lang === 'sk' ? text.replace('.', ',') : text;
}

/** Hodina UTC z epochy: „8. 9. 23:00" / „8 Sep 23:00"; bez času prázdne. Pure. */
export function gfwWhenLabel(epochMs, lang = currentLanguage()) {
  if (!Number.isFinite(epochMs)) return '';
  const d = new Date(epochMs);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${gfwDayLabel(d.toISOString().slice(0, 10), lang)} ${hh}:${mm}`;
}

const cellDegOf = (meta) => (Number.isFinite(meta?.cellDeg) ? meta.cellDeg : GFW_HIGH_CELL_DEG);
const isDayCellMode = (meta) => meta?.mode === 'dayCell';

/** Krátka poznámka „ONESKORENÉ · deň" pre popisky a zameriavače. Pure. */
export function gfwDelayedLabel(meta, translate = t, lang = currentLanguage()) {
  return meta?.day ? translate('gfw.delayed', { day: gfwDayLabel(meta.day, lang) }) : translate('gfw.window-pending');
}

/**
 * Riadok zdroja v paneli: bunky, režim, licencia, ONESKORENÉ · dáta k dňu. Pure.
 * @param {{day?:string, cellDeg?:number, mode?:string}|null} meta
 */
export function gfwSourceLabel(meta, translate = t, lang = currentLanguage()) {
  const deg = gfwDegLabel(cellDegOf(meta), lang);
  const mode = translate(isDayCellMode(meta) ? 'gfw.mode-day' : 'gfw.mode-hourly');
  const delayed = meta?.day ? translate('gfw.delayed-long', { day: gfwDayLabel(meta.day, lang) }) : translate('gfw.window-pending');
  return `Global Fishing Watch · ${translate('gfw.satellite-ais', { deg })} · ${mode} · CC BY-NC 4.0 · ${delayed}`;
}

/** Zobrazované meno: meno lode, inak MMSI, inak VESSEL. Pure. */
export function gfwDisplayName(row) {
  return String(row?.name || '').trim() || String(row?.mmsi || '').trim() || 'VESSEL';
}

/**
 * Poznámka o bunke pre kartu: posledná hodinová bunka s časom UTC, alebo denná
 * bunka (najviac hodín) v záložnom režime. Hodiny = súčet za deň. Pure.
 */
export function gfwCellNote(row, meta, translate = t, lang = currentLanguage()) {
  const deg = gfwDegLabel(cellDegOf(meta), lang);
  const hours = Number.isFinite(row?.hours) ? Math.round(row.hours * 10) / 10 : 0;
  if (isDayCellMode(meta) || !Number.isFinite(row?.lastSeen)) return translate('gfw.cell-note-day', { deg, hours });
  return translate('gfw.cell-note', { deg, when: gfwWhenLabel(row.lastSeen, lang), hours });
}

/**
 * Súhrn pre kartičku pod kurzorom v tvare flights.getContactSummary. Pure.
 * @param {object} row riadok z proxy
 * @param {{day?:string, cellDeg?:number, mode?:string}|null} meta
 */
export function gfwContactSummary(row, meta, translate = t, lang = currentLanguage()) {
  if (!row) return null;
  const mmsi = String(row.mmsi || '').trim();
  const flag = mmsiFlag(mmsi);
  // 2026-10-10 (vlastník: „prečo keď na ňu prejdem myšou ukazuje len tak málo informácií?"):
  // register lodí ako pri živých lodiach — podrobný typ, rok, GT/DWT, IMO, rozmery,
  // posledný prístav a odchod, fotka. Priebeh plavby ani miestny čas NIE: poloha je
  // stará ~3 dni, percento by klamalo o dnešku.
  const info = /^\d{9}$/.test(mmsi) ? cachedVesselInfo(mmsi) || null : null;
  const voyage = info ? vesselVoyageModel(row, info, cachedPortIndex()) : null;
  const registryType = info?.typeDetail ? localizedTypeDetail(info.typeDetail, lang) : null;
  const extraLines = [
    // Novšia poloha z registra (MINERVA: GFW má 6. 10., register 10. 10. pri USA).
    newerPositionLine(info, Number.isFinite(row.lastSeen) ? row.lastSeen : null, translate, lang),
    voyageDepartureLine(voyage, translate, lang, Date.now(), { withOrigin: !voyage?.destination }),
    portHistoryLine(info, cachedPortIndex(), translate),
    vesselRegistryParts(info, translate, lang).slice(registryType ? 1 : 0).join(' · '),
    vesselHullParts({ imo: row.imo }, info, translate, lang).join(' · '),
  ].filter(Boolean);
  return {
    layerId: GFW_PRESENCE_LAYER_ID,
    id: mmsi || String(row.vesselId || row.name || ''),
    callsign: gfwDisplayName(row),
    registration: String(row.callsign || '').trim() || null,
    operator: meta?.day ? translate('gfw.delayed-long', { day: gfwDayLabel(meta.day, lang) }) : translate('gfw.window-pending'),
    // Typ nikdy prázdny: bez neho by karta siahla po t('aircraft.category.…').
    type: (registryType ? registryType.charAt(0).toUpperCase() + registryType.slice(1) : null) || normalizeVesselType(row.type) || 'VESSEL',
    category: null,
    military: false,
    onGround: false,
    altitudeM: null,
    speedMps: null,
    verticalRateMps: null,
    trackDeg: null,
    routeInfo: voyageRouteInfo(voyage),
    extraLines,
    photoKey: /^\d{9}$/.test(mmsi) ? `vessel:${mmsi}` : null,
    progress: null,
    route: gfwCellNote(row, meta, translate, lang),
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
 * ONESKORENÉ · deň namiesto rýchlosti a kurzu. Pure.
 */
export function gfwLabelCard(row, position, meta, translate = t, lang = currentLanguage()) {
  const type = normalizeVesselType(row.type);
  const name = gfwDisplayName(row);
  return {
    id: `gfw:${row.mmsi || row.vesselId || `${row.lat},${row.lon}`}`,
    actionable: true,
    position,
    gapPx: 10,
    accent: accentForVesselType(row.type),
    title: name.length > 26 ? `${name.slice(0, 25)}…` : name,
    titleFlag: mmsiFlag(row.mmsi)?.iso2 || null,
    details: [[type, gfwDelayedLabel(meta, translate, lang)].filter(Boolean).join(' · ')],
    selected: false,
    priority: (row.name ? 1000 : 0) + (row.type ? 40 : 0) + Math.min(400, Math.max(0, Number(row.hours) || 0) * 10),
  };
}

/**
 * Karta VYBRANEJ lode GFW (2026-10-10, „trackovanie na moriach"): rovnaké riadky
 * ako kartička pod kurzorom — oneskorenie, novšia poloha z registra, odkiaľ,
 * predchádzajúce prístavy, register, trup. Pure.
 */
export function gfwSelectedCard(row, position, meta, translate = t, lang = currentLanguage(), chartPoints = []) {
  // 2026-10-10 („sprav karty minimálne také kvalitné ako pri lietadlách"): dokovaná karta
  // ako pri lietadle; poloha je ~3 dni stará → bez priebehu a miestneho času (delayed).
  const mmsi = String(row?.mmsi || '').trim();
  const info = /^\d{9}$/.test(mmsi) ? cachedVesselInfo(mmsi) || null : null;
  return buildVesselTrackedEntry({
    id: `gfw:${row.mmsi || row.vesselId || `${row.lat},${row.lon}`}`,
    position,
    name: gfwDisplayName(row),
    flagIso: mmsiFlag(mmsi)?.iso2 || null,
    accent: accentForVesselType(row.type),
    vessel: {
      mmsi,
      lat: row.lat,
      lon: row.lon,
      typeText: normalizeVesselType(row.type) === 'OTHER' ? '' : normalizeVesselType(row.type),
      callSign: String(row.callsign || '').trim(),
      imo: row.imo,
      fixMs: Number.isFinite(row.lastSeen) ? row.lastSeen : null,
    },
    info,
    portIndex: cachedPortIndex(),
    chartPoints,
    sourceLine: ['Global Fishing Watch', gfwDelayedLabel(meta, translate, lang)].filter(Boolean).join(' · '),
    delayed: true,
  }, translate, lang);
}

/** Body trasy z registra → `[[lon, lat, 0], …]` (aspoň 2). Pure. */
export function gfwTrackPositionsDeg(points) {
  const out = [];
  for (const p of Array.isArray(points) ? points : []) {
    if (Number.isFinite(p?.lat) && Number.isFinite(p?.lon)) out.push([p.lon, p.lat, 0]);
  }
  return out.length >= 2 ? out : null;
}

const TRACK_LINE_STYLE = Object.freeze({ color: '#5fd0e6', alpha: 0.85, occludedAlpha: 0.3, dashLength: 6, width: 2 });

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
  // Výber lode (2026-10-10): karta, história prístavov, trasa 24 h a novšia poloha z registra.
  let _selectedKey = null;
  /** Riadok vybranej lode — výber prežije oddialenie aj nový výrez bez nej. */
  let _selectedRow = null;
  /** Trasa vybranej lode z registra (grafy karty). */
  let _selectedTrack = [];
  let _clickHandler = null;
  let _historyLine = null;
  let _trackLine = null;
  let _newerEntity = null;
  let _selectToken = 0;

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
    if (!_enabled || (!_byId.size && !_selectedRow)) {
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
    for (const [key, { row, billboard }] of _byId.entries()) {
      if (key === _selectedKey) { cards.push(gfwSelectedCard(row, billboard.position, _meta, t, currentLanguage(), _selectedTrack)); continue; }
      if (project && width && height) {
        const win = project(billboard.position);
        if (!win || win.x < 0 || win.y < 0 || win.x > width || win.y > height) continue;
      }
      cards.push(gfwLabelCard(row, billboard.position, _meta));
    }
    if (_selectedRow && _selectedKey && !_byId.has(_selectedKey)) {
      cards.push(gfwSelectedCard(_selectedRow, Cesium.Cartesian3.fromDegrees(_selectedRow.lon, _selectedRow.lat, GFW_PRESENCE_POINT_HEIGHT_M), _meta, t, currentLanguage(), _selectedTrack));
    }
    const trackedCard = cards.find((c) => c.variant === 'tracked');
    if (trackedCard) syncVesselEstimate('gfw', trackedCard); else clearVesselEstimateFor('gfw');
    cards.sort((a, b) => b.priority - a.priority);
    const entries = cards.slice(0, GFW_PRESENCE_MAX_LABELS).map((card) => (card.variant === 'tracked' ? card : applyVesselOverlayPolicy(card, VESSEL_CARD_FADE_DISTANCE_M)));
    _labelCount = entries.length;
    const ambientLimit = vesselOverlayCohortLimit(width, height, GFW_PRESENCE_MAX_LABELS);
    overlayHost.setEntries(GFW_PRESENCE_OVERLAY_SOURCE_ID, entries, {
      cohortLimit: Math.max(1, ambientLimit),
      collisionCapacity: ambientLimit,
      moving: false,
    });
    overlayHost.setVisible(GFW_PRESENCE_OVERLAY_SOURCE_ID, true);
  }

  function clearSelectionGraphics() {
    clearVesselEstimateFor('gfw');
    _historyLine?.clear();
    _trackLine?.clear();
    if (_newerEntity && _viewer?.entities) { try { _viewer.entities.remove(_newerEntity); } catch { /* */ } }
    _newerEntity = null;
  }

  /** Čiary a značka vybranej lode: prístavy → poloha GFW → novšia poloha; trasa 24 h. */
  function syncSelectionGraphics(row, info, track) {
    if (!_viewer) return;
    const newer = info?.lastPosition && Number.isFinite(info.lastPosition.t) && (!Number.isFinite(row.lastSeen) || info.lastPosition.t > row.lastSeen)
      ? info.lastPosition : null;
    const ports = [...(info?.portCalls || []), { lat: row.lat, lon: row.lon }];
    let history = historyLinePositionsDeg(ports, newer ? { lat: newer.lat, lon: newer.lon } : null, 9);
    // Po mori (bod 5): keď trasa príde, prekresli tú istú voľbu.
    const bySea = history ? seaRoutePositionsDeg(seaRouteSync(history.map(([lon, lat]) => ({ lat, lon })), () => {
      if (_selectedRow === row) syncSelectionGraphics(row, info, track);
    })) : null;
    if (bySea) history = bySea;
    if (history) {
      if (!_historyLine) _historyLine = createVesselVoyageLine(_viewer, HISTORY_LINE_STYLE);
      _historyLine.setPath(history);
    } else _historyLine?.clear();
    const trackDeg = gfwTrackPositionsDeg(track);
    if (trackDeg) {
      if (!_trackLine) _trackLine = createVesselVoyageLine(_viewer, TRACK_LINE_STYLE);
      _trackLine.setPath(trackDeg);
    } else _trackLine?.clear();
    if (_newerEntity) { try { _viewer.entities.remove(_newerEntity); } catch { /* */ } _newerEntity = null; }
    if (newer && _viewer.entities?.add) {
      const d = new Date(newer.t);
      const label = `${gfwDisplayName(row)} · ${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
      _newerEntity = _viewer.entities.add({
        id: `gev-voyage:gfw-newer:${rowKey(row)}`,
        position: Cesium.Cartesian3.fromDegrees(newer.lon, newer.lat, GFW_PRESENCE_POINT_HEIGHT_M),
        point: { pixelSize: 9, color: Cesium.Color.fromCssColorString('#5fd0e6'), outlineColor: Cesium.Color.WHITE, outlineWidth: 1.5, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: {
          text: label, font: '12px "JetBrains Mono", monospace', fillColor: Cesium.Color.WHITE,
          showBackground: true, backgroundColor: Cesium.Color.fromCssColorString('#06121a').withAlpha(0.8),
          pixelOffset: new Cesium.Cartesian2(0, -18), disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }
    _viewer.scene?.requestRender?.();
  }

  /**
   * Po výbere zarámuj loď, novšiu polohu a trasu (2026-10-10, vlastník: „nevidím
   * trasu ani loď") — karta inak sedela priamo na lodi. Cieľ je Cartesian3,
   * nie Rectangle (pri streamujúcich 3D dlaždiciach Rectangle ticho nič neurobí).
   */
  function frameSelection(row, info, track) {
    const camera = _viewer?.camera;
    if (!camera?.flyTo) return;
    const pts = [{ lat: row.lat, lon: row.lon }];
    if (info?.lastPosition && Number.isFinite(info.lastPosition.lat)) pts.push(info.lastPosition);
    for (const p of Array.isArray(track) ? track : []) if (Number.isFinite(p?.lat) && Number.isFinite(p?.lon)) pts.push(p);
    const lats = pts.map((p) => p.lat);
    const lons = pts.map((p) => p.lon);
    const south = Math.min(...lats); const north = Math.max(...lats);
    const west = Math.min(...lons); const east = Math.max(...lons);
    const spanKm = Math.max((north - south) * 111, (east - west) * 111 * Math.cos(((north + south) / 2) * Math.PI / 180));
    const heightM = Math.min(9_000_000, Math.max(600_000, spanKm * 1000 * 2.6));
    // Stred trochu na sever od bodov: karta sa kreslí nad loďou, body ostanú voľné pod ňou.
    const lat = (south + north) / 2 + (heightM / 111_000) * 0.18;
    camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees((west + east) / 2, Math.min(80, lat), heightM),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
      duration: 1.6,
    });
  }

  function selectVessel(key, { frame = true } = {}) {
    const next = key && _byId.has(String(key)) ? String(key) : null;
    _selectedKey = next;
    _selectedRow = next ? _byId.get(next).row : null;
    _selectedTrack = [];
    _selectToken += 1;
    clearSelectionGraphics();
    publishLabels();
    _viewer?.scene?.requestRender?.();
    if (!next) return;
    const { row } = _byId.get(next);
    const mmsi = String(row.mmsi || '');
    if (!/^\d{9}$/.test(mmsi)) return;
    const token = _selectToken;
    Promise.all([
      lookupVesselInfo(mmsi),
      doFetch(`/api/vessel-info/track?mmsi=${mmsi}`).then((r) => (r?.ok ? r.json() : null)).catch(() => null),
    ]).then(([info, track]) => {
      if (token !== _selectToken || _selectedKey !== next) return;
      _selectedTrack = Array.isArray(track?.points) ? track.points : [];
      syncSelectionGraphics(row, info, track?.points);
      publishLabels();
      if (frame) frameSelection(row, info, track?.points);
    });
  }

  function onLeftClick(click) {
    if (!_enabled || !_viewer) return;
    const position = click?.position;
    let picked = null;
    try { picked = _viewer.scene.pick(position, 10, 10); } catch { picked = null; }
    const pickedId = resolvePickId(picked);
    let key = pickedId != null && _byId.has(String(pickedId)) ? String(pickedId) : null;
    if (!key && pickedId != null && isOwnedByOtherLayer(GFW_PRESENCE_LAYER_ID, pickedId)) return;
    if (!key) {
      const hit = hitTestWorldOverlay(position?.x, position?.y, { sourceId: GFW_PRESENCE_OVERLAY_SOURCE_ID });
      const entryId = hit && String(hit.entryId || '');
      if (entryId && entryId.startsWith('gfw:')) {
        const k = entryId.slice('gfw:'.length);
        if (_byId.has(k)) key = k;
        else return;
      }
    }
    if (key) selectVessel(key);
    else if (_selectedKey && pickedId == null) selectVessel(null);
  }

  let _retryTimer = null;
  /**
   * 429 (GFW odmietol súbežný report — naživo 2026-09-13 pri AIS + SAR zapnutých
   * naraz, alebo minútový limit proxy): jeden tichý pokus o GFW_PRESENCE_RETRY_MS,
   * kým ten istý výrez stále nie je načítaný, namiesto čakania na pohyb kamery.
   */
  function scheduleRetry(bbox) {
    clearTimeout(_retryTimer);
    _retryTimer = setTimeout(() => {
      _retryTimer = null;
      if (_enabled && !_loading && JSON.stringify(_bbox) !== JSON.stringify(bbox)) void load(bbox);
    }, GFW_PRESENCE_RETRY_MS);
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
        else if (json?.error === 'budget') { _error = t('gfw.budget'); }
        else if (response.status === 429) { _error = t('gfw.throttled'); scheduleRetry(bbox); }
        else { _error = `HTTP ${response.status}`; }
        return;
      }
      const rows = Array.isArray(json?.rows) ? json.rows : [];
      _rows = rows;
      _meta = json?.meta || null;
      _bbox = bbox;
      clearTimeout(_retryTimer);
      _retryTimer = null;
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
      // Oddialenie nad strop: rozbehnutý dopyt na veľký výrez už nikto nečaká —
      // zrušiť ho, nech jeho neskorá chyba nehlási „Načítanie zlyhalo" (2026-10-10).
      _requestToken += 1;
      _loading = false;
      _error = null;
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
      if (!_clickHandler && typeof _viewer?.scene?.canvas?.addEventListener === 'function' && typeof Cesium.ScreenSpaceEventHandler === 'function') {
        _clickHandler = new Cesium.ScreenSpaceEventHandler(_viewer.scene.canvas);
        _clickHandler.setInputAction(onLeftClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      }
      refreshForView({ force: true });
    },

    disable() {
      _clickHandler?.destroy?.();
      _clickHandler = null;
      _selectedKey = null;
      _selectedRow = null;
      clearSelectionGraphics();
      _enabled = false;
      clearTimeout(_moveTimer);
      _moveTimer = null;
      clearTimeout(_retryTimer);
      _retryTimer = null;
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
      _historyLine?.destroy?.(); _historyLine = null;
      _trackLine?.destroy?.(); _trackLine = null;
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

    /** Zruší výber (krížik na karte, 2026-10-10). */
    clearSelection() { selectVessel(null); },

    /** MMSI vybranej lode (fotka pod kartou), inak null. */
    getSelectedMmsi() {
      return _selectedRow?.mmsi ? String(_selectedRow.mmsi) : null;
    },

    /** Meno vybranej lode (zvonček sledovania, 2026-10-11). */
    getSelectedName() {
      return _selectedRow?.name || null;
    },

    /** Vyber loď z kódu (hľadanie, test); null zruší výber. */
    selectContact(id) {
      const key = String(id ?? '').trim();
      const found = _byId.has(key) ? key : [..._byId.entries()].find(([, e]) => String(e.row.mmsi) === key)?.[0] || null;
      selectVessel(found);
      return Boolean(found);
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

    /** Zotrvanie myši nad loďou: register lodí a fotka (contactHoverCard onDwell). */
    prefetchContactDetails(id) {
      const key = String(id ?? '').trim();
      const entry = _byId.get(key) || [..._byId.values()].find((e) => String(e.row.mmsi) === key);
      const mmsi = String(entry?.row?.mmsi || key);
      if (/^\d{9}$/.test(mmsi)) lookupVesselInfo(mmsi);
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
      const delayed = gfwDelayedLabel(_meta);
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
        object.metric = delayed;
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
