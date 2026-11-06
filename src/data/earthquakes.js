import * as Cesium from 'cesium';
import { t } from '../i18n.js';
import { createEarthquakePulse } from './earthquakePulse.js';
import { createEarthquakeHoverCard, earthquakeImpactLines, earthquakeSequenceLine } from './earthquakeHoverCard.js';
import { linkEarthquakeSequences, formatElapsed, sequenceMembers } from './earthquakeSequence.js';
import {
  normalizeEarthquakeFeed, mergeEarthquakeCatalogs, isSignificantEarthquake, earthquakePeriod, earthquakeFeltRadiusM,
  EARTHQUAKE_DAY_MS, EARTHQUAKE_RENDER_LIMIT, EARTHQUAKE_PERIODS, EARTHQUAKE_FELT_MIN_MAG,
} from './earthquakeCatalog.js';
import { createShakemapOverlay, shakemapEventId } from './earthquakeShakemap.js';
import { createPlateBoundaries } from './earthquakePlates.js';
import { registerPickOwner, unregisterPickOwner, resolvePickId, isOwnedByOtherLayer } from './pickRegistry.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
  getOverlayPaintRect,
} from '../overlays/worldOverlay.js';

/**
 * USGS + EMSC earthquake discs — last 24 hours by default; 7 or 30 days on request (2026-11-06).
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
 *
 * 2026-11-06 (vlastník: „sprav" — návrhy k zemetraseniam): obdobie 24 h / 7 dní / 30 dní, filter
 * Významné, zvýraznenie sekvencie (výber hlavného otrasu alebo dotrasu skryje ostatné disky
 * a štítky — prepína sa len `entity.show`, geometria sa neprestavuje), mapa otrasov ShakeMap
 * po výbere (earthquakeShakemap.js), hranice platní (earthquakePlates.js), čip odberu upozornení
 * na otrasy citeľné na Slovensku (src/quakeAlerts.js) a kratšia karta výberu so zalomením.
 */

const DETAIL_SOURCE = 'earthquake-detail';

export const EARTHQUAKE_OVERLAY_SOURCE_ID = 'earthquakes';
export const EARTHQUAKE_OVERLAY_COHORT_LIMIT = 96;
export const EARTHQUAKE_OVERLAY_COLLISION_CAPACITY = 48;
/** Najdlhší riadok karty výberu (znaky) — karta na plátne sa inak roztiahne cez ľavý panel. */
export const EARTHQUAKE_DETAIL_WRAP = 46;

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
 * @param {string} [input.suffix] napr. „+2 h 14 min" pri dotrase v zvýraznenej sekvencii
 * @returns {object}
 */
export function createEarthquakeOverlayEntry({ id, position, magnitude, accent, suffix = '' }) {
  const mag = Number(magnitude);
  return {
    id: String(id),
    position,
    variant: 'label',
    title: `M${mag.toFixed(1)}${suffix ? ` · ${suffix}` : ''}`,
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

/**
 * Zalomenie riadkov karty na plátne (prekrytie nemá zalamovanie a šírku karty určí najdlhší
 * riadok). Pokračovanie je odsadené dvoma medzerami. Pure.
 * @param {string[]} lines
 * @param {number} [max]
 * @returns {string[]}
 */
export function wrapDetailLines(lines, max = EARTHQUAKE_DETAIL_WRAP) {
  const out = [];
  for (const raw of lines) {
    const words = String(raw).split(' ').filter(Boolean);
    let line = '';
    for (const word of words) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= max) line += ' ' + word;
      else { out.push(line); line = '  ' + word; }
    }
    if (line) out.push(line);
  }
  return out;
}

const utcMinute = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

/**
 * Karta vybraného otrasu na plátne (2026-11-06: kratšia — plný detail s riešeniami zdrojov je
 * v karte pri myši). Magnitúdy zdrojov sa ukazujú vedľa seba, nikdy sa nepriemerujú.
 * @param {object} event spojený otras
 * @param {object} position Cartesian3
 * @param {{now?: number, link?: object|null, shakemap?: boolean}} [o]
 */
