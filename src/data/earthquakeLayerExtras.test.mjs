// Vrstva zemetrasení 2026-11-06: obdobie, Významné, zvýraznenie sekvencie, ShakeMap, platne, čip upozornení,
// kratšia karta výberu. Bez skutočného Cesium Viewera — podvrhy tovární a hostiteľa prekrytia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createEarthquakesLayer, createEarthquakeDetail, wrapDetailLines, EARTHQUAKE_DETAIL_WRAP } from './earthquakes.js';
import { shakemapRectangle, shakemapEventId, createShakemapOverlay } from './earthquakeShakemap.js';
import { splitPlateLines, createPlateBoundaries } from './earthquakePlates.js';
import { PB2002_BOUNDARIES } from './local_data/plates/pb2002Boundaries.js';
import { sequenceMembers, linkEarthquakeSequences } from './earthquakeSequence.js';
import { earthquakeImpactLines, earthquakeSequenceLine, pluralKey, TSUNAMI_INFO_URL } from './earthquakeHoverCard.js';

const NOW = Date.parse('2026-11-06T12:00:00Z');
const feature = (id, mag, lon, lat, minutesAgo, extra = {}) => ({ id, geometry: { coordinates: [lon, lat, 20] },
  properties: { mag, place: id, time: NOW - minutesAgo * 60_000, ...extra } });

function harness({ features = [], fetchLog = [], shakemapCalls = [], plateCalls = [] } = {}) {
  const sources = [];
  const hostCalls = [];
  const viewer = { dataSources: { add(ds) { sources.push(ds); return ds; }, remove() { return true; } } };
  const fetchImpl = async (url) => {
    fetchLog.push(url);
    if (url.includes('emsc')) return { ok: true, json: async () => ({ records: [], fetchedAt: NOW }) };
    return { ok: true, json: async () => ({ features }) };
  };
  const layer = createEarthquakesLayer({ sources: ['USGS', 'EMSC'], now: () => NOW, fetchImpl,
    overlayHost: { setEntries: (...a) => hostCalls.push(['entries', ...a]), setVisible() {}, clearSource: (...a) => hostCalls.push(['clear', ...a]) },
    pulseFactory: () => ({ setEvents() {}, setVisible() {}, setSelected() {}, setFocus: (f) => shakemapCalls.push(['focus', f ? [...f].sort() : null]), hitTest: () => null, destroy() {} }),
    hoverFactory: () => ({ show() {}, hide() {}, destroy() {}, isHovered: () => false }),
    shakemapFactory: (v, { onChange }) => ({ activeId: null,
      show(event) { shakemapCalls.push(['show', event.id]); this.activeId = shakemapEventId(event); onChange(); return Promise.resolve(null); },
      hide() { if (this.activeId) shakemapCalls.push(['hide']); this.activeId = null; }, destroy() {} }),
    platesFactory: () => ({ show: async () => { plateCalls.push('show'); return true; }, hide: () => plateCalls.push('hide'), destroy() {} }),
  });
  layer.init(viewer); layer.enable();
  const discs = () => sources.find(s => s.name === 'earthquakes').entities.values;
  const lastLabels = () => hostCalls.filter(c => c[0] === 'entries' && c[1] === 'earthquakes').at(-1)?.[2] || [];
  const lastDetail = () => hostCalls.filter(c => c[0] === 'entries' && c[1] === 'earthquake-detail').at(-1)?.[2]?.[0] || null;
  return { layer, discs, lastLabels, lastDetail, hostCalls };
}

test('period chip refetches with ?period=, disables chips below the catalog floor and labels the stats', async () => {
  const fetchLog = [];
  const h = harness({ fetchLog, features: [feature('us1', 5, 18, 48, 3 * 24 * 60)] });
  try {
    await h.layer.update();
    assert.equal(h.discs().length, 0, 'a 3-day-old quake is outside 24 h');
    assert.deepEqual(fetchLog.slice(0, 2).sort(), ['/api/earthquakes/emsc', '/api/earthquakes/usgs']);
    assert.equal(h.layer.setParams({ period: 'week' }), true);
    await new Promise(r => setTimeout(r, 0));
    assert.ok(fetchLog.includes('/api/earthquakes/usgs?period=week'));
    await h.layer.update();
    assert.equal(h.discs().length, 1);
    const chips = h.layer.getRowControls().chips;
    assert.equal(chips.find(c => c.id === 'period-week').active, true);
    assert.equal(chips.find(c => c.id === 'mag-1').disabled, true, 'M1+ cannot exist in the 7-day catalog');
    assert.equal(chips.find(c => c.id === 'mag-2.5').active, true);
    assert.match(h.layer.getStats().source, /7 days/);
    assert.equal(h.layer.setParams({ period: 'year' }), false);
    assert.deepEqual(h.layer.getParams(), { minMagnitude: 2.5, pulsar: true, period: 'week', significant: false, plates: false });
  } finally { h.layer.destroy(); }
});

