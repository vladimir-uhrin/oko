// src/ukraineControlLayer.js
//
// ÚZEMNÁ KONTROLA modulu UKRAJINA — provizórium z Wikipédie (etapa 4C,
// 2026-09-19; plán docs/drafts/ukrajina-plan.md kap. 2.1 a 5.4 cesta C).
// Kreslí snímku `{points, summary, revisionAt}` z `/api/ukraine/events/control`:
//  - body sídiel a objektov ako PointPrimitive (modrá UA, tehlová RU, jantár
//    kontestované, fialová zmiešaná, sivá bez kontroly; veľkosť podľa triedy
//    populácie; infraštruktúra menšia s obrysom), výška raz z resolvera terénu;
//  - ODVODENÝ raster zón (`controlRaster` z čistého modulu) ako obdĺžnik
//    primknutý k terénu aj 3D dlaždiciam (entita rectangle bez výšky,
//    ImageMaterialProperty z plátna): ruská kontrola tlmená tehlová výplň, zóna
//    bojov 45° šrafovanie jantárom (ako Rybar), ukrajinské územie bez výplne;
//  - karta pri prechode myšou: meno, strana, druh, tlak z oblúka.
// Poctivosť: „podľa Wikipédie · stav k <revízia> · CC BY-SA", zóny odvodené —
// nie oficiálna línia frontu. Časová os prepína snímku podľa dňa kurzora.
// Etická čiara: sídla a objekty, nikdy jednotky (Wikipedia modul jednotky nemá).

import * as Cesium from 'cesium';
import { CONTROL_CODE, CONTROL_COLORS, CONTROL_RASTER_BBOX, controlRaster, controlSummary } from './data/ukraineControl.js';
import { fetchUkraineControl } from './data/ukraineEventsClient.js';
import { defaultTerrainSampler } from './data/ukraineBaseLayer.js';
import { currentLanguage, t } from './i18n.js';

export const UKRAINE_CONTROL_ID = 'ukraine-control';
export const CONTROL_RASTER_SCALE = 4; // px na bunku plátna (372 × 168 buniek → 1 488 × 672 px)
const LIFT_BATCH = 200;
const HOVER_MS = 90;

const INERT = {
  id: UKRAINE_CONTROL_ID, show: async () => false, hide() {}, isShown: () => false, setSnapshot() {}, setPointsVisible() {}, setZonesVisible() {},
  getState: () => ({ shown: false, loading: false, error: null, day: null, revisionAt: null, summary: null, counts: null, points: 0 }),
  onChange() { return () => {}; }, destroy() {},
};

/** Farba CSS → [r,g,b]. Pure. */
export function cssRgb(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
}

/**
 * Vykreslí raster zón na plátno: RU výplň, kontestované šrafovanie, UA nič.
 * Vracia to isté plátno (alebo null bez 2D kontextu). Nie je čisté (Canvas).
 */
export function paintControlCanvas(raster, canvas, { scale = CONTROL_RASTER_SCALE, ruAlpha = 0.30, hatchAlpha = 0.6, uaAlpha = 0.0 } = {}) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx || !raster) return null;
  const w = raster.width * scale; const h = raster.height * scale;
  canvas.width = w; canvas.height = h;
  ctx.clearRect(0, 0, w, h);
  const [rr, rg, rb] = cssRgb(CONTROL_COLORS.ru); const [ur, ug, ub] = cssRgb(CONTROL_COLORS.ua);
  ctx.fillStyle = `rgba(${rr}, ${rg}, ${rb}, ${ruAlpha})`;
  for (let row = 0; row < raster.height; row += 1) {
    let runStart = -1;
    for (let col = 0; col <= raster.width; col += 1) {
      const code = col < raster.width ? raster.cells[row * raster.width + col] : -1;
      if (code === CONTROL_CODE.ru) { if (runStart < 0) runStart = col; continue; }
      if (runStart >= 0) { ctx.fillRect(runStart * scale, row * scale, (col - runStart) * scale, scale); runStart = -1; }
    }
  }
  if (uaAlpha > 0) {
    ctx.fillStyle = `rgba(${ur}, ${ug}, ${ub}, ${uaAlpha})`;
    for (let row = 0; row < raster.height; row += 1) for (let col = 0; col < raster.width; col += 1) if (raster.cells[row * raster.width + col] === CONTROL_CODE.ua) ctx.fillRect(col * scale, row * scale, scale, scale);
  }
  // Šrafovanie: orežeme na kontestované bunky, potom diagonály cez celé plátno.
  ctx.save();
  ctx.beginPath();
  let any = false;
  for (let row = 0; row < raster.height; row += 1) for (let col = 0; col < raster.width; col += 1) if (raster.cells[row * raster.width + col] === CONTROL_CODE.contested) { ctx.rect(col * scale, row * scale, scale, scale); any = true; }
  if (any) {
    ctx.clip();
    const [hr, hg, hb] = cssRgb(CONTROL_COLORS.contested);
    ctx.fillStyle = `rgba(${hr}, ${hg}, ${hb}, ${hatchAlpha * 0.25})`;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = `rgba(${hr}, ${hg}, ${hb}, ${hatchAlpha})`;
    ctx.lineWidth = Math.max(1, scale * 0.35);
    const step = scale * 2.5;
    ctx.beginPath();
    for (let x = -h; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x + h, h); }
    ctx.stroke();
  }
  ctx.restore();
  return canvas;
}