export function createEarthquakeDetail(event, position, { now = Date.now(), link = null, shakemap = false } = {}) {
  const lines = [];
  const head = [`M${event.mag.toFixed(1)}${event.magType ? ' ' + event.magType : ''}`];
  if (Number.isFinite(event.depth)) head.push(t('quake.depthShort', { km: Math.round(event.depth) }));
  lines.push(head.join(' · '));
  if (Number.isFinite(event.time)) lines.push(utcMinute(event.time) + ' · ' + t('quake.ago', { elapsed: formatElapsed(now - event.time) }));
  for (const line of earthquakeImpactLines(event, { short: true })) lines.push(line.text);
  const sequence = earthquakeSequenceLine(link, { short: true });
  if (sequence) lines.push(sequence);
  const solutions = Array.isArray(event.solutions) ? event.solutions : [];
  if (solutions.length > 1) {
    lines.push(t('quake.sourcesProbable', { list: solutions.map((s) => `${s.source} M${s.mag.toFixed(1)}${s.stale ? ' (' + t('quake.staleShort') + ')' : ''}`).join(' · ') }));
  } else if (solutions.length === 1) {
    const s = solutions[0];
    lines.push(t('quake.sourceSingle', { source: `${s.source} M${s.mag.toFixed(1)}` }) + (s.stale ? ' · ' + t('quake.staleShort') : ''));
  }
  if (shakemap) lines.push(t('quake.shakemap.card'));
  else if (Number.isFinite(event.mag) && event.mag >= EARTHQUAKE_FELT_MIN_MAG) {
    // Odhad citeľného dosahu z magnitúdy (nie ShakeMap) — slabý kruh na mape ho ukazuje.
    lines.push(t('quake.feltShort', { km: Math.round(earthquakeFeltRadiusM(event.mag) / 1000) }));
  }
  return {
    id: event.id, position, variant: 'selected', selected: true, protected: true,
    paintLane: 'selected', collisionGroup: 'ambient-card', priority: Number.MAX_SAFE_INTEGER,
    title: event.place || t('quake.event'), details: wrapDetailLines(lines), accent: '#ffb347', interactive: false,
    // Nad ohniskom, kým nezavadzia rozhranie; pri ľavom paneli smie karta ísť vpravo alebo vľavo
    // (2026-11-06: centrovaná karta sa pri ohnisku blízko panela podsúvala pod neho).
    anchorRadiusPx: 9, minAnchorGapPx: 11, verticalOnly: false, placement: 'above',
    edgeFade: 'keyhole', horizonCull: true, terrainOcclusion: false,
  };
}

const PERIOD_IDS = Object.keys(EARTHQUAKE_PERIODS);

