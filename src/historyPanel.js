// src/historyPanel.js
/**
 * @module historyPanel
 * @description Panel „História letov" (2026-09-07, používateľ: „chcem
 * spätne nájsť let, trackovať ho, dobré grafické zobrazenie"): vyhľadanie
 * úseku (volací znak alebo hex) v zázname proxy, zoznam výsledkov, detail
 * s grafom výšky a rýchlosti, prehrávanie na glóbuse (flightReplay.js)
 * s posuvníkom času, rýchlosťou a sledovaním kamerou.
 *
 * DOM sa skladá tu z literálov (ako ostatné panely); dáta a výpočty sú v
 * data/flightHistory.js, kreslenie grafu v flightHistoryChart.js — obe
 * čisté a testované. Jednotky cez units.js (prepínač FT/KTS ↔ M/KM/H).
 */
import {
  HISTORY_SEARCH_HOURS,
  chartSeries,
  fetchFlightTrack,
  fetchHistoryStatus,
  formatClockUtc,
  formatDuration,
  legTitle,
  searchFlightHistory,
  trackSummary,
} from './data/flightHistory.js';
import { drawFlightChart } from './flightHistoryChart.js';
import { REPLAY_SPEEDS, createFlightReplay } from './flightReplay.js';
import { formatAltitude, formatSpeed, formatThousands, formatVerticalRateMagnitude, onUnitSystemChange } from './units.js';
import { verticalTrendGlyph } from './data/flightProgress.js';

export const HISTORY_PANEL_ID = 'history-panel';
export const HISTORY_CHART_HEIGHT_PX = 120;

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Riadok výsledku. Pure nad vstupmi (vracia texty, DOM skladá volajúci).
 * @param {object} leg
 * @param {(k: string, v?: object) => string} t
 */
export function legRowModel(leg, t) {
  const title = legTitle(leg);
  const sub = [
    String(leg.icao24 || '').toUpperCase(),
    leg.country || '',
    `${formatClockUtc(leg.firstT)}–${formatClockUtc(leg.lastT)} UTC`,
    Number.isFinite(leg.maxAltM) && leg.maxAltM > 0 ? t('history.max-alt', { alt: formatAltitude(leg.maxAltM) }) : '',
    t('history.fix-count', { n: leg.fixes }),
  ].filter(Boolean).join(' · ');
  const alert = (leg.squawks || []).find((s) => ['7500', '7600', '7700'].includes(s)) || null;
  return { title, sub, alert };
}

/**
 * Riadok aktuálneho času prehrávania. Pure.
 * @param {object|null} sample interpolateFix výstup
 * @param {(k: string, v?: object) => string} t
 */
export function sampleLine(sample, t) {
  if (!sample) return '';
  const parts = [`${formatClockUtc(sample.t)} UTC`];
  if (sample.gnd) parts.push(t('hover.on-ground'));
  else if (Number.isFinite(sample.alt)) {
    const glyph = verticalTrendGlyph(sample.vr);
    parts.push(`${formatAltitude(sample.alt)}${glyph}${glyph ? ` ${formatVerticalRateMagnitude(sample.vr)}` : ''}`);
  }
  if (Number.isFinite(sample.gs)) parts.push(formatSpeed(sample.gs));
  if (Number.isFinite(sample.trk)) parts.push(`${String(Math.round(sample.trk)).padStart(3, '0')}°`);
  if (sample.squawk && ['7500', '7600', '7700'].includes(sample.squawk)) parts.push(`SQUAWK ${sample.squawk}`);
  return parts.join(' · ');
}

/**
 * @param {object} options
 * @param {object} options.viewer
 * @param {Document} [options.doc]
 * @param {(k: string, v?: object) => string} options.t
 * @param {object} [options.api] { search, track, status } (test seam)
 * @param {Function} [options.replayFactory]
 * @param {(icao24: string) => void} [options.onTrackLive] zapni živé sledovanie hexu
 * @param {(collapsed: boolean) => void} [options.setCollapsed] otvor panel z kontextového menu
 */
