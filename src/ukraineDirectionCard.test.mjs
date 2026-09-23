// src/ukraineDirectionCard.test.mjs — karta smeru (B5) vo falošnom DOM:
// skrytá bez smeru, stĺpce s dierami/bodkami/šrafou, trend, sídla s klikom,
// celý front bez sídiel, chyba archívu, a vloženie pod tlačidlo smeru v paneli.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createUkraineDirectionCard } from './ukraineDirectionCard.js';
import { createUkrainePanel } from './ukrainePanel.js';
import { buildPlaceIndex } from './data/ukraineReportPlaces.js';

function fakeDocument() {
  const makeEl = (tag) => {
    const classes = new Set();
    const el = {
      tag, children: [], parent: null, textContent: '', hidden: false, disabled: false, dataset: {}, attrs: {}, listeners: {}, style: {}, title: '', type: '',
      get className() { return [...classes].join(' '); },
      set className(v) { classes.clear(); for (const c of String(v).split(/\s+/)) if (c) classes.add(c); },
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); }, contains: (c) => classes.has(c) },
      get nextSibling() { const sib = el.parent?.children; if (!sib) return null; const i = sib.indexOf(el); return sib[i + 1] || null; },
      appendChild(c) { c.parent?.children.splice(c.parent.children.indexOf(c), 1); el.children.push(c); c.parent = el; return c; },
      insertBefore(c, ref) {
        if (c.parent) c.parent.children.splice(c.parent.children.indexOf(c), 1);
        const i = ref ? el.children.indexOf(ref) : -1;
        if (i < 0) el.children.push(c); else el.children.splice(i, 0, c);
        c.parent = el; return c;
      },
      replaceChildren(...cs) { el.children = [...cs]; for (const c of cs) c.parent = el; },
      remove() { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); el.parent = null; },
      href: '', target: '', rel: '',
      addEventListener(t, fn) { el.listeners[t] = fn; },
      setAttribute(k, v) { el.attrs[k] = v; },
      click() { el.listeners.click?.(); },
    };
    return el;
  };
  return { createElement: makeEl };
}
const walk = (node, out = []) => { for (const c of node.children) { out.push(c); walk(c, out); } return out; };
const byClass = (root, cls) => walk(root).filter((n) => n.classList.contains(cls));
const one = (root, cls) => byClass(root, cls)[0];
const tKey = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);
const flush = () => new Promise((r) => setTimeout(r, 0));

const SCENES = {
  lyman: { id: 'lyman', name: 'Lyman direction', center: { lat: 49.0, lon: 37.85 }, gs: ['Лиманський'] },
  front: { id: 'front', name: 'Whole front', overview: true, center: { lat: 48.4, lon: 36.6 }, gs: [] },
};
const sceneById = (id) => SCENES[id] || null;
const sceneFor = (gs) => (gs === 'Лиманський' ? SCENES.lyman : null);
const lymanRep = (attacks, { text = 'На Лиманському напрямку ворог атакував у районі Ставків.', at = '08:00' } = {}) => ({ total: 230, reportedAtText: `${at} 1.9.`, directions: [{ gs: 'Лиманський', attacks, text, shared: false }] });

function payload() {
  const days = {};
  for (let d = 25; d <= 31; d += 1) days[`2026-08-${d}`] = lymanRep(5);
  for (let d = 1; d <= 16; d += 1) days[`2026-09-${String(d).padStart(2, '0')}`] = lymanRep(5);
  days['2026-09-17'] = { total: 230, reportedAtText: '08:00 17.9.', directions: [] }; // smer nespomenutý
  // 18. 9. chýba
  for (let d = 19; d <= 22; d += 1) days[`2026-09-${d}`] = lymanRep(12);
  days['2026-09-23'] = lymanRep(14);
  days['2026-09-20'] = lymanRep(4, { at: '16:00' }); // popoludňajšie
  return { days };
}
const index = buildPlaceIndex([{ properties: { name: 'Ставки', en: 'Stavky', cls: 'village' }, geometry: { coordinates: [37.9, 49.05] } }]);

test('bez načítavača je karta inertná', () => {
  const inert = createUkraineDirectionCard({ loadDirections: null, documentRef: fakeDocument() });
  assert.equal(inert.element, null);
  inert.setScene('lyman'); inert.setRefDay('2026-09-23'); inert.destroy();
});

