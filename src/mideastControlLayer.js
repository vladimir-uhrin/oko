// src/mideastControlLayer.js
//
// KONTROLA SÍDIEL modulu BLÍZKY VÝCHOD — správca vrstiev (etapa 2, 2026-09-26; plán
// docs/drafts/blizky-vychod-plan.md kap. 5–6). Drží JEDNU parametrizovanú vrstvu
// `createUkraineControlLayer({ config, … })` na modul Wikipédie (israel-palestine, yemen,
// syria, lebanon — konfigurácie v src/data/wikiControl.js), vytváranú lenivo až pri prvom
// dejisku, ktoré modul potrebuje. Dejisko (`scene.control` z mideastTheatres.js) hovorí,
// ktoré moduly sa kreslia; raster zón každého sa počíta len v rámci dejiska (+0,2°),
// nie nad celým modulom (Sýria má 7 700 bodov) a KRESLÍ ho len prvý modul dejiska (juh
// Libanonu: IP + Lebanese insurgency by nad tými istými dedinami skladali dva priesvitné
// rastre do tretej farby; body oboch ostávajú). Čip v paneli = `enabled`; brána priblíženia
// (main.js revealGate.onChange) alebo scéna schovajú vrstvy cez hide()/show() bez zmeny čipu.
// Deň snímky (setDay) si správca pamätá po vrstvách — skrytá vrstva si ho dotiahne pri show().
//
// Poctivosť: každý modul nesie vlastnú legendu (tá istá modrá bodka je Izrael pri Gaze
// a kmeňové sily v Jemene), vlastnú revíziu a vlastný prah zastarania — panel to
// vypisuje po moduloch, nikdy zlúčene. Zóny sú odvodené z bodov sídiel, nie línia
// frontu. Etická čiara: sídla a objekty, nikdy jednotky.
//
// main.js volá: setTheatre(scene) pri dejisku, setTheatre(null) pri odchode, setStyle(mode)
// pri zmene podkladu, show()/hide() z brány priblíženia; panel dostáva správcu ako `control`.

import { currentLanguage, t } from './i18n.js';
import { MIDEAST_CONTROL_MODULE_IDS, UKRAINE_CONTROL_CONFIG, wikiControlModuleById } from './data/wikiControl.js';
import { createMideastControlStore, fetchMideastControl } from './data/mideastControlClient.js';
import { CONTROL_STYLES, createUkraineControlLayer } from './ukraineControlLayer.js';

export const MIDEAST_CONTROL_ID = 'mideast-control';
/** Okraj rámca dejiska pre raster zón (stupne) — pás bojov na hrane dejiska sa neodsekne. */
export const THEATRE_RASTER_PAD_DEG = 0.2;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const INERT = Object.freeze({
  id: MIDEAST_CONTROL_ID,
  setTheatre: async () => {}, setEnabled: async () => {}, isEnabled: () => false, show: async () => false, hide() {}, isShown: () => false,
  setStyle() {}, setDay: async () => {},
  getState: () => ({ enabled: false, visible: false, theatreId: null, day: null, style: 'default', modules: [] }),
  onChange() { return () => {}; }, destroy() {},
});

/** Rámec rastra pre dejisko: `rectDegrees` [W,S,E,N] s okrajom, orezaný na ±90° šírky; bez dejiska null. Pure. */
export function theatreRasterBbox(scene, padDeg = THEATRE_RASTER_PAD_DEG) {
  const r = scene?.rectDegrees;
  if (!Array.isArray(r) || r.length !== 4 || !r.every(Number.isFinite)) return null;
  const pad = Number.isFinite(padDeg) ? Math.max(0, padDeg) : 0;
  return { west: r[0] - pad, south: Math.max(-90, r[1] - pad), east: r[2] + pad, north: Math.min(90, r[3] + pad) };
}

/** Známe moduly Blízkeho východu, ktoré dejisko žiada (`scene.control`), bez duplicít a neznámych id. Pure. */
export function theatreControlModules(scene) {
  const ids = Array.isArray(scene?.control) ? scene.control : [];
  return ids.filter((id, i) => typeof id === 'string' && ids.indexOf(id) === i && MIDEAST_CONTROL_MODULE_IDS.includes(id));
}

