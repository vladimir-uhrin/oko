// src/stateFlightsStrip.test.mjs — pás štátneho lietadla nad kartou (2026-09-30). Vlastník: „chcem nejaký
// prepínač do karty". Testy SPRÁVANIA na DOM dvojníkovi: pás len pri stroji zo zoznamu, prepínač sa
// pamätá, lety sa načítajú raz na stroj, klik na let ho otvorí v Histórii, STARŠIE stránkuje.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATE_STRIP_BOTTOM_SAFE_NARROW_PX,
  STATE_STRIP_BOTTOM_SAFE_PX,
  STATE_STRIP_MIN_HEIGHT_PX,
  STATE_STRIP_OVERLAP_PX,
  STATE_STRIP_TOP_SAFE_PX,
  stripMaxHeight,
  stripPlacement,
  trackedHexFromId,
} from './stateFlightsStrip.js';

test('výška pásu: zoznam sa skráti nad spodný dok (úzka obrazovka aj nad SLEDOVAŤ/KOKPIT), hlavička s jedným letom ostane vždy', () => {
  assert.equal(stripMaxHeight(300, 900, 1600), 900 - 300 - STATE_STRIP_BOTTOM_SAFE_PX, 'široká obrazovka: nad dokom');
  assert.equal(stripMaxHeight(384, 860, 702), 860 - 384 - STATE_STRIP_BOTTOM_SAFE_NARROW_PX, 'naživo 702×860: nad plávajúcimi tlačidlami');
  assert.equal(stripMaxHeight(800, 860, 702), STATE_STRIP_MIN_HEIGHT_PX);
});

test('hex zo záznamu karty: lietadlá aj vojenské, iné vrstvy nie', () => {
  assert.equal(trackedHexFromId('flights:505ABC'), '505abc');
  assert.equal(trackedHexFromId('military:ae0940'), 'ae0940');
  assert.equal(trackedHexFromId('satellites:25544'), null);
  assert.equal(trackedHexFromId('flights:xyz'), null);
  assert.equal(trackedHexFromId(null), null);
});

test('poloha pásu: pod kartou a fotkou, aspoň šírka karty, v okne; hore len keď dole nie je miesto a nezakryje ho horná lišta', () => {
  const vp = { w: 1000, h: 800 };
  // Karta prilepená hore (úzka obrazovka): pás pod ňou a pod fotkou, nie pod ikonami hornej lišty.
  const docked = stripPlacement({ x: 100, y: 62, w: 260, h: 320 }, { w: 320, h: 50 }, vp, { belowOffset: 60 });
  assert.deepEqual(docked, { x: 100, y: 62 + 320 - STATE_STRIP_OVERLAP_PX + 60, w: 320, above: false });
  const clamped = stripPlacement({ x: 900, y: 300, w: 260, h: 90 }, { w: 320, h: 50 }, vp);
  assert.equal(clamped.x + clamped.w <= vp.w - 4, true, 'nevyjde z okna');
  // Karta pri spodku obrazovky: pás ide nad ňu.
  const low = stripPlacement({ x: 100, y: 650, w: 260, h: 120 }, { w: 320, h: 50 }, vp);
  assert.deepEqual(low, { x: 100, y: 650 - 50 + STATE_STRIP_OVERLAP_PX, w: 320, above: true });
  // Vysoká karta bez miesta hore aj dole: ostane dole v okne, nikdy nie pod hornou lištou.
  const tall = stripPlacement({ x: 100, y: 70, w: 260, h: 700 }, { w: 320, h: 50 }, vp);
  assert.equal(tall.above, false);
  assert.ok(tall.y >= STATE_STRIP_TOP_SAFE_PX && tall.y + 50 <= vp.h - 4);
});

function fakeDom() {
  const make = (tag) => {
    const node = {
      tagName: tag, children: [], style: {}, hidden: false, className: '', textContent: '', attributes: {}, listeners: {}, type: '', title: '',
      classList: { toggle() {} },
      appendChild(c) { node.children.push(c); c.parentNode = node; return c; },
      append(...cs) { for (const c of cs) node.appendChild(c); },
      remove() { const p = node.parentNode; if (p) p.children = p.children.filter((c) => c !== node); },
      setAttribute(k, v) { node.attributes[k] = String(v); },
      getAttribute(k) { return node.attributes[k] ?? null; },
      addEventListener(type, fn) { (node.listeners[type] ||= []).push(fn); },
      querySelector() { return null; },
      get offsetWidth() { return 320; },
      get offsetHeight() { return 40; },
      ownerDocument: null,
    };
    Object.defineProperty(node, 'textContent', {
      get() { return node._text ?? ''; },
      set(v) { node._text = String(v); if (v === '') node.children = []; },
    });
    return node;
  };
  const doc = { createElement: (tag) => { const n = make(tag); n.ownerDocument = doc; return n; }, defaultView: { innerWidth: 1200, innerHeight: 800 }, querySelector: () => null };
  const body = make('body');
  body.ownerDocument = doc;
  return { doc, body };
}
const find = (node, cls) => {
  if (String(node.className).split(' ').includes(cls)) return node;
  for (const c of node.children || []) { const hit = find(c, cls); if (hit) return hit; }
  return null;
};
const tick = () => new Promise((r) => setTimeout(r, 0));

