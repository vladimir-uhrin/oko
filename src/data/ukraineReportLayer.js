// src/data/ukraineReportLayer.js
/**
 * @module ukraineReportLayer
 * @description „Strety" na mape (modul UKRAJINA, etapa 2, 2026-09-19): značka
 * skrížených mečov + počet útokov za deň pri každom smere frontu, z denného
 * hlásenia Generálneho štábu ZSU (ArmyInform, CC BY 4.0) cez
 * `/api/ukraine/report`. Kotva = stred presetu smeru (sídlo), nikdy jednotky.
 * Samostatný prekryv ako podklad (tokeny odkazu sú plné); zapína ho panel
 * UKRAJINA (čip STRETY) a ukazuje sa spolu s podkladom.
 *
 * Karta pri prechode myšou: smer, počet útokov, čas hlásenia, odsek hlásenia
 * v origináli (ukrajinsky) a strojový preklad na požiadanie (MyMemory cez
 * /api/translate, `from=uk`), vždy so štítkom „jednostranné oficiálne hlásenie".
 */
import * as Cesium from 'cesium';
import { currentLanguage, t as translateDefault } from '../i18n.js';
import { translateText as translateTextDefault } from '../translate.js';
import { frontSceneByGsDirection, frontSceneLabel, listFrontScenes } from '../ukraineFrontScenes.js';
import { createLocalHoverCard } from './localHoverCard.js';
import { defaultTerrainSampler } from './ukraineBaseLayer.js';
import { fetchUkraineReport, reportByScene } from './ukraineReport.js';

export const UKRAINE_REPORT_ID = 'ukraine-report';
export const REPORT_REFRESH_MS = 30 * 60_000;
export const REPORT_HOVER_DELAY_MS = 80;
export const REPORT_HOVER_PICK_PX = 9;
/** Značky vidno až po tejto vzdialenosti kamery (m) — aj z pohľadu na celý front. */
export const REPORT_FAR_M = 3_600_000;
const FONT = '"IBM Plex Mono", monospace';

/** Skrížené meče, jednofarebné (svetlé s tmavým obrysom), ako data URI. */
export const REPORT_MARKER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">'
  + '<g fill="none" stroke="#0b1622" stroke-width="4.2" stroke-linecap="round"><path d="M4 4l14 14M18 4L4 18"/><path d="M3 8l5-5M14 3l5 5M3 14l5 5M14 19l5-5"/></g>'
  + '<g fill="none" stroke="#f1f5f8" stroke-width="2" stroke-linecap="round"><path d="M4 4l14 14M18 4L4 18"/><path d="M3 8l5-5M14 3l5 5M3 14l5 5M14 19l5-5" stroke-width="1.4"/></g></svg>';
