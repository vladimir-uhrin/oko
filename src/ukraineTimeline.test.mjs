// src/ukraineTimeline.test.mjs — časová os s falošným DOM: kostra, okná, LIVE →
// prehrávanie, načítanie okna do vrstvy, legenda s filtrom, pás médií, počty,
// hlásenie GŠ pre deň kurzora, odkaz na zdieľanie, parse parametrov.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createUkraineTimeline, parseShareParams, shareUrl, shortDay } from './ukraineTimeline.js';
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
  const tl = createUkraineTimeline({ layer, store, clock, report, control, translate: (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k), lang: 'sk', documentRef: doc, now: () => now, setTimer, clearTimer: () => {}, clipboard: clip, origin: 'https://oko.test' });
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
  tl.hide();
  assert.equal(root.hidden, true);
  assert.equal(layer.isShown(), false);
  assert.equal(overrides.at(-1), null);
  tl.destroy();
  assert.equal(doc.body.children.length, 0);
});
