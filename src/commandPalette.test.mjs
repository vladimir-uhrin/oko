// src/commandPalette.test.mjs — príkazová paleta „Hľadať čokoľvek".
import test from 'node:test';
import assert from 'node:assert/strict';

import { COMMAND_PALETTE_ID, createCommandPalette, foldText, scoreCommand, searchCommands } from './commandPalette.js';

test('foldText: zloží diakritiku a malé písmená', () => {
  assert.equal(foldText('Hľadáš Č'), 'hladas c');
  assert.equal(foldText('  HORMUZSKÝ  '), 'hormuzský'.normalize('NFD').replace(/[̀-ͯ]/g, ''));
});

test('scoreCommand: začiatok > slovo > kdekoľvek > kľúčové slová', () => {
  const c = { label: 'Hormuzský prieliv', keywords: ['úžina', 'ropa'], group: 'scene' };
  assert.ok(scoreCommand(c, foldText('hor')) > scoreCommand(c, foldText('prieliv')));
  assert.ok(scoreCommand(c, foldText('prieliv')) >= 80, 'slovo v strede');
  assert.ok(scoreCommand(c, foldText('ropa')) === 40, 'kľúčové slovo');
  assert.equal(scoreCommand(c, foldText('xyz')), 0);
  assert.ok(scoreCommand(c, '') > 0, 'prázdny dopyt = všetko');
});

test('searchCommands: filtruje, radí, prázdny dopyt vráti všetko, bez diakritiky', () => {
  const cmds = [
    { id: '1', label: 'Hormuzský prieliv', group: 'scene' },
    { id: '2', label: 'Lietadlá', group: 'layer' },
    { id: '3', label: 'Celý svet', group: 'view' },
  ];
  assert.equal(searchCommands(cmds, '').length, 3);
  assert.deepEqual(searchCommands(cmds, 'lie').map((c) => c.id), ['2']);
  assert.deepEqual(searchCommands(cmds, 'hormuzsky').map((c) => c.id), ['1'], 'bez diakritiky nájde');
  assert.equal(searchCommands(cmds, 'zzz').length, 0);
});

// ── DOM ─────────────────────────────────────────────────────────────────────
function fakeNode(tag) {
  const classes = new Set();
  const handlers = {};
  const node = {
    tagName: String(tag).toUpperCase(), children: [], _attrs: {}, textContent: '', type: '', value: '', hidden: false, isContentEditable: false,
    classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)), toggle: (c, f) => { const on = f === undefined ? !classes.has(c) : !!f; if (on) classes.add(c); else classes.delete(c); return on; }, contains: (c) => classes.has(c) },
    get className() { return [...classes].join(' '); }, set className(v) { classes.clear(); for (const c of String(v).split(/\s+/)) if (c) classes.add(c); },
    setAttribute(k, v) { node._attrs[k] = String(v); }, getAttribute(k) { return node._attrs[k] ?? null; },
    append(...k) { node.children.push(...k); }, appendChild(k) { node.children.push(k); return k; },
    replaceChildren(...k) { node.children = k; },
    addEventListener(t, fn) { (handlers[t] = handlers[t] || []).push(fn); },
    dispatch(t, ev = {}) { for (const fn of handlers[t] || []) fn({ preventDefault() {}, target: node, ...ev }); },
    focus() { node._focused = true; }, scrollIntoView() {}, remove() {},
  };
  return node;
}
function fakeDoc() {
  const body = fakeNode('body');
  const handlers = {};
  return {
    body, activeElement: null,
    createElement: (t) => fakeNode(t),
    addEventListener(t, fn) { (handlers[t] = handlers[t] || []).push(fn); },
    removeEventListener(t, fn) { if (handlers[t]) handlers[t] = handlers[t].filter((f) => f !== fn); },
    dispatch(t, ev = {}) { for (const fn of (handlers[t] || [])) fn({ preventDefault() {}, key: ev.key, ...ev }); },
  };
}
const rowsOf = (results) => results.children.filter((c) => c.className.includes('oko-cmd-row'));

test('paleta: otvorí, zoskupí, filtruje, Enter spustí, Esc zavrie, „/" otvorí', () => {
  const doc = fakeDoc();
  const ran = [];
  const cmds = [
    { id: 's', label: 'Hormuzský prieliv', group: 'scene', run: () => ran.push('hz') },
    { id: 'l', label: 'Lietadlá', group: 'layer', run: () => ran.push('fl') },
    { id: 'v', label: 'Celý svet', group: 'view', run: () => ran.push('world') },
  ];
  const p = createCommandPalette({ documentRef: doc, translate: (k) => k, getCommands: () => cmds });
  assert.equal(p.id, COMMAND_PALETTE_ID);
  const st = p._getStateForTest();
  assert.equal(p.isOpen(), false);
  p.open();
  assert.equal(p.isOpen(), true);
  assert.equal(st.root.hidden, false);
  assert.equal(rowsOf(st.results).length, 3, 'všetky príkazy');
  assert.ok(st.results.children.some((c) => c.className.includes('oko-cmd-group')), 'skupiny');
  // filter
  st.input.value = 'lie'; st.input.dispatch('input');
  assert.equal(rowsOf(st.results).length, 1);
  // Enter spustí vybraný (prvý)
  st.input.dispatch('keydown', { key: 'Enter' });
  assert.deepEqual(ran, ['fl']);
  assert.equal(p.isOpen(), false, 'po spustení zavreté');
  // „/" otvorí (nepíšeme do poľa)
  doc.activeElement = null;
  doc.dispatch('keydown', { key: '/' });
  assert.equal(p.isOpen(), true);
  st.input.dispatch('keydown', { key: 'Escape' });
  assert.equal(p.isOpen(), false);
});

test('paleta: núdzové „hľadať na mape", keď nič nesadne', () => {
  const doc = fakeDoc();
  const geo = [];
  const p = createCommandPalette({ documentRef: doc, translate: (k, v) => (v ? `${k}:${v.q}` : k), getCommands: () => [{ id: 'x', label: 'Lietadlá', group: 'layer', run() {} }], onGeocode: (q) => geo.push(q) });
  const st = p._getStateForTest();
  p.open();
  st.input.value = 'Bratislava'; st.input.dispatch('input');
  const rows = rowsOf(st.results);
  assert.equal(rows.length, 1, 'jeden núdzový riadok');
  rows[0].dispatch('click');
  assert.deepEqual(geo, ['Bratislava']);
});

test('prázdne hľadanie nezačína Ukrajinou: zobrazenie (úvodný pohľad) → vrstvy → konflikty (2026-09-27)', async () => {
  // vlastník o lupe: „toto tlačidlo patrí Ukrajine" — paleta otvárala 12 smerov frontu ako prvé
  const { readFileSync } = await import('node:fs');
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.ok(main.includes("groupOrder: ['view', ...LAYER_GROUP_ORDER, 'ukraine', 'maritime', 'mideast'],"));
  assert.match(main, /cmds\.push\(\{ id: 'view:home', label: t\('cmd\.action\.home'\)[^\n]*resetToGlobeView\(\{ home: true \}\)/);
  assert.ok(main.indexOf("id: 'view:home'") < main.indexOf("id: 'view:world'"), 'úvodný pohľad je prvý riadok zobrazenia');
});