test('period switch during a running refresh is not a failed refresh: the same update returns the new period', async () => {
  const fetchLog = []; let release; const gate = new Promise(r => { release = r; });
  const sources = [];
  const viewer = { dataSources: { add(ds) { sources.push(ds); return ds; }, remove() { return true; } } };
  const layer = createEarthquakesLayer({ sources: ['USGS'], now: () => NOW,
    fetchImpl: async (url) => {
      fetchLog.push(url);
      if (!url.includes('period')) await gate;
      return { ok: true, json: async () => ({ features: [feature(url.includes('week') ? 'old-week' : 'today', 4, 18, 48, url.includes('week') ? 3 * 1440 : 30)] }) };
    },
    overlayHost: { setEntries() {}, setVisible() {}, clearSource() {} },
    pulseFactory: () => ({ setEvents() {}, setVisible() {}, setSelected() {}, setFocus() {}, hitTest: () => null, destroy() {} }),
    hoverFactory: () => ({ show() {}, hide() {}, destroy() {}, isHovered: () => false }),
    shakemapFactory: () => ({ show: async () => null, hide() {}, destroy() {}, activeId: null }),
    platesFactory: () => ({ show: async () => true, hide() {}, destroy() {} }),
  });
  try {
    layer.init(viewer); layer.enable();
    const running = layer.update();             // pravidelná obnova od správcu (24 h)
    layer.setParams({ period: 'week' });          // používateľ prepne počas sťahovania
    assert.deepEqual(fetchLog, ['/api/earthquakes/usgs'], 'no second concurrent request that would cancel the first');
    release();
    assert.equal(await running, true, 'the manager sees a successful refresh, not a rejection');
    assert.deepEqual(fetchLog, ['/api/earthquakes/usgs', '/api/earthquakes/usgs?period=week']);
    assert.deepEqual(layer.getAnalystRecords().map(r => r.id), ['USGS:old-week']);
  } finally { release(); layer.destroy(); }
});

test('significant filter keeps only M6+/PAGER yellow+/ocean/sig 600+', async () => {
  const h = harness({ features: [feature('big', 6.2, 142, 35, 30), feature('yellow', 5.1, 20, 40, 40, { alert: 'yellow' }), feature('small', 4.4, 18, 48, 50)] });
  try {
    await h.layer.update(); assert.equal(h.discs().length, 3);
    h.layer.setParams({ significant: true });
    assert.deepEqual(h.discs().map(d => d.id).sort(), ['earthquake:USGS:big', 'earthquake:USGS:yellow']);
    assert.match(h.layer.getStats().source, /Significant/);
  } finally { h.layer.destroy(); }
});

test('selecting a mainshock shows only its sequence (discs, labels with +time) and dims the other pulsars', async () => {
  const calls = [];
  const h = harness({ shakemapCalls: calls, features: [
    feature('main', 6.1, 142.12, 34.97, 600), feature('after', 4.8, 142.0, 35.1, 466), feature('far', 4.5, 20, 40, 100)] });
  try {
    await h.layer.update();
    assert.equal(h.layer.selectById('USGS:main'), true);
    const shown = h.discs().filter(d => d.show).map(d => d.id).sort();
    assert.deepEqual(shown, ['earthquake:USGS:after', 'earthquake:USGS:main']);
    assert.deepEqual(h.lastLabels().map(l => l.title).sort(), ['M4.8 · +2 h 14 min', 'M6.1']);
    assert.deepEqual(calls.filter(c => c[0] === 'focus').at(-1), ['focus', ['USGS:after', 'USGS:main']]);
    assert.match(h.lastDetail().details.join(' '), /1 aftershock, M4\.8/);
    // výber dotrasu ukáže tú istú sekvenciu
    h.layer.selectById('USGS:after');
    assert.match(h.lastDetail().details.join(' '), /Aftershock of M6\.1 · \+2 h 14 min/);
    // klik do prázdna → všetko späť
    h.layer.selectById('nope');
    h.layer.setParams({ pulsar: true });
    assert.equal(h.discs().every(d => d.show !== false), false, 'selection kept after an invalid id');
  } finally { h.layer.destroy(); }
});

