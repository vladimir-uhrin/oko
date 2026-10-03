// src/airspaceAdvisoryLayer.js
//
// VZDUŠNÝ PRIESTOR modulu BLÍZKY VÝCHOD (etapa 5b, 2026-10-03): bulletiny EASA o konfliktných
// zónach (CZIB) nakreslené na hraniciach FIR z VATSpy. Dáta dodáva archív servera
// (`/api/mideast/events/airspace`, src/data/czib.js + scripts/lib/mideastArchive.mjs), vrstva
// ich len kreslí: celý FIR „všetky výšky" červenou výplňou, „pod FLxxx" jantárovou, bulletin
// pre ČASŤ FIR (čiara cez body, priestor nad vodou, západne od poludníka) len prerušovaným
// obrysom — presnú hranicu má iba text bulletinu, výplň celého FIR by klamala.
//
// Poctivosť: odporúčanie EASA pre leteckých prevádzkovateľov z EÚ, nie zákaz letov; hranice
// FIR sú približné (simulačná komunita VATSIM, CC BY-SA 4.0). Hover a legenda to hovoria.
// Kreslí sa celý svet (aj Ukrajina, Rusko, Líbya…) — panel BLÍZKY VÝCHOD vypisuje svoje.

import * as Cesium from 'cesium';
import { fetchAirspace, isMideastBulletin } from './data/czib.js';
import { currentLanguage, t } from './i18n.js';

export const AIRSPACE_LAYER_ID = 'airspace-advisory';
export const AIRSPACE_COLOR_ALL = '#ff5a5f';
export const AIRSPACE_COLOR_BELOW = '#ffb547';
export const AIRSPACE_FILL_ALPHA = 0.16;
export const AIRSPACE_OUTLINE_ALPHA = 0.85;
export const AIRSPACE_OUTLINE_WIDTH = 1.8;
/** Načítané dáta sa obnovia pri zapnutí, ak sú staršie (server ich ťahá raz za 6 h). */
export const AIRSPACE_RELOAD_MS = 30 * 60_000;
const HOVER_MS = 90;

const INERT = {
  id: AIRSPACE_LAYER_ID, setEnabled: async () => false, isEnabled: () => false,
  getState: () => ({ enabled: false, loading: false, error: null, fetchedAt: null, boundariesAt: null, bulletins: [], missingFirs: [] }),
  onChange() { return () => {}; }, destroy() {},
};

/** Farba bulletinu podľa výšok (pure). */
export const airspaceColour = (scope) => (scope?.altitude === 'below' ? AIRSPACE_COLOR_BELOW : AIRSPACE_COLOR_ALL);

/**
 * Bulletiny z tela servera → modely pre legendu a kreslenie (pure): FIR s polygónmi, Blízky
 * východ hore, potom podľa platnosti.
 */
export function airspaceModels(payload) {
  const firs = payload?.firs && typeof payload.firs === 'object' ? payload.firs : {};
  const list = Array.isArray(payload?.bulletins) ? payload.bulletins : [];
  return list.map((b) => ({
    nid: String(b.nid),
    czib: b.czib || null,
    title: b.title || '',
    countries: Array.isArray(b.countries) ? b.countries : [],
    scope: b.scope || { altitude: 'all', fl: null, partial: false, partialHint: null, exceptions: false },
    validUntil: b.validUntil || null,
    lapsed: Boolean(b.lapsed),
    url: typeof b.url === 'string' && /^https:\/\/www\.easa\.europa\.eu\//.test(b.url) ? b.url : null,
    recommendation: b.recommendation || null,
    firs: (Array.isArray(b.firs) ? b.firs : []).filter((code) => Array.isArray(firs[code])),
    mideast: isMideastBulletin(b),
  })).sort((a, b) => Number(b.mideast) - Number(a.mideast) || String(a.validUntil || '').localeCompare(String(b.validUntil || '')));
}

