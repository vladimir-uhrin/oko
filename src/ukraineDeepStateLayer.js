// src/ukraineDeepStateLayer.js
//
// DEEPSTATE vrstva modulu UKRAJINA (etapa 4A predbežne, 2026-09-19): snímka
// z `/api/ukraine/events/deepstate?at=` (náš denný archív odpovede
// deepstatemap.live `/api/history/last`, čistý model ukraineDeepState.js):
//  - polygóny okupované / šedá zóna / oslobodené / od 2014 (Krym, ORDLO, Tuzla)
//    ako entity `polygon` bez výšky (primknuté k terénu aj 3D dlaždiciam,
//    `classificationType: BOTH`) s tlmenou výplňou OKO farieb + obrys ako
//    `polyline clampToGround` (obrys primknutého polygónu Cesium nekreslí);
//  - body smerov útokov (jantár) a letísk RU/BY (objekty) ako PointPrimitive
//    s výškou raz z resolvera terénu; karta pri prechode myšou (EN/UK meno).
// Vlastná symbolika (licencia DeepState zakazuje „identické objekty"), značky
// jednotiek zámerne vynechané (etická čiara), legenda: „stav k … · DeepStateMap.live
// · zámerné oneskorenie 2–3 dni · nekomerčné hobby použitie, súhlas sa žiada".
// Časová os prepína snímku podľa dňa kurzora; pred prvým archivovaným dňom
// (19. 9. 2026) história nie je — API histórie je za autorizáciou.

import * as Cesium from 'cesium';
import { DEEPSTATE_COLORS, DEEPSTATE_FILL_ALPHA, deepstateStampText } from './data/ukraineDeepState.js';
import { hatchMaterialFor } from './data/screenPatternMaterials.js';
import { fetchUkraineDeepState } from './data/ukraineEventsClient.js';
import { defaultTerrainSampler } from './data/ukraineBaseLayer.js';
import { currentLanguage, t } from './i18n.js';

export const UKRAINE_DEEPSTATE_ID = 'ukraine-deepstate';
const LIFT_BATCH = 200;
const HOVER_MS = 90;
const INERT = {
  id: UKRAINE_DEEPSTATE_ID, show: async () => false, hide() {}, isShown: () => false, setSnapshot() {}, loadLatest: async () => {},
  setStyle() {}, getStyle: () => 'default', sideAt: () => null,
  getState: () => ({ shown: false, loading: false, error: null, day: null, at: null, stampText: '', counts: null, areaKm2: null, features: 0, style: 'default' }),
  onChange() { return () => {}; }, destroy() {},
};

/** Druhy DeepState, ktoré znamenajú ruskú kontrolu (pre stranu sídla). */
export const DEEPSTATE_RU_KINDS = Object.freeze(['occupied', 'ordlo', 'crimea', 'tuzla']);
/** Štýly vrstvy: KARTA = tenšie obrysy, sivá zóna šrafovaná (K3, vzorka). */
export const DEEPSTATE_STYLES = Object.freeze({
  default: Object.freeze({ greyWidth: 1.2, width: 1.8, greyOutline: 0.75, outline: 0.9, hatch: false }),
  karta: Object.freeze({ greyWidth: 0.7, width: 1.0, greyOutline: 0.6, outline: 0.8, hatch: true }),
});

/** Index polygónov pre rýchle „v ktorej zóne je bod": vonkajší prstenec + bbox. Pure. */
export function buildPolyIndex(features) {
  const out = [];
  for (const f of features || []) {
    if (f?.type !== 'Polygon' || !Array.isArray(f.rings?.[0]) || f.rings[0].length < 4) continue;
    let w = 180, s = 90, e = -180, n = -90;
    for (const [lon, lat] of f.rings[0]) { if (lon < w) w = lon; if (lon > e) e = lon; if (lat < s) s = lat; if (lat > n) n = lat; }
    out.push({ kind: f.kind, ring: f.rings[0], bbox: [w, s, e, n] });
  }
  return out;
}
function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/**
 * Strana bodu podľa polygónov DeepState: okupované → 'ru', sivá zóna → 'contested',
 * inak `fallback` (vrstva dáva 'ua', keď snímka má okupované polygóny — všetko mimo
 * nich DeepState považuje za územie pod kontrolou UA; bez snímky null). Pure.
 */
export function sideFromPolygons(index, lon, lat, { fallback = null } = {}) {
  if (!Array.isArray(index) || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  let grey = false;
  for (const p of index) {
    const [w, s, e, n] = p.bbox;
    if (lon < w || lon > e || lat < s || lat > n) continue;
    if (!pointInRing(lon, lat, p.ring)) continue;
    if (DEEPSTATE_RU_KINDS.includes(p.kind)) return 'ru';
    if (p.kind === 'grey') grey = true;
  }
  return grey ? 'contested' : fallback;
}

/** Pozície kruhu [lon,lat] → Cartesian3 (bez výšky = primknuté). */
export function ringPositions(ring) {
  return ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));
}