test('smer: 30 stĺpcov s dierou/bodkou/šrafou, dnešok, trend, sídla s klikom', async () => {
  const calls = [];
  const flown = [];
  const card = createUkraineDirectionCard({
    loadDirections: async (from, to) => { calls.push([from, to]); return payload(); },
    placeIndex: async () => index,
    onPlace: (p) => flown.push(p),
    sceneById, sceneFor, translate: tKey, lang: 'sk', documentRef: fakeDocument(), now: () => Date.UTC(2026, 8, 23, 12),
  });
  assert.equal(card.element.hidden, true, 'bez smeru skrytá');
  card.setRefDay('2026-09-23');
  assert.deepEqual(calls, [], 'bez smeru sa nič nesťahuje');
  card.setScene('lyman');
  await flush(); await flush();
  assert.deepEqual(calls, [['2026-08-25', '2026-09-23']]);
  const root = card.element;
  assert.equal(root.hidden, false);
  assert.equal(one(root, 'ukraine-dircard-gs').textContent, 'Лиманський');
  const bars = byClass(root, 'ukraine-dircard-bar');
  assert.equal(bars.length, 30);
  const bar = (day) => bars.find((b) => b.dataset.day === day);
  assert.ok(bar('2026-09-18').classList.contains('is-missing'), 'chýbajúce hlásenie = prázdny stĺpec');
  assert.ok(bar('2026-09-17').classList.contains('is-unmentioned'), 'nespomenutý smer = bodka');
  assert.ok(bar('2026-09-20').classList.contains('is-partial'), 'popoludňajšie hlásenie = šrafa');
  assert.ok(bar('2026-09-23').classList.contains('is-ref'));
  assert.equal(bar('2026-09-23').style.height, '100%');
  assert.match(bar('2026-09-18').title, /bar-missing/);
  assert.equal(one(root, 'ukraine-dircard-num').textContent, '14');
  assert.match(one(root, 'ukraine-dircard-unit').textContent, /ukraine\.dircard\.today /);
  const trend = one(root, 'ukraine-dircard-trend');
  assert.equal(trend.hidden, false);
  assert.equal(trend.dataset.trend, 'up', '5 → 12–14 útokov');
  assert.match(one(root, 'ukraine-dircard-stats').textContent, /ukraine\.dircard\.stats /);
  const st = card.getState().last.stats;
  // Posledných 7 dní = 17.–23. 9.: nespomenutý 17., chýbajúci 18., popoludňajší 20. sa nerátajú.
  assert.equal(st.avgRecent, (12 * 3 + 14) / 4, 'popoludňajšie 4 mimo priemeru, nespomenutý a chýbajúci deň tiež');
  const places = byClass(root, 'ukraine-dircard-place');
  assert.equal(places.length, 1);
  assert.match(places[0].textContent, /"name":"Stavky","days":12/, "14 dní (10.–23. 9.) mínus nespomenutý 17. a chýbajúci 18.");
  places[0].click();
  assert.deepEqual(flown, [{ lat: 49.05, lon: 37.9, name: 'Stavky', cls: 'village' }]);
  assert.match(one(root, 'ukraine-dircard-note').textContent, /ukraine\.dircard\.note/);

  // Iný smer s tým istým dňom = bez nového dopytu; iný deň = nový rozsah.
  card.setScene('front');
  await flush(); await flush();
  assert.equal(calls.length, 1);
  assert.ok(root.classList.contains('is-overview'));
  assert.equal(one(root, 'ukraine-dircard-num').textContent, '230');
  assert.equal(one(root, 'ukraine-dircard-places').hidden, true, 'celý front bez sídiel');
  card.setRefDay('2026-09-01');
  await flush(); await flush();
  assert.deepEqual(calls[1], ['2026-08-03', '2026-09-01']);
  card.setScene(null);
  assert.equal(root.hidden, true);
});

test('chyba archívu: poctivá správa, žiadne čísla', async () => {
  const card = createUkraineDirectionCard({
    loadDirections: async () => { throw new Error('HTTP 502'); },
    sceneById, sceneFor, translate: tKey, lang: 'sk', documentRef: fakeDocument(), now: () => Date.UTC(2026, 8, 23, 12),
  });
  card.setScene('lyman');
  await flush(); await flush();
  const status = one(card.element, 'ukraine-dircard-status');
  assert.equal(status.hidden, false);
  assert.equal(status.dataset.state, 'error');
  assert.match(status.textContent, /HTTP 502/);
  assert.equal(byClass(card.element, 'ukraine-dircard-bar').length, 0);
  assert.equal(card.getState().error, 'HTTP 502');
});

test('panel: karta ide pod tlačidlo aktívneho smeru a berie deň zobrazeného hlásenia', async () => {
  const doc = fakeDocument();
  const mount = doc.createElement('div');
  const layer = { getState: () => ({ shown: false, parts: {} }), onChange: () => () => {}, loadMeta: async () => null };
  const reportListeners = new Set();
  let reportState = { enabled: true, report: null, byScene: {} };
  const report = { getState: () => reportState, onChange: (fn) => { reportListeners.add(fn); return () => reportListeners.delete(fn); } };
  const seen = [];
  const card = createUkraineDirectionCard({
    loadDirections: async (from, to) => { seen.push([from, to]); return payload(); },
    sceneById, sceneFor, translate: tKey, lang: 'sk', documentRef: doc, now: () => Date.UTC(2026, 8, 23, 12),
  });
  const panel = createUkrainePanel({ mountTarget: mount, layer, report, directionCard: card, scenes: [SCENES.front, SCENES.lyman], translate: tKey, lang: 'sk', documentRef: doc });
  const dirs = one(mount, 'ukraine-dirs');
  panel.setActiveScene('lyman');
  const kids = dirs.children;
  assert.equal(kids.indexOf(card.element), kids.findIndex((b) => b.dataset?.front === 'lyman') + 1, 'hneď pod Lymanom');
  panel.setActiveScene('front');
  assert.equal(kids.indexOf(card.element), kids.findIndex((b) => b.dataset?.front === 'front') + 1, 'presunie sa pod celý front');
  reportState = { ...reportState, report: { reportedAt: '2026-09-10T05:00:00.000Z', total: 1, directions: [] } };
  for (const fn of reportListeners) fn(reportState);
  await flush(); await flush();
  assert.equal(card.getState().refDay, '2026-09-10');
  assert.deepEqual(seen.at(-1), ['2026-08-12', '2026-09-10']);
  panel.destroy();
  const before = seen.length;
  card.setScene('lyman');
  await flush();
  assert.equal(seen.length, before, 'zničená karta už nič nesťahuje');
});
