// src/weatherDock.test.mjs
// Výber vrstiev počasia ako na Windy (2026-10-08): ukáže sa len pri zapnutej meteo vrstve, pole sa vyberá cez
// správcu vrstiev, klik na pole vypne radar (radar pole nahrádza), prekrytia sa prepínajú, legenda sleduje
// pole alebo radar, na mobile pás predpovede stojí nad pásom vrstiev. Správanie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeDockField, createWeatherDock, dockFieldOrder, legendGradient, radarDockLegend } from './weatherDock.js';
import { meteogramAnchor } from './meteogramPanel.js';

function fakeDoc() {
  const make = (tag) => {
    const n = {
      tag, children: [], className: '', textContent: '', title: '', hidden: false, dataset: {}, style: {}, attrs: {}, listeners: {},
      classList: { set: new Set(), toggle(c, on) { if (on) this.set.add(c); else this.set.delete(c); }, contains(c) { return this.set.has(c); } },
      append(...c) { this.children.push(...c); }, replaceChildren(...c) { this.children = c; },
      setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, fn) { this.listeners[t] = fn; }, remove() {},
      click() { this.listeners.click?.(); },
    };
    return n;
  };
  return { body: make('body'), createElement: make };
}

function fakeManager({ meteo = true, radar = false } = {}) {
  const enabled = new Map([['meteo-gfs', meteo], ['opera-radar', radar], ['shmu-radar', false], ['shmu-warnings', false], ['shmu-stations', false]]);
  let params = { field: 'wind', particles: true };
  const listeners = new Set();
  const calls = [];
  const notify = (layerId) => { for (const fn of listeners) fn({ type: 'visibility', layerId }); };
  return {
    calls,
    layers: { has: (id) => enabled.has(id), get: (id) => (id === 'meteo-gfs' ? { module: { getRowControls: () => ({ legend: [{ color: '#000', label: '0 m/s' }, { color: '#fff', label: '45 m/s' }] }) } } : null) },
    isEnabled: (id) => Boolean(enabled.get(id)),
    setEnabled(id, on) { calls.push(['enabled', id, on]); enabled.set(id, on); notify(id); return Promise.resolve(true); },
    getLayerParams: () => params,
    setLayerParams(id, p) { calls.push(['params', id, p]); params = { ...params, ...p }; for (const fn of listeners) fn({ type: 'params', layerId: id }); return true; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

const tr = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);
const find = (node, pred) => { if (pred(node)) return node; for (const c of node.children || []) { const hit = find(c, pred); if (hit) return hit; } return null; };

test('poradie a aktívne pole: vietor a nárazy spolu, výšková hladina = vietor', () => {
  assert.deepEqual(dockFieldOrder(['wind', 'temp', 'pressure', 'precip', 'clouds', 'gust']), ['wind', 'gust', 'temp', 'pressure', 'precip', 'clouds']);
  assert.equal(activeDockField('wind250'), 'wind');
  assert.equal(activeDockField('temp'), 'temp');
  assert.equal(legendGradient([{ color: '#000' }]), null);
  assert.match(legendGradient([{ color: '#000', label: 'a' }, { color: '#fff', label: 'b' }]).css, /linear-gradient\(90deg, #000 0%, #fff 100%\)/);
  assert.match(radarDockLegend()[0].label, /dBZ$/);
});

test('dock je skrytý bez meteo vrstvy a ukáže sa po jej zapnutí', () => {
  const doc = fakeDoc();
  const m = fakeManager({ meteo: false });
  const dock = createWeatherDock(doc, { dataManager: m, t: tr });
  assert.equal(dock.element.hidden, true);
  m.setEnabled('meteo-gfs', true);
  assert.equal(dock.element.hidden, false);
});

test('klik na pole ide cez správcu; pri zapnutom radare ho najprv vypne (radar pole nahrádza)', () => {
  const doc = fakeDoc();
  const m = fakeManager({ radar: true });
  const dock = createWeatherDock(doc, { dataManager: m, t: tr });
  const temp = find(dock.element, (n) => n.dataset?.field === 'temp');
  const wind = find(dock.element, (n) => n.dataset?.field === 'wind');
  assert.equal(wind.classList.contains('active'), false, 'pri radare nie je aktívne žiadne pole');
  temp.click();
  assert.deepEqual(m.calls[0], ['enabled', 'opera-radar', false]);
  assert.deepEqual(m.calls[1], ['params', 'meteo-gfs', { field: 'temp' }]);
  assert.equal(temp.classList.contains('active'), true);
});

test('prekrytia: radar Európy sa zapne, prúdnice sú parameter meteo vrstvy; legenda sleduje radar', () => {
  const doc = fakeDoc();
  const m = fakeManager();
  const dock = createWeatherDock(doc, { dataManager: m, t: tr });
  const radar = find(dock.element, (n) => n.title === 'dock.radar-eu');
  const particles = find(dock.element, (n) => n.title === 'dock.particles');
  assert.equal(particles.classList.contains('active'), true);
  radar.click();
  assert.deepEqual(m.calls.at(-1), ['enabled', 'opera-radar', true]);
  assert.equal(radar.classList.contains('active'), true);
  const labels = find(dock.element, (n) => n.className === 'weather-dock-legend-labels');
  assert.match(labels.children[0].textContent, /dBZ/);
  particles.click();
  assert.deepEqual(m.calls.at(-1), ['params', 'meteo-gfs', { particles: false }]);
});

test('pás predpovede: na mobile nad vodorovným dockom, inak nad časovou osou', () => {
  const timeline = { id: 'meteo-timeline' };
  const docWith = (rect, hidden = false) => ({ getElementById: (id) => (id === 'weather-dock' ? { hidden, getBoundingClientRect: () => rect } : timeline) });
  assert.equal(meteogramAnchor(docWith({ width: 374, height: 44 })).hidden, false);
  assert.equal(meteogramAnchor(docWith({ width: 136, height: 500 })), timeline);
  assert.equal(meteogramAnchor(docWith({ width: 374, height: 44 }, true)), timeline);
});

test('zbalenie na ikony: uložená voľba má prednosť, inak zbalený na nízkej obrazovke; klik prepne a zapamätá', async () => {
  const { initialCollapsed, DOCK_COLLAPSE_KEY } = await import('./weatherDock.js');
  assert.equal(initialCollapsed(null, 700), true);
  assert.equal(initialCollapsed(null, 900), false);
  assert.equal(initialCollapsed('0', 700), false);
  assert.equal(initialCollapsed('1', 900), true);
  const doc = fakeDoc();
  const store = new Map();
  doc.defaultView = { innerHeight: 900, localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) } };
  const dock = createWeatherDock(doc, { dataManager: fakeManager(), t: tr });
  const toggle = find(dock.element, (n) => n.className === 'weather-dock-toggle');
  assert.equal(dock.element.classList.contains('collapsed'), false);
  toggle.click();
  assert.equal(dock.element.classList.contains('collapsed'), true);
  assert.equal(store.get(DOCK_COLLAPSE_KEY), '1');
  assert.equal(toggle.attrs['aria-expanded'], 'false');
});
