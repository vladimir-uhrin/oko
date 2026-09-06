// src/data/volcanoes.js
/**
 * @module volcanoes
 * @description Hlásené sopečné udalosti (NASA EONET) ako 3D objekty na teréne
 * (2026-09-05, „nech je to 3D, nech to nejako vypadá"):
 *   • kužeľ sopky — procedurálny glTF (public/models/volcano.glb, vlastné dielo
 *     CC0), tmavé svahy a emisívny kráter, `minimumPixelSize` drží tvar aj z
 *     obežnej dráhy, `maximumScale` bráni tomu, aby zblízka narástol do neba;
 *   • stĺp dymu — priesvitný SVG billboard nad kráterom, jasnejší pri
 *     hláseniach mladších než 60 dní;
 *   • popis v ambientnom pruhu (krátky názov bez „Volcano, Country");
 *   • klik → DOM karta (volcanoCard.js): fotka, výška, typ, stav, aktivita,
 *     odkazy. Escape/krížik ju zavrie.
 * Dáta a licencia sú nezmenené: EONET, verejné, bez kľúča (DATA_SOURCES.md).
 */
import * as Cesium from 'cesium';
import { t } from '../i18n.js';
import { horizonOccluder } from './iconOrientation.js';
import { setOverlayEntries, setOverlaySourceVisible, clearOverlaySource } from '../overlays/worldOverlay.js';
import { registerPickOwner, unregisterPickOwner, resolvePickId } from './pickRegistry.js';
import { parseEonetVolcanoTitle } from './volcanoInfo.js';
import { VOLCANO_CLEARED_EVENT, VOLCANO_SELECTED_EVENT } from './volcanoCard.js';

export const VOLCANO_FEED_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?category=volcanoes&status=open&limit=200';
export const VOLCANO_MODEL_URL = '/models/volcano.glb';
/** Model je v metroch (základňa 2,4 km); z diaľky drží aspoň toľko px. */
export const VOLCANO_MODEL_MIN_PX = 44;
/** Strop zväčšenia zblízka — kužeľ nesmie prerásť skutočnú horu. */
export const VOLCANO_MODEL_MAX_SCALE = 6;
const PERIOD = 10 * 60 * 1000;
const ACCENT = '#ff995c';
const STALE_ACCENT = '#a6b1be';

