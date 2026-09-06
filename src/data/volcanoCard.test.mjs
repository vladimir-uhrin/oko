// src/data/volcanoCard.test.mjs
// DOM karta sopky (2026-09-05): otvorí ju udalosť vrstvy, sidecar doplní údaje,
// fotka len so slobodnou licenciou, Escape/krížik zavrie a vráti výber vrstve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  VOLCANO_CLEARED_EVENT, VOLCANO_SELECTED_EVENT,
  installVolcanoCard, destroyVolcanoCard, _getVolcanoCardStateForTest, _resetVolcanoCardForTest,
} from './volcanoCard.js';

function dom() {
  const makeEl = (tag) => ({
    tagName: tag, children: [], style: {}, hidden: false, className: '', attrs: {}, listeners: {}, dataset: {},
    get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : (this._text ?? ''); },
    set textContent(v) { this._text = v; this.children = []; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    remove() { const p = this.parentNode; if (p) p.children = p.children.filter((c) => c !== this); },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    get offsetWidth() { return 320; }, get offsetHeight() { return 240; },
    ownerDocument: null,
  });
  const doc = { createElement: (tag) => { const el = makeEl(tag); el.ownerDocument = doc; return el; }, defaultView: { innerWidth: 1200, innerHeight: 800 } };
  const container = makeEl('body'); container.ownerDocument = doc;
  return { doc, container };
}

test('sopky: karta — výber otvorí, sidecar doplní výšku a typ, fotka so slobodnou licenciou, zavretie vráti výber', async () => {
  _resetVolcanoCardForTest();
  const { container } = dom();
  const handlers = {};
  const eventTarget = { addEventListener: (type, fn) => { handlers[type] = fn; }, removeEventListener: (type) => { delete handlers[type]; } };
  const postRender = { listeners: [], addEventListener(fn) { this.listeners.push(fn); }, removeEventListener(fn) { this.listeners = this.listeners.filter((l) => l !== fn); } };
  const viewer = { scene: { postRender, mode: 3, camera: { positionWC: { x: 1, y: 2, z: 3 } } } };
  const fetched = [];
  const fetchImpl = async (url) => {
    const u = String(url); fetched.push(u);
    if (u.includes('sidecar')) return { ok: true, json: async () => ({ volcanoes: [{ id: 1, name: 'Etna', lat: 37.751, lon: 14.993, eleM: 3403, type: 'stratovolcano', status: 'active', wikipedia: 'it:Etna' }] }) };
    if (u.includes('prop=pageimages')) return { ok: true, json: async () => ({ query: { pages: { 1: { title: 'Etna', pageimage: 'Etna.jpg', thumbnail: { source: 'https://upload.wikimedia.org/x/Etna.jpg', width: 640, height: 400 } } } } }) };
    if (u.includes('prop=imageinfo')) return { ok: true, json: async () => ({ query: { pages: { 2: { title: 'File:Etna.jpg', imageinfo: [{ descriptionurl: 'https://commons.wikimedia.org/wiki/File:Etna.jpg', extmetadata: { Artist: { value: 'Someone' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' } } }] } } } }) };
    return { ok: false };
  };
  let closed = 0;
  installVolcanoCard(viewer, { container, eventTarget, fetchImpl, sidecarUrl: 'test://sidecar.json', onClosed: () => { closed++; } });
  try {
    assert.equal(container.children.length, 1);
    assert.equal(container.children[0].className, 'airport-card volcano-card', 'rovnaké CSS ako karta letiska');
    assert.equal(_getVolcanoCardStateForTest().hidden, true);
    const event = { id: 'EONET_1', title: 'Etna Volcano, Italy', lat: 37.751, lon: 14.993, time: Date.now() - 3 * 86_400_000, firstTime: Date.now() - 3 * 86_400_000, reports: 1, sources: [{ id: 'SIVolcano', url: 'https://volcano.si.edu/volcano.cfm?vn=211060' }] };
    handlers[VOLCANO_SELECTED_EVENT]({ detail: event });
    let s = _getVolcanoCardStateForTest();
    assert.equal(s.hidden, false);
    assert.match(s.text, /Etna/); assert.match(s.text, /Reported activity/);
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
    s = _getVolcanoCardStateForTest();
    assert.equal(s.hasMatch, true, 'sidecar doplnený');
    assert.match(s.text, /Stratovolcano · 3 403 m · Italy/);
    assert.match(s.text, /Active/);
    assert.match(s.text, /Smithsonian GVP/); assert.match(s.text, /Wikipedia/);
    assert.equal(s.hasPhoto, true, 'fotka so slobodnou licenciou');
    assert.match(s.text, /Someone · CC BY-SA 4.0/);
    assert.equal(fetched.filter((u) => u.includes('sidecar')).length, 1);
    // Escape zavrie a povie vrstve, nech zruší výber.
    handlers.keydown({ key: 'Escape' });
    assert.equal(_getVolcanoCardStateForTest().hidden, true);
    assert.equal(closed, 1);
    // Druhé otvorenie: sidecar z pamäte, bez ďalšieho fetchu.
    handlers[VOLCANO_SELECTED_EVENT]({ detail: event });
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
    assert.equal(fetched.filter((u) => u.includes('sidecar')).length, 1);
    handlers[VOLCANO_CLEARED_EVENT]({});
    assert.equal(_getVolcanoCardStateForTest().hidden, true);
    destroyVolcanoCard();
    assert.equal(container.children.length, 0);
    assert.equal(Object.keys(handlers).length, 0, 'listenery odhlásené');
    assert.equal(postRender.listeners.length, 0);
  } finally {
    _resetVolcanoCardForTest();
  }
});

test('sopky: tripwire — vrstva má 3D model s minimumPixelSize a stropom, dym, ui zapája kartu, model existuje s CC0 v README', () => {
  const layer = readFileSync(new URL('./volcanoes.js', import.meta.url), 'utf8');
  assert.match(layer, /uri: VOLCANO_MODEL_URL, minimumPixelSize: VOLCANO_MODEL_MIN_PX, maximumScale: VOLCANO_MODEL_MAX_SCALE/);
  assert.match(layer, /heightReference: Cesium\.HeightReference\.CLAMP_TO_GROUND/);
  assert.doesNotMatch(layer, /volcano-plume|plumeImage/, 'dymový billboard je preč (2026-09-06)');
  assert.match(layer, /emit\(VOLCANO_SELECTED_EVENT, event\)/);
  const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
  assert.match(ui, /installVolcanoCard\(viewer, \{/);
  assert.match(ui, /destroyVolcanoCard\(\)/);
  const glb = readFileSync(new URL('../../public/models/volcano.glb', import.meta.url));
  assert.equal(glb.toString('ascii', 0, 4), 'glTF');
  assert.equal(glb.readUInt32LE(8), glb.length, 'GLB hlavička nesie správnu dĺžku');
  const readme = readFileSync(new URL('../../public/models/README.md', import.meta.url), 'utf8');
  assert.match(readme, /volcano\.glb.*CC0/);
});
