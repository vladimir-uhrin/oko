// src/mobileShell.test.mjs
// Mobilný plášť (2026-09-14): režim z rozmerov a dotyku, presun panelov do
// výsuvu a späť na pôvodné miesto, jeden výsuv naraz, návrat na desktop
// zatvára, potiahnutie nadol, širší rámček výberu na dotyku.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COARSE_PICK_BOX_PX,
  MOBILE_SECTIONS,
  createMobileShell,
  installCoarsePickBox,
  pickBoxFor,
  resolveShellMode,
  swipeShouldClose,
} from './mobileShell.js';

function makeNode(tag = 'div', { id = '', className = '' } = {}) {
  const node = {
    tagName: tag.toUpperCase(), id, className, hidden: false, textContent: '', dataset: {}, attributes: {},
    children: [], parentNode: null, listeners: {}, focused: false, style: {},
    get nextSibling() {
      const parent = node.parentNode;
      if (!parent) return null;
      const index = parent.children.indexOf(node);
      return index >= 0 && index + 1 < parent.children.length ? parent.children[index + 1] : null;
    },
    classList: {
      add(...names) { const set = classes(); for (const n of names) set.add(n); node.className = [...set].join(' '); },
      remove(...names) { const set = classes(); for (const n of names) set.delete(n); node.className = [...set].join(' '); },
      contains(name) { return classes().has(name); },
      toggle(name, force) { const set = classes(); const next = force === undefined ? !set.has(name) : Boolean(force); if (next) set.add(name); else set.delete(name); node.className = [...set].join(' '); return next; },
    },
    appendChild(child) { child.parentNode?.removeChild(child); node.children.push(child); child.parentNode = node; return child; },
    insertBefore(child, ref) {
      child.parentNode?.removeChild(child);
      const index = ref ? node.children.indexOf(ref) : -1;
      if (index < 0) node.children.push(child); else node.children.splice(index, 0, child);
      child.parentNode = node;
      return child;
    },
    removeChild(child) { const index = node.children.indexOf(child); if (index >= 0) node.children.splice(index, 1); child.parentNode = null; return child; },
    setAttribute(name, value) { node.attributes[name] = String(value); },
    getAttribute(name) { return node.attributes[name] ?? null; },
    querySelector(selector) { return node.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const out = [];
      const walk = (parent) => { for (const child of parent.children) { if (matches(child, selector)) out.push(child); walk(child); } };
      walk(node);
      return out;
    },
    addEventListener(type, handler) { (node.listeners[type] ||= []).push(handler); },
    removeEventListener(type, handler) { node.listeners[type] = (node.listeners[type] || []).filter((h) => h !== handler); },
    dispatch(type, event = {}) { for (const handler of node.listeners[type] || []) handler(event); },
    click() { node.dispatch('click', {}); },
    focus() { node.focused = true; },
  };
  function classes() { return new Set(String(node.className).split(/\s+/).filter(Boolean)); }
  return node;
}

function matches(node, selector) {
  if (selector === '[data-oko-section]') return 'okoSection' in node.dataset;
  if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
  if (selector.startsWith('#')) return node.id === selector.slice(1);
  return false;
}

