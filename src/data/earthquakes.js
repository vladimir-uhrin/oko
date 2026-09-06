import * as Cesium from 'cesium';
import { t } from '../i18n.js';
import { createEarthquakePulse, EARTHQUAKE_FELT_MIN_MAG, earthquakeFeltRadiusM } from './earthquakePulse.js';
import { createEarthquakeHoverCard } from './earthquakeHoverCard.js';
import { normalizeEarthquakeFeed, mergeEarthquakeCatalogs, EARTHQUAKE_DAY_MS, EARTHQUAKE_RENDER_LIMIT } from './earthquakeCatalog.js';
import { registerPickOwner, unregisterPickOwner, resolvePickId, isOwnedByOtherLayer } from './pickRegistry.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
  getOverlayPaintRect,
} from '../overlays/worldOverlay.js';

/**
 * USGS earthquake discs — last 24 hours, M2.5+.
 *
 * Ellipse axes are STATIC (plain numbers), redefined only when a poll brings
 * new data. They must never become a `CallbackProperty` again: every entity
 * here is a `CLAMP_TO_GROUND` ellipse, and a per-frame axis re-tessellates its
 * ground primitive on EVERY frame. Measured on the shipped 58-event feed
 * (2026-08-20 QA hunt, parked camera over SF at 40 km):
 *
 *   58 discs, callback axes → 32.4 ms/frame, 30 fps
 *   58 discs, static axes   →  1.4 ms/frame, 60 fps
 *
 * Pulsars now use separate CSS transform/opacity symbols. Their projection
 * follows existing scene renders; animation never rebuilds ground primitives
 * or keeps the Cesium render governor awake.
 */

const DETAIL_SOURCE = 'earthquake-detail';

export const EARTHQUAKE_OVERLAY_SOURCE_ID = 'earthquakes';
export const EARTHQUAKE_OVERLAY_COHORT_LIMIT = 96;
export const EARTHQUAKE_OVERLAY_COLLISION_CAPACITY = 48;

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

/**
 * Color by depth:
 *  - Shallow (<70km): Red
 *  - Intermediate (70-300km): Orange
 *  - Deep (>300km): Yellow
 */
function depthColor(depthKm) {
  if (depthKm < 70) return Cesium.Color.RED;
  if (depthKm < 300) return Cesium.Color.ORANGE;
  return Cesium.Color.YELLOW;
}

/**
 * Build the source-owned presentation for one ambient magnitude label.
 * Magnitude formatting deliberately remains here instead of moving into the
 * shared renderer.
 * @param {object} input
 * @param {string} input.id Stable USGS or deterministic fallback id.
 * @param {Cesium.Cartesian3} input.position Ground anchor shared with the pulse.
 * @param {number} input.magnitude USGS magnitude.
 * @param {string} input.accent Source-owned depth-band color.
 * @returns {object}
 */
