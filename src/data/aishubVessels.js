// src/data/aishubVessels.js
// Lode · ONESKORENÉ (AISHub cez aiscast / openwaters.io), 2026-09-15.
// Zadanie: docs/drafts/ais-aishub-druhy-zdroj-zadanie.md.
//
// Prečo: živý `ais-live` (aisstream.io) vidí mimo Európy skoro nič — Hormuz 0
// lodí, Singapur 26 z 1 597. AISHub (celosvetový terestriálny agregát) tam má
// tisíce; aiscast ho re-servuje bez tokenu s atribúciou. Táto vrstva ťahá
// snímku viditeľného výrezu cez `/api/aiscast/vessels` a kreslí ju ROVNAKÝM
// trupom a farbou ako živé lode (shipIconDataUrl + vesselTypeCss), len je
// v karte aj v paneli poctivo označená „AISHub · oneskorené ~1–6 min", NIKDY
// LIVE. Živý aisstream stream OKO sa nemení.
//
// Dedup: záznam, ktorý už vidí živá vrstva (`isLive(mmsi)`), vyhráva a AISHub
// riadok sa zahodí. Riadky zo zdroja `aisstream` (to je ten istý feed, aký
// OKO berie naživo) sa neberú — nemá zmysel ich pretvarovať na „oneskorený
// AISHub". Vzor a plumbiny sú prevzaté z gfwPresence.js.

import * as Cesium from 'cesium';
import { currentLanguage, t } from '../i18n.js';
import { isOwnedByOtherLayer, registerPickOwner, resolvePickId, unregisterPickOwner } from './pickRegistry.js';
import { clearSelectedEntityContextForLayer, registerEntityContext, selectEntityContext } from './contextStore.js';
import {
  VESSEL_CARD_FADE_DISTANCE_M,
  accentForVesselType,
  applyVesselOverlayPolicy,
  mmsiFlag,
  navStatusLabel,
  normalizeVesselType,
  vesselOverlayCohortLimit,
  vesselTypeCss,
} from './vesselLabels.js';
import { shipIconDataUrl, vesselTierScale } from './aisLiveVessels.js';
import { airIconTier } from './airIconLod.js';
import { isMetric } from '../units.js';
import { cameraPoseSignature, screenProjectedRotation } from './iconOrientation.js';
import { AISHUB_MAX_AREA_SQ_DEG } from './aishubVesselsCore.js';
import { clearOverlaySource, hitTestWorldOverlay, setOverlayEntries, setOverlaySourceVisible } from '../overlays/worldOverlay.js';

export const AISHUB_LAYER_ID = 'aishub-vessels';
export const AISHUB_OVERLAY_SOURCE_ID = 'aishub-vessels';
export const AISHUB_API = '/api/aiscast/vessels';
/** Nad touto výškou kamery výrez prekročí strop plochy — nepýtame sa (žiadne predstieranie pokrytia). */
export const AISHUB_MAX_CAMERA_M = 2_600_000;
export const AISHUB_MAX_POINTS = 6_000;
export const AISHUB_MAX_LABELS = 300;
export const AISHUB_MOVE_DEBOUNCE_MS = 1_200;
export const AISHUB_POINT_HEIGHT_M = 20;
const KN_TO_MPS = 0.514444;

/**
 * Mierka trupu podľa rýchlosti — rovnaké prahy ako živé lode
 * (shipSpeedScale v aisLiveVessels.js), aby boli veľkosti jednotné. Pure.
 * @param {number|null|undefined} sog rýchlosť v uzloch
 * @returns {number}
 */
export function aishubSpeedScale(sog) {
  const speed = Number(sog) || 0;
  if (speed >= 18) return 0.78;
  if (speed >= 8) return 0.68;
  return 0.6;
}

/** Krátke KT/KM/H ako pri živých lodiach (formatSpeed). Pure. */
function formatSpeed(sog) {
  if (!Number.isFinite(sog)) return isMetric() ? '--KM/H' : '--KT';
  return isMetric() ? `${Math.round(sog * 1.852)}KM/H` : `${sog.toFixed(1)}KT`;
}

