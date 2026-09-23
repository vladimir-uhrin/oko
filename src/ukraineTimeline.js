// src/ukraineTimeline.js
//
// ČASOVÁ OS modulu UKRAJINA (etapa 3c, 2026-09-19; používateľ: „určite časovú os,
// aby som vedel robiť prehľady, čo sa deje"). Pevný spodný pás (box v style.css,
// `.oko-ukr-timeline`; registrovaný ako prekážka stĺpcov v ui.js), ktorý spája:
//  - hodiny (ukraineTimelineClock.js): LIVE / PREHRÁVANIE, okná 24 h · 7 d · 30 d ·
//    od 2022, rýchlosti 1 h/s … 2 d/s, kurzor ťahaný myšou po histograme;
//  - sklad (ukraineEventsClient.js): udalosti okna mapy z archívu, súhrn po dňoch
//    pre dlhé okná, hlásenie GŠ pre deň kurzora;
//  - vrstvu udalostí (ukraineEventsLayer.js): body, karty, čipy, lightbox;
//  - legendu typov (klik = filter), počítadlá (V ZÁBERE n / celkom, GŠ strety,
//    fotky/videá) a pás fotiek a videí okna (klik = lightbox);
//  - odkaz na zdieľanie `?front=<smer>&t=<čas>&win=<okno>`.
// Žiadne innerHTML; DOM cez vložený `document`, aby sa dal modul testovať v Node.

import { EVENT_TYPES, dayKey } from './data/ukraineEvents.js';
import { createUkraineEventStore, mediaInWindow } from './data/ukraineEventsClient.js';
import { TIMELINE_SPEEDS, TIMELINE_WINDOWS, createTimelineClock, cursorText, histogramBins } from './data/ukraineTimelineClock.js';
import { TYPE_GLYPH, SEV_COLOR } from './ukraineEventsLayer.js';
import { CONTROL_STALE_DAYS, DEEPSTATE_STALE_DAYS, ageText, freshnessOf } from './data/ukraineFreshness.js';
import { currentLanguage, t } from './i18n.js';

const IMG_API = '/api/img';
const SCRUB_DEBOUNCE_MS = 160;
const PLAY_TICK_MS = 100;
const LIVE_REFRESH_MS = 60_000;

/**
 * Tá istá zónová snímka (kontrola: `revisionAt` revízie Wikipédie, DeepState:
 * `at` upstream snímky)? V LIVE sa snímka toho istého dňa pýta znova každý tik,
 * prekresľuje sa však len pri inej identite — raster a polygóny sa nestavajú nadarmo.
 * @param {object|null} snap nová snímka zo skladu
 * @param {object|null} state stav vrstvy (`getState()`)
 * @param {'revisionAt'|'at'} key identita snímky
 */
export function sameZoneSnapshot(snap, state, key) {
  return (snap?.[key] ?? null) === (state?.[key] ?? null);
}
const MEDIA_STRIP_MAX = 40;
const D = 86_400_000;

const INERT = { element: null, show() {}, hide() {}, isShown: () => false, setActiveScene() {}, refresh: async () => null, getState: () => ({ shown: false }), onChange() { return () => {}; }, destroy() {} };

/** Deň (YYYY-MM-DD) → krátky text „19.9." Pure. */
export function shortDay(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  return m ? `${Number(m[3])}.${Number(m[2])}.` : String(day || '');
}
/** URL na zdieľanie stavu osi. Pure. */
export function shareUrl({ origin = '', front = 'front', state = null } = {}) {
  const params = new URLSearchParams();
  params.set('front', front || 'front');
  if (state?.mode === 'replay' && Number.isFinite(state.cursor)) params.set('t', new Date(state.cursor).toISOString().replace(/\.\d{3}Z$/, 'Z'));
  if (state?.windowId) params.set('win', state.windowId);
  return `${origin}/?${params.toString()}`;
}
/** `?t=&win=` z URL → počiatočný stav hodín (alebo null). Pure. */
export function parseShareParams(search) {
  let params;
  try { params = new URLSearchParams(String(search || '').replace(/^\?/, '')); } catch { return null; }
  const t = params.get('t'); const win = params.get('win');
  const cursor = t ? Date.parse(t) : NaN;
  const windowId = TIMELINE_WINDOWS.some((w) => w.id === win) ? win : null;
  if (!Number.isFinite(cursor) && !windowId) return null;
  return { cursor: Number.isFinite(cursor) ? cursor : null, windowId };
}

/**
 * @param {object} o
 * @param {object} o.layer createUkraineEventsLayer
 * @param {object} [o.store] createUkraineEventStore
 * @param {object} [o.clock] createTimelineClock
 * @param {object|null} [o.report] createUkraineReportLayer (setOverride pre deň kurzora)
 * @param {Element} [o.mountTarget] kam pás vložiť (predvolene document.body)
 */
