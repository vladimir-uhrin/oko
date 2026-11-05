// src/mideastIncidentsLayer.js
//
// OVERENÉ UDALOSTI modulu BLÍZKY VÝCHOD (etapa 4, 2026-11-05): údery, zásahy a poškodenia
// z GeoConfirmed (geolokované proti záberu) a z UCDP Candidate ako body na mape. Dáta dodáva
// archív servera (`/api/mideast/events/incidents`, src/data/mideastIncidents.js +
// scripts/lib/mideastArchive.mjs); vrstva ich kreslí: farba = druh, veľkosť a sýtosť = vek
// (do 7 dní / do 30 dní / starší).
//
// Kedy je vidieť: čip je zapnutý (predvolene áno) A je aktívne dejisko BLÍZKEHO VÝCHODU A brána
// priblíženia je otvorená — ako INCIDENTY LODÍ. Sťahuje sa až pri prvom dejisku, nie pri štarte.
// Jednoduchá os: obdobie 7 d / 30 d / od 28. 2. (setPeriod) s počtami zo súhrnu po dňoch;
// dlhšie obdobie sa sťahuje po kusoch ≤ 31 dní (strop trasy).
//
// Karta po kliknutí na bod: druh, dátum, miesto, aktér, popis (orezaný, bez viet o osobách),
// štítok „OSINT · geolokované" (UCDP: „predbežné, poloha na úrovni sídla/okresu"), odkaz na
// zdroj. Etická čiara: žiadne polohy jednotiek ani osoby — filtruje to už model na serveri.

import * as Cesium from 'cesium';
import {
  MIDEAST_INCIDENTS_FIRST_DAY, MIDEAST_INCIDENT_PERIODS, countInRange, fetchMideastIncidentSummary, fetchMideastIncidents,
  inRect, incidentAge, incidentChunks, incidentPeriodRange, incidentSummary, mideastIncidentTypeOf,
} from './data/mideastIncidents.js';
import { currentLanguage, t } from './i18n.js';
import { createMapHoverTip } from './mapHoverTip.js';

export const MIDEAST_INCIDENTS_LAYER_ID = 'mideast-incidents';
/** Obnova otvorenej stránky pri aktívnom dejisku (archív servera sa obnovuje raz za 6 h). */
export const INCIDENTS_RELOAD_MS = 30 * 60_000;
export const INCIDENTS_POINT_SIZE = Object.freeze({ fresh: 10, recent: 7, old: 5 });
export const INCIDENTS_POINT_ALPHA = Object.freeze({ fresh: 0.95, recent: 0.75, old: 0.5 });
export const INCIDENTS_DEFAULT_PERIOD = '30d';
/** Najviac znakov popisu v bubline (karta má celý orezaný popis zo servera, ≤ 280). */
const TIP_TEXT_MAX = 160;
const PICK_PX = 8;

const EMPTY_SUMMARY = Object.freeze({ total: 0, bySrc: { geoconfirmed: 0, ucdp: 0 }, byType: [], latest: [] });
const INERT = {
  id: MIDEAST_INCIDENTS_LAYER_ID, setEnabled() {}, isEnabled: () => false, setActive: async () => {}, setPeriod: async () => {}, show() {}, hide() {},
  getState: () => ({ enabled: false, active: false, visible: false, loading: false, error: null, loaded: false, period: INCIDENTS_DEFAULT_PERIOD, periodCounts: {}, theatre: null, summary: EMPTY_SUMMARY, incidents: [] }),
  onChange() { return () => {}; }, destroy() {}, labels: {},
};

/** Farba druhu udalosti (pure). */
export const incidentColour = (typeId) => mideastIncidentTypeOf(typeId).css;

/**
 * @param {object} o
 * @param {import('cesium').Viewer} o.viewer
 */
