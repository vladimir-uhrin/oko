// src/ukrainePanel.test.mjs — telo panela UKRAJINA (etapa 1): stav snímku,
// tlačidlo podkladu, čipy častí, zoznam smerov, reakcia na zmeny vrstvy.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createUkrainePanel } from './ukrainePanel.js';
import { FRONT_SCENES } from './ukraineFrontScenes.js';
import { UKRAINE_BASE_PARTS } from './data/ukraineBase.js';

function fakeDocument() {
  const makeEl = (tag) => {
    const classes = new Set();
    const el = {
      tag, children: [], textContent: '', hidden: false, disabled: false, dataset: {}, attrs: {}, listeners: {}, type: '',
      get className() { return [...classes].join(' '); },
      set className(v) { classes.clear(); for (const c of String(v).split(/\s+/)) if (c) classes.add(c); },
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); }, contains: (c) => classes.has(c) },
      appendChild(c) { el.children.push(c); return c; },
      replaceChildren(...cs) { el.children = [...cs]; },
      href: '', target: '', rel: '',
      addEventListener(t, fn) { el.listeners[t] = fn; },
      setAttribute(k, v) { el.attrs[k] = v; },
      click() { el.listeners.click?.(); },
    };
    return el;
  };
  return { createElement: makeEl };
}
const walk = (node, out = []) => { for (const c of node.children) { out.push(c); walk(c, out); } return out; };
const byClass = (root, cls) => walk(root).filter((n) => n.classList.contains(cls));
const tKey = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);

