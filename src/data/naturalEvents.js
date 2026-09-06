// src/data/naturalEvents.js
/**
 * @module naturalEvents
 * @description Otvorené prírodné udalosti z NASA EONET (2026-09-05, „pridaj do
 * karty prírodné hrozby"): búrky a hurikány s trajektóriou a intenzitou,
 * povodne, zosuvy, sucho, prach a dym, sneh, teplotné extrémy, morský ľad a
 * (voliteľne) požiare.
 *
 * PREČO EONET: ten istý zdroj, ktorý už drží vrstvu vulkánov — verejný,
 * bez kľúča, CORS, overená licencia v DATA_SOURCES.md. Jedna registrácia
 * navyše namiesto deviatich nových zdrojov s deviatimi licenciami.
 *
 * DVE POŽIADAVKY, NIE JEDNA: kategória `wildfires` má naživo ~2 000
 * otvorených záznamov (namerané 2026-09-05), ostatné kategórie spolu ~20.
 * Jedna požiadavka s limitom by požiarmi vytlačila búrky z odpovede a mapu
 * by zaplavili drobné požiare. Preto jadro (všetko okrem požiarov) ide vždy,
 * požiare až keď ich používateľ zapne čipom — a s vlastným stropom.
 *
 * ČO TO NIE JE: EONET je kurátorovaný katalóg hlásení, nie varovný systém.
 * „Otvorená" udalosť je klasifikácia katalógu, nie aktuálna intenzita ani
 * rozsah ohrozenia. Karta to hovorí (pravidlo 2).
 */
import * as Cesium from 'cesium';
import { t } from '../i18n.js';
import { horizonOccluder } from './iconOrientation.js';
import { setOverlayEntries, setOverlaySourceVisible, clearOverlaySource } from '../overlays/worldOverlay.js';
import { registerPickOwner, unregisterPickOwner, resolvePickId } from './pickRegistry.js';
import {
  NATURAL_EVENT_CLEARED_EVENT, NATURAL_EVENT_SELECTED_EVENT, categoryColor,
} from './naturalEventInfo.js';

export const NATURAL_EVENTS_LAYER_ID = 'natural-events';
export const NATURAL_EVENTS_BASE_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events';
/** Kategórie EONET, ktoré vrstva nesie (vulkány a zemetrasenia majú vlastné vrstvy). */
export const NATURAL_EVENT_CATEGORIES = Object.freeze([
  'severeStorms', 'floods', 'landslides', 'drought', 'dustHaze', 'snow', 'tempExtremes', 'seaLakeIce', 'wildfires',
]);
/** Kategórie v jadrovej požiadavke — všetko okrem požiarov. */
export const NATURAL_EVENT_CORE_CATEGORIES = Object.freeze(NATURAL_EVENT_CATEGORIES.filter((c) => c !== 'wildfires'));
/** Predvolene skryté: požiare (~2 000 drobných záznamov, FIRMS ich rieši lepšie). */
export const NATURAL_EVENT_DEFAULT_HIDDEN = Object.freeze(['wildfires']);
export const NATURAL_EVENT_CORE_LIMIT = 500;
export const NATURAL_EVENT_WILDFIRE_LIMIT = 500;
const PERIOD = 10 * 60 * 1000;
const ACCENT = '#ffc46b';
const STALE_ACCENT = '#a6b1be';

/** URL požiadavky pre množinu kategórií. Pure. */
export function naturalEventsFeedUrl(categories, limit = NATURAL_EVENT_CORE_LIMIT) {
  const list = [...new Set(categories)].filter((c) => NATURAL_EVENT_CATEGORIES.includes(c));
  return `${NATURAL_EVENTS_BASE_URL}?status=open&category=${list.join(',')}&limit=${limit}`;
}