export function createMideastIncidents({
  viewer,
  fetchImpl = fetchMideastIncidents,
  fetchSummaryImpl = fetchMideastIncidentSummary,
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

  const ds = new Cesium.CustomDataSource(MIDEAST_INCIDENTS_LAYER_ID);
  viewer.dataSources.add(ds);
  ds.show = false;
  const pickId = (pos) => scene.pick(new Cesium.Cartesian2(pos.x, pos.y), PICK_PX, PICK_PX)?.id?.properties?.incidentId?.getValue?.() ?? null;
  const hover = createHoverTip({
    viewer,
    doc,
    className: 'oko-mideast-inc-tip',
    isActive: () => ds.show,
    resolve: (pos) => {
      const id = pickId(pos);
      const it = id ? _byId.get(id) : null;
      return it ? { text: tipText(it), accent: incidentColour(it.type) } : null;
    },
  });
  const dateFormat = new Intl.DateTimeFormat(lang === 'sk' ? 'sk-SK' : 'en-GB', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const numberFormat = new Intl.NumberFormat(lang === 'sk' ? 'sk-SK' : 'en-GB');
  const requestRender = () => { try { scene.requestRender?.(); } catch { /* */ } };
  const textOr = (key, fallback) => { const s = translate(key); return s === key ? fallback : s; };

  let _enabled = true;
  let _active = false;
  let _theatre = null; // { id, rectDegrees, overview } aktívneho dejiska
  let _visible = true;
  let _period = INCIDENTS_DEFAULT_PERIOD;
  let _incidents = []; // celé obdobie, celý región
  let _byId = new Map();
  let _loadedKey = null; // `${period}:${from}:${to}`
  let _loadedAt = 0;
  let _summaries = new Map(); // theatreId|'' -> { at, json }
  let _sources = null;
  let _loading = false;
  let _error = null;
  let _destroyed = false;
  let _selected = null;
  let refreshTimer = null;
  let clickHandler = null;
  const chunkCache = new Map(); // `${from}:${to}` -> { at, json }
  const listeners = new Set();
  const emit = () => { const s = getState(); for (const fn of listeners) { try { fn(s); } catch { /* */ } } };

  const typeLabel = (it) => textOr(`mideast.inc.type.${it.type}`, it.type);
  const actorLabel = (it) => (it.actor ? textOr(`mideast.inc.actor.${it.actor}`, it.actor) : '');
  const whenLabel = (it) => dateFormat.format(new Date(it.t));
  const placeLabel = (it) => [it.place, it.country && !String(it.place || '').includes(it.country) ? it.country : null].filter(Boolean).join(', ');
  const levelLabel = (it) => (it.src === 'ucdp'
    ? translate('mideast.inc.level.ucdp', { prec: translate(`mideast.inc.prec.${it.precision}`) })
    : translate(it.precision === 'approx' ? 'mideast.inc.level.gc-approx' : 'mideast.inc.level.gc'));

  /** Text bubliny: druh · dátum · miesto · aktér · začiatok popisu · štítok úrovne. */
  function tipText(it) {
    const text = it.text ? (it.text.length > TIP_TEXT_MAX ? `${it.text.slice(0, TIP_TEXT_MAX - 1)}…` : it.text) : '';
    const actor = actorLabel(it);
    return [typeLabel(it), whenLabel(it), placeLabel(it), actor ? translate('mideast.inc.actor', { actor }) : '', text, levelLabel(it)].filter(Boolean).join(' · ');
  }

  // ── karta po kliknutí ─────────────────────────────────────────────────────
  const card = doc.createElement('article');
  card.className = 'oko-mideast-inc-card';
  card.hidden = true;
  viewer.container?.appendChild?.(card);
  const el = (tag, className = '', text = null) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const link = (href, text) => {
    const a = el('a', 'oko-mideast-inc-link', text);
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  };
  function closeCard() { _selected = null; card.hidden = true; card.replaceChildren?.(); }
  /** Model karty (testovateľný bez DOM). */
  function cardModel(it) {
    const actor = actorLabel(it);
    const links = [];
    if (it.src === 'geoconfirmed') {
      links.push({ href: it.url, text: translate('mideast.inc.link.gc') });
      if (it.sources?.[0]) links.push({ href: it.sources[0], text: translate('mideast.inc.link.original') });
    } else if (it.url) links.push({ href: it.url, text: translate('mideast.inc.link.ucdp') });
    return {
      id: it.id,
      colour: incidentColour(it.type),
      type: typeLabel(it),
      when: whenLabel(it),
      place: placeLabel(it),
      actor: actor ? translate('mideast.inc.actor', { actor }) : '',
      parties: it.src === 'ucdp' && it.parties?.length ? translate('mideast.inc.parties', { parties: it.parties.join(' – ') }) : '',
      deaths: it.src === 'ucdp' && Number.isFinite(it.deaths) ? translate('mideast.inc.deaths', { n: numberFormat.format(it.deaths) }) : '',
      text: it.text || '',
      level: levelLabel(it),
      links,
    };
  }
  function openCard(id) {
    const it = _byId.get(id);
    if (!it) { closeCard(); return; }
    _selected = id;
    const m = cardModel(it);
    const head = el('header', 'oko-mideast-inc-head');
    const sw = el('i', 'oko-mideast-inc-swatch');
    sw.setAttribute?.('style', `background: ${m.colour}`);
    head.appendChild(sw);
    head.appendChild(el('span', 'oko-mideast-inc-type', m.type));
    head.appendChild(el('span', 'oko-mideast-inc-when', m.when));
    const close = el('button', 'oko-mideast-inc-close', '×');
    close.type = 'button';
    close.title = translate('mideast.inc.close');
    close.setAttribute?.('aria-label', translate('mideast.inc.close'));
    close.addEventListener?.('click', closeCard);
    head.appendChild(close);
    const parts = [head];
    if (m.place) parts.push(el('div', 'oko-mideast-inc-place', m.place));
    if (m.actor) parts.push(el('div', 'oko-mideast-inc-actor', m.actor));
    if (m.parties) parts.push(el('div', 'oko-mideast-inc-actor', m.parties));
    if (m.text) parts.push(el('p', 'oko-mideast-inc-text', m.text));
    if (m.deaths) parts.push(el('div', 'oko-mideast-inc-deaths', m.deaths));
    const foot = el('footer', 'oko-mideast-inc-foot');
    foot.appendChild(el('span', 'oko-mideast-inc-level', m.level));
    for (const l of m.links) foot.appendChild(link(l.href, l.text));
    parts.push(foot);
    card.style?.setProperty?.('--inc-accent', m.colour);
    card.replaceChildren?.(...parts);
    card.hidden = false;
  }
  function installClick() {
    if (clickHandler || _destroyed || !scene?.canvas) return;
    clickHandler = createClickHandler(scene.canvas);
    clickHandler.setInputAction((e) => {
      if (!ds.show) return;
      const id = pickId(e.position);
      if (id) openCard(id);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  // ── kreslenie ─────────────────────────────────────────────────────────────
  function draw() {
    ds.entities.removeAll();
    if (!_incidents.length) { requestRender(); return; }
    const nowMs = now();
    ds.entities.suspendEvents();
    try {
      // Staršie najprv, aby čerstvé body ležali navrchu.
      for (let i = _incidents.length - 1; i >= 0; i -= 1) {
        const it = _incidents[i];
        const age = incidentAge(it.t, nowMs);
        const colour = Cesium.Color.fromCssColorString(incidentColour(it.type));
        ds.entities.add({
          position: Cesium.Cartesian3.fromDegrees(it.lon, it.lat),
          point: {
            pixelSize: INCIDENTS_POINT_SIZE[age],
            color: colour.withAlpha(INCIDENTS_POINT_ALPHA[age]),
            outlineColor: Cesium.Color.BLACK.withAlpha(age === 'old' ? 0.45 : 0.8),
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          properties: { incidentId: it.id },
        });
      }
    } finally { ds.entities.resumeEvents(); }
    requestRender();
  }

  // ── načítanie ─────────────────────────────────────────────────────────────
  const summaryKey = () => (_theatre && !_theatre.overview ? _theatre.id : '');
  async function loadSummary(force) {
    const key = summaryKey();
    const hit = _summaries.get(key);
    if (!force && hit && now() - hit.at < INCIDENTS_RELOAD_MS) return;
    const all = incidentPeriodRange('all', now());
    const json = await fetchSummaryImpl({ from: all.from, to: all.to, theatre: key || null });
    if (_destroyed) return;
    _summaries.set(key, { at: now(), json });
    _sources = json.sources || _sources;
  }
  async function loadIncidents(force) {
    const range = incidentPeriodRange(_period, now());
    const key = `${_period}:${range.from}:${range.to}`;
    if (!force && _loadedKey === key && now() - _loadedAt < INCIDENTS_RELOAD_MS) return;
    const chunks = incidentChunks(range.from, range.to);
    const list = [];
    let sources = null;
    for (const c of chunks) {
      const ck = `${c.from}:${c.to}`;
      let hit = chunkCache.get(ck);
      // Kusy staršie než 30 dní sa nemenia (rolujúce okno archívu) — tie sa z cache neobnovujú.
      const frozen = c.to < incidentPeriodRange('30d', now()).from;
      if (force && !frozen) hit = null;
      if (!hit || (!frozen && now() - hit.at >= INCIDENTS_RELOAD_MS)) {
        const json = await fetchImpl({ from: c.from, to: c.to });
        if (_destroyed) return;
        hit = { at: now(), json };
        chunkCache.set(ck, hit);
      }
      sources = hit.json.sources || sources;
      list.push(...(Array.isArray(hit.json.incidents) ? hit.json.incidents : []));
    }
    _incidents = list.filter((it) => it && Number.isFinite(it.lat) && Number.isFinite(it.lon) && Number.isFinite(it.t)).sort((a, b) => b.t - a.t);
    _byId = new Map(_incidents.map((it) => [it.id, it]));
    _loadedKey = key;
    _loadedAt = now();
    _sources = sources || _sources;
    if (_selected && !_byId.has(_selected)) closeCard();
    draw();
  }
  async function load({ force = false } = {}) {
    if (_loading) return;
    _loading = true; _error = null; emit();
    try {
      await loadSummary(force);
      await loadIncidents(force);
    } catch (error) {
      // Staré body (ak sú) ostávajú; legenda ukáže chybu.
      _error = error?.status === 404 ? 'no_incidents_snapshot' : (error?.message || String(error));
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
    ds.credit = shown && _incidents.length ? new Cesium.Credit(translate('mideast.inc.credit'), true) : undefined;
    if (!shown) { hover.hide(); closeCard(); }
    if (wanted) { hover.install(); installClick(); }
    if (wanted && refreshTimer === null) {
      refreshTimer = setTimer(() => { if (_enabled && _active && !_destroyed) void load({ force: true }).then(() => { if (!_destroyed) requestRender(); }); }, INCIDENTS_RELOAD_MS);
    } else if (!wanted && refreshTimer !== null) {
      clearTimer(refreshTimer);
      refreshTimer = null;
    }
    requestRender();
    emit();
    if (wanted) {
      await load();
      if (!_destroyed) {
        ds.show = _enabled && _active && _visible;
        ds.credit = ds.show && _incidents.length ? new Cesium.Credit(translate('mideast.inc.credit'), true) : undefined;
        requestRender();
      }
    }
  }

  /** Udalosti obdobia v aktívnom dejisku (prehľad regiónu = všetky). */
  function inTheatre() {
    if (!_theatre || _theatre.overview) return _incidents;
    return _incidents.filter((it) => inRect(it, _theatre.rectDegrees));
  }
  function periodCounts() {
    const days = _summaries.get(summaryKey())?.json?.days;
    if (!days) return {};
    const out = {};
    for (const p of MIDEAST_INCIDENT_PERIODS) {
      const r = incidentPeriodRange(p, now());
      out[p] = countInRange(days, r.from, r.to);
    }
    return out;
  }
  function getState() {
    const shown = inTheatre();
    return {
      enabled: _enabled,
      active: _active,
      visible: _visible,
      loading: _loading,
      error: _error,
      loaded: _loadedKey !== null,
      period: _period,
      periods: MIDEAST_INCIDENT_PERIODS,
      periodCounts: periodCounts(),
      firstDay: MIDEAST_INCIDENTS_FIRST_DAY,
      theatre: _theatre?.id || null,
      sources: _sources,
      fetchedAt: Math.max(0, ...Object.values(_sources?.geoconfirmed?.conflicts || {}).map((c) => Number(c?.fetchedAt) || 0)) || null,
      incidents: _incidents,
      summary: incidentSummary(shown, { latest: 5 }),
      selected: _selected,
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
    id: MIDEAST_INCIDENTS_LAYER_ID,
    /** Čip v paneli (predvolene zapnuté). */
    setEnabled(on) { _enabled = Boolean(on); return sync(); },
    isEnabled: () => _enabled,
    /**
     * Aktívne dejisko: objekt dejiska (id, rectDegrees, overview) alebo true/false. Počty v legende
     * sa rátajú v rámci dejiska, body sa kreslia v celom regióne (mimo záberu nič nestoja).
     */
    setActive(sceneOrOn) {
      _active = Boolean(sceneOrOn);
      _theatre = sceneOrOn && typeof sceneOrOn === 'object' ? { id: sceneOrOn.id, rectDegrees: sceneOrOn.rectDegrees, overview: Boolean(sceneOrOn.overview) } : null;
      return sync();
    },
    /** Jednoduchá os: '7d' | '30d' | 'all' (od 28. 2.). */
    setPeriod(period) {
      if (!MIDEAST_INCIDENT_PERIODS.includes(period) || period === _period) return Promise.resolve();
      _period = period;
      closeCard();
      return sync();
    },
    show() { _visible = true; return sync(); },
    hide() { _visible = false; return sync(); },
    getState,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy,
    openCard,
    closeCard,
    labels: { type: typeLabel, actor: actorLabel, when: whenLabel, place: placeLabel, level: levelLabel },
    _getStateForTest: () => ({ ds, tip: hover.el, card, tipText: (id) => (_byId.get(id) ? tipText(_byId.get(id)) : ''), cardModel: (id) => (_byId.get(id) ? cardModel(_byId.get(id)) : null), chunkCache }),
  };
}
