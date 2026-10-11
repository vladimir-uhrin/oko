// src/shipHistoryPanel.js
/**
 * @module shipHistoryPanel
 * @description História lodí v paneli História (2026-10-11, bod 7 zo zoznamu vylepšení:
 * „história lodí ako história letov — prehrať trasu v paneli"). Karta LODE vedľa LIETADLÁ:
 * vyhľadanie lode (meno alebo MMSI), rozsah 1 deň … 1 rok, graf rýchlosti, posuvník času,
 * prehrávanie na glóbuse (trasa s príjmom plne, medzery mimo pokrytia prerušovane — pravidlo 2:
 * priamka cez medzeru nie je meraná poloha). Dáta zo záznamu na disku (/api/ais-live/history).
 *
 * Panel letov (historyPanel.js) sa nemení: karta LODE skryje jeho obsah cez data-mode na tele
 * panelu a vráti ho pri LIETADLÁ.
 */
import * as Cesium from 'cesium';
import { ReplayClock } from './flightReplay.js';
import { currentLanguage } from './i18n.js';
import { governorRequestRender } from './renderGovernor.js';
import { lookupVesselInfo } from './data/vesselInfo.js';
import {
  SHIP_HISTORY_RANGES,
  SHIP_REPLAY_SPEEDS,
  fetchShipHistory,
  interpolateShipSample,
  shipHistorySummary,
  shipSampleLine,
  shipSpeedSeries,
  shipSummaryLine,
  splitShipRuns,
} from './data/shipHistory.js';

const ROUTE_COLOR = '#5fd0e6';
/** Výška čiary nad hladinou (m) — pri 0 m sa čiara s morom „bije" a rozpadne na kúsky. */
const ROUTE_LIFT_M = 30;
const lifted = (pts) => Cesium.Cartesian3.fromDegreesArrayHeights(pts.flatMap((s) => [s.lon, s.lat, ROUTE_LIFT_M]));

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Graf rýchlosti v štýle grafu letu (plocha + čiara, kurzor). */
function drawSpeedChart(canvas, series, fraction, label) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) return;
  const dpr = globalThis.devicePixelRatio || 1;
  const w = Math.max(1, canvas.clientWidth || 320);
  const h = Math.max(1, canvas.clientHeight || 120);
  if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
  if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!series) return;
  const pad = { l: 8, r: 8, t: 14, b: 10 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const n = series.values.length;
  ctx.strokeStyle = 'rgba(120, 190, 210, 0.18)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 2; i += 1) { const y = pad.t + (ih * i) / 2; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke(); }
  ctx.fillStyle = 'rgba(95, 208, 230, 0.16)';
  ctx.strokeStyle = 'rgba(95, 208, 230, 0.95)';
  ctx.lineWidth = 1.5;
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      ctx.beginPath();
      ctx.moveTo(run[0][0], pad.t + ih);
      for (const [x, y] of run) ctx.lineTo(x, y);
      ctx.lineTo(run.at(-1)[0], pad.t + ih);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      run.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
    run = [];
  };
  for (let i = 0; i < n; i += 1) {
    const v = series.values[i];
    if (v === null) { flush(); continue; }
    run.push([pad.l + (i / (n - 1)) * iw, pad.t + ih - v * ih]);
  }
  flush();
  ctx.fillStyle = 'rgba(200, 236, 244, 0.9)';
  ctx.font = '9px "JetBrains Mono", monospace';
  ctx.fillText(label, pad.l, 10);
  const x = pad.l + Math.max(0, Math.min(1, fraction)) * iw;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ih); ctx.stroke();
}

/**
 * @param {object} o
 * @param {object} o.viewer
 * @param {HTMLElement} o.host telo panelu História ([data-history-body])
 * @param {(k: string, v?: object) => string} o.t
 * @param {(collapsed: boolean) => void} [o.setCollapsed]
 * @param {() => void} [o.reveal]
 * @param {typeof fetch} [o.fetchImpl]
 */