test('a quake with ShakeMap asks for the map on selection and the card says the map replaces the estimate', async () => {
  const calls = [];
  const h = harness({ shakemapCalls: calls, features: [feature('us7000twg9', 6.1, 142.12, 34.97, 30, { types: ',shakemap,', felt: 31, cdi: 4.2, alert: 'green' })] });
  try {
    await h.layer.update();
    h.layer.selectById('USGS:us7000twg9');
    assert.deepEqual(calls.filter(c => c[0] === 'show'), [['show', 'USGS:us7000twg9']]);
    const text = h.lastDetail().details.join(' ');
    assert.match(text, /USGS ShakeMap/); assert.doesNotMatch(text, /estimate from magnitude/);
    assert.match(text, /PAGER: green/); assert.match(text, /Felt by 31 people \(USGS\)/);
    h.layer.disable();
    assert.ok(calls.some(c => c[0] === 'hide'));
  } finally { h.layer.destroy(); }
});

test('plates chip builds the boundaries once and hides them on disable; alerts chip delegates to the control', async () => {
  const plateCalls = [];
  const h = harness({ plateCalls });
  try {
    h.layer.setParams({ plates: true });
    assert.deepEqual(plateCalls, ['show']);
    assert.equal(h.layer.getRowControls().chips.find(c => c.id === 'plates').active, true);
    h.layer.disable(); assert.deepEqual(plateCalls, ['show', 'hide']);
    h.layer.enable(); assert.deepEqual(plateCalls, ['show', 'hide', 'show']);
    let status = 'guest'; let toggles = 0; let listener = null;
    h.layer.setAlertControl({ status: () => status, toggle: async () => { toggles++; status = 'on'; listener?.(); return true; }, subscribe: (fn) => { listener = fn; return () => {}; } });
    let chip = h.layer.getRowControls().chips.find(c => c.id === 'alerts');
    assert.equal(chip.active, false); assert.match(chip.title, /Sign in/);
    h.layer.setParams(chip.params);
    await new Promise(r => setTimeout(r, 0));
    assert.equal(toggles, 1);
    chip = h.layer.getRowControls().chips.find(c => c.id === 'alerts');
    assert.equal(chip.active, true);
    assert.equal('alerts' in h.layer.getParams(), false, 'the alert subscription is account state, not a layer param');
  } finally { h.layer.destroy(); }
});

test('selected card is compact: wrapped to the column, sources side by side, never wider than the wrap', () => {
  const event = { id: 'USGS:x', mag: 6.1, magType: 'mww', depth: 29, time: NOW - 98 * 60_000, place: '144 km SE of Hasaki, Japan',
    alert: 'green', felt: 31, cdi: 4.2, tsunami: true, association: 'probable',
    solutions: [{ source: 'USGS', sourceId: 'x', mag: 6.1 }, { source: 'EMSC', sourceId: 'y', mag: 6.0, stale: true }] };
  const card = createEarthquakeDetail(event, {}, { now: NOW });
  assert.ok(card.details.every(line => line.length <= EARTHQUAKE_DETAIL_WRAP), card.details.join('\n'));
  const text = card.details.join(' ');
  assert.match(text, /M6\.1 mww · depth 29 km/); assert.match(text, /1 h 38 min ago/);
  assert.match(text, /USGS M6\.1 · EMSC M6\.0 \(cached\)/);
  assert.match(text, /Ocean earthquake: check tsunami\.gov/);
  assert.deepEqual(wrapDetailLines(['aaa bbb ccc'], 7), ['aaa bbb', '  ccc']);
});

test('impact lines: tsunami flag is not a warning and links to tsunami.gov; Slovak-style plural keys', () => {
  const [tsunami] = earthquakeImpactLines({ tsunami: true });
  assert.equal(tsunami.url, TSUNAMI_INFO_URL); assert.match(tsunami.text, /not a tsunami warning/);
  assert.equal(pluralKey('x', 1), 'x.one'); assert.equal(pluralKey('x', 3), 'x.few'); assert.equal(pluralKey('x', 5), 'x.many'); assert.equal(pluralKey('x', 0), 'x.many');
  assert.match(earthquakeImpactLines({ felt: 1 })[0].text, /^1 person/);
  assert.match(earthquakeSequenceLine({ role: 'mainshock', aftershocks: 1, strongest: { mag: 4.8 } }), /^1 likely aftershock, M4\.8/);
});

