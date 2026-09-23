// src/ukraineKartaOverlay.test.mjs — rám hotovej mapy KARTA (K5): projekcia
// mapky, modely titulku/legendy, DOM ostrovy, čistá karta, kresba do snímky.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KARTA_OVERLAY_ID,
  createUkraineKartaOverlay,
  drawKartaExport,
  insetRingPath,
  kartaDateText,
  kartaLegendItems,
  kartaSources,
  kartaTitleModel,
  makeInsetProjection,
} from './ukraineKartaOverlay.js';

const BBOX = [22, 45, 40, 52.5];

test('makeInsetProjection: rohy bboxu, zachovaný pomer, obdĺžnik pohľadu', () => {
  const proj = makeInsetProjection(BBOX, 150, 108, 6);
  const nw = proj.project(BBOX[0], BBOX[3]);
  const se = proj.project(BBOX[2], BBOX[1]);
  assert.ok(nw.x >= 6 - 1e-6 && nw.y >= 6 - 1e-6, 'severozápad v ráme s okrajom');
  assert.ok(se.x <= 150 - 6 + 1e-6 && se.y <= 108 - 6 + 1e-6, 'juhovýchod v ráme');
  assert.ok(se.x > nw.x && se.y > nw.y, 'x rastie na východ, y dole na juh');
  const r = proj.rect([37, 48, 38, 49]);
  assert.ok(r.w >= 3 && r.h >= 3 && r.x > nw.x && r.y > nw.y);
});

test('insetRingPath: M…L…Z, prázdny prstenec = prázdno', () => {
  const proj = makeInsetProjection(BBOX, 100, 100, 4);
  const d = insetRingPath(proj.project, [[22, 52], [40, 52], [40, 45]]);
  assert.match(d, /^M[\d.]+ [\d.]+ L.*Z$/);
  assert.equal(insetRingPath(proj.project, []), '');
});

test('kartaDateText a kartaTitleModel: prednosť GŠ → DeepState → revízia', () => {
  assert.equal(kartaDateText({ report: { reportedAtText: '08:00 19.9.' }, deepstate: { stampText: 'x' } }), '08:00 19.9.');
  assert.equal(kartaDateText({ deepstate: { stampText: '18.9.2026 19:25 UTC' } }), '18.9.2026 19:25 UTC');
  assert.equal(kartaDateText({ control: { revisionAt: '2026-08-13T09:28:11Z' } }), '2026-08-13');
  assert.equal(kartaDateText({}), '');
  const m = kartaTitleModel({ scene: { id: 'lyman', name: 'Lyman direction' }, dateText: '08:00 19.9.', sources: ['A', 'B'], translate: (k, v) => (v ? `${k}:${v.date}` : k) });
  assert.ok(m.title, 'titulok má názov smeru');
  assert.equal(m.subtitle, 'ukraine.karta.state:08:00 19.9.');
  assert.equal(m.sources, 'A · B');
  assert.equal(kartaTitleModel({ translate: (k) => k }).title, 'ukraine.karta.title', 'bez smeru všeobecný názov');
});

test('kartaSources a kartaLegendItems podľa zapnutých vrstiev', () => {
  const tr = (k) => k;
  assert.deepEqual(kartaSources({ report: { shown: true }, deepstate: { shown: true }, translate: tr }), ['ukraine.karta.src.gs', 'ukraine.karta.src.deepstate', 'ukraine.karta.src.osm']);
  assert.deepEqual(kartaSources({ control: { shown: true }, translate: tr }), ['ukraine.karta.src.wiki', 'ukraine.karta.src.osm']);
  // DeepState zapnutý → obsadené + sivá zóna, kontrola sa nekreslí
  const ds = kartaLegendItems({ deepstate: { shown: true }, report: { shown: true }, translate: tr });
  assert.deepEqual(ds.map((i) => i.key), ['occupied', 'grey', 'pin-ua', 'pin-ru', 'combat', 'road']);
  assert.equal(ds.find((i) => i.key === 'grey').pattern, 'hatch');
  // len kontrola (bez DeepState) → ru namiesto occupied/grey; bez STRETY žiadny combat
  const ctl = kartaLegendItems({ control: { shown: true }, translate: tr });
  assert.deepEqual(ctl.map((i) => i.key), ['ru', 'pin-ua', 'pin-ru', 'road']);
});

// ── DOM ─────────────────────────────────────────────────────────────────────
function fakeNode(tag) {
  const classes = new Set();
  const handlers = {};
  const node = {
    tagName: String(tag).toUpperCase(), children: [], _attrs: {}, textContent: '', id: '', type: '',
    style: { setProperty(k, v) { this[k] = v; } },
    get className() { return [...classes].join(' '); },
    set className(v) { classes.clear(); for (const c of String(v).split(/\s+/)) if (c) classes.add(c); },
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, force) => { const on = force === undefined ? !classes.has(c) : Boolean(force); if (on) classes.add(c); else classes.delete(c); return on; },
      contains: (c) => classes.has(c),
    },
    setAttribute(k, v) { node._attrs[k] = String(v); }, getAttribute(k) { return node._attrs[k] ?? null; },
    append(...kids) { node.children.push(...kids); }, appendChild(k) { node.children.push(k); return k; },
    replaceChildren(...kids) { node.children = kids; },
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    dispatch(type) { for (const fn of handlers[type] || []) fn({}); },
    remove() {},
  };
  return node;
}
function fakeDocument() {
  const body = fakeNode('body');
  return { createElement: (t) => fakeNode(t), createElementNS: (_ns, t) => fakeNode(t), body };
}
function fakeLayer(shown, state = {}) {
  const listeners = new Set();
  return { getState: () => ({ shown, ...state }), isShown: () => shown, onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }, _emit() { for (const fn of listeners) fn(); } };
}

