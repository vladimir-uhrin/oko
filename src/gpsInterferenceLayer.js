// src/gpsInterferenceLayer.js
//
// RUŠENIE GPS (odvodené) modulu BLÍZKY VÝCHOD (etapa 5d, 2026-10-03): bunky 0,5° vyfarbené
// podľa podielu lietadiel, ktoré v nich hlásili zhoršenú presnosť polohy (NACp/NIC z ADS-B).
// Dáta zbiera server z adsb.lol (src/data/gpsInterference.js + scripts/lib/mideastArchive.mjs,
// trasa `/api/mideast/events/gps`), vrstva ich len kreslí: červená = nad 10 %, jantárová =
// 2–10 %, slabá zelená = pod 2 % (lietadlá lietajú a presnosť hlásia dobrú), bez farby = málo
// lietadiel alebo žiadne dáta.
//
// Poctivosť: ODVODENÝ ukazovateľ z toho, čo vysielajú lietadlá — nie meranie rušičiek. Kde
// nelietajú lietadlá, nie sú dáta; spoofing sa takto neodhalí. Hover hovorí počty a obdobie.
// Vrstva je predvolene vypnutá a sťahuje až po zapnutí čipu; nie je viazaná na dejisko.

import * as Cesium from 'cesium';
import { GPS_COLORS, GPS_DAYS_DEFAULT, fetchGpsInterference, gpsCellBounds } from './data/gpsInterference.js';
import { currentLanguage, t } from './i18n.js';

export const GPS_LAYER_ID = 'gps-interference';
export const GPS_FILL_ALPHA = Object.freeze({ high: 0.42, medium: 0.34, none: 0.07 });
/** Načítané dáta sa obnovia pri ďalšom zapnutí, ak sú staršie (server zbiera raz za 15 min). */
export const GPS_RELOAD_MS = 10 * 60_000;
const HOVER_MS = 90;

const INERT = {
  id: GPS_LAYER_ID, setEnabled: async () => false, isEnabled: () => false,
  getState: () => ({ enabled: false, loading: false, error: null, loaded: false, days: [], snapshots: 0, aircraft: 0, counts: { high: 0, medium: 0, none: 0, thin: 0 }, todayPartial: false }),
  onChange() { return () => {}; }, destroy() {},
};

/** Riadky tela servera `[latIdx, lonIdx, total, bad, badAdjusted, level]` → bunky na kreslenie (bez 'thin'). Pure. */
export function gpsDrawCells(payload) {
  const out = [];
  for (const row of Array.isArray(payload?.cells) ? payload.cells : []) {
    const [latIdx, lonIdx, total, bad, badAdjusted, level] = row;
    if (!Number.isInteger(latIdx) || !Number.isInteger(lonIdx) || !GPS_COLORS[level]) continue;
    const [west, south, east, north] = gpsCellBounds(latIdx, lonIdx);
    if (south < -90 || north > 90 || west < -180 || east > 180) continue;
    out.push({ key: `${latIdx}:${lonIdx}`, west, south, east, north, total, bad, badAdjusted, level, ratio: total > 0 ? Math.max(0, badAdjusted) / total : 0 });
  }
  return out;
}

/**
 * @param {object} o
 * @param {import('cesium').Viewer} o.viewer
 * @param {typeof fetchGpsInterference} [o.fetchImpl]
 */