export function installShipHistoryPanel({ viewer, host, t, setCollapsed = null, reveal = null, fetchImpl = globalThis.fetch?.bind(globalThis) }) {
  if (!host) return null;
  const doc = host.ownerDocument;
  const panelTitle = host.closest?.('#history-panel')?.querySelector?.('.panel-title') || null;
  const flightTitle = panelTitle?.textContent || '';

  // ── karty LIETADLÁ / LODE ─────────────────────────────────────────
  const tabs = el(doc, 'div', 'history-tabs');
  tabs.setAttribute('role', 'tablist');
  const tabFlights = el(doc, 'button', 'history-tab', t('shiphistory.tab-flights'));
  const tabShips = el(doc, 'button', 'history-tab', t('shiphistory.tab-ships'));
  for (const b of [tabFlights, tabShips]) { b.type = 'button'; b.setAttribute('role', 'tab'); tabs.appendChild(b); }

  const section = el(doc, 'section', 'ship-history');
  section.hidden = true;
  const searchRow = el(doc, 'div', 'history-row');
  const input = el(doc, 'input', 'history-input');
  input.type = 'search';
  input.placeholder = t('shiphistory.placeholder');
  input.setAttribute('aria-label', t('shiphistory.placeholder'));
  const range = el(doc, 'select', 'history-hours');
  for (const d of SHIP_HISTORY_RANGES) {
    const opt = el(doc, 'option', '', d === 1 ? t('history.hours-one-day') : t('shiphistory.days', { d }));
    opt.value = String(d);
    if (d === 7) opt.selected = true;
    range.appendChild(opt);
  }
  const searchBtn = el(doc, 'button', 'scene-btn history-search-btn', t('history.search'));
  searchBtn.type = 'button';
  searchRow.append(input, range, searchBtn);
  const status = el(doc, 'div', 'history-status', t('shiphistory.hint'));
  const list = el(doc, 'ol', 'history-list');
  const detail = el(doc, 'section', 'history-detail');
  detail.hidden = true;
  const head = el(doc, 'div', 'history-detail-head');
  const backBtn = el(doc, 'button', 'scene-btn history-back-btn', t('history.back'));
  backBtn.type = 'button';
  const title = el(doc, 'strong', 'history-title', '');
  head.append(backBtn, title);
  const stats = el(doc, 'div', 'history-stats', '');
  const canvas = el(doc, 'canvas', 'history-chart');
  const sampleRow = el(doc, 'div', 'history-sample', '');
  const slider = el(doc, 'input', 'history-slider');
  slider.type = 'range'; slider.min = '0'; slider.max = '1000'; slider.value = '1000';
  slider.setAttribute('aria-label', t('history.time'));
  const controls = el(doc, 'div', 'history-controls');
  const playBtn = el(doc, 'button', 'scene-btn history-play', t('history.play'));
  playBtn.type = 'button';
  const speedWrap = el(doc, 'div', 'history-speeds');
  const speedLabel = (x) => (x < 3600 ? `${x / 60} min/s` : `${x / 3600} h/s`);
  const speedBtns = SHIP_REPLAY_SPEEDS.map((x) => {
    const b = el(doc, 'button', 'history-speed', speedLabel(x));
    b.type = 'button';
    b.title = t('shiphistory.speed-title', { x: speedLabel(x) });
    b.addEventListener('click', () => { clock && (clock.speed = x); syncSpeeds(); });
    speedWrap.appendChild(b);
    return { b, x };
  });
  const followBtn = el(doc, 'button', 'scene-btn history-follow', t('history.follow'));
  followBtn.type = 'button';
  followBtn.setAttribute('aria-pressed', 'false');
  controls.append(playBtn, speedWrap, followBtn);
  const note = el(doc, 'div', 'history-stats', t('shiphistory.note'));
  detail.append(head, stats, sampleRow, slider, controls, canvas, note);
  section.append(searchRow, status, list, detail);
  host.prepend(tabs);
  host.appendChild(section);

  // ── stav ──────────────────────────────────────────────────────────
  let mode = 'flights';
  let samples = [];
  let series = null;
  let clock = null;
  let follow = false;
  let raf = 0;
  let lastFrame = 0;
  let token = 0;
  let current = null; // {mmsi, name}
  const entities = [];
  let marker = null;

  function setMode(next) {
    mode = next;
    host.dataset.mode = next;
    tabFlights.setAttribute('aria-selected', String(next === 'flights'));
    tabShips.setAttribute('aria-selected', String(next === 'ships'));
    section.hidden = next !== 'ships';
    if (panelTitle) panelTitle.textContent = next === 'ships' ? t('shiphistory.panel-title') : flightTitle;
    if (next !== 'ships') stop();
  }
  tabFlights.addEventListener('click', () => setMode('flights'));
  tabShips.addEventListener('click', () => setMode('ships'));
  setMode('flights');

  function syncSpeeds() {
    for (const { b, x } of speedBtns) b.classList.toggle('active', clock?.speed === x);
  }

  function clearGlobe() {
    for (const e of entities) { try { viewer?.entities?.remove(e); } catch { /* */ } }
    entities.length = 0;
    marker = null;
    governorRequestRender('ship-history');
  }

  function drawRoute() {
    clearGlobe();
    if (!viewer?.entities || samples.length < 1) return;
    const { runs, gaps } = splitShipRuns(samples);
    const color = Cesium.Color.fromCssColorString(ROUTE_COLOR);
    for (const run of runs) {
      if (run.length < 2) continue;
      entities.push(viewer.entities.add({
        polyline: { positions: lifted(run), width: 3, material: color.withAlpha(0.95), depthFailMaterial: color.withAlpha(0.45), arcType: Cesium.ArcType.GEODESIC },
      }));
    }
    for (const [a, b] of gaps) {
      entities.push(viewer.entities.add({
        polyline: { positions: lifted([a, b]), width: 2, arcType: Cesium.ArcType.GEODESIC,
          material: new Cesium.PolylineDashMaterialProperty({ color: color.withAlpha(0.6), dashLength: 14 }),
          depthFailMaterial: new Cesium.PolylineDashMaterialProperty({ color: color.withAlpha(0.3), dashLength: 14 }) },
      }));
    }
    marker = viewer.entities.add({
      id: 'gev-ship-history:marker',
      position: Cesium.Cartesian3.fromDegrees(samples.at(-1).lon, samples.at(-1).lat, 0),
      point: { pixelSize: 11, color: Cesium.Color.WHITE, outlineColor: color, outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: { text: current?.name || '', font: '12px "JetBrains Mono", monospace', fillColor: Cesium.Color.WHITE, showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('#06121a').withAlpha(0.85), pixelOffset: new Cesium.Cartesian2(0, -20),
        disableDepthTestDistance: Number.POSITIVE_INFINITY },
    });
    entities.push(marker);
    let w = 180; let e = -180; let s = 90; let n = -90;
    for (const p of samples) { w = Math.min(w, p.lon); e = Math.max(e, p.lon); s = Math.min(s, p.lat); n = Math.max(n, p.lat); }
    const padLon = Math.max(0.3, (e - w) * 0.15);
    const padLat = Math.max(0.2, (n - s) * 0.15);
    try {
      viewer.trackedEntity = undefined;
      viewer.camera.flyTo({ destination: Cesium.Rectangle.fromDegrees(w - padLon, Math.max(-89, s - padLat), e + padLon, Math.min(89, n + padLat)), duration: 2 });
    } catch { /* */ }
    governorRequestRender('ship-history');
  }

  function renderAt() {
    if (!clock || !samples.length) return;
    const p = interpolateShipSample(samples, clock.t);
    slider.value = String(Math.round(clock.fraction * 1000));
    sampleRow.textContent = shipSampleLine(p, t, currentLanguage());
    drawSpeedChart(canvas, series, clock.fraction, series ? t('shiphistory.chart', { kn: (series.maxSog ?? 0).toFixed(1) }) : '');
    if (marker && p) {
      marker.position = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0);
      if (follow) {
        try { viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, viewer.camera.positionCartographic?.height || 400_000) }); } catch { /* */ }
      }
    }
    playBtn.textContent = clock.playing ? t('history.pause') : t('history.play');
    governorRequestRender('ship-history');
  }

  function loop(ts) {
    raf = 0;
    if (!clock?.playing) { renderAt(); return; }
    const dt = lastFrame ? ts - lastFrame : 0;
    lastFrame = ts;
    clock.advance(Math.min(dt, 250));
    renderAt();
    if (clock.playing) raf = requestAnimationFrame(loop);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    clock?.pause();
  }

  playBtn.addEventListener('click', () => {
    if (!clock) return;
    if (clock.playing) { stop(); renderAt(); return; }
    clock.play();
    lastFrame = 0;
    if (!raf) raf = requestAnimationFrame(loop);
  });
  slider.addEventListener('input', () => { if (clock) { clock.seekFraction(Number(slider.value) / 1000); renderAt(); } });
  followBtn.addEventListener('click', () => {
    follow = !follow;
    followBtn.setAttribute('aria-pressed', String(follow));
    followBtn.classList.toggle('active', follow);
    renderAt();
  });
  backBtn.addEventListener('click', () => closeDetail());

  function closeDetail() {
    stop();
    clearGlobe();
    detail.hidden = true;
    list.hidden = false;
    searchRow.hidden = false;
    status.hidden = false;
    samples = [];
    clock = null;
    current = null;
  }

  async function load(mmsi, name) {
    const my = ++token;
    current = { mmsi: String(mmsi), name: name && name !== String(mmsi) ? name : String(mmsi) };
    // Zadané len MMSI: meno z registra lodí (nadpis a popis značky).
    if (current.name === current.mmsi) {
      void Promise.resolve().then(() => lookupVesselInfo(current.mmsi)).then((info) => {
        if (my !== token || !info?.name) return;
        current.name = info.name;
        title.textContent = info.name;
        if (marker?.label) marker.label.text = info.name;
        governorRequestRender('ship-history');
      }).catch(() => {});
    }
    stop();
    status.dataset.state = '';
    status.textContent = t('shiphistory.loading', { name: current.name });
    status.hidden = false;
    let data = null;
    try { data = await fetchShipHistory(current.mmsi, Number(range.value) || 7, fetchImpl); } catch { data = null; }
    if (my !== token) return;
    if (!data) { status.dataset.state = 'error'; status.textContent = t('shiphistory.failed'); return; }
    if (!data.samples.length) { status.textContent = t('shiphistory.empty', { name: current.name, d: range.value }); return; }
    samples = data.samples;
    series = shipSpeedSeries(samples);
    const summary = shipHistorySummary(samples);
    clock = new ReplayClock(summary.startT, Math.max(summary.endT, summary.startT + 1));
    clock.speed = SHIP_REPLAY_SPEEDS[2];
    clock.seek(summary.endT);
    syncSpeeds();
    title.textContent = current.name;
    stats.textContent = shipSummaryLine(summary, t, currentLanguage());
    list.hidden = true;
    status.hidden = true;
    detail.hidden = false;
    drawRoute();
    renderAt();
  }

  async function runSearch() {
    const q = input.value.trim();
    list.replaceChildren();
    if (!q) { status.textContent = t('shiphistory.hint'); return; }
    if (/^\d{9}$/.test(q)) { void load(q, q); return; }
    const my = ++token;
    status.dataset.state = '';
    status.textContent = t('history.searching');
    let results = [];
    try {
      const res = await fetchImpl(`/api/vessel-info/search?q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
      results = res.ok ? (await res.json()).results || [] : [];
    } catch { results = []; }
    if (my !== token) return;
    if (!results.length) { status.textContent = t('shiphistory.no-ship', { q }); return; }
    status.textContent = t('shiphistory.pick');
    for (const hit of results.slice(0, 8)) {
      const li = el(doc, 'li', 'history-leg');
      const btn = el(doc, 'button', 'history-leg-btn');
      btn.type = 'button';
      btn.append(el(doc, 'span', 'history-leg-title', hit.name || ''),
        el(doc, 'span', 'history-leg-sub', [hit.currentName ? t('cmd.vessel.now-named', { name: hit.currentName }) : hit.typeText, hit.flagIso2?.toUpperCase()].filter(Boolean).join(' · ')));
      btn.addEventListener('click', async () => {
        status.textContent = t('history.searching');
        let ship = null;
        try {
          const res = await fetchImpl(`/api/vessel-info/ship?shipId=${encodeURIComponent(hit.shipId)}`);
          ship = res.ok ? await res.json() : null;
        } catch { ship = null; }
        if (!ship?.mmsi) { status.textContent = t('shiphistory.failed'); return; }
        void load(ship.mmsi, ship.name || hit.name);
      });
      li.appendChild(btn);
      list.appendChild(li);
    }
  }
  searchBtn.addEventListener('click', () => { void runSearch(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') void runSearch(); });
  range.addEventListener('change', () => { if (current) void load(current.mmsi, current.name); });

  return {
    /** Otvor históriu konkrétnej lode (zo karty lode, zo sledovaných). */
    open(mmsi, name = '') {
      reveal?.();
      setCollapsed?.(false);
      setMode('ships');
      input.value = String(mmsi || '');
      return load(mmsi, name || String(mmsi));
    },
    setMode,
    getMode: () => mode,
    close: closeDetail,
    _state: () => ({ samples, clock, current }),
  };
}