export function createUkraineTimeline({
  layer,
  store = createUkraineEventStore(),
  clock = createTimelineClock(),
  report = null,
  control = null,
  deepstate = null,
  damage = null,
  mountTarget = null,
  translate = t,
  lang = currentLanguage(),
  documentRef = globalThis.document,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  clipboard = globalThis.navigator?.clipboard || null,
  origin = globalThis.location?.origin || '',
} = {}) {
  const doc = documentRef;
  if (!doc?.createElement || !layer) return INERT;
  const el = (tag, className = '', text = null) => { const n = doc.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; };
  const button = (className, text, onClick, title = null) => { const b = el('button', className, text); b.type = 'button'; if (title) b.title = title; b.addEventListener('click', onClick); return b; };
  const nf = new Intl.NumberFormat(lang === 'sk' ? 'sk-SK' : 'en-GB');

  // ── kostra ───────────────────────────────────────────────────────────────
  // Bez triedy .oko-scene-overlay: jej pravidlá (vstupná animácia cez transform)
  // by prepísali polohu pásu; brána priblíženia riadi vrstvu, nie pás.
  const root = el('section', 'oko-ukr-timeline');
  root.hidden = true;
  root.setAttribute('aria-label', translate('ukraine.tl.title'));
  const row1 = el('div', 'oko-ukr-tl-row');
  const modeBtn = button('oko-ukr-tl-mode is-live', translate('ukraine.tl.live'), () => { if (clock.mode === 'live') clock.play(); else clock.setMode('live'); });
  row1.appendChild(modeBtn);
  const wins = el('div', 'oko-ukr-tl-wins');
  wins.setAttribute('role', 'group');
  const winBtns = new Map();
  for (const w of TIMELINE_WINDOWS) {
    const b = button('data-toggle-chip oko-ukr-tl-win', translate(w.labelKey), () => clock.setWindow(w.id));
    b.dataset.win = w.id;
    wins.appendChild(b); winBtns.set(w.id, b);
  }
  row1.appendChild(wins);
  const transport = el('div', 'oko-ukr-tl-transport');
  const backBtn = button('oko-ukr-tl-btn', '⏮︎', () => clock.step(-1), translate('ukraine.tl.back'));
  const playBtn = button('oko-ukr-tl-btn oko-ukr-tl-play', '▶︎', () => clock.toggle(), translate('ukraine.tl.play'));
  const fwdBtn = button('oko-ukr-tl-btn', '⏭︎', () => clock.step(+1), translate('ukraine.tl.forward'));
  const speed = el('select', 'oko-ukr-tl-speed');
  for (const s of TIMELINE_SPEEDS) { const o = el('option', '', translate(s.labelKey)); o.value = s.id; speed.appendChild(o); }
  speed.addEventListener('change', () => clock.setSpeed(speed.value));
  transport.appendChild(backBtn); transport.appendChild(playBtn); transport.appendChild(fwdBtn); transport.appendChild(speed);
  row1.appendChild(transport);
  const cursor = el('span', 'oko-ukr-tl-cursor');
  row1.appendChild(cursor);
  const counts = el('span', 'oko-ukr-tl-counts');
  row1.appendChild(counts);
  const status = el('span', 'oko-ukr-tl-status');
  row1.appendChild(status);
  const shareBtn = button('oko-ukr-tl-btn oko-ukr-tl-share', '⛓︎', () => void share(), translate('ukraine.tl.share'));
  row1.appendChild(shareBtn);
  const closeBtn = button('oko-ukr-tl-btn oko-ukr-tl-close', '×', () => hide(), translate('ukraine.tl.close'));
  row1.appendChild(closeBtn);
  root.appendChild(row1);

  const track = el('div', 'oko-ukr-tl-track');
  const canvas = doc.createElement('canvas');
  canvas.className = 'oko-ukr-tl-hist';
  canvas.height = 44;
  track.appendChild(canvas);
  const coverage = el('div', 'oko-ukr-tl-coverage');
  coverage.title = translate('ukraine.tl.coverage');
  track.appendChild(coverage);
  const cursorLine = el('div', 'oko-ukr-tl-cursorline');
  track.appendChild(cursorLine);
  const axis = el('div', 'oko-ukr-tl-axis');
  track.appendChild(axis);
  root.appendChild(track);

  const row3 = el('div', 'oko-ukr-tl-row oko-ukr-tl-row3');
  // Územná kontrola (etapa 4C): čip KONTROLA + legenda RU výplň / zóna bojov / body,
  // „stav k <revízia> · podľa Wikipédie" — snímka sleduje deň kurzora.
  let ctlChip = null; let ctlLine = null; let ctlAge = null; let ctlCounts = null;
  if (control) {
    const ctlBox = el('div', 'oko-ukr-tl-ctl');
    ctlChip = button('data-toggle-chip oko-ukr-tl-type oko-ukr-tl-ctl-chip', translate('ukraine.part.control'), () => { if (control.isShown()) control.hide(); else void showControl(); }, translate('ukraine.ctl.note'));
    ctlChip.setAttribute('aria-pressed', 'false');
    ctlBox.appendChild(ctlChip);
    const sw = (cls, text) => { const s = el('span', `oko-ukr-tl-ctl-item ${cls}`); s.appendChild(el('i', 'oko-ukr-tl-ctl-sw')); s.appendChild(el('span', '', text)); return s; };
    ctlBox.appendChild(sw('is-ru', translate('ukraine.ctl.ru')));
    ctlBox.appendChild(sw('is-zone', translate('ukraine.ctl.zone')));
    ctlBox.appendChild(sw('is-ua', translate('ukraine.ctl.ua')));
    ctlBox.appendChild(sw('is-contested', translate('ukraine.ctl.contested')));
    ctlLine = el('span', 'oko-ukr-tl-ctl-since', '');
    ctlBox.appendChild(ctlLine);
    // Vek zdroja je vlastný prvok, nie prívesok „stav k" — dátum sa prekladá,
    // vek sa počíta pri každom prekreslení a pri prahu mení farbu.
    ctlAge = el('span', 'oko-ukr-tl-ctl-age', '');
    ctlBox.appendChild(ctlAge);
    ctlCounts = el('span', 'oko-ukr-tl-ctl-counts', '');
    ctlBox.appendChild(ctlCounts);
    row3.appendChild(ctlBox);
  }
  // DeepState (hobby použitie, súhlas sa žiada): čip + legenda + „stav k" + plochy.
  let dsChip = null; let dsLine = null; let dsAge = null; let dsArea = null;
  if (deepstate) {
    const dsBox = el('div', 'oko-ukr-tl-ctl oko-ukr-tl-ds');
    dsChip = button('data-toggle-chip oko-ukr-tl-type oko-ukr-tl-ctl-chip', translate('ukraine.part.deepstate'), () => { if (deepstate.isShown()) deepstate.hide(); else void showDeepState(); }, translate('ukraine.ds.note'));
    dsChip.setAttribute('aria-pressed', 'false');
    dsBox.appendChild(dsChip);
    const sw = (cls, text) => { const s = el('span', `oko-ukr-tl-ctl-item ${cls}`); s.appendChild(el('i', 'oko-ukr-tl-ctl-sw')); s.appendChild(el('span', '', text)); return s; };
    dsBox.appendChild(sw('is-ds-occupied', translate('ukraine.ds.occupied')));
    dsBox.appendChild(sw('is-ds-grey', translate('ukraine.ds.grey')));
    dsBox.appendChild(sw('is-ds-liberated', translate('ukraine.ds.liberated')));
    dsBox.appendChild(sw('is-ds-attack', translate('ukraine.ds.attack')));
    dsBox.appendChild(sw('is-ds-airfield', translate('ukraine.ds.airfield')));
    dsLine = el('span', 'oko-ukr-tl-ctl-since', '');
    dsBox.appendChild(dsLine);
    dsAge = el('span', 'oko-ukr-tl-ctl-age', '');
    dsBox.appendChild(dsAge);
    dsArea = el('span', 'oko-ukr-tl-ctl-counts', '');
    dsBox.appendChild(dsArea);
    row3.appendChild(dsBox);
  }
  // Škody na budovách (etapa 5): čip + legenda; UNOSAT body odkrýva kurzor.
  let dmgChip = null; let dmgLine = null;
  if (damage) {
    const dmgBox = el('div', 'oko-ukr-tl-ctl oko-ukr-tl-dmg');
    dmgChip = button('data-toggle-chip oko-ukr-tl-type oko-ukr-tl-ctl-chip', translate('ukraine.part.damage'), () => { if (damage.isShown()) damage.hide(); else void damage.show(); }, translate('ukraine.dmg.note'));
    dmgChip.setAttribute('aria-pressed', 'false');
    dmgBox.appendChild(dmgChip);
    const sw = (cls, text) => { const s = el('span', `oko-ukr-tl-ctl-item ${cls}`); s.appendChild(el('i', 'oko-ukr-tl-ctl-sw')); s.appendChild(el('span', '', text)); return s; };
    dmgBox.appendChild(sw('is-dmg-adm3', translate('ukraine.dmg.adm3')));
    dmgBox.appendChild(sw('is-dmg-destroyed', translate('ukraine.dmg.cls.destroyed')));
    dmgBox.appendChild(sw('is-dmg-severe', translate('ukraine.dmg.cls.severe')));
    dmgBox.appendChild(sw('is-dmg-moderate', translate('ukraine.dmg.cls.moderate')));
    dmgLine = el('span', 'oko-ukr-tl-ctl-since', '');
    dmgBox.appendChild(dmgLine);
    row3.appendChild(dmgBox);
  }
  const legend = el('div', 'oko-ukr-tl-legend');
  legend.setAttribute('role', 'group');
  legend.setAttribute('aria-label', translate('ukraine.tl.legend'));
  const legendBtns = new Map();
  const allBtn = button('data-toggle-chip oko-ukr-tl-type is-all active', translate('ukraine.tl.all'), () => setTypes(null));
  legend.appendChild(allBtn);
  for (const type of EVENT_TYPES) {
    const b = button('data-toggle-chip oko-ukr-tl-type', '', () => toggleType(type));
    b.dataset.type = type;
    b.appendChild(el('span', 'oko-ukr-glyph', TYPE_GLYPH[type] || '·'));
    b.appendChild(el('span', 'oko-ukr-tl-type-name', translate(`ukraine.ev.${type}`)));
    const n = el('span', 'oko-ukr-tl-type-count', '0');
    b.appendChild(n);
    legend.appendChild(b);
    legendBtns.set(type, { b, n });
  }
  row3.appendChild(legend);
  const mediaBox = el('div', 'oko-ukr-tl-media');
  const mediaTitle = el('span', 'oko-ukr-tl-media-title', '');
  const mediaStrip = el('div', 'oko-ukr-tl-strip');
  mediaBox.appendChild(mediaTitle); mediaBox.appendChild(mediaStrip);
  row3.appendChild(mediaBox);
  root.appendChild(row3);
  const foot = el('div', 'oko-ukr-tl-foot', translate('ukraine.tl.attribution'));
  root.appendChild(foot);
  (mountTarget || doc.body).appendChild(root);

  // ── stav ─────────────────────────────────────────────────────────────────
  let _shown = false;
  let _events = [];
  let _reports = {};
  let _coverage = null;
  let _summary = null; // { days } pre dlhé okná
  let _types = null;
  let _activeScene = null;
  let _loading = null;
  let _loadTimer = null;
  let _rafId = null;
  let _lastFrame = 0;
  let _liveTimer = null;
  let _dragging = false;
  let _destroyed = false;
  let _error = null;
  const listeners = new Set();
  const emit = () => { const s = getState(); for (const fn of listeners) { try { fn(s); } catch { /* */ } } };

  // ── načítanie ────────────────────────────────────────────────────────────
  function scheduleLoad(delay = SCRUB_DEBOUNCE_MS) {
    if (_loadTimer) clearTimer(_loadTimer);
    _loadTimer = setTimer(() => { _loadTimer = null; void load(); }, delay);
  }
  async function load() {
    if (_destroyed || !_shown) return null;
    const state = clock.getState();
    const { start, end } = state.mapRange;
    status.textContent = translate('ukraine.tl.loading');
    status.dataset.state = 'loading';
    const task = store.load(start, end);
    _loading = task;
    try {
      const result = await task;
      if (_destroyed || _loading !== task) return null;
      _events = result.events; _reports = result.reports; _coverage = result.coverage; _error = result.errors.length && !result.chunks ? result.errors[0] : null;
      layer.setEvents(_events);
      status.textContent = _error ? translate('ukraine.tl.error', { detail: _error }) : '';
      status.dataset.state = _error ? 'error' : 'ready';
      applyReport(state);
      void applyControl(state);
      void applyDeepState(state);
      applyDamageCursor(state);
      renderLegend(); renderMedia(); renderCounts(); drawHistogram(); drawCoverage();
      emit();
      return result;
    } catch (error) {
      if (_destroyed) return null;
      _error = error?.message || String(error);
      status.textContent = translate('ukraine.tl.error', { detail: _error });
      status.dataset.state = 'error';
      emit();
      return null;
    }
  }
  async function loadSummary() {
    const { start, end } = clock.range();
    if (end - start <= 7 * D) { _summary = null; return; }
    try { _summary = await store.summary(start, end); } catch { _summary = null; }
    if (!_destroyed) { drawHistogram(); drawCoverage(); }
  }
  /** Hlásenie GŠ pre deň kurzora (prehrávanie) alebo živé (LIVE). */
  function applyReport(state) {
    if (!report?.setOverride) return;
    if (state.mode === 'live') { report.setOverride(null); return; }
    report.setOverride(store.reportForDay(_reports, state.cursor));
  }
  /**
   * Snímka kontroly pre deň kurzora (LIVE = dnes); chýbajúca snímka = poctivý text.
   * LIVE obnova (2026-09-20): ten istý deň sa pýta znova pri každom tiku (60 s);
   * sklad drží snímku hodinu (`controlTtlMs`), po TTL ide dopyt na server, kde
   * archivár sťahuje DeepState každú hodinu a Wikipédiu každých 6 h. Prekreslí sa
   * len pri inej revízii; zlyhaná obnova nechá poslednú snímku na mape.
   */
  let _controlDay = null;
  let _controlTask = null;
  async function applyControl(state) {
    if (!control || !control.isShown()) return;
    const day = dayKey(state.mode === 'live' ? state.now : state.cursor);
    const refresh = day === _controlDay;
    if (refresh && (state.mode !== 'live' || _controlTask)) return;
    _controlDay = day;
    const task = store.control(day);
    _controlTask = task;
    try {
      const snap = await task;
      if (_destroyed || _controlDay !== day) return;
      if (refresh && sameZoneSnapshot(snap, control.getState(), 'revisionAt')) return;
      control.setSnapshot(snap);
    } catch (error) {
      if (_destroyed || refresh) return;
      control.setSnapshot(null);
      if (ctlLine) ctlLine.textContent = error?.status === 404 ? translate('ukraine.ctl.missing') : translate('ukraine.tl.error', { detail: error?.message || error });
    } finally { if (_controlTask === task) _controlTask = null; }
    renderControl();
  }
  async function showControl() {
    if (!control) return;
    await control.show({ load: false }); // onChange nižšie natiahne snímku; tu len poistka pre ten istý deň
    await applyControl(clock.getState());
  }
  /** Snímka DeepState pre deň kurzora; pred 19. 9. 2026 história nie je (API histórie za autorizáciou). */
  let _deepstateDay = null;
  let _deepstateTask = null;
  async function applyDeepState(state) {
    if (!deepstate || !deepstate.isShown()) return;
    const day = dayKey(state.mode === 'live' ? state.now : state.cursor);
    const refresh = day === _deepstateDay; // LIVE obnova ako pri kontrole (hodinový archív DeepState)
    if (refresh && (state.mode !== 'live' || _deepstateTask)) return;
    _deepstateDay = day;
    const task = store.deepstate(day);
    _deepstateTask = task;
    try {
      const snap = await task;
      if (_destroyed || _deepstateDay !== day) return;
      if (refresh && sameZoneSnapshot(snap, deepstate.getState(), 'at')) return;
      deepstate.setSnapshot(snap);
    } catch (error) {
      if (_destroyed || refresh) return;
      deepstate.setSnapshot(null);
      // 451 = server odmietol servírovať DeepState mimo localhostu, kým nepríde
      // súhlas (licencia §2). Nie je to chyba siete — povedz to ako stav.
      if (dsLine) {
        if (error?.status === 404) dsLine.textContent = translate('ukraine.ds.missing');
        else if (error?.status === 451) dsLine.textContent = translate('ukraine.ds.disabled');
        else dsLine.textContent = translate('ukraine.tl.error', { detail: error?.message || error });
      }
    } finally { if (_deepstateTask === task) _deepstateTask = null; }
    renderDeepState();
  }
  async function showDeepState() {
    if (!deepstate) return;
    await deepstate.show({ load: false });
    await applyDeepState(clock.getState());
  }
  function renderDeepState() {
    if (!deepstate || !dsChip) return;
    const st = deepstate.getState();
    dsChip.classList.toggle('active', st.shown);
    dsChip.setAttribute('aria-pressed', String(st.shown));
    // Kým DeepState NAOZAJ KRESLÍ, odvodený raster z Wikipédie sa skryje (dve
    // výplne nad sebou by boli neprehľadné); body Wikipédie ostávajú.
    // Podmienkou sú polygóny, nie zapnutý čip: na verejnej doméne server
    // DeepState odmieta (451, kým nepríde súhlas), takže „zapnutý" znamenal
    // prázdno — a mapa ostala BEZ ZÓN, aj tých z Wikipédie. Keď DeepState
    // nekreslí nič, niet čo prekrývať.
    control?.setZonesVisible?.(!(st.shown && st.features > 0));
    if (!st.shown) { dsLine.textContent = ''; renderAge(dsAge, null, DEEPSTATE_STALE_DAYS); dsArea.textContent = ''; return; }
    renderAge(dsAge, st.at, DEEPSTATE_STALE_DAYS);
    if (st.at) dsLine.textContent = translate('ukraine.ds.since', { date: st.stampText });
    else if (!st.loading && !dsLine.textContent) dsLine.textContent = translate('ukraine.ds.missing');
    const a = st.areaKm2;
    dsArea.textContent = a ? translate('ukraine.ds.area', { occupied: nf.format(Math.round(a.occupied || 0)), grey: nf.format(Math.round(a.grey || 0)) }) : '';
  }
  function renderDamage() {
    if (!damage || !dmgChip) return;
    const st = damage.getState();
    dmgChip.classList.toggle('active', st.shown);
    dmgChip.setAttribute('aria-pressed', String(st.shown));
    if (!st.shown) { dmgLine.textContent = ''; return; }
    if (st.error === 'missing') { dmgLine.textContent = translate('ukraine.dmg.missing'); return; }
    if (st.error) { dmgLine.textContent = translate('ukraine.tl.error', { detail: st.error }); return; }
    if (!st.adm3 && st.loading) { dmgLine.textContent = translate('ukraine.tl.loading'); return; }
    dmgLine.textContent = translate('ukraine.dmg.legend', { n: nf.format(st.damaged), h: nf.format(st.adm3), u: nf.format(st.unosat), v: nf.format(st.visibleUnosat) });
  }
  function applyDamageCursor(state) {
    if (!damage) return;
    damage.setCursor(state.mode === 'live' ? null : state.cursor);
  }
  /**
   * Vek zdroja do vlastného prvku vedľa „stav k". Nad prahom pribudne slovo
   * ZASTARANÉ a trieda, ktorá ho zafarbí: samotný dátum nikto neprepočítava,
   * takže päť týždňov stará línia frontu vyzerala rovnako dôveryhodne ako včerajšia.
   */
  function renderAge(node, at, staleDays) {
    if (!node) return;
    const { ageDays: days, stale } = freshnessOf(at, now(), staleDays);
    const text = ageText(days, translate);
    node.textContent = stale ? `${text} · ${translate('ukraine.src.stale')}` : text;
    node.classList.toggle('is-stale', stale);
    node.title = stale ? translate('ukraine.src.stale-note') : '';
  }
  function renderControl() {
    if (!control || !ctlChip) return;
    const st = control.getState();
    ctlChip.classList.toggle('active', st.shown);
    ctlChip.setAttribute('aria-pressed', String(st.shown));
    if (!st.shown) { ctlLine.textContent = ''; renderAge(ctlAge, null, CONTROL_STALE_DAYS); ctlCounts.textContent = ''; return; }
    renderAge(ctlAge, st.revisionAt, CONTROL_STALE_DAYS);
    if (st.revisionAt) ctlLine.textContent = translate('ukraine.ctl.since', { date: shortDay(String(st.revisionAt).slice(0, 10)) + String(st.revisionAt).slice(0, 4) });
    else if (!st.loading && !ctlLine.textContent) ctlLine.textContent = translate('ukraine.ctl.missing');
    const s = st.summary?.settlements;
    ctlCounts.textContent = s ? translate('ukraine.ctl.counts', { ua: nf.format(s.ua), ru: nf.format(s.ru), contested: nf.format(s.contested) }) : '';
  }

  // ── vykreslenie ──────────────────────────────────────────────────────────
  function setTypes(types) {
    _types = types;
    layer.setFilter({ types });
    renderLegend(); renderCounts();
  }
  /** Klik na typ pri „všetky" = sólo tohto typu; potom pridáva/uberá; prázdne = všetky. */
  function toggleType(type) {
    if (!_types) { setTypes(new Set([type])); return; }
    const next = new Set(_types);
    if (next.has(type)) next.delete(type); else next.add(type);
    setTypes(next.size === EVENT_TYPES.length || next.size === 0 ? null : next);
  }
  function renderLegend() {
    const countBy = {};
    for (const e of _events) countBy[e.type] = (countBy[e.type] || 0) + 1;
    allBtn.classList.toggle('active', !_types);
    allBtn.setAttribute('aria-pressed', String(!_types));
    for (const [type, { b, n }] of legendBtns) {
      const on = !_types || _types.has(type);
      b.classList.toggle('active', on && Boolean(_types));
      b.classList.toggle('is-off', Boolean(_types) && !on);
      b.setAttribute('aria-pressed', String(on));
      n.textContent = nf.format(countBy[type] || 0);
      b.hidden = !(countBy[type] || 0) && type !== 'strike' && type !== 'ground';
    }
  }
  function renderCounts() {
    const ls = layer.getState();
    const parts = [translate('ukraine.tl.in-view', { n: nf.format(ls.inView), total: nf.format(ls.total) })];
    const state = clock.getState();
    const rep = state.mode === 'live' ? (_reports[dayKey(state.now)] || store.reportForDay(_reports, state.now)) : store.reportForDay(_reports, state.cursor);
    if (rep && Number.isFinite(rep.total)) parts.push(translate('ukraine.tl.gs', { n: nf.format(rep.total), day: shortDay(rep.day || dayKey(Date.parse(rep.reportedAt || '') || state.cursor)) }));
    const media = mediaInWindow(_events);
    if (media.length) parts.push(translate('ukraine.tl.media', { n: nf.format(media.length) }));
    if (ls.lod === 'cluster' && ls.total) parts.push(translate('ukraine.tl.lod-cluster'));
    counts.textContent = parts.join(' · ');
  }
  function renderMedia() {
    const media = mediaInWindow(_events).slice(0, MEDIA_STRIP_MAX);
    mediaTitle.textContent = translate('ukraine.media.title', { n: nf.format(media.length) });
    mediaStrip.replaceChildren();
    mediaBox.hidden = !media.length;
    for (const m of media) {
      const b = el('button', `oko-ukr-tl-thumb sev-${m.severity || 'minor'}${m.kind === 'video' ? ' is-video' : ''}`);
      b.type = 'button';
      b.style.setProperty('--ukr-accent', SEV_COLOR[m.severity] || SEV_COLOR.minor);
      if (m.thumb) {
        const img = doc.createElement('img'); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
        img.src = `${IMG_API}?url=${encodeURIComponent(m.thumb)}`;
        img.addEventListener('error', () => { img.remove(); b.classList.add('is-noimg'); });
        b.appendChild(img);
      } else b.classList.add('is-noimg');
      b.appendChild(el('span', 'oko-ukr-tl-thumb-glyph', m.kind === 'video' ? '▶' : (TYPE_GLYPH[m.type] || '▣')));
      const cap = el('span', 'oko-ukr-tl-thumb-cap', [m.place, m.channel].filter(Boolean).join(' · '));
      b.appendChild(cap);
      b.title = `${m.title || ''}${m.place ? ` · ${m.place}` : ''}`;
      b.addEventListener('click', () => { layer.select(m.eventId); layer.openMedia(m, { title: m.title, list: media.filter((x) => x.eventId === m.eventId) }); });
      mediaStrip.appendChild(b);
    }
  }
  function drawHistogram() {
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return;
    const w = Math.max(10, Math.floor(track.clientWidth || 600));
    if (canvas.width !== w) canvas.width = w;
    const h = canvas.height;
    const range = clock.range();
    const { bins, max } = histogramBins(range, _events, _summary?.days || null, { bins: Math.max(24, Math.min(240, Math.floor(w / 4))) });
    ctx.clearRect(0, 0, w, h);
    const bw = w / bins.length;
    for (const b of bins) {
      if (!b.count) continue;
      const bh = Math.max(1, Math.round((b.count / (max || 1)) * (h - 4)));
      const x = Math.floor(b.i * bw);
      ctx.fillStyle = 'rgba(57, 208, 255, 0.55)';
      ctx.fillRect(x, h - bh, Math.max(1, Math.ceil(bw) - 1), bh);
      if (b.critical) {
        const ch = Math.max(1, Math.round((b.critical / (max || 1)) * (h - 4)));
        ctx.fillStyle = 'rgba(248, 113, 113, 0.85)';
        ctx.fillRect(x, h - ch, Math.max(1, Math.ceil(bw) - 1), ch);
      }
    }
    // os: začiatok, stred, koniec
    const fmt = (ms) => { const d = new Date(ms); return range.end - range.start > 2 * D ? `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${range.end - range.start > 400 * D ? d.getUTCFullYear() : ''}` : `${String(d.getUTCHours()).padStart(2, '0')}:00`; };
    axis.replaceChildren(el('span', '', fmt(range.start)), el('span', '', fmt((range.start + range.end) / 2)), el('span', '', clock.mode === 'live' ? translate('ukraine.tl.live-now') : fmt(range.end)));
    positionCursor();
  }
  function drawCoverage() {
    coverage.replaceChildren();
    const range = clock.range();
    const span = range.end - range.start;
    const days = _summary?.days ? Object.entries(_summary.days).filter(([, r]) => (r.news || 0) + (r.media || 0) > 0).map(([d]) => d) : [...new Set([...(_coverage?.news || []), ...(_coverage?.media || [])])];
    if (span <= 0 || !days.length) return;
    const dayW = Math.max(1, (D / span) * 100);
    for (const day of days) {
      const t = Date.parse(`${day}T00:00:00Z`);
      if (!Number.isFinite(t) || t + D < range.start || t > range.end) continue;
      const seg = el('i', 'oko-ukr-tl-cov');
      seg.style.left = `${Math.max(0, ((t - range.start) / span) * 100)}%`;
      seg.style.width = `${Math.min(100, dayW)}%`;
      coverage.appendChild(seg);
    }
  }
  function positionCursor() {
    const state = clock.getState();
    const span = state.range.end - state.range.start;
    const frac = span > 0 ? (state.cursor - state.range.start) / span : 1;
    cursorLine.style.left = `${Math.max(0, Math.min(100, frac * 100))}%`;
    cursor.textContent = cursorText(state, translate);
    modeBtn.textContent = state.mode === 'live' ? translate('ukraine.tl.live') : translate('ukraine.tl.replay');
    modeBtn.classList.toggle('is-live', state.mode === 'live');
    modeBtn.classList.toggle('is-replay', state.mode !== 'live');
    playBtn.textContent = state.playing ? '❚❚' : '▶︎';
    playBtn.title = translate(state.playing ? 'ukraine.tl.pause' : 'ukraine.tl.play');
    for (const [id, b] of winBtns) { const on = id === state.windowId; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); }
    if (speed.value !== state.speedId) speed.value = state.speedId;
  }

  // ── interakcia s pásom ───────────────────────────────────────────────────
  const fractionAt = (clientX) => { const r = track.getBoundingClientRect?.(); if (!r || !r.width) return null; return (clientX - r.left) / r.width; };
  track.addEventListener('pointerdown', (e) => { const f = fractionAt(e.clientX); if (f === null) return; _dragging = true; try { track.setPointerCapture?.(e.pointerId); } catch { /* */ } clock.pause(); clock.scrub(f); });
  track.addEventListener('pointermove', (e) => { if (!_dragging) return; const f = fractionAt(e.clientX); if (f !== null) clock.scrub(f); });
  const endDrag = () => { _dragging = false; };
  track.addEventListener('pointerup', endDrag); track.addEventListener('pointercancel', endDrag);
  root.addEventListener('keydown', (e) => {
    if (e.target === speed) return;
    if (e.key === ' ') { e.preventDefault(); clock.toggle(); } else if (e.key === 'ArrowLeft') { e.preventDefault(); clock.step(-1); } else if (e.key === 'ArrowRight') { e.preventDefault(); clock.step(+1); }
  });
  root.tabIndex = 0;

  // ── slučka prehrávania a LIVE obnova ─────────────────────────────────────
  // Časovač, nie requestAnimationFrame: rAF v skrytej karte/pane stojí (overené
  // 2026-09-19 v pane: 1 snímok za sekundu) a kurzor by nešiel; 10 Hz stačí.
  function frame() {
    _rafId = null;
    if (_destroyed || !_shown) return;
    const ts = now();
    const dt = _lastFrame ? Math.min(1000, ts - _lastFrame) : 0;
    _lastFrame = ts;
    if (clock.playing) { clock.tick(dt); _rafId = setTimer(frame, PLAY_TICK_MS); } else _lastFrame = 0;
  }
  const unsubscribeClock = clock.onChange((state, reason) => {
    positionCursor();
    if (reason === 'window') { drawHistogram(); void loadSummary(); }
    if (reason === 'play' && !_rafId) { _lastFrame = 0; _rafId = setTimer(frame, PLAY_TICK_MS); }
    if (reason === 'tick') { drawHistogram(); scheduleLoad(SCRUB_DEBOUNCE_MS); return; }
    if (reason === 'mode' || reason === 'cursor' || reason === 'window' || reason === 'end' || reason === 'play') scheduleLoad(reason === 'cursor' ? SCRUB_DEBOUNCE_MS : 0);
  });
  const unsubscribeLayer = layer.onChange(() => { if (_shown) renderCounts(); });
  const unsubscribeControl = control?.onChange?.(() => {
    renderControl();
    if (!control.isShown()) { _controlDay = null; return; } // po skrytí sa pri ďalšom zapnutí snímka natiahne znova
    const st = control.getState();
    if (!st.points && !st.loading) void applyControl(clock.getState());
  }) || null;
  const unsubscribeDamage = damage?.onChange?.(() => renderDamage()) || null;
  const unsubscribeDeepState = deepstate?.onChange?.(() => {
    renderDeepState();
    if (!deepstate.isShown()) { _deepstateDay = null; return; }
    const st = deepstate.getState();
    if (!st.features && !st.loading) void applyDeepState(clock.getState());
  }) || null;

  async function share() {
    const url = shareUrl({ origin, front: _activeScene || 'front', state: clock.getState() });
    try { await clipboard?.writeText?.(url); status.textContent = translate('ukraine.tl.shared'); status.dataset.state = 'ready'; } catch { status.textContent = url; }
    return url;
  }

  // Otvorený pás zdvihne spodné rohy (kredity, mikrofón) o svoju výšku — CSS
  // premenná na <html>, trieda na <body> (style.css: body.oko-ukr-tl-open).
  let resizeObserver = null;
  // Dok príkazov a kredity Cesia/Google sú modelované prvky (creditAttribution
  // test stráži ich geometriu v style.css) — zdvih dostanú inline, ostatné cez CSS.
  const LIFTED_INLINE = ['#command-dock', '#cesium-credits'];
  function applyInlineLift(px) {
    for (const sel of LIFTED_INLINE) {
      const node = doc.querySelector?.(sel);
      if (node?.style) node.style.marginBottom = px ? `${px}px` : '';
    }
  }
  function measureLift() {
    const h = root.offsetHeight || 0;
    const px = h ? h + 22 : 0;
    try { doc.documentElement?.style?.setProperty?.('--oko-ukr-tl-lift', `${px}px`); } catch { /* */ }
    applyInlineLift(px);
  }
  function setOpenClass(open) {
    try { doc.body?.classList?.toggle?.('oko-ukr-tl-open', open); } catch { /* */ }
    if (open) {
      measureLift();
      if (!resizeObserver && typeof globalThis.ResizeObserver === 'function') { resizeObserver = new globalThis.ResizeObserver(() => measureLift()); try { resizeObserver.observe(root); } catch { /* */ } }
    } else {
      try { doc.documentElement?.style?.setProperty?.('--oko-ukr-tl-lift', '0px'); } catch { /* */ }
      applyInlineLift(0);
      if (resizeObserver) { try { resizeObserver.disconnect(); } catch { /* */ } resizeObserver = null; }
    }
  }

  // ── verejné API ──────────────────────────────────────────────────────────
  function show() {
    if (_destroyed || _shown) return;
    _shown = true;
    root.hidden = false;
    setOpenClass(true);
    layer.show();
    positionCursor();
    void load();
    void loadSummary();
    if (_liveTimer) clearTimer(_liveTimer);
    _liveTimer = setTimer(function tick() { if (_destroyed || !_shown) return; if (clock.mode === 'live' && !clock.playing) scheduleLoad(0); _liveTimer = setTimer(tick, LIVE_REFRESH_MS); }, LIVE_REFRESH_MS);
    emit();
  }
  function hide() {
    if (!_shown) return;
    _shown = false;
    root.hidden = true;
    setOpenClass(false);
    clock.pause();
    if (_rafId) { clearTimer(_rafId); _rafId = null; }
    if (_liveTimer) { clearTimer(_liveTimer); _liveTimer = null; }
    if (_loadTimer) { clearTimer(_loadTimer); _loadTimer = null; }
    layer.hide();
    report?.setOverride?.(null);
    emit();
  }
  function setActiveScene(id) { _activeScene = id || null; }
  function getState() {
    return { shown: _shown, events: _events.length, error: _error, clock: clock.getState(), types: _types ? [..._types] : null, reports: Object.keys(_reports).length, activeScene: _activeScene };
  }
  function destroy() {
    _destroyed = true;
    hide();
    unsubscribeClock?.(); unsubscribeLayer?.(); unsubscribeControl?.(); unsubscribeDeepState?.(); unsubscribeDamage?.();
    try { root.remove(); } catch { /* */ }
    listeners.clear();
  }

  return {
    element: root,
    show, hide, isShown: () => _shown, setActiveScene, refresh: () => load(), getState, share, clock, store, showControl, showDeepState,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy,
    _getStateForTest: () => ({ root, canvas, legendBtns, mediaStrip, counts, status, cursorLine, winBtns, playBtn, modeBtn, ctlChip, ctlLine, ctlAge, ctlCounts, dsChip, dsLine, dsAge, dsArea, dmgChip, dmgLine }),
  };
}