function fakeLayer(initial = {}) {
  const listeners = new Set();
  let state = { shown: false, loading: false, loaded: false, error: null, meta: null, parts: { places: true, roads: true, rivers: true, oblasts: true }, counts: {}, snapshotDate: null, ...initial };
  return {
    calls: [],
    getState: () => state,
    getParts: () => ({ ...state.parts }),
    setPart(part, on) { this.calls.push(['setPart', part, on]); state = { ...state, parts: { ...state.parts, [part]: on } }; for (const fn of listeners) fn(state); },
    toggle() { this.calls.push(['toggle']); state = { ...state, shown: !state.shown }; for (const fn of listeners) fn(state); return Promise.resolve(state.shown); },
    loadMeta() { this.calls.push(['loadMeta']); return Promise.resolve(null); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(patch) { state = { ...state, ...patch }; for (const fn of listeners) fn(state); },
  };
}

test('bez cieľa alebo vrstvy je panel neškodný', () => {
  const inert = createUkrainePanel({ mountTarget: null, layer: fakeLayer(), documentRef: fakeDocument() });
  assert.equal(inert.element, null);
  inert.update(); inert.setActiveScene('lyman'); inert.destroy();
});

test('kostra: stav, tlačidlo, 4 čipy, všetky smery, dve poznámky; meta sa vypýta hneď', () => {
  const doc = fakeDocument();
  const mount = doc.createElement('div');
  const layer = fakeLayer();
  const panel = createUkrainePanel({ mountTarget: mount, layer, translate: tKey, lang: 'sk', documentRef: doc });
  assert.equal(panel.element, mount);
  assert.deepEqual(layer.calls, [['loadMeta']]);
  const status = byClass(mount, 'ukraine-status')[0];
  assert.equal(status.textContent, 'ukraine.base.idle');
  assert.equal(status.dataset.state, 'idle');
  const chips = byClass(mount, 'ukraine-chip');
  assert.deepEqual(chips.map((c) => c.dataset.part), [...UKRAINE_BASE_PARTS]);
  assert.equal(chips.every((c) => c.classList.contains('active')), true, 'všetky časti zapnuté');
  const dirs = byClass(mount, 'ukraine-dir');
  assert.deepEqual(dirs.map((d) => d.dataset.front), FRONT_SCENES.map((s) => s.id));
  assert.equal(dirs[0].classList.contains('is-overview'), true);
  // tKey vráti kľúč = „preklad chýba" → frontSceneLabel padne na stabilné EN meno.
  const lymanName = byClass(dirs.find((d) => d.dataset.front === 'lyman'), 'ukraine-dir-name')[0];
  assert.equal(lymanName.textContent, 'Lyman direction');
  assert.equal(byClass(mount, 'ukraine-note').length, 3, 'dve poznámky + poznámka hlásenia (skrytá karta)');
  assert.equal(byClass(mount, 'ukraine-counts')[0].hidden, true, 'bez meta žiadne počty');
  assert.equal(byClass(mount, 'ukraine-chip-report').length, 0, 'bez vrstvy stretov niet čipu');
  assert.equal(byClass(mount, 'ukraine-report')[0].hidden, true, 'bez hlásenia je karta skrytá');
  assert.ok(byClass(mount, 'ukraine-news')[0], 'miesto pre správy existuje');
  assert.equal(panel.newsMount, byClass(mount, 'ukraine-news')[0]);
});

function fakeReport(initial = {}) {
  const listeners = new Set();
  let state = { shown: false, enabled: true, loading: false, error: null, report: null, byScene: {}, ...initial };
  return {
    calls: [],
    getState: () => state,
    isEnabled: () => state.enabled,
    setEnabled(on) { this.calls.push(['setEnabled', on]); state = { ...state, enabled: on }; for (const fn of listeners) fn(state); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(patch) { state = { ...state, ...patch }; for (const fn of listeners) fn(state); },
  };
}

test('hlásenie GŠ: čip STRETY, karta so súhrnom/údermi/odkazom, počty na smeroch podľa intenzity, načítavam/nedostupné', () => {
  const doc = fakeDocument();
  const mount = doc.createElement('div');
  const layer = fakeLayer();
  const report = fakeReport();
  createUkrainePanel({ mountTarget: mount, layer, report, translate: tKey, lang: 'sk', documentRef: doc });
  const chip = byClass(mount, 'ukraine-chip-report')[0];
  assert.ok(chip);
  assert.equal(chip.classList.contains('active'), true);
  chip.click();
  assert.deepEqual(report.calls, [['setEnabled', false]]);
  assert.equal(chip.classList.contains('active'), false);
  const box = byClass(mount, 'ukraine-report')[0];
  const summary = byClass(mount, 'ukraine-report-summary')[0];
  report.emit({ loading: true });
  assert.equal(box.hidden, false);
  assert.equal(summary.textContent, 'ukraine.report.loading');
  report.emit({ loading: false, error: 'upstream' });
  assert.equal(summary.textContent, 'ukraine.report.unavailable');
  report.emit({
    error: null,
    report: { total: 213, reportedAtText: '08:00 19.9.', url: 'https://armyinform.com.ua/x', strikes: { airStrikes: 89, guidedBombs: 312, kamikazeDrones: 10588, shellings: 2952 } },
    byScene: { lyman: { attacks: 5 }, sumy: { attacks: 0 }, pokrovsk: { attacks: 29 }, kostiantynivka: { attacks: 18 }, orikhiv: { attacks: null, unknown: true } },
  });
  assert.equal(summary.textContent, 'ukraine.report.summary {"total":213,"time":"08:00 19.9."}');
  assert.match(byClass(mount, 'ukraine-report-strikes')[0].textContent, /^ukraine\.report\.strikes \{"air":"89","bombs":"312","drones":"10 588","shellings":"2 952"\}$/);
  const link = byClass(mount, 'ukraine-report-link')[0];
  assert.equal(link.hidden, false);
  assert.equal(link.href, 'https://armyinform.com.ua/x');
  assert.equal(link.rel, 'noopener noreferrer');
  const count = (id) => byClass(byClass(mount, 'ukraine-dir').find((d) => d.dataset.front === id), 'ukraine-dir-count')[0];
  assert.equal(count('lyman').textContent, '5');
  assert.equal(count('lyman').classList.contains('is-low'), true);
  assert.equal(count('sumy').textContent, '0');
  assert.equal(count('sumy').classList.contains('is-quiet'), true);
  assert.equal(count('pokrovsk').classList.contains('is-high'), true);
  assert.equal(count('kostiantynivka').classList.contains('is-mid'), true);
  assert.equal(count('orikhiv').textContent, '—');
  assert.equal(count('orikhiv').classList.contains('is-unknown'), true);
  assert.equal(count('front').hidden, true, 'prehľad bez hlásenia');
  assert.equal(count('kherson').hidden, true, 'smer bez záznamu v hlásení nemá číslo');
});

test('interakcie: tlačidlo prepína vrstvu, čip prepína časť, smer volá applyScene a zvýrazní sa', async () => {
  const doc = fakeDocument();
  const mount = doc.createElement('div');
  const layer = fakeLayer();
  const applied = [];
  const panel = createUkrainePanel({ mountTarget: mount, layer, translate: tKey, documentRef: doc, applyScene: (id) => { applied.push(id); } });
  const toggle = byClass(mount, 'ukraine-toggle')[0];
  assert.equal(toggle.textContent, 'ukraine.base.show');
  toggle.click();
  await Promise.resolve();
  assert.deepEqual(layer.calls.filter((c) => c[0] === 'toggle').length, 1);
  assert.equal(toggle.textContent, 'ukraine.base.hide', 'stav sa premietne cez onChange');
  assert.equal(toggle.attrs['aria-pressed'], 'true');
  const roads = byClass(mount, 'ukraine-chip').find((c) => c.dataset.part === 'roads');
  roads.click();
  assert.deepEqual(layer.calls.at(-1), ['setPart', 'roads', false]);
  assert.equal(roads.classList.contains('active'), false);
  assert.equal(roads.attrs['aria-pressed'], 'false');
  const lyman = byClass(mount, 'ukraine-dir').find((d) => d.dataset.front === 'lyman');
  lyman.click();
  assert.deepEqual(applied, ['lyman']);
  assert.equal(panel.activeScene, 'lyman');
  assert.equal(lyman.classList.contains('is-active'), true);
  panel.setActiveScene('pokrovsk');
  assert.equal(lyman.classList.contains('is-active'), false);
  assert.equal(byClass(mount, 'ukraine-dir').find((d) => d.dataset.front === 'pokrovsk').attrs['aria-pressed'], 'true');
});

test('stavy: načítavam → dátum + počty → chýbajúci snímok → iná chyba', () => {
  const doc = fakeDocument();
  const mount = doc.createElement('div');
  const layer = fakeLayer();
  createUkrainePanel({ mountTarget: mount, layer, translate: tKey, lang: 'sk', documentRef: doc });
  const status = byClass(mount, 'ukraine-status')[0];
  const counts = byClass(mount, 'ukraine-counts')[0];
  const toggle = byClass(mount, 'ukraine-toggle')[0];
  layer.emit({ shown: true, loading: true });
  assert.equal(status.textContent, 'ukraine.base.loading');
  assert.equal(status.dataset.state, 'loading');
  assert.equal(toggle.disabled, true, 'počas načítania sa neprepína');
  layer.emit({ loading: false, loaded: true, snapshotDate: '19. 9. 2026', meta: { snapshot: '2026-09-19', counts: { oblasts: 27 }, datasets: { places: { features: 1023 }, villages: { features: 27000 }, roads: { lengthKm: 24300 } } } });
  assert.equal(status.textContent, 'ukraine.base.status {"date":"19. 9. 2026"}');
  assert.equal(status.dataset.state, 'ready');
  assert.equal(toggle.disabled, false);
  assert.equal(counts.hidden, false);
  assert.match(counts.textContent, /^ukraine\.base\.counts \{"places":"28 023","roads":"24 300","oblasts":"27"\}$/);
  layer.emit({ shown: false });
  assert.equal(status.dataset.state, 'idle', 'snímok známy, podklad vypnutý');
  layer.emit({ error: 'no_snapshot', meta: null, snapshotDate: null });
  assert.equal(status.textContent, 'ukraine.base.missing');
  assert.equal(status.dataset.state, 'error');
  layer.emit({ error: 'HTTP 502' });
  assert.equal(status.textContent, 'ukraine.base.error {"detail":"HTTP 502"}');
});

test('destroy odpojí poslucháča a vyprázdni telo', () => {
  const doc = fakeDocument();
  const mount = doc.createElement('div');
  const layer = fakeLayer();
  const panel = createUkrainePanel({ mountTarget: mount, layer, translate: tKey, documentRef: doc });
  assert.ok(mount.children.length > 0);
  panel.destroy();
  assert.equal(mount.children.length, 0);
  layer.emit({ shown: true });
  assert.equal(mount.children.length, 0, 'po destroy sa nič nekreslí');
});