export function installHistoryPanel({
  viewer,
  doc = globalThis.document,
  t,
  api = { search: searchFlightHistory, track: fetchFlightTrack, status: fetchHistoryStatus },
  replayFactory = createFlightReplay,
  onTrackLive = null,
  setCollapsed = null,
} = {}) {
  const root = doc?.getElementById?.(HISTORY_PANEL_ID);
  const body = root?.querySelector?.('[data-history-body]');
  if (!root || !body) return null;
  const replay = replayFactory(viewer);
  let legs = [];
  let currentLeg = null;
  let currentFixes = [];
  let series = null;
  let searchToken = 0;

  // ── vyhľadávanie ────────────────────────────────────────────────
  const searchRow = el(doc, 'div', 'history-row');
  const input = el(doc, 'input', 'history-input');
  input.type = 'search';
  input.placeholder = t('history.search-placeholder');
  input.setAttribute('aria-label', t('history.search-placeholder'));
  const hours = el(doc, 'select', 'history-hours');
  for (const h of HISTORY_SEARCH_HOURS) {
    const opt = el(doc, 'option', '', t(h < 48 ? 'history.hours-one-day' : 'history.hours-days', { d: Math.round(h / 24) }));
    opt.value = String(h);
    hours.appendChild(opt);
  }
  const searchBtn = el(doc, 'button', 'scene-btn history-search-btn', t('history.search'));
  searchBtn.type = 'button';
  searchRow.append(input, hours, searchBtn);
  const status = el(doc, 'div', 'history-status', '');
  const list = el(doc, 'ol', 'history-list');
  list.setAttribute('aria-live', 'polite');

  // ── detail ──────────────────────────────────────────────────────
  const detail = el(doc, 'section', 'history-detail');
  detail.hidden = true;
  const detailHead = el(doc, 'div', 'history-detail-head');
  const backBtn = el(doc, 'button', 'scene-btn history-back-btn', t('history.back'));
  backBtn.type = 'button';
  const title = el(doc, 'strong', 'history-title', '');
  detailHead.append(backBtn, title);
  const stats = el(doc, 'div', 'history-stats', '');
  const canvas = el(doc, 'canvas', 'history-chart');
  canvas.height = HISTORY_CHART_HEIGHT_PX;
  const sampleRow = el(doc, 'div', 'history-sample', '');
  const slider = el(doc, 'input', 'history-slider');
  slider.type = 'range'; slider.min = '0'; slider.max = '1000'; slider.value = '0';
  slider.setAttribute('aria-label', t('history.time'));
  const controls = el(doc, 'div', 'history-controls');
  const playBtn = el(doc, 'button', 'scene-btn history-play', t('history.play'));
  playBtn.type = 'button';
  const speedWrap = el(doc, 'div', 'history-speeds');
  const speedBtns = REPLAY_SPEEDS.map((x) => {
    const b = el(doc, 'button', 'history-speed', `${x}×`);
    b.type = 'button';
    b.dataset.speed = String(x);
    b.addEventListener('click', () => replay.setSpeed(x));
    speedWrap.appendChild(b);
    return b;
  });
  const followBtn = el(doc, 'button', 'scene-btn history-follow', t('history.follow'));
  followBtn.type = 'button';
  followBtn.setAttribute('aria-pressed', 'false');
  const liveBtn = el(doc, 'button', 'scene-btn history-live', t('history.live'));
  liveBtn.type = 'button';
  liveBtn.hidden = !onTrackLive;
  controls.append(playBtn, speedWrap, followBtn, liveBtn);
  detail.append(detailHead, stats, canvas, sampleRow, slider, controls);
  body.append(searchRow, status, list, detail);

  // ── render ──────────────────────────────────────────────────────
  function drawChart(state) {
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return;
    const width = Math.max(120, Math.floor(canvas.clientWidth || body.clientWidth || 320));
    const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
    if (canvas.height !== Math.round(HISTORY_CHART_HEIGHT_PX * dpr)) canvas.height = Math.round(HISTORY_CHART_HEIGHT_PX * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${HISTORY_CHART_HEIGHT_PX}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFlightChart(ctx, series, {
      width,
      height: HISTORY_CHART_HEIGHT_PX,
      cursorFrac: state?.fraction ?? null,
      altLabel: series?.altMaxM ? t('history.max-alt', { alt: formatAltitude(series.altMaxM) }) : '',
      gsLabel: series?.gsMaxMps ? t('history.max-speed', { speed: formatSpeed(series.gsMaxMps) }) : '',
      startLabel: series ? formatClockUtc(series.startT) : '',
      endLabel: series ? formatClockUtc(series.endT) : '',
    });
  }

  function renderState(state) {
    if (!state?.loaded) return;
    playBtn.textContent = t(state.playing ? 'history.pause' : 'history.play');
    for (const b of speedBtns) b.classList.toggle('active', Number(b.dataset.speed) === state.speed);
    followBtn.setAttribute('aria-pressed', state.follow ? 'true' : 'false');
    followBtn.classList.toggle('active', state.follow);
    if (doc.activeElement !== slider) slider.value = String(Math.round(state.fraction * 1000));
    sampleRow.textContent = sampleLine(state.sample, t);
    drawChart(state);
  }
  replay.onChange(renderState);

  function renderList() {
    list.textContent = '';
    if (!legs.length) {
      list.appendChild(el(doc, 'li', 'history-empty', t('history.no-results')));
      return;
    }
    for (const leg of legs) {
      const row = legRowModel(leg, t);
      const li = el(doc, 'li', `history-leg${row.alert ? ' history-leg--alert' : ''}`);
      const btn = el(doc, 'button', 'history-leg-btn');
      btn.type = 'button';
      btn.append(el(doc, 'span', 'history-leg-title', row.title), el(doc, 'span', 'history-leg-sub', row.sub));
      if (row.alert) btn.appendChild(el(doc, 'span', 'history-leg-alert', `SQUAWK ${row.alert}`));
      btn.addEventListener('click', () => { void openLeg(leg); });
      li.appendChild(btn);
      list.appendChild(li);
    }
  }

  async function refreshStatus() {
    try {
      const st = await api.status();
      status.textContent = st?.fixes
        ? t('history.status', { since: st.oldestT ? formatClockUtc(st.oldestT) : '--:--', legs: formatThousands(st.legs) })
        : t('history.status-empty');
      status.dataset.state = 'ok';
    } catch {
      status.textContent = t('history.unavailable');
      status.dataset.state = 'error';
    }
  }

  async function runSearch() {
    const token = ++searchToken;
    status.textContent = t('history.searching');
    try {
      const found = await api.search(input.value, { hours: Number(hours.value) || 24 });
      if (token !== searchToken) return;
      legs = found;
      renderList();
      status.textContent = t('history.results', { n: legs.length });
    } catch {
      if (token !== searchToken) return;
      legs = [];
      renderList();
      status.textContent = t('history.unavailable');
    }
  }

  async function openLeg(leg) {
    currentLeg = leg;
    title.textContent = legTitle(leg);
    stats.textContent = t('history.loading');
    detail.hidden = false;
    list.hidden = true;
    searchRow.hidden = true;
    try {
      const fixes = await api.track(leg.icao24, { fromS: leg.firstT - 60, toS: leg.lastT + 60 });
      if (currentLeg !== leg) return;
      currentFixes = fixes;
      const summary = trackSummary(fixes);
      series = chartSeries(fixes);
      if (!summary) {
        stats.textContent = t('history.too-short');
        return;
      }
      stats.textContent = [
        formatDuration(summary.durationS),
        `${formatThousands(summary.distanceKm)} km`,
        summary.maxAltM ? t('history.max-alt', { alt: formatAltitude(summary.maxAltM) }) : '',
        summary.maxGsMps ? t('history.max-speed', { speed: formatSpeed(summary.maxGsMps) }) : '',
        t('history.fix-count', { n: summary.fixes }),
        leg.src ? t('history.source', { src: leg.src }) : '',
      ].filter(Boolean).join(' · ');
      replay.load(fixes);
      replay.frame();
      renderState(replay.getState());
    } catch {
      if (currentLeg !== leg) return;
      stats.textContent = t('history.unavailable');
    }
  }

  function closeLeg() {
    if (!currentLeg && detail.hidden) return; // nič otvorené — nechaj prehrávač na pokoji
    replay.pause();
    replay.setFollow(false);
    replay.load([]);
    currentLeg = null;
    currentFixes = [];
    series = null;
    detail.hidden = true;
    list.hidden = false;
    searchRow.hidden = false;
  }

  // ── udalosti ────────────────────────────────────────────────────
  searchBtn.addEventListener('click', () => { void runSearch(); });
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); void runSearch(); } });
  hours.addEventListener('change', () => { if (legs.length || input.value) void runSearch(); });
  backBtn.addEventListener('click', closeLeg);
  playBtn.addEventListener('click', () => replay.toggle());
  followBtn.addEventListener('click', () => replay.setFollow(followBtn.getAttribute('aria-pressed') !== 'true'));
  liveBtn.addEventListener('click', () => { if (currentLeg && onTrackLive) onTrackLive(currentLeg.icao24); });
  slider.addEventListener('input', () => replay.seekFraction(Number(slider.value) / 1000));
  onUnitSystemChange(() => renderState(replay.getState()));
  void refreshStatus();

  return {
    /** Otvor panel s dopytom (kontextové menu: „História tohto stroja"). */
    open({ query = '' } = {}) {
      setCollapsed?.(false);
      closeLeg();
      input.value = String(query || '');
      void runSearch();
    },
    refreshStatus,
    replay,
    _getStateForTest() { return { legs: legs.length, currentLeg, fixes: currentFixes.length, detailOpen: !detail.hidden }; },
    destroy() { replay.destroy(); },
  };
}
