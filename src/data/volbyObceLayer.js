// src/data/volbyObceLayer.js
/**
 * @module volbyObceLayer
 * @description Mapa obcí pre VOĽBY 2026 (2026-10-24, vlastník: „interaktívnu klikateľnú mapu aj tej
 * najmenšej obce … aj mená"): bod za každú z 2 926 obcí a miest (polohy GeoNames cez
 * /api/volby/obce-body), meno pri priblížení (väčšie mestá skôr), klik otvorí obec v paneli VOĽBY
 * (onSelect nastaví main.js). Po 20:00 farba podľa stavu výsledkov ŠÚ SR: azúrová = bez výsledkov,
 * jantárová = čiastočné, zelená = všetky okrsky; pri výsledkoch je pod menom vedúci kandidát na starostu
 * s podielom. Body aj popisky majú vypnutý hĺbkový test (terén ani 3D dlaždice ich neschovajú) a
 * vzdialenostné podmienky bez práce v každej snímke. Obnova každé 3 min (ako tabuľky ŠÚ SR).
 */
import * as Cesium from 'cesium';
import { registerPickOwner, resolvePickId, unregisterPickOwner } from './pickRegistry.js';

export const VOLBY_OBCE_LAYER_ID = 'volby-obce';
export const OBCE_BODY_URL = '/api/volby/obce-body';
export const OBCE_REFRESH_MS = 3 * 60 * 1000;
export const OBEC_PICK_PREFIX = 'obec:';
/** Farby stavu výsledkov (CSS text; aj pre legendu v paneli). */
export const OBEC_STATE_COLORS = Object.freeze({ 0: '#7fdcff', 1: '#ffd166', 2: '#4ade80' });
/** Krytie bodu (jemný, nie plný disk). */
export const OBEC_POINT_ALPHA = 0.85;

/** Dokedy (m od kamery) vidno bod obce podľa počtu poslancov (veľkosti). Pure. */
export function pointVisibleUntilM(seats = 0, city = false) {
  if (city || seats >= 25) return 6_000_000;
  if (seats >= 13) return 3_000_000;
  return 1_800_000;
}

/** Dokedy (m) vidno meno obce: mestá zďaleka, dediny zblízka. Pure. */
export function labelVisibleUntilM(seats = 0, city = false) {
  if (city || seats >= 25) return 900_000;
  if (seats >= 13) return 320_000;
  if (seats >= 9) return 140_000;
  return 70_000;
}

/** Štýl bodu: veľkosť podľa mandátov, farba podľa stavu výsledkov. Pure. */
export function pointStyle({ seats = 0, city = false, state = 0 } = {}) {
  // 2026-10-24 (vlastník: body „jemnejšie, krajšie UI"): menšie body, mestá o chlp výraznejšie.
  const pixelSize = city || seats >= 25 ? 5.5 : seats >= 13 ? 4 : seats >= 9 ? 3.2 : 2.6;
  return { pixelSize, color: OBEC_STATE_COLORS[state] || OBEC_STATE_COLORS[0] };
}

/** Text popisku: meno, pri výsledkoch pod ním vedúci kandidát s podielom. Pure. */
export function labelText({ name = '', state = 0, lead = '', leadPct = null } = {}) {
  if (!state || !lead) return String(name);
  const pct = leadPct != null && leadPct !== '' && Number.isFinite(Number(leadPct)) ? ` ${Number(leadPct).toFixed(0)} %` : '';
  return `${name}\n${lead}${pct}`;
}

/** Polomer (px), v ktorom klik vedľa bodu ešte vyberie najbližšiu obec. */
export const OBEC_PICK_RADIUS_PX = 14;

/**
 * Najbližší bod do polomeru od miesta kliknutia (súradnice okna). Pure.
 * @param {Array<{code:string, x:number, y:number}>} points
 * @param {{x:number, y:number}} position
 * @param {number} [radiusPx]
 * @returns {string|null} kód obce
 */
export function nearestWithin(points, position, radiusPx = OBEC_PICK_RADIUS_PX) {
  let best = null;
  let bestD = radiusPx * radiusPx;
  for (const p of points || []) {
    if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) continue;
    const dx = p.x - position.x;
    const dy = p.y - position.y;
    const d = dx * dx + dy * dy;
    if (d <= bestD) { bestD = d; best = p.code; }
  }
  return best;
}

