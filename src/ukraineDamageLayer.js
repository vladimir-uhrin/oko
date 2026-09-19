// src/ukraineDamageLayer.js
//
// ŠKODY modulu UKRAJINA (etapa 5, 2026-09-19): statické škody na budovách.
//  - hromady (ADM3) zo Sentinel-1 modelu ETH Zürich (CC BY 4.0, február 2022 –
//    február 2024): kruh v ťažisku hromady, polomer ~ √(počet), farba podľa podielu
//    poškodených budov; hover: názov, počet, podiel, poctivosť („model, precision 67 %");
//  - body UNOSAT (CC BY-SA, marec – október 2022, 26 miest): trieda poškodenia farbou;
//    časová os ich odkrýva podľa dátumu hodnotenia (`setCursor`).
// Bez CLAMP_TO_GROUND; hromady sa zdvihnú raz z resolvera terénu, 18 000 bodov
// UNOSAT ostáva na elipsoide (test hĺbky vypnutý — vidno ich vždy). Budovy, nie osoby.

import * as Cesium from 'cesium';
import { DAMAGE_PERIOD, UNOSAT_COLORS, damageColor, damageRadiusPx } from './data/ukraineDamage.js';
import { fetchUkraineDamage } from './data/ukraineEventsClient.js';
import { defaultTerrainSampler } from './data/ukraineBaseLayer.js';
import { currentLanguage, t } from './i18n.js';

export const UKRAINE_DAMAGE_ID = 'ukraine-damage';
const LIFT_BATCH = 200;
const HOVER_MS = 90;
const INERT = {
  id: UKRAINE_DAMAGE_ID, show: async () => false, hide() {}, isShown: () => false, setCursor() {},
  getState: () => ({ shown: false, loading: false, error: null, adm3: 0, unosat: 0, visibleUnosat: 0, damaged: 0, period: DAMAGE_PERIOD, builtAt: null }),
  onChange() { return () => {}; }, destroy() {},
};

/**
 * @param {object} o
 * @param {import('cesium').Viewer} o.viewer
 */
