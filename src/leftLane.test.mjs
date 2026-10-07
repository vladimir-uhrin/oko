// src/leftLane.test.mjs — logický poriadok ľavého stĺpca (2026-09-27, vlastník: „neviem dobre otvoriť
// karty, celý posuvník mi otáča mapu, treba v tom spraviť logický poriadok").

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { LANE_RAIL_PANEL_IDS, createLeftLane } from './leftLane.js';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');

function fakeEl(id, { order = 0, classes = [] } = {}) {
  const cls = new Set(classes);
  const listeners = {};
  const el = {
    id, parentNode: null, children: [], dataset: {}, order,
    get nextSibling() { const p = this.parentNode; if (!p) return null; return p.children[p.children.indexOf(this) + 1] || null; },
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) },
    matches: (sel) => (sel === '[data-panel-id]' ? el.panel === true : false),
    detach() { if (this.parentNode) { this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; } },
    insertBefore(child, ref) { child.detach(); const i = ref ? this.children.indexOf(ref) : -1; this.children.splice(i < 0 ? this.children.length : i, 0, child); child.parentNode = this; },
    appendChild(child) { this.insertBefore(child, null); },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    fire: (type, event) => listeners[type]?.(event),
    panel: false,
  };
  return el;
}

function world({ mobile = false } = {}) {
  const body = fakeEl('body', { classes: mobile ? ['oko-mobile'] : [] });
  const app = fakeEl('app');
  const lane = fakeEl('left-panel-stack');
  const rail = fakeEl('right-context-rail');
  const data = Object.assign(fakeEl('data-panel', { order: 10 }), { panel: true });
  lane.appendChild(data);
  const panels = {};
  for (const [id, order] of [['pp-toggles', 51], ['cctv-panel', 43], ['global-context-panel', 44]]) {
    panels[id] = Object.assign(fakeEl(id, { order, classes: ['collapsed'] }), { panel: true });
    rail.appendChild(panels[id]);
  }
  app.appendChild(lane); app.appendChild(rail);
  const byId = { 'left-panel-stack': lane, 'right-context-rail': rail, 'data-panel': data, ...panels };
  const doc = {
    body,
    getElementById: (id) => byId[id] || null,
    defaultView: { getComputedStyle: (el) => ({ order: String(el.order) }) },
  };
  return { doc, lane, rail, data, panels };
}

test('Zobrazenie, Kamery a Kontext sa stanú riadnymi panelmi ľavého pruhu; na mobile nie; späť na svoje miesto', () => {
  const w = world();
  const lane = createLeftLane({ doc: w.doc });
  assert.equal(lane.dock(), true);
  for (const id of LANE_RAIL_PANEL_IDS) assert.equal(w.panels[id].parentNode, w.lane, `${id} je priame dieťa pruhu`);
  assert.ok(w.lane.classList.contains('oko-lane-with-rail'));
  assert.equal(lane.dock(), false, 'idempotentné');
  assert.equal(lane.undock(), true);
  for (const id of LANE_RAIL_PANEL_IDS) assert.equal(w.panels[id].parentNode, w.rail, `${id} späť v lište`);
  assert.equal(w.lane.classList.contains('oko-lane-with-rail'), false);
  const m = world({ mobile: true });
  assert.equal(createLeftLane({ doc: m.doc }).dock(), false, 'na mobile panely nosí výsuv');
  assert.equal(m.panels['pp-toggles'].parentNode, m.rail);
});

test('po presune sa tlačidlo panela prekreslí (◀ pravej lišty → +/− pruhu) — aj pri návrate', () => {
  const w = world();
  const synced = [];
  const lane = createLeftLane({ doc: w.doc, syncPanel: (panel) => synced.push([panel.id, panel.parentNode.id]) });
  lane.dock();
  assert.deepEqual(synced.map(([id]) => id).sort(), [...LANE_RAIL_PANEL_IDS].sort());
  assert.ok(synced.every(([, parent]) => parent === 'left-panel-stack'), 'prekreslí sa až na novom mieste');
  synced.length = 0;
  lane.undock();
  assert.ok(synced.length === 3 && synced.every(([, parent]) => parent === 'right-context-rail'));
});

