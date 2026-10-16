// Mobil (2026-10-15): menšia cache dlaždíc Google 3D a obnova po strate grafického kontextu.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_RELOAD_MAX, AUTO_RELOAD_WINDOW_MS, CONTEXT_LOSS_STORAGE_KEY, installContextLossRecovery, shouldAutoReload,
} from './contextLossRecovery.js';
import {
  PHOTOREAL_LOW_MEMORY_OPTIONS, PHOTOREAL_TILESET_OPTIONS, createPhotorealTileset, isLowMemoryDevice, photorealTilesetOptions,
} from './photorealTileset.js';
import { EN_STRINGS, SK_STRINGS } from './i18nStrings.js';

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
  const notes = [];
  installContextLossRecovery(canvas, {
    storage: { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } },
    setTimeoutImpl: (fn) => timers.push(fn),
    notify: (text, opts) => notes.push([text, Boolean(opts?.action)]),
  });
  canvas.fire('webglcontextlost');
  assert.equal(timers.length, 0, 'počítadlo sa nedá uložiť — sama sa neobnoví');
  assert.deepEqual(notes, [['context.lost-manual-first', true]], 'hláška s tlačidlom, bez „opäť"');
});

// 2026-10-16: bez trvalého počítadla ide už PRVÁ strata do vetvy s tlačidlom — text „opäť resetoval"
// tam klamal. „Opäť" len pri známej predošlej strate (úložisko alebo to isté načítanie stránky).
test('prvá strata bez úložiska nehovorí „opäť"; druhá v tom istom načítaní a známa predošlá áno', () => {
  const canvas = fakeCanvas();
  const notes = [];
  installContextLossRecovery(canvas, {
    storage: null, setTimeoutImpl: () => assert.fail('bez úložiska sa sama neobnovuje'),
    notify: (text) => notes.push(text),
  });
  canvas.fire('webglcontextlost');
  canvas.fire('webglcontextlost');
  assert.deepEqual(notes, ['context.lost-manual-first', 'context.lost-manual']);

  // Úložisko sa dá čítať (predošlá strata pred 1 min), ale zápis zlyhá (plné úložisko) → „opäť" platí.
  const now = 5_000_000;
  const seen = [];
  const other = fakeCanvas();
  installContextLossRecovery(other, {
    storage: { getItem: () => JSON.stringify([now - 60_000]), setItem() { throw new Error('QuotaExceededError'); } },
    now: () => now, setTimeoutImpl: () => assert.fail('zápis zlyhal — sama sa neobnovuje'),
    notify: (text) => seen.push(text),
  });
  other.fire('webglcontextlost');
  assert.deepEqual(seen, ['context.lost-manual']);
});

test('texty straty kontextu: neutrálny kľúč v EN aj SK, bez „again"/„opäť"', () => {
  for (const [lang, table] of [['en', EN_STRINGS], ['sk', SK_STRINGS]]) {
    const first = table['context.lost-manual-first'];
    assert.equal(typeof first, 'string', `${lang}: chýba context.lost-manual-first`);
    assert.doesNotMatch(first, /\bagain\b|opäť/i, `${lang}: prvá strata nesmie hovoriť „opäť"`);
    assert.match(table['context.lost-manual'], /\bagain\b|opäť/i, `${lang}: opakovaná strata ostáva „opäť"`);
  }
});

// 2026-10-15: bez sessionStorage (zakázané údaje stránok, rámček s nepriehľadným pôvodom) sa počítadlo
// pri obnovení stratilo a telefón, ktorý stále stráca kontext, sa obnovoval donekonečna.
test('bez trvalého počítadla: 10 načítaní stránky = 0 automatických obnovení, vždy hláška s tlačidlom', () => {
  const swallowing = () => ({ getItem: () => null, setItem() { /* zápis sa ticho zahodí */ } });
  const variants = {
    'bez úložiska': () => null,
    'zápis hádže': () => ({ getItem: () => null, setItem() { throw new Error('QuotaExceededError'); } }),
    'zápis sa nezapamätá': swallowing,
  };
  for (const [name, makeStorage] of Object.entries(variants)) {
    let now = 1_000_000;
    let reloads = 0;
    let manual = 0;
    for (let load = 0; load < 10; load += 1) {
      // Každé načítanie stránky = nová inštalácia, úložisko sa (ne)prenáša ako v prehliadači.
      const canvas = fakeCanvas();
      const timers = [];
      installContextLossRecovery(canvas, {
        storage: makeStorage(), now: () => now, reload: () => { reloads += 1; },
        notify: (text, opts) => { if (opts?.action) manual += 1; },
        setTimeoutImpl: (fn) => timers.push(fn),
      });
      now += 20_000;
      canvas.fire('webglcontextlost');
      while (timers.length) timers.shift()();
    }
    assert.equal(reloads, 0, `${name}: žiadna slučka obnovovania`);
    assert.equal(manual, 10, `${name}: návštevník má vždy tlačidlo`);
  }
});

test('funkčné sessionStorage cez obnovenia stránky: strop 2 automatické obnovenia za 10 min platí', () => {
  const session = memory(); // prežije obnovenie stránky v tej istej karte
  let now = 1_000_000;
  let reloads = 0;
  let manual = 0;
  for (let load = 0; load < 10; load += 1) {
    const canvas = fakeCanvas();
    const timers = [];
    installContextLossRecovery(canvas, {
      storage: session, now: () => now, reload: () => { reloads += 1; },
      notify: (text, opts) => { if (opts?.action) manual += 1; },
      setTimeoutImpl: (fn) => timers.push(fn),
    });
    now += 20_000;
    canvas.fire('webglcontextlost');
    while (timers.length) timers.shift()();
  }
  assert.equal(reloads, AUTO_RELOAD_MAX, '10 načítaní za 200 s — sama len 2×');
  assert.equal(manual, 10 - AUTO_RELOAD_MAX, 'potom už hláška s tlačidlom');
});
