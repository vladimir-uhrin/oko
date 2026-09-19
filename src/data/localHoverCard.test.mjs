// src/data/localHoverCard.test.mjs
// Vyskakovacia karta značiek lokálnych vrstiev (2026-09-19): model (kind z id
// vrstvy, vlajka len z platného ISO2), DOM nad falošným dokumentom — kind,
// titulok s vlajkou, riadky, päta so zdrojom a nápovedou, rovnaká identita =
// len presun, × / Escape / odchod zatvoria, bez dokumentu neškodný no-op.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalHoverCard, localHoverModel } from './localHoverCard.js';

const tKey = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);

function fakeDocument() {
  const listeners = new Map();
  const makeEl = (tag) => {
    const el = {
      tag, children: [], textContent: '', hidden: false, style: {}, dataset: {}, attrs: {}, className: '', listeners: {},
      appendChild(c) { el.children.push(c); c.parent = el; return c; },
      append(...cs) { for (const c of cs) el.appendChild(c); },
      replaceChildren(...cs) { el.children = []; el.append(...cs); },
      remove() { if (el.parent) el.parent.children = el.parent.children.filter((c) => c !== el); },
      addEventListener(t, fn) { el.listeners[t] = fn; },
      setAttribute(k, v) { el.attrs[k] = v; },
      contains(n) { return n === el || el.children.some((c) => c.contains?.(n)); },
      get offsetWidth() { return 300; }, get offsetHeight() { return 120; },
    };
    return el;
  };
  const body = makeEl('body');
  return {
    body, documentElement: { clientWidth: 1000, clientHeight: 700 }, activeElement: null, createElement: makeEl,
    addEventListener(t, fn) { listeners.set(t, fn); }, removeEventListener(t) { listeners.delete(t); }, fire(t, e) { listeners.get(t)?.(e); },
  };
}
const text = (el) => [el.textContent, ...el.children.map(text)].filter(Boolean).join(' ');
const byClass = (el, cls) => (String(el.className).split(/\s+/).includes(cls) ? [el] : []).concat(...el.children.map((c) => byClass(c, cls)));

test('localHoverModel: kind z id vrstvy, vlajka len z ISO2, prázdny titulok = null', () => {
  const m = localHoverModel({ layerId: 'local-ports', kindText: 'Prístavy · NGA WPI', title: 'Mariupol', titleFlag: 'ua', details: ['UAMPL · MEDIUM · COASTAL NATURAL', '', 'CH 8M · Ukraine'], source: 'NGA WPI' });
  assert.deepEqual(m, { layerId: 'local-ports', kind: 'ports', kindText: 'Prístavy · NGA WPI', title: 'Mariupol', flag: 'ua', details: ['UAMPL · MEDIUM · COASTAL NATURAL', 'CH 8M · Ukraine'], source: 'NGA WPI' });
  assert.equal(localHoverModel({ layerId: 'local-airports', title: 'Košice', titleFlag: 'Slovakia' }).flag, null, 'meno štátu nie je kód');
  assert.equal(localHoverModel({ layerId: 'local-dams', title: 'X' }).kind, 'dams');
  assert.equal(localHoverModel({ layerId: 'local-ports', title: '' }), null);
  assert.equal(localHoverModel(null), null);
});

test('DOM karta: kind + vlajka + titulok + riadky + päta; rovnaká identita = presun; × / Escape / odchod zatvoria', () => {
  const doc = fakeDocument();
  const card = createLocalHoverCard({ document: doc, translate: tKey, flagUrl: (iso) => `/flags/${iso}.svg` });
  const root = doc.body.children[0];
  assert.equal(root.className, 'pipeline-hover-card local-hover-card', 'zdieľa vizuál karty rúr');
  assert.equal(root.hidden, true);
  const port = { layerId: 'local-ports', kindText: 'layer.local-ports.name · NGA WPI', title: 'Mariupol', titleFlag: 'ua', details: ['UAMPL · MEDIUM'], source: 'NGA WPI' };
  assert.equal(card.show(port, { x: 100, y: 50 }, 'wpi-44010'), true);
  assert.equal(root.hidden, false);
  assert.equal(root.dataset.kind, 'ports');
  assert.equal(root.style.left, '118px');
  assert.match(text(root), /layer\.local-ports\.name · NGA WPI/);
  assert.match(text(root), /Mariupol/);
  assert.match(text(root), /UAMPL · MEDIUM/);
  assert.match(text(byClass(root, 'pipeline-hover-foot')[0]), /NGA WPI ·\s+local\.hover-hint/);
  const flag = byClass(root, 'pipeline-hover-flag')[0];
  assert.equal(flag.src, '/flags/ua.svg');
  assert.equal(flag.alt, 'UA');
  assert.equal(card.current(), 'wpi-44010');
  // Tá istá identita: len presun, obsah sa neprekresľuje.
  const before = root.children.length;
  assert.equal(card.show(port, { x: 5, y: 5 }, 'wpi-44010'), true);
  assert.equal(root.style.left, '23px');
  assert.equal(root.children.length, before);
  // Iná značka bez vlajky
  card.show({ layerId: 'local-airports', kindText: 'x', title: 'Košice', details: [] }, { x: 1, y: 1 }, 'lzkz');
  assert.equal(root.dataset.kind, 'airports');
  assert.equal(byClass(root, 'pipeline-hover-flag').length, 0);
  byClass(root, 'pipeline-hover-close')[0].listeners.click();
  assert.equal(root.hidden, true);
  card.show(port, { x: 1, y: 1 });
  doc.fire('keydown', { key: 'Escape' });
  assert.equal(root.hidden, true);
  card.show(port, { x: 1, y: 1 });
  root.listeners.pointerenter();
  assert.equal(card.isHovered(), true);
  root.listeners.pointerleave();
  assert.equal(root.hidden, true);
  assert.equal(card.show({ layerId: 'local-ports', title: '' }, { x: 1, y: 1 }), false, 'bez titulku sa nič neukáže');
  card.destroy();
  assert.equal(doc.body.children.length, 0);
  const none = createLocalHoverCard({ document: null });
  assert.equal(none.show(port, { x: 0, y: 0 }), false);
});
