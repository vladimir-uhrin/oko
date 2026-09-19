// src/data/ukraineTimelineClock.js
/**
 * @module ukraineTimelineClock
 * @description Vlastné hodiny časovej osi modulu UKRAJINA (etapa 3c, 2026-09-19).
 * Nezávislé od Cesium `viewer.clock` (ten riadi deň/noc a prehrávanie letov) —
 * os udalostí má dva režimy:
 *  - LIVE: koniec okna = teraz, okno sa posúva s časom (24 h / 7 d / 30 d / od 2022);
 *  - PREHRÁVANIE: kurzor je pevný bod v minulosti, prehrávanie ho posúva rýchlosťou
 *    1 h/s … 2 d/s; na konci (teraz) sa zastaví a vráti do LIVE.
 * `range()` je rozsah pásu (čo kreslí histogram), `mapRange()` rozsah pre mapu —
 * pri okne „od 2022" mapa ukazuje 7 dní pred kurzorom, nie štyri roky bodov.
 * Čistý modul, testovateľný v Node (čas cez vstreknuté `now`).
 */
const H = 3_600_000;
const D = 24 * H;
/** Začiatok plnej invázie (VIINA má dáta od 24. 2. 2022). */
export const TIMELINE_SINCE_MS = Date.UTC(2022, 1, 24);
export const TIMELINE_WINDOWS = Object.freeze([
  Object.freeze({ id: '24h', ms: D, labelKey: 'ukraine.tl.win-24h' }),
  Object.freeze({ id: '7d', ms: 7 * D, labelKey: 'ukraine.tl.win-7d' }),
  Object.freeze({ id: '30d', ms: 30 * D, labelKey: 'ukraine.tl.win-30d' }),
  Object.freeze({ id: 'all', ms: null, labelKey: 'ukraine.tl.win-all' }),
]);
export const TIMELINE_SPEEDS = Object.freeze([
  Object.freeze({ id: '1h', msPerSec: H, labelKey: 'ukraine.tl.speed-1h' }),
  Object.freeze({ id: '6h', msPerSec: 6 * H, labelKey: 'ukraine.tl.speed-6h' }),
  Object.freeze({ id: '12h', msPerSec: 12 * H, labelKey: 'ukraine.tl.speed-12h' }),
  Object.freeze({ id: '1d', msPerSec: D, labelKey: 'ukraine.tl.speed-1d' }),
  Object.freeze({ id: '2d', msPerSec: 2 * D, labelKey: 'ukraine.tl.speed-2d' }),
]);
/** Najviac dní udalostí na mape naraz (VIINA ≈ 60–90 bodov/deň). */
export const MAP_WINDOW_MAX_MS = 30 * D;
export const MAP_WINDOW_ALL_MS = 7 * D;

const windowById = (id) => TIMELINE_WINDOWS.find((w) => w.id === id) || TIMELINE_WINDOWS[0];
const speedById = (id) => TIMELINE_SPEEDS.find((s) => s.id === id) || TIMELINE_SPEEDS[1];

/**
 * @param {{now?: () => number, windowId?: string, speedId?: string}} [o]
 */