/**
 * @param {object} o
 * @param {import('cesium').Viewer} o.viewer
 */
export function createUkraineDeepStateLayer({
  viewer,
  translate = t,
  lang = currentLanguage(),
  fetchDeepState = fetchUkraineDeepState,
  terrainSampler = defaultTerrainSampler,
  documentRef = null,
  now = () => Date.now(),
} = {}) {
  const doc = documentRef || viewer?.container?.ownerDocument;
  const scene = viewer?.scene;
  if (!scene || !doc?.createElement) return INERT;

  const ds = new Cesium.CustomDataSource(UKRAINE_DEEPSTATE_ID);
  viewer.dataSources.add(ds);
  ds.show = false;
  const points = scene.primitives.add(new Cesium.PointPrimitiveCollection());
  points.show = false;
  const tip = doc.createElement('div');
  tip.className = 'oko-ukr-ctl-tip oko-ukr-ds-tip';
  tip.hidden = true;
  viewer.container.appendChild(tip);
  const heightCache = new Map();
  const hKey = (p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
  const posFor = (p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, heightCache.get(hKey(p)) ?? 0);
  const requestRender = () => { try { scene.requestRender?.(); } catch { /* */ } };

  let _shown = false;
  let _snapshot = null;
  let _polyIndex = [];
  let _style = 'default';
  let _loading = false;
  let _error = null;
  let _destroyed = false;
  let _liftChain = Promise.resolve();
  let handler = null; let hoverTimer = null;
  const listeners = new Set();
  const emit = () => { const s = getState(); for (const fn of listeners) { try { fn(s); } catch { /* */ } } };

  function rebuild() {
    ds.entities.removeAll();
    points.removeAll();
    if (!_snapshot?.features?.length) { requestRender(); return; }
    const st = DEEPSTATE_STYLES[_style] || DEEPSTATE_STYLES.default;
    let n = 0;
    for (const f of _snapshot.features) {
      const colour = Cesium.Color.fromCssColorString(DEEPSTATE_COLORS[f.kind] || '#8a97a3');
      if (f.type === 'Polygon' && Array.isArray(f.rings) && f.rings.length) {
        const alpha = DEEPSTATE_FILL_ALPHA[f.kind] ?? 0.2;
        const outer = ringPositions(f.rings[0]);
        const holes = f.rings.slice(1).map((r) => new Cesium.PolygonHierarchy(ringPositions(r)));
        n += 1;
        // Sivá zóna na KARTE: šrafovanie 45° v obrazovkových px (ako „územie bojov" vo vzorke); bez cache materiálov výplň.
        const material = (st.hatch && f.kind === 'grey') ? (hatchMaterialFor(DEEPSTATE_COLORS.grey, { lineAlpha: 0.6, fillAlpha: 0.1 }) || colour.withAlpha(alpha)) : colour.withAlpha(alpha);
        ds.entities.add({
          id: `${UKRAINE_DEEPSTATE_ID}:poly:${n}`,
          polygon: { hierarchy: new Cesium.PolygonHierarchy(outer, holes), material, classificationType: Cesium.ClassificationType.BOTH },
          properties: { deepstate: { kind: f.kind, en: f.en, uk: f.uk, areaKm2: f.areaKm2, description: f.description || null } },
        });
        ds.entities.add({
          id: `${UKRAINE_DEEPSTATE_ID}:line:${n}`,
          polyline: { positions: outer, width: f.kind === 'grey' ? st.greyWidth : st.width, material: colour.withAlpha(f.kind === 'grey' ? st.greyOutline : st.outline), clampToGround: true, classificationType: Cesium.ClassificationType.BOTH },
        });
      } else if (f.type === 'Point' && Number.isFinite(f.lat) && Number.isFinite(f.lon)) {
        const attack = f.kind === 'attack';
        points.add({
          position: posFor(f),
          color: colour.withAlpha(attack ? 0.95 : 0.85),
          pixelSize: attack ? 8 : 5,
          outlineColor: attack ? Cesium.Color.fromCssColorString('#0b1622').withAlpha(0.9) : Cesium.Color.BLACK.withAlpha(0.7),
          outlineWidth: attack ? 2 : 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          id: { ukraineDeepState: f },
        });
      }
    }
    points.show = _shown;
    requestRender();
    void lift();
  }
  function lift() {
    if (typeof terrainSampler !== 'function') return Promise.resolve();
    _liftChain = _liftChain.then(async () => {
      if (_destroyed || !_shown || !_snapshot) return;
      const pending = []; const seen = new Set();
      for (const f of _snapshot.features) {
        if (f.type !== 'Point') continue;
        const k = hKey(f); if (heightCache.has(k) || seen.has(k)) continue; seen.add(k); pending.push({ k, lon: f.lon, lat: f.lat });
      }
      for (let i = 0; i < pending.length && !_destroyed; i += LIFT_BATCH) {
        const batch = pending.slice(i, i + LIFT_BATCH);
        let heights = null;
        try { heights = await terrainSampler(batch.map((p) => [p.lon, p.lat])); } catch { heights = null; }
        if (!Array.isArray(heights)) break;
        batch.forEach((p, j) => { if (Number.isFinite(heights[j])) heightCache.set(p.k, heights[j]); });
      }
      if (_destroyed) return;
      for (let i = 0; i < points.length; i += 1) { const pt = points.get(i); const f = pt.id?.ukraineDeepState; if (f && heightCache.has(hKey(f))) pt.position = posFor(f); }
      requestRender();
    }).catch(() => {});
    return _liftChain;
  }

  // ── karta pri prechode myšou (body aj polygóny) ──────────────────────────
  function tipTextFor(info) {
    if (!info) return '';
    const kindText = translate(`ukraine.ds.${info.kind}`);
    const name = lang === 'uk' ? (info.uk || info.en) : (info.en || info.uk);
    const parts = [kindText];
    if (name && !/^(Occupied|Unknown status|Liberated|Direction of attack)\b/i.test(name)) parts.push(name);
    if (Number.isFinite(info.areaKm2) && info.areaKm2 >= 1) parts.push(`≈ ${Math.round(info.areaKm2).toLocaleString(lang === 'sk' ? 'sk-SK' : 'en-GB')} km²`);
    return parts.filter(Boolean).join(' · ');
  }
  function installHandler() {
    if (handler || !scene.canvas) return;
    handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
    handler.setInputAction((e) => {
      if (!_shown || hoverTimer) return;
      const pos = Cesium.Cartesian2.clone(e.endPosition);
      hoverTimer = setTimeout(() => {
        hoverTimer = null;
        let info = null;
        try {
          const picked = scene.pick(pos, 6, 6);
          const f = picked?.id?.ukraineDeepState || picked?.primitive?.id?.ukraineDeepState;
          if (f && typeof f === 'object') info = f;
          else if (picked?.id?.properties?.deepstate) info = picked.id.properties.deepstate.getValue?.() || picked.id.properties.deepstate;
        } catch { info = null; }
        if (info && info.kind) {
          tip.textContent = tipTextFor(info);
          tip.style.setProperty('--ukr-accent', DEEPSTATE_COLORS[info.kind] || '#8a97a3');
          tip.style.transform = `translate(${Math.round(pos.x + 14)}px, ${Math.round(pos.y + 14)}px)`;
          tip.hidden = false;
        } else tip.hidden = true;
      }, HOVER_MS);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  }

  // ── verejné API ──────────────────────────────────────────────────────────
  function setSnapshot(snapshot) {
    _snapshot = snapshot && Array.isArray(snapshot.features) ? snapshot : null;
    _polyIndex = buildPolyIndex(_snapshot?.features);
    _error = null;
    rebuild();
    emit();
  }
  /** Štýl 'default' | 'karta' (K3): tenšie obrysy, sivá zóna šrafovaná. */
  function setStyle(mode) {
    const next = DEEPSTATE_STYLES[mode] ? mode : 'default';
    if (next === _style) return;
    _style = next;
    if (_snapshot) rebuild();
    emit();
  }
  /** Strana bodu podľa polygónov snímky: 'ru' | 'contested' | 'ua' (mimo polygónov, keď snímka má okupované) | null bez snímky. */
  function sideAt(lon, lat) {
    const hasOccupied = _polyIndex.some((p) => DEEPSTATE_RU_KINDS.includes(p.kind));
    return sideFromPolygons(_polyIndex, lon, lat, { fallback: hasOccupied ? 'ua' : null });
  }
  async function loadLatest(day = null) {
    if (_loading) return;
    _loading = true; emit();
    try { const snap = await fetchDeepState(day || new Date(now()).toISOString().slice(0, 10)); if (!_destroyed) setSnapshot(snap); }
    catch (error) { _error = error?.status === 404 ? 'missing' : (error?.message || String(error)); }
    finally { _loading = false; if (!_destroyed) emit(); }
  }
  async function show({ day = null, load = true } = {}) {
    if (_destroyed) return false;
    _shown = true;
    ds.show = true; points.show = true;
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
  function getState() {
    return {
      shown: _shown, loading: _loading, error: _error,
      day: _snapshot?.day || null, at: _snapshot?.at || null, stampText: deepstateStampText(_snapshot), datetime: _snapshot?.datetime || null,
      counts: _snapshot?.counts || null, areaKm2: _snapshot?.areaKm2 || null, features: _snapshot?.features?.length || 0, snapshots: _snapshot?.snapshots ?? null,
      style: _style,
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
    id: UKRAINE_DEEPSTATE_ID,
    show, hide, isShown: () => _shown, setSnapshot, loadLatest, getState,
    setStyle, getStyle: () => _style, sideAt,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy,
    _getStateForTest: () => ({ ds, points, tip, polyIndex: _polyIndex }),
  };
}
