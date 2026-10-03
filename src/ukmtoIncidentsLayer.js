// src/ukmtoIncidentsLayer.js
//
// INCIDENTY LODÍ modulu BLÍZKY VÝCHOD (etapa 5c, 2026-10-03): varovania UKMTO ako body na
// mape — útoky, únosy, podozrivé priblíženia, upozornenia. Dáta dodáva archív servera
// (`/api/mideast/events/ukmto`, src/data/ukmto.js + scripts/lib/mideastArchive.mjs), vrstva ich
// kreslí: farba = druh incidentu, veľkosť a sýtosť = vek (do 7 dní / do 30 dní / starší).
//
// Kedy je vidieť: čip je zapnutý (predvolene áno) A je aktívne dejisko BLÍZKEHO VÝCHODU alebo
// úžina v oblasti hlásení UKMTO (Hormuz, Báb al-Mandab, Suez) A brána priblíženia je otvorená —
// rovnako ako kontrola sídiel. Sťahuje sa až pri prvom dejisku, nie pri štarte stránky.
//
// Poctivosť: varovanie je HLÁSENÁ udalosť z oficiálneho zdroja („UKMTO has received a report"),
// poloha je tá z varovania; mená plavidiel sa neukazujú, osoby nikdy. Hover cituje varovanie
// a menuje zdroj a licenciu (Open Government Licence v3.0).

import * as Cesium from 'cesium';
import { UKMTO_DAYS_DEFAULT, UKMTO_TYPES, UKMTO_TYPE_OTHER, fetchUkmto, ukmtoAge, ukmtoSummary } from './data/ukmto.js';
import { currentLanguage, t } from './i18n.js';

export const UKMTO_LAYER_ID = 'ukmto-incidents';
/** Načítané dáta sa obnovia pri ďalšom dejisku, ak sú staršie (server sa pýta UKMTO raz za hodinu). */
export const UKMTO_RELOAD_MS = 15 * 60_000;
export const UKMTO_POINT_SIZE = Object.freeze({ fresh: 11, recent: 8, old: 6 });
export const UKMTO_POINT_ALPHA = Object.freeze({ fresh: 0.95, recent: 0.75, old: 0.45 });
const HOVER_MS = 90;

const INERT = {
  id: UKMTO_LAYER_ID, setEnabled() {}, isEnabled: () => false, setActive: async () => {}, show() {}, hide() {},
  getState: () => ({ enabled: false, active: false, visible: false, loading: false, error: null, fetchedAt: null, incidents: [], summary: { days: 30, total: 0, byType: [], latest: [] } }),
  onChange() { return () => {}; }, destroy() {},
};

/** Farba druhu incidentu (pure). */
export const ukmtoColour = (typeId) => (UKMTO_TYPES.find((x) => x.id === typeId) || UKMTO_TYPE_OTHER).css;

/** „Strait of Hormuz" → „strait-of-hormuz" (kľúč i18n miesta a druhu plavidla). Pure. */
export const ukmtoSlug = (value) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * @param {object} o
 * @param {import('cesium').Viewer} o.viewer
 * @param {typeof fetchUkmto} [o.fetchImpl]
 */