export function createEarthquakeOverlayEntry({ id, position, magnitude, accent }) {
  const mag = Number(magnitude);
  return {
    id: String(id),
    position,
    variant: 'label',
    title: `M${mag.toFixed(1)}`,
    accent,
    priority: Math.round(mag * 1000),
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Keep the largest events, with stable identity as the tie-break. */
export function selectEarthquakeOverlayCohort(
  entries,
  limit = EARTHQUAKE_OVERLAY_COHORT_LIMIT,
) {
  const cap = Math.max(0, Math.min(
    EARTHQUAKE_OVERLAY_COHORT_LIMIT,
    Math.floor(Number(limit) || 0),
  ));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice().sort((a, b) => (
    b.priority - a.priority || String(a.id).localeCompare(String(b.id))
  )).slice(0, cap);
}

/**
 * Map one earthquake's raw plain values to a JSON-safe analyst record
 * (analyst query engine seam). Pure — no Cesium types. Missing/unknown
 * fields are null, never NaN/undefined. Falls back to an index-based id
 * when the USGS event id is absent.
 * @param {Object|null|undefined} raw - Plain values pulled off the entity:
 *   {id, mag, place, time, depth, lat, lon}.
 * @param {number} [index=0] - Position in the snapshot (fallback id only).
 * @returns {{id: string, magnitude: number|null, depthKm: number|null,
 *   lat: number|null, lon: number|null, timeMs: number|null, place: string|null}}
 */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => { const t = String(v ?? '').trim(); return t || null; };
  return {
    id: text(raw?.id) || `QUAKE-${String(index).padStart(4, '0')}`,
    magnitude: num(raw?.mag),
    depthKm: num(raw?.depth),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    timeMs: num(raw?.time), // USGS epoch ms
    place: text(raw?.place),
  };
}


export function createEarthquakeDetail(event, position) {
  const details = [t(event.association === 'probable' ? 'quake.probable' : 'quake.single')];
  for (const solution of event.solutions) {
    details.push(solution.source + ' · ' + solution.sourceId + (solution.stale ? ' · ' + t('quake.stale') : ''));
    details.push('M' + solution.mag.toFixed(1) + (solution.magType ? ' ' + solution.magType : '')
      + ' · ' + t('quake.depth') + ': ' + (solution.depth === null ? '—' : solution.depth.toFixed(1) + ' km'));
    details.push(solution.lat.toFixed(4) + '°, ' + solution.lon.toFixed(4) + '°');
    details.push(new Date(solution.time).toISOString().replace('T', ' ').replace('.000Z', ' UTC'));
    details.push(t('quake.solution') + ': ' + (solution.status || solution.author || t('quake.unknown')));
  }
  // Odhad citeľného dosahu z magnitúdy (nie ShakeMap) — kruh na mape ho ukazuje.
  if (Number.isFinite(event.mag) && event.mag >= EARTHQUAKE_FELT_MIN_MAG) {
    details.push(t('quake.felt', { km: Math.round(earthquakeFeltRadiusM(event.mag) / 1000) }));
  }
  details.push(t('quake.symbol'));
  return {
    id: event.id, position, variant: 'selected', selected: true, protected: true,
    paintLane: 'selected', collisionGroup: 'ambient-card', priority: Number.MAX_SAFE_INTEGER,
    title: event.place || t('quake.event'), details, accent: '#ffb347', interactive: false,
    anchorRadiusPx: 9, minAnchorGapPx: 11, verticalOnly: true, placement: 'above',
    edgeFade: 'keyhole', horizonCull: true, terrainOcclusion: false,
  };
}

export function createEarthquakesLayer({ overlayHost = DEFAULT_OVERLAY_HOST,
  sources = ['USGS', 'EMSC'], now = Date.now, fetchImpl = (...args) => fetch(...args),
  pulseFactory = createEarthquakePulse,
  hoverFactory = createEarthquakeHoverCard,
} = {}) {
  let dataSource = null; let viewer = null; let enabled = false;
  let lastUpdate = null; let lastError = null; let loading = false;
  let minMagnitude = 2.5; let events = []; let selectedId = null;
  let controller = null; let generation = 0; let clickHandler = null;
  let controlsListener = null; let sourceStates = new Map();
  let omitted = 0; let signatures = new Map();
  // Prstenec citeľného dosahu otrasov (2026-09-06, vzor Sentinel povrchová vlna):
  // veľký, tlmený, STATICKÝ kruh na teréne — vlastný dataSource, aby sa nemiešal
  // do pickovania ohnísk. Len M >= EARTHQUAKE_FELT_MIN_MAG.
  let feltSource = null; let feltSignatures = new Map();
  let pulse = null; let pulsar = true;
  let hover = null; let hoverRecords = []; let hoverTimer; let leaveTimer; let pointer = null;
  let removeCameraHover = null;

  function clearHover() { clearTimeout(hoverTimer); clearTimeout(leaveTimer); hoverTimer = null; pointer = null; hover?.hide(); }
  function hoverAtPointer() {
    hoverTimer = null;
    if (!enabled || !pointer) return;
    const bounds = viewer.scene.canvas.getBoundingClientRect();
    const x = pointer.x - bounds.left; const y = pointer.y - bounds.top;
    let event = null;
    for (const record of hoverRecords) {
      const rect = getOverlayPaintRect(EARTHQUAKE_OVERLAY_SOURCE_ID, record.id);
      const scale = rect?.paintScale ?? 1;
      if (rect && (rect.alpha ?? 1) >= .3 && x >= rect.x && y >= rect.y
        && x <= rect.x + rect.w * scale && y <= rect.y + rect.h * scale) { event = record; break; }
    }
    if (!event) {
      const pulseId = pulse?.hitTest?.(x, y);
      if (pulseId) event = events.find(e => e.id === pulseId);
    }
    if (!event) {
      const id = resolvePickId(viewer.scene.pick(new Cesium.Cartesian2(x, y)));
      if (id && dataSource?.entities.getById(id)) event = events.find(e => 'earthquake:' + e.id === id);
    }
    if (event) { clearTimeout(leaveTimer); hover?.show(event, pointer); }
    else leaveHover();
  }
  function moveHover(e) {
    if (e.buttons || e.pointerType === 'touch') { clearHover(); return; }
    pointer = { x: e.clientX, y: e.clientY };
    if (!hoverTimer) hoverTimer = setTimeout(hoverAtPointer, 80);
  }
  function leaveHover() {
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => { if (!hover?.isHovered()) clearHover(); }, 220);
  }

  function cancel() { generation++; controller?.abort(); controller = null; loading = false; }
  function publishDetail() {
    const event = events.find(e => e.id === selectedId);
    const entity = event && dataSource?.entities.getById('earthquake:' + event.id);
    if (!enabled || !entity) { selectedId = null; pulse?.setSelected(null); overlayHost.clearSource(DETAIL_SOURCE); return; }
    pulse?.setSelected(selectedId);
    overlayHost.setVisible(DETAIL_SOURCE, true);
    overlayHost.setEntries(DETAIL_SOURCE, [createEarthquakeDetail(event, entity.position.getValue(Cesium.JulianDate.now()))],
      { cohortLimit: 1, collisionCapacity: 0, moving: false });
  }
  function render() {
    if (!dataSource) return;
    const cutoff = now() - EARTHQUAKE_DAY_MS;
    const eligible = events.filter(e => e.time >= cutoff && e.time <= now() + 60_000 && e.mag >= minMagnitude)
      .sort((a, b) => b.mag - a.mag || a.id.localeCompare(b.id));
    const shown = eligible.slice(0, EARTHQUAKE_RENDER_LIMIT);
    hoverRecords = shown.slice(0, EARTHQUAKE_OVERLAY_COHORT_LIMIT); clearHover();
    omitted = eligible.length - shown.length;
    // Prepare every replacement before touching the currently valid scene.
    const prepared = shown.map(event => {
      const position = Cesium.Cartesian3.fromDegrees(event.lon, event.lat);
      const color = event.depth === null ? Cesium.Color.GRAY : depthColor(event.depth);
      const radius = Math.pow(2, event.mag) * 1000;
      return { event, position, color, radius, signature: JSON.stringify(event) };
    });
    const keep = new Set(); const labels = [];
    dataSource.entities.suspendEvents();
    try {
      for (const { event, position, color, radius, signature } of prepared) {
        const id = 'earthquake:' + event.id;
        keep.add(id);
        let entity = dataSource.entities.getById(id);
        if (!entity) entity = dataSource.entities.add({ id });
        if (signatures.get(id) !== signature) {
          entity.position = position;
          entity.ellipse = new Cesium.EllipseGraphics({
            semiMajorAxis: radius, semiMinorAxis: radius,
            // Tlmená výplň (2026-09-06): disk je len jemný podklad, hviezdou je
            // viaclíniový pulzar (earthquakePulse.js) — plný disk ho prekrýval.
            material: new Cesium.ColorMaterialProperty(color.withAlpha(event.mag >= 5 ? 0.16 : 0.11)),
            outline: true, outlineColor: color.withAlpha(0.55), outlineWidth: event.mag >= 5 ? 2 : 1,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          });
          entity.properties = new Cesium.PropertyBag({ usgsId: event.solutions.find(s => s.source === 'USGS')?.sourceId ?? null,
            mag: event.mag, place: event.place, time: event.time, depth: event.depth });
          signatures.set(id, signature);
        }
        labels.push(createEarthquakeOverlayEntry({ id: event.id, position, magnitude: event.mag, accent: color.toCssColorString() }));
      }
      for (const entity of [...dataSource.entities.values]) {
        if (!keep.has(entity.id)) { dataSource.entities.remove(entity); signatures.delete(entity.id); }
      }
    } finally { dataSource.entities.resumeEvents(); }

    // Prstenec citeľného dosahu otrasov — veľký tlmený STATICKÝ kruh (bez fill,
    // len obrys) na teréne, len pre M >= EARTHQUAKE_FELT_MIN_MAG (menšie sa cítia
    // len lokálne, kruh by bol šum). Statické osi, žiadny CallbackProperty →
    // výkonové piny ostávajú (viď hlavička súboru).
    if (feltSource) {
      const keepFelt = new Set();
      feltSource.entities.suspendEvents();
      try {
        for (const { event, position, color } of prepared) {
          if (event.mag < EARTHQUAKE_FELT_MIN_MAG) continue;
          const feltId = 'earthquake-felt:' + event.id;
          keepFelt.add(feltId);
          let felt = feltSource.entities.getById(feltId);
          if (!felt) felt = feltSource.entities.add({ id: feltId });
          const feltRadius = earthquakeFeltRadiusM(event.mag);
          const feltSig = `${feltRadius}|${color.toCssColorString()}`;
          if (feltSignatures.get(feltId) !== feltSig) {
            felt.position = position;
            felt.ellipse = new Cesium.EllipseGraphics({
              semiMajorAxis: feltRadius, semiMinorAxis: feltRadius,
              material: new Cesium.ColorMaterialProperty(color.withAlpha(0.05)),
              outline: true, outlineColor: color.withAlpha(0.3), outlineWidth: 1,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            });
            feltSignatures.set(feltId, feltSig);
          }
        }
        for (const entity of [...feltSource.entities.values]) {
          if (!keepFelt.has(entity.id)) { feltSource.entities.remove(entity); feltSignatures.delete(entity.id); }
        }
      } finally { feltSource.entities.resumeEvents(); }
    }
    if (enabled) overlayHost.setEntries(EARTHQUAKE_OVERLAY_SOURCE_ID, selectEarthquakeOverlayCohort(labels), {
      cohortLimit: EARTHQUAKE_OVERLAY_COHORT_LIMIT, collisionCapacity: EARTHQUAKE_OVERLAY_COLLISION_CAPACITY, moving: false,
    });
    pulse?.setEvents(prepared);
    pulse?.setVisible(enabled && pulsar);
    publishDetail();
    viewer?.scene?.requestRender?.();
  }
  function onKey(event) {
    if (event.key !== 'Escape' || !selectedId || event.defaultPrevented) return;
    selectedId = null; publishDetail(); viewer?.scene?.requestRender?.();
    event.preventDefault(); event.stopImmediatePropagation();
  }
  function installInteraction() {
    registerPickOwner('earthquakes', id => Boolean(dataSource?.entities.getById(id)));
    if (clickHandler || !viewer?.scene?.canvas) return;
    clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    clickHandler.setInputAction(click => {
      const picked = viewer.scene.pick(click.position);
      const id = resolvePickId(picked);
      if (id && isOwnedByOtherLayer('earthquakes', id)) return;
      if (id && dataSource.entities.getById(id)) selectedId = id.slice('earthquake:'.length);
      else if (!picked) selectedId = null;
      publishDetail(); viewer.scene.requestRender?.();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    viewer.scene.canvas.addEventListener('pointermove', moveHover);
    viewer.scene.canvas.addEventListener('pointerleave', leaveHover);
    viewer.scene.canvas.addEventListener('pointerdown', clearHover);
    removeCameraHover = viewer.camera?.moveStart?.addEventListener(clearHover) || null;
    globalThis.document?.addEventListener('keydown', onKey);
  }
  function removeInteraction() {
    clearHover();
    viewer?.scene?.canvas?.removeEventListener('pointermove', moveHover);
    viewer?.scene?.canvas?.removeEventListener('pointerleave', leaveHover);
    viewer?.scene?.canvas?.removeEventListener('pointerdown', clearHover);
    removeCameraHover?.(); removeCameraHover = null;
    clickHandler?.destroy(); clickHandler = null;
    globalThis.document?.removeEventListener('keydown', onKey);
    unregisterPickOwner('earthquakes');
  }
  const layer = {
    id: 'earthquakes', name: 'Earthquakes (24h)', icon: '∿', source: 'USGS + EMSC', updateInterval: 60000,
    init(activeViewer) {
      cancel(); viewer = activeViewer; enabled = false;
      pulse?.destroy(); pulse = pulseFactory(viewer, { now });
      hover?.destroy(); hover = hoverFactory();
      dataSource = new Cesium.CustomDataSource('earthquakes'); dataSource.show = false;
      viewer.dataSources.add(dataSource);
      feltSource = new Cesium.CustomDataSource('earthquake-felt'); feltSource.show = false; viewer.dataSources.add(feltSource); feltSignatures = new Map();
      events = []; sourceStates = new Map(); signatures = new Map();
      lastUpdate = null; lastError = null; selectedId = null;
      overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, false);
    },
    enable() { enabled = true; if (dataSource) dataSource.show = true; if (feltSource) feltSource.show = true;
      overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, true); installInteraction(); if (events.length) render(); },
    disable() { enabled = false; cancel(); removeInteraction(); selectedId = null;
      pulse?.setVisible(false);
      if (dataSource) dataSource.show = false;
      if (feltSource) feltSource.show = false;
      overlayHost.clearSource(DETAIL_SOURCE); overlayHost.setVisible(DETAIL_SOURCE, false);
      overlayHost.clearSource(EARTHQUAKE_OVERLAY_SOURCE_ID); overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, false); },
    async update() {
      if (!enabled || !dataSource) return false;
      cancel(); const requestGeneration = generation; const requestController = new AbortController();
      controller = requestController; loading = true;
      const timer = setTimeout(() => requestController.abort(), 15_000);
      try {
        const results = await Promise.allSettled(sources.map(async source => {
          const response = await fetchImpl('/api/earthquakes/' + source.toLowerCase(), { signal: requestController.signal, cache: 'no-store' });
          if (!response.ok) throw new Error(source + ' HTTP ' + response.status);
          const payload = await response.json();
          const parsed = Array.isArray(payload?.records) ? payload : normalizeEarthquakeFeed(payload, source);
          return { ...parsed, fetchedAt: payload.fetchedAt === null ? null : payload.fetchedAt ?? now(), stale: Boolean(payload.stale), error: payload.error || null };
        }));
        if (requestGeneration !== generation || !enabled || !dataSource) return false;
        for (let i = 0; i < sources.length; i++) {
          const source = sources[i]; const result = results[i];
          if (result.status === 'fulfilled') sourceStates.set(source, result.value);
          else sourceStates.set(source, { ...(sourceStates.get(source) || { records: [], fetchedAt: null }),
            stale: true, error: requestController.signal.aborted ? t('quake.timeout') : result.reason?.message || t('quake.unavailable') });
        }
        const records = [...sourceStates.entries()].flatMap(([source, state]) => state.records
          .filter(r => r.time >= now() - EARTHQUAKE_DAY_MS && r.time <= now() + 60_000)
          .map(r => ({ ...r, source, stale: state.stale })));
        events = mergeEarthquakeCatalogs(records, events);
        const errors = [...sourceStates.entries()].filter(([, s]) => s.error).map(([name, s]) => s.error.startsWith(name) ? s.error : name + ': ' + s.error);
        lastError = errors.join(' · ') || null;
        const healthy = [...sourceStates.values()].filter(s => !s.stale && !s.error);
        if (healthy.length) lastUpdate = Math.max(...healthy.map(s => s.fetchedAt));
        render(); controlsListener?.();
        return healthy.length > 0;
      } catch (error) {
        if (requestGeneration === generation && enabled) lastError = error?.message || t('quake.unavailable');
        return false;
      } finally {
        clearTimeout(timer);
        if (requestGeneration === generation) { controller = null; loading = false; }
      }
    },
    destroy(activeViewer = viewer) {
      layer.disable(); if (dataSource) activeViewer?.dataSources.remove(dataSource, true);
      if (feltSource) activeViewer?.dataSources.remove(feltSource, true); feltSource = null;
      pulse?.destroy(); pulse = null;
      hover?.destroy(); hover = null; hoverRecords = [];
      dataSource = null; viewer = null; events = []; sourceStates.clear(); signatures.clear();
      lastUpdate = null; lastError = null; controlsListener = null;
    },
    getParams() { return { minMagnitude, pulsar }; },
    setParams(params) {
      const value = params?.minMagnitude;
      if (!params || (value === undefined && params.pulsar === undefined)) return false;
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < -3 || value > 10)) return false;
      if (params.pulsar !== undefined && typeof params.pulsar !== 'boolean') return false;
      if (value !== undefined) minMagnitude = value;
      if (params.pulsar !== undefined) pulsar = params.pulsar;
      render(); controlsListener?.(); return true;
    },
    setRowControlsListener(listener) { controlsListener = typeof listener === 'function' ? listener : null; },
    getRowControls() {
      return { chips: [-3, 1, 2.5, 4.5].map(value => ({ id: 'mag-' + value,
        label: value === -3 ? t('quake.all') : 'M' + value + '+', title: t('quake.minimum'),
        active: value === minMagnitude, params: { minMagnitude: value } })).concat({
          id: 'pulsar', label: t('quake.pulsar'), title: t('quake.pulsarHint'), active: pulsar, params: { pulsar: !pulsar },
        }),
        legend: sources.map(source => ({ label: source, count: sourceStates.get(source)?.records.length || 0,
          color: sourceStates.get(source)?.error ? '#929ca5' : '#ffb347', blurb: t('quake.sourceCount') })) };
    },
    selectById(id) { if (!dataSource?.entities.getById('earthquake:' + id) || !enabled) return false;
      selectedId = id; publishDetail(); viewer?.scene?.requestRender?.(); return true; },
    getSelectedInfo() { return events.find(e => e.id === selectedId) || null; },
    getAnalystRecords(maxCount = 2000) {
      if (!enabled || !dataSource) return [];
      const visible = new Set(dataSource.entities.values.map(e => e.id));
      return events.filter(e => visible.has('earthquake:' + e.id)).slice(0, Math.max(1, Number.isFinite(maxCount) ? Math.floor(maxCount) : 2000))
        .map(e => ({ ...mapAnalystRecord(e), association: e.association, sources: e.solutions.map(s => ({ ...s })) }));
    },
    getStats() { return { count: dataSource?.entities.values.length || 0, lastUpdate, error: lastError, loading,
      stale: [...sourceStates.values()].some(s => s.stale), source: sources.join(' + ') + ' · ' + (minMagnitude === -3 ? t('quake.all') : t('quake.threshold', { mag: minMagnitude }))
        + (omitted ? ' · ' + t('quake.omitted', { count: omitted }) : '')
        + ([...sourceStates.values()].some(s => s.truncated) ? ' · ' + t('quake.truncated') : ''),
      omitted, rejected: [...sourceStates.values()].reduce((n, s) => n + (s.rejected || 0), 0),
      sourceStatus: Object.fromEntries([...sourceStates].map(([name, s]) => [name, { count: s.records.length, fetchedAt: s.fetchedAt, stale: s.stale, error: s.error, truncated: Boolean(s.truncated) }])),
    }; },
  };
  return layer;
}

const earthquakesLayer = createEarthquakesLayer();
export default earthquakesLayer;
