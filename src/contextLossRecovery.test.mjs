// Mobil (2026-10-15): menšia cache dlaždíc Google 3D a obnova po strate grafického kontextu.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_RELOAD_MAX, AUTO_RELOAD_WINDOW_MS, CONTEXT_LOSS_STORAGE_KEY, installContextLossRecovery, shouldAutoReload,
} from './contextLossRecovery.js';
import {
  PHOTOREAL_LOW_MEMORY_OPTIONS, PHOTOREAL_TILESET_OPTIONS, createPhotorealTileset, isLowMemoryDevice, photorealTilesetOptions,
} from './photorealTileset.js';

test('telefón/tablet alebo ≤ 4 GB pamäte = malá cache; počítač ostáva', () => {
  assert.equal(isLowMemoryDevice({ coarse: true }), true);
  assert.equal(isLowMemoryDevice({ coarse: false, deviceMemory: 4 }), true);
  assert.equal(isLowMemoryDevice({ coarse: false, deviceMemory: 8 }), false);
  assert.equal(isLowMemoryDevice({ coarse: false }), false, 'Safari na počítači pamäť nehlási');
  const low = photorealTilesetOptions({ lowMemory: true });
  assert.equal(low.cacheBytes, 256 * 1024 * 1024);
  assert.equal(low.maximumCacheOverflowBytes, 128 * 1024 * 1024);
  assert.equal(low.dynamicScreenSpaceError, false, 'ostatné nastavenia ostávajú');
  assert.deepEqual(photorealTilesetOptions({ lowMemory: false }), { ...PHOTOREAL_TILESET_OPTIONS });
  assert.ok(PHOTOREAL_LOW_MEMORY_OPTIONS.cacheBytes < PHOTOREAL_TILESET_OPTIONS.cacheBytes / 4);
});

test('nastavenie sa dostane do Google aj ion cesty', async () => {
  const seen = [];
  await createPhotorealTileset({
    hasGoogleKey: true,
    hasIonToken: true,
    createGoogle: async () => { throw new Error('not available for your account and region'); },
    fromIonAssetId: async (id, opts) => { seen.push(opts); return {}; },
    tilesetOptions: photorealTilesetOptions({ lowMemory: true }),
  });
  assert.equal(seen[0].cacheBytes, PHOTOREAL_LOW_MEMORY_OPTIONS.cacheBytes);
});

function fakeCanvas() {
  const handlers = {};
  return { addEventListener: (n, fn) => { handlers[n] = fn; }, removeEventListener: (n) => { delete handlers[n]; }, fire: (n) => handlers[n]?.({ preventDefault() { this.prevented = true; } }), handlers };
}
function memory() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m };
}

test('strata kontextu: sama obnoví stránku najviac 2× za 10 min, potom hláška s tlačidlom', () => {
  let now = 1_000_000;
  const storage = memory();
  const reloads = [];
  const notes = [];
  const timers = [];
  const canvas = fakeCanvas();
  installContextLossRecovery(canvas, {
    storage, now: () => now, reload: () => reloads.push(now),
    notify: (text, opts) => notes.push([text, Boolean(opts?.action)]),
    setTimeoutImpl: (fn) => timers.push(fn),
  });
  for (let i = 0; i < AUTO_RELOAD_MAX; i += 1) {
    canvas.fire('webglcontextlost');
    timers.shift()();
    now += 60_000;
  }
  assert.equal(reloads.length, AUTO_RELOAD_MAX);
  canvas.fire('webglcontextlost');
  assert.equal(timers.length, 0, 'tretia strata v okne už neobnovuje sama');
  assert.deepEqual(notes.at(-1), ['context.lost-manual', true]);
  assert.equal(JSON.parse(storage.m.get(CONTEXT_LOSS_STORAGE_KEY)).length, AUTO_RELOAD_MAX);
  now += AUTO_RELOAD_WINDOW_MS;
  canvas.fire('webglcontextlost');
  assert.equal(timers.length, 1, 'po 10 min znova sama');
});

test('pravidlo počítadla a nedostupné úložisko', () => {
  assert.equal(shouldAutoReload([], 0), true);
  assert.equal(shouldAutoReload([100, 200], 300), false);
  assert.equal(shouldAutoReload([100, 200], 100 + AUTO_RELOAD_WINDOW_MS + 1), true);
  const canvas = fakeCanvas();
  const timers = [];
  installContextLossRecovery(canvas, { storage: { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } }, setTimeoutImpl: (fn) => timers.push(fn) });
  canvas.fire('webglcontextlost');
  assert.equal(timers.length, 1);
});