export function createUkmtoIncidents({
  viewer,
  fetchImpl = fetchUkmto,
  translate = t,
  lang = currentLanguage(),
  now = () => Date.now(),
  days = UKMTO_DAYS_DEFAULT,
  documentRef = null,
} = {}) {
  const doc = documentRef || viewer?.container?.ownerDocument;
  const scene = viewer?.scene;
  if (!scene || !doc?.createElement) return INERT;

  const ds = new Cesium.CustomDataSource(UKMTO_LAYER_ID);
  viewer.dataSources.add(ds);
  ds.show = false;
  const tip = doc.createElement('div');
  tip.className = 'oko-ukr-ctl-tip oko-ukmto-tip';
  tip.hidden = true;
  viewer.container.appendChild(tip);
  const dateTime = new Intl.DateTimeFormat(lang === 'sk' ? 'sk-SK' : 'en-GB', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
  const requestRender = () => { try { scene.requestRender?.(); } catch { /* */ } };
  const textOr = (key, fallback) => { const s = translate(key); return s === key ? fallback : s; };

  let _enabled = true;
  let _active = false;
  let _visible = true;
  let _payload = null;
  let _incidents = [];
  let _loadedAt = 0;
  let _loading = false;
  let _error = null;
  let _destroyed = false;
  let handler = null;
  let hoverTimer = null;
  const listeners = new Set();
  const emit = () => { const s = getState(); for (const fn of listeners) { try { fn(s); } catch { /* */ } } };

  const typeLabel = (it) => textOr(`mideast.ukmto.type.${it.type}`, it.typeName || it.type);
  const placeLabel = (it) => textOr(`mideast.ukmto.p.${ukmtoSlug(it.place)}`, it.place || '');
  const vesselLabel = (it) => (it.vesselType ? textOr(`mideast.ukmto.v.${ukmtoSlug(it.vesselType)}`, it.vesselType) : '');
  const whenLabel = (it) => `${dateTime.format(new Date(it.t))} UTC`;

  function draw() {
    ds.entities.removeAll();
    if (!_incidents.length) { requestRender(); return; }
    const nowMs = now();
    ds.entities.suspendEvents();
    try {
      // Staršie najprv, aby čerstvé body ležali navrchu.
      for (const it of [..._incidents].reverse()) {
        const age = ukmtoAge(it.t, nowMs);
        const colour = Cesium.Color.fromCssColorString(ukmtoColour(it.type));
        ds.entities.add({
          position: Cesium.Cartesian3.fromDegrees(it.lon, it.lat),
          point: {
            pixelSize: UKMTO_POINT_SIZE[age],
            color: colour.withAlpha(UKMTO_POINT_ALPHA[age]),
            outlineColor: Cesium.Color.BLACK.withAlpha(age === 'old' ? 0.45 : 0.8),
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          properties: { ukmtoId: it.id },
        });
      }
    } finally { ds.entities.resumeEvents(); }
    requestRender();
  }

  /** Text bubliny: číslo, druh, čas, oblasť, plavidlo, citát varovania, zdroj. */
  function tipText(id) {
    const it = _incidents.find((x) => x.id === id);
    if (!it) return '';
    const parts = [
      it.ref ? `UKMTO ${it.ref}` : 'UKMTO',
      typeLabel(it),
      whenLabel(it),
      placeLabel(it),
      vesselLabel(it),
    ];
    if (it.text) parts.push(`„${it.text.slice(0, 220)}${it.text.length > 220 ? '…' : ''}“`);
    parts.push(translate('mideast.ukmto.tip-source'));
    return parts.filter(Boolean).join(' · ');
  }
  function installHandler() {
    if (handler || !scene.canvas) return;
    handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
    handler.setInputAction((e) => {
      if (!ds.show || hoverTimer) return;
      const pos = Cesium.Cartesian2.clone(e.endPosition);
      hoverTimer = setTimeout(() => {
        hoverTimer = null;
        let id = null;
        try { id = scene.pick(pos, 8, 8)?.id?.properties?.ukmtoId?.getValue?.() ?? null; } catch { id = null; }
        const text = id ? tipText(id) : '';
        if (text) {
          const it = _incidents.find((x) => x.id === id);
          tip.textContent = text;
          tip.style.setProperty('--ukr-accent', ukmtoColour(it?.type));
          tip.style.transform = `translate(${Math.round(pos.x + 14)}px, ${Math.round(pos.y + 14)}px)`;
          tip.hidden = false;
        } else tip.hidden = true;
      }, HOVER_MS);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  }

  async function load() {
    if (_loading) return;
    if (_payload && now() - _loadedAt < UKMTO_RELOAD_MS) return;
    _loading = true; _error = null; emit();
    try {
      const payload = await fetchImpl({ days });
      if (_destroyed) return;
      _payload = payload;
      _incidents = Array.isArray(payload.incidents) ? payload.incidents.filter((it) => it && Number.isFinite(it.lat) && Number.isFinite(it.lon) && Number.isFinite(it.t)) : [];
      _loadedAt = now();
      draw();
    } catch (error) {
      // Staré body (ak sú) ostávajú; legenda ukáže chybu.
      _error = error?.status === 404 ? 'no_ukmto_snapshot' : (error?.message || String(error));
    } finally {
      _loading = false;
      if (!_destroyed) emit();
    }
  }

  /** Zosúladí viditeľnosť a prípadne načíta dáta (len pri zapnutom čipe a aktívnej scéne). */
  async function sync() {
    if (_destroyed) return;
    const wanted = _enabled && _active;
    const shown = wanted && _visible;
    ds.show = shown;
    ds.credit = shown && _incidents.length ? new Cesium.Credit(translate('mideast.ukmto.credit'), true) : undefined;
    if (!shown) tip.hidden = true;
    if (wanted) installHandler();
    requestRender();
    emit();
    if (wanted) {
      await load();
      if (!_destroyed) {
        ds.show = _enabled && _active && _visible;
        ds.credit = ds.show && _incidents.length ? new Cesium.Credit(translate('mideast.ukmto.credit'), true) : undefined;
        requestRender();
      }
    }
  }

  function getState() {
    return {
      enabled: _enabled,
      active: _active,
      visible: _visible,
      loading: _loading,
      error: _error,
      fetchedAt: _payload?.fetchedAt ?? null,
      archived: _payload?.archived ?? null,
      days,
      attribution: _payload?.attribution || null,
      licenseUrl: _payload?.licenseUrl || null,
      source: _payload?.source || null,
      loaded: Boolean(_payload),
      incidents: _incidents,
      summary: ukmtoSummary(_incidents, { nowMs: now(), days: 30, latest: 5 }),
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
    id: UKMTO_LAYER_ID,
    /** Čip v paneli (predvolene zapnuté). */
    setEnabled(on) { _enabled = Boolean(on); return sync(); },
    isEnabled: () => _enabled,
    /** Aktívna scéna v oblasti UKMTO (dejisko Blízkeho východu alebo úžina Hormuz/Báb al-Mandab/Suez). */
    setActive(on) { _active = Boolean(on); return sync(); },
    /** Brána priblíženia. */
    show() { _visible = true; return sync(); },
    hide() { _visible = false; return sync(); },
    getState,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy,
    labels: { type: typeLabel, place: placeLabel, vessel: vesselLabel, when: whenLabel },
    _getStateForTest: () => ({ ds, tip, tipText }),
  };
}
