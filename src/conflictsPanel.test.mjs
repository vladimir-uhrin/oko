// src/conflictsPanel.test.mjs — panel Kartičky konfliktov (propagácia B).
import test from 'node:test';
import assert from 'node:assert/strict';

import { CONFLICTS_PANEL_ID, createConflictsPanel } from './conflictsPanel.js';

function fakeNode(tag) {
  const classes = new Set();
  const handlers = {};
  const node = {
    tagName: String(tag).toUpperCase(), children: [], dataset: {}, _attrs: {},
    textContent: '', type: '', hidden: false, disabled: false,
    get className() { return [...classes].join(' '); },
    set className(v) { classes.clear(); for (const c of String(v).split(/\s+/)) if (c) classes.add(c); },
    classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)), contains: (c) => classes.has(c) },
    setAttribute(k, v) { node._attrs[k] = String(v); }, getAttribute(k) { return node._attrs[k] ?? null; },
    append(...k) { node.children.push(...k); }, appendChild(k) { node.children.push(k); return k; },
    addEventListener(t, fn) { (handlers[t] = handlers[t] || []).push(fn); },
    dispatch(t) { for (const fn of handlers[t] || []) fn({}); },
    remove() {},
    querySelectorAll() { return []; },
  };
  return node;
}
function fakeDoc() {
  const body = fakeNode('body');
  return { createElement: (t) => fakeNode(t), body };
}
const collect = (n, pred, out = []) => { if (pred(n)) out.push(n); for (const c of n.children || []) collect(c, pred, out); return out; };
const byClass = (root, cls) => collect(root, (n) => n.className.split(' ').includes(cls));

const CONFLICTS = [
  { id: 'ukraine:lyman', region: 'ukraine', kind: 'ukraine-front', label: 'Lyman' },
  { id: 'ukraine:front', region: 'ukraine', kind: 'ukraine-front', label: 'Celý front' },
  { id: 'chokepoint:hormuz', region: 'maritime', kind: 'chokepoint', label: 'Hormuz' },
  { id: 'gulf', region: 'middle-east', kind: 'situation', label: 'Perzský záliv' },
];
const tr = (k) => k;

test('panel: štruktúra, regióny, riadky s exportom, skrytý na štarte', () => {
  const doc = fakeDoc();
  const calls = [];
  const p = createConflictsPanel({ documentRef: doc, translate: tr, conflicts: CONFLICTS, onExport: async (c, r) => calls.push([c.id, r]) });
  assert.equal(p.id, CONFLICTS_PANEL_ID);
  const { panel, launch, rowButtons, regions } = p._getStateForTest();
  assert.equal(panel.hidden, true, 'na štarte skrytý');
  assert.deepEqual(regions, ['ukraine', 'maritime', 'middle-east']);
  assert.equal(rowButtons.length, 4, 'štyri riadky, štyri tlačidlá');
  assert.ok(byClass(panel, 'oko-conflicts-region').length === 3);
  assert.equal(p.getRatio(), 'feed');
  // launcher aj panel sú v tele
  assert.ok(doc.body.children.includes(launch) && doc.body.children.includes(panel));
});

test('panel: toggle, výber pomeru, export jedného volá onExport s pomerom', async () => {
  const doc = fakeDoc();
  const calls = [];
  const p = createConflictsPanel({ documentRef: doc, translate: tr, conflicts: CONFLICTS, onExport: async (c, r) => calls.push([c.id, r]) });
  const { launch, panel, ratioBtns, rowButtons } = p._getStateForTest();
  launch.dispatch('click');
  assert.equal(p.isOpen(), true);
  assert.equal(panel.hidden, false);
  // prepni pomer na story
  ratioBtns.get('story').dispatch('click');
  assert.equal(p.getRatio(), 'story');
  assert.equal(ratioBtns.get('story').getAttribute('aria-pressed'), 'true');
  assert.equal(ratioBtns.get('feed').getAttribute('aria-pressed'), 'false');
  // export prvého riadku (Lyman)
  rowButtons[0].dispatch('click');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, [['ukraine:lyman', 'story']]);
});

test('panel: export všetkých volá onExport pre každý; počas behu sú tlačidlá vypnuté', async () => {
  const doc = fakeDoc();
  const calls = [];
  let resolveFns = [];
  const p = createConflictsPanel({ documentRef: doc, translate: (k, v) => (v ? `${k}:${v.n || v.total}` : k), conflicts: CONFLICTS, onExport: (c) => new Promise((res) => { calls.push(c.id); resolveFns.push(res); }) });
  const { allBtn, rowButtons, status, isBusy } = p._getStateForTest();
  allBtn.dispatch('click');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(isBusy(), true, 'počas dávky busy');
  assert.equal(allBtn.disabled, true);
  assert.ok(rowButtons.every((b) => b.disabled), 'riadky vypnuté počas dávky');
  // dokonči všetky exporty postupne
  for (let i = 0; i < CONFLICTS.length; i += 1) {
    resolveFns[i]();
    await new Promise((r) => setTimeout(r, 0));
  }
  assert.deepEqual(calls, CONFLICTS.map((c) => c.id), 'onExport pre každý konflikt');
  assert.equal(isBusy(), false, 'po dávke už nie busy');
  assert.equal(allBtn.disabled, false);
  assert.ok(status.textContent.includes('conflicts.done'));
});

test('panel: bez documentu je inertný', () => {
  const p = createConflictsPanel({ documentRef: null, conflicts: CONFLICTS });
  assert.equal(p.isOpen(), false);
  assert.doesNotThrow(() => { p.open(); p.close(); p.toggle(); p.destroy(); });
});
