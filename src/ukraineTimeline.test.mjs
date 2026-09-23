// src/ukraineTimeline.test.mjs — časová os s falošným DOM: kostra, okná, LIVE →
// prehrávanie, načítanie okna do vrstvy, legenda s filtrom, pás médií, počty,
// hlásenie GŠ pre deň kurzora, odkaz na zdieľanie, parse parametrov.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createUkraineTimeline, parseShareParams, sameZoneSnapshot, shareUrl, shortDay } from './ukraineTimeline.js';
import { createTimelineClock } from './data/ukraineTimelineClock.js';

function fakeDocument() {
  const makeEl = (tag) => {
    const classes = new Set();
    const attrs = new Map();
    const listeners = new Map();
    const node = {
      tagName: tag.toUpperCase(), children: [], dataset: {}, style: { setProperty(k, v) { this[k] = v; } }, hidden: false, textContent: '', title: '', value: '', tabIndex: -1,
      get className() { return [...classes].join(' '); },
      set className(v) { classes.clear(); for (const c of String(v).split(/\s+/)) if (c) classes.add(c); },
      classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)), toggle(c, force) { const on = force === undefined ? !classes.has(c) : Boolean(force); if (on) classes.add(c); else classes.delete(c); return on; }, contains: (c) => classes.has(c) },
      appendChild(child) { node.children.push(child); child.parentNode = node; return child; },
      replaceChildren(...kids) { node.children = kids; for (const k of kids) k.parentNode = node; },
      remove() { if (node.parentNode) node.parentNode.children = node.parentNode.children.filter((c) => c !== node); },
      setAttribute(k, v) { attrs.set(k, String(v)); }, getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
      click() { for (const fn of listeners.get('click') || []) fn({ preventDefault() {}, stopPropagation() {}, target: node }); },
      dispatch(type, ev) { for (const fn of listeners.get(type) || []) fn({ preventDefault() {}, stopPropagation() {}, target: node, ...ev }); },
      getContext() { return null; },
      get clientWidth() { return 600; },
      getBoundingClientRect() { return { left: 0, width: 600 }; },
      setPointerCapture() {},
      querySelectorAll() { return []; },
      contains(other) { const walk = (n) => n === other || n.children.some(walk); return walk(node); },
    };
    return node;
  };
  const body = makeEl('body');
  return { createElement: makeEl, body };
}
const collect = (node, pred, out = []) => { if (pred(node)) out.push(node); for (const c of node.children || []) collect(c, pred, out); return out; };
const byClass = (root, cls) => collect(root, (n) => n.className && n.className.split(' ').includes(cls));

