// src/mideastAlertsLayer.js
//
// POPLACHY V IZRAELI modulu BLÍZKY VÝCHOD (etapa 6, 2026-11-06): oblasti Velenia domáceho
// frontu (HFC) ako polygóny, výplň = koľko poplachov (rakety + drony) oblasť mala za obdobie
// (posledný deň s poplachom / 7 d / 30 d / od 28. 2.), odtieň = prevládajúci druh. Dáta dodáva
// archív servera (`/api/mideast/events/alerts`, src/data/mideastAlerts.js + scripts/lib/
// mideastArchive.mjs) z verejného mirroru histórie s oneskorením hodín až dní.
//
// NIE JE TO VAROVNÝ SYSTÉM — vrstva ukazuje históriu, nikdy „živý alarm" (plán kap. 4 bod 8);
// legenda a karta to hovoria nahlas a nesú dátum dát mirroru.
//
// Kedy je vidieť: čip zapnutý (predvolene áno) A aktívne dejisko z ALERT_THEATRES (prehľad,
// Izrael, Gaza, Západný breh, južný Libanon) A brána priblíženia otvorená — ako OVERENÉ UDALOSTI.
// Obrysy (≈ 420 kB) sa sťahujú raz za reláciu až pri prvom takom dejisku. Obdobie bez voľby
// = prvé neprázdne z 7 d / 30 d / od 28. 2. (mirror mešká, prázdna mapa by klamala).
//
// Etická čiara: sídla a zóny, nie osoby; len kde znela siréna, žiadne dopady ani jednotky.

import * as Cesium from 'cesium';
import {
  ALERTS_MIRROR_SITE, ALERT_KINDS, ALERT_THEATRES, MIDEAST_ALERTS_FIRST_DAY, MIDEAST_ALERT_PERIODS, alarmsInRange, alertKindOf, alertLevel,
  alertPeriodRange, alertsSummary, dominantKind, fetchMideastAlertAreas, fetchMideastAlerts, lastAlarmDay,
} from './data/mideastAlerts.js';
import { currentLanguage, t } from './i18n.js';
import { createMapHoverTip } from './mapHoverTip.js';

export const MIDEAST_ALERTS_LAYER_ID = 'mideast-alerts';
/** Obnova otvorenej stránky pri aktívnom dejisku (archív servera sa obnovuje raz za 6 h). */
export const ALERTS_RELOAD_MS = 30 * 60_000;
export const ALERTS_OUTLINE_ALPHA = 0.55;
export const ALERTS_OUTLINE_WIDTH = 1.2;
const PICK_PX = 6;

const EMPTY_SUMMARY = Object.freeze({ totals: { r: 0, w: 0, d: 0 }, alarms: 0, areas: 0, top: [] });
const INERT = {
  id: MIDEAST_ALERTS_LAYER_ID, setEnabled() {}, isEnabled: () => false, setActive: async () => {}, setPeriod: async () => {}, show() {}, hide() {},
  getState: () => ({ enabled: false, active: false, visible: false, loading: false, error: null, loaded: false, period: null, periods: MIDEAST_ALERT_PERIODS, periodCounts: {}, lastDay: null, summary: EMPTY_SUMMARY, theatre: null }),
  onChange() { return () => {}; }, destroy() {}, labels: {},
};

/** Dejisko, pri ktorom má vrstva zmysel (pure). */
export const alertsTheatreActive = (scene) => Boolean(scene) && ALERT_THEATRES.includes(typeof scene === 'object' ? scene.id : scene);

/**
 * @param {object} o
 * @param {import('cesium').Viewer} o.viewer
 */