/**
 * @param {object} o
 * @param {import('cesium').Viewer} o.viewer
 * @param {typeof fetchAirspace} [o.fetchImpl]
 */
export function createAirspaceAdvisory({
  viewer,
  fetchImpl = fetchAirspace,
  translate = t,
  lang = currentLanguage(),
  now = () => Date.now(),
  documentRef = null,
} = {}) {
  const doc = documentRef || viewer?.container?.ownerDocument;
  const scene = viewer?.scene;
  if (!scene || !doc?.createElement) return INERT;

  const ds = new Cesium.CustomDataSource(AIRSPACE_LAYER_ID);
  viewer.dataSources.add(ds);
  ds.show = false;
  const tip = doc.createElement('div');
  tip.className = 'oko-ukr-ctl-tip oko-air-tip';
  tip.hidden = true;
  viewer.container.appendChild(tip);
  const dateFormat = new Intl.DateTimeFormat(lang === 'sk' ? 'sk-SK' : 'en-GB', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const fmtDay = (iso) => { const ms = Date.parse(`${iso}T00:00:00Z`); return Number.isFinite(ms) ? dateFormat.format(new Date(ms)) : String(iso || ''); };
  const requestRender = () => { try { scene.requestRender?.(); } catch { /* */ } };

  let _enabled = false;
  let _payload = null;
  let _models = [];
  let _loadedAt = 0;
  let _loading = false;
  let _error = null;
  let _drawn = false;
  let _destroyed = false;
  let handler = null;
  let hoverTimer = null;
  const listeners = new Set();
  const emit = () => { const s = getState(); for (const fn of listeners) { try { fn(s); } catch { /* */ } } };

  function draw() {
    ds.entities.removeAll();
    _drawn = false;
    if (!_enabled || !_payload) return;
    ds.entities.suspendEvents();
    try {
      for (const m of _models) {
        const colour = Cesium.Color.fromCssColorString(airspaceColour(m.scope));
        for (const code of m.firs) {
          for (const rings of _payload.firs[code]) {
            const [outer, ...holes] = rings.map((ring) => ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)));
            if (!outer || outer.length < 4) continue;
            if (!m.scope.partial) {
              ds.entities.add({
                polygon: {
                  hierarchy: new Cesium.PolygonHierarchy(outer, holes.map((h) => new Cesium.PolygonHierarchy(h))),
                  material: colour.withAlpha(m.scope.altitude === 'below' ? AIRSPACE_FILL_ALPHA * 0.75 : AIRSPACE_FILL_ALPHA),
                  classificationType: Cesium.ClassificationType.BOTH,
                },
                properties: { czibNid: m.nid, firCode: code },
              });
            }
            ds.entities.add({
              polyline: {
                positions: outer,
                width: AIRSPACE_OUTLINE_WIDTH,
                material: m.scope.partial
                  ? new Cesium.PolylineDashMaterialProperty({ color: colour.withAlpha(AIRSPACE_OUTLINE_ALPHA), dashLength: 14 })
                  : colour.withAlpha(AIRSPACE_OUTLINE_ALPHA),
                clampToGround: true,
                classificationType: Cesium.ClassificationType.BOTH,
                zIndex: 4,
              },
              properties: { czibNid: m.nid, firCode: code },
            });
          }
        }
      }
    } finally { ds.entities.resumeEvents(); }
    _drawn = true;
    ds.credit = new Cesium.Credit(translate('mideast.air.credit'), true);
    requestRender();
  }

  /** Text bubliny nad FIR (pure voči stavu): číslo, oblasť, výšky, časť/výnimky, platnosť, citát EASA, zdroj. */
  function tipText(nid, firCode) {
    const m = _models.find((x) => x.nid === nid);
    if (!m) return '';
    const parts = [
      [m.czib, firCode ? `FIR ${firCode}` : null].filter(Boolean).join(' · '),
      m.title,
      m.scope.altitude === 'below' ? translate('mideast.air.below', { fl: m.scope.fl }) : translate('mideast.air.all'),
    ];
    if (m.scope.partial) parts.push(translate('mideast.air.partial'));
    if (m.scope.exceptions) parts.push(translate('mideast.air.exceptions'));
    if (m.validUntil) parts.push(translate(m.lapsed ? 'mideast.air.lapsed' : 'mideast.air.until', { date: fmtDay(m.validUntil) }));
    if (m.recommendation) parts.push(`„${m.recommendation.slice(0, 160)}${m.recommendation.length > 160 ? '…' : ''}“`);
    parts.push(translate('mideast.air.tip-source'));
    return parts.filter(Boolean).join(' · ');
  }
  function installHandler() {
    if (handler || !scene.canvas) return;
    handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
    handler.setInputAction((e) => {
      if (!_enabled || hoverTimer) return;
      const pos = Cesium.Cartesian2.clone(e.endPosition);
      hoverTimer = setTimeout(() => {
        hoverTimer = null;
        let nid = null; let fir = null;
        try {
          const props = scene.pick(pos, 6, 6)?.id?.properties;
          nid = props?.czibNid?.getValue?.() ?? null;
          fir = props?.firCode?.getValue?.() ?? null;
        } catch { nid = null; }
        const text = nid ? tipText(nid, fir) : '';
        if (text) {
          const m = _models.find((x) => x.nid === nid);
          tip.textContent = text;
          tip.style.setProperty('--ukr-accent', airspaceColour(m?.scope));
          tip.style.transform = `translate(${Math.round(pos.x + 14)}px, ${Math.round(pos.y + 14)}px)`;
          tip.hidden = false;
        } else tip.hidden = true;
      }, HOVER_MS);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  }

  async function load() {
    if (_loading) return;
    if (_payload && now() - _loadedAt < AIRSPACE_RELOAD_MS) return;
    _loading = true; _error = null; emit();
    try {
      const payload = await fetchImpl();
      if (_destroyed) return;
      _payload = payload;
      _models = airspaceModels(payload);
      _loadedAt = now();
      if (_enabled) draw();
    } catch (error) {
      // Staré dáta (ak sú) ostávajú nakreslené; legenda ukáže chybu.
      _error = error?.status === 404 ? 'no_airspace_snapshot' : (error?.message || String(error));
    } finally {
      _loading = false;
      if (!_destroyed) emit();
    }
  }

  async function setEnabled(on) {
    if (_destroyed) return false;
    _enabled = Boolean(on);
    ds.show = _enabled;
    if (!_enabled) {
      tip.hidden = true;
      ds.entities.removeAll(); _drawn = false;
      ds.credit = undefined;
      requestRender();
      emit();
      return false;
    }
    installHandler();
    if (_payload && !_drawn) draw();
    emit();
    await load();
    return true;
  }

  function getState() {
    return {
      enabled: _enabled,
      loading: _loading,
      error: _error,
      fetchedAt: _payload?.fetchedAt ?? null,
      boundariesAt: _payload?.boundariesAt ?? null,
      attribution: _payload?.attribution || null,
      firAttribution: _payload?.firAttribution || null,
      bulletins: _models,
      missingFirs: Array.isArray(_payload?.missingFirs) ? _payload.missingFirs : [],
    };
  }
  function destroy() {
    _destroyed = true;
    if (handler) { try { handler.destroy(); } catch { /* */ } handler = null; }
    if (hoverTimer) clearTimeout(hoverTimer);
    try { viewer.dataSources.remove(ds, true); tip.remove(); } catch { /* */ }
    listeners.clear();
  }
  return {
    id: AIRSPACE_LAYER_ID,
    setEnabled,
    isEnabled: () => _enabled,
    getState,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy,
    _getStateForTest: () => ({ ds, tip, tipText, drawn: () => _drawn }),
  };
}
