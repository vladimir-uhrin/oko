// src/contextMenu.test.mjs
// Pravé tlačidlo myši: menu pre glóbus, kontakt a riadok vrstvy (2026-09-06).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CONTEXT_MENU_DRAG_THRESHOLD_PX,
  buildContactMenuItems,
  buildGroundMenuItems,
  buildLayerMenuItems,
  createContextMenu,
  formatCoords,
  installDragGuard,
  placeMenu,
} from './contextMenu.js';
import { ownerOfPick, registerPickOwner, unregisterPickOwner } from './data/pickRegistry.js';
import { EN_STRINGS, SK_STRINGS } from './i18nStrings.js';

const tr = (strings) => (k, vars) => { let s = strings[k] || k; for (const [a, b] of Object.entries(vars || {})) s = s.replaceAll(`{${a}}`, String(b)); return s; };

test('položky kontaktu: lietadlo sleduj/prestaň + kokpit + kópia ICAO; loď vyber + MMSI; satelit sleduj + NORAD', () => {
  const t = tr(SK_STRINGS);
  const plane = buildContactMenuItems({ layerId: 'flights', id: '39de4f', isTracked: false, canCockpit: false }, t);
  assert.deepEqual(plane.map((i) => i.id), ['track', 'cockpit', 'history', 'copy-id']);
  assert.equal(plane[1].disabled, true, 'kokpit bez sledovania je vypnutý');
  assert.equal(plane[2].label, 'História letov', '2026-09-07: história pred kópiou ICAO');
  assert.match(plane[3].label, /39DE4F|39de4f/);
  const tracked = buildContactMenuItems({ layerId: 'military', id: 'ae1234', isTracked: true, canCockpit: true }, t);
  assert.deepEqual(tracked.map((i) => i.id), ['untrack', 'cockpit', 'history', 'copy-id']);
  assert.equal(tracked[1].disabled, false);
  const vessel = buildContactMenuItems({ layerId: 'ais-live-vessels', id: '244660123' }, t);
  assert.deepEqual(vessel.map((i) => i.id), ['select', 'copy-id']);
  assert.match(vessel[1].label, /MMSI/);
  const sat = buildContactMenuItems({ layerId: 'satellites', id: '25544' }, tr(EN_STRINGS));
  assert.deepEqual(sat.map((i) => i.id), ['track', 'copy-id']);
  assert.match(sat[0].label, /satellite/i);
  assert.match(sat[1].label, /NORAD/);
});

test('položky glóbusu: so súradnicami leť sem + kópia, vždy záložka + celý glóbus', () => {
  const t = tr(SK_STRINGS);
  const withPos = buildGroundMenuItems({ hasPosition: true, lat: 48.148333, lon: 17.106667 }, t);
  assert.deepEqual(withPos.map((i) => i.id), ['fly-here', 'copy-coords', 'bookmark', 'reset-globe']);
  assert.match(withPos[1].label, /48\.14833, 17\.10667/);
  const noPos = buildGroundMenuItems({ hasPosition: false }, t);
  assert.deepEqual(noPos.map((i) => i.id), ['bookmark', 'reset-globe']);
  assert.equal(formatCoords(48.1483333, 17.1066667), '48.14833, 17.10667');
});

test('položky vrstvy: zapnúť/vypnúť, len túto, vypnúť všetky — s vypnutými stavmi', () => {
  const t = tr(SK_STRINGS);
  const on = buildLayerMenuItems({ layerId: 'flights', name: 'Živé lety', enabled: true, otherEnabledCount: 2 }, t);
  assert.deepEqual(on.map((i) => i.id), ['toggle', 'solo', 'all-off']);
  assert.match(on[0].label, /Vypnúť.*Živé lety/);
  assert.equal(on[1].disabled, false);
  const alone = buildLayerMenuItems({ layerId: 'flights', name: 'Živé lety', enabled: true, otherEnabledCount: 0 }, t);
  assert.equal(alone[1].disabled, true, '„len túto" bez iných zapnutých nemá čo robiť');
  const off = buildLayerMenuItems({ layerId: 'flights', name: 'Živé lety', enabled: false, otherEnabledCount: 0 }, t);
  assert.match(off[0].label, /Zapnúť/);
  assert.equal(off[2].disabled, true, 'nič nie je zapnuté = niet čo vypínať');
});