test('otvorený panel sa doroluje do záberu stĺpca; keď sa stĺpec neposúva, nič', () => {
  const w = world();
  const lane = createLeftLane({ doc: w.doc });
  lane.dock();
  Object.assign(w.lane, { scrollTop: 0, scrollHeight: 900, clientHeight: 360, getBoundingClientRect: () => ({ top: 265, bottom: 625 }) });
  const panel = w.panels['pp-toggles'];
  panel.getBoundingClientRect = () => ({ top: 700, bottom: 900 });
  assert.equal(lane.reveal(panel), 275, 'spodok panela na spodok stĺpca');
  assert.equal(w.lane.scrollTop, 275);
  panel.getBoundingClientRect = () => ({ top: 700, bottom: 1200 });
  assert.equal(lane.reveal(panel), 435, 'vyšší panel než stĺpec: hlavička navrchu');
  panel.getBoundingClientRect = () => ({ top: 200, bottom: 300 });
  assert.equal(lane.reveal(panel), -65);
  panel.getBoundingClientRect = () => ({ top: 300, bottom: 400 });
  assert.equal(lane.reveal(panel), 0, 'už je v zábere');
  w.lane.scrollHeight = 300;
  panel.getBoundingClientRect = () => ({ top: 700, bottom: 900 });
  assert.equal(lane.reveal(panel), 0, 'stĺpec sa zmestí — neposúvať');
  assert.ok(main.includes('leftLane.installRevealOnOpen();'));
  assert.ok(main.includes('syncPanel: (panel) => styleManager._syncPanelCollapseButton?.(panel),'));
});

test('po štarte otvorený len jeden panel — prvý v poradí stĺpca; ostatné sa zbalia bez uloženia', () => {
  const w = world();
  w.panels['pp-toggles'].classList.remove('collapsed'); // Zobrazenie otvorené z uloženého stavu
  const calls = [];
  const lane = createLeftLane({ doc: w.doc, setPanelCollapsed: (id, c, opts) => { calls.push([id, c, opts]); w.doc.getElementById(id).classList.toggle('collapsed', c); } });
  lane.dock();
  assert.equal(lane.enforceSingleOpen(), 1);
  assert.deepEqual(calls, [['pp-toggles', true, { persist: false, syncShare: false }]], 'Dátové vrstvy (order 10) ostávajú, Zobrazenie (51) sa zbalí');
  assert.equal(lane.enforceSingleOpen(), 0);
  // štart z uloženého stavu: zbalenie sa uloží, inak by starý panel vyhrával pri každom štarte
  w.panels['cctv-panel'].classList.remove('collapsed');
  calls.length = 0;
  assert.equal(lane.enforceSingleOpen({ persist: true }), 1);
  assert.deepEqual(calls, [['cctv-panel', true, { persist: true, syncShare: false }]]);
  assert.ok(main.includes('if (leftLane.dock()) leftLane.enforceSingleOpen({ persist: true });'));
});

test('celá hlavička panela ho otvára aj zatvára, ovládače v hlavičke nie', () => {
  const w = world();
  const calls = [];
  const lane = createLeftLane({ doc: w.doc, setPanelCollapsed: (id, c, opts) => calls.push([id, c, opts]) });
  lane.dock();
  assert.equal(lane.installHeaderToggle(), true);
  assert.equal(lane.installHeaderToggle(), false, 'len raz');
  const panel = w.panels['cctv-panel'];
  const header = { closest: (sel) => (sel === '[data-panel-id]' ? panel : null) };
  const click = (target) => w.lane.fire('click', { target });
  click({ closest: (sel) => (sel.includes('.panel-header') ? header : null) });
  assert.deepEqual(calls.pop(), ['cctv-panel', false, { explicit: true }], 'zbalený → otvorí');
  click({ closest: (sel) => (sel.includes('.panel-header') ? header : sel.includes('button') ? {} : null) });
  assert.equal(calls.length, 0, 'klik na tlačidlo v hlavičke má vlastnú akciu');
  click({ closest: () => null });
  assert.equal(calls.length, 0, 'klik mimo hlavičky nič');
});