function fakeLayer() {
  const listeners = new Set();
  const state = { shown: false, revealed: true, total: 0, inView: 0, lod: 'cards', selectedId: null, types: null };
  return {
    calls: [],
    show() { state.shown = true; }, hide() { state.shown = false; }, isShown: () => state.shown,
    setEvents(events) { state.total = events.length; state.inView = events.length; this.calls.push(['setEvents', events.length]); for (const fn of listeners) fn(state); },
    setFilter({ types }) { state.types = types; this.calls.push(['setFilter', types ? [...types] : null]); },
    select(id) { state.selectedId = id; this.calls.push(['select', id]); },
    openMedia(m) { this.calls.push(['openMedia', m.url]); },
    getState: () => ({ ...state }),
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
const T0 = Date.UTC(2026, 8, 19, 12);
const D = 86_400_000;

test('pomocníci: shortDay, shareUrl, parseShareParams', () => {
  assert.equal(shortDay('2026-09-08'), '8.9.');
  assert.equal(shareUrl({ origin: 'https://oko.uhrin.digital', front: 'lyman', state: { mode: 'live', windowId: '7d' } }), 'https://oko.uhrin.digital/?front=lyman&win=7d');
  assert.equal(shareUrl({ origin: 'https://x', front: 'lyman', state: { mode: 'replay', cursor: Date.UTC(2026, 8, 18, 6), windowId: '24h' } }), 'https://x/?front=lyman&t=2026-09-18T06%3A00%3A00Z&win=24h');
  assert.deepEqual(parseShareParams('?front=lyman&t=2026-09-18T06:00:00Z&win=24h'), { cursor: Date.UTC(2026, 8, 18, 6), windowId: '24h' });
  assert.deepEqual(parseShareParams('?front=lyman&win=nope'), null);
  assert.equal(parseShareParams('?front=lyman'), null);
});

test('os: kostra, LIVE → prehrávanie, načítanie do vrstvy, legenda/filter, médiá, počty, GŠ pre deň, zdieľanie', async () => {
  const doc = fakeDocument();
  const layer = fakeLayer();
  let now = T0;
  const clock = createTimelineClock({ now: () => now, windowId: '24h' });
  const events = [
    { id: 'viina:1', t: T0 - 3_600_000, lat: 48.99, lon: 37.8, place: 'Lyman', type: 'strike', severity: 'critical', level: 'reported', src: 'viina', sources: [], media: [{ kind: 'video', provider: 'youtube', url: 'https://www.youtube.com/watch?v=a', embed: 'e', thumb: 'https://i/a.jpg', title: 'Strike video', channel: 'Kyiv Independent' }] },
    { id: 'viina:2', t: T0 - 7_200_000, lat: 48.5, lon: 37.7, place: 'Kostiantynivka', type: 'ground', severity: 'major', level: 'reported', src: 'viina', sources: [], media: [] },
  ];
  const reports = { '2026-09-19': { total: 213, day: '2026-09-19', reportedAt: '2026-09-19T05:00:00Z' }, '2026-09-17': { total: 190, day: '2026-09-17', reportedAt: '2026-09-17T05:00:00Z' } };
  const loads = [];
  const store = {
    async load(start, end) { loads.push([start, end]); return { events: events.filter((e) => e.t >= start && e.t <= end), reports, coverage: { news: ['2026-09-19'], media: ['2026-09-19'] }, errors: [], chunks: 1 }; },
    async summary() { return { days: {} }; },
    reportForDay(r, ms) { for (let back = 0; back <= 3; back += 1) { const d = new Date(ms - back * D).toISOString().slice(0, 10); if (r[d]) return r[d]; } return null; },
  };
  const overrides = [];
  const report = { setOverride(r) { overrides.push(r ? r.total : null); } };
  const timers = [];
  const setTimer = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  const clip = { text: null, async writeText(s) { this.text = s; } };
  // kontrola: falošná vrstva + falošná snímka zo skladu
  const ctlListeners = new Set();
  let ctlShown = false; let ctlSnapshot = null;
  const control = {
    isShown: () => ctlShown,
    async show() { ctlShown = true; for (const fn of ctlListeners) fn(); },
    hide() { ctlShown = false; ctlSnapshot = null; for (const fn of ctlListeners) fn(); },
    setSnapshot(s) { ctlSnapshot = s; for (const fn of ctlListeners) fn(); },
    getState: () => ({ shown: ctlShown, loading: false, points: ctlSnapshot?.points?.length || 0, revisionAt: ctlSnapshot?.revisionAt || null, summary: ctlSnapshot?.summary || null }),
    onChange(fn) { ctlListeners.add(fn); return () => ctlListeners.delete(fn); },
  };
  const controlCalls = [];
  store.control = async (day) => { controlCalls.push(day); if (day < '2026-09-01') { const e = new Error('no'); e.status = 404; throw e; } return { day: '2026-09-15', revisionAt: '2026-09-15T10:00:00Z', points: [{ lat: 48, lon: 37 }], summary: { settlements: { ua: 2, ru: 1, contested: 1 } } }; };
  // DeepState: falošná vrstva; kým je zapnutá, zóny Wikipédie sa skryjú
  const dsListeners = new Set();
  let dsShown = false; let dsSnapshot = null;
  const deepstate = {
    isShown: () => dsShown,
    async show() { dsShown = true; for (const fn of dsListeners) fn(); },
    hide() { dsShown = false; dsSnapshot = null; for (const fn of dsListeners) fn(); },
    setSnapshot(s) { dsSnapshot = s; for (const fn of dsListeners) fn(); },
    getState: () => ({ shown: dsShown, loading: false, features: dsSnapshot?.features?.length || 0, at: dsSnapshot?.at || null, stampText: dsSnapshot ? '18.9.2026 19:25 UTC' : '', areaKm2: dsSnapshot?.areaKm2 || null }),
    onChange(fn) { dsListeners.add(fn); return () => dsListeners.delete(fn); },
  };
  const zonesCalls = [];
  control.setZonesVisible = (on) => zonesCalls.push(on);
  store.deepstate = async (day) => { if (day < '2026-09-18') { const e = new Error('no'); e.status = 404; throw e; } return { day: '2026-09-18', at: '2026-09-18T19:25:38.000Z', features: [{ kind: 'occupied' }], areaKm2: { occupied: 72941, grey: 1674 } }; };
  const tl = createUkraineTimeline({ layer, store, clock, report, control, deepstate, translate: (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k), lang: 'sk', documentRef: doc, now: () => now, setTimer, clearTimer: () => {}, clipboard: clip, origin: 'https://oko.test' });
  assert.equal(doc.body.children.length, 1);
  const { root, legendBtns, mediaStrip, counts, winBtns, modeBtn } = tl._getStateForTest();
  assert.equal(root.hidden, true);
  tl.setActiveScene('lyman');
  tl.show();
  assert.equal(root.hidden, false);
  assert.equal(layer.isShown(), true);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(loads.length, 1);
  assert.deepEqual(loads[0], [T0 - D, T0], 'LIVE 24 h');
  assert.deepEqual(layer.calls.find((c) => c[0] === 'setEvents'), ['setEvents', 2]);
  assert.equal(legendBtns.get('strike').n.textContent, '1');
  assert.equal(legendBtns.get('ground').n.textContent, '1');
  assert.equal(legendBtns.get('naval').b.hidden, true, 'prázdny typ sa v legende neukáže');
  assert.equal(mediaStrip.children.length, 1);
  assert.ok(counts.textContent.includes('ukraine.tl.in-view {"n":"2","total":"2"}'));
  assert.ok(counts.textContent.includes('ukraine.tl.gs {"n":"213","day":"19.9."}'));
  assert.ok(counts.textContent.includes('ukraine.tl.media {"n":"1"}'));
  assert.deepEqual(overrides, [null], 'LIVE = bez historického hlásenia');
  // filter typu
  legendBtns.get('strike').b.click();
  assert.deepEqual(layer.calls.at(-1), ['setFilter', ['strike']]);
  byClass(root, 'is-all')[0].click();
  assert.deepEqual(layer.calls.at(-1), ['setFilter', null]);
  // médium → výber + lightbox
  mediaStrip.children[0].click();
  assert.deepEqual(layer.calls.at(-2), ['select', 'viina:1']);
  assert.deepEqual(layer.calls.at(-1), ['openMedia', 'https://www.youtube.com/watch?v=a']);
  // prehrávanie: kurzor do minulosti → načítanie okna kurzora + hlásenie GŠ dňa
  clock.setCursor(T0 - 2 * D);
  const pending = timers.filter((t) => t.ms === 160).at(-1);
  await pending.fn();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(loads.at(-1), [T0 - 3 * D, T0 - 2 * D]);
  assert.equal(overrides.at(-1), 190, 'hlásenie z 17. 9. pre kurzor 17. 9.');
  assert.ok(modeBtn.className.includes('is-replay'));
  assert.equal(winBtns.get('24h').className.includes('active'), true);
  const url = await tl.share();
  assert.equal(url, 'https://oko.test/?front=lyman&t=2026-09-17T12%3A00%3A00Z&win=24h');
  assert.equal(clip.text, url);
  // prehrávanie: časovač 100 ms (nie rAF), kurzor ide rýchlosťou 6 h/s
  const before = clock.getState().cursor;
  clock.play();
  const loop = timers.filter((t) => t.ms === 100).at(-1);
  assert.ok(loop, 'slučka prehrávania je časovač');
  loop.fn();
  now += 500;
  timers.filter((t) => t.ms === 100).at(-1).fn();
  assert.equal(clock.getState().cursor - before, 3 * 3_600_000, '0,5 s reálneho času = 3 h pri 6 h/s');
  clock.pause();
  // kontrola: čip zapne vrstvu a natiahne snímku pre deň kurzora; legenda nesie revíziu a počty
  const { ctlChip, ctlLine, ctlCounts } = tl._getStateForTest();
  assert.equal(ctlChip.getAttribute('aria-pressed'), 'false');
  await tl.showControl();
  await new Promise((r) => setImmediate(r));
  assert.equal(ctlShown, true);
  assert.deepEqual(controlCalls, ['2026-09-17'], 'deň kurzora (17. 9.)');
  assert.equal(ctlSnapshot.day, '2026-09-15');
  assert.equal(ctlChip.getAttribute('aria-pressed'), 'true');
  assert.ok(ctlLine.textContent.includes('ukraine.ctl.since'), ctlLine.textContent);
  assert.ok(ctlCounts.textContent.includes('"ua":"2","ru":"1","contested":"1"'), ctlCounts.textContent);
  clock.setCursor(Date.UTC(2026, 7, 1));
  await timers.filter((t) => t.ms === 160).at(-1).fn();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(controlCalls.at(-1), '2026-08-01');
  assert.equal(ctlSnapshot, null, '404 = žiadna snímka');
  assert.equal(ctlLine.textContent, 'ukraine.ctl.missing');
  ctlChip.click();
  assert.equal(ctlShown, false);
  // DeepState: zapnutie natiahne snímku pre deň kurzora (1. 8. 2026 → 404 = chýba), návrat do LIVE → snímka z 18. 9.
  const { dsChip, dsLine, dsArea } = tl._getStateForTest();
  await tl.showDeepState();
  await new Promise((r) => setImmediate(r));
  assert.equal(dsShown, true);
  assert.equal(dsChip.getAttribute('aria-pressed'), 'true');
  assert.equal(dsLine.textContent, 'ukraine.ds.missing', 'pre august 2026 niet snímky');
  // ZMENENÉ 2026-09-23: tvrdilo sa tu, že zóny Wikipédie sa skryjú UŽ pri zapnutom
  // čipe. To bola chyba a bolo ju vidieť naživo na doméne: server tam DeepState
  // odmieta (451, kým nepríde súhlas), takže „zapnutý" znamenal prázdno — a mapa
  // ostala BEZ ZÓN, aj tých z Wikipédie. Skrývať sa má až to, čo má čo prekrývať.
  assert.equal(zonesCalls.includes(false), false, 'bez snímky DeepState zóny Wikipédie ZOSTÁVAJÚ');
  clock.setMode('live');
  await timers.filter((t) => t.ms === 0).at(-1).fn();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(dsSnapshot?.day, '2026-09-18');
  assert.ok(dsLine.textContent.includes('ukraine.ds.since'), dsLine.textContent);
  assert.match(dsArea.textContent, /"occupied":"72[\s ]941"/, dsArea.textContent); // sk-SK oddeľovač tisícov je úzka medzera
  assert.equal(zonesCalls.at(-1), false, 'až keď DeepState naozaj kreslí, raster Wikipédie ustúpi');
  dsChip.click();
  assert.equal(dsShown, false);
  assert.equal(zonesCalls.at(-1), true, 'po vypnutí DeepState sa zóny Wikipédie vrátia');
  tl.hide();
  assert.equal(root.hidden, true);
  assert.equal(layer.isShown(), false);
  assert.equal(overrides.at(-1), null);
  tl.destroy();
  assert.equal(doc.body.children.length, 0);
});

test('LIVE obnova zón: ten istý deň sa pýta znova každý tik, prekreslí sa len pri novej revízii/snímke, zlyhaná obnova nechá poslednú snímku, v prehrávaní sa nepýta', async () => {
  const doc = fakeDocument();
  const layer = fakeLayer();
  let now = T0;
  const clock = createTimelineClock({ now: () => now, windowId: '24h' });
  const store = {
    async load() { return { events: [], reports: {}, coverage: { news: [], media: [] }, errors: [], chunks: 1 }; },
    async summary() { return { days: {} }; },
    reportForDay() { return null; },
  };
  let ctlRev = '2026-09-15T10:00:00Z'; let ctlFail = false; const controlCalls = []; const ctlSets = [];
  store.control = async (day) => { controlCalls.push(day); if (ctlFail) throw new Error('sieť'); return { day: '2026-09-15', revisionAt: ctlRev, points: [{ lat: 48, lon: 37 }], summary: { settlements: { ua: 1, ru: 0, contested: 0 } } }; };
  let dsAt = '2026-09-18T19:25:38.000Z'; const dsCalls = []; const dsSets = [];
  store.deepstate = async (day) => { dsCalls.push(day); return { day: '2026-09-18', at: dsAt, features: [{ kind: 'occupied' }], areaKm2: { occupied: 1, grey: 1 } }; };
  const ctlListeners = new Set(); let ctlShown = false; let ctlSnapshot = null;
  const control = {
    isShown: () => ctlShown,
    async show() { ctlShown = true; for (const fn of ctlListeners) fn(); },
    hide() { ctlShown = false; ctlSnapshot = null; for (const fn of ctlListeners) fn(); },
    setSnapshot(s) { ctlSnapshot = s; ctlSets.push(s?.revisionAt ?? null); for (const fn of ctlListeners) fn(); },
    setZonesVisible() {},
    getState: () => ({ shown: ctlShown, loading: false, points: ctlSnapshot?.points?.length || 0, day: ctlSnapshot?.day || null, revisionAt: ctlSnapshot?.revisionAt || null, summary: ctlSnapshot?.summary || null }),
    onChange(fn) { ctlListeners.add(fn); return () => ctlListeners.delete(fn); },
  };
  const dsListeners = new Set(); let dsShown = false; let dsSnapshot = null;
  const deepstate = {
    isShown: () => dsShown,
    async show() { dsShown = true; for (const fn of dsListeners) fn(); },
    hide() { dsShown = false; dsSnapshot = null; for (const fn of dsListeners) fn(); },
    setSnapshot(s) { dsSnapshot = s; dsSets.push(s?.at ?? null); for (const fn of dsListeners) fn(); },
    getState: () => ({ shown: dsShown, loading: false, features: dsSnapshot?.features?.length || 0, day: dsSnapshot?.day || null, at: dsSnapshot?.at || null, stampText: dsSnapshot ? 'x' : '', areaKm2: dsSnapshot?.areaKm2 || null }),
    onChange(fn) { dsListeners.add(fn); return () => dsListeners.delete(fn); },
  };
  const timers = [];
  const setTimer = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r)); };
  const tl = createUkraineTimeline({ layer, store, clock, control, deepstate, translate: (k) => k, lang: 'sk', documentRef: doc, now: () => now, setTimer, clearTimer: () => {}, origin: 'https://oko.test' });
  tl.show();
  await tl.showControl();
  await tl.showDeepState();
  await settle();
  // LIVE = dnes; sklad dedupuje opakované dopyty toho istého dňa (TTL 15 min), preto stačí, že sa pýtal dnešok a snímka sa nastavila práve raz.
  assert.ok(controlCalls.every((d) => d === '2026-09-19') && controlCalls.includes('2026-09-19'), 'LIVE = dnes');
  assert.ok(dsCalls.every((d) => d === '2026-09-19') && dsCalls.includes('2026-09-19'));
  assert.deepEqual(ctlSets, ['2026-09-15T10:00:00Z'], 'snímka nastavená raz');
  assert.deepEqual(dsSets, ['2026-09-18T19:25:38.000Z']);
  // tik LIVE (60 s) → načítanie → snímka toho istého dňa sa pýta znova, rovnaká identita = bez prekreslenia
  const liveTick = async () => { timers.filter((t) => t.ms === 60_000).at(-1).fn(); timers.filter((t) => t.ms === 0).at(-1).fn(); await settle(); };
  controlCalls.length = 0; dsCalls.length = 0;
  now += 60_000; await liveTick();
  assert.ok(controlCalls.includes('2026-09-19'), 'ten istý deň sa v LIVE pýta znova');
  assert.ok(dsCalls.includes('2026-09-19'));
  assert.equal(ctlSets.length, 1, 'rovnaká revízia = raster sa nestavia znova');
  assert.equal(dsSets.length, 1, 'rovnaká snímka DeepState = polygóny sa nestavajú znova');
  // archív má novú revíziu / snímku → prekreslí sa a legenda nesie nový dátum
  ctlRev = '2026-09-19T08:00:00Z'; dsAt = '2026-09-19T06:09:11.000Z';
  now += 60_000; await liveTick();
  assert.equal(ctlSets.at(-1), '2026-09-19T08:00:00Z');
  assert.equal(dsSets.at(-1), '2026-09-19T06:09:11.000Z');
  const { ctlLine, dsLine } = tl._getStateForTest();
  assert.ok(ctlLine.textContent.includes('ukraine.ctl.since'), ctlLine.textContent);
  assert.ok(dsLine.textContent.includes('ukraine.ds.since'), dsLine.textContent);
  // zlyhaná obnova (sieť) nechá poslednú snímku aj text legendy
  ctlFail = true;
  now += 60_000; await liveTick();
  assert.equal(ctlSnapshot?.revisionAt, '2026-09-19T08:00:00Z', 'chyba pri obnove nezmaže mapu');
  assert.ok(ctlLine.textContent.includes('ukraine.ctl.since'));
  assert.equal(ctlSets.length, 2);
  ctlFail = false;
  // prehrávanie: ten istý deň kurzora sa už nepýta (posun v rámci dňa)
  const before = controlCalls.length;
  clock.setCursor(T0 - 3_600_000);
  assert.equal(clock.getState().mode, 'replay');
  timers.at(-1).fn();
  await settle();
  assert.equal(controlCalls.length, before, 'v prehrávaní sa snímka toho istého dňa nepýta znova');
  assert.equal(sameZoneSnapshot({ revisionAt: 'a' }, { revisionAt: 'a' }, 'revisionAt'), true);
  assert.equal(sameZoneSnapshot({ at: 'b' }, { at: 'a' }, 'at'), false);
  assert.equal(sameZoneSnapshot(null, { revisionAt: null }, 'revisionAt'), true, 'nič a nič = to isté');
});