function buildDom() {
  const body = makeNode('body');
  const byId = new Map();
  const add = (parent, tag, id, className = '') => { const node = makeNode(tag, { id, className }); parent.appendChild(node); if (id) byId.set(id, node); return node; };
  const leftStack = add(body, 'div', 'left-panel-stack');
  for (const id of ['data-panel', 'cctv-panel', 'scene-panel', 'history-panel', 'gas-panel']) add(leftStack, 'div', id, 'panel-collapsible collapsed');
  const rail = add(body, 'aside', 'right-context-rail');
  add(rail, 'div', 'pp-toggles', 'panel-collapsible collapsed');
  add(rail, 'div', 'global-context-panel', 'panel-collapsible collapsed');
  const dock = add(body, 'div', 'command-dock');
  add(dock, 'div', 'location-bar', 'panel-collapsible collapsed');
  add(dock, 'input', 'location-search');
  add(body, 'div', 'cesium-credits');
  const appbar = add(body, 'nav', 'oko-appbar');
  appbar.hidden = true;
  for (const section of MOBILE_SECTIONS) {
    const button = add(appbar, 'button', '');
    button.dataset.okoSection = section.id;
    const label = add(button, 'span', '', 'oko-appbar-label');
    label.textContent = section.id.toUpperCase();
  }
  const backdrop = add(body, 'div', 'oko-sheet-backdrop');
  backdrop.hidden = true;
  const sheet = add(body, 'section', 'oko-sheet');
  sheet.hidden = true;
  add(sheet, 'div', '', 'oko-sheet-handle');
  const head = add(sheet, 'div', '', 'oko-sheet-head');
  add(head, 'span', 'oko-sheet-title', 'oko-sheet-title');
  add(head, 'button', 'oko-sheet-close');
  add(sheet, 'div', '', 'oko-sheet-body');
  const rootProps = {};
  const doc = {
    body,
    documentElement: {
      style: {
        props: rootProps,
        setProperty(name, value) { rootProps[name] = value; },
        removeProperty(name) { delete rootProps[name]; },
      },
    },
    listeners: {},
    getElementById: (id) => byId.get(id) || null,
    addEventListener(type, handler) { (doc.listeners[type] ||= []).push(handler); },
    removeEventListener(type, handler) { doc.listeners[type] = (doc.listeners[type] || []).filter((h) => h !== handler); },
    dispatch(type, event) { for (const handler of doc.listeners[type] || []) handler(event); },
  };
  return { doc, byId, body, appbar, sheet, backdrop, leftStack, rail };
}

function makeWindow({ width, height, coarse }) {
  const win = {
    innerWidth: width, innerHeight: height, listeners: {},
    matchMedia: (query) => ({ matches: query.includes('coarse') && win.coarse, addEventListener() {}, removeEventListener() {} }),
    addEventListener(type, handler) { (win.listeners[type] ||= []).push(handler); },
    removeEventListener() {},
    coarse,
    resize(w, h) { win.innerWidth = w; win.innerHeight = h; for (const handler of win.listeners.resize || []) handler(); },
  };
  return win;
}

function makeStyleManager(doc) {
  const calls = [];
  return {
    calls,
    setPanelCollapsed(id, collapsed, options) {
      calls.push([id, collapsed, options]);
      doc.getElementById(id)?.classList.toggle('collapsed', collapsed);
    },
  };
}

test('resolveShellMode: telefón na výšku aj naležato, tablet s dotykom = mobil; myš nad 900 px = desktop', () => {
  assert.deepEqual(resolveShellMode({ width: 375, height: 812, coarse: true }), { mobile: true, landscape: false });
  assert.deepEqual(resolveShellMode({ width: 844, height: 390, coarse: true }), { mobile: true, landscape: true }, 'telefón naležato: nízky viewport → zásuvka sprava');
  assert.deepEqual(resolveShellMode({ width: 1024, height: 768, coarse: true }), { mobile: true, landscape: false }, 'tablet naležato s dotykom ostáva v mobilnom plášti');
  assert.deepEqual(resolveShellMode({ width: 1024, height: 768, coarse: false }), { mobile: false, landscape: false }, 'okno s myšou nad 900 px = desktop');
  assert.deepEqual(resolveShellMode({ width: 1366, height: 768, coarse: true }), { mobile: false, landscape: false }, 'veľký dotykový displej = desktop');
  assert.deepEqual(resolveShellMode({ width: 800, height: 600, coarse: false }), { mobile: true, landscape: false }, 'úzke okno s myšou dostane plášť');
  assert.deepEqual(resolveShellMode({}), { mobile: false, landscape: false });
});

test('swipeShouldClose: dlhé potiahnutie alebo krátke a rýchle; nahor nikdy', () => {
  assert.equal(swipeShouldClose({ startY: 100, endY: 190, elapsedMs: 900 }), true);
  assert.equal(swipeShouldClose({ startY: 100, endY: 140, elapsedMs: 60 }), true, '40 px za 60 ms = švih');
  assert.equal(swipeShouldClose({ startY: 100, endY: 140, elapsedMs: 600 }), false, '40 px pomaly = len posun');
  assert.equal(swipeShouldClose({ startY: 100, endY: 20, elapsedMs: 50 }), false);
  assert.equal(swipeShouldClose({}), false);
});

