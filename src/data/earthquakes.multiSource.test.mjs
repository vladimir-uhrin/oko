import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEarthquakesLayer, createEarthquakeDetail } from './earthquakes.js';
import { normalizeEarthquakeFeed } from './earthquakeCatalog.js';

const time = Date.parse('2026-09-05T12:00:00Z');
function feed(source, { id = source, mag = 3, lat = 48, lon = 18, offset = 0 } = {}) {
  return { ...normalizeEarthquakeFeed({ features: [{ id, geometry: { coordinates: [lon, lat, 12] }, properties: { mag, time: time + offset, depth: 12 } }] }, source), fetchedAt: time };
}
function harness(fetchImpl) {
  let dataSource; let publications = [];
  // Vrstva pridáva dva zdroje (ohniská + prstenec citeľného dosahu); testu ide
  // o ohniská, zachyť ten podľa mena.
  const viewer = { dataSources: { add(s) { if (s?.name === 'earthquakes') dataSource = s; }, remove() {} } };
  const layer = createEarthquakesLayer({ now: () => time + 3000, fetchImpl, overlayHost: {
    setEntries(source, entries) { publications.push({ source, entries }); }, setVisible() {}, clearSource() {},
  } });
  layer.init(viewer); layer.enable();
  return { layer, get ds() { return dataSource; }, publications };
}
const response = body => ({ ok: true, json: async () => body });

test('combined source lifecycle filters locally, preserves entity and selection on revisions, and exposes both original solutions', async () => {
  let emscMagnitude = 3.3; let calls = 0;
  const h = harness(async url => { calls++; return response(feed(url.endsWith('emsc') ? 'EMSC' : 'USGS', { mag: url.endsWith('emsc') ? emscMagnitude : 3 })); });
  try {
    assert.equal(await h.layer.update(), true); assert.equal(h.ds.entities.values.length, 1);
    const event = h.layer.getAnalystRecords()[0]; const entity = h.ds.entities.values[0];
    assert.equal(event.sources.length, 2); assert.equal(event.magnitude, 3);
    assert.equal(h.layer.selectById(event.id), true);
    emscMagnitude = 3.4; await h.layer.update();
    assert.equal(h.ds.entities.values[0], entity); assert.equal(h.layer.getSelectedInfo().id, event.id);
    const card = createEarthquakeDetail(h.layer.getSelectedInfo(), {});
    assert.match(card.details.join(' '), /M3\.0/); assert.match(card.details.join(' '), /M3\.4/);
    const oldCalls = calls;
    h.layer.setParams({ minMagnitude: 4.5 }); assert.equal(h.layer.getStats().count, 0); assert.equal(h.layer.getSelectedInfo(), null);
    h.layer.setParams({ minMagnitude: -3 }); assert.equal(h.layer.getStats().count, 1); assert.equal(calls, oldCalls);
    assert.equal(h.layer.setParams({ minMagnitude: null }), false);
  } finally { h.layer.destroy(); }
});

test('one failed catalog leaves the other usable, labels cached source, and restores both after recovery', async () => {
  let fail = false;
  const h = harness(async url => {
    if (fail && url.endsWith('emsc')) throw new Error('offline');
    return response(feed(url.endsWith('emsc') ? 'EMSC' : 'USGS'));
  });
  try {
    await h.layer.update(); fail = true;
    assert.equal(await h.layer.update(), true);
    assert.equal(h.layer.getStats().count, 1); assert.match(h.layer.getStats().error, /EMSC/);
    assert.equal(h.layer.getAnalystRecords()[0].sources.find(s => s.source === 'EMSC').stale, true);
    fail = false; await h.layer.update(); assert.equal(h.layer.getStats().error, null);
  } finally { h.layer.destroy(); }
});

test('late responses after disable or destroy never repopulate the layer', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = harness(async url => { await gate; return response(feed(url.endsWith('emsc') ? 'EMSC' : 'USGS')); });
  const pending = h.layer.update();
  h.layer.destroy(); release();
  assert.equal(await pending, false); assert.equal(h.layer.getStats().count, 0);
  assert.equal(h.publications.length, 0);
});

test('small EMSC-only event appears when lowering the magnitude filter', async () => {
  const h = harness(async url => response(url.endsWith('emsc') ? feed('EMSC', { mag: 1.2 }) : { records: [], fetchedAt: time }));
  try {
    await h.layer.update(); assert.equal(h.layer.getStats().count, 0);
    h.layer.setParams({ minMagnitude: 1 }); assert.equal(h.layer.getStats().count, 1);
    assert.equal(h.layer.getAnalystRecords()[0].sources[0].source, 'EMSC');
  } finally { h.layer.destroy(); }
});

test('superseded slow refresh cannot overwrite a newer catalog', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const h = harness(async url => {
    const slow = calls++ < 2;
    if (slow) await gate;
    return response(feed(url.endsWith('emsc') ? 'EMSC' : 'USGS', { mag: slow ? 3 : 4 }));
  });
  try {
    const old = h.layer.update();
    await h.layer.update();
    assert.equal(h.layer.getAnalystRecords()[0].magnitude, 4);
    release(); assert.equal(await old, false);
    assert.equal(h.layer.getAnalystRecords()[0].magnitude, 4);
  } finally { release(); h.layer.destroy(); }
});
