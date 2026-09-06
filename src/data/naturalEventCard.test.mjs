// src/data/naturalEventCard.test.mjs
// DOM karta prírodnej udalosti (2026-09-06): výber otvorí kartu s popisom,
// odznakom cyklónu a odkazmi; Escape/krížik zavrie a vráti výber vrstve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  installNaturalEventCard, destroyNaturalEventCard,
  _getNaturalEventCardStateForTest, _resetNaturalEventCardForTest,
} from './naturalEventCard.js';
import { NATURAL_EVENT_CLEARED_EVENT, NATURAL_EVENT_SELECTED_EVENT } from './naturalEventInfo.js';

function dom() {
  const makeEl = (tag) => ({
    tagName: tag, children: [], style: {}, hidden: false, className: '', attrs: {}, listeners: {}, dataset: {},
    get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : (this._text ?? ''); },
    set textContent(v) { this._text = v; this.children = []; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    remove() { const p = this.parentNode; if (p) p.children = p.children.filter((c) => c !== this); },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    get offsetWidth() { return 320; }, get offsetHeight() { return 220; },
    ownerDocument: null,
  });
  const doc = { createElement: (tag) => { const el = makeEl(tag); el.ownerDocument = doc; return el; }, defaultView: { innerWidth: 1200, innerHeight: 800 } };
  const container = makeEl('body'); container.ownerDocument = doc;
  return { container };
}

test('udalosť: karta — hurikán ukáže intenzitu, popis a odkazy; zavretie vráti výber', () => {
  _resetNaturalEventCardForTest();
  const { container } = dom();
  const handlers = {};
  const eventTarget = { addEventListener: (type, fn) => { handlers[type] = fn; }, removeEventListener: (type) => { delete handlers[type]; } };
  const postRender = { listeners: [], addEventListener(fn) { this.listeners.push(fn); }, removeEventListener(fn) { this.listeners = this.listeners.filter((l) => l !== fn); } };
  const viewer = { scene: { postRender, mode: 3, camera: { positionWC: { x: 1, y: 2, z: 3 } } } };
  let closed = 0;
  installNaturalEventCard(viewer, { container, eventTarget, onClosed: () => { closed++; } });
  try {
    assert.equal(container.children[0].className, 'airport-card natural-event-card', 'zdieľa CSS karty letiska');
    assert.equal(_getNaturalEventCardStateForTest().hidden, true);
    const now = Date.now();
    const event = {
      id: 'EONET_23612', title: 'Hurricane Lowell', category: 'severeStorms', lat: 21.6, lon: -120.1,
      time: now - 3 * 3600_000, firstTime: now - 10 * 86_400_000, reports: 38,
      magnitude: { value: 80, unit: 'kts' }, peakKt: 115, description: '',
      track: Array.from({ length: 38 }, () => [0, 0]),
      sources: [{ id: 'NOAA_NHC', url: 'https://www.nhc.noaa.gov/x' }],
    };
    handlers[NATURAL_EVENT_SELECTED_EVENT]({ detail: event });
    const s = _getNaturalEventCardStateForTest();
    assert.equal(s.hidden, false);
    assert.match(s.text, /Hurricane Lowell/);
    assert.match(s.text, /CAT 1/, 'odznak Saffir-Simpson');
    assert.match(s.text, /80 kt sustained · peak 115 kt/);
    assert.match(s.text, /Tropical cyclone, currently 80 kt/, 'popis zložený z dát');
    assert.match(s.text, /NOAA NHC/); assert.match(s.text, /NASA EONET/);
    // Escape zavrie a povie vrstve.
    handlers.keydown({ key: 'Escape' });
    assert.equal(_getNaturalEventCardStateForTest().hidden, true);
    assert.equal(closed, 1);
    // Zrušenie výberu vrstvou zavrie kartu.
    handlers[NATURAL_EVENT_SELECTED_EVENT]({ detail: event });
    handlers[NATURAL_EVENT_CLEARED_EVENT]({});
    assert.equal(_getNaturalEventCardStateForTest().hidden, true);
    destroyNaturalEventCard();
    assert.equal(container.children.length, 0);
    assert.equal(Object.keys(handlers).length, 0, 'listenery odhlásené');
    assert.equal(postRender.listeners.length, 0);
  } finally {
    _resetNaturalEventCardForTest();
  }
});

test('udalosť: tripwire — vrstva emituje výber a má farebné špendlíky, ui zapája kartu', () => {
  const layer = readFileSync(new URL('./naturalEvents.js', import.meta.url), 'utf8');
  assert.match(layer, /emit\(NATURAL_EVENT_SELECTED_EVENT, event\)/, 'klik emituje výber pre DOM kartu');
  assert.doesNotMatch(layer, /overlayHost\.clear\('natural-event-detail'\)/, 'plátenná detail-karta nahradená DOM kartou');
  assert.match(layer, /accent: anyError\(\) \? STALE_ACCENT : categoryColor\(e\.category\)/, 'ambientný popis farbou kategórie');
  assert.match(layer, /fill="\$\{color\}"/, 'špendlík vyplnený farbou kategórie');
  assert.match(layer, /category === 'severeStorms' \? \{ w: 28/, 'búrky majú väčší špendlík');
  const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
  assert.match(ui, /installNaturalEventCard\(viewer, \{/);
  assert.match(ui, /destroyNaturalEventCard\(\)/);
  const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.nev-card-badge/); assert.match(css, /\.nev-card-stripe/);
});