export function createEarthquakesLayer({ overlayHost = DEFAULT_OVERLAY_HOST,
  sources = ['USGS', 'EMSC'], now = Date.now, fetchImpl = (...args) => fetch(...args),
  pulseFactory = createEarthquakePulse,
  hoverFactory = createEarthquakeHoverCard,
  shakemapFactory = createShakemapOverlay,
  platesFactory = createPlateBoundaries,
} = {}) {
  let dataSource = null; let viewer = null; let enabled = false;
  let lastUpdate = null; let lastError = null; let loading = false;
  let minMagnitude = 2.5; let events = []; let selectedId = null;
  let controller = null; let generation = 0; let clickHandler = null;
  let controlsListener = null; let sourceStates = new Map();
  let omitted = 0; let signatures = new Map();
  // Prstenec citeľného dosahu otrasov (2026-09-06, vzor Sentinel povrchová vlna):
  // veľký, tlmený, STATICKÝ kruh na teréne — vlastný dataSource, aby sa nemiešal
  // do pickovania ohnísk. Len M >= EARTHQUAKE_FELT_MIN_MAG a len otrasy z posledných 24 h.
  let feltSource = null; let feltSignatures = new Map();
  let pulse = null; let pulsar = true;
  let hover = null; let hoverRecords = []; let hoverTimer; let leaveTimer; let pointer = null;
  // Sekvencie hlavný otras → dotrasy (earthquakeSequence.js), prepočítané pri každom render().
  let sequenceLinks = new Map();
  let removeCameraHover = null;
  // 2026-11-06: obdobie, filter Významné, platne, mapa otrasov, odber upozornení.
  let period = 'day'; let significantOnly = false; let plates = false;
  let shakemap = null; let plateLines = null; let alertControl = null; let removeAlertListener = null;
  let labelEntries = []; let focus = null;

  function clearHover() { clearTimeout(hoverTimer); clearTimeout(leaveTimer); hoverTimer = null; pointer = null; hover?.hide(); }
  function hoverAtPointer() {
    hoverTimer = null;
    if (!enabled || !pointer) return;
    const bounds = viewer.scene.canvas.getBoundingClientRect();
    const x = pointer.x - bounds.left; const y = pointer.y - bounds.top;
    let event = null;
    for (const record of hoverRecords) {
      if (focus && !focus.members.has(record.id)) continue;
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
      const id = pickEpicentre(new Cesium.Cartesian2(x, y));
      if (id) event = events.find(e => 'earthquake:' + e.id === id);
    }
    if (event) { clearTimeout(leaveTimer); hover?.show(event, pointer, { now: now(), link: sequenceLinks.get(event.id) || null }); }
    else leaveHover();
  }
  /**
   * Nájdi disk ohniska pod kurzorom. Veľký prstenec citeľného dosahu (feltSource)
   * leží NAD diskami ohnísk aj nad dotrasmi, takže obyčajný pick vracal prstenec a
   * klik na epicentrum nič nevybral (2026-11-06, M6,1 Hasaki). drillPick prejde
   * cez prstenec k prvému disku ohniska; prstenec sám sa nikdy nevyberá.
   * @returns {string|null} id entity 'earthquake:…' alebo null
   */
  function pickEpicentre(windowPosition) {
    const scene = viewer?.scene;
    if (!scene || !dataSource) return null;
    const picks = typeof scene.drillPick === 'function' ? scene.drillPick(windowPosition, 6) : [scene.pick(windowPosition)];
    for (const picked of picks || []) {
      const id = resolvePickId(picked);
      if (id && dataSource.entities.getById(id)) return id;
    }
    return null;
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

  /** Zobrazenie podľa výberu: zvýraznená sekvencia, štítky, prstence, karta. ShakeMap sa tu nevolá. */
  function refreshSelectionView() {
    const event = events.find(e => e.id === selectedId);
    const entity = event && dataSource?.entities.getById('earthquake:' + event.id);
    if (!enabled || !entity) {
      selectedId = null;
    }
    const nextFocus = enabled && selectedId ? sequenceMembers(sequenceLinks, selectedId) : null;
    focus = nextFocus;
    // Disky a prstence mimo sekvencie sa skryjú (len `show` — žiadna nová geometria).
    for (const disc of dataSource?.entities.values || []) {
      const id = disc.id.slice('earthquake:'.length);
      const show = !focus || focus.members.has(id);
      if (disc.show !== show) disc.show = show;
    }
    const shakemapFor = shakemap?.activeId || null;
    for (const ring of feltSource?.entities.values || []) {
      const id = ring.id.slice('earthquake-felt:'.length);
      const ev = events.find(e => e.id === id);
      // Kde je skutočná mapa otrasov, odhadovaný kruh by jej odporoval — skryje sa.
      const replaced = Boolean(shakemapFor && ev && shakemapEventId(ev) === shakemapFor);
      const show = (!focus || focus.members.has(id)) && !replaced;
      if (ring.show !== show) ring.show = show;
    }
    publishLabels();
    pulse?.setFocus?.(focus?.members || null);
    if (!enabled || !entity || !selectedId) {
      pulse?.setSelected(null); overlayHost.clearSource(DETAIL_SOURCE);
      viewer?.scene?.requestRender?.();
      return;
    }
    pulse?.setSelected(selectedId);
    overlayHost.setVisible(DETAIL_SOURCE, true);
    const shakemapShown = Boolean(shakemapFor && shakemapEventId(event) === shakemapFor);
    overlayHost.setEntries(DETAIL_SOURCE, [createEarthquakeDetail(event, entity.position.getValue(Cesium.JulianDate.now()),
      { now: now(), link: sequenceLinks.get(event.id) || null, shakemap: shakemapShown })], { cohortLimit: 1, collisionCapacity: 0, moving: false });
    viewer?.scene?.requestRender?.();
  }

  /** Štítky magnitúd; v zvýraznenej sekvencii len jej členovia, dotrasy s odstupom od hlavného otrasu. */
  function publishLabels() {
    if (!enabled) return;
    let entries = labelEntries;
    if (focus) {
      entries = [];
      for (const label of labelEntries) {
        if (!focus.members.has(label.id)) continue;
        const link = sequenceLinks.get(label.id);
        entries.push(link?.role === 'aftershock'
          ? createEarthquakeOverlayEntry({ id: label.id, position: label.position, magnitude: Number(label.title.slice(1)), accent: label.accent, suffix: '+' + formatElapsed(link.deltaMs) })
          : label);
      }
    }
    overlayHost.setEntries(EARTHQUAKE_OVERLAY_SOURCE_ID, selectEarthquakeOverlayCohort(entries), {
      cohortLimit: EARTHQUAKE_OVERLAY_COHORT_LIMIT, collisionCapacity: EARTHQUAKE_OVERLAY_COLLISION_CAPACITY, moving: false,
    });
  }

  /** Výber sa zmenil: mapa otrasov k vybranému otrasu (ak ju USGS má) a zobrazenie. */
  function publishDetail() {
    const event = enabled && selectedId ? events.find(e => e.id === selectedId) : null;
    if (event && shakemapEventId(event)) void shakemap?.show(event);
    else shakemap?.hide();
    refreshSelectionView();
  }

  function render() {
    if (!dataSource) return;
    const range = earthquakePeriod(period);
    const cutoff = now() - range.ms;
    const minMag = Math.max(minMagnitude, range.floor);
    const eligible = events.filter(e => e.time >= cutoff && e.time <= now() + 60_000 && e.mag >= minMag
      && (!significantOnly || isSignificantEarthquake(e)))
      .sort((a, b) => b.mag - a.mag || a.id.localeCompare(b.id));
    const shown = eligible.slice(0, EARTHQUAKE_RENDER_LIMIT);
    hoverRecords = shown.slice(0, EARTHQUAKE_OVERLAY_COHORT_LIMIT); clearHover();
    sequenceLinks = linkEarthquakeSequences(shown);
    omitted = eligible.length - shown.length;
    // Prepare every replacement before touching the currently valid scene.
    const prepared = shown.map(event => {
      const position = Cesium.Cartesian3.fromDegrees(event.lon, event.lat);
      const color = event.depth === null ? Cesium.Color.GRAY : depthColor(event.depth);
      const radius = Math.pow(2, event.mag) * 1000;
      // Otrasy staršie ako deň (obdobie 7 / 30 dní) sú tlmenejšie.
      const old = now() - event.time > EARTHQUAKE_DAY_MS;
      return { event, position, color, radius, old, signature: JSON.stringify(event) + (old ? '|old' : '') };
    });
    const keep = new Set(); const labels = [];
    dataSource.entities.suspendEvents();
    try {
      for (const { event, position, color, radius, old, signature } of prepared) {
        const id = 'earthquake:' + event.id;
        keep.add(id);
        let entity = dataSource.entities.getById(id);
        if (!entity) entity = dataSource.entities.add({ id });
        if (signatures.get(id) !== signature) {
          const fade = old ? 0.6 : 1;
          entity.position = position;
          entity.ellipse = new Cesium.EllipseGraphics({
            semiMajorAxis: radius, semiMinorAxis: radius,
            // Tlmená výplň (2026-09-06): disk je len jemný podklad, hviezdou je
            // viaclíniový pulzar (earthquakePulse.js) — plný disk ho prekrýval.
            material: new Cesium.ColorMaterialProperty(color.withAlpha((event.mag >= 5 ? 0.16 : 0.11) * fade)),
            outline: true, outlineColor: color.withAlpha(0.55 * fade), outlineWidth: event.mag >= 5 ? 2 : 1,
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
    // len lokálne, kruh by bol šum) a len pre otrasy z posledných 24 h (v pohľade na
    // 30 dní by sa stovky kruhov prekrývali). Statické osi, nič sa neprepočítava každý snímok →
    // výkonové piny ostávajú (viď hlavička súboru).
    if (feltSource) {
      const keepFelt = new Set();
      feltSource.entities.suspendEvents();
      try {
        for (const { event, position, color, old } of prepared) {
          if (event.mag < EARTHQUAKE_FELT_MIN_MAG || old) continue;
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
    labelEntries = labels;
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
      const topId = resolvePickId(picked);
      if (topId && isOwnedByOtherLayer('earthquakes', topId)) return;
      const id = pickEpicentre(click.position);
      if (id) selectedId = id.slice('earthquake:'.length);
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
  /**
   * Zmena obdobia: zahodí katalógy iného obdobia a stiahne nové. Rozbehnutú aktualizáciu (často
   * pravidelnú od správcu vrstiev) NEruší — tá si po návrate všimne iné obdobie, staré dáta zahodí
   * a stiahne nové; zrušenie by správca zapísal ako zlyhanú obnovu („refresh rejected").
   */
  function switchPeriod(next) {
    if (next === period) return;
    period = next; sourceStates = new Map(); events = []; lastUpdate = null; lastError = null; selectedId = null;
    render();
    if (enabled && !loading) void layer.update();
  }
  const layer = {
    id: 'earthquakes', name: 'Earthquakes', icon: '∿', source: 'USGS + EMSC', updateInterval: 60000,
    init(activeViewer) {
      cancel(); viewer = activeViewer; enabled = false;
      pulse?.destroy(); pulse = pulseFactory(viewer, { now });
      hover?.destroy(); hover = hoverFactory();
      shakemap?.destroy(); shakemap = shakemapFactory(viewer, { fetchImpl, onChange: () => refreshSelectionView() });
      plateLines?.destroy(); plateLines = platesFactory(viewer);
      dataSource = new Cesium.CustomDataSource('earthquakes'); dataSource.show = false;
      viewer.dataSources.add(dataSource);
      feltSource = new Cesium.CustomDataSource('earthquake-felt'); feltSource.show = false; viewer.dataSources.add(feltSource); feltSignatures = new Map();
      events = []; sourceStates = new Map(); signatures = new Map();
      lastUpdate = null; lastError = null; selectedId = null;
      overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, false);
    },
    enable() { enabled = true; if (dataSource) dataSource.show = true; if (feltSource) feltSource.show = true;
      overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, true); installInteraction();
      if (plates) void plateLines?.show();
      if (events.length) render(); },
    disable() { enabled = false; cancel(); removeInteraction(); selectedId = null; focus = null;
      pulse?.setVisible(false); pulse?.setFocus?.(null);
      shakemap?.hide(); plateLines?.hide();
      if (dataSource) dataSource.show = false;
      if (feltSource) feltSource.show = false;
      overlayHost.clearSource(DETAIL_SOURCE); overlayHost.setVisible(DETAIL_SOURCE, false);
      overlayHost.clearSource(EARTHQUAKE_OVERLAY_SOURCE_ID); overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, false); },
    async update() {
      if (!enabled || !dataSource) return false;
      cancel(); const requestGeneration = generation; const requestController = new AbortController();
      controller = requestController; loading = true;
      const timer = setTimeout(() => requestController.abort(), 15_000);
      const range = earthquakePeriod(period);
      try {
        const results = await Promise.allSettled(sources.map(async source => {
          const url = '/api/earthquakes/' + source.toLowerCase() + (range.id === 'day' ? '' : '?period=' + range.id);
          const response = await fetchImpl(url, { signal: requestController.signal, cache: 'no-store' });
          if (!response.ok) throw new Error(source + ' HTTP ' + response.status);
          const payload = await response.json();
          const parsed = Array.isArray(payload?.records) ? payload : normalizeEarthquakeFeed(payload, source);
          return { ...parsed, fetchedAt: payload.fetchedAt === null ? null : payload.fetchedAt ?? now(), stale: Boolean(payload.stale), error: payload.error || null };
        }));
        if (requestGeneration !== generation || !enabled || !dataSource) return false;
        // Obdobie sa zmenilo počas sťahovania (switchPeriod): staré dáta nepoužiť, stiahnuť nové obdobie.
        if (range.id !== period) return layer.update();
        for (let i = 0; i < sources.length; i++) {
          const source = sources[i]; const result = results[i];
          if (result.status === 'fulfilled') sourceStates.set(source, result.value);
          else sourceStates.set(source, { ...(sourceStates.get(source) || { records: [], fetchedAt: null }),
            stale: true, error: requestController.signal.aborted ? t('quake.timeout') : result.reason?.message || t('quake.unavailable') });
        }
        const records = [...sourceStates.entries()].flatMap(([source, state]) => state.records
          .filter(r => r.time >= now() - range.ms && r.time <= now() + 60_000)
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
      shakemap?.destroy(); shakemap = null;
      plateLines?.destroy(); plateLines = null;
      removeAlertListener?.(); removeAlertListener = null;
      dataSource = null; viewer = null; events = []; sourceStates.clear(); signatures.clear();
      labelEntries = []; focus = null;
      lastUpdate = null; lastError = null; controlsListener = null;
    },
    getParams() { return { minMagnitude, pulsar, period, significant: significantOnly, plates }; },
    setParams(params) {
      if (!params || typeof params !== 'object') return false;
      const { minMagnitude: value, pulsar: nextPulsar, period: nextPeriod, significant, plates: nextPlates, alerts } = params;
      if ([value, nextPulsar, nextPeriod, significant, nextPlates, alerts].every(v => v === undefined)) return false;
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < -3 || value > 10)) return false;
      for (const flag of [nextPulsar, significant, nextPlates, alerts]) if (flag !== undefined && typeof flag !== 'boolean') return false;
      if (nextPeriod !== undefined && !PERIOD_IDS.includes(nextPeriod)) return false;
      if (value !== undefined) minMagnitude = value;
      if (nextPulsar !== undefined) pulsar = nextPulsar;
      if (significant !== undefined) significantOnly = significant;
      if (nextPlates !== undefined && nextPlates !== plates) {
        plates = nextPlates;
        if (plates && enabled) void plateLines?.show().then(() => controlsListener?.());
        else plateLines?.hide();
      }
      if (alerts !== undefined) void alertControl?.toggle?.();
      if (nextPeriod !== undefined && nextPeriod !== period) switchPeriod(nextPeriod);
      else render();
      controlsListener?.(); return true;
    },
    setRowControlsListener(listener) { controlsListener = typeof listener === 'function' ? listener : null; },
    /**
     * Odber upozornení na otrasy citeľné na Slovensku (src/quakeAlerts.js) — čip v riadku vrstvy.
     * @param {{status: () => string, toggle: () => Promise<boolean>, isBusy?: () => boolean, subscribe?: Function}|null} control
     */
    setAlertControl(control) {
      removeAlertListener?.(); removeAlertListener = null;
      alertControl = control && typeof control.status === 'function' && typeof control.toggle === 'function' ? control : null;
      if (alertControl?.subscribe) removeAlertListener = alertControl.subscribe(() => controlsListener?.());
      controlsListener?.();
    },
    getRowControls() {
      const range = earthquakePeriod(period);
      const effectiveMin = Math.max(minMagnitude, range.floor);
      const chips = PERIOD_IDS.map(id => ({ id: 'period-' + id, label: t('quake.period.' + id), title: t('quake.periodHint'),
        active: id === period, params: { period: id } }));
      for (const value of [-3, 1, 2.5, 4.5]) {
        const below = value < range.floor;
        chips.push({ id: 'mag-' + value, label: value === -3 ? t('quake.all') : 'M' + value + '+',
          title: below ? t('quake.periodFloor', { mag: range.floor }) : t('quake.minimum'),
          active: value === effectiveMin, disabled: below, params: { minMagnitude: value } });
      }
      chips.push({ id: 'significant', label: t('quake.significant'), title: t('quake.significantHint'), active: significantOnly, params: { significant: !significantOnly } });
      chips.push({ id: 'pulsar', label: t('quake.pulsar'), title: t('quake.pulsarHint'), active: pulsar, params: { pulsar: !pulsar } });
      chips.push({ id: 'plates', label: t('quake.plates'), title: t('quake.platesHint'), active: plates, params: { plates: !plates } });
      if (alertControl) {
        const status = alertControl.status();
        chips.push({ id: 'alerts', label: t('quake.alerts'), title: t('quake.alerts.hint.' + (status === 'on' ? 'on' : status === 'guest' ? 'guest' : 'off')),
          active: status === 'on', busy: Boolean(alertControl.isBusy?.()), params: { alerts: true } });
      }
      return { chips,
        legend: sources.map(source => ({ label: source, count: sourceStates.get(source)?.records.length || 0,
          color: sourceStates.get(source)?.error ? '#929ca5' : '#ffb347', blurb: t('quake.sourceCount') })) };
    },
    /** Vyber otras podľa id udalosti alebo id riešenia zdroja (USGS:… / EMSC:…), napr. z odkazu ?quake=. */
    selectById(id) {
      if (!enabled || !dataSource) return false;
      const event = events.find(e => e.id === id) || events.find(e => e.solutions?.some(s => s.id === id));
      if (!event || !dataSource.entities.getById('earthquake:' + event.id)) return false;
      selectedId = event.id; publishDetail(); viewer?.scene?.requestRender?.(); return true;
    },
    getSelectedInfo() { return events.find(e => e.id === selectedId) || null; },
    getAnalystRecords(maxCount = 2000) {
      if (!enabled || !dataSource) return [];
      const visible = new Set(dataSource.entities.values.map(e => e.id));
      return events.filter(e => visible.has('earthquake:' + e.id)).slice(0, Math.max(1, Number.isFinite(maxCount) ? Math.floor(maxCount) : 2000))
        .map(e => ({ ...mapAnalystRecord(e), association: e.association, sources: e.solutions.map(s => ({ ...s })) }));
    },
    getStats() {
      const range = earthquakePeriod(period);
      const threshold = Math.max(minMagnitude, range.floor);
      return { count: dataSource?.entities.values.length || 0, lastUpdate, error: lastError, loading,
        stale: [...sourceStates.values()].some(s => s.stale), source: sources.join(' + ') + ' · ' + (threshold === -3 ? t('quake.all') : t('quake.threshold', { mag: threshold }))
          + ' · ' + t('quake.period.' + range.id)
          + (significantOnly ? ' · ' + t('quake.significant') : '')
          + (omitted ? ' · ' + t('quake.omitted', { count: omitted }) : '')
          + ([...sourceStates.values()].some(s => s.truncated) ? ' · ' + t('quake.truncated') : ''),
        omitted, rejected: [...sourceStates.values()].reduce((n, s) => n + (s.rejected || 0), 0),
        sourceStatus: Object.fromEntries([...sourceStates].map(([name, s]) => [name, { count: s.records.length, fetchedAt: s.fetchedAt, stale: s.stale, error: s.error, truncated: Boolean(s.truncated) }])),
      };
    },
  };
  return layer;
}

const earthquakesLayer = createEarthquakesLayer();
export default earthquakesLayer;