test('umiestnenie: pri pravom/spodnom okraji sa menu preklopí, nikdy mimo viewportu', () => {
  assert.deepEqual(placeMenu({ x: 100, y: 100, width: 200, height: 120, viewportWidth: 800, viewportHeight: 600 }), { left: 100, top: 100 });
  assert.deepEqual(placeMenu({ x: 700, y: 100, width: 200, height: 120, viewportWidth: 800, viewportHeight: 600 }), { left: 500, top: 100 });
  assert.deepEqual(placeMenu({ x: 100, y: 550, width: 200, height: 120, viewportWidth: 800, viewportHeight: 600 }), { left: 100, top: 430 });
  assert.deepEqual(placeMenu({ x: 4, y: 4, width: 900, height: 700, viewportWidth: 800, viewportHeight: 600 }), { left: 8, top: 8 });
});

test('strážca ťahu: pravý ťah dlhší než prah potlačí menu, klik nie', () => {
  const listeners = {};
  const target = { addEventListener: (type, fn) => { listeners[type] = fn; }, removeEventListener: (type) => { delete listeners[type]; } };
  const guard = installDragGuard(target);
  listeners.pointerdown({ button: 2, clientX: 100, clientY: 100 });
  assert.equal(guard.shouldSuppress({ clientX: 102, clientY: 101 }), false, 'klik s chvením nie je ťah');
  assert.equal(guard.shouldSuppress({ clientX: 100 + CONTEXT_MENU_DRAG_THRESHOLD_PX + 1, clientY: 100 }), true, 'ťah = Cesium zoom, menu nie');
  listeners.pointerdown({ button: 0, clientX: 0, clientY: 0 });
  assert.equal(guard.shouldSuppress({ clientX: 500, clientY: 500 }), false, 'ľavé tlačidlo strážca nesleduje');
  guard.remove();
  assert.equal(listeners.pointerdown, undefined);
});

test('pickRegistry.ownerOfPick: vráti vlastníka picku, null bez vlastníka', () => {
  registerPickOwner('flights', (id) => id === 'abc123');
  registerPickOwner('ais-live-vessels', (id) => id === '244660123');
  assert.equal(ownerOfPick('abc123'), 'flights');
  assert.equal(ownerOfPick('244660123'), 'ais-live-vessels');
  assert.equal(ownerOfPick('nobody'), null);
  assert.equal(ownerOfPick(null), null);
  unregisterPickOwner('flights');
  unregisterPickOwner('ais-live-vessels');
});

function fakeDoc() {
  const listeners = new Map();
  const make = (tag) => {
    const el = {
      tag, className: '', hidden: false, textContent: '', disabled: false, dataset: {}, attrs: {}, style: {}, children: [], _listeners: {},
      offsetWidth: 200, offsetHeight: 40,
      appendChild(c) { this.children.push(c); c.parent = this; return c; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
      removeEventListener(type, fn) { this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== fn); },
      contains(node) { return node === this || this.children.some((c) => c.contains?.(node)); },
      focus() { doc.activeElement = this; },
      click() { for (const fn of this._listeners.click || []) fn(); },
      set innerHTML(v) { this.children.length = 0; },
      get innerHTML() { return ''; },
    };
    return el;
  };
  const doc = {
    activeElement: null,
    defaultView: { innerWidth: 800, innerHeight: 600 },
    createElement: make,
    addEventListener: (type, fn) => { listeners.set(type + ':' + fn.name, fn); (doc._l[type] ||= []).push(fn); },
    removeEventListener: (type, fn) => { doc._l[type] = (doc._l[type] || []).filter((f) => f !== fn); },
    _l: {},
  };
  return doc;
}

