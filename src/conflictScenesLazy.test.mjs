// src/conflictScenesLazy.test.mjs — lenivé scény konfliktov (2026-10-31): modul sa dotiahne pri prvom
// podnete (panel, výber, hľadanie, odkaz, vlastník), inak nikdy; stav „Načítavam…" v tele panela.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CONFLICT_PANELS, createConflictScenesGate, panelExpanded, urlWantsConflictScenes } from './conflictScenesLazy.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

/** Minimálny DOM: panely s triedou collapsed, telá panelov, body.oko-owner, MutationObserver. */
function fakeDom({ expanded = [], owner = false } = {}) {
  const observers = [];
  globalThis.MutationObserver = class { constructor(cb) { this.cb = cb; } observe(el) { observers.push({ el, cb: this.cb, on: true }); } disconnect() { this.on = false; for (const o of observers) if (o.cb === this.cb) o.on = false; } };
  const makeEl = (classes) => {
    const set = new Set(classes);
    const el = {
      children: [],
      classList: { contains: (c) => set.has(c), add: (c) => { set.add(c); fire(el); }, remove: (c) => { set.delete(c); fire(el); } },
      get childElementCount() { return el.children.length; },
      appendChild(child) { el.children.push(child); child.parent = el; },
    };
    return el;
  };
  const fire = (el) => { for (const o of observers) if (o.on && o.el === el) o.cb(); };
  const panels = new Map(CONFLICT_PANELS.map((p) => [p.id, makeEl(expanded.includes(p.id) ? [] : ['collapsed'])]));
  const bodies = new Map(CONFLICT_PANELS.map((p) => [p.id, makeEl([])]));
  const body = makeEl(owner ? ['oko-owner'] : []);
  const doc = {
    body,
    getElementById: (id) => panels.get(id) || null,
    querySelector: (sel) => { const m = /^#([\w-]+) /.exec(sel); return m ? bodies.get(m[1]) || null : null; },
    createElement: () => ({ className: '', dataset: {}, textContent: '', remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); } }),
  };
  return { doc, panels, bodies, body };
}

