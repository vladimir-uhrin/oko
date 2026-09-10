import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { createMaritimeHistorySession, MARITIME_HISTORY_IDS, focusMaritimeRegion } from './maritimeHistoryPanel.js';

test('Gulf focus refuses cockpit and tracking before mutating the camera', () => {
  let flights = 0;
  const viewer = { camera: { flyTo: () => { flights++; } } };
  assert.throws(() => focusMaritimeRegion(viewer, { classList: { contains: () => true } }));
  viewer.trackedEntity = {};
  assert.throws(() => focusMaritimeRegion(viewer, null));
  assert.equal(flights, 0);
  viewer.trackedEntity = null;
  focusMaritimeRegion(viewer, null);
  assert.equal(flights, 1);
});

function fixture(initial = []) {
  const enabled = new Set(initial);
  const listeners = new Set();
  const calls = [];
  let fail = null;
  const manager = {
    isEnabled: id => enabled.has(id),
    subscribeVisibilityRequests(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async setEnabled(id, value, options = {}) {
      calls.push({ id, value, options });
      for (const fn of listeners) fn({ layerId: id, enabled: value, ...options });
      // Skutočný DataLayerManager pri zlyhaní vrstvy NEVYHODÍ výnimku — chybu
      // zachytí, ohlási ju cez visibility-failed a skončí normálne s nezmeneným
      // stavom. Náhrada, ktorá reject-la, obchádzala vlastné poistky modulu,
      // takže tri z nich neboli testami nikdy vykonané (2026-09-10).
      if (id === fail) return;
      if (value) enabled.add(id); else enabled.delete(id);
    },
  };
  return { manager, enabled, calls, listeners, setFailure: id => { fail = id; } };
}

test('history adds only static context; undo preserves pre-existing layers and live AIS', async () => {
  const f = fixture(['local-ports', 'ais-live-vessels', 'flights']);
  const session = createMaritimeHistorySession(f.manager);
  await session.show();
  assert.ok(MARITIME_HISTORY_IDS.every(id => f.enabled.has(id)));
  assert.equal(f.calls.length, 2);
  await session.restore();
  assert.deepEqual([...f.enabled].sort(), ['ais-live-vessels', 'flights', 'local-ports']);
  assert.equal(session.canRestore, false);
  session.destroy();
  assert.equal(f.listeners.size, 0);
});

test('a later direct user decision supersedes session undo ownership', async () => {
  const f = fixture();
  const session = createMaritimeHistorySession(f.manager);
  await session.show();
  await f.manager.setEnabled('local-ports', true, { origin: 'user' });
  await session.restore();
  assert.deepEqual([...f.enabled], ['local-ports']);
  session.destroy();
});

test('partial enable failure stays undoable and does not leave the controls busy', async () => {
  const f = fixture();
  const session = createMaritimeHistorySession(f.manager);
  f.setFailure('local-ports');
  // Poistka modulu, nie výnimka náhrady: setEnabled dobehne, vrstva ostane vypnutá.
  await assert.rejects(session.show(), /Maritime context unavailable/);
  assert.equal(session.busy, false);
  assert.equal(session.canRestore, true);
  f.setFailure(null);
  await session.restore();
  assert.equal(f.enabled.size, 0);
  session.destroy();
});

test('a layer that refuses to switch off keeps the session undoable and reports it', async () => {
  const f = fixture();
  const session = createMaritimeHistorySession(f.manager);
  await session.show();
  assert.equal(session.canRestore, true);
  f.setFailure('local-shipping-lanes');
  await assert.rejects(session.restore(), /Maritime context restore failed/);
  assert.equal(session.busy, false);
  assert.ok(f.enabled.has('local-shipping-lanes'), 'zlyhaná vrstva ostáva zapnutá');
  assert.equal(session.canRestore, true, 'vlastníctvo sa nezahodí, Undo sa dá zopakovať');
  f.setFailure(null);
  await session.restore();
  assert.equal(f.enabled.size, 0);
  session.destroy();
});

test('an unavailable OSM basemap aborts show before any layer is touched', async () => {
  const f = fixture();
  let active = 'photoreal';
  f.manager.mapStackController = {
    getActiveId: () => active,
    async setStack() { return { activeId: 'photoreal' }; },
  };
  const session = createMaritimeHistorySession(f.manager);
  await assert.rejects(session.show(), /OSM basemap unavailable/);
  assert.equal(f.calls.length, 0, 'žiadna vrstva sa nezapla');
  assert.equal(active, 'photoreal');
  assert.equal(session.busy, false);
  session.destroy();
});

test('undo stays available when show only switched the basemap and adopted no layer', async () => {
  const f = fixture(MARITIME_HISTORY_IDS);
  let active = 'photoreal';
  const stacks = [];
  f.manager.mapStackController = {
    getActiveId: () => active,
    async setStack(id) { stacks.push(id); active = id; return { activeId: id }; },
  };
  const session = createMaritimeHistorySession(f.manager);
  await session.show();
  assert.equal(active, 'osm');
  assert.equal(f.calls.length, 0, 'všetky tri vrstvy už boli zapnuté');
  assert.equal(session.canRestore, true, 'prepnutý podklad je tiež vlastníctvo relácie');
  await session.restore();
  assert.equal(active, 'photoreal');
  assert.deepEqual(stacks, ['osm', 'photoreal']);
  assert.equal(session.canRestore, false);
  assert.deepEqual([...f.enabled].sort(), [...MARITIME_HISTORY_IDS].sort(), 'cudzie vrstvy ostali zapnuté');
  session.destroy();
});

test('repeat show is idempotent; destruction prevents future actions', async () => {
  const f = fixture();
  const session = createMaritimeHistorySession(f.manager);
  await session.show(); await session.show();
  assert.equal(f.calls.length, 3);
  session.destroy(); await session.show(); await session.restore();
  assert.equal(f.calls.length, 3);
});

test('show switches photoreal to OSM for a visible drape and undo restores it', async () => {
  const f = fixture();
  let active = 'photoreal';
  const stacks = [];
  f.manager.mapStackController = {
    getActiveId: () => active,
    async setStack(id) { stacks.push(id); active = id; return { activeId: id }; },
  };
  const session = createMaritimeHistorySession(f.manager);
  await session.show();
  assert.equal(active, 'osm');
  await session.restore();
  assert.equal(active, 'photoreal');
  assert.deepEqual(stacks, ['osm', 'photoreal']);
  session.destroy();
});

test('bundled context actually contains visible density, lanes and ports in the Gulf', async () => {
  const inside = ([lon, lat]) => lon >= 47 && lon <= 60 && lat >= 23 && lat <= 31;
  const readLines = async path => (await readFile(new URL(path, import.meta.url), 'utf8')).trim().split('\n').map(JSON.parse);
  const ports = await readLines('./local_data/ports/ports.geojsonl');
  const lanes = await readLines('./local_data/shipping_lanes/shipping-lanes.geojsonl');
  assert.ok(ports.filter(f => inside(f.geometry.coordinates)).length > 10);
  assert.ok(lanes.some(f => f.geometry.coordinates.some(inside)));
  const meta = JSON.parse(await readFile(new URL('./local_data/ship_density/ship-density.json', import.meta.url), 'utf8'));
  assert.equal(meta.period, '2015-01 to 2021-02');
  const { data, info } = await sharp(await readFile(new URL('./local_data/ship_density/ship-density.png', import.meta.url))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let visible = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const lon = meta.bounds.west + (x + 0.5) / info.width * (meta.bounds.east - meta.bounds.west);
    const lat = meta.bounds.north - (y + 0.5) / info.height * (meta.bounds.north - meta.bounds.south);
    if (inside([lon, lat]) && data[(y * info.width + x) * 4 + 3] > 0) visible++;
  }
  assert.ok(visible > 20, `expected visible Gulf density cells, received ${visible}`);
});