test('pickBoxFor + installCoarsePickBox: na dotyku aspoň 18 px, s myšou nezmenené; obal len raz', () => {
  assert.deepEqual(pickBoxFor(undefined, undefined, false), [3, 3]);
  assert.deepEqual(pickBoxFor(6, 6, false), [6, 6]);
  assert.deepEqual(pickBoxFor(undefined, undefined, true), [COARSE_PICK_BOX_PX, COARSE_PICK_BOX_PX]);
  assert.deepEqual(pickBoxFor(40, 6, true), [40, COARSE_PICK_BOX_PX]);
  const scene = { pick(position, width, height) { return { position, width, height }; } };
  assert.equal(installCoarsePickBox(scene, { coarse: false }), false);
  assert.deepEqual(scene.pick('p'), { position: 'p', width: undefined, height: undefined });
  assert.equal(installCoarsePickBox(scene, { coarse: true }), true);
  assert.equal(installCoarsePickBox(scene, { coarse: true }), false, 'druhýkrát nie');
  assert.deepEqual(scene.pick('p'), { position: 'p', width: 18, height: 18 });
  assert.deepEqual(scene.pick('p', 24, 4), { position: 'p', width: 24, height: 18 });
});

test('plášť: desktop nič nemení; na telefóne skryje stĺpce a otvorí sekciu presunom panela do výsuvu, návrat vráti panel na miesto', () => {
  const { doc, byId, body, appbar, sheet, backdrop, leftStack } = buildDom();
  const win = makeWindow({ width: 1440, height: 900, coarse: false });
  const styleManager = makeStyleManager(doc);
  const suppressed = [];
  const shell = createMobileShell({ document: doc, window: win, styleManager, suppressLane: (lane, on) => suppressed.push([lane, on]) });
  assert.equal(shell.inert, false);
  shell.sync();
  assert.equal(body.classList.contains('oko-mobile'), false);
  assert.equal(appbar.hidden, true);
  assert.equal(shell.open('layers'), false, 'na desktope sa výsuv neotvára');
  assert.deepEqual(suppressed.at(-1), ['ambient-card', false]);

  assert.equal(byId.get('command-dock').style.bottom, '', 'desktop: dok drží CSS');

  win.coarse = true;
  win.resize(375, 812);
  assert.equal(body.classList.contains('oko-mobile'), true);
  assert.equal(body.classList.contains('oko-mobile-landscape'), false);
  assert.equal(appbar.hidden, false);
  assert.deepEqual(suppressed.at(-1), ['ambient-card', true], 'ambientné karty na mobile vypnuté');
  assert.equal(byId.get('command-dock').style.bottom, '66px', 'dok zdvihnutý inline nad lištu (58 + 8, bez zmeranej výšky)');
  assert.equal(byId.get('cesium-credits').style.bottom, '152px', 'kredity nad dokom aj nad presahom hlasovej pilulky (66 + 62 + 16 + 8), nie v ich páse');
  assert.equal(doc.documentElement.style.props['--oko-dock-lift'], '66px', 'výsuv/toast dvíha premenná');

  const dataPanel = byId.get('data-panel');
  const cctvPanel = byId.get('cctv-panel');
  assert.equal(shell.open('layers'), true);
  assert.equal(dataPanel.parentNode, sheet.querySelector('.oko-sheet-body'));
  assert.equal(dataPanel.classList.contains('collapsed'), false, 'sekcia sa rozbalí');
  assert.equal(dataPanel.classList.contains('oko-in-sheet'), true);
  assert.equal(sheet.hidden, false);
  assert.equal(backdrop.hidden, false);
  assert.equal(body.dataset.okoSection, 'layers');
  assert.equal(byId.get('oko-sheet-title').textContent, 'LAYERS');
  assert.deepEqual(styleManager.calls.at(-1), ['data-panel', false, { persist: false, syncShare: false }], 'zbaľovanie cez StyleManager bez ukladania');
  const pressed = appbar.querySelectorAll('[data-oko-section]').map((b) => b.getAttribute('aria-pressed'));
  assert.deepEqual(pressed, ['true', 'false', 'false', 'false', 'false']);

  assert.equal(shell.close(), true);
  assert.equal(dataPanel.parentNode, leftStack);
  assert.equal(leftStack.children[0], dataPanel, 'späť pred #cctv-panel, nie na koniec');
  assert.equal(leftStack.children[1], cctvPanel);
  assert.equal(dataPanel.classList.contains('collapsed'), true, 'pôvodný zbalený stav sa vráti');
  assert.equal(dataPanel.classList.contains('oko-in-sheet'), false);
  assert.equal(sheet.hidden, true);
  assert.equal(body.dataset.okoSection, undefined);
});