// Glyfy sú BIELE ťahy v hlavičke špendlíka okolo stredu (24, 20). Prerobené
// 2026-09-06 („ikony cyklóny aj iné sú slabé"): hrubšie ťahy a hlavne
// skutočný cyklónový symbol (oko + dve špirálové ramená) namiesto slabého
// krúžku, plus farba podľa kategórie, aby búrky vyskočili.
const GLYPH_PATHS = Object.freeze({
  severeStorms: '<circle cx="24" cy="20" r="2" fill="#fff" stroke="none"/><path d="M24 11.5c5.5 0 8.5 3.3 8.5 8.5"/><path d="M32.5 20c0 3.2-2.2 5-5.5 5.4"/><path d="M24 28.5c-5.5 0-8.5-3.3-8.5-8.5"/><path d="M15.5 20c0-3.2 2.2-5 5.5-5.4"/>',
  floods: '<path d="M13.5 16c2.6-2.7 5.2-2.7 7.8 0s5.2 2.7 7.8 0"/><path d="M13.5 21c2.6-2.7 5.2-2.7 7.8 0s5.2 2.7 7.8 0"/><path d="M13.5 26c2.6-2.7 5.2-2.7 7.8 0s5.2 2.7 7.8 0"/>',
  landslides: '<path d="M13.5 28.5 24 11.5l10.5 17Z"/><circle cx="21" cy="24" r="1.5" fill="#fff" stroke="none"/><circle cx="27" cy="25.5" r="1.5" fill="#fff" stroke="none"/>',
  drought: '<circle cx="24" cy="17" r="4.2"/><path d="M24 8.5v2.6M24 22.9V25.5M15.4 17h2.6M30 17h2.6M18.4 11.4l1.9 1.9M27.6 11.4l-1.9 1.9"/>',
  dustHaze: '<path d="M13.5 15h21" stroke-dasharray="4.5 3"/><path d="M13.5 20h21" stroke-dasharray="4.5 3"/><path d="M13.5 25h21" stroke-dasharray="4.5 3"/>',
  snow: '<path d="M24 9.5v21M14.9 14.75l18.2 10.5M14.9 25.25l18.2-10.5"/><path d="M24 9.5l-2.6 2.6M24 9.5l2.6 2.6M24 30.5l-2.6-2.6M24 30.5l2.6-2.6"/>',
  tempExtremes: '<path d="M20.5 13a3.5 3.5 0 0 1 7 0v8a5.5 5.5 0 1 1-7 0Z"/><path d="M24 15.5v7"/>',
  seaLakeIce: '<path d="M24 9.5l9 5.2v10.4L24 30.5l-9-5.2V14.7Z"/><path d="M24 9.5v21M14.6 14.9l18.8 10.8M14.6 25.3l18.8-10.8"/>',
  wildfires: '<path d="M24 9c1.6 5.1 6 6.6 6 12a6 6 0 0 1-12 0c0-3.1 1.5-4.6 2.5-6 .8 2.3 2.3 3 3 3-.8-3.6 0-6.6.5-9Z" fill="#fff" stroke="none"/>',
});

/** Väčšia veľkosť špendlíka pre búrky — sú to hlavné udalosti vrstvy. */
export function markerSize(category) {
  return category === 'severeStorms' ? { w: 28, h: 35 } : { w: 23, h: 29 };
}

/**
 * Kategória ako mapový špendlík (data URI): plný FAROU KATEGÓRIE vyplnený pin
 * s tmavým obrysom a hrubým bielym glyfom, hrot dole na mieste. Pure.
 * @param {string} category
 * @param {string} [color] override farby (default = farba kategórie)
 * @returns {string}
 */