/** Veľkosť bodu podľa triedy populácie a druhu. Pure. */
export function controlPointSize(p) {
  if (p.kind !== 'settlement' && p.kind !== 'rural') return 4;
  const s = Number(p.size) || 4;
  if (s >= 24) return 9;
  if (s >= 16) return 7.5;
  if (s >= 12) return 6;
  if (s >= 8) return 5;
  return 3.5;
}

/**
 * @param {object} o
 * @param {import('cesium').Viewer} o.viewer
 */
export function createUkraineControlLayer({
  viewer,
  translate = t,
  lang = currentLanguage(),
  fetchControl = fetchUkraineControl,
  terrainSampler = defaultTerrainSampler,
  documentRef = null,
  now = () => Date.now(),
} = {}) {
  const doc = documentRef || viewer?.container?.ownerDocument;
  const scene = viewer?.scene;
  if (!scene || !doc?.createElement) return INERT;

  const points = scene.primitives.add(new Cesium.PointPrimitiveCollection());
  points.show = false;
  const ds = new Cesium.CustomDataSource(UKRAINE_CONTROL_ID);
  viewer.dataSources.add(ds);
  ds.show = false;
  const canvas = doc.createElement('canvas');
  let zoneEntity = null;
  const tip = doc.createElement('div');
  tip.className = 'oko-ukr-ctl-tip';
  tip.hidden = true;
  viewer.container.appendChild(tip);
  const heightCache = new Map();
  const hKey = (p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
  const posFor = (p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, heightCache.get(hKey(p)) ?? 0);
  const requestRender = () => { try { scene.requestRender?.(); } catch { /* */ } };

  let _shown = false;
  let _pointsVisible = true;
  let _zonesVisible = true;
  let _snapshot = null;
  let _raster = null;
  let _loading = false;
  let _error = null;
  let _destroyed = false;
  let _liftChain = Promise.resolve();
  let handler = null; let hoverTimer = null;
  const listeners = new Set();
  const emit = () => { const s = getState(); for (const fn of listeners) { try { fn(s); } catch { /* */ } } };

  function rebuild() {
    points.removeAll();
    if (zoneEntity) { try { ds.entities.remove(zoneEntity); } catch { /* */ } zoneEntity = null; }
    _raster = null;
    if (!_snapshot?.points?.length) { requestRender(); return; }
    for (const p of _snapshot.points) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
      const colour = CONTROL_COLORS[p.side] || CONTROL_COLORS.none;
      const infra = p.kind !== 'settlement' && p.kind !== 'rural';
      points.add({
        position: posFor(p),
        color: Cesium.Color.fromCssColorString(colour).withAlpha(infra ? 0.75 : (p.kind === 'rural' ? 0.6 : 0.95)),
        pixelSize: p.side === 'contested' ? controlPointSize(p) + 3 : controlPointSize(p),
        outlineColor: p.side === 'contested' ? Cesium.Color.fromCssColorString(CONTROL_COLORS.ru).withAlpha(0.9) : Cesium.Color.BLACK.withAlpha(0.7),
        outlineWidth: p.side === 'contested' ? 2 : 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: { ukraineControl: p },
      });
    }
    _raster = controlRaster(_snapshot.points, { bbox: CONTROL_RASTER_BBOX });
    const painted = paintControlCanvas(_raster, canvas);
    if (painted) {
      const b = _raster.bbox;
      zoneEntity = ds.entities.add({
        id: `${UKRAINE_CONTROL_ID}:zones`,
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(b.west, b.south, b.east, b.north),
          material: new Cesium.ImageMaterialProperty({ image: canvas, transparent: true }),
          classificationType: Cesium.ClassificationType.BOTH,
          show: _zonesVisible,
        },
      });
    }
    points.show = _shown && _pointsVisible;
    requestRender();
    void lift();
  }
  function lift() {
    if (typeof terrainSampler !== 'function') return Promise.resolve();
    _liftChain = _liftChain.then(async () => {
      if (_destroyed || !_shown || !_snapshot) return;
      const pending = [];
      const seen = new Set();
      for (const p of _snapshot.points) { const k = hKey(p); if (heightCache.has(k) || seen.has(k)) continue; seen.add(k); pending.push({ k, lon: p.lon, lat: p.lat }); }
      for (let i = 0; i < pending.length && !_destroyed; i += LIFT_BATCH) {
        const batch = pending.slice(i, i + LIFT_BATCH);
        let heights = null;
        try { heights = await terrainSampler(batch.map((p) => [p.lon, p.lat])); } catch { heights = null; }
        if (!Array.isArray(heights)) break;
        batch.forEach((p, j) => { if (Number.isFinite(heights[j])) heightCache.set(p.k, heights[j]); });
      }
      if (_destroyed) return;
      for (let i = 0; i < points.length; i += 1) { const pt = points.get(i); const p = pt.id?.ukraineControl; if (p && heightCache.has(hKey(p))) pt.position = posFor(p); }
      requestRender();
    }).catch(() => {});
    return _liftChain;
  }

  // ── karta pri prechode myšou ─────────────────────────────────────────────
  function tipText(p) {
    const parts = [p.name || p.link || '', translate(`ukraine.ctl.${p.side || 'none'}`)];
    const kind = translate(`ukraine.ctl.kind.${p.kind}`);
    if (kind && kind !== `ukraine.ctl.kind.${p.kind}`) parts.push(kind);
    if (p.pressure && p.direction) parts.push(translate('ukraine.ctl.pressure', { side: translate(`ukraine.ctl.${p.pressure}`), dir: p.direction }));
    return parts.filter(Boolean).join(' · ');
  }
  function installHandler() {
    if (handler || !scene.canvas) return;
    handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
    handler.setInputAction((e) => {
      if (!_shown || !_pointsVisible || hoverTimer) return;
      const pos = Cesium.Cartesian2.clone(e.endPosition);
      hoverTimer = setTimeout(() => {
        hoverTimer = null;
        let p = null;
        try { const picked = scene.pick(pos, 6, 6); p = picked?.id?.ukraineControl || picked?.primitive?.id?.ukraineControl || null; } catch { p = null; }
        if (p && typeof p === 'object') {
          tip.textContent = tipText(p);
          tip.style.setProperty('--ukr-accent', CONTROL_COLORS[p.side] || CONTROL_COLORS.none);
          tip.style.transform = `translate(${Math.round(pos.x + 14)}px, ${Math.round(pos.y + 14)}px)`;
          tip.hidden = false;
        } else tip.hidden = true;
      }, HOVER_MS);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  }

  // ── verejné API ──────────────────────────────────────────────────────────
  function setSnapshot(snapshot) {
    _snapshot = snapshot && Array.isArray(snapshot.points) ? snapshot : null;
    _error = null;
    rebuild();
    emit();
  }
  async function loadLatest(day = null) {
    if (_loading) return;
    _loading = true; emit();
    try { const snap = await fetchControl(day || new Date(now()).toISOString().slice(0, 10)); if (!_destroyed) setSnapshot(snap); }
    catch (error) { _error = error?.message || String(error); }
    finally { _loading = false; if (!_destroyed) emit(); }
  }
  async function show({ day = null, load = true } = {}) {
    if (_destroyed) return false;
    _shown = true;
    ds.show = _zonesVisible;
    points.show = _pointsVisible;
    installHandler();
    requestRender();
    emit();
    if (load && !_snapshot) await loadLatest(day);
    else void lift();
    return true;
  }
  function hide() {
    if (!_shown) return;
    _shown = false;
    ds.show = false; points.show = false; tip.hidden = true;
    requestRender();
    emit();
  }
  function setPointsVisible(on) { _pointsVisible = Boolean(on); points.show = _shown && _pointsVisible; requestRender(); emit(); }
  function setZonesVisible(on) { _zonesVisible = Boolean(on); ds.show = _shown && _zonesVisible; if (zoneEntity?.rectangle) zoneEntity.rectangle.show = _zonesVisible; requestRender(); emit(); }
  function getState() {
    return {
      shown: _shown, loading: _loading, error: _error, pointsVisible: _pointsVisible, zonesVisible: _zonesVisible,
      day: _snapshot?.day || null, revisionAt: _snapshot?.revisionAt || null, snapshots: _snapshot?.snapshots ?? null,
      summary: _snapshot ? (_snapshot.summary || controlSummary(_snapshot.points)) : null, counts: _raster?.counts || null, points: _snapshot?.points?.length || 0,
      revisions: _snapshot?.revisions || null,
    };
  }
  function destroy() {
    _destroyed = true;
    hide();
    if (handler) { try { handler.destroy(); } catch { /* */ } handler = null; }
    if (hoverTimer) clearTimeout(hoverTimer);
    try { scene.primitives.remove(points); viewer.dataSources.remove(ds, true); tip.remove(); } catch { /* */ }
    listeners.clear();
  }
  return {
    id: UKRAINE_CONTROL_ID,
    show, hide, isShown: () => _shown, setSnapshot, loadLatest, setPointsVisible, setZonesVisible, getState,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy,
    _getStateForTest: () => ({ points, ds, canvas, raster: _raster, zoneEntity, tip }),
  };
}