test('živý rámček (2026-10-06): úzky rámček = plášť bez spodnej lišty — lišta skrytá, zdvih len medzera, dok a kredity bez inline zdvihu, ambientné karty vypnuté', () => {
  const { doc, byId, body, appbar } = buildDom();
  const win = makeWindow({ width: 640, height: 400, coarse: false });
  const suppressed = [];
  const shell = createMobileShell({ document: doc, window: win, styleManager: makeStyleManager(doc), suppressLane: (lane, on) => suppressed.push([lane, on]), embed: true });
  shell.sync();
  assert.equal(body.classList.contains('oko-mobile'), true, '640 px je pod hranicou mobilu — dokované karty aj na cudzom webe');
  assert.equal(appbar.hidden, true, 'v rámčeku lišta sekcií nie je');
  assert.equal(doc.documentElement.style.props['--oko-dock-lift'], '8px', 'dokované karty rátajú lift − 8 px = okraj');
  assert.equal(byId.get('command-dock').style.bottom, '', 'dok sa nedvíha (je skrytý)');
  assert.ok(!byId.get('cesium-credits').style.bottom, 'kredity drží v rohu rámček, nie plášť');
  assert.deepEqual(suppressed.at(-1), ['ambient-card', true]);
  assert.equal(shell.open('layers'), false, 'bez lišty sa výsuv neotvára');
  win.resize(1440, 900);
  assert.equal(appbar.hidden, true);
  assert.equal(doc.documentElement.style.props['--oko-dock-lift'], undefined);
});

test('plášť: jedna sekcia naraz, viac panelov v sekcii (rozbalený len prvý), prepnutie vráti predošlé; hľadanie otvorí lištu polohy bez výsuvu', () => {
  const { doc, byId, sheet, leftStack, rail } = buildDom();
  const win = makeWindow({ width: 390, height: 844, coarse: true });
  const styleManager = makeStyleManager(doc);
  const shell = createMobileShell({ document: doc, window: win, styleManager });
  shell.sync();
  const sheetBody = sheet.querySelector('.oko-sheet-body');
  assert.equal(shell.open('display'), true);
  assert.deepEqual(sheetBody.children.map((c) => c.id), ['pp-toggles', 'cctv-panel', 'global-context-panel']);
  assert.equal(byId.get('pp-toggles').classList.contains('collapsed'), false);
  assert.equal(byId.get('cctv-panel').classList.contains('collapsed'), true, 'ostatné ostávajú zbalené ako hlavičky');
  assert.deepEqual(shell._getStateForTest().moved, ['pp-toggles', 'cctv-panel', 'global-context-panel']);

  assert.equal(shell.open('data'), true, 'prepnutie sekcie');
  assert.deepEqual(sheetBody.children.map((c) => c.id), ['gas-panel', 'history-panel']);
  assert.equal(byId.get('pp-toggles').parentNode, rail, 'DISPLAY späť v pravej lište');
  assert.equal(rail.children[0], byId.get('pp-toggles'));
  assert.equal(byId.get('cctv-panel').parentNode, leftStack);
  assert.equal(leftStack.children[1], byId.get('cctv-panel'), 'CCTV späť na svoju pozíciu v ľavom stĺpci');
  assert.equal(shell.activeSection(), 'data');

  assert.equal(shell.toggle('data'), true, 'toggle otvorenej sekcie zatvára');
  assert.equal(shell.activeSection(), null);
  assert.deepEqual(leftStack.children.map((c) => c.id), ['data-panel', 'cctv-panel', 'scene-panel', 'history-panel', 'gas-panel'], 'pôvodné poradie ľavého stĺpca');

  assert.equal(shell.open('search'), true);
  assert.equal(sheet.hidden, true, 'hľadanie nie je výsuv');
  assert.equal(byId.get('location-bar').classList.contains('collapsed'), false);
  assert.equal(byId.get('location-search').focused, true);
  assert.deepEqual(styleManager.calls.at(-1), ['location-bar', false, { explicit: true }]);
});

