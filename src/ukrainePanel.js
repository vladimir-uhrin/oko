// src/ukrainePanel.js — telo panela UKRAJINA v ľavej lište DÁTA (modul
// UKRAJINA, etapa 1, 2026-09-19; plán docs/drafts/ukrajina-plan.md).
//
// Rovnaký vzor ako bulletin ZÁLIV (conflictBulletin.js): modul NIČ nepolohuje —
// kreslí do tela panela, ktoré mu podá main.js; panel vlastní umiestnenie,
// zbalenie, výšku aj mobilný výsuv. Žiadne innerHTML, DOM cez vložený
// `document`, aby sa dal testovať v Node.
//
// Obsah etapy 1: stav snímku (dátum, ODbL), tlačidlo podkladu, čipy častí
// (sídla / cesty / rieky / oblasti), zoznam smerov frontu (presety kamery)
// a poctivá poznámka, že kontrola územia, udalosti a správy ešte nie sú —
// nič v tomto paneli nie je línia frontu.

import { currentLanguage, t } from './i18n.js';
import { UKRAINE_BASE_PARTS } from './data/ukraineBase.js';
import { frontSceneLabel, listFrontScenes } from './ukraineFrontScenes.js';

const INERT = { element: null, newsMount: null, update() {}, updateReport() {}, setActiveScene() {}, destroy() {} };

/**
 * @param {object} o
 * @param {Element|null} o.mountTarget prázdny prvok tela panela (`#ukraine-panel [data-ukraine-body]`)
 * @param {object} o.layer prekryv podkladu (createUkraineBaseLayer)
 * @param {ReadonlyArray<object>} [o.scenes] presety smerov
 * @param {(id: string) => any} [o.applyScene] spustí preset (main.js)
 * @param {Function} [o.translate]
 * @param {string} [o.lang]
 * @param {Document} [o.documentRef]
 */