test('sequence members: mainshock and its aftershocks from either end; lone quakes have none', () => {
  const T = NOW;
  const links = linkEarthquakeSequences([
    { id: 'm', mag: 6, lat: 0, lon: 0, time: T }, { id: 'a', mag: 4, lat: 0.2, lon: 0.2, time: T + 60_000 },
    { id: 'b', mag: 3.5, lat: -0.2, lon: 0.1, time: T + 120_000 }, { id: 'x', mag: 5.5, lat: 40, lon: 40, time: T }]);
  assert.deepEqual([...sequenceMembers(links, 'm').members].sort(), ['a', 'b', 'm']);
  assert.equal(sequenceMembers(links, 'b').mainshockId, 'm');
  assert.equal(sequenceMembers(links, 'x'), null);
  assert.equal(sequenceMembers(links, null), null);
});

test('ShakeMap overlay: rectangle guard, USGS id only with ShakeMap, one primitive with legend, removed on hide', async () => {
  assert.equal(shakemapRectangle([1, 2, 3]), null); assert.equal(shakemapRectangle([10, 5, 5, 6]), null);
  assert.equal(shakemapRectangle([0, 0, 90, 10]), null, 'absurdly large');
  assert.ok(shakemapRectangle([140, 36, 142, 37]) instanceof Cesium.Rectangle);
  const quake = { hasShakemap: true, solutions: [{ source: 'EMSC', sourceId: 'e1' }, { source: 'USGS', sourceId: 'us1abc' }] };
  assert.equal(shakemapEventId(quake), 'us1abc');
  assert.equal(shakemapEventId({ ...quake, hasShakemap: false }), null);
  const added = []; const removed = []; const changes = [];
  const parent = { children: [], appendChild(n) { this.children.push(n); } };
  const doc = { createElement: () => ({ style: {}, children: [], hidden: false, setAttribute() {}, appendChild(n) { this.children.push(n); }, remove() {} }) };
  const viewer = { scene: { canvas: { parentElement: parent }, requestRender() {}, primitives: { add: (p) => added.push(p), remove: (p) => removed.push(p) } } };
  const fetchImpl = async (url) => ({ ok: true, json: async () => ({ id: 'us1abc', version: '1', bbox: [140, 36, 142, 37], image: '/api/earthquakes/shakemap/us1abc.png?v=1', url }) });
  const createImage = () => { const img = { decode: async () => {} }; queueMicrotask(() => img.onload?.()); return img; };
  const createPrimitive = ({ rectangle, image }) => ({ rectangle, image });
  const overlay = createShakemapOverlay(viewer, { fetchImpl, document: doc, createImage, createPrimitive, onChange: (m) => changes.push(m?.id ?? null) });
  const meta = await overlay.show(quake);
  assert.equal(meta.id, 'us1abc'); assert.equal(added.length, 1); assert.equal(overlay.activeId, 'us1abc');
  assert.equal(parent.children.length, 1, 'legend added');
  await overlay.show(quake); assert.equal(added.length, 1, 'same quake again does nothing');
  overlay.hide(); assert.equal(removed.length, 1); assert.equal(overlay.activeId, null);
  assert.deepEqual(changes, ['us1abc', null]);
  const bad = createShakemapOverlay(viewer, { fetchImpl: async () => ({ ok: true, json: async () => ({ bbox: [1, 2, 3, 4], image: 'https://evil.example/x.png' }) }), document: doc, createImage, createPrimitive });
  assert.equal(await bad.show(quake), null, 'foreign image URL refused');
});

test('plate boundaries: bundled PB2002 has 241 lines (65 subduction); built once lazily, then only show flips', async () => {
  const groups = splitPlateLines(PB2002_BOUNDARIES);
  assert.equal(groups.subduction.length + groups.other.length, 241);
  assert.equal(groups.subduction.length, 65);
  assert.ok(PB2002_BOUNDARIES.every(l => l.c.length >= 4 && l.c.every(Number.isFinite)));
  let loads = 0; const made = []; const added = [];
  const viewer = { scene: { requestRender() {}, groundPrimitives: { add: (p) => added.push(p), remove() {} } } };
  const plates = createPlateBoundaries(viewer, { load: async () => { loads++; return PB2002_BOUNDARIES; },
    createPrimitive: ({ flats, style }) => { const p = { flats: flats.length, width: style.width, show: true }; made.push(p); return p; } });
  assert.equal(await plates.show(), true);
  assert.equal(loads, 1); assert.equal(added.length, 2);
  assert.ok(made.find(p => p.flats === 65).width > made.find(p => p.flats === 176).width, 'subduction zones are thicker');
  plates.hide(); assert.ok(made.every(p => p.show === false));
  await plates.show(); assert.equal(loads, 1, 'data loaded once'); assert.ok(made.every(p => p.show === true));
});