test('vek zdroja v legende: čerstvý len dátum, nad prahom ZASTARANÉ; DeepState má prísnejší prah', async () => {
  // Skutočný prípad z 21. 9. 2026: Wikipédia svoj modul od 13. 8. neupravila,
  // takže na mape svietila 39 dní stará línia frontu a nič na to neupozornilo.
  const doc = fakeDocument();
  const layer = fakeLayer();
  let now = T0;
  const clock = createTimelineClock({ now: () => now, windowId: '24h' });
  const store = {
    async load() { return { events: [], reports: {}, coverage: { news: [], media: [] }, errors: [], chunks: 1 }; },
    async summary() { return { days: {} }; },
    reportForDay() { return null; },
  };
  let ctlRev = '2026-09-15T10:00:00Z';
  store.control = async () => ({ day: '2026-09-15', revisionAt: ctlRev, points: [{ lat: 48, lon: 37 }], summary: { settlements: { ua: 1, ru: 0, contested: 0 } } });
  // 30 hodín pred T0 — zámerne cez polnoc, aby to bol naozaj jeden deň, nie „dnes".
  let dsAt = '2026-09-18T06:00:00.000Z';
  store.deepstate = async () => ({ day: '2026-09-18', at: dsAt, features: [{ kind: 'occupied' }], areaKm2: { occupied: 1, grey: 1 } });
  const ctlListeners = new Set(); let ctlShown = false; let ctlSnapshot = null;
  const control = {
    isShown: () => ctlShown,
    async show() { ctlShown = true; for (const fn of ctlListeners) fn(); },
    hide() { ctlShown = false; ctlSnapshot = null; for (const fn of ctlListeners) fn(); },
    setSnapshot(s) { ctlSnapshot = s; for (const fn of ctlListeners) fn(); },
    setZonesVisible() {},
    getState: () => ({ shown: ctlShown, loading: false, points: 1, day: ctlSnapshot?.day || null, revisionAt: ctlSnapshot?.revisionAt || null, summary: ctlSnapshot?.summary || null }),
    onChange(fn) { ctlListeners.add(fn); return () => ctlListeners.delete(fn); },
  };
  const dsListeners = new Set(); let dsShown = false; let dsSnapshot = null;
  const deepstate = {
    isShown: () => dsShown,
    async show() { dsShown = true; for (const fn of dsListeners) fn(); },
    hide() { dsShown = false; dsSnapshot = null; for (const fn of dsListeners) fn(); },
    setSnapshot(s) { dsSnapshot = s; for (const fn of dsListeners) fn(); },
    getState: () => ({ shown: dsShown, loading: false, features: 1, day: dsSnapshot?.day || null, at: dsSnapshot?.at || null, stampText: dsSnapshot ? 'x' : '', areaKm2: dsSnapshot?.areaKm2 || null }),
    onChange(fn) { dsListeners.add(fn); return () => dsListeners.delete(fn); },
  };
  const timers = [];
  const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r)); };
  const tl = createUkraineTimeline({
    layer, store, clock, control, deepstate, translate: (k) => k, lang: 'sk', documentRef: doc,
    now: () => now, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {}, origin: 'https://oko.test',
  });
  tl.show();
  const { ctlAge, dsAge } = tl._getStateForTest();

  assert.equal(ctlAge.textContent, '', 'vypnutá vrstva nehlási vek');

  // 4 dni pod prahom 14 → len vek, žiadne varovanie
  await tl.showControl();
  await settle();
  assert.equal(ctlAge.textContent, 'ukraine.age.many');
  assert.equal(ctlAge.className.includes('is-stale'), false);
  assert.equal(ctlAge.title, '');

  // tá istá revízia o 30 dní neskôr = 34 dní → ZASTARANÉ
  now += 30 * D;
  control.setSnapshot(ctlSnapshot);
  assert.equal(ctlAge.textContent, 'ukraine.age.many · ukraine.src.stale');
  assert.equal(ctlAge.className.includes('is-stale'), true);
  assert.equal(ctlAge.title, 'ukraine.src.stale-note', 'varovanie vysvetlí, čo to znamená');

  // čerstvá revízia zhasne varovanie aj triedu
  now = T0;
  ctlRev = '2026-09-19T08:00:00Z';
  control.setSnapshot({ day: '2026-09-19', revisionAt: ctlRev, points: [], summary: null });
  assert.equal(ctlAge.textContent, 'ukraine.age.today', 'dnešná revízia nemá tvar „pred 0 dňami"');
  assert.equal(ctlAge.className.includes('is-stale'), false);

  // DeepState: jeden deň starý snímok je v poriadku (zámerné oneskorenie 2–3 dni)
  await tl.showDeepState();
  await settle();
  assert.equal(dsAge.textContent, 'ukraine.age.one', 'jeden deň má vlastný tvar');
  assert.equal(dsAge.className.includes('is-stale'), false);

  // ten istý snímok o 5 dní neskôr už znamená, že stojí zdroj alebo archivár
  now += 5 * D;
  deepstate.setSnapshot(dsSnapshot);
  assert.equal(dsAge.textContent, 'ukraine.age.many · ukraine.src.stale');
  assert.equal(dsAge.className.includes('is-stale'), true);

  // vypnutie vrstvy vek zmaže aj s varovaním
  deepstate.hide();
  assert.equal(dsAge.textContent, '');
  assert.equal(dsAge.className.includes('is-stale'), false);
});