test('plášť: naležato = zásuvka; návrat na desktop otvorený výsuv zatvorí a vráti panely; Escape a lišta zatvárajú; potiahnutie nadol zatvorí', () => {
  const { doc, byId, body, appbar, sheet, leftStack } = buildDom();
  const win = makeWindow({ width: 844, height: 390, coarse: true });
  const shell = createMobileShell({ document: doc, window: win, styleManager: null });
  shell.sync();
  assert.equal(body.classList.contains('oko-mobile-landscape'), true);
  const scenesButton = appbar.querySelectorAll('[data-oko-section]')[1];
  scenesButton.click();
  assert.equal(shell.activeSection(), 'scenes');
  assert.equal(byId.get('scene-panel').parentNode, sheet.querySelector('.oko-sheet-body'));
  doc.dispatch('keydown', { key: 'Escape' });
  assert.equal(shell.activeSection(), null, 'Escape zatvára');
  assert.equal(byId.get('scene-panel').parentNode, leftStack);

  scenesButton.click();
  const head = sheet.querySelector('.oko-sheet-head');
  head.dispatch('touchstart', { touches: [{ clientY: 100 }] });
  head.dispatch('touchend', { changedTouches: [{ clientY: 260 }] });
  assert.equal(shell.activeSection(), null, 'potiahnutie nadol zatvára');

  scenesButton.click();
  assert.equal(shell.activeSection(), 'scenes');
  win.coarse = false;
  win.resize(1440, 900);
  assert.equal(body.classList.contains('oko-mobile'), false);
  assert.equal(shell.activeSection(), null, 'desktop: výsuv zatvorený');
  assert.equal(byId.get('scene-panel').parentNode, leftStack, 'panel späť v stĺpci');
  assert.equal(appbar.hidden, true);
  assert.equal(byId.get('command-dock').style.bottom, '', 'desktop: inline zdvih doku zmazaný');
  assert.equal(byId.get('cesium-credits').style.bottom, '', 'desktop: kredity späť na CSS');
  assert.equal(doc.documentElement.style.props['--oko-dock-lift'], undefined, 'premenná odstránená');
});

test('plášť bez značiek v DOM je nečinný (cudzí dokument, testy)', () => {
  const shell = createMobileShell({ document: { body: makeNode('body'), getElementById: () => null }, window: makeWindow({ width: 375, height: 812, coarse: true }) });
  assert.equal(shell.inert, true);
  assert.equal(shell.open('layers'), false);
  assert.deepEqual(shell.sync(), { mobile: false, landscape: false });
});

test('dok na mobile: pod ikonou krátky popis Poloha / Štýl (vlastník 09-27: „človek nevie, čo to je")', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const i18n = readFileSync(new URL('./i18nStrings.js', import.meta.url), 'utf8');
  assert.ok(html.includes('<span class="dock-label-short" data-i18n="panel.visual-presets.short">STYLE</span>'));
  assert.ok(html.includes('<span class="dock-label-short" data-i18n="panel.location.short">PLACE</span>'));
  assert.match(css, /\.dock-label-short \{ display: none; \}/, 'na počítači len dlhý názov');
  assert.match(css, /body\.oko-mobile #command-dock \.panel-title > span:not\(\.dock-label-icon\):not\(\.dock-label-short\)/, 'dlhý názov skrytý, krátky nie');
  assert.match(css, /body\.oko-mobile #command-dock \.dock-label-short \{\s*display: block;/);
  assert.match(i18n, /'panel\.visual-presets\.short': 'Štýl',/);
  assert.match(i18n, /'panel\.location\.short': 'Poloha',/);
});

test('plášť: sekcia sa dá otvoriť s iným rozbaleným panelom (História letov z pásu štátneho lietadla, 2026-09-30)', () => {
  const { doc, byId, sheet } = buildDom();
  const win = makeWindow({ width: 390, height: 844, coarse: true });
  const shell = createMobileShell({ document: doc, window: win, styleManager: makeStyleManager(doc) });
  shell.sync();
  assert.equal(shell.open('data', { expand: 'history-panel' }), true);
  assert.equal(byId.get('history-panel').classList.contains('collapsed'), false, 'História rozbalená');
  assert.equal(byId.get('gas-panel').classList.contains('collapsed'), true, 'predvolený panel sekcie zbalený');
  shell.close();
  assert.equal(shell.open('data', { expand: 'nie-je-v-sekcii' }), true);
  assert.equal(byId.get('gas-panel').classList.contains('collapsed'), false, 'neznámy panel = predvolené správanie');
  assert.equal(sheet.hidden, false);
});
