// src/ukraineAlertAreasLayer.js
//
// POPLACHY modulu UKRAJINA (2026-09-26): oblasti, ktoré hlásenia Vzdušných síl
// ZSU (oficiálny Telegram `kpszsu`) označujú ako ohrozené, vyfarbené fialovou
// podľa veku posledného hlásenia (plná do 1 h, slabne do 3 h — ukraineAlertAreas.js).
// Nie je to oficiálna mapa poplachov (sirény vyhlasujú oblastné správy) — hover
// a legenda to hovoria nahlas. Hranice oblastí: Natural Earth 1:10m (public
// domain), `public/data/ukraine-oblasts.json` zo scripts/build-ukraine-oblasts.mjs,
// načíta sa lenivo pri prvom zapnutí. Dáta (poplachy) dodáva časová os: hlásenia
// okna + čas kurzora (LIVE = teraz) cez `setAlerts`. Objekty (oblasti), nie ľudia.

import * as Cesium from 'cesium';
import { ALERT_FADE_MIN, alertLevels } from './data/ukraineAlertAreas.js';
import { currentLanguage, t } from './i18n.js';

export const UKRAINE_ALERTS_ID = 'ukraine-alerts';
export const ALERT_COLOR = '#b07cff';
/** Alfa výplne pri plnej intenzite (stupne 0,75/0,5/0,25 ju násobia). */
export const ALERT_FILL_ALPHA = 0.3;
export const ALERT_OUTLINE_ALPHA = 0.9;
export const ALERT_OUTLINE_WIDTH = 1.6;
export const UKRAINE_OBLASTS_URL = '/data/ukraine-oblasts.json';
const HOVER_MS = 90;
const MIN = 60_000;
const INERT = {
  id: UKRAINE_ALERTS_ID, show: async () => false, hide() {}, isShown: () => false, setAlerts() {},
  getState: () => ({ shown: false, loading: false, error: null, loaded: false, active: [], alerts: 0, at: null, lastT: null }),
  onChange() { return () => {}; }, destroy() {},
};

/** Hranice oblastí (statický súbor z public/). */
export async function fetchUkraineOblasts({ fetcher = (...a) => fetch(...a), url = UKRAINE_OBLASTS_URL } = {}) {
  const response = await fetcher(url, { cache: 'force-cache' });
  if (!response.ok) { const err = new Error(`HTTP ${response.status}`); err.status = response.status; throw err; }
  const json = await response.json();
  if (!Array.isArray(json?.oblasts)) throw new Error('bad oblasts file');
  return json;
}

/**
 * @param {object} o
 * @param {import('cesium').Viewer} o.viewer
 */
