import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVolcanoesLayer, normalizeVolcanoEvents, VOLCANO_FEED_URL } from './volcanoes.js';
const example = { id: 'EONET_1', title: 'Test volcano', closed: null, categories: [{ id: 'volcanoes' }],
  geometry: [{ type: 'Point', coordinates: [18, 48], date: '2026-09-01T00:00:00Z' },
    { type: 'Point', coordinates: [19, 49], date: '2026-09-04T00:00:00Z' }],
  sources: [{ id: 'SIVolcano', url: 'https://volcano.si.edu/' }] };
const reply = events => ({ ok: true, json: async () => ({ events }) });
function harness(fetchImpl) {
  let ds; let time = Date.parse('2026-09-05T00:00:00Z'); const publications = [];
  const layer = createVolcanoesLayer({ fetchImpl, now: () => time, overlayHost: {
    setEntries: (id, entries) => publications.push({ id, entries }), setVisible() {}, clear() {},
  } });
  layer.init({ dataSources: { add: s => { ds = s; }, remove() {} } }); layer.enable();
  return { layer, publications, get ds() { return ds; }, advance: () => { time += 600001; } };
}
test('EONET requests globally open volcanoes, normalizes latest geometry, excludes closed/other events', () => {
  assert.equal(new URL(VOLCANO_FEED_URL).searchParams.get('category'), 'volcanoes');
  const parsed = normalizeVolcanoEvents({ events: [example, { ...example, id: 'closed', closed: '2026-09-04' },
    { ...example, categories: [{ id: 'wildfires' }] }, { ...example, id: 'broken', geometry: [] }] });
  assert.equal(parsed.events.length, 1); assert.equal(parsed.events[0].lon, 19); assert.equal(parsed.rejected, 1);
  assert.equal(parsed.events[0].sources[0].id, 'SIVolcano');
  assert.throws(() => normalizeVolcanoEvents({})); assert.throws(() => normalizeVolcanoEvents({ events: [null] }));
});
test('volcanoes render, cache successful refresh, preserve stale data on failure and recover', async () => {
  let fail = false; let calls = 0;
  const h = harness(async () => { calls++; if (fail) throw new Error('offline'); return reply([example]); });
  assert.equal(await h.layer.update(), true); assert.equal(h.ds.entities.values.length, 1, 'jeden 3D kužeľ na sopku, žiadny dymový billboard');
  assert.equal(await h.layer.update(), true); assert.equal(calls, 1);
  assert.equal(h.publications.at(-1).entries[0].title, 'Test', 'ambientný popis bez slova Volcano');
  h.advance(); fail = true; assert.equal(await h.layer.update(), false);
  assert.equal(h.layer.getStats().stale, true); assert.equal(h.layer.getAnalystRecords()[0].status, 'open');
  assert.equal(await h.layer.update(), false); assert.equal(calls, 2);
  fail = false; h.advance(); assert.equal(await h.layer.update(), true); assert.equal(h.layer.getStats().error, null);
  h.layer.disable(); assert.equal(h.ds.show, false); assert.deepEqual(h.layer.getAnalystRecords(), []); h.layer.destroy();
});
test('disabling while a volcano fetch is pending discards late results', async () => {
  let finish; const h = harness(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.layer.update(); h.layer.disable(); finish(reply([example]));
  assert.equal(await pending, false); assert.equal(h.layer.getStats().count, 0); assert.equal(h.layer.getStats().loading, false); h.layer.destroy();
});
test('a valid empty catalog removes events that were closed upstream', async () => {
  let events = [example]; const h = harness(async () => reply(events));
  await h.layer.update(); h.advance(); events = []; await h.layer.update();
  assert.equal(h.layer.getStats().count, 0); assert.equal(h.ds.entities.values.length, 0); h.layer.destroy();
});
