// src/cardSwipeClose.test.mjs — potiahnutie karty nadol ju na mobile zavrie (2026-10-04).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installCardSwipeClose } from './cardSwipeClose.js';

function fakeDoc({ mobile = true } = {}) {
  const make = (tag) => {
    const node = {
      tag, hidden: false, children: [], listeners: {}, attrs: {}, className: '',
      style: { props: {}, setProperty(k, v) { this.props[k] = v; } },
      appendChild(c) { this.children.push(c); c.parent = this; return c; },
      setAttribute(k, v) { this.attrs[k] = v; },
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      remove() { this.removed = true; },
    };
    return node;
  };
  const body = make('body');
  body.classList = { contains: (c) => c === 'oko-mobile' && mobile };
  return { body, createElement: make };
}

const fire = (zone, type, y) => {
  const touches = [{ clientY: y }];
  let prevented = false;
  for (const fn of zone.listeners[type] || []) fn({ touches: type === 'touchend' ? [] : touches, changedTouches: touches, preventDefault: () => { prevented = true; } });
  return prevented;
};

test('plocha sedí na karte len na mobile s otvorenou kartou', () => {
  const doc = fakeDoc();
  let card = { x: 24, y: 180, w: 342, h: 130 };
  const ui = installCardSwipeClose({}, { doc, cardRect: () => card, onClose() {} });
  ui.sync();
  const zone = ui.element;
  assert.equal(zone.hidden, false);
  assert.deepEqual([zone.style.left, zone.style.top, zone.style.width, zone.style.height], ['24px', '180px', '342px', '130px']);
  card = null;
  ui.sync();
  assert.equal(zone.hidden, true, 'bez karty niet čo ťahať');
  const desktop = installCardSwipeClose({}, { doc: fakeDoc({ mobile: false }), cardRect: () => ({ x: 0, y: 0, w: 10, h: 10 }), onClose() {} });
  desktop.sync();
  assert.equal(desktop.element.hidden, true, 'na počítači nič');
});

test('ťah nadol o 80 px (alebo rýchly krátky) kartu zavrie, krátky pomalý nie; ťah neotáča glóbus', () => {
  const doc = fakeDoc();
  let closed = 0;
  let clock = 0;
  const ui = installCardSwipeClose({}, { doc, cardRect: () => ({ x: 24, y: 180, w: 342, h: 130 }), onClose: () => { closed += 1; }, now: () => clock });
  ui.sync();
  const zone = ui.element;

  fire(zone, 'touchstart', 200);
  clock = 400;
  assert.equal(fire(zone, 'touchmove', 230), true, 'preventDefault — mapa sa pod kartou nehýbe');
  assert.equal(zone.style.props['--swipe'], '0.375', 'úchyt ukazuje, že gesto zaberá');
  fire(zone, 'touchend', 230);
  assert.equal(closed, 0, '30 px pomaly = nič');
  assert.equal(zone.style.props['--swipe'], '0.000');

  clock = 0;
  fire(zone, 'touchstart', 200);
  clock = 300;
  fire(zone, 'touchend', 290);
  assert.equal(closed, 1, '90 px = zavrieť');
  assert.equal(zone.hidden, true);

  ui.sync();
  clock = 0;
  fire(zone, 'touchstart', 200);
  clock = 60;
  fire(zone, 'touchend', 240);
  assert.equal(closed, 2, '40 px za 60 ms (rýchly švih) = zavrieť');

  ui.sync();
  fire(zone, 'touchstart', 300);
  fire(zone, 'touchend', 200);
  assert.equal(closed, 2, 'ťah nahor nezatvára');
  ui.destroy();
  assert.equal(zone.removed, true);
});