export function createUkraineAlertAreasLayer({
  viewer,
  translate = t,
  lang = currentLanguage(),
  fetchOblasts = fetchUkraineOblasts,
  documentRef = null,
} = {}) {
  const doc = documentRef || viewer?.container?.ownerDocument;
  const scene = viewer?.scene;
  if (!scene || !doc?.createElement) return INERT;

  const ds = new Cesium.CustomDataSource(UKRAINE_ALERTS_ID);
  viewer.dataSources.add(ds);
  ds.show = false;
  const tip = doc.createElement('div');
  tip.className = 'oko-ukr-ctl-tip oko-ukr-al-tip';
  tip.hidden = true;
  viewer.container.appendChild(tip);
  const colour = Cesium.Color.fromCssColorString(ALERT_COLOR);
  const nf = new Intl.NumberFormat(lang === 'sk' ? 'sk-SK' : 'en-GB');
  const requestRender = () => { try { scene.requestRender?.(); } catch { /* */ } };

  let _shown = false;
  let _oblasts = null; // [{name, iso, rings}]
  let _alerts = [];
  let _at = null;
  let _levels = new Map();
  const _drawn = new Map(); // meno → { level, entities }
  let _loading = false; let _error = null; let _destroyed = false;
  let handler = null; let hoverTimer = null;
  const listeners = new Set();
  const emit = () => { const s = getState(); for (const fn of listeners) { try { fn(s); } catch { /* */ } } };

  function clearDrawn() {
    for (const rec of _drawn.values()) for (const e of rec.entities) ds.entities.remove(e);
    _drawn.clear();
  }
  /** Prekreslí len oblasti, ktorým sa zmenil stupeň (≤ 25 oblastí, zmena raz za minúty). */
  function redraw() {
    if (!_oblasts) return;
    const next = _shown ? alertLevels(_alerts, _at, _oblasts) : new Map();
    ds.entities.suspendEvents();
    try {
      for (const [name, rec] of [..._drawn]) {
        if (next.get(name)?.level === rec.level) continue;
        for (const e of rec.entities) ds.entities.remove(e);
        _drawn.delete(name);
      }
      for (const [name, st] of next) {
        if (_drawn.has(name)) continue;
        const o = _oblasts.find((x) => x.name === name);
        if (!o) continue;
        const entities = [];
        for (const ring of o.rings) {
          const positions = ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));
          entities.push(ds.entities.add({
            polygon: { hierarchy: new Cesium.PolygonHierarchy(positions), material: colour.withAlpha(ALERT_FILL_ALPHA * st.level), classificationType: Cesium.ClassificationType.BOTH },
            properties: { ukraineAlert: name },
          }));
          entities.push(ds.entities.add({
            polyline: { positions, width: ALERT_OUTLINE_WIDTH, material: colour.withAlpha(ALERT_OUTLINE_ALPHA * st.level), clampToGround: true, classificationType: Cesium.ClassificationType.BOTH, zIndex: 5 },
            properties: { ukraineAlert: name },
          }));
        }
        _drawn.set(name, { level: st.level, entities });
      }
    } finally { ds.entities.resumeEvents(); }
    _levels = next;
    ds.credit = _shown && next.size ? new Cesium.Credit(translate('ukraine.al.credit'), true) : undefined;
    requestRender();
  }

  function tipText(name) {
    const st = _levels.get(name);
    if (!st) return '';
    const ago = Math.max(0, Math.round((_at - st.lastT) / MIN));
    const parts = [
      name,
      translate('ukraine.al.tip-ago', { min: nf.format(ago) }),
      translate('ukraine.al.tip-count', { n: nf.format(st.count1h), total: nf.format(st.count), h: nf.format(ALERT_FADE_MIN / 60) }),
    ];
    if (st.text) parts.push(`„${st.text.replace(/\s+/g, ' ').slice(0, 110)}${st.text.length > 110 ? '…' : ''}“`);
    parts.push(translate('ukraine.al.tip-source'));
    return parts.join(' · ');
  }
  function installHandler() {
    if (handler || !scene.canvas) return;
    handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
    handler.setInputAction((e) => {
      if (!_shown || hoverTimer) return;
      const pos = Cesium.Cartesian2.clone(e.endPosition);
      hoverTimer = setTimeout(() => {
        hoverTimer = null;
        let name = null;
        try {
          const picked = scene.pick(pos, 6, 6);
          const prop = picked?.id?.properties?.ukraineAlert;
          name = prop?.getValue?.() ?? (typeof prop === 'string' ? prop : null);
        } catch { name = null; }
        if (name && _levels.has(name)) {
          tip.textContent = tipText(name);
          tip.style.setProperty('--ukr-accent', ALERT_COLOR);
          tip.style.transform = `translate(${Math.round(pos.x + 14)}px, ${Math.round(pos.y + 14)}px)`;
          tip.hidden = false;
        } else tip.hidden = true;
      }, HOVER_MS);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  }

  async function load() {
    if (_loading || _oblasts) return;
    _loading = true; _error = null; emit();
    try {
      const json = await fetchOblasts();
      if (_destroyed) return;
      _oblasts = json.oblasts;
      redraw();
    } catch (error) { _error = error?.message || String(error); }
    finally { _loading = false; if (!_destroyed) emit(); }
  }
  async function show() {
    if (_destroyed) return false;
    _shown = true;
    ds.show = true;
    installHandler();
    redraw();
    emit();
    await load();
    return true;
  }
  function hide() {
    if (!_shown) return;
    _shown = false;
    ds.show = false; tip.hidden = true;
    clearDrawn(); _levels = new Map();
    ds.credit = undefined;
    requestRender();
    emit();
  }
  /** Poplachy okna osi a čas, ku ktorému sa kreslí (LIVE = teraz, prehrávanie = kurzor). */
  function setAlerts(alerts, atMs) {
    _alerts = Array.isArray(alerts) ? alerts : [];
    _at = Number.isFinite(atMs) ? atMs : null;
    if (_shown) redraw();
    emit();
  }
  function getState() {
    let lastT = null;
    for (const st of _levels.values()) if (lastT === null || st.lastT > lastT) lastT = st.lastT;
    return {
      shown: _shown, loading: _loading, error: _error, loaded: Boolean(_oblasts),
      active: [..._levels.values()].sort((a, b) => b.level - a.level || b.lastT - a.lastT).map((s) => s.name),
      alerts: _alerts.length, at: _at, lastT,
    };
  }
  function destroy() {
    _destroyed = true;
    hide();
    if (handler) { try { handler.destroy(); } catch { /* */ } handler = null; }
    if (hoverTimer) clearTimeout(hoverTimer);
    try { viewer.dataSources.remove(ds, true); tip.remove(); } catch { /* */ }
    listeners.clear();
  }
  return {
    id: UKRAINE_ALERTS_ID,
    show, hide, isShown: () => _shown, setAlerts, getState,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy,
    _getStateForTest: () => ({ ds, tip, drawn: _drawn, tipText }),
  };
}