test('pás: odznak len pri štátnom stroji, prepínač si pamätá stav, lety raz na stroj, klik otvorí let, STARŠIE stránkuje', async () => {
  const client = await import('./data/stateAircraftClient.js');
  client._resetStateAircraftClientForTest();
  const strip = await import('./stateFlightsStrip.js');
  const readout = await import('./data/trackedReadout.js');
  const hadWindow = typeof globalThis.window !== 'undefined';
  if (!hadWindow) globalThis.window = { addEventListener() {}, removeEventListener() {} };
  readout._setTrackedOverlayHostForTest({ setEntries() {}, setVisible() {}, clearSource() {} });
  const entity = { gevTrackedId: 'flights:3c6444', gevLabelModel: { title: 'DLH1', details: [] }, gevDisplayPosition: () => null };
  readout.initTrackedReadout({ trackedEntity: entity, trackedEntityChanged: { addEventListener: () => () => {} } });

  const T = Date.UTC(2026, 8, 25, 10) / 1000;
  const page = (n, start) => Array.from({ length: n }, (_, i) => ({ id: start + i, callsign: 'SSG1', firstT: T - i * 86_400, lastT: T - i * 86_400 + 3600, durationS: 3600, fixes: 100, squawks: [], origin: { iata: 'BTS' }, destination: { iata: 'BRU' } }));
  const urls = [];
  const fetcher = async (url) => {
    urls.push(url);
    if (url === '/api/state-aircraft') {
      return { ok: true, json: async () => ({ aircraft: [{ hex: '505abc', reg: 'OM-TST', typeCode: 'A319', role: 'government', country: 'SK', operator: { sk: 'Test útvar', en: 'Test unit' } }] }) };
    }
    const before = new URL(url, 'http://x').searchParams.get('before');
    return { ok: true, json: async () => ({ hex: '505abc', flights: before ? page(3, 100) : page(20, 1) }) };
  };
  const stored = new Map();
  const storage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v) };
  const listeners = [];
  const viewer = { scene: { postRender: { addEventListener: (fn) => listeners.push(fn), removeEventListener() {} } } };
  const { body } = fakeDom();
  const opened = [];
  const all = [];
  try {
    strip.installStateFlightsStrip(viewer, { container: body, fetcher, storage, onOpenLeg: (f) => opened.push(f), onOpenAll: (h) => all.push(h) });
    await tick();
    const root = body.children[0];
    listeners[0]();
    assert.equal(strip._stateFlightsStripForTest().hex, null, 'bežné lietadlo: bez pásu');
    assert.equal(root.hidden, true);

    entity.gevTrackedId = 'flights:505abc';
    readout.refreshTrackedReadout(entity);
    listeners[0]();
    assert.equal(strip._stateFlightsStripForTest().hex, '505abc');
    assert.match(find(root, 'state-strip-badge').textContent, /lietadlo|aircraft/i);
    assert.match(find(root, 'state-strip-meta').textContent, /OM-TST/);
    const toggle = find(root, 'state-strip-toggle');
    assert.equal(toggle.getAttribute('aria-pressed'), 'false');
    assert.equal(urls.filter((u) => u.includes('/flights')).length, 0, 'lety sa nesťahujú, kým je prepínač vypnutý');

    toggle.listeners.click[0]();
    await tick();
    assert.equal(toggle.getAttribute('aria-pressed'), 'true');
    assert.equal(stored.get('oko.stateFlights.open'), '1', 'prepínač si prehliadač pamätá');
    const list = find(root, 'state-strip-list');
    assert.equal(list.hidden, false);
    assert.equal(list.children.length, 20);
    assert.equal(find(list.children[0], 'state-strip-route').textContent, 'BTS → BRU');

    find(list.children[1], 'state-strip-flight-btn').listeners.click[0]();
    assert.equal(opened[0].id, 2);
    assert.equal(opened[0].icao24, '505abc', 'let ide do Histórie aj s hexom');

    find(root, 'state-strip-more').listeners.click[0]();
    await tick();
    const moreUrl = urls.filter((u) => u.includes('/flights'))[1];
    assert.match(moreUrl, new RegExp(`before=${T - 19 * 86_400 + 3600}`), 'STARŠIE pokračuje od posledného letu');
    assert.equal(list.children.length, 23);
    find(root, 'state-strip-all').listeners.click[0]();
    assert.deepEqual(all, ['505abc']);

    // Iný stroj a späť: lety toho istého stroja sa znova nesťahujú.
    entity.gevTrackedId = 'flights:3c6444';
    readout.refreshTrackedReadout(entity);
    listeners[0]();
    entity.gevTrackedId = 'flights:505abc';
    readout.refreshTrackedReadout(entity);
    listeners[0]();
    await tick();
    assert.equal(urls.filter((u) => u.includes('/flights')).length, 2);
  } finally {
    strip.destroyStateFlightsStrip();
    readout.destroyTrackedReadout();
    readout._setTrackedOverlayHostForTest(null);
    if (!hadWindow) delete globalThis.window;
    client._resetStateAircraftClientForTest();
  }
});