export function createUkraineDamageLayer({
  viewer,
  translate = t,
  lang = currentLanguage(),
  fetchDamage = fetchUkraineDamage,
  terrainSampler = defaultTerrainSampler,
  documentRef = null,
} = {}) {
  const doc = documentRef || viewer?.container?.ownerDocument;
  const scene = viewer?.scene;
  if (!scene || !doc?.createElement) return INERT;

  const hromady = scene.primitives.add(new Cesium.PointPrimitiveCollection());
  const unosat = scene.primitives.add(new Cesium.PointPrimitiveCollection());
  hromady.show = false; unosat.show = false;
  const tip = doc.createElement('div');
  tip.className = 'oko-ukr-ctl-tip oko-ukr-dmg-tip';
  tip.hidden = true;
  viewer.container.appendChild(tip);
  const nf = new Intl.NumberFormat(lang === 'sk' ? 'sk-SK' : 'en-GB');
  const requestRender = () => { try { scene.requestRender?.(); } catch { /* */ } };

  let _shown = false;
  let _adm3 = null; let _unosat = null;
  let _loading = false; let _error = null;
  let _cursor = null; let _visibleUnosat = 0;
  let _destroyed = false;
  let handler = null; let hoverTimer = null;
  const listeners = new Set();
  const emit = () => { const s = getState(); for (const fn of listeners) { try { fn(s); } catch { /* */ } } };

  function rebuild() {
    hromady.removeAll(); unosat.removeAll();
    for (const a of _adm3?.items || []) {
      const r = damageRadiusPx(a.damaged);
      hromady.add({
        position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat, 0),
        color: Cesium.Color.fromCssColorString(damageColor(a.pct)).withAlpha(0.55),
        pixelSize: r * 2,
        outlineColor: Cesium.Color.fromCssColorString('#0b1622').withAlpha(0.8),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: { ukraineDamage: { kind: 'adm3', ...a } },
      });
    }
    for (const u of _unosat?.items || []) {
      unosat.add({
        position: Cesium.Cartesian3.fromDegrees(u.lon, u.lat, 0),
        color: Cesium.Color.fromCssColorString(UNOSAT_COLORS[u.cls] || '#ffb547').withAlpha(0.9),
        pixelSize: u.cls === 'destroyed' ? 4.5 : 3.5,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: { ukraineDamage: { kind: 'unosat', ...u } },
      });
    }
    applyCursor();
    hromady.show = _shown; unosat.show = _shown;
    requestRender();
    void lift();
  }
  /** Zdvih hromád raz (1 759 bodov) — UNOSAT (18 000) ostáva na elipsoide. */
  async function lift() {
    if (typeof terrainSampler !== 'function' || !_adm3?.items?.length) return;
    const items = _adm3.items;
    for (let i = 0; i < items.length && !_destroyed; i += LIFT_BATCH) {
      const batch = items.slice(i, i + LIFT_BATCH);
      let heights = null;
      try { heights = await terrainSampler(batch.map((a) => [a.lon, a.lat])); } catch { heights = null; }
      if (!Array.isArray(heights) || _destroyed) return;
      for (let k = 0; k < hromady.length; k += 1) {
        const p = hromady.get(k); const a = p.id?.ukraineDamage;
        const j = a ? batch.findIndex((b) => b.id === a.id) : -1;
        if (j >= 0 && Number.isFinite(heights[j])) p.position = Cesium.Cartesian3.fromDegrees(a.lon, a.lat, heights[j]);
      }
    }
    requestRender();
  }
  function applyCursor() {
    let visible = 0;
    for (let i = 0; i < unosat.length; i += 1) {
      const p = unosat.get(i); const u = p.id?.ukraineDamage;
      const on = !Number.isFinite(_cursor) || (u && u.t <= _cursor);
      p.show = on;
      if (on) visible += 1;
    }
    _visibleUnosat = visible;
  }

  function tipText(info) {
    if (!info) return '';
    if (info.kind === 'adm3') {
      const parts = [info.name || info.id, translate('ukraine.dmg.adm3-count', { n: nf.format(info.damaged) })];
      if (Number.isFinite(info.pct)) parts.push(translate('ukraine.dmg.adm3-pct', { pct: nf.format(info.pct) }));
      parts.push(translate('ukraine.dmg.adm3-note'));
      return parts.join(' · ');
    }
    const d = new Date(info.t);
    return [translate('ukraine.dmg.unosat'), translate(`ukraine.dmg.cls.${info.cls}`), info.city, `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`].filter(Boolean).join(' · ');
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
        try { const picked = scene.pick(pos, 6, 6); info = picked?.id?.ukraineDamage || picked?.primitive?.id?.ukraineDamage || null; } catch { info = null; }
        if (info && typeof info === 'object') {
          tip.textContent = tipText(info);
          tip.style.setProperty('--ukr-accent', info.kind === 'adm3' ? damageColor(info.pct) : (UNOSAT_COLORS[info.cls] || '#ffb547'));
          tip.style.transform = `translate(${Math.round(pos.x + 14)}px, ${Math.round(pos.y + 14)}px)`;
          tip.hidden = false;
        } else tip.hidden = true;
      }, HOVER_MS);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  }

  async function load() {
    if (_loading || (_adm3 && _unosat)) return;
    _loading = true; _error = null; emit();
    try {
      const [a, u] = await Promise.all([fetchDamage('adm3'), fetchDamage('unosat')]);
      if (_destroyed) return;
      _adm3 = a; _unosat = u;
      rebuild();
    } catch (error) { _error = error?.status === 404 ? 'missing' : (error?.message || String(error)); }
    finally { _loading = false; if (!_destroyed) emit(); }
  }
  async function show() {
    if (_destroyed) return false;
    _shown = true;
    hromady.show = true; unosat.show = true;
    installHandler();
    requestRender();
    emit();
    await load();
    return true;
  }
  function hide() {
    if (!_shown) return;
    _shown = false;
    hromady.show = false; unosat.show = false; tip.hidden = true;
    requestRender();
    emit();
  }
  /** Kurzor osi (ms UTC) alebo null = všetko; UNOSAT body s dátumom hodnotenia ≤ kurzor. */
  function setCursor(ms) {
    const next = Number.isFinite(ms) ? ms : null;
    if (next === _cursor) return;
    _cursor = next;
    applyCursor();
    requestRender();
    emit();
  }
  function getState() {
    return {
      shown: _shown, loading: _loading, error: _error,
      adm3: _adm3?.items?.length || 0, unosat: _unosat?.items?.length || 0, visibleUnosat: _visibleUnosat,
      damaged: _adm3?.damaged || 0, period: _adm3?.period || DAMAGE_PERIOD, builtAt: _adm3?.builtAt || null,
      unosatFrom: _unosat?.items?.[0]?.t || null, unosatTo: _unosat?.items?.at?.(-1)?.t || null,
    };
  }
  function destroy() {
    _destroyed = true;
    hide();
    if (handler) { try { handler.destroy(); } catch { /* */ } handler = null; }
    if (hoverTimer) clearTimeout(hoverTimer);
    try { scene.primitives.remove(hromady); scene.primitives.remove(unosat); tip.remove(); } catch { /* */ }
    listeners.clear();
  }
  return {
    id: UKRAINE_DAMAGE_ID,
    show, hide, isShown: () => _shown, setCursor, getState,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy,
    _getStateForTest: () => ({ hromady, unosat, tip }),
  };
}