/**
 * @param {object} o
 * @param {import('cesium').Viewer|null} o.viewer bez viewera inertný objekt s plným API
 * @param {Function} [o.translate]
 * @param {string} [o.lang]
 * @param {Document|null} [o.documentRef]
 * @param {typeof fetchMideastControl} [o.fetchControl] (moduleId, day) → snímka
 * @param {() => number} [o.now]
 * @param {Function} [o.terrainSampler] výšky bodov (predvolene vrstva sama)
 * @param {typeof createUkraineControlLayer} [o.createLayer] továreň vrstvy (testy)
 * @param {number} [o.padDeg] okraj rámca dejiska
 */
export function createMideastControl({
  viewer,
  translate = t,
  lang = currentLanguage(),
  documentRef = null,
  fetchControl = fetchMideastControl,
  now = () => Date.now(),
  terrainSampler = null,
  createLayer = createUkraineControlLayer,
  padDeg = THEATRE_RASTER_PAD_DEG,
} = {}) {
  const doc = documentRef || viewer?.container?.ownerDocument;
  if (!viewer?.scene || !doc?.createElement) return INERT;

  const store = createMideastControlStore({ fetchControl, now });
  const layers = new Map(); // id modulu → vrstva
  const layerDay = new Map(); // id modulu → deň (YYYY-MM-DD | null = dnes), pre ktorý správca vrstvu naposledy plnil
  const unsubs = new Map();
  const listeners = new Set();
  let _enabled = true; // čip v paneli
  let _visible = true; // show()/hide() zvonka (brána priblíženia, iná scéna) — čip sa nemení
  let _theatre = null;
  let _day = null; // null = dnes
  let _style = 'default';
  let _destroyed = false;

  const emit = () => { if (_destroyed) return; const s = getState(); for (const fn of listeners) { try { fn(s); } catch { /* */ } } };
  const activeIds = () => theatreControlModules(_theatre);

  function layerFor(id) {
    let layer = layers.get(id);
    if (layer) return layer;
    const config = wikiControlModuleById(id);
    if (!config || config === UKRAINE_CONTROL_CONFIG) return null;
    layer = createLayer({
      viewer, translate, lang, documentRef: doc, now, config,
      layerId: `${MIDEAST_CONTROL_ID}:${id}`,
      pickKey: `mideastControl:${id}`,
      i18nPrefix: config.i18nPrefix,
      staleDays: config.staleDays,
      rasterBbox: theatreRasterBbox(_theatre, padDeg),
      fetchControl: (day) => store.control(id, day || new Date(now()).toISOString().slice(0, 10)),
      ...(typeof terrainSampler === 'function' ? { terrainSampler } : {}),
    });
    if (_style !== 'default') layer.setStyle(_style);
    unsubs.set(id, layer.onChange(() => emit()));
    layers.set(id, layer);
    return layer;
  }

  /**
   * Ukáž vrstvy žiadaných modulov, schovaj ostatné; vráti sľub prvého načítania.
   * Raster zón kreslí LEN prvý modul v poradí dejiska (`scene.control`), body všetkých ostávajú.
   * Vrstva si snímku ťahá sama len, keď žiadnu nemá (show) — snímku pre INÝ deň, než správca
   * žiada (setDay počas skrytia), natiahne správca znova, inak by legenda a mapa nesúhlasili.
   */
  function sync() {
    if (_destroyed) return Promise.resolve();
    const ids = _enabled && _visible ? activeIds() : [];
    const wanted = new Set(ids);
    for (const [id, layer] of layers) if (!wanted.has(id) && layer.isShown()) layer.hide();
    const tasks = [];
    ids.forEach((id, i) => {
      const layer = layerFor(id);
      if (!layer) return;
      const zones = i === 0;
      if (layer.getState().zonesVisible !== zones) layer.setZonesVisible(zones);
      // Deň sa vrstve zapíše až po ÚSPEŠNOM načítaní (oponentúra 2026-09-26): keď
      // snímka pre nový deň chýba (404), vrstva ostane na starej a ďalší sync/show
      // to skúsi znova namiesto toho, aby tvrdil, že už má nový deň.
      const target = _day;
      const st0 = layer.getState();
      const reload = layerDay.get(id) !== target && (Boolean(st0.revisionAt) || Boolean(st0.error));
      const mark = () => { const st = layer.getState(); if (!st.error && st.revisionAt) layerDay.set(id, target); };
      if (layer.isShown()) { if (reload) tasks.push(Promise.resolve(layer.loadLatest(target)).then(mark).catch(() => undefined)); else mark(); return; }
      tasks.push(Promise.resolve(layer.show({ day: target })).then(() => (reload ? layer.loadLatest(target) : undefined)).then(mark).catch(() => false));
    });
    return Promise.all(tasks).then(() => undefined);
  }

  // ── verejné API ──────────────────────────────────────────────────────────
  /** Dejisko (`{ id, rectDegrees, control }`) alebo null; prepne moduly a rámec rastra. */
  function setTheatre(scene) {
    if (_destroyed) return Promise.resolve();
    _theatre = scene && typeof scene === 'object' ? scene : null;
    const bbox = theatreRasterBbox(_theatre, padDeg);
    for (const id of activeIds()) layers.get(id)?.setRasterBbox(bbox);
    const done = sync();
    emit();
    return done;
  }
  function setEnabled(on) {
    if (_destroyed) return Promise.resolve();
    _enabled = Boolean(on);
    const done = sync();
    emit();
    return done;
  }
  function show() {
    if (_destroyed) return Promise.resolve(false);
    _visible = true;
    const done = sync();
    emit();
    return done.then(() => isShown());
  }
  function hide() {
    if (_destroyed) return;
    _visible = false;
    void sync();
    emit();
  }
  const isShown = () => [...layers.values()].some((layer) => layer.isShown());
  /** Štýl 'default' | 'karta' pre všetky vrstvy (aj budúce). */
  function setStyle(mode) {
    const next = CONTROL_STYLES[mode] ? mode : 'default';
    if (next === _style) return;
    _style = next;
    for (const layer of layers.values()) layer.setStyle(next);
    emit();
  }
  /**
   * Deň snímky (YYYY-MM-DD) alebo null = dnes; zobrazené vrstvy si natiahnu snímku pre deň hneď,
   * skryté pri najbližšom show() (sync porovná deň, pre ktorý boli naplnené, so žiadaným).
   */
  function setDay(day) {
    if (_destroyed) return Promise.resolve();
    _day = DAY_RE.test(String(day || '')) ? String(day) : null;
    const tasks = [];
    for (const [id, layer] of layers) {
      if (!layer.isShown()) continue;
      const target = _day;
      tasks.push(Promise.resolve(layer.loadLatest(target)).then(() => {
        const st = layer.getState();
        if (!st.error && st.revisionAt) layerDay.set(id, target); // len po úspechu
      }).catch(() => undefined));
    }
    emit();
    return Promise.all(tasks).then(() => undefined);
  }
  function getState() {
    return {
      enabled: _enabled, visible: _visible, theatreId: _theatre?.id ?? null, day: _day, style: _style,
      modules: activeIds().map((id) => {
        const st = layers.get(id)?.getState() || null;
        return {
          id, shown: Boolean(st?.shown), loading: Boolean(st?.loading), error: st?.error ?? null,
          revisionAt: st?.revisionAt ?? null, requestedAt: st?.requestedAt ?? null, ageDays: st?.ageDays ?? null, stale: Boolean(st?.stale),
          summary: st?.summary ?? null, count: st?.points ?? 0,
        };
      }),
    };
  }
  function destroy() {
    _destroyed = true;
    for (const [id, layer] of layers) { try { unsubs.get(id)?.(); layer.destroy(); } catch { /* */ } }
    layers.clear(); layerDay.clear(); unsubs.clear(); listeners.clear(); store.clear();
  }
  return {
    id: MIDEAST_CONTROL_ID,
    setTheatre, setEnabled, isEnabled: () => _enabled, show, hide, isShown,
    setStyle, getStyle: () => _style, setDay, getState,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy,
    _getStateForTest: () => ({ layers, store }),
  };
}
