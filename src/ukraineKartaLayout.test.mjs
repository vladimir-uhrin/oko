// src/ukraineKartaLayout.test.mjs — upratanie rámu KARTA (2026-09-26, „chcem to
// prehľadné"): ostrovy sedia v pásoch bez chrómu a pruhy panelov sa im vyhýbajú.
//
// Pred upratanám (merané v pane 1440×900, ?front=lyman): titulok ležal cez logo
// (#title-bar končí 89 px) aj cez ľavý pruh (od 100 px), nástroje a náhľad cez
// prepínač jazyka (84–121 px) a pravú lištu, legenda vľavo dole cez kredity
// Cesium/Google (645 px) aj cez otvorenú časovú os (694 px), mierka pod dokom.
// Tento test drží geometriu v style.css a väzby v JS, aby sa prekryvy nevrátili.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createUkraineKartaOverlay } from './ukraineKartaOverlay.js';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const scaleBar = readFileSync(new URL('./mapScaleBar.js', import.meta.url), 'utf8');

/** Hodnota vlastnosti v prvom pravidle so selektorom (jednoriadkové pravidlá KARTY). */
function prop(selector, name) {
  const re = new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`);
  const m = re.exec(css);
  assert.ok(m, `pravidlo ${selector} chýba v style.css`);
  const p = new RegExp(`(?:^|;|\\s)${name}:\\s*([^;]+)`).exec(m[1]);
  return p ? p[1].trim() : null;
}

test('KARTA: titulok vľavo hore POD logom, zarovnaný s ním (36 px), nie cez ľavý pruh', () => {
  assert.equal(prop('.oko-karta-title', 'top'), '98px', '#title-bar (top 32 + ~57) končí pri 89 px');
  assert.equal(prop('.oko-karta-title', 'left'), '36px', 'ľavý okraj ako logo');
  assert.match(prop('.oko-karta-title', 'max-width'), /420px/, 'užší než 46vw, aby neliezol pod stavový čip v strede');
  // stav + zdroje v jednom riadku (láme sa) — každý px výšky chýba pilieru panelov
  assert.match(css, /\.oko-karta-title-meta \{ display: flex; flex-wrap: wrap;/);
});

test('KARTA: nástroje a náhľad vpravo hore POD prepínačom jazyka, pravý okraj 36 px', () => {
  assert.equal(prop('.oko-karta-tools', 'top'), '130px', '#lang-switch (top 84 + ~37) končí pri 121 px');
  assert.equal(prop('.oko-karta-tools', 'right'), '36px');
  assert.equal(prop('.oko-karta-inset', 'top'), '178px', 'pod nástrojmi (130 + 40 + medzera)');
  assert.equal(prop('.oko-karta-inset', 'right'), '36px');
});

test('KARTA: legenda vpravo dole nad časovou osou (zdvih z --oko-ukr-tl-lift), s mierkou v päte', () => {
  const bottom = prop('.oko-karta-legend', 'bottom');
  assert.match(bottom, /var\(--oko-ukr-tl-lift, 0px\)/, 'otvorená os ju zdvihne — inak leží cez os');
  assert.match(bottom, /max\(96px/, 'bez osi ostáva nad pilulkou mikrofónu (right/bottom 36)');
  assert.equal(prop('.oko-karta-legend', 'right'), '36px', 'vpravo: ľavý stĺpec je pilier zbalených panelov');
  assert.equal(prop('.oko-karta-legend', 'left'), null, 'už nie vľavo dole (tam sú kredity a pilier)');
  assert.match(css, /\.oko-karta-legend-list \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/, 'dva stĺpce, popisy sa lámu');
  assert.match(css, /\.oko-karta-legend-scale \{ height: 16px;/, 'slot pre mierku');
  assert.match(css, /body\.oko-karta-frame \.oko-scale \{ z-index: 93; \}/, 'mierka nad ostrovom legendy (overlay má 92)');
  assert.match(css, /@media \(max-width: 1347px\) \{\s*\.oko-karta-legend \{ width: min\(48vw, 300px\); \}\s*\.oko-karta-legend-list \{ grid-template-columns: 1fr; \}/, 'pod 1348 px jeden stĺpec, inak by legenda siahala pod stredový dok (476 px)');
});

test('KARTA: rám schová súradnicový roh HUD-u a obmedzí ľavý pruh na koridor (roluje, nepreteká)', () => {
  assert.match(css, /body\.oko-karta-frame #intel-hud \.hud-bottom-left \{ display: none; \}/);
  assert.doesNotMatch(css, /body\.oko-map-focus #intel-hud \.hud-bottom-left/, 'mimo rámu (režim mapy) súradnice ostávajú — mapScaleBar.test');
  const lane = /body\.oko-karta-frame #left-panel-stack \{([^}]*)\}/.exec(css);
  assert.ok(lane, 'pravidlo pruhu v ráme chýba');
  assert.match(lane[1], /max-height: calc\(100vh - var\(--left-stack-safe-top, var\(--left-stack-top\)\) - var\(--left-stack-safe-bottom, 4vh\)\)/);
  assert.match(lane[1], /overflow-y: auto/);
  // čistá karta necháva mierku (súčasť hotovej mapy)
  assert.match(css, /body\.oko-karta-clean > \*:not\(#cesiumContainer\)[^{]*:not\(\.oko-scale\) \{ display: none !important; \}/);
});

test('KARTA: ostrovy sú prekážky pruhov (ui.js) a main.js ich po vzniku prihlási', () => {
  const left = /const LEFT_STACK_OBSTACLE_SELECTOR = \[([\s\S]*?)\]\.join/.exec(ui);
  const right = /const RIGHT_STACK_OBSTACLE_SELECTOR = \[([\s\S]*?)\]\.join/.exec(ui);
  assert.ok(left && right);
  assert.match(left[1], /'#oko-karta-overlay\.is-visible \.oko-karta-title'/, 'ľavý pruh tečie pod titulkom');
  assert.doesNotMatch(left[1], /oko-karta-legend/, 'legenda nie je vľavo');
  for (const island of ['tools', 'inset', 'legend']) {
    assert.match(right[1], new RegExp(`'#oko-karta-overlay\\.is-visible \\.oko-karta-${island}'`), `pravá lišta sa vyhne ostrovu ${island}`);
  }
  assert.match(ui, /observeRightStackObstacle\(element\) \{\s*if \(!element\) return;\s*this\._rightStackResizeObserver\?\.observe\(element\);\s*this\._scheduleRightPanelLayout\(\);/);
  assert.match(main, /styleManager\.observeLeftStackObstacle\?\.\(kartaOverlay\.elements\?\.title\)/);
  for (const island of ['tools', 'inset', 'legend']) {
    assert.match(main, new RegExp(`styleManager\\.observeRightStackObstacle\\?\\.\\(kartaOverlay\\.elements\\?\\.${island}\\)`));
  }
});

test('KARTA: mierka sa kotví do päty legendy (pred HUD-om aj pred spodným chrómom)', () => {
  const place = /function place\(\) \{([\s\S]*?)\n  \}/.exec(scaleBar);
  assert.ok(place, 'place() chýba');
  const slot = place[1].indexOf("'#oko-karta-overlay.is-visible .oko-karta-legend-scale'");
  const hud = place[1].indexOf('hr && hr.height > 0');
  assert.ok(slot > 0 && hud > slot, 'slot legendy má prednosť pred rohom HUD-u');
  assert.match(place[1], /left = sr\.left; top = sr\.top \+ \(sr\.height - h\) \/ 2;/);
});

// ── DOM: trieda rámu a vystavené ostrovy ──────────────────────────────────────
function fakeNode(tag) {
  const classes = new Set();
  const node = {
    tagName: String(tag).toUpperCase(), children: [], _attrs: {}, textContent: '', id: '', type: '',
    style: { setProperty(k, v) { this[k] = v; } },
    get className() { return [...classes].join(' '); },
    set className(v) { classes.clear(); for (const c of String(v).split(/\s+/)) if (c) classes.add(c); },
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, force) => { const on = force === undefined ? !classes.has(c) : Boolean(force); if (on) classes.add(c); else classes.delete(c); return on; },
      contains: (c) => classes.has(c),
    },
    setAttribute(k, v) { node._attrs[k] = String(v); }, getAttribute(k) { return node._attrs[k] ?? null; },
    append(...kids) { node.children.push(...kids); }, appendChild(k) { node.children.push(k); return k; },
    replaceChildren(...kids) { node.children = kids; },
    addEventListener() {}, remove() {},
  };
  return node;
}
function fakeLayer(shown) {
  return { getState: () => ({ shown }), isShown: () => shown, onChange() { return () => {}; } };
}

test('DOM: rám prepína body.oko-karta-frame s viditeľnosťou a vystaví ostrovy pre prekážky', () => {
  const body = fakeNode('body');
  const doc = { createElement: (t) => fakeNode(t), createElementNS: (_ns, t) => fakeNode(t), body };
  const overlay = createUkraineKartaOverlay({
    documentRef: doc, translate: (k) => k,
    control: fakeLayer(false), deepstate: fakeLayer(true), report: fakeLayer(false),
  });
  assert.equal(body.classList.contains('oko-karta-frame'), false, 'skrytý rám = bez triedy');
  overlay.setStack({ kind: 'hillshade' });
  assert.equal(body.classList.contains('oko-karta-frame'), true, 'KARTA viditeľná = trieda na tele');
  overlay.setRevealed(false);
  assert.equal(body.classList.contains('oko-karta-frame'), false, 'pohľad na planétu rám schová aj triedu');
  overlay.setRevealed(true);
  const { title, legend, inset, tools } = overlay.elements;
  assert.ok(title.classList.contains('oko-karta-title') && legend.classList.contains('oko-karta-legend'));
  assert.ok(inset.classList.contains('oko-karta-inset') && tools.classList.contains('oko-karta-tools'));
  assert.ok(legend.children.some((c) => c.classList.contains('oko-karta-legend-scale')), 'päta legendy = slot pre mierku');
  overlay.destroy();
  assert.equal(body.classList.contains('oko-karta-frame'), false, 'destroy upratá triedu');
});

// ── Pravá lišta panelov v ráme KARTA (2026-09-26, vlastník ju zakrúžkoval: „treba presunúť,
//    neskôr sa bude robiť poriadok") ──────────────────────────────────────────────────────
test('KARTA: legenda je spodná hranica pravej lišty (aj cez stred), bez miesta sa hranica neuplatní', async () => {
  const { resolveHudRailLayout } = await import('./cockpitMath.js');
  const legend = { left: 1089, right: 1489, top: 360, bottom: 590, bottomBound: true };
  const base = { viewportHeight: 808, panelHeight: 400, laneLeft: 1039, laneRight: 1311, baseTop: 130, baseBottom: 776, gap: 10, align: 'start' };
  const bound = resolveHudRailLayout({ ...base, obstacles: [legend] });
  assert.equal(bound.safeBottom, 350, 'končí nad legendou');
  assert.equal(bound.top, 130);
  // bez príznaku by pravidlo stredu legendu (360–590 cez stred 404) ignorovalo
  assert.equal(resolveHudRailLayout({ ...base, obstacles: [{ ...legend, bottomBound: false }] }).safeBottom, 776);
  // nad legendou < minBoundHeight (150) → hranica sa neuplatní, lišta nezmizne
  const tight = resolveHudRailLayout({ ...base, obstacles: [{ ...legend, top: 200, bottom: 430 }] });
  assert.equal(tight.safeBottom, 776);
  const ov = readFileSync(new URL('./ukraineKartaOverlay.js', import.meta.url), 'utf8');
  assert.match(ov, /legendIsland\.setAttribute\('data-rail-bound', 'bottom'\);/);
  assert.match(ui, /bottomBound: obstacle\.dataset\?\.railBound === 'bottom',/);
  assert.match(ui, /const kartaTools = document\.querySelector\('#oko-karta-overlay\.is-visible \.oko-karta-tools'\);/, 'v ráme začína na úrovni tlačidiel KARTY');
  assert.match(ui, /this\._rightStackMutationObserver\.observe\(document\.documentElement, \{ attributes: true, attributeFilter: \['style'\] \}\);/, 'posun legendy (premenné na <html>) prepočíta lištu');
});

// ── Pravá lišta v ráme KARTA na vrch ľavého stĺpca (2026-09-26, vlastník ju zakrúžkoval a šípkou
//    ukázal hore do ľavého stĺpca: „toto musí zmiznúť a dať tam, kde som dal šípku") ──────────
function fakeEl(id) {
  const props = new Map();
  const classes = new Set();
  const el = {
    id, parentNode: null, children: [],
    get nextSibling() { const p = this.parentNode; if (!p) return null; const i = p.children.indexOf(this); return p.children[i + 1] || null; },
    get firstChild() { return this.children[0] || null; },
    style: { setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k), getPropertyValue: (k) => props.get(k) || '' },
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
    detach() { if (this.parentNode) { this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; } },
    insertBefore(child, ref) { child.detach(); const i = ref ? this.children.indexOf(ref) : -1; this.children.splice(i < 0 ? this.children.length : i, 0, child); child.parentNode = this; },
    appendChild(child) { this.insertBefore(child, null); },
    props,
  };
  return el;
}

test('KARTA: pravá lišta sa v ráme zakotví na vrch ľavého stĺpca a po odchode sa vráti na svoje miesto', async () => {
  const { createKartaRailDock, DOCKED_INLINE } = await import('./kartaRailDock.js');
  const bodyEl = fakeEl('body');
  const app = fakeEl('app');
  const lane = fakeEl('left-panel-stack');
  const dataPanel = fakeEl('data-panel');
  const rail = fakeEl('right-context-rail');
  const after = fakeEl('after-rail');
  lane.appendChild(dataPanel);
  app.appendChild(lane); app.appendChild(rail); app.appendChild(after);
  const byId = { 'left-panel-stack': lane, 'right-context-rail': rail };
  const doc = { body: bodyEl, getElementById: (id) => byId[id] || null };
  const dock = createKartaRailDock(doc);

  assert.equal(dock.setDocked(true), true);
  assert.equal(rail.parentNode, lane, 'lišta je v ľavom stĺpci');
  assert.equal(lane.firstChild, rail, 'na vrchu, nad DÁTOVÝMI VRSTVAMI');
  assert.ok(rail.classList.contains('oko-rail-docked'));
  assert.equal(rail.props.get('position'), 'relative', 'poloha inline (creditAttribution.test stráži CSS lišty)');
  assert.equal(rail.props.get('top'), 'auto');
  assert.equal(dock.setDocked(true), false, 'idempotentné');

  assert.equal(dock.setDocked(false), true);
  assert.equal(rail.parentNode, app);
  assert.equal(rail.nextSibling, after, 'vrátená presne na pôvodné miesto');
  assert.equal(rail.classList.contains('oko-rail-docked'), false);
  for (const k of Object.keys(DOCKED_INLINE)) assert.equal(rail.props.has(k), false, `inline ${k} zmazané`);

  bodyEl.classList.add('oko-mobile');
  assert.equal(dock.setDocked(true), false, 'na mobile nič — panely nosí výsuv plášťa');
  assert.equal(rail.parentNode, app);
  assert.equal(createKartaRailDock({ body: bodyEl, getElementById: () => null }).setDocked(true), false, 'bez prvkov nič');
});

test('KARTA: väzby zakotvenia — rám ho zapína/vypína, poradie v ľavom pruhu, rozloženie lišty ustúpi', () => {
  const ov = readFileSync(new URL('./ukraineKartaOverlay.js', import.meta.url), 'utf8');
  assert.ok(ov.includes('railDock.setDocked(visible);'), 'rám KARTA zakotví / uvoľní');
  assert.ok(ov.includes('railDock.setDocked(false);'), 'destroy lištu vráti');
  assert.equal(prop('#left-panel-stack > .oko-rail-docked', 'order'), '0', 'nad #data-panel (order 10)');
  assert.ok(!css.includes('body.oko-karta-frame #right-context-rail'), 'staré pravidlo vľavo od náhľadu je preč');
  assert.ok(ui.includes("if (stack.classList.contains('oko-rail-docked')) {"), 'koridor pravej lišty sa pri zakotvení nepočíta');
  assert.ok(ui.includes("stack.dataset.layoutMode = 'docked';"));
});

test('KARTA: zakotvenie zbalí rozbalené panely lišty bez uloženia a po odchode ich rozbalí', async () => {
  const { createKartaRailDock } = await import('./kartaRailDock.js');
  const app = fakeEl('app');
  const lane = fakeEl('left-panel-stack');
  const rail = fakeEl('right-context-rail');
  const display = fakeEl('pp-toggles');
  const cams = fakeEl('cctv-panel');
  const ctx = fakeEl('global-context-panel');
  cams.classList.add('collapsed');
  for (const p of [display, cams, ctx]) rail.appendChild(p);
  app.appendChild(lane); app.appendChild(rail);
  const byId = { 'left-panel-stack': lane, 'right-context-rail': rail, 'pp-toggles': display, 'cctv-panel': cams, 'global-context-panel': ctx };
  const calls = [];
  const setPanelCollapsed = (id, collapsed) => { calls.push([id, collapsed]); byId[id].classList.toggle('collapsed', collapsed); };
  const dock = createKartaRailDock({ body: fakeEl('body'), getElementById: (id) => byId[id] || null }, { setPanelCollapsed });

  dock.setDocked(true);
  assert.deepEqual(calls, [['pp-toggles', true], ['global-context-panel', true]], 'zbalí len rozbalené (Kamery už boli zbalené)');
  // počas rámu používateľ Kontext rozbalí a znova zbalí — po odchode sa vráti stav pred KARTOU
  calls.length = 0;
  dock.setDocked(false);
  assert.deepEqual(calls, [['pp-toggles', false], ['global-context-panel', false]]);
  assert.ok(cams.classList.contains('collapsed'), 'Kamery ostanú zbalené');
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.ok(main.includes("styleManager.setPanelCollapsed?.(id, collapsed, { persist: false, syncShare: false })"), 'bez uloženia preferencie');
});