test('akordeón: otvorenie panela v ľavom pruhu zbalí ostatné otvorené (ui.js)', () => {
  assert.match(ui, /if \(!nextCollapsed && explicit && !restore && panelEl\.parentElement === this\._leftPanelStack\) \{\n\s+for \(const other of this\._leftPanelStack\.querySelectorAll\(':scope > \[data-panel-id\]:not\(\.collapsed\)'\)\) \{\n\s+if \(other !== panelEl\) this\.setPanelCollapsed\(other\.id, true, \{ explicit: true, persist, syncShare \}\);/);
  assert.ok(ui.includes("const isRightRail = panelEl?.parentElement?.id === 'right-context-rail';"), '+/− v pruhu, šípky len v pravej lište');
  assert.ok(ui.includes("if (['right-context-rail', 'left-panel-stack'].includes(this._cctvPanel.parentElement?.id)) {"), 'Kamery v pruhu: výšku dáva engine');
  assert.ok(!ui.includes('oko-rail-docked'), 'stará ukotvená lišta je preč');
});

test('poradie v zónach: Vrstvy · Konflikty · Energia · Nástroje (… Kamery, Kontext) · Nastavenia (Zobrazenie)', () => {
  const order = (sel) => {
    const m = new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{\\s*order: (\\d+);`).exec(css);
    assert.ok(m, `${sel} nemá order`);
    return Number(m[1]);
  };
  const seq = [
    '#left-panel-stack > #data-panel',
    '#left-panel-stack > .lane-zone[data-lane-zone="weather"]', '#left-panel-stack > #weather-panel',
    '#left-panel-stack > #ukraine-panel', '#left-panel-stack > #mideast-panel',
    '#left-panel-stack > #gas-panel', '#left-panel-stack > #oil-panel',
    '#left-panel-stack > #scene-panel', '#left-panel-stack > #history-panel',
    '#left-panel-stack > #cctv-panel', '#left-panel-stack > #global-context-panel',
    '#left-panel-stack > .lane-zone[data-lane-zone="settings"]', '#left-panel-stack > #pp-toggles',
  ].map(order);
  for (let i = 1; i < seq.length; i++) assert.ok(seq[i] > seq[i - 1], `poradie ${seq.join(' < ')}`);
  assert.match(html, /<div class="lane-zone" data-lane-zone="settings">\s*<span class="lane-zone-text" data-i18n="lane\.zone\.settings">SETTINGS<\/span>/);
});

test('stĺpec neprekrýva glóbus: široký len ako najširší panel, posuvník pri paneloch; Kartičky hneď za nadpisom', () => {
  // vlastník 09-27: „nesmie byť prekrytý glóbus a kartičky sú mimo" — pri pevných 360 px ležal posuvník
  // aj prázdny pás (pointer-events: auto) cez okraj glóbusu, Kartičky trčali na konci riadku nadpisu
  assert.match(css, /@media \(min-width: 721px\) \{[^{}]*#left-panel-stack\.oko-lane-with-rail \{ width: fit-content; max-width: 360px; scrollbar-gutter: stable; overflow-x: hidden; \}/);
  assert.match(css, /#left-panel-stack > \.lane-zone > \.oko-conflicts-launch \{ order: 1; \}/);
  assert.match(css, /#left-panel-stack > \.lane-zone > \.panel-divider \{ order: 2; \}/);
});

test('stĺpec neotáča mapu: keď sa posúva, prijíma myš; jeden posuvník vo vnútri panela; kokpit ich skrýva', () => {
  const lane = /#left-panel-stack\.oko-lane-with-rail \{([^}]*)\}/.exec(css);
  assert.ok(lane);
  assert.match(lane[1], /pointer-events: auto/, 'posuvník a koliesko nad stĺpcom už nejdú na mapu');
  assert.match(lane[1], /overscroll-behavior: contain/);
  assert.ok(!/oko-rail-docked/.test(css), 'žiadna ukotvená lišta s vlastným posuvníkom');
  assert.match(css, /#left-panel-stack > #pp-toggles:not\(\.collapsed\) \{ overflow-y: auto; overscroll-behavior: contain;/);
  assert.match(css, /body\.cockpit-mode #left-panel-stack > #pp-toggles,\nbody\.cockpit-mode #left-panel-stack > #cctv-panel,/);
  assert.ok(main.includes('const leftLane = createLeftLane({'), 'main.js zapína poriadok hneď po StyleManageri');
  assert.ok(main.includes("window.addEventListener('gev:initial-share-restore-settled', () => { leftLane.enforceSingleOpen(); leftLane.fitOpen(); });"));
});

test('otvorený panel dostane prirodzenú výšku, najviac záber stĺpca — meria sa bez vlastného natiahnutia', () => {
  const w = world();
  const props = new Map();
  const panel = w.panels['pp-toggles'];
  panel.style = { setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k) };
  const seen = [];
  const lane = createLeftLane({ doc: w.doc, measurePanel: () => { seen.push(props.get('--lane-open-natural')); return 781.4; } });
  assert.equal(lane.fit(panel), 782);
  assert.deepEqual(seen, ['0px'], 'počas merania je natiahnutie vypnuté');
  assert.equal(props.get('--lane-open-natural'), '782px');
  const blind = createLeftLane({ doc: w.doc, measurePanel: () => 0 });
  assert.equal(blind.fit(panel), 0);
  assert.equal(props.has('--lane-open-natural'), false, 'nezmerané = len minimum z CSS');
  assert.equal(createLeftLane({ doc: w.doc }).fit(panel), 0, 'bez merania nič');
  // CSS: najviac prirodzená výška, najviac záber mínus vykuknutie, aspoň min(30vh, 200px)
  assert.ok(css.includes('#left-panel-stack.oko-lane-with-rail > [data-panel-id]:not(.collapsed) {\n  min-height: min(var(--lane-open-natural, min(30vh, 200px)), max(min(30vh, 200px), calc(100vh - var(--left-stack-safe-top, var(--left-stack-top)) - var(--left-stack-safe-bottom, 4vh) - 56px)));'));
  // Zobrazenie nemá vnútorný obal — engine by nameral 44 px; stĺpec berie aj scrollHeight
  assert.ok(main.includes('measurePanel: (panel) => Math.max(styleManager._measureLeftPanelNaturalHeight?.(panel) || 0, panel.scrollHeight || 0),'));
  assert.ok(main.includes('setTimeout(() => leftLane.fitOpen(), 1500);'));
});