/** Riadky z /api/volby/obce-body → objekty. Pure. */
export function parseObceBody(json) {
  const cols = Array.isArray(json?.columns) ? json.columns : ['code', 'name', 'lat', 'lon', 'seats', 'state', 'lead', 'leadPct'];
  const out = [];
  for (const row of Array.isArray(json?.rows) ? json.rows : []) {
    const o = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
    const lat = o.lat == null || o.lat === '' ? NaN : Number(o.lat);
    const lon = o.lon == null || o.lon === '' ? NaN : Number(o.lon);
    if (!o.code || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ code: String(o.code), name: String(o.name || ''), lat, lon, seats: Number(o.seats) || 0, city: Number(o.seats) >= 45, state: Number(o.state) || 0, lead: String(o.lead || ''), leadPct: o.leadPct == null ? null : Number(o.leadPct) });
  }
  return out;
}

/**
 * @param {object} [o]
 * @param {typeof fetch} [o.fetchImpl]
 * @param {() => number} [o.now]
 */
export function createVolbyObceLayer({
  fetchImpl = (...a) => globalThis.fetch(...a),
  now = Date.now,
  // Kolekcie Cesia (test seam: LabelCollection meria text cez canvas, v Node nie je document).
  collections = () => ({ points: new Cesium.PointPrimitiveCollection(), labels: new Cesium.LabelCollection() }),
} = {}) {
  let viewer = null;
  let points = null;
  let labels = null;
  let handler = null;
  let enabled = false;
  let loading = false;
  let error = null;
  let lastUpdate = null;
  let rows = [];
  const byCode = new Map(); // code → { point, label, row }
  let selectedCode = null;

  const color = (css) => Cesium.Color.fromCssColorString(css);

  function rebuild() {
    if (!points || !labels) return;
    points.removeAll();
    labels.removeAll();
    byCode.clear();
    for (const r of rows) {
      const position = Cesium.Cartesian3.fromDegrees(r.lon, r.lat, 0);
      const style = pointStyle(r);
      const point = points.add({
        id: OBEC_PICK_PREFIX + r.code,
        position,
        pixelSize: style.pixelSize,
        color: color(style.color).withAlpha(OBEC_POINT_ALPHA),
        outlineColor: Cesium.Color.fromBytes(6, 14, 22, 140),
        outlineWidth: 0.5,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, pointVisibleUntilM(r.seats, r.city)),
      });
      const label = labels.add({
        id: OBEC_PICK_PREFIX + r.code,
        position,
        text: labelText(r),
        font: `${r.city || r.seats >= 25 ? 600 : 500} ${r.city || r.seats >= 25 ? 13 : 11}px Inter, "Segoe UI", sans-serif`,
        fillColor: Cesium.Color.fromCssColorString('#e9f6ff').withAlpha(0.92),
        outlineColor: Cesium.Color.fromBytes(6, 14, 22, 230),
        outlineWidth: 2.5,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -9),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, labelVisibleUntilM(r.seats, r.city)),
      });
      byCode.set(r.code, { point, label, row: r });
    }
    applySelection();
  }

  /** Nové stavy bez prestavby (farba, popis). */
  function restyle(next) {
    const sameSet = next.length === rows.length && next.every((r) => byCode.has(r.code));
    rows = next;
    if (!sameSet) { rebuild(); return; }
    for (const r of rows) {
      const e = byCode.get(r.code);
      if (!e) continue;
      e.row = r;
      const style = pointStyle(r);
      e.point.color = color(style.color).withAlpha(OBEC_POINT_ALPHA);
      e.point.pixelSize = style.pixelSize;
      e.label.text = labelText(r);
    }
    applySelection();
  }

  function applySelection() {
    for (const [code, e] of byCode) {
      const sel = code === selectedCode;
      const style = pointStyle(e.row);
      e.point.pixelSize = sel ? style.pixelSize + 3 : style.pixelSize;
      e.point.outlineWidth = sel ? 2 : 0.5;
      e.point.outlineColor = sel ? Cesium.Color.WHITE : Cesium.Color.fromBytes(6, 14, 22, 140);
    }
  }

  const layer = {
    id: VOLBY_OBCE_LAYER_ID,
    name: 'Elections 2026 — municipalities',
    icon: '▣',
    source: 'MV SR · ŠÚ SR · GeoNames',
    updateInterval: OBCE_REFRESH_MS,
    showInTogglePanel: true,
    /** Klik na obec (kód) — nastaví main.js (panel VOĽBY). */
    onSelect: null,
    init(v) {
      viewer = v;
      const made = collections();
      points = v.scene.primitives.add(made.points);
      labels = v.scene.primitives.add(made.labels);
      points.show = false;
      labels.show = false;
    },
    enable() {
      enabled = true;
      if (points) points.show = true;
      if (labels) labels.show = true;
      registerPickOwner(VOLBY_OBCE_LAYER_ID, (id) => String(id).startsWith(OBEC_PICK_PREFIX));
      if (viewer?.scene?.canvas && !handler && typeof Cesium.ScreenSpaceEventHandler === 'function') {
        handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        handler.setInputAction((click) => {
          const id = resolvePickId(viewer.scene.pick(click.position));
          if (id?.startsWith(OBEC_PICK_PREFIX)) { layer.select(id.slice(OBEC_PICK_PREFIX.length), { origin: 'map' }); return; }
          // Vedľa bodu (alebo bod pod 3D dlaždicami, ktoré pick vyhrá): najbližšia viditeľná obec do 14 px.
          const near = nearestWithin(layer._windowPoints(), click.position);
          if (near) layer.select(near, { origin: 'map' });
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      }
      if (!rows.length) void layer.update();
      return true;
    },
    disable() {
      enabled = false;
      if (points) points.show = false;
      if (labels) labels.show = false;
      handler?.destroy?.();
      handler = null;
      unregisterPickOwner(VOLBY_OBCE_LAYER_ID);
      return true;
    },
    async update(_viewer, { signal } = {}) {
      if (loading) return false;
      loading = true;
      try {
        const res = await fetchImpl(OBCE_BODY_URL, { cache: 'no-store', signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const next = parseObceBody(await res.json());
        if (!next.length) throw new Error('empty');
        restyle(next);
        error = null;
        lastUpdate = now();
        return true;
      } catch (e) {
        if (e?.name !== 'AbortError') error = e?.message || String(e);
        return false;
      } finally { loading = false; }
    },
    /** Zvýrazní obec na mape a (pri kliknutí) ohlási výber. */
    select(code, { origin = 'panel' } = {}) {
      selectedCode = code ? String(code) : null;
      applySelection();
      if (origin === 'map' && typeof layer.onSelect === 'function') layer.onSelect(selectedCode);
      return Boolean(selectedCode && byCode.has(selectedCode));
    },
    getStats() {
      const done = rows.filter((r) => r.state === 2).length;
      const partial = rows.filter((r) => r.state === 1).length;
      return { count: rows.length, lastUpdate, error, loading, stale: Boolean(error && rows.length), source: layer.source, resultsFinal: done, resultsPartial: partial };
    },
    destroy() {
      if (enabled) layer.disable();
      if (viewer?.scene?.primitives) {
        if (points) viewer.scene.primitives.remove(points);
        if (labels) viewer.scene.primitives.remove(labels);
      }
      points = null; labels = null; byCode.clear(); rows = [];
    },
    /** Viditeľné body v súradniciach okna (len pre klik; 2 926 projekcií raz za klik). */
    _windowPoints() {
      const scene = viewer?.scene;
      const toWindow = Cesium.SceneTransforms?.worldToWindowCoordinates || Cesium.SceneTransforms?.wgs84ToWindowCoordinates;
      if (!scene || typeof toWindow !== 'function') return [];
      const cameraPos = scene.camera?.positionWC;
      const out = [];
      for (const [code, e] of byCode) {
        if (cameraPos && Cesium.Cartesian3.distance(cameraPos, e.point.position) > pointVisibleUntilM(e.row.seats, e.row.city)) continue;
        const w = toWindow(scene, e.point.position);
        if (w) out.push({ code, x: w.x, y: w.y });
      }
      return out;
    },
    _stateForTest: () => ({ enabled, rows: rows.length, selectedCode, points: byCode.size, labels: labels ? labels.length : 0 }),
  };
  return layer;
}

export default createVolbyObceLayer();