export function createTimelineClock({ now = Date.now, windowId = '24h', speedId = '6h' } = {}) {
  let mode = 'live';
  let win = windowById(windowId);
  let speed = speedById(speedId);
  let cursor = now();
  let playing = false;
  const listeners = new Set();
  const emit = (reason) => { const s = getState(); for (const fn of listeners) { try { fn(s, reason); } catch { /* poslucháč */ } } };
  const clamp = (ms) => Math.max(TIMELINE_SINCE_MS, Math.min(now(), ms));

  function end() { return mode === 'live' ? now() : cursor; }
  function range() {
    const e = end();
    const start = win.ms === null ? TIMELINE_SINCE_MS : Math.max(TIMELINE_SINCE_MS, e - win.ms);
    return { start, end: e };
  }
  function mapRange() {
    const e = end();
    const span = win.ms === null ? MAP_WINDOW_ALL_MS : Math.min(win.ms, MAP_WINDOW_MAX_MS);
    return { start: Math.max(TIMELINE_SINCE_MS, e - span), end: e };
  }
  function getState() {
    return { mode, windowId: win.id, speedId: speed.id, cursor: end(), playing, range: range(), mapRange: mapRange(), now: now() };
  }
  function setMode(next) {
    const m = next === 'replay' ? 'replay' : 'live';
    if (m === mode) return;
    if (m === 'replay') cursor = clamp(now());
    else playing = false;
    mode = m;
    emit('mode');
  }
  function setWindow(id) {
    const w = windowById(id);
    if (w.id === win.id) return;
    win = w;
    emit('window');
  }
  function setSpeed(id) {
    const s = speedById(id);
    if (s.id === speed.id) return;
    speed = s;
    emit('speed');
  }
  /** Posun kurzora (ms UTC); prepne do prehrávania, ak je v minulosti. */
  function setCursor(ms) {
    if (!Number.isFinite(ms)) return;
    const c = clamp(ms);
    if (c >= now() - 1000) { cursor = now(); if (mode !== 'live') { mode = 'live'; playing = false; } emit('cursor'); return; }
    cursor = c;
    if (mode !== 'replay') mode = 'replay';
    emit('cursor');
  }
  /** Kurzor z podielu 0…1 rozsahu pásu. */
  function scrub(fraction) {
    const r = range();
    setCursor(r.start + Math.max(0, Math.min(1, fraction)) * (r.end - r.start));
  }
  function play() {
    if (mode !== 'replay') { cursor = clamp(now() - (win.ms === null ? MAP_WINDOW_ALL_MS : Math.min(win.ms, MAP_WINDOW_MAX_MS))); mode = 'replay'; }
    if (playing) return;
    playing = true;
    emit('play');
  }
  function pause() {
    if (!playing) return;
    playing = false;
    emit('pause');
  }
  function toggle() { if (playing) pause(); else play(); }
  /**
   * Krok reálneho času (ms). Prehrávanie posúva kurzor rýchlosťou; na dosiahnutí
   * „teraz" sa zastaví a vráti do LIVE. Vracia true, ak sa kurzor pohol.
   */
  function tick(realDtMs) {
    if (!playing || mode !== 'replay' || !Number.isFinite(realDtMs) || realDtMs <= 0) return false;
    const next = cursor + (speed.msPerSec * realDtMs) / 1000;
    if (next >= now()) { cursor = now(); playing = false; mode = 'live'; emit('end'); return true; }
    cursor = next;
    emit('tick');
    return true;
  }
  /** Skok o celé okno (šípky): záporné = späť. */
  function step(direction) {
    const span = win.ms === null ? MAP_WINDOW_ALL_MS : win.ms;
    setCursor(end() + Math.sign(direction) * span);
  }
  return {
    getState, range, mapRange,
    setMode, setWindow, setSpeed, setCursor, scrub, play, pause, toggle, tick, step,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get mode() { return mode; },
    get playing() { return playing; },
  };
}

/** Text kurzora: dátum a hodina UTC (LIVE = „teraz"). Pure. */
export function cursorText(state, translate = (k) => k) {
  if (!state) return '';
  if (state.mode === 'live') return translate('ukraine.tl.live-now');
  const d = new Date(state.cursor);
  const hh = String(d.getUTCHours()).padStart(2, '0'); const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()} ${hh}:${mm} UTC`;
}

/**
 * Stĺpce histogramu pre pás: koše (`bins`) cez rozsah; pri oknách do 7 d po
 * hodinách z udalostí, inak po dňoch zo súhrnu. Pure.
 * @param {{start:number,end:number}} range
 * @param {Array<{t:number,severity?:string}>} events
 * @param {Record<string,{viina?:number,geoconfirmed?:number,news?:number,media?:number,critical?:number}>|null} summaryDays
 */
export function histogramBins(range, events, summaryDays, { bins = 120 } = {}) {
  const span = Math.max(1, range.end - range.start);
  const out = Array.from({ length: bins }, (_, i) => ({ i, start: range.start + (i * span) / bins, end: range.start + ((i + 1) * span) / bins, count: 0, critical: 0 }));
  const idx = (t) => Math.min(bins - 1, Math.max(0, Math.floor(((t - range.start) / span) * bins)));
  if (summaryDays && span > 7 * D) {
    for (const [day, row] of Object.entries(summaryDays)) {
      const t = Date.parse(`${day}T12:00:00Z`);
      if (!Number.isFinite(t) || t < range.start || t > range.end) continue;
      const b = out[idx(t)];
      b.count += (row.viina || 0) + (row.geoconfirmed || 0) + (row.media || 0);
      b.critical += row.critical || 0;
    }
  } else {
    const binMs = span / bins;
    for (const e of events || []) {
      if (!Number.isFinite(e?.t) || e.t < range.start || e.t > range.end) continue;
      // Udalosti len s dátumom (VIINA) sa rozložia rovnomerne cez deň, keď sú
      // koše jemnejšie než deň — inak by o polnoci stál falošný hrot.
      if (e.dayOnly && binMs < D) {
        const parts = Math.max(1, Math.round(D / binMs));
        for (let k = 0; k < parts; k += 1) {
          const t = e.t + (k + 0.5) * (D / parts);
          if (t < range.start || t > range.end) continue;
          const b = out[idx(t)];
          b.count += 1 / parts;
          if (e.severity === 'critical') b.critical += 1 / parts;
        }
        continue;
      }
      const b = out[idx(e.t)];
      b.count += 1;
      if (e.severity === 'critical') b.critical += 1;
    }
  }
  for (const b of out) { b.count = Math.round(b.count * 100) / 100; b.critical = Math.round(b.critical * 100) / 100; }
  const max = out.reduce((m, b) => Math.max(m, b.count), 0);
  return { bins: out, max };
}