export const REPORT_MARKER_URI = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(REPORT_MARKER_SVG)}`;

/**
 * Farba počtu podľa intenzity: neuvedené = tlmená, 0 = sivá, 1–9 = svetlá,
 * 10–24 = jantárová, 25+ = červená. Pure.
 * @param {number|null} attacks
 */
export function reportIntensityColor(attacks) {
  if (attacks === null || attacks === undefined) return '#8a97a3';
  const n = Number(attacks);
  if (n <= 0) return '#8aa0b6';
  if (n < 10) return '#e6eef4';
  if (n < 25) return '#ffb547';
  return '#f87171';
}

/** Text značky: číslo, „0", alebo „—" keď hlásenie počet neuvádza. Pure. */
export function reportMarkerText(attacks) {
  if (attacks === null || attacks === undefined) return '—';
  return String(Math.max(0, Math.round(Number(attacks))));
}

/**
 * @param {object} o
 * @param {object} o.viewer
 * @param {Function} [o.fetchImpl] fetchUkraineReport
 * @param {ReadonlyArray} [o.scenes]
 * @param {Function} [o.translate]
 * @param {() => string} [o.lang]
 * @param {Function} [o.translateText]
 * @param {(id: string) => object} [o.dataSourceFactory]
 * @param {(canvas: object) => object} [o.handlerFactory]
 * @param {(o: object) => object} [o.hoverFactory]
 * @param {Function} [o.setTimer]
 * @param {Function} [o.clearTimer]
 * @param {() => number} [o.now]
 */
export function createUkraineReportLayer({
  viewer,
  fetchImpl = fetchUkraineReport,
  scenes = listFrontScenes(),
  translate = translateDefault,
  lang = () => currentLanguage(),
  translateText = translateTextDefault,
  dataSourceFactory = (id) => new Cesium.CustomDataSource(id),
  handlerFactory = (canvas) => new Cesium.ScreenSpaceEventHandler(canvas),
  hoverFactory = (o) => createLocalHoverCard(o),
  terrainSampler = defaultTerrainSampler,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  now = () => Date.now(),
} = {}) {
  const inert = {
    id: UKRAINE_REPORT_ID, show: async () => false, hide() {}, setEnabled() {}, isEnabled: () => true, isShown: () => false,
    refresh: async () => null, getState: () => ({ shown: false, enabled: true, loading: false, error: 'no-viewer', report: null, byScene: {}, fetchedAt: null }),
    onChange: () => () => {}, destroy() {},
  };
  if (!viewer?.dataSources) return inert;
  const scene = viewer.scene || null;
  const camera = viewer.camera || null;
  const ds = dataSourceFactory(UKRAINE_REPORT_ID);
  ds.show = false;
  try { viewer.dataSources.add(ds); } catch { /* headless */ }

  let _shown = false;
  let _enabled = true;
  let _loading = null;
  let _error = null;
  let _report = null;
  let _byScene = new Map();
  let _fetchedAt = 0;
  const _records = new Map(); // sceneId → { entity, scene, entry }
  const _byEntityId = new Map();
  const _listeners = new Set();
  let _handler = null;
  let _hover = null;
  let _hoverTimer = null;
  let _pointer = null;
  let _canvasLeave = null;
  let _destroyed = false;
  const _translations = new Map(); // text → translated

  const requestRender = () => { try { scene?.requestRender?.(); } catch { /* headless */ } };
  function emit() {
    const state = getState();
    for (const fn of _listeners) { try { fn(state); } catch (error) { console.warn('[UkraineReport] listener error:', error); } }
  }
  function applyVisibility() {
    ds.show = _shown && _enabled;
    if (!ds.show) _hover?.hide?.();
    requestRender();
  }

  function draw() {
    for (const record of _records.values()) { try { ds.entities.remove(record.entity); } catch { /* */ } }
    _records.clear();
    _byEntityId.clear();
    if (!_report) return;
    for (const sc of scenes) {
      const entry = _byScene.get(sc.id);
      if (!entry || !sc.center) continue;
      const color = Cesium.Color.fromCssColorString(reportIntensityColor(entry.attacks));
      const entityId = `${UKRAINE_REPORT_ID}:${sc.id}`;
      // Bez CLAMP_TO_GROUND (pri streamovaní dlaždíc drahé — viď ukraineBaseLayer):
      // výška sa zistí raz z resolvera terénu nižšie.
      const entity = ds.entities.add({
        id: entityId,
        position: Cesium.Cartesian3.fromDegrees(sc.center.lon, sc.center.lat),
        billboard: {
          image: REPORT_MARKER_URI,
          width: 22,
          height: 22,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, REPORT_FAR_M),
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
        },
        label: {
          text: reportMarkerText(entry.attacks),
          font: `700 13px ${FONT}`,
          fillColor: color,
          outlineColor: Cesium.Color.fromCssColorString('#0b1622').withAlpha(0.9),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#0b1622').withAlpha(0.72),
          backgroundPadding: new Cesium.Cartesian2(5, 3),
          pixelOffset: new Cesium.Cartesian2(16, 0),
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, REPORT_FAR_M),
        },
      });
      const record = { entity, scene: sc, entry, lon: sc.center.lon, lat: sc.center.lat, lifted: false };
      _records.set(sc.id, record);
      _byEntityId.set(entityId, record);
    }
    requestRender();
    void liftMarkers();
  }

  /** Jednorazový zdvih značiek na výšku terénu (11 bodov, jedna dávka, cache resolvera). */
  async function liftMarkers() {
    const pending = [..._records.values()].filter((r) => !r.lifted);
    if (!pending.length || typeof terrainSampler !== 'function') return;
    let heights;
    try { heights = await terrainSampler(pending.map((r) => [r.lon, r.lat])); } catch { heights = null; }
    if (_destroyed || !Array.isArray(heights)) return;
    let lifted = 0;
    pending.forEach((r, i) => {
      if (!Number.isFinite(heights[i])) return;
      try { r.entity.position = Cesium.Cartesian3.fromDegrees(r.lon, r.lat, heights[i]); r.lifted = true; lifted += 1; } catch { /* entita už preč */ }
    });
    if (lifted) requestRender();
  }

  function load({ force = false } = {}) {
    if (_loading) return _loading;
    if (!force && _report && now() - _fetchedAt < REPORT_REFRESH_MS) return Promise.resolve(_report);
    _loading = Promise.resolve(fetchImpl())
      .then((report) => {
        if (_destroyed) return null;
        _report = report && typeof report === 'object' ? report : null;
        _byScene = reportByScene(_report, frontSceneByGsDirection);
        _fetchedAt = now();
        _error = _report ? null : 'empty';
        draw();
        return _report;
      })
      .catch((error) => {
        _error = error?.message || String(error);
        console.warn('[UkraineReport] load failed:', _error);
        return _report;
      })
      .finally(() => { _loading = null; emit(); });
    emit();
    return _loading;
  }

  // ── Karta pri prechode myšou ──────────────────────────────────────────────
  function hoverModelFor(record, translated = null) {
    const { entry, scene: sc } = record;
    const language = lang();
    const attacksText = entry.attacks === null
      ? translate('ukraine.report.unknown')
      : (entry.attacks === 0 ? translate('ukraine.report.none') : translate('ukraine.report.attacks', { n: entry.attacks }));
    const details = [attacksText];
    if (_report?.reportedAtText) details.push(`${translate('ukraine.report.summary', { total: _report.total ?? '?', time: _report.reportedAtText })}`);
    const text = entry.texts.join(' ');
    if (translated && translated !== text) {
      details.push(translated);
      details.push(`${translate('ukraine.report.translated')} · ${translate('ukraine.report.original')}: ${text}`);
    } else if (text) {
      details.push(text);
      if (language !== 'uk') details.push(translate('ukraine.report.original'));
    }
    details.push(translate('ukraine.report.claim'));
    return {
      layerId: 'ukraine-report',
      kindText: translate('ukraine.report.kind'),
      title: frontSceneLabel(sc, translate),
      details,
      source: translate('ukraine.report.source'),
    };
  }

  function pickRecord(position) {
    if (!scene?.pick) return null;
    let picked = null;
    try { picked = scene.pick(position, REPORT_HOVER_PICK_PX, REPORT_HOVER_PICK_PX); } catch { picked = null; }
    const entity = picked?.id;
    const entityId = typeof entity === 'string' ? entity : entity?.id;
    return entityId ? (_byEntityId.get(entityId) || null) : null;
  }

  function showCard(record, at) {
    const key = record.entity.id;
    const text = record.entry.texts.join(' ');
    const cached = _translations.get(text) || null;
    _hover.show(hoverModelFor(record, cached), at, key);
    const language = lang();
    if (!cached && text && language !== 'uk' && typeof translateText === 'function') {
      Promise.resolve(translateText(text, language, { from: 'uk' })).then((out) => {
        if (_destroyed || !out || out === text) return;
        _translations.set(text, out);
        if (_hover?.current?.() === key && _pointer) {
          // Rovnaká identita = len presun; preto skryť a ukázať znova s prekladom.
          _hover.hide();
          _hover.show(hoverModelFor(record, out), { x: _pointer.x, y: _pointer.y }, key);
        }
      }).catch(() => {});
    }
  }

  function runHover() {
    _hoverTimer = null;
    if (!ds.show || !_pointer || !_hover) return;
    if (_hover.isHovered?.()) return;
    const record = pickRecord(_pointer.cartesian);
    if (!record) { if (_hover.current?.()?.startsWith?.(`${UKRAINE_REPORT_ID}:`)) _hover.hide(); return; }
    showCard(record, { x: _pointer.x, y: _pointer.y });
  }

  function installHover() {
    if (_handler || !scene?.canvas) return;
    try {
      _hover = hoverFactory({ translate: (key, vars) => (key === 'local.hover-hint' ? translate('ukraine.report.linkout') : translate(key, vars)) });
      _handler = handlerFactory(scene.canvas);
      _handler.setInputAction((movement) => {
        const end = movement?.endPosition;
        if (!end) return;
        _pointer = { cartesian: end, x: end.x, y: end.y };
        if (_hoverTimer) clearTimer(_hoverTimer);
        _hoverTimer = setTimer(runHover, REPORT_HOVER_DELAY_MS);
      }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
      _handler.setInputAction((click) => {
        if (!ds.show || !click?.position) return;
        const record = pickRecord(click.position);
        if (!record || !_report?.url) return;
        try { globalThis.open?.(_report.url, '_blank', 'noopener'); } catch { /* */ }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      if (scene.canvas.addEventListener) {
        _canvasLeave = () => { _pointer = null; if (!_hover?.isHovered?.() && _hover?.current?.()?.startsWith?.(`${UKRAINE_REPORT_ID}:`)) _hover.hide(); };
        scene.canvas.addEventListener('pointerleave', _canvasLeave);
      }
    } catch (error) {
      console.warn('[UkraineReport] hover unavailable:', error?.message || error);
    }
  }

  // ── Verejné API ───────────────────────────────────────────────────────────
  async function show() {
    if (_destroyed) return false;
    _shown = true;
    applyVisibility();
    installHover();
    const report = await load();
    if (_destroyed) return false;
    applyVisibility();
    return Boolean(report);
  }
  function hide() {
    _shown = false;
    applyVisibility();
    emit();
  }
  function setEnabled(on) {
    _enabled = Boolean(on);
    applyVisibility();
    emit();
  }
  function getState() {
    const byScene = {};
    for (const [id, entry] of _byScene) byScene[id] = { attacks: entry.attacks, unknown: entry.unknown, gs: [...entry.gs] };
    return { shown: _shown, enabled: _enabled, loading: Boolean(_loading), error: _error, report: _report, byScene, fetchedAt: _fetchedAt || null };
  }
  function destroy() {
    _destroyed = true;
    hide();
    if (_hoverTimer) clearTimer(_hoverTimer);
    if (_handler) { try { _handler.destroy(); } catch { /* */ } _handler = null; }
    if (_canvasLeave && scene?.canvas?.removeEventListener) scene.canvas.removeEventListener('pointerleave', _canvasLeave);
    _hover?.destroy?.();
    try { viewer.dataSources.remove(ds, true); } catch { /* */ }
    _records.clear();
    _byEntityId.clear();
    _listeners.clear();
  }

  return {
    id: UKRAINE_REPORT_ID,
    show,
    hide,
    setEnabled,
    isEnabled: () => _enabled,
    isShown: () => _shown,
    refresh: () => load({ force: true }),
    getState,
    onChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn); },
    destroy,
    _getStateForTest: () => ({ ds, records: _records, byEntityId: _byEntityId, hover: _hover, camera }),
  };
}