test('DOM menu: otvorí položky, klik vyberie a zatvorí, Escape zatvorí, klik mimo zatvorí, poslucháči sa upracú', () => {
  const doc = fakeDoc();
  const menu = createContextMenu(doc);
  assert.equal(menu.element.attrs.role, 'menu');
  assert.equal(menu.isOpen(), false);
  const picked = [];
  menu.open({ x: 700, y: 100, items: [{ id: 'a', label: 'A', icon: 'x' }, { id: 'b', label: 'B', disabled: true }], onSelect: (id) => picked.push(id) });
  assert.equal(menu.isOpen(), true);
  assert.equal(menu.element.children.length, 2);
  assert.equal(menu.element.children[1].disabled, true);
  assert.equal(menu.element.style.left, '500px', 'preklopené doľava od pravého okraja');
  assert.equal(doc.activeElement, menu.element.children[0], 'fokus na prvej položke');
  assert.equal((doc._l.pointerdown || []).length, 1);
  menu.element.children[0].click();
  assert.deepEqual(picked, ['a']);
  assert.equal(menu.isOpen(), false);
  assert.equal((doc._l.pointerdown || []).length, 0, 'zatvorenie odoberie dokumentové poslucháče');

  menu.open({ x: 10, y: 10, items: [{ id: 'a', label: 'A' }], onSelect: (id) => picked.push(id) });
  const keydown = menu.element._listeners.keydown.at(-1);
  keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(menu.isOpen(), false);
  assert.deepEqual(picked, ['a'], 'Escape nič nevyberá');

  menu.open({ x: 10, y: 10, items: [{ id: 'a', label: 'A' }] });
  doc._l.pointerdown.at(-1)({ target: { tag: 'canvas' } });
  assert.equal(menu.isOpen(), false, 'klik mimo zatvorí');
});

test('tripwire: ui.js viaže contextmenu na plátno aj riadky vrstiev, kurzor je čierny, i18n SK+EN', () => {
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  assert.match(ui, /_initContextMenus\(\)/);
  assert.match(ui, /addEventListener\('contextmenu', /);
  assert.match(ui, /ownerOfPick\(/, 'kontakt sa rieši cez registrovaného vlastníka picku');
  assert.match(ui, /data-toggles/, 'riadky vrstiev majú menu');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  // Kurzor „ako na Linuxe": čierna šípka s bielym obrysom cez SVG data URI,
  // premietnutá do všetkých pointer/default/grab pravidiel cez premenné.
  assert.match(css, /--cursor-arrow: url\("data:image\/svg\+xml/);
  assert.match(css, /--cursor-pointer: url\("data:image\/svg\+xml/);
  assert.match(css, /html, body \{[\s\S]*?cursor: var\(--cursor-arrow\);/);
  assert.equal((css.match(/cursor: pointer;/g) || []).length, 0, 'žiadny holý cursor: pointer — všetko cez --cursor-pointer');
  assert.ok((css.match(/cursor: var\(--cursor-pointer\)/g) || []).length >= 50, 'pointer pravidlá prepísané na premennú');
  assert.match(css, /\.context-menu \{/);
  for (const key of ['ctx.track-aircraft', 'ctx.untrack', 'ctx.cockpit', 'ctx.history', 'ctx.copy-icao', 'ctx.select-vessel', 'ctx.copy-mmsi', 'ctx.track-satellite', 'ctx.copy-norad', 'ctx.fly-here', 'ctx.copy-coords', 'ctx.bookmark-view', 'ctx.reset-globe', 'ctx.layer-on', 'ctx.layer-off', 'ctx.layer-solo', 'ctx.layers-all-off', 'ctx.copied']) {
    assert.ok(EN_STRINGS[key] && SK_STRINGS[key], `chýba ${key}`);
  }
});