function fakeImporter(log) {
  const api = { runFrontScene: (id) => { log.push(['front', id]); return 'f'; }, runChokepointScene: (id) => { log.push(['choke', id]); return 'c'; }, runMideastTheatre: (id) => { log.push(['mideast', id]); return 'm'; }, frameConflict: (c) => { log.push(['frame', c?.id]); return 'fr'; }, kartaOverlay: null, conflictsPanel: null };
  return { api, importer: async () => { log.push(['import']); return { initConflictScenes: (deps) => { log.push(['init', Object.keys(deps).sort().join(',')]); return api; } }; } };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('bez podnetu sa nič nesťahuje; window API scén pred dotiahnutím spúšťa cez bránu', async () => {
  const { doc } = fakeDom();
  const log = [];
  const { importer, api } = fakeImporter(log);
  const gate = createConflictScenesGate({ getDeps: () => ({ viewer: 'v' }), importer, doc });
  gate.install({ search: '?foo=1&front=neexistuje' });
  await tick();
  assert.deepEqual(log, [], 'zbalené panely, bez vlastníka, neplatný odkaz → nič');
  assert.equal(gate.loaded, false);
  assert.equal(await gate.run('front', 'lyman'), 'f');
  assert.deepEqual(log, [['import'], ['init', 'viewer'], ['front', 'lyman']]);
  assert.equal(gate.loaded, true);
  assert.equal(gate.api, api);
  assert.equal(await gate.run('chokepoint', 'hormuz'), 'c');
  assert.equal(await gate.run('mideast', 'gaza'), 'm');
  assert.equal(await gate.frame({ id: 'x' }), 'fr');
  assert.equal(log.filter((l) => l[0] === 'import').length, 1, 'modul sa dotiahne raz');
  await assert.rejects(gate.run('nope', '1'), /unknown scene kind/);
});

test('rozbalenie panela UKRAJINA (aj neskoršie, cez triedu collapsed) dotiahne modul; telo panela ukáže Načítavam…', async () => {
  const { doc, panels, bodies } = fakeDom();
  const log = [];
  const { importer } = fakeImporter(log);
  const gate = createConflictScenesGate({ getDeps: () => ({}), importer, doc, translate: (k) => `[${k}]` });
  gate.install({});
  assert.deepEqual(log, []);
  panels.get('ukraine-panel').classList.remove('collapsed');
  assert.equal(bodies.get('ukraine-panel').children[0]?.textContent, '[lazy.loading]', 'stav načítavania v tele panela');
  assert.equal(bodies.get('ukraine-panel').children[0]?.dataset.state, 'loading');
  assert.equal(bodies.get('mideast-panel').children[0]?.dataset.state, 'loading', 'aj druhý panel — modul je spoločný');
  await gate.load();
  assert.equal(bodies.get('ukraine-panel').children.length, 0, 'po dotiahnutí zástupný riadok zmizne (panel si telo postaví sám)');
  assert.deepEqual(log.map((l) => l[0]), ['import', 'init']);
  // panel už rozbalený pri inštalácii (obnova z uloženého stavu) → hneď
  const second = fakeDom({ expanded: ['mideast-panel'] });
  const log2 = [];
  const g2 = createConflictScenesGate({ getDeps: () => ({}), importer: fakeImporter(log2).importer, doc: second.doc });
  g2.install({});
  await tick();
  assert.deepEqual(log2.map((l) => l[0]), ['import', 'init']);
});

test('vlastník (body.oko-owner) a platný odkaz ?front= / ?chokepoint= / ?mideast= dotiahnu modul hneď', async () => {
  for (const [opts, search] of [[{ owner: true }, ''], [{}, '?front=lyman'], [{}, '?chokepoint=hormuz'], [{}, '?mideast=gaza']]) {
    const { doc } = fakeDom(opts);
    const log = [];
    const gate = createConflictScenesGate({ getDeps: () => ({}), importer: fakeImporter(log).importer, doc });
    gate.install({ search });
    await tick();
    assert.deepEqual(log.map((l) => l[0]), ['import', 'init'], JSON.stringify([opts, search]));
  }
  // vlastník sa prihlási až neskôr (trieda pribudne)
  const { doc, body } = fakeDom();
  const log = [];
  const gate = createConflictScenesGate({ getDeps: () => ({}), importer: fakeImporter(log).importer, doc });
  gate.install({});
  assert.deepEqual(log, []);
  body.classList.add('oko-owner');
  await tick();
  assert.deepEqual(log.map((l) => l[0]), ['import', 'init']);
  assert.equal(urlWantsConflictScenes('?front=lyman'), true);
  assert.equal(urlWantsConflictScenes('?front=preklep'), false, 'neplatné id modul nesťahuje');
  assert.equal(urlWantsConflictScenes(''), false);
  assert.equal(panelExpanded({ classList: { contains: () => false } }), true);
  assert.equal(panelExpanded(null), false);
});

test('chyba siete: stav v tele panela hlási chybu, ďalší podnet skúsi znova', async () => {
  const { doc, panels, bodies } = fakeDom();
  let fail = true;
  const log = [];
  const good = fakeImporter(log).importer;
  const importer = async () => { if (fail) throw new Error('offline'); return good(); };
  const gate = createConflictScenesGate({ getDeps: () => ({}), importer, doc, translate: (k) => `[${k}]`, onLoaded: () => log.push(['loaded']) });
  gate.install({});
  panels.get('mideast-panel').classList.remove('collapsed');
  await gate.load().catch(() => {});
  await tick();
  assert.equal(bodies.get('mideast-panel').children[0]?.dataset.state, 'error');
  assert.equal(bodies.get('mideast-panel').children[0]?.textContent, '[lazy.error]');
  assert.equal(gate.loaded, false);
  fail = false;
  await gate.load();
  assert.equal(gate.loaded, true);
  assert.deepEqual(log.at(-1), ['loaded'], 'onLoaded po inicializácii (premeranie ľavého stĺpca)');
});

test('zapojenie: main.js scény nenesie, brána dostane glóbus a hranice; výbery a hľadanie idú cez bránu; modul vracia API', () => {
  const main = read('./main.js');
  for (const f of ['./mideastPanel.js', './ukraineTimeline.js', './data/ukraineBaseLayer.js', './conflictsPanel.js', './ukraineKartaOverlay.js', './gulfIncidentCards.js', './sceneRevealGate.js', './conflictScenes.js']) {
    assert.doesNotMatch(main, new RegExp(`from '${f.replace(/[./]/g, '\\$&')}'`), `main.js staticky neimportuje ${f}`);
  }
  assert.match(main, /import \{ createConflictScenesGate \} from '\.\/conflictScenesLazy\.js';/);
  assert.match(main, /const conflictScenes = createConflictScenesGate\(\{\n\s+getDeps: \(\) => \(\{ viewer, styleManager, dataManager, mapStackController, countryBoundaries, aisLiveVesselsLayer, aishubVesselsLayer, gfwSarDetectionsLayer \}\),/);
  assert.match(main, /conflictScenes\.install\(\{ search: window\.location\?\.search \|\| '' \}\);/);
  assert.match(main, /window\.__godsEyeView\.frontScenes = \{ list: listFrontScenes, apply: \(id\) => conflictScenes\.run\('front', id\) \};/);
  assert.match(main, /run: \(\) => \{ void conflictScenes\.frame\(c\); \}/, 'konflikt v hľadaní zarámuje cez bránu');
  assert.match(main, /m\.kartaOverlay\?\.setClean\(!m\.kartaOverlay\.isClean\(\)\)/);
  for (const id of ['chokepoint-select', 'front-select', 'mideast-select']) assert.match(main, new RegExp(`bindScenePicker\\('${id}'`));
  assert.ok(main.indexOf('const countryBoundaries = createCountryBoundaries({ viewer });') < main.indexOf('const conflictScenes = createConflictScenesGate('), 'hranice vznikajú pred bránou (modul ich dostane)');
  const mod = read('./conflictScenes.js');
  assert.match(mod, /^export function initConflictScenes\(deps\) \{\n  const \{ viewer, styleManager, dataManager, mapStackController, countryBoundaries, aisLiveVesselsLayer, aishubVesselsLayer, gfwSarDetectionsLayer \} = deps;/m);
  assert.match(mod, /return \{\n\s+runFrontScene, runChokepointScene, runMideastTheatre, frameConflict, exportConflict, exitUkraine,/);
  assert.match(mod, /window\.__godsEyeView\.frontScenes = \{ list: listFrontScenes, apply: runFrontScene \};/, 'modul po inicializácii nahradí zástupné window API');
  const lazy = read('./conflictScenesLazy.js');
  assert.match(lazy, /import\('\.\/conflictScenes\.js'\)/);
  assert.doesNotMatch(lazy, /^import .* from '\.\/conflictScenes\.js'/m, 'brána modul staticky neimportuje');
  const css = read('../style.css');
  assert.match(css, /\.oko-lazy-status\[data-state="loading"\]::before,\n\.gas-status\[data-state="loading"\]::before \{/, 'stav Načítavam… má krúžok ako plyn (pravidlo plynu ostáva prvé pre gasPanel.test)');
  const strings = read('./i18nStrings.js');
  assert.equal((strings.match(/'lazy\.loading': /g) || []).length, 2, 'SK aj EN');
  assert.equal((strings.match(/'lazy\.error': /g) || []).length, 2);
});