export function createUkrainePanel({
  mountTarget = null,
  layer = null,
  report = null,
  timeline = null,
  control = null,
  scenes = listFrontScenes(),
  applyScene = null,
  translate = t,
  lang = currentLanguage(),
  documentRef = globalThis.document,
} = {}) {
  const doc = documentRef;
  if (!doc?.createElement || !mountTarget || !layer) return INERT;
  const linkify = (a, href) => { a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; };

  const el = (tag, className = '', text = null) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const button = (className, text, onClick) => {
    const b = el('button', className, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };
  const numberFormat = new Intl.NumberFormat(lang === 'sk' ? 'sk-SK' : 'en-GB');

  // ── Kostra (raz) ──────────────────────────────────────────────────────────
  const status = el('div', 'ukraine-status gas-status');
  status.dataset.state = 'idle';
  const row = el('div', 'ukraine-row');
  const toggle = button('panel-layer-toggle ukraine-toggle', translate('ukraine.base.show'), () => { void layer.toggle(); });
  toggle.setAttribute('aria-pressed', 'false');
  row.appendChild(toggle);
  const chips = el('div', 'ukraine-chips');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', translate('ukraine.base.title'));
  const chipByPart = new Map();
  for (const part of UKRAINE_BASE_PARTS) {
    const chip = button('data-toggle-chip ukraine-chip', translate(`ukraine.part.${part}`), () => {
      const parts = layer.getParts();
      layer.setPart(part, !parts[part]);
    });
    chip.dataset.part = part;
    chip.setAttribute('aria-pressed', 'true');
    chips.appendChild(chip);
    chipByPart.set(part, chip);
  }
  // Čip STRETY (etapa 2): značky smerov s počtom útokov z hlásenia GŠ — vlastný
  // prekryv, ukazuje sa spolu s podkladom; čip je len jeho vypínač.
  let reportChip = null;
  if (report) {
    reportChip = button('data-toggle-chip ukraine-chip ukraine-chip-report', translate('ukraine.part.report'), () => {
      report.setEnabled(!report.isEnabled());
    });
    reportChip.dataset.part = 'report';
    reportChip.setAttribute('aria-pressed', 'true');
    chips.appendChild(reportChip);
  }
  // Čip UDALOSTI (etapa 3): otvorí/zavrie časovú os s vrstvou udalostí (body,
  // karty, fotky a videá); stav odráža os sama cez onChange.
  // Čip KONTROLA (etapa 4C): body kontroly sídiel + odvodené zóny (Wikipedia, CC BY-SA).
  let controlChip = null;
  if (control) {
    controlChip = button('data-toggle-chip ukraine-chip ukraine-chip-control', translate('ukraine.part.control'), () => {
      if (control.isShown()) control.hide();
      else if (timeline?.showControl) void timeline.showControl();
      else void control.show();
    });
    controlChip.dataset.part = 'control';
    controlChip.setAttribute('aria-pressed', 'false');
    controlChip.title = translate('ukraine.ctl.note');
    chips.appendChild(controlChip);
  }
  let eventsChip = null;
  if (timeline) {
    eventsChip = button('data-toggle-chip ukraine-chip ukraine-chip-events', translate('ukraine.part.events'), () => {
      if (timeline.isShown()) timeline.hide();
      else { if (!layer.isShown?.()) void layer.show(); timeline.show(); }
    });
    eventsChip.dataset.part = 'events';
    eventsChip.setAttribute('aria-pressed', 'false');
    eventsChip.title = translate('ukraine.events.hint');
    chips.appendChild(eventsChip);
  }
  row.appendChild(chips);
  const counts = el('div', 'ukraine-counts');
  counts.hidden = true;
  // Hlásenie GŠ (etapa 2): jedna karta so súhrnom, údermi, poctivou poznámkou a odkazom.
  const reportBox = el('div', 'ukraine-report gas-card');
  reportBox.hidden = true;
  const reportTitle = el('div', 'gas-card-title', translate('ukraine.report.title'));
  const reportSummary = el('div', 'ukraine-report-summary');
  const reportStrikes = el('div', 'ukraine-report-strikes');
  const reportClaim = el('p', 'ukraine-note ukraine-dim', translate('ukraine.report.claim'));
  const reportLink = el('a', 'ukraine-report-link', `${translate('ukraine.report.linkout')} ↗`);
  reportLink.hidden = true;
  const reportSource = el('span', 'ukraine-report-source', translate('ukraine.report.source'));
  const reportFoot = el('div', 'ukraine-report-foot');
  reportFoot.appendChild(reportLink);
  reportFoot.appendChild(reportSource);
  reportBox.appendChild(reportTitle);
  reportBox.appendChild(reportSummary);
  reportBox.appendChild(reportStrikes);
  reportBox.appendChild(reportClaim);
  reportBox.appendChild(reportFoot);
  const dirsTitle = el('div', 'ukraine-section-title gas-card-title', translate('ukraine.directions'));
  const dirs = el('div', 'ukraine-dirs');
  dirs.setAttribute('role', 'group');
  dirs.setAttribute('aria-label', translate('ukraine.directions'));
  const dirByScene = new Map();
  const countByScene = new Map();
  for (const scene of scenes) {
    const b = button(`ukraine-dir${scene.overview ? ' is-overview' : ''}`, '', () => {
      setActiveScene(scene.id);
      if (typeof applyScene === 'function') void applyScene(scene.id);
    });
    b.appendChild(el('span', 'ukraine-dir-name', frontSceneLabel(scene, translate)));
    const count = el('span', 'ukraine-dir-count');
    count.hidden = true;
    b.appendChild(count);
    b.dataset.front = scene.id;
    b.setAttribute('aria-pressed', 'false');
    dirs.appendChild(b);
    dirByScene.set(scene.id, b);
    countByScene.set(scene.id, count);
  }
  // Správy z otvorených zdrojov (etapa 2): telo plní conflictBulletin z main.js.
  const newsTitle = el('div', 'ukraine-section-title gas-card-title', translate('ukraine.news.title'));
  const news = el('div', 'ukraine-news');
  news.dataset.ukraineNews = '';
  const note = el('p', 'ukraine-note', translate('ukraine.next-stages'));
  const namesNote = el('p', 'ukraine-note ukraine-dim', translate('ukraine.names-note'));
  mountTarget.replaceChildren(status, row, counts, reportBox, dirsTitle, dirs, newsTitle, news, note, namesNote);

  // ── Stav ──────────────────────────────────────────────────────────────────
  function statusFor(state) {
    if (state.error === 'no_snapshot') return { text: translate('ukraine.base.missing'), kind: 'error' };
    if (state.error) return { text: translate('ukraine.base.error', { detail: state.error }), kind: 'error' };
    if (state.loading) return { text: translate('ukraine.base.loading'), kind: 'loading' };
    if (state.snapshotDate) return { text: translate('ukraine.base.status', { date: state.snapshotDate }), kind: state.shown ? 'ready' : 'idle' };
    return { text: translate('ukraine.base.idle'), kind: 'idle' };
  }

  function countsFor(meta) {
    const ds = meta?.datasets;
    if (!ds) return null;
    const places = (ds.places?.features || 0) + (ds.villages?.features || 0);
    const roads = ds.roads?.lengthKm || 0;
    const oblasts = meta?.counts?.oblasts || 0;
    if (!places && !roads) return null;
    return translate('ukraine.base.counts', { places: numberFormat.format(places), roads: numberFormat.format(roads), oblasts: numberFormat.format(oblasts) });
  }

  function update(state = layer.getState()) {
    const s = statusFor(state);
    status.textContent = s.text;
    status.dataset.state = s.kind;
    toggle.textContent = translate(state.shown ? 'ukraine.base.hide' : 'ukraine.base.show');
    toggle.setAttribute('aria-pressed', String(Boolean(state.shown)));
    toggle.classList?.toggle?.('active', Boolean(state.shown));
    toggle.disabled = Boolean(state.loading);
    for (const [part, chip] of chipByPart) {
      const on = Boolean(state.parts?.[part]);
      chip.classList?.toggle?.('active', on);
      chip.setAttribute('aria-pressed', String(on));
    }
    const text = countsFor(state.meta);
    counts.textContent = text || '';
    counts.hidden = !text;
  }

  let activeScene = null;
  function setActiveScene(id) {
    activeScene = id || null;
    for (const [sceneId, b] of dirByScene) {
      const on = sceneId === activeScene;
      b.classList?.toggle?.('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  /** Hlásenie GŠ do karty a počty na tlačidlá smerov (etapa 2). */
  function updateReport(state = report?.getState?.()) {
    if (!report || !state) return;
    if (reportChip) {
      reportChip.classList?.toggle?.('active', Boolean(state.enabled));
      reportChip.setAttribute('aria-pressed', String(Boolean(state.enabled)));
    }
    const r = state.report;
    if (!r) {
      reportBox.hidden = !(state.loading || state.error);
      reportSummary.textContent = state.loading ? translate('ukraine.report.loading') : (state.error ? translate('ukraine.report.unavailable') : '');
      reportStrikes.textContent = '';
      reportLink.hidden = true;
      for (const count of countByScene.values()) count.hidden = true;
      return;
    }
    reportBox.hidden = false;
    reportSummary.textContent = translate('ukraine.report.summary', { total: r.total ?? '?', time: r.reportedAtText || '?' });
    const s = r.strikes || {};
    const fmt = (v) => (Number.isFinite(v) ? numberFormat.format(v) : '?');
    reportStrikes.textContent = translate('ukraine.report.strikes', { air: fmt(s.airStrikes), bombs: fmt(s.guidedBombs), drones: fmt(s.kamikazeDrones), shellings: fmt(s.shellings) });
    if (r.url) { linkify(reportLink, r.url); reportLink.hidden = false; } else reportLink.hidden = true;
    for (const [sceneId, count] of countByScene) {
      const entry = state.byScene?.[sceneId];
      if (!entry) { count.hidden = true; continue; }
      const n = entry.attacks;
      count.hidden = false;
      count.textContent = n === null || n === undefined ? '—' : String(n);
      count.className = `ukraine-dir-count ${n === null || n === undefined ? 'is-unknown' : (n <= 0 ? 'is-quiet' : (n >= 25 ? 'is-high' : (n >= 10 ? 'is-mid' : 'is-low')))}`;
    }
  }

  const unsubscribe = layer.onChange((state) => update(state));
  const unsubscribeReport = report?.onChange?.((state) => updateReport(state)) || null;
  const updateEventsChip = () => {
    if (!eventsChip) return;
    const on = Boolean(timeline?.isShown?.());
    eventsChip.classList?.toggle?.('active', on);
    eventsChip.setAttribute('aria-pressed', String(on));
  };
  const unsubscribeTimeline = timeline?.onChange?.(() => updateEventsChip()) || null;
  updateEventsChip();
  const updateControlChip = () => {
    if (!controlChip) return;
    const on = Boolean(control?.isShown?.());
    controlChip.classList?.toggle?.('active', on);
    controlChip.setAttribute('aria-pressed', String(on));
  };
  const unsubscribeControl = control?.onChange?.(() => updateControlChip()) || null;
  updateControlChip();
  update();
  updateReport();
  // Dátum snímku je lacný a hovorí, či snímok vôbec existuje — ťahá sa hneď.
  void layer.loadMeta?.();

  return {
    element: mountTarget,
    newsMount: news,
    update,
    updateReport,
    setActiveScene,
    get activeScene() { return activeScene; },
    destroy() { unsubscribe?.(); unsubscribeReport?.(); unsubscribeTimeline?.(); unsubscribeControl?.(); mountTarget.replaceChildren(); },
  };
}