/** Vek údaja: „pred 3 min" / „45 s"; prázdne bez času. Pure. */
export function aishubAgeLabel(observedAtMs, nowMs = Date.now(), lang = currentLanguage()) {
  if (!Number.isFinite(observedAtMs)) return '';
  const s = Math.max(0, Math.round((nowMs - observedAtMs) / 1000));
  if (s < 90) return lang === 'en' ? `${s}s ago` : `pred ${s} s`;
  const m = Math.round(s / 60);
  return lang === 'en' ? `${m} min ago` : `pred ${m} min`;
}

/**
 * Smer plavby lode (°): heading, keď je platný (0–359; 511 = „nedostupné"),
 * inak kurz nad zemou (cog). null = smer neznámy → trup ostane na sever. Pure.
 * Trup shipIconDataUrl mieri na sever, takže rotácia mapuje priamo na smer,
 * rovnako ako pri živých lodiach (vesselCourseDeg v aisLiveVessels.js).
 * @param {{heading?:number, cog?:number}} row
 * @returns {number|null}
 */
export function aishubCourseDeg(row) {
  // Priamo Number.isFinite na hodnote — `Number(null)` je 0, čo by loď bez
  // headingu otočilo na sever namiesto pádu na cog.
  const h = row?.heading;
  if (Number.isFinite(h) && h >= 0 && h < 360) return h;
  const c = row?.cog;
  if (Number.isFinite(c) && c >= 0 && c < 360) return c;
  return null;
}

/**
 * Výrez z pohľadu kamery (°), alebo null nad stropom výšky / plochy / bez
 * obdĺžnika. Plocha sa stráži tu aj na serveri — klient nikdy nepošle dopyt,
 * ktorý by proxy odmietla 400.
 * @param {object} viewer
 * @returns {{west:number,south:number,east:number,north:number}|null}
 */
export function aishubViewBbox(viewer, { maxCameraM = AISHUB_MAX_CAMERA_M, maxAreaSqDeg = AISHUB_MAX_AREA_SQ_DEG } = {}) {
  const camera = viewer?.camera;
  if (!camera || !(camera.positionCartographic?.height <= maxCameraM)) return null;
  const rect = camera.computeViewRectangle?.(Cesium.Ellipsoid.WGS84);
  if (!rect) return null;
  const west = Cesium.Math.toDegrees(rect.west);
  const east = Cesium.Math.toDegrees(rect.east);
  const south = Cesium.Math.toDegrees(rect.south);
  const north = Cesium.Math.toDegrees(rect.north);
  if (![west, east, south, north].every(Number.isFinite) || !(west < east) || !(south < north)) return null;
  if ((east - west) * (north - south) > maxAreaSqDeg) return null;
  const round = (v) => Math.round(v * 100) / 100;
  return { west: round(west), south: round(south), east: round(east), north: round(north) };
}

/** Rovnaký výrez = rovnaký dopyt. Pure. */
export function sameBbox(a, b) {
  return Boolean(a && b) && a.west === b.west && a.east === b.east && a.south === b.south && a.north === b.north;
}

/** Zobrazované meno: meno lode, inak MMSI, inak VESSEL. Pure. */
export function aishubDisplayName(row) {
  return String(row?.name || '').trim() || String(row?.mmsi || '').trim() || 'VESSEL';
}

/** Poctivá poznámka o oneskorení — nikdy „LIVE". Pure. */
export function aishubDelayedLabel(translate = t) {
  return translate('aishub.delayed');
}

/**
 * Riadok zdroja v paneli: „AISHub · oneskorené ~1–6 min" + atribúcia po
 * zdrojoch z aiscastu (povinná, pravidlo projektu). Pure.
 * @param {{attribution?:Record<string,string>, counts?:Record<string,number>}|null} meta
 */
export function aishubSourceLabel(meta, translate = t) {
  const attributionValues = meta && meta.attribution ? Object.values(meta.attribution).filter(Boolean) : [];
  const credit = attributionValues.length ? attributionValues.join(' · ') : 'Open Waters AIS (openwaters.io) · AISHub (aishub.net)';
  return `${translate('aishub.delayed')} · ${credit}`;
}