export function createGpsInterference({
  viewer,
  fetchImpl = fetchGpsInterference,
  translate = t,
  lang = currentLanguage(),
  now = () => Date.now(),
  days = GPS_DAYS_DEFAULT,
  documentRef = null,
} = {}) {
  const doc = documentRef || viewer?.container?.ownerDocument;
  const scene = viewer?.scene;
  if (!scene || !doc?.createElement) return INERT;

  const ds = new Cesium.CustomDataSource(GPS_LAYER_ID);
  viewer.dataSources.add(ds);
  ds.show = false;
  const tip = doc.createElement('div');
  tip.className = 'oko-ukr-ctl-tip oko-gps-tip';
  tip.hidden = true;
  viewer.container.appendChild(tip);
  const locale = lang === 'sk' ? 'sk-SK' : 'en-GB';
  const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const dateFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const fmtDay = (iso) => { const ms = Date.parse(`${iso}T00:00:00Z`); return Number.isFinite(ms) ? dateFormat.format(new Date(ms)) : String(iso || ''); };
  const requestRender = () => { try { scene.requestRender?.(); } catch { /* */ } };

  let _enabled = false;
  let _payload = null;
  let _cells = [];
  let _loadedAt = 0;
  let _loading = false;
  let _error = null;
  let _drawn = false;
  let _destroyed = false;
  let handler = null;
  let hoverTimer = null;
  const listeners = new Set();
  const emit = () => { const s = getState(); for (const fn of listeners) { try { fn(s); } catch { /* */ } } };

  /** „3. 10. 2026" alebo „2. 10. 2026 – 3. 10. 2026" podľa dní v odpovedi. */
  function periodText() {
    const list = Array.isArray(_payload?.days) ? _payload.days : [];
    if (!list.length) return '';
    return list.length === 1 ? fmtDay(list[0]) : `${fmtDay(list[0])} – ${fmtDay(list.at(-1))}`;
  }

  function draw() {
    ds.entities.removeAll();
    _drawn = false;
    if (!_enabled || !_payload) return;
    ds.entities.suspendEvents();
    try {
      for (const cell of _cells) {
        ds.entities.add({
          rectangle: {
            coordinates: Cesium.Rectangle.fromDegrees(cell.west, cell.south, cell.east, cell.north),
            material: Cesium.Color.fromCssColorString(GPS_COLORS[cell.level]).withAlpha(GPS_FILL_ALPHA[cell.level]),
            classificationType: Cesium.ClassificationType.BOTH,
          },
          properties: { gpsCell: cell.key },
        });
      }
    } finally { ds.entities.resumeEvents(); }
    _drawn = true;
    ds.credit = new Cesium.Credit(translate('mideast.gps.credit'), true);
    requestRender();
  }

  /** Text bubliny nad bunkou: počty, podiel, obdobie, zdroj. */
  function tipText(key) {
    const cell = _cells.find((c) => c.key === key);
    if (!cell) return '';
    return [
      translate('mideast.gps.tip'),
      translate('mideast.gps.tip-cell', { s: numberFormat.format(cell.south), n: numberFormat.format(cell.north), w: numberFormat.format(cell.west), e: numberFormat.format(cell.east) }),
      translate('mideast.gps.tip-count', { total: numberFormat.format(cell.total), bad: numberFormat.format(cell.bad) }),
      translate('mideast.gps.tip-share', { pct: numberFormat.format(Math.round(cell.ratio * 1000) / 10) }),
      periodText(),
      translate('mideast.gps.tip-source'),
    ].filter(Boolean).join(' · ');
  }
  function installHandler() {
    if (handler || !scene.canvas) return;
    handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
    handler.setInputAction((e) => {
      if (!_enabled || hoverTimer) return;
      const pos = Cesium.Cartesian2.clone(e.endPosition);
      hoverTimer = setTimeout(() => {
        hoverTimer = null;
        let key = null;
        try { key = scene.pick(pos, 4, 4)?.id?.properties?.gpsCell?.getValue?.() ?? null; } catch { key = null; }
        const text = key ? tipText(key) : '';
        if (text) {
          const cell = _cells.find((c) => c.key === key);
          tip.textContent = text;
          tip.style.setProperty('--ukr-accent', GPS_COLORS[cell?.level] || GPS_COLORS.medium);
          tip.style.transform = `translate(${Math.round(pos.x + 14)}px, ${Math.round(pos.y + 14)}px)`;
          tip.hidden = false;
        } else tip.hidden = true;
      }, HOVER_MS);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  }

  async function load() {
    if (_loading) return;
    if (_payload && now() - _loadedAt < GPS_RELOAD_MS) return;
    _loading = true; _error = null; emit();
    try {
      const payload = await fetchImpl({ days });
      if (_destroyed) return;
      _payload = payload;
      _cells = gpsDrawCells(payload);
      _loadedAt = now();
      if (_enabled) draw();
    } catch (error) {
      // Staré bunky (ak sú) ostávajú nakreslené; legenda ukáže chybu.
      _error = error?.status === 404 ? 'no_gps_snapshot' : (error?.message || String(error));
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
      loaded: Boolean(_payload),
      days: Array.isArray(_payload?.days) ? _payload.days : [],
      period: periodText(),
      snapshots: Number(_payload?.snapshots) || 0,
      aircraft: Number(_payload?.aircraft) || 0,
      counts: _payload?.counts || { high: 0, medium: 0, none: 0, thin: 0 },
      todayPartial: Boolean(_payload?.todayPartial),
      attribution: _payload?.attribution || null,
      drawn: _cells.length,
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
    id: GPS_LAYER_ID,
    setEnabled,
    isEnabled: () => _enabled,
    getState,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy,
    _getStateForTest: () => ({ ds, tip, tipText, cells: () => _cells }),
  };
}