export function naturalEventIcon(category, color = categoryColor(category)) {
  const glyph = GLYPH_PATHS[category] || GLYPH_PATHS.severeStorms;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="60" viewBox="0 0 48 60">`
    + `<path d="M24 3.5C13.8 3.5 5.5 11.8 5.5 22c0 12.6 18.5 34.5 18.5 34.5S42.5 34.6 42.5 22C42.5 11.8 34.2 3.5 24 3.5Z" fill="${color}" stroke="#0b0f14" stroke-opacity="0.6" stroke-width="1.6"/>`
    + `<g fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${glyph}</g></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

const finiteLonLat = (g) => Array.isArray(g?.coordinates) && g.coordinates.length >= 2
  && Number.isFinite(g.coordinates[0]) && Math.abs(g.coordinates[0]) <= 180
  && Number.isFinite(g.coordinates[1]) && Math.abs(g.coordinates[1]) <= 90;

/**
 * Normalizácia odpovede EONET. Každá udalosť: posledná bodová geometria ako
 * poloha, celá bodová história ako trajektória (búrky), veľkosť z posledného
 * bodu (`magnitudeValue`/`magnitudeUnit`, napr. 80 kts). Pure.
 * @param {object} json
 * @param {readonly string[]} [allowed]
 * @returns {{events: object[], rejected: number, truncated: boolean}}
 */
export function normalizeNaturalEvents(json, allowed = NATURAL_EVENT_CATEGORIES) {
  if (!Array.isArray(json?.events)) throw new Error('Invalid EONET response');
  const events = new Map(); let rejected = 0;
  for (const e of json.events) {
    if (!e || typeof e !== 'object') { rejected++; continue; }
    if (e.closed) continue;
    const category = (Array.isArray(e.categories) ? e.categories : []).map((c) => c?.id).find((id) => allowed.includes(id));
    if (!category) continue;
    const points = (Array.isArray(e.geometry) ? e.geometry : [])
      .filter((g) => g?.type === 'Point' && finiteLonLat(g) && Number.isFinite(Date.parse(g.date)))
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const last = points[points.length - 1];
    if (!last || typeof e.id !== 'string' || !e.id || typeof e.title !== 'string') { rejected++; continue; }
    const magnitudeValue = Number(last.magnitudeValue);
    // Vrcholová intenzita naprieč dráhou (karta: „vrchol 115 kt") — len keď
    // sú jednotky uzly, inak sa magnitúdy rôznych javov nemiešajú.
    let peakKt = null;
    if (/kt|kn/i.test(String(last.magnitudeUnit || ''))) {
      for (const g of points) { const v = Number(g.magnitudeValue); if (Number.isFinite(v) && (peakKt === null || v > peakKt)) peakKt = v; }
    }
    const record = {
      id: e.id, title: e.title, category, description: String(e.description || ''),
      lon: last.coordinates[0], lat: last.coordinates[1], time: Date.parse(last.date),
      firstTime: Date.parse(points[0].date), reports: points.length, peakKt,
      magnitude: Number.isFinite(magnitudeValue) && last.magnitudeUnit
        ? { value: magnitudeValue, unit: String(last.magnitudeUnit) } : null,
      track: points.length > 1 ? points.map((g) => [g.coordinates[0], g.coordinates[1]]) : [],
      sources: (Array.isArray(e.sources) ? e.sources : []).filter((s) => /^https?:\/\//.test(s?.url || ''))
        .map((s) => ({ id: String(s.id || ''), url: s.url })),
    };
    if (!events.has(e.id) || events.get(e.id).time < record.time) events.set(e.id, record);
  }
  if (rejected && !events.size) throw new Error('No valid natural event records');
  return { events: [...events.values()].sort((a, b) => b.time - a.time), rejected, truncated: false };
}

/** Text veľkosti udalosti („80 kts"). Pure. */
export function magnitudeLabel(magnitude) {
  if (!magnitude || !Number.isFinite(magnitude.value)) return '';
  const unit = String(magnitude.unit || '').trim();
  return `${Math.round(magnitude.value)}${unit ? ' ' + unit : ''}`;
}

/**
 * Čipy kategórií pre riadok vrstvy (kontrakt `getRowControls`). Pure.
 * Prázdna kategória bez skrytia sa nekreslí — okrem požiarov, ktoré musia
 * mať čip aj pri nule, inak by ich nemal kto zapnúť.
 */
export function naturalEventChips(records, hidden, translate = t) {
  const tally = {};
  for (const r of records) tally[r.category] = (tally[r.category] || 0) + 1;
  const chips = [];
  for (const id of NATURAL_EVENT_CATEGORIES) {
    const count = tally[id] || 0;
    const isHidden = hidden.has(id);
    if (count === 0 && !isHidden && id !== 'wildfires') continue;
    const name = translate(`natural.category.${id}`);
    const next = new Set(hidden);
    if (isHidden) next.delete(id); else next.add(id);
    chips.push({
      id: `cat-${id}`,
      label: isHidden && id === 'wildfires' && count === 0 ? name : `${name} ${count}`,
      active: !isHidden,
      title: translate(isHidden ? 'natural.category.show' : 'natural.category.hide', { name }),
      params: { hiddenNaturalEventCategories: [...next] },
    });
  }
  return { chips };
}

export function createNaturalEventsLayer({
  fetchImpl = (...args) => fetch(...args), now = Date.now,
  overlayHost = { setEntries: setOverlayEntries, setVisible: setOverlaySourceVisible, clear: clearOverlaySource },
  onRowControlsChanged = null,
  eventTarget = (typeof window !== 'undefined' ? window : null),
} = {}) {
  let viewer; let dataSource; let enabled = false; let handler; let removeCull; let selected = null;
  let rowControlsListener = onRowControlsChanged;
  const hidden = new Set(NATURAL_EVENT_DEFAULT_HIDDEN);
  // Dve nezávislé požiadavky (viď hlavička): jadro vždy, požiare na čip.
  const feeds = {
    core: { url: naturalEventsFeedUrl(NATURAL_EVENT_CORE_CATEGORIES, NATURAL_EVENT_CORE_LIMIT), allowed: NATURAL_EVENT_CORE_CATEGORIES, records: [], lastUpdate: null, error: null, retryAt: 0, loading: false, generation: 0, request: null },
    wildfires: { url: naturalEventsFeedUrl(['wildfires'], NATURAL_EVENT_WILDFIRE_LIMIT), allowed: ['wildfires'], records: [], lastUpdate: null, error: null, retryAt: 0, loading: false, generation: 0, request: null },
  };
  const allRecords = () => feeds.core.records.concat(hidden.has('wildfires') ? [] : feeds.wildfires.records);
  const visibleRecords = () => allRecords().filter((r) => !hidden.has(r.category));
  const anyError = () => feeds.core.error || (!hidden.has('wildfires') && feeds.wildfires.error);
  const notifyRowControls = () => { try { rowControlsListener?.(); } catch { /* panel refresh is best effort */ } };

  function cancel(feed) { feed.generation++; feed.request?.abort(); feed.request = null; feed.loading = false; }

  function emit(type, det) {
    if (!eventTarget?.dispatchEvent || typeof CustomEvent !== 'function') return;
    try { eventTarget.dispatchEvent(new CustomEvent(type, { detail: det })); } catch { /* bez DOM */ }
  }
  function select(id) {
    const event = allRecords().find((e) => e.id === id);
    if (!enabled || !event || hidden.has(event.category)) { if (selected) { selected = null; emit(NATURAL_EVENT_CLEARED_EVENT, null); } return; }
    selected = id;
    emit(NATURAL_EVENT_SELECTED_EVENT, event);
    viewer?.scene?.requestRender?.();
  }

  function rebuildEntities() {
    if (!dataSource) return;
    dataSource.entities.removeAll();
    for (const e of visibleRecords()) {
      dataSource.entities.add({
        id: 'natural:' + e.id,
        position: Cesium.Cartesian3.fromDegrees(e.lon, e.lat),
        billboard: {
          image: naturalEventIcon(e.category), width: markerSize(e.category).w, height: markerSize(e.category).h,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM, // hrot špendlíka sedí na mieste
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(2.0e5, 1.15, 1.4e7, 0.55),
        },
      });
      // Trajektória (búrky): tenká čiara po hladine, posledný bod je ikona.
      if (e.track.length > 1) {
        dataSource.entities.add({
          id: 'natural-track:' + e.id,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(e.track.flat()),
            width: 2, clampToGround: true,
            material: new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString(ACCENT).withAlpha(0.7)),
          },
        });
      }
    }
  }

  function publish() {
    if (!enabled) return;
    const records = visibleRecords();
    overlayHost.setVisible(NATURAL_EVENTS_LAYER_ID, true);
    overlayHost.setEntries(NATURAL_EVENTS_LAYER_ID, records.map((e) => ({
      id: e.id, position: Cesium.Cartesian3.fromDegrees(e.lon, e.lat),
      title: e.magnitude ? `${e.title} · ${magnitudeLabel(e.magnitude)}` : e.title,
      variant: 'label', accent: anyError() ? STALE_ACCENT : categoryColor(e.category),
      // Búrky s intenzitou pred drobnými požiarmi, keď sa bijú o miesto.
      priority: 100 + (e.magnitude ? 50 : 0) - (e.category === 'wildfires' ? 40 : 0),
      collisionGroup: 'ambient-label', paintLane: 'ambient-label', interactive: false,
      horizonCull: true, terrainOcclusion: false, gapPx: 18, placement: 'above',
    })), { cohortLimit: 96, collisionCapacity: 48, moving: false });
    if (selected) select(selected);
    viewer?.scene?.requestRender?.();
  }

  function escape(e) { if (e.key === 'Escape' && selected) { selected = null; emit(NATURAL_EVENT_CLEARED_EVENT, null); viewer?.scene?.requestRender?.(); } }

  async function refreshFeed(feed) {
    if (feed.error && now() < feed.retryAt) return false;
    if (feed.lastUpdate !== null && !feed.error && now() - feed.lastUpdate < PERIOD) return true;
    cancel(feed); const token = feed.generation; feed.request = new AbortController(); const controller = feed.request; feed.loading = true;
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetchImpl(feed.url, { signal: controller.signal });
      if (!response.ok) throw new Error('EONET HTTP ' + response.status);
      const parsed = normalizeNaturalEvents(await response.json(), feed.allowed);
      if (token !== feed.generation || !enabled) return false;
      feed.records = parsed.events; feed.lastUpdate = now(); feed.error = null; feed.retryAt = 0;
      return true;
    } catch (e) {
      if (token === feed.generation && enabled) { feed.error = e?.message || 'EONET unavailable'; feed.retryAt = now() + 60000; }
      return false;
    } finally { clearTimeout(timer); if (token === feed.generation) { feed.loading = false; feed.request = null; } }
  }

  const layer = {
    id: NATURAL_EVENTS_LAYER_ID, name: 'Natural events (NASA EONET)', icon: '⚠︎', source: 'NASA EONET', updateInterval: PERIOD,
    init(v) { viewer = v; dataSource = new Cesium.CustomDataSource(NATURAL_EVENTS_LAYER_ID); dataSource.show = false; v.dataSources.add(dataSource); },
    enable() {
      enabled = true; dataSource.show = true; publish();
      registerPickOwner(NATURAL_EVENTS_LAYER_ID, (id) => Boolean(dataSource?.entities.getById(id)));
      if (viewer?.scene?.canvas && !handler) {
        handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        handler.setInputAction((click) => {
          const id = resolvePickId(viewer.scene.pick(click.position));
          if (id?.startsWith('natural:')) select(id.slice(8));
          else if (!id) select(null);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
        globalThis.document?.addEventListener('keydown', escape);
        removeCull = viewer.scene.postRender.addEventListener(() => {
          const occluder = horizonOccluder(viewer.camera);
          for (const entity of dataSource.entities.values) {
            if (!entity.position) continue;
            entity.show = occluder.isPointVisible(entity.position.getValue(viewer.clock.currentTime));
          }
        });
      }
    },
    disable() {
      enabled = false; cancel(feeds.core); cancel(feeds.wildfires); if (dataSource) dataSource.show = false;
      if (selected) { selected = null; emit(NATURAL_EVENT_CLEARED_EVENT, null); } handler?.destroy(); handler = null; removeCull?.(); removeCull = null;
      globalThis.document?.removeEventListener('keydown', escape); unregisterPickOwner(NATURAL_EVENTS_LAYER_ID);
      overlayHost.clear(NATURAL_EVENTS_LAYER_ID); overlayHost.setVisible(NATURAL_EVENTS_LAYER_ID, false);
    },
    async update() {
      if (!enabled || !dataSource) return false;
      const wantFires = !hidden.has('wildfires');
      const results = await Promise.all([refreshFeed(feeds.core), wantFires ? refreshFeed(feeds.wildfires) : Promise.resolve(true)]);
      if (!enabled) return false;
      rebuildEntities(); publish(); notifyRowControls();
      return results.every(Boolean);
    },
    destroy() {
      layer.disable(); if (dataSource) viewer?.dataSources.remove(dataSource, true);
      dataSource = null; viewer = null;
      for (const feed of Object.values(feeds)) { feed.records = []; feed.lastUpdate = null; feed.error = null; feed.retryAt = 0; }
    },
    getStats() {
      const records = visibleRecords(); const error = anyError() || null;
      const lastUpdate = feeds.core.lastUpdate;
      return {
        count: records.length, lastUpdate, error, loading: feeds.core.loading || feeds.wildfires.loading,
        stale: Boolean(error && records.length),
        rejected: 0,
        source: 'NASA EONET · ' + t('natural.open'),
      };
    },
    getRowControls() { return naturalEventChips(allRecords().concat(hidden.has('wildfires') ? feeds.wildfires.records : []), hidden); },
    setRowControlsListener(fn) { rowControlsListener = typeof fn === 'function' ? fn : null; },
    /** Kontrakt manažéra: `hiddenNaturalEventCategories` prepne čipy. */
    setParams(params) {
      const next = Array.isArray(params?.hiddenNaturalEventCategories) ? params.hiddenNaturalEventCategories : null;
      if (!next) return false;
      hidden.clear(); for (const id of next) if (NATURAL_EVENT_CATEGORIES.includes(id)) hidden.add(id);
      if (selected && hidden.has(allRecords().find((e) => e.id === selected)?.category)) { selected = null; emit(NATURAL_EVENT_CLEARED_EVENT, null); }
      rebuildEntities(); publish(); notifyRowControls();
      // Požiare zapnuté prvýkrát: ich požiadavka ešte nebežala — vyžiadať.
      if (enabled && !hidden.has('wildfires') && feeds.wildfires.lastUpdate === null) layer.update();
      return true;
    },
    getParams() { return { hiddenNaturalEventCategories: [...hidden] }; },
    /** Zrušenie výberu z karty (krížik/Escape) — vrstva drží stav výberu. */
    clearSelection() { if (selected) { selected = null; viewer?.scene?.requestRender?.(); } },
    getAnalystRecords(max = 200) {
      return enabled ? visibleRecords().slice(0, max).map((e) => ({ ...e, source: 'NASA EONET', status: 'open', stale: Boolean(anyError()) })) : [];
    },
  };
  return layer;
}

export default createNaturalEventsLayer();
