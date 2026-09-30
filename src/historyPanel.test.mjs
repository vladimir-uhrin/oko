// src/historyPanel.test.mjs
// Panel histórie letov — modely riadkov a DOM lifecycle na stube (2026-09-07).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installHistoryPanel, legRowModel, sampleLine } from './historyPanel.js';
import { drawFlightChart, CHART_PAD } from './flightHistoryChart.js';
import { chartSeries } from './data/flightHistory.js';

const t = (key, vars = {}) => `${key}${Object.keys(vars).length ? ' ' + JSON.stringify(vars) : ''}`;
const T0 = 1_757_000_000;

test('riadok úseku: titulok, podtitul s hexom/časom/maximom/fixmi, núdzový squawk vystúpi', () => {
  const row = legRowModel({ icao24: '4b1805', callsign: 'SWR11H', country: 'Switzerland', firstT: T0, lastT: T0 + 3600, maxAltM: 11_000, fixes: 120, squawks: ['1000', '7700'] }, t);
  assert.equal(row.title, 'SWR11H');
  assert.match(row.sub, /^4B1805 · Switzerland · \d\d:\d\d–\d\d:\d\d UTC · history\.max-alt/);
  assert.match(row.sub, /history\.fix-count \{"n":120\}$/);
  assert.equal(row.alert, '7700');
  assert.equal(legRowModel({ icao24: 'abc123', callsign: '', firstT: T0, lastT: T0, maxAltM: 0, fixes: 1, squawks: [] }, t).alert, null);
});

test('riadok vzorky: čas, výška s trendom, rýchlosť, kurz, núdzový squawk; na zemi bez výšky', () => {
  const line = sampleLine({ t: T0, alt: 10_363, gs: 256.7, trk: 95.4, vr: 6, squawk: '7500', gnd: false }, t);
  assert.match(line, /^\d\d:\d\d UTC · FL340↑ 1.180 ft\/min · 499 kts · 095° · SQUAWK 7500$/);
  assert.match(sampleLine({ t: T0, alt: 0, gs: 5, trk: 10, gnd: true }, t), /hover\.on-ground · 10 kts · 010°/);
  assert.equal(sampleLine(null, t), '');
});

test('graf: čistí plátno, kreslí mriežku, plochu výšky, obe čiary, kurzor a popisky', () => {
  const calls = [];
  const rec = (name) => (...args) => { calls.push([name, ...args]); };
  const ctx = {
    clearRect: rec('clearRect'), beginPath: rec('beginPath'), moveTo: rec('moveTo'), lineTo: rec('lineTo'), stroke: rec('stroke'),
    fill: rec('fill'), closePath: rec('closePath'), fillText: rec('fillText'), strokeStyle: '', fillStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
  };
  const fixes = [
    { t: T0, lat: 0, lon: 0, alt: 0, gs: 50 }, { t: T0 + 600, lat: 1, lon: 1, alt: 8000, gs: 200 }, { t: T0 + 1200, lat: 2, lon: 2, alt: 2000, gs: 120 },
  ];
  drawFlightChart(ctx, chartSeries(fixes, { samples: 12 }), { width: 320, height: 120, cursorFrac: 0.25, altLabel: 'max FL262', gsLabel: 'max 389 kts', startLabel: '10:00', endLabel: '10:20' });
  assert.equal(calls[0][0], 'clearRect');
  assert.equal(calls.filter(([n]) => n === 'stroke').length, 4, 'mriežka + rýchlosť + výška + kurzor');
  assert.equal(calls.filter(([n]) => n === 'fill').length, 1, 'plocha výšky');
  const texts = calls.filter(([n]) => n === 'fillText').map(([, s]) => s);
  assert.deepEqual(texts, ['max FL262', 'max 389 kts', '10:00', '10:20']);
  const cursor = calls.find(([n, x, y]) => n === 'moveTo' && y === CHART_PAD.top - 4);
  assert.ok(cursor && Math.abs(cursor[1] - (CHART_PAD.left + 0.25 * (320 - CHART_PAD.left - CHART_PAD.right))) < 1e-9, 'kurzor na 25 %');
  // bez radu: len mriežka
  const calls2 = [];
  const ctx2 = { ...ctx, clearRect: () => calls2.push('clear'), stroke: () => calls2.push('stroke'), fill: () => calls2.push('fill'), fillText: () => calls2.push('text') };
  drawFlightChart(ctx2, null, { width: 100, height: 60 });
  assert.deepEqual(calls2, ['clear', 'stroke']);
});