export function normalizeVolcanoEvents(json) {
  if (!Array.isArray(json?.events)) throw new Error('Invalid EONET response');
  const events = new Map(); let rejected = 0;
  for (const e of json.events) {
    if (!e || typeof e !== 'object') { rejected++; continue; }
    if (e.closed || !e.categories?.some(c => c.id === 'volcanoes')) continue;
    const points = (Array.isArray(e.geometry) ? e.geometry : []).filter(g => g.type === 'Point'
      && Array.isArray(g.coordinates) && g.coordinates.length >= 2
      && Number.isFinite(g.coordinates[0]) && Math.abs(g.coordinates[0]) <= 180
      && Number.isFinite(g.coordinates[1]) && Math.abs(g.coordinates[1]) <= 90
      && Number.isFinite(Date.parse(g.date))).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const geometry = points[0];
    if (!geometry || typeof e.id !== 'string' || !e.id || typeof e.title !== 'string') { rejected++; continue; }
    const record = { id: e.id, title: e.title, description: String(e.description || ''),
      lon: geometry.coordinates[0], lat: geometry.coordinates[1], time: Date.parse(geometry.date),
      // Prvé hlásenie a počet hlásení — karta z nich robí „aktivita od … (N hlásení)".
      firstTime: Date.parse(points[points.length - 1].date), reports: points.length,
      sources: (Array.isArray(e.sources) ? e.sources : []).filter(s => /^https?:\/\//.test(s.url || ''))
        .map(s => ({ id: String(s.id || ''), url: s.url })) };
    if (!events.has(e.id) || events.get(e.id).time < record.time) events.set(e.id, record);
  }
  if (rejected && !events.size) throw new Error('No valid volcano records');
  return { events: [...events.values()].sort((a, b) => b.time - a.time).slice(0, 200), rejected, truncated: json.events.length >= 200 };
}

export function createVolcanoesLayer({ fetchImpl = (...args) => fetch(...args), now = Date.now,
  overlayHost = { setEntries: setOverlayEntries, setVisible: setOverlaySourceVisible, clear: clearOverlaySource },
  eventTarget = (typeof window !== 'undefined' ? window : null),
} = {}) {
  let viewer; let dataSource; let enabled = false; let records = []; let lastUpdate = null;
  let error = null; let loading = false; let generation = 0; let request; let handler; let removeCull;
  let selected = null; let truncated = false; let rejected = 0;
  let retryAt = 0;
  function cancel() { generation++; request?.abort(); request = null; loading = false; }
  function emit(type, detail) {
    if (!eventTarget?.dispatchEvent || typeof CustomEvent !== 'function') return;
    try { eventTarget.dispatchEvent(new CustomEvent(type, { detail })); } catch { /* bez DOM */ }
  }
  function select(id) {
    const event = records.find(e => e.id === id);
    if (!enabled || !event) { if (selected) { selected = null; emit(VOLCANO_CLEARED_EVENT, null); } return; }
    selected = id;
    emit(VOLCANO_SELECTED_EVENT, event);
    viewer?.scene?.requestRender?.();
  }
  function publish() {
    if (!enabled) return;
    overlayHost.setVisible('volcanoes', true);
    overlayHost.setEntries('volcanoes', records.map(e => ({ id: e.id, position: Cesium.Cartesian3.fromDegrees(e.lon, e.lat),
      title: parseEonetVolcanoTitle(e.title).name || e.title, variant: 'label', accent: error ? STALE_ACCENT : ACCENT, priority: 100,
      collisionGroup: 'ambient-label', paintLane: 'ambient-label', interactive: false,
      horizonCull: true, terrainOcclusion: false, gapPx: 26, placement: 'above',
    })), { cohortLimit: 96, collisionCapacity: 48, moving: false });
    viewer?.scene?.requestRender?.();
  }
  function rebuildEntities() {
    if (!dataSource) return;
    dataSource.entities.removeAll();
    for (const e of records) {
      // Len 3D kužeľ. Dymový billboard (v1) vyzeral ako nálepka — preč
      // (2026-09-06: „to ako vyzerá SVG"); aktivitu nesie svietiaci prieduch
      // modelu a ambientný popis, detail je na karte.
      dataSource.entities.add({ id: 'volcano:' + e.id, position: Cesium.Cartesian3.fromDegrees(e.lon, e.lat),
        model: {
          uri: VOLCANO_MODEL_URL, minimumPixelSize: VOLCANO_MODEL_MIN_PX, maximumScale: VOLCANO_MODEL_MAX_SCALE,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        } });
    }
  }
  const layer = {
    id: 'volcanoes', name: 'Volcanic events', icon: '△', source: 'NASA EONET', updateInterval: PERIOD,
    init(v) { viewer = v; dataSource = new Cesium.CustomDataSource('volcanoes'); dataSource.show = false; v.dataSources.add(dataSource); },
    enable() {
      enabled = true; dataSource.show = true; publish();
      registerPickOwner('volcanoes', id => Boolean(dataSource?.entities.getById(id)));
      if (viewer?.scene?.canvas && !handler) {
        handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        handler.setInputAction(click => {
          const id = resolvePickId(viewer.scene.pick(click.position));
          if (id?.startsWith('volcano:')) select(id.slice(8));
          else if (!id) select(null);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
        removeCull = viewer.scene.postRender.addEventListener(() => {
          const occluder = horizonOccluder(viewer.camera);
          for (const entity of dataSource.entities.values) {
            if (!entity.position) continue;
            entity.show = occluder.isPointVisible(entity.position.getValue(viewer.clock.currentTime));
          }
        });
      }
    },
    disable() { enabled = false; cancel(); if (dataSource) dataSource.show = false;
      if (selected) { selected = null; emit(VOLCANO_CLEARED_EVENT, null); }
      handler?.destroy(); handler = null; removeCull?.(); removeCull = null;
      unregisterPickOwner('volcanoes');
      overlayHost.clear('volcanoes'); overlayHost.setVisible('volcanoes', false); },
    async update() {
      if (!enabled || !dataSource) return false;
      if (error && now() < retryAt) return false;
      if (lastUpdate !== null && !error && now() - lastUpdate < PERIOD) return true;
      cancel(); const token = generation; request = new AbortController(); const controller = request; loading = true;
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetchImpl(VOLCANO_FEED_URL, { signal: controller.signal });
        if (!response.ok) throw new Error('EONET HTTP ' + response.status);
        const parsed = normalizeVolcanoEvents(await response.json());
        if (token !== generation || !enabled) return false;
        records = parsed.events; rejected = parsed.rejected; truncated = parsed.truncated;
        rebuildEntities();
        lastUpdate = now(); error = null; retryAt = 0; publish(); return true;
      } catch (e) {
        if (token === generation && enabled) { error = e?.message || 'EONET unavailable'; retryAt = now() + 60000; publish(); }
        return false;
      } finally { clearTimeout(timer); if (token === generation) { loading = false; request = null; } }
    },
    destroy() { layer.disable(); if (dataSource) viewer?.dataSources.remove(dataSource, true);
      dataSource = null; viewer = null; records = []; lastUpdate = null; error = null; retryAt = 0; },
    /** Zrušenie výberu z karty (krížik/Escape) — vrstva drží stav výberu. */
    clearSelection() { if (selected) { selected = null; viewer?.scene?.requestRender?.(); } },
    getStats() { return { count: records.length, lastUpdate, error, loading, stale: Boolean(error && records.length), rejected,
      source: 'NASA EONET · ' + t('volcano.open') + (truncated ? ' · ' + t('quake.truncated') : '') }; },
    getAnalystRecords(max = 200) { return enabled ? records.slice(0, max).map(e => ({ ...e, source: 'NASA EONET', status: 'open', stale: Boolean(error) })) : []; },
  };
  return layer;
}
export default createVolcanoesLayer();