export function createMideastAlerts({
  viewer,
  fetchImpl = fetchMideastAlerts,
  fetchAreasImpl = fetchMideastAlertAreas,
  translate = t,
  lang = currentLanguage(),
  now = () => Date.now(),
  documentRef = null,
  setTimer = (fn, ms) => { const id = setInterval(fn, ms); id?.unref?.(); return id; },
  clearTimer = (id) => clearInterval(id),
  createHoverTip = createMapHoverTip,
  createClickHandler = (canvas) => new Cesium.ScreenSpaceEventHandler(canvas),
} = {}) {
  const doc = documentRef || viewer?.container?.ownerDocument;
  const scene = viewer?.scene;
  if (!scene || !doc?.createElement) return INERT;

  const ds = new Cesium.CustomDataSource(MIDEAST_ALERTS_LAYER_ID);
  viewer.dataSources.add(ds);
  ds.show = false;
  const numberFormat = new Intl.NumberFormat(lang === 'sk' ? 'sk-SK' : 'en-GB');
  const dateFormat = new Intl.DateTimeFormat(lang === 'sk' ? 'sk-SK' : 'en-GB', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const requestRender = () => { try { scene.requestRender?.(); } catch { /* */ } };
  const pickSlug = (pos) => scene.pick(new Cesium.Cartesian2(pos.x, pos.y), PICK_PX, PICK_PX)?.id?.properties?.areaSlug?.getValue?.() ?? null;

  let _enabled = true;
  let _active = false;
  let _theatre = null;
  let _visible = true;
  let _period = null; // null = automaticky prvé neprázdne obdobie
  let _areas = null; // { slug: { name, district, lat, lon, ring } }
  let _areasSource = null;
  let _all = null; // { at, json } — celé obdobie od 28. 2. (počty po dňoch + oblastiach)
  const _ranges = new Map(); // `${from}:${to}` -> { at, json }
  let _shown = null; // počty po oblastiach aktuálneho obdobia
  let _loading = false;
  let _error = null;
  let _destroyed = false;
  let _selected = null;
  let refreshTimer = null;
  let clickHandler = null;
  const entities = new Map(); // slug -> Entity
  const listeners = new Set();
  const emit = () => { const s = getState(); for (const fn of listeners) { try { fn(s); } catch { /* */ } } };

  const kindLabel = (id) => translate(`mideast.alerts.kind.${id}`);
  const periodLabel = (p) => translate(`mideast.alerts.period.${p}`);
  const countsText = (c) => ALERT_KINDS.map((k) => `${kindLabel(k.id)} ${numberFormat.format(Number(c?.[k.id]) || 0)}`).join(' · ');
  const areaLabel = (slug) => { const a = _areas?.[slug]; return a ? [a.name, a.district].filter(Boolean).join(' · ') : slug; };
  function tipText(slug) {
    const c = _shown?.[slug];
    if (!c) return '';
    return [areaLabel(slug), countsText(c), periodLabel(currentPeriod()), translate('mideast.alerts.tip.note')].filter(Boolean).join(' · ');
  }
  const hover = createHoverTip({
    viewer, doc, className: 'oko-mideast-alerts-tip', isActive: () => ds.show,
    resolve: (pos) => { const slug = pickSlug(pos); const c = slug ? _shown?.[slug] : null; return c ? { text: tipText(slug), accent: alertKindOf(dominantKind(c) || 'r')?.css } : null; },
  });

  // ── karta po kliknutí (mobil nemá hover) ─────────────────────────────────
  const card = doc.createElement('article');
  card.className = 'oko-mideast-inc-card oko-mideast-alerts-card';
  card.hidden = true;
  viewer.container?.appendChild?.(card);
  const el = (tag, className = '', text = null) => { const n = doc.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; };
  function closeCard() { _selected = null; card.hidden = true; card.replaceChildren?.(); }
  /** Model karty (testovateľný bez DOM). */
  function cardModel(slug) {
    const a = _areas?.[slug]; const c = _shown?.[slug];
    if (!a || !c) return null;
    const kind = dominantKind(c) || 'r';
    return {
      slug, name: a.name, district: a.district || '', colour: alertKindOf(kind).css,
      rows: ALERT_KINDS.map((k) => ({ id: k.id, label: kindLabel(k.id), value: Number(c[k.id]) || 0 })),
      period: periodLabel(currentPeriod()), range: currentRange(),
      dataUpdated: _all?.json?.dataUpdated ? dateFormat.format(new Date(_all.json.dataUpdated)) : null,
      note: translate('mideast.alerts.card.note'), link: { href: ALERTS_MIRROR_SITE, text: translate('mideast.alerts.link.mirror') },
    };
  }
  function openCard(slug) {
    const m = cardModel(slug);
    if (!m) { closeCard(); return; }
    _selected = slug;
    const head = el('header', 'oko-mideast-inc-head');
    const sw = el('i', 'oko-mideast-inc-swatch'); sw.setAttribute?.('style', `background: ${m.colour}`); head.appendChild(sw);
    const name = el('span', 'oko-mideast-inc-type oko-mideast-alerts-name', m.name); name.lang = 'he'; name.dir = 'rtl'; head.appendChild(name);
    head.appendChild(el('span', 'oko-mideast-inc-when', m.period));
    const close = el('button', 'oko-mideast-inc-close', '×'); close.type = 'button'; close.title = translate('mideast.inc.close'); close.setAttribute?.('aria-label', translate('mideast.inc.close')); close.addEventListener?.('click', closeCard); head.appendChild(close);
    const parts = [head];
    if (m.district) { const d = el('div', 'oko-mideast-inc-place', m.district); d.lang = 'he'; d.dir = 'rtl'; parts.push(d); }
    const rows = el('div', 'oko-mideast-alerts-rows');
    for (const r of m.rows) { const row = el('span', `oko-mideast-alerts-row is-${r.id}`); row.appendChild(el('span', 'oko-mideast-alerts-row-label', r.label)); row.appendChild(el('span', 'oko-mideast-alerts-row-value', numberFormat.format(r.value))); rows.appendChild(row); }
    parts.push(rows);
    parts.push(el('p', 'oko-mideast-inc-text', `${m.note}${m.dataUpdated ? ` ${translate('mideast.alerts.card.updated', { date: m.dataUpdated })}` : ''}`));
    const foot = el('footer', 'oko-mideast-inc-foot');
    foot.appendChild(el('span', 'oko-mideast-inc-level', translate('mideast.alerts.level')));
    const a = el('a', 'oko-mideast-inc-link', m.link.text); a.href = m.link.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; foot.appendChild(a);
    parts.push(foot);
    card.style?.setProperty?.('--inc-accent', m.colour);
    card.replaceChildren?.(...parts);
    card.hidden = false;
  }
  function installClick() {
    if (clickHandler || _destroyed || !scene?.canvas) return;
    clickHandler = createClickHandler(scene.canvas);
    clickHandler.setInputAction((e) => { if (!ds.show) return; const slug = pickSlug(e.position); if (slug) openCard(slug); }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  // ── obdobie ───────────────────────────────────────────────────────────────
  const lastDay = () => lastAlarmDay(_all?.json?.days, dayOf(now()));
  function dayOf(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function periodCounts() {
    const days = _all?.json?.days;
    if (!days) return {};
    const out = {};
    for (const p of MIDEAST_ALERT_PERIODS) { const r = alertPeriodRange(p, now(), lastDay()); out[p] = alarmsInRange(days, r.from, r.to); }
    return out;
  }
  function currentPeriod() {
    if (_period) return _period;
    const counts = periodCounts();
    return ['7d', '30d', 'all'].find((p) => (counts[p] || 0) > 0) || '30d';
  }
  function currentRange() { return alertPeriodRange(currentPeriod(), now(), lastDay()); }

  // ── kreslenie ─────────────────────────────────────────────────────────────
  function buildEntities() {
    if (!_areas || entities.size) return;
    ds.entities.suspendEvents();
    try {
      for (const [slug, a] of Object.entries(_areas)) {
        if (!Array.isArray(a.ring) || a.ring.length < 3) continue;
        const positions = Cesium.Cartesian3.fromDegreesArray(a.ring.flatMap((p) => [p[0], p[1]]));
        const e = ds.entities.add({
          show: false,
          polygon: { hierarchy: new Cesium.PolygonHierarchy(positions), material: Cesium.Color.TRANSPARENT, classificationType: Cesium.ClassificationType.BOTH },
          polyline: { positions: [...positions, positions[0]], width: ALERTS_OUTLINE_WIDTH, material: Cesium.Color.TRANSPARENT, clampToGround: true },
          properties: { areaSlug: slug },
        });
        entities.set(slug, e);
      }
    } finally { ds.entities.resumeEvents(); }
  }
  function paint() {
    buildEntities();
    ds.entities.suspendEvents();
    try {
      for (const [slug, e] of entities) {
        const c = _shown?.[slug];
        const alarms = (Number(c?.r) || 0) + (Number(c?.d) || 0);
        const level = alertLevel(alarms);
        const kind = dominantKind(c);
        if (!level || !kind) { e.show = false; continue; }
        const colour = Cesium.Color.fromCssColorString(alertKindOf(kind).css);
        e.polygon.material = colour.withAlpha(level.alpha);
        e.polyline.material = colour.withAlpha(ALERTS_OUTLINE_ALPHA);
        e.show = true;
      }
    } finally { ds.entities.resumeEvents(); }
    requestRender();
  }

  // ── načítanie ─────────────────────────────────────────────────────────────
  async function loadAreas() {
    if (_areas) return;
    const json = await fetchAreasImpl();
    if (_destroyed) return;
    _areas = json.areas;
    _areasSource = json.source || null;
  }
  async function loadRange(range, force) {
    const key = `${range.from}:${range.to}`;
    const hit = _ranges.get(key);
    if (!force && hit && now() - hit.at < ALERTS_RELOAD_MS) return hit.json;
    const json = await fetchImpl({ from: range.from, to: range.to });
    if (_destroyed) return null;
    _ranges.set(key, { at: now(), json });
    if (_ranges.size > 12) _ranges.delete(_ranges.keys().next().value);
    return json;
  }
  async function load({ force = false } = {}) {
    if (_loading) return;
    _loading = true; _error = null; emit();
    try {
      await loadAreas();
      const all = alertPeriodRange('all', now());
      if (force || !_all || now() - _all.at >= ALERTS_RELOAD_MS) {
        const json = await fetchImpl({ from: all.from, to: all.to });
        if (_destroyed) return;
        _all = { at: now(), json };
        _ranges.set(`${all.from}:${all.to}`, _all);
      }
      const period = currentPeriod();
      const json = period === 'all' ? _all.json : await loadRange(currentRange(), force);
      if (_destroyed || !json) return;
      _shown = json.areas || {};
      if (_selected && !_shown[_selected]) closeCard();
      paint();
    } catch (error) {
      _error = error?.status === 404 ? (String(error.message).startsWith('no_alert') ? String(error.message) : 'no_alerts_snapshot') : (error?.message || String(error));
    } finally {
      _loading = false;
      if (!_destroyed) emit();
    }
  }

  async function sync() {
    if (_destroyed) return;
    const wanted = _enabled && _active;
    const shown = wanted && _visible;
    ds.show = shown;
    ds.credit = shown && _shown ? new Cesium.Credit(translate('mideast.alerts.credit'), true) : undefined;
    if (!shown) { hover.hide(); closeCard(); }
    if (wanted) { hover.install(); installClick(); }
    if (wanted && refreshTimer === null) {
      refreshTimer = setTimer(() => { if (_enabled && _active && !_destroyed) void load({ force: true }); }, ALERTS_RELOAD_MS);
    } else if (!wanted && refreshTimer !== null) { clearTimer(refreshTimer); refreshTimer = null; }
    requestRender();
    emit();
    if (wanted) {
      await load();
      if (!_destroyed) { ds.show = _enabled && _active && _visible; ds.credit = ds.show && _shown ? new Cesium.Credit(translate('mideast.alerts.credit'), true) : undefined; requestRender(); }
    }
  }

  function getState() {
    const period = _all ? currentPeriod() : (_period || null);
    return {
      enabled: _enabled, active: _active, visible: _visible, loading: _loading, error: _error, loaded: Boolean(_all && _shown),
      period, periods: MIDEAST_ALERT_PERIODS, periodCounts: periodCounts(), range: _all ? currentRange() : null, lastDay: _all ? lastDay() : null,
      firstDay: MIDEAST_ALERTS_FIRST_DAY, theatre: _theatre?.id || null,
      summary: _shown ? alertsSummary(_shown, _areas || {}, { top: 5 }) : EMPTY_SUMMARY,
      dataUpdated: _all?.json?.dataUpdated || null, fetchedAt: _all?.json?.fetchedAt || null, coverage: _all?.json?.coverage || null,
      source: _all?.json?.source || _areasSource || null, areasCount: _areas ? Object.keys(_areas).length : 0, selected: _selected,
    };
  }
  function destroy() {
    _destroyed = true;
    hover.destroy();
    if (clickHandler) { try { clickHandler.destroy(); } catch { /* */ } clickHandler = null; }
    if (refreshTimer !== null) { clearTimer(refreshTimer); refreshTimer = null; }
    try { card.remove?.(); } catch { /* */ }
    try { viewer.dataSources.remove(ds, true); } catch { /* */ }
    listeners.clear();
  }
  return {
    id: MIDEAST_ALERTS_LAYER_ID,
    setEnabled(on) { _enabled = Boolean(on); return sync(); },
    isEnabled: () => _enabled,
    /** Aktívne dejisko (objekt alebo id); mimo ALERT_THEATRES je vrstva neaktívna (čip vypnutý ako KONTROLA SÍDIEL bez modulov). */
    setActive(sceneOrOn) {
      _active = alertsTheatreActive(sceneOrOn);
      _theatre = _active && typeof sceneOrOn === 'object' ? { id: sceneOrOn.id } : (_active ? { id: String(sceneOrOn) } : null);
      return sync();
    },
    /** 'day' | '7d' | '30d' | 'all' | null (automaticky). */
    setPeriod(period) {
      const next = period === null ? null : (MIDEAST_ALERT_PERIODS.includes(period) ? period : undefined);
      if (next === undefined || next === _period) return Promise.resolve();
      _period = next;
      closeCard();
      return sync();
    },
    show() { _visible = true; return sync(); },
    hide() { _visible = false; return sync(); },
    getState,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy,
    openCard, closeCard,
    labels: { kind: kindLabel, period: periodLabel, area: areaLabel },
    _getStateForTest: () => ({ ds, tip: hover.el, card, entities, tipText, cardModel }),
  };
}