/**
 * Súhrn pre kartičku pod kurzorom (tvar flights.getContactSummary). AIS nesie
 * rýchlosť aj kurz, tak ich ukážeme — ale operator/route hovorí „oneskorené".
 * Pure.
 * @param {object} row riadok z proxy
 */
export function aishubContactSummary(row, translate = t, nowMs = Date.now()) {
  if (!row) return null;
  const mmsi = String(row.mmsi || '').trim();
  const flag = mmsiFlag(mmsi);
  const sog = Number.isFinite(row.sog) && row.sog >= 0 ? row.sog : null;
  // Rovnaké polia a poradie ako živé lode (getContactSummary v aisLiveVessels):
  // nav status ako operator, typ, rýchlosť, kurz, vlajka. Poctivosť nesie
  // riadok „route" (oneskorené + vek údaja) a zdroj — nikdy LIVE.
  const age = aishubAgeLabel(row.observedAt, nowMs);
  return {
    layerId: AISHUB_LAYER_ID,
    id: mmsi || aishubDisplayName(row),
    callsign: String(row.name || '').trim() || mmsi || 'VESSEL',
    registration: String(row.callsign || '').trim() || null,
    operator: navStatusLabel(row.navStatus) || null,
    type: normalizeVesselType(row.type) || 'VESSEL',
    category: null,
    military: false,
    onGround: false,
    altitudeM: null,
    speedMps: sog === null ? null : sog * KN_TO_MPS,
    verticalRateMps: null,
    trackDeg: aishubCourseDeg(row),
    routeInfo: null,
    progress: null,
    route: age ? `${translate('aishub.delayed')} · ${age}` : translate('aishub.delayed'),
    flightIata: null,
    // Zdroj poctivo: aishub, alebo skutočný pod-zdroj (barentswatch, digitraffic…).
    source: row.source && row.source !== 'aishub' ? `AISHub · ${row.source}` : 'AISHub',
    lastContactEpochMs: Number.isFinite(row.observedAt) ? row.observedAt : null,
    stale: false,
    squawk: null,
    countryIso: flag?.iso2 || null,
    originCountry: flag?.name || null,
  };
}

/**
 * Popiska mena v tvare karty živých lodí, s riadkom „oneskorené" namiesto
 * LIVE. Pure.
 */
export function aishubLabelCard(row, position, translate = t, nowMs = Date.now(), selected = false) {
  // Rovnaká skladba ako buildVesselCard (živé lode): TYP · rýchlosť · kurz,
  // plus krátky odznak ONESKORENÉ · vek údaja namiesto „LAST KNOWN". Vybraná
  // loď (klik) dostane navyše navigačný stav a je pripnutá (selected/protected).
  const parts = [];
  const type = normalizeVesselType(row.type).toUpperCase().slice(0, 14);
  if (type) parts.push(type);
  if (Number.isFinite(row.sog)) parts.push(formatSpeed(row.sog));
  const direction = aishubCourseDeg(row);
  if (Number.isFinite(direction)) parts.push(`${Math.round(direction)}°`);
  const nav = selected ? navStatusLabel(row.navStatus) : '';
  if (nav) parts.push(nav);
  const age = aishubAgeLabel(row.observedAt, nowMs);
  parts.push(age ? `${translate('aishub.badge')} · ${age}` : translate('aishub.badge'));
  const name = aishubDisplayName(row);
  return {
    id: `aishub:${row.mmsi}`,
    // Klikateľná ako živé lode — klik cez hull (pick) aj cez kartu (hitTest).
    actionable: true,
    position,
    gapPx: 10,
    accent: accentForVesselType(row.type),
    title: name.length > 26 ? `${name.slice(0, 25)}…` : name,
    titleFlag: mmsiFlag(row.mmsi)?.iso2 || null,
    details: [parts.join(' · ')],
    selected,
    priority: (selected ? 100000 : 0) + (row.name ? 1000 : 0) + (row.type ? 40 : 0) + (Number.isFinite(row.sog) && row.sog > 0.5 ? 30 : 0),
  };
}

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