test('DOM: ostrov je viditeľný len na KARTE a pri priblížení; titulok a legenda sa naplnia', () => {
  const doc = fakeDocument();
  const overlay = createUkraineKartaOverlay({
    documentRef: doc, translate: (k) => k, lang: () => 'sk',
    control: fakeLayer(false), deepstate: fakeLayer(true), report: fakeLayer(true),
    getViewRect: () => [37, 48, 38, 49],
  });
  assert.equal(overlay.id, KARTA_OVERLAY_ID);
  const st = overlay._getStateForTest();
  assert.equal(overlay.isVisible(), false, 'default = skryté');
  overlay.setStack({ kind: 'hillshade' });
  overlay.setScene({ id: 'lyman', name: 'Lyman direction', center: { lon: 37.8, lat: 49 } });
  assert.equal(overlay.isVisible(), true, 'KARTA + revealed');
  assert.ok(st.titleH.textContent, 'titulok naplnený');
  assert.ok(st.legendList.children.length >= 4, 'legenda má riadky');
  assert.equal(st.viewRectEl._attrs.width !== undefined, true, 'obdĺžnik pohľadu vykreslený');
  // pohľad na planétu (brána) skryje
  overlay.setRevealed(false);
  assert.equal(overlay.isVisible(), false);
  overlay.setRevealed(true);
  // iný podklad skryje a zruší čistú kartu
  overlay.setClean(true);
  assert.equal(doc.body.classList.contains('oko-karta-clean'), true);
  overlay.setStack({ kind: 'osm' });
  assert.equal(overlay.isVisible(), false);
  assert.equal(doc.body.classList.contains('oko-karta-clean'), false, 'mimo KARTY sa čistá karta zruší');
});

test('DOM: „čistá karta" prepína triedu tela, „Snímka" volá onExport', () => {
  const doc = fakeDocument();
  let exports = 0; let cleans = [];
  const overlay = createUkraineKartaOverlay({
    documentRef: doc, translate: (k) => k,
    control: fakeLayer(true), deepstate: fakeLayer(false), report: fakeLayer(false),
    onExport: () => { exports += 1; }, onCleanChange: (c) => cleans.push(c),
  });
  const { cleanBtn, shotBtn } = overlay._getStateForTest();
  cleanBtn.dispatch('click');
  assert.equal(overlay.isClean(), true);
  assert.equal(doc.body.classList.contains('oko-karta-clean'), true);
  assert.equal(cleanBtn.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(cleans, [true]);
  cleanBtn.dispatch('click');
  assert.equal(overlay.isClean(), false);
  shotBtn.dispatch('click');
  assert.equal(exports, 1);
  overlay.destroy();
  assert.equal(doc.body.classList.contains('oko-karta-clean'), false);
});

test('drawKartaExport: nakreslí titulok/legendu/mapku bez pádu, prázdny model neuškodí', () => {
  const texts = [];
  const ctx = new Proxy({
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textBaseline: '',
    measureText: (t) => ({ width: String(t).length * 7 }),
    fillText: (t) => texts.push(t),
    save() {}, restore() {}, translate() {}, beginPath() {}, moveTo() {}, lineTo() {}, arcTo() {}, arc() {}, closePath() {}, fill() {}, stroke() {}, fillRect() {}, strokeRect() {},
  }, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  const model = {
    title: { title: 'Lyman', subtitle: 'stav k 08:00', sources: 'GŠ · OSM' },
    legend: [{ key: 'ru', colorCss: '#e0553f', label: 'ruská kontrola' }, { key: 'pin-ua', colorCss: '#5b8fd0', dot: true, label: 'sídlo UA' }],
    legendHead: 'LEGENDA', scene: { center: { lon: 37.8, lat: 49 } }, viewRect: [37, 48, 38, 49],
  };
  assert.doesNotThrow(() => drawKartaExport(ctx, model, 1200, 594));
  assert.ok(texts.includes('LYMAN') || texts.includes('Lyman'), 'titulok vykreslený');
  assert.ok(texts.includes('ruská kontrola'));
  assert.doesNotThrow(() => drawKartaExport(ctx, null, 1200, 594), 'prázdny model neuškodí');
});

test('A2: vzorka ruskej kontroly na KARTE sa stlmí spolu s mapou', async () => {
  const { STALE_DIM } = await import('./data/ukraineFreshness.js');
  const staleItems = kartaLegendItems({ control: { shown: true, stale: true } });
  const freshItems = kartaLegendItems({ control: { shown: true, stale: false } });
  assert.equal(staleItems.find((i) => i.key === 'ru').dim, STALE_DIM);
  assert.equal(freshItems.find((i) => i.key === 'ru').dim, undefined, 'čerstvá vzorka bez stlmenia');
  // Špendlíky sídiel nie sú zo snímky Wikipédie — nestlmujú sa.
  assert.equal(staleItems.find((i) => i.key === 'pin-ua').dim, undefined);
});