function fakeDoc() {
  const make = (tag) => {
    const node = {
      tag, children: [], dataset: {}, style: {}, attributes: {}, listeners: {}, hidden: false, textContent: '', className: '', value: '',
      appendChild(c) { node.children.push(c); return c; },
      append(...cs) { node.children.push(...cs); },
      setAttribute(k, v) { node.attributes[k] = v; },
      getAttribute(k) { return node.attributes[k] ?? null; },
      addEventListener(type, fn) { (node.listeners[type] ||= []).push(fn); },
      querySelector(sel) { return sel === '[data-history-body]' ? node.body : null; },
      classList: { toggle() {}, add() {}, remove() {} },
      getContext: () => null,
      get clientWidth() { return 300; },
    };
    return node;
  };
  const root = make('div');
  root.body = make('div');
  return { createElement: make, getElementById: (id) => (id === 'history-panel' ? root : null), activeElement: null, root };
}

test('panel: vyhľadanie naplní zoznam, klik na úsek načíta trasu a spustí prehrávač, späť ho vyprázdni; open() otvorí panel s dopytom', async () => {
  const doc = fakeDoc();
  const legs = [{ id: 1, icao24: '4b1805', callsign: 'SWR11H', firstT: T0, lastT: T0 + 600, fixes: 20, maxAltM: 9000, squawks: [] }];
  const fixes = [{ t: T0, lat: 48, lon: 17, alt: 1000, gs: 100, trk: 90, vr: 0, squawk: null, gnd: false }, { t: T0 + 600, lat: 48.5, lon: 18, alt: 9000, gs: 220, trk: 90, vr: 0, squawk: null, gnd: false }];
  const api = { search: async () => legs, track: async () => fixes, status: async () => ({ fixes: 100, legs: 3, oldestT: T0 }) };
  const loaded = [];
  const replay = {
    loaded: null, listeners: [],
    load(fx) { loaded.push(fx.length); this.loaded = fx.length >= 2 ? fx : null; return !!this.loaded; },
    frame() {}, pause() {}, play() {}, toggle() {}, setSpeed() {}, setFollow() {}, seek() {}, seekFraction() {},
    onChange(fn) { this.listeners.push(fn); return () => {}; },
    getState() { return { loaded: !!this.loaded, playing: false, fraction: 0, speed: 10, follow: false, sample: this.loaded ? this.loaded[0] : null }; },
    destroy() {},
  };
  const collapsed = [];
  const tracked = [];
  const panel = installHistoryPanel({ viewer: {}, doc, t, api, replayFactory: () => replay, onTrackLive: (hex) => tracked.push(hex), setCollapsed: (c) => collapsed.push(c) });
  assert.ok(panel);
  await new Promise((r) => setTimeout(r, 0));
  panel.open({ query: 'swr' });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(collapsed, [false], 'open() rozbalí panel');
  assert.equal(panel._getStateForTest().legs, 1);
  // klik na výsledok
  const list = doc.root.body.children.find((c) => c.className === 'history-list');
  const legBtn = list.children[0].children[0];
  legBtn.listeners.click[0]();
  await new Promise((r) => setTimeout(r, 0));
  const st = panel._getStateForTest();
  assert.equal(st.detailOpen, true);
  assert.equal(st.fixes, 2);
  assert.deepEqual(loaded, [2], 'prehrávač dostal trasu');
  // TERAZ ŽIVO → hex
  const detail = doc.root.body.children.find((c) => c.className === 'history-detail');
  const controls = detail.children.find((c) => c.className === 'history-controls');
  const liveBtn = controls.children.find((c) => c.className === 'scene-btn history-live');
  liveBtn.listeners.click[0]();
  assert.deepEqual(tracked, ['4b1805']);
  // späť → prehrávač vyprázdnený
  const back = detail.children[0].children[0];
  back.listeners.click[0]();
  assert.equal(panel._getStateForTest().detailOpen, false);
  assert.deepEqual(loaded, [2, 0]);
  assert.equal(installHistoryPanel({ viewer: {}, doc: { getElementById: () => null }, t }), null, 'bez markupu null');
  panel.destroy();
});