/**
 * Továreň vrstvy. Injektovateľné pre testy: fetchImpl, collectionFactory,
 * overlayHost, isLive (dedup proti živej vrstve), now.
 * @param {object} [options]
 * @param {(mmsi:string)=>boolean} [options.isLive] MMSI, ktoré už vidí živá vrstva → zahodiť
 */
export function createAishubVesselsLayer({
  fetchImpl = null,
  collectionFactory = () => new Cesium.BillboardCollection(),
  overlayHost = DEFAULT_OVERLAY_HOST,
  isLive = null,
  now = () => Date.now(),
} = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  const liveHas = typeof isLive === 'function' ? isLive : () => false;
  let _viewer = null;
  let _enabled = false;
  let _loading = false;
  let _error = null;
  let _status = 'idle'; // 'idle' | 'zoom-in' | 'live' | 'empty'
  let _collection = null;
  let _rows = [];
  let _byId = new Map();
  let _meta = null;
  let _lastUpdate = null;
  let _bbox = null;
  let _iconTier = 'full';
  let _moveRemove = null;
  let _changedRemove = null;
  let _preRenderRemove = null;
  let _clickHandler = null;
  let _poseSig = null;
  let _moveTimer = null;
  let _requestToken = 0;
  let _labelCount = 0;
  let _selectedKey = null;
  const _scratchObjects = new Map();
  const _contextCarrier = new Map();

  function hullScaleFor(sog) {
    return aishubSpeedScale(sog) * vesselTierScale(_iconTier);
  }

  /**
   * Dedup + poctivosť: vyhoď riadky zo zdroja `aisstream` (ten istý feed má OKO
   * naživo) a tie, ktorých MMSI už vidí živá vrstva.
   */
  function keepRow(row) {
    if (!row || row.source === 'aisstream') return false;
    return !liveHas(String(row.mmsi));
  }

  function clearBillboards() {
    if (_collection) _collection.removeAll?.();
    _byId = new Map();
  }

  function renderRows(rows) {
    clearBillboards();
    if (!_collection) return;
    const scene = _viewer?.scene;
    const limit = Math.min(rows.length, AISHUB_MAX_POINTS);
    for (let i = 0; i < limit; i++) {
      const row = rows[i];
      const id = { mmsi: String(row.mmsi || ''), aishub: true, name: row.name || '', key: String(row.mmsi) };
      const position = Cesium.Cartesian3.fromDegrees(row.lon, row.lat, AISHUB_POINT_HEIGHT_M);
      const course = aishubCourseDeg(row);
      // Natočenie do smeru plavby, ako pri živých lodiach; bez smeru na sever.
      const rotation = course === null ? 0 : (screenProjectedRotation(scene, position, course, 0) ?? 0);
      const billboard = _collection.add({
        id,
        position,
        image: shipIconDataUrl(vesselTypeCss(row.type)),
        // Veľkosť aj plná krytie ako živé lode — vizuál jednotný, poctivosť
        // nesie label „oneskorené", nie stlmenie farby (2026-09-15).
        scale: hullScaleFor(row.sog),
        rotation,
        alignedAxis: Cesium.Cartesian3.ZERO,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        color: Cesium.Color.WHITE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
      _byId.set(id.key, { row, billboard, course });
    }
    _poseSig = null; // vynúť prepočet natočenia v najbližšom preRender
  }

  /**
   * Prepočíta natočenie trupov do smeru plavby pre aktuálnu pózu kamery. Beží
   * v preRender len keď sa kamera pohla (pose signature), inak nič — pri
   * tisíckach lodí by prepočet každý snímok stál.
   */
  function updateRotations() {
    const scene = _viewer?.scene;
    if (!scene) return;
    for (const entry of _byId.values()) {
      if (entry.course === null) continue;
      const rot = screenProjectedRotation(scene, entry.billboard.position, entry.course, entry.billboard.rotation);
      if (rot !== null && Math.abs(rot - entry.billboard.rotation) > 0.002) entry.billboard.rotation = rot;
    }
  }

  /** Trup vybranej lode je väčší a s vybraným variantom ikony (ako živé lode). */
  function applySelectedVisual() {
    for (const [key, { row, billboard }] of _byId.entries()) {
      const selected = key === _selectedKey;
      billboard.scale = hullScaleFor(row.sog) * (selected ? 1.2 : 1);
      billboard.image = shipIconDataUrl(vesselTypeCss(row.type), selected);
    }
  }

  /**
   * Vyber loď kliknutím (null = zrušiť výber). Publikuje kontext (HUD, „čo
   * vidím"), zväčší trup a pripne kartu; poctivosť ostáva — je to oneskorená loď.
   * @param {string|null} key MMSI z _byId
   */
  function selectVessel(key) {
    const next = key && _byId.has(String(key)) ? String(key) : null;
    _selectedKey = next;
    if (next && typeof window !== 'undefined') {
      const { row } = _byId.get(next);
      const carrier = _contextCarrier.get(next) || { __gevContextId: next };
      _contextCarrier.set(next, carrier);
      registerEntityContext(carrier, {
        id: next,
        layerId: AISHUB_LAYER_ID,
        layerName: t('layer.aishub-vessels.name'),
        source: 'AISHub',
        label: aishubDisplayName(row),
        latitude: row.lat,
        longitude: row.lon,
        properties: aishubContactSummary(row),
      });
      selectEntityContext(carrier);
    } else if (!next && typeof window !== 'undefined') {
      clearSelectedEntityContextForLayer(AISHUB_LAYER_ID);
    }
    applySelectedVisual();
    publishLabels();
    _viewer?.scene?.requestRender?.();
  }

  function onLeftClick(click) {
    if (!_enabled || !_viewer) return;
    const position = click?.position;
    let picked = null;
    try { picked = _viewer.scene.pick(position, 10, 10); } catch { picked = null; }
    const pickedId = resolvePickId(picked);
    let key = pickedId != null && _byId.has(String(pickedId)) ? String(pickedId) : null;
    // Iná vrstva už vlastní tento klik — nekonkurovať jej.
    if (!key && pickedId != null && isOwnedByOtherLayer(AISHUB_LAYER_ID, pickedId)) return;
    // Karta je na pointer-events:none plátne, takže scene.pick trafí terén za
    // ňou — over kliknutie proti našim aktívnym hit-obdĺžnikom (ako živé lode).
    if (!key) {
      const hit = hitTestWorldOverlay(position?.x, position?.y, { sourceId: AISHUB_OVERLAY_SOURCE_ID });
      const entryId = hit && String(hit.entryId || '');
      if (entryId && entryId.startsWith('aishub:')) {
        const mmsi = entryId.slice('aishub:'.length);
        if (_byId.has(mmsi)) key = mmsi;
        else return; // zastaraná karta, nie prázdny terén
      }
    }
    if (key) selectVessel(key);
    else if (_selectedKey && pickedId == null) selectVessel(null); // prázdny klik = zrušiť výber
  }

  function syncTier() {
    const height = _viewer?.camera?.positionCartographic?.height;
    const next = airIconTier(height, _iconTier);
    if (next === _iconTier) return;
    _iconTier = next;
    for (const { row, billboard } of _byId.values()) billboard.scale = hullScaleFor(row.sog);
    _viewer?.scene?.requestRender?.();
  }

  function publishLabels() {
    if (!_enabled || !_byId.size) {
      _labelCount = 0;
      overlayHost.clearSource(AISHUB_OVERLAY_SOURCE_ID);
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
    const nowMs = now();
    for (const [key, { row, billboard }] of _byId.entries()) {
      const selected = key === _selectedKey;
      if (!selected && project && width && height) {
        const win = project(billboard.position);
        // Vybraná karta ostáva aj mimo stredu; ambientné len na obrazovke.
        if (!win || win.x < 0 || win.y < 0 || win.x > width || win.y > height) continue;
      }
      cards.push(aishubLabelCard(row, billboard.position, t, nowMs, selected));
    }
    cards.sort((a, b) => b.priority - a.priority);
    const entries = cards.slice(0, AISHUB_MAX_LABELS).map((card) => applyVesselOverlayPolicy(card, VESSEL_CARD_FADE_DISTANCE_M));
    _labelCount = entries.length;
    const ambientLimit = vesselOverlayCohortLimit(width, height, AISHUB_MAX_LABELS);
    overlayHost.setEntries(AISHUB_OVERLAY_SOURCE_ID, entries, {
      cohortLimit: Math.max(1, ambientLimit),
      collisionCapacity: ambientLimit,
      moving: false,
    });
    overlayHost.setVisible(AISHUB_OVERLAY_SOURCE_ID, true);
  }

  async function load(bbox) {
    const token = ++_requestToken;
    _loading = true;
    _error = null;
    try {
      const url = `${AISHUB_API}?bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
      const response = await doFetch(url, { cache: 'no-store' });
      if (token !== _requestToken) return;
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 429) _error = t('aishub.throttled');
        else if (json?.error === 'bad_bbox') { _status = 'zoom-in'; _error = null; }
        else _error = json?.detail || `HTTP ${response.status}`;
        return;
      }
      const rows = (Array.isArray(json?.rows) ? json.rows : []).filter(keepRow);
      _rows = rows;
      _meta = json?.meta || null;
      _bbox = bbox;
      _lastUpdate = now();
      _status = rows.length ? 'live' : 'empty';
      syncTier();
      renderRows(rows);
      // Výber prežije obnovu výrezu, ak je loď stále v dátach; inak sa zruší.
      if (_selectedKey && !_byId.has(_selectedKey)) {
        _selectedKey = null;
        if (typeof window !== 'undefined') clearSelectedEntityContextForLayer(AISHUB_LAYER_ID);
      }
      applySelectedVisual();
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
    const bbox = aishubViewBbox(_viewer);
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
    _moveTimer = setTimeout(() => refreshForView(), AISHUB_MOVE_DEBOUNCE_MS);
  }

  const layer = {
    id: AISHUB_LAYER_ID,
    get name() { return t('layer.aishub-vessels.name'); },
    icon: '◇',
    updateInterval: 60 * 1000,

    init(viewer) {
      _viewer = viewer;
      _collection = collectionFactory();
      _collection.show = false;
      viewer?.scene?.primitives?.add?.(_collection);
    },

    async enable() {
      _enabled = true;
      if (_collection) _collection.show = true;
      registerPickOwner(AISHUB_LAYER_ID, (pickedId) => layer.hasContact(pickedId));
      if (!_moveRemove && _viewer?.camera?.moveEnd?.addEventListener) {
        _moveRemove = _viewer.camera.moveEnd.addEventListener(onMoveEnd);
      }
      if (!_changedRemove && _viewer?.camera?.changed?.addEventListener) {
        _changedRemove = _viewer.camera.changed.addEventListener(syncTier);
      }
      // Klik = výber lode (karta + zameriavač), ako pri iných lodiach.
      // Len s reálnym plátnom (testy majú falošné bez addEventListener).
      if (!_clickHandler && typeof _viewer?.scene?.canvas?.addEventListener === 'function' && typeof Cesium.ScreenSpaceEventHandler === 'function') {
        _clickHandler = new Cesium.ScreenSpaceEventHandler(_viewer.scene.canvas);
        _clickHandler.setInputAction(onLeftClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      }
      // Natočenie trupov do smeru plavby sleduje pózu kamery po snímkoch (ako
      // živé lode) — prepočet len keď sa kamera pohla.
      if (!_preRenderRemove && _viewer?.scene?.preRender?.addEventListener) {
        _preRenderRemove = _viewer.scene.preRender.addEventListener(() => {
          const sig = cameraPoseSignature(_viewer.camera);
          if (sig === _poseSig) return;
          _poseSig = sig;
          updateRotations();
        });
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
      _preRenderRemove?.();
      _preRenderRemove = null;
      _poseSig = null;
      _clickHandler?.destroy?.();
      _clickHandler = null;
      if (_selectedKey && typeof window !== 'undefined') clearSelectedEntityContextForLayer(AISHUB_LAYER_ID);
      _selectedKey = null;
      unregisterPickOwner(AISHUB_LAYER_ID);
      if (_collection) _collection.show = false;
      _labelCount = 0;
      overlayHost.clearSource(AISHUB_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(AISHUB_OVERLAY_SOURCE_ID, false);
      _viewer?.scene?.requestRender?.();
    },

    update() {
      // Manažérsky tik: oneskorený zdroj sa mení pomaly, obnov ten istý výrez.
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
        source: aishubSourceLabel(_meta),
        status: _status === 'zoom-in' ? 'zoom-in' : (_status === 'empty' ? 'empty' : undefined),
      };
      if (_status === 'zoom-in') stats.loadingLabel = t('aishub.zoom-in');
      else if (_status === 'empty' && !_loading) stats.loadingLabel = t('aishub.empty');
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
      return entry ? aishubContactSummary(entry.row) : null;
    },

    /**
     * Delayed-vessel positions for in-view counting (strait-traffic counter),
     * same shape as aisLiveVessels.getAllPositions. Empty while disabled/empty.
     * @param {number} [maxCount=5000]
     * @returns {Array<{id: string, latitude: number, longitude: number}>}
     */
    getAllPositions(maxCount = 5000) {
      if (!_enabled || !_byId.size) return [];
      const cap = Number.isFinite(maxCount) && maxCount > 0 ? Math.floor(maxCount) : 5000;
      const result = [];
      for (const { row } of _byId.values()) {
        if (result.length >= cap) break;
        if (!Number.isFinite(row?.lat) || !Number.isFinite(row?.lon)) continue;
        result.push({
          id: String(row.mmsi),
          latitude: row.lat,
          longitude: row.lon,
          type: row.type ?? null,
          sog: Number.isFinite(row.sog) ? row.sog : null,
          navStatus: Number.isFinite(row.navStatus) ? row.navStatus : null,
        });
      }
      return result;
    },

    getDetectableObjects(options = {}) {
      if (!_enabled || !_collection || !_collection.show) return [];
      const entries = [..._byId.values()];
      if (!entries.length) return [];
      const maxCount = Number.isFinite(options.maxCount) ? Math.max(1, Math.floor(options.maxCount)) : entries.length;
      const seed = Number.isFinite(options.seed) ? Math.floor(options.seed) : 0;
      const stride = Math.max(1, Math.ceil(entries.length / maxCount));
      const start = seed % stride;
      const forced = new Set();
      // Vybraná loď má vždy zameriavač (aj mimo vzorky), ako iné vrstvy.
      if (_selectedKey) forced.add(_selectedKey);
      if (Array.isArray(options.hovered)) {
        for (const c of options.hovered) {
          if (c && String(c.layerId) === AISHUB_LAYER_ID && c.sourceId != null) forced.add(String(c.sourceId));
        }
      }
      const delayed = aishubDelayedLabel();
      const toObject = (entry) => {
        const { row, billboard } = entry;
        const key = String(row.mmsi);
        let object = _scratchObjects.get(key);
        if (!object) {
          object = { sourceId: row.mmsi, type: 'SEA', skipLabel: false };
          _scratchObjects.set(key, object);
        }
        object.position = billboard.position;
        object.id = aishubDisplayName(row);
        object.klass = row.type ? normalizeVesselType(row.type).toUpperCase().slice(0, 14) || undefined : undefined;
        object.metric = delayed;
        return object;
      };
      const result = [];
      for (const entry of entries) if (forced.has(String(entry.row.mmsi))) result.push(toObject(entry));
      let sampled = 0;
      for (let idx = 0; idx < entries.length; idx += 1) {
        if (((idx - start) % stride) !== 0) continue;
        const entry = entries[idx];
        if (forced.has(String(entry.row.mmsi))) continue;
        result.push(toObject(entry));
        sampled += 1;
        if (sampled >= maxCount) break;
      }
      return result;
    },

    /** Test seam: vyber loď (bez potreby klikať v Cesiu). */
    _selectForTest(key) { selectVessel(key); },

    _getStateForTest() {
      return { enabled: _enabled, loading: _loading, error: _error, status: _status, rows: _rows.length, bbox: _bbox, meta: _meta, points: _byId.size, labels: _labelCount, selected: _selectedKey };
    },
  };

  return layer;
}

const aishubVesselsLayer = createAishubVesselsLayer();
export default aishubVesselsLayer;
