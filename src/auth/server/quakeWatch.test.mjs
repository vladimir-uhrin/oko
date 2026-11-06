import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createQuakeWatch } from './quakeWatch.js';

const NOW = Date.parse('2026-11-06T12:00:00Z');
const POINTS = [[48.15, 17.11], [48.72, 21.26], [47.79, 18.72], [48.74, 19.15]]; // Bratislava, Košice, Štúrovo, Banská Bystrica
const record = (source, id, mag, lat, lon, minutesAgo) => ({ id: `${source}:${id}`, source, sourceId: id, mag, lat, lon, depth: 10,
  time: NOW - minutesAgo * 60_000, place: `${source} ${id}` });

function setup({ followers = [7, 9] } = {}) {
  const feeds = { usgs: [], emsc: [] };
  const sent = [];
  const fetchImpl = async (url) => ({ ok: true, json: async () => ({ records: url.endsWith('/emsc') ? feeds.emsc : feeds.usgs }) });
  const make = (stateFile, clock) => createQuakeWatch({ store: { quakeFollowers: () => followers },
    send: async (userId, payload) => { sent.push({ userId, ...payload }); return 1; }, port: () => 4175, fetchImpl,
    now: () => clock.t, points: POINTS, stateFile });
  return { feeds, sent, make };
}

test('first pass is only a baseline; a new felt quake goes to every follower once, also after a restart', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oko-quake-watch-'));
  const stateFile = path.join(dir, 'quake-watch.json');
  try {
    const { feeds, sent, make } = setup();
    const clock = { t: NOW };
    feeds.emsc = [record('EMSC', 'old', 3.5, 48.2, 17.2, 20)];
    let watch = make(stateFile, clock);
    assert.deepEqual(await watch.tick(), { baseline: true, events: 1 });
    assert.equal(sent.length, 0, 'baseline never notifies what was already in the catalog');
    feeds.emsc.push(record('EMSC', 'hu', 4.5, 47.5, 19.04, 2));
    const r = await watch.tick();
    assert.equal(r.alerts, 1); assert.deepEqual(sent.map(s => s.userId), [7, 9]);
    assert.match(sent[0].title, /^Zemetrasenie M4,5/);
    // USGS riešenie toho istého otrasu príde neskôr → už nič
    feeds.usgs = [record('USGS', 'us1', 4.6, 47.51, 19.05, 2)];
    assert.equal((await watch.tick()).alerts, 0);
    // reštart služby so stavom na disku
    watch = make(stateFile, clock);
    assert.equal((await watch.tick()).alerts, 0); assert.equal(sent.length, 2);
    // vzdialený silný otras sa nehlási
    feeds.usgs.push(record('USGS', 'jp', 7.4, 35, 142, 1));
    assert.equal((await watch.tick()).alerts, 0);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('without followers the event is still marked, so a later subscriber is not flooded; disabled push skips', async () => {
  const { feeds, sent, make } = setup({ followers: [] });
  const clock = { t: NOW };
  const watch = make(null, clock);
  assert.deepEqual(await watch.tick(), { skipped: true, reason: 'no_data' }, 'no catalog data → no baseline yet');
  feeds.usgs = [record('USGS', 'base', 5.0, -20, -70, 30)];
  assert.equal((await watch.tick()).baseline, true);
  feeds.emsc = [record('EMSC', 'sk', 3.2, 48.7, 19.1, 1)];
  assert.equal((await watch.tick()).alerts, 1); assert.equal(sent.length, 0);
  assert.equal((await watch.tick()).alerts, 0);
  const off = createQuakeWatch({ store: { quakeFollowers: () => [1] }, send: async () => 1, enabled: () => false, port: () => 1 });
  assert.deepEqual(await off.tick(), { skipped: true });
});