test('panel: rad štátnych strojov — lety aj keď stroj nelieta, riadok s dátumom a trasou; showLeg otvorí let z pásu nad kartou', async () => {
  const doc = fakeDoc();
  const fixes = [{ t: T0, lat: 48, lon: 17, alt: 0, gs: 5, trk: 90, vr: 0, squawk: null, gnd: true }, { t: T0 + 600, lat: 48.5, lon: 18, alt: 9000, gs: 220, trk: 90, vr: 0, squawk: null, gnd: false }];
  const flights = [
    { id: 11, icao24: '505abc', callsign: 'SSG1', firstT: T0, lastT: T0 + 6780, durationS: 6780, fixes: 400, squawks: [], origin: { iata: 'BTS' }, destination: { iata: 'BRU' }, src: 'adsb.lol/archive' },
  ];
  const tracks = [];
  const api = {
    search: async () => [],
    track: async (hex, range) => { tracks.push([hex, range]); return fixes; },
    status: async () => ({ fixes: 1, legs: 1, oldestT: T0 }),
    stateList: async () => ({ aircraft: [{ hex: '505abc', reg: 'OM-TST', typeCode: 'A319' }] }),
    stateFlights: async (hex) => (hex === '505abc' ? flights : []),
  };
  const replay = {
    loaded: null,
    load(fx) { this.loaded = fx.length >= 2 ? fx : null; return !!this.loaded; },
    frame() {}, pause() {}, toggle() {}, setSpeed() {}, setFollow() {}, seekFraction() {},
    onChange() { return () => {}; },
    getState() { return { loaded: !!this.loaded, playing: false, fraction: 0, speed: 10, follow: false, sample: null }; },
    destroy() {},
  };
  const collapsed = [];
  const panel = installHistoryPanel({ viewer: {}, doc, t, api, replayFactory: () => replay, setCollapsed: (c) => collapsed.push(c) });
  await new Promise((r) => setTimeout(r, 0));
  const row = doc.root.body.children.find((c) => c.className === 'history-state-row');
  assert.equal(row.hidden, false, 'rad sa ukáže, keď zoznam nie je prázdny');
  const btn = row.children.find((c) => c.className === 'scene-btn history-state-btn');
  assert.equal(btn.textContent, 'OM-TST · A319');
  btn.listeners.click[0]();
  await new Promise((r) => setTimeout(r, 0));
  const list = doc.root.body.children.find((c) => c.className === 'history-list');
  const legBtn = list.children[0].children[0];
  assert.equal(legBtn.children[0].textContent, 'BTS → BRU', 'titulok = odvodená trasa');
  assert.match(legBtn.children[1].textContent, /^(\d{1,2}\. \d{1,2}\. \d{4}|\d{4}-\d{2}-\d{2}) · /, 'podtitul začína dátumom (lety cez roky; SK aj EN tvar)');
  const status = doc.root.body.children.find((c) => c.className === 'history-status');
  assert.match(status.textContent, /history\.state-results .*OM-TST/);
  // Z pásu nad kartou: konkrétny let rovno do detailu a prehrávača.
  panel.showLeg(flights[0]);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(panel._getStateForTest().detailOpen, true);
  assert.deepEqual(tracks[0], ['505abc', { fromS: T0 - 60, toS: T0 + 6780 + 60 }]);
  assert.ok(collapsed.includes(false), 'panel sa rozbalí');
  panel.destroy();
});

test('stav archívu: dnešný začiatok ako čas UTC, starší dátumom (archív drží roky — „od 14:07 UTC" pri dátach od 2023 klamal)', async () => {
  const { archiveSinceLabel } = await import('./historyPanel.js');
  const now = Date.UTC(2026, 8, 30, 18, 0) / 1000;
  assert.equal(archiveSinceLabel(now - 3600, now, 'sk'), '17:00 UTC');
  assert.equal(archiveSinceLabel(Date.UTC(2023, 1, 20, 0, 5) / 1000, now, 'sk'), '20. 2. 2023');
  assert.equal(archiveSinceLabel(Date.UTC(2023, 1, 20, 0, 5) / 1000, now, 'en'), '2023-02-20');
  assert.equal(archiveSinceLabel(null, now), '--:--');
});
