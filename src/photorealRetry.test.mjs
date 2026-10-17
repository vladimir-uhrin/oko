// src/photorealRetry.test.mjs — Google 3D po minútovom limite (2026-10-17, vlastník: „Google 3D: po 429
// opakovať pokus, nie OSM na celú reláciu").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PHOTOREAL_FALLBACK_STACK,
  PHOTOREAL_RETRY_DELAYS_MS,
  PHOTOREAL_RETRY_JITTER,
  photorealRetryDelayMs,
  retryClockLabel,
  schedulePhotorealRetry,
  shouldReturnToPhotoreal,
} from './photorealRetry.js';
import { createPhotorealTileset } from './photorealTileset.js';
import { EN_STRINGS, SK_STRINGS } from './i18nStrings.js';

// Telo skutočnej odpovede Google (2026-10-16), číslo projektu vymenené.
const RATE_BODY = JSON.stringify({ error: { code: 429, message: "Quota exceeded for quota metric '3D Tiles root requests' and limit '3D Tiles root requests per minute' of service 'tile.googleapis.com' for consumer 'project_number:000'.", status: 'RESOURCE_EXHAUSTED' } });
const EEA = 'Your request cannot be served because satellite tiles and 3D tiles are not available for your account and region. Learn more here: https://developers.google.com/maps/comms/eea/map-tiles.';
/** Cesium hlási chybu koreňa ako RequestErrorEvent { statusCode, response }. */
const rate429 = () => ({ statusCode: 429, response: RATE_BODY });
const eea403 = () => ({ statusCode: 403, response: EEA });
const bothFailed = (googleError, ionError) => Object.assign(new Error('both failed'), { googleError, ionError });

/** Falošný časovač: naplánované volania sa spúšťajú ručne, odstupy sa zapisujú. */
function fakeTimers() {
  const pending = new Map();
  const delays = [];
  let nextId = 1;
  return {
    delays,
    setTimer: (fn, ms) => { const id = nextId++; pending.set(id, fn); delays.push(ms); return id; },
    clearTimer: (id) => { pending.delete(id); },
    get size() { return pending.size; },
    async fire() {
      const [id, fn] = [...pending.entries()][0];
      pending.delete(id);
      await fn();
    },
  };
}

test('odstupy: ~65/130/260 s, rozptyl ±15 %, za tretím pokusom koniec; prvý až po minútovom okne', () => {
  const mid = { random: () => 0.5 };
  assert.deepEqual([0, 1, 2].map((i) => photorealRetryDelayMs(i, mid)), [65_000, 130_000, 260_000]);
  assert.equal(photorealRetryDelayMs(3, mid), null);
  assert.equal(photorealRetryDelayMs(-1, mid), null);
  assert.equal(photorealRetryDelayMs(1.5, mid), null);
  assert.equal(PHOTOREAL_RETRY_JITTER, 0.15);
  assert.equal(photorealRetryDelayMs(0, { random: () => 0 }), Math.round(65_000 * 0.85));
  assert.equal(photorealRetryDelayMs(0, { random: () => 1 }), Math.round(65_000 * 1.15));
  assert.equal(photorealRetryDelayMs(0, { random: () => Number.NaN }), 65_000);
  assert.ok(PHOTOREAL_RETRY_DELAYS_MS[0] * (1 - PHOTOREAL_RETRY_JITTER) > 55_000, 'ani s rozptylom nie skôr než ~minúta');
  assert.equal(PHOTOREAL_RETRY_DELAYS_MS.length, 3, 'obmedzený počet pokusov, nikdy slučka');
});

test('čas pokusu do tooltipu je HH:MM miestneho času', () => {
  const now = new Date(2026, 9, 17, 21, 42, 50).getTime();
  assert.equal(retryClockLabel(now, 65_000), '21:43');
  assert.equal(retryClockLabel(new Date(2026, 9, 17, 9, 5, 0).getTime(), 0), '09:05');
  assert.equal(retryClockLabel(now, -5), '21:42', 'záporný odstup = teraz');
});

test('návrat na Google 3D len zo záložného podkladu a len keď nikto podklad neprepol', () => {
  assert.equal(PHOTOREAL_FALLBACK_STACK, 'osm');
  assert.equal(shouldReturnToPhotoreal({ activeId: 'osm', switchGeneration: 1, fallbackGeneration: 1 }), true);
  assert.equal(shouldReturnToPhotoreal({ activeId: 'osm', switchGeneration: 2, fallbackGeneration: 1 }), false, 'niekto prepínal (aj späť na OSM)');
  assert.equal(shouldReturnToPhotoreal({ activeId: 'stadia-dark', switchGeneration: 1, fallbackGeneration: 1 }), false);
  assert.equal(shouldReturnToPhotoreal({ activeId: 'osm', switchGeneration: undefined, fallbackGeneration: undefined }), false);
  assert.equal(shouldReturnToPhotoreal(), false);
});

test('EHP 403 + ion 429: pokus len cez ion, úspech na druhý pokus — jedno prevzatie, odstupy podľa plánu', async () => {
  const timers = fakeTimers();
  const loads = [];
  const waits = [];
  const successes = [];
  let gaveUp = false;
  const first = bothFailed(eea403(), rate429());
  const handle = schedulePhotorealRetry({
    failure: first,
    load: async (paths, last) => {
      loads.push({ paths, last });
      if (loads.length === 1) throw bothFailed(eea403(), rate429());
      return { tileset: { id: 'late' }, source: 'ion' };
    },
    onWait: (info) => waits.push(info),
    onSuccess: (result, attempts) => successes.push({ result, attempts }),
    onGiveUp: () => { gaveUp = true; },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    random: () => 0.5,
  });
  assert.ok(handle);
  assert.equal(handle.state, 'waiting');
  assert.deepEqual(timers.delays, [65_000], 'nič hneď — prvý pokus až o ~minútu');
  assert.deepEqual(waits[0], { attempt: 1, delayMs: 65_000, paths: { google: false, ion: true } });
  assert.equal(loads.length, 0);

  await timers.fire();
  assert.equal(loads.length, 1);
  assert.deepEqual(loads[0].paths, { google: false, ion: true }, 'EHP Google sa neopakuje');
  assert.equal(loads[0].last, first, 'pokus dostane predchádzajúcu chybu (nesie dôvod EHP)');
  assert.deepEqual(timers.delays, [65_000, 130_000]);
  assert.equal(waits[1].attempt, 2);

  await timers.fire();
  assert.equal(successes.length, 1);
  assert.equal(successes[0].result.tileset.id, 'late');
  assert.equal(successes[0].attempts, 2);
  assert.equal(handle.state, 'done');
  assert.equal(handle.attempts, 2);
  assert.equal(timers.size, 0, 'po úspechu nič nečaká');
  assert.equal(gaveUp, false);
});

test('stále 429: po troch pokusoch koniec s poslednou chybou, žiadny ďalší časovač ani požiadavka', async () => {
  const timers = fakeTimers();
  let loads = 0;
  let gaveUp = null;
  const handle = schedulePhotorealRetry({
    failure: bothFailed(eea403(), rate429()),
    load: async () => { loads += 1; throw bothFailed(eea403(), rate429()); },
    onSuccess: () => assert.fail('nemá prísť'),
    onGiveUp: (error, attempts) => { gaveUp = { error, attempts }; },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    random: () => 0.5,
  });
  await timers.fire();
  await timers.fire();
  await timers.fire();
  assert.equal(loads, 3);
  assert.deepEqual(timers.delays, [65_000, 130_000, 260_000]);
  assert.equal(timers.size, 0);
  assert.equal(handle.state, 'gave-up');
  assert.equal(gaveUp.attempts, 3);
  assert.equal(gaveUp.error.ionError.statusCode, 429);
});

test('iná chyba pri pokuse (sieť, zlý token) = koniec hneď, bez ďalšieho pokusu', async () => {
  const timers = fakeTimers();
  let gaveUp = null;
  const handle = schedulePhotorealRetry({
    failure: bothFailed(eea403(), rate429()),
    load: async () => { throw bothFailed(eea403(), { statusCode: 401 }); },
    onSuccess: () => assert.fail('nemá prísť'),
    onGiveUp: (error, attempts) => { gaveUp = { error, attempts }; },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    random: () => 0.5,
  });
  await timers.fire();
  assert.equal(handle.state, 'gave-up');
  assert.equal(gaveUp.attempts, 1);
  assert.equal(gaveUp.error.ionError.statusCode, 401);
  assert.equal(timers.size, 0);
});

test('bez minútového limitu sa nič neplánuje: EHP 403, zlý token, denný limit, QA/crawler výnimka', () => {
  const timers = fakeTimers();
  const plan = (failure) => schedulePhotorealRetry({ failure, load: async () => ({}), onSuccess: () => {}, setTimer: timers.setTimer });
  assert.equal(plan(bothFailed(eea403(), { statusCode: 401 })), null);
  assert.equal(plan(bothFailed(eea403(), null)), null, 'bez ion tokenu');
  const perDay = { statusCode: 429, response: RATE_BODY.replace('per minute', 'per day') };
  assert.equal(plan(bothFailed(eea403(), perDay)), null, 'denný limit sa do polnoci neuvoľní');
  assert.equal(plan(new Error('qaBasemap=osm — Google tileset skipped to protect the daily root-request quota')), null);
  assert.equal(plan(null), null);
  assert.equal(timers.delays.length, 0);
});

test('cancel: zruší čakanie; zrušenie počas načítania tileset uvoľní a neprevezme', async () => {
  const timers = fakeTimers();
  const waiting = schedulePhotorealRetry({
    failure: bothFailed(eea403(), rate429()),
    load: async () => assert.fail('nemá sa volať'),
    onSuccess: () => assert.fail('nemá prísť'),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  waiting.cancel();
  assert.equal(timers.size, 0);
  assert.equal(waiting.state, 'cancelled');

  const timers2 = fakeTimers();
  let destroyed = false;
  let release;
  const loading = schedulePhotorealRetry({
    failure: bothFailed(eea403(), rate429()),
    load: () => new Promise((resolve) => { release = () => resolve({ tileset: { destroy: () => { destroyed = true; } }, source: 'ion' }); }),
    onSuccess: () => assert.fail('nemá prísť'),
    setTimer: timers2.setTimer,
    clearTimer: timers2.clearTimer,
  });
  const fired = timers2.fire();
  loading.cancel();
  release();
  await fired;
  assert.equal(destroyed, true);
  assert.equal(loading.state, 'cancelled');
});

test('pokus cez createPhotorealTileset: EHP Google sa znova nevolá, jeho dôvod sa nesie, ion vráti tileset', async () => {
  const timers = fakeTimers();
  let googleCalls = 0;
  let ionCalls = 0;
  let adopted = null;
  const deps = {
    createGoogle: async () => { googleCalls += 1; throw eea403(); },
    fromIonAssetId: async () => { ionCalls += 1; return { id: 'ion-late' }; },
  };
  let first;
  try {
    await createPhotorealTileset({ hasGoogleKey: true, hasIonToken: true, ...deps, fromIonAssetId: async () => { ionCalls += 1; throw rate429(); } });
  } catch (error) { first = error; }
  assert.equal(googleCalls, 1);
  assert.equal(ionCalls, 1);
  schedulePhotorealRetry({
    failure: first,
    load: (paths, last) => createPhotorealTileset({
      hasGoogleKey: true,
      hasIonToken: paths.ion,
      priorGoogleError: paths.google ? null : (last?.googleError ?? null),
      ...deps,
    }),
    onSuccess: (result) => { adopted = result; },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  await timers.fire();
  assert.equal(googleCalls, 1, 'EHP 403 sa neopakuje — žiadna ďalšia požiadavka na koreň s naším kľúčom');
  assert.equal(ionCalls, 2);
  assert.equal(adopted.source, 'ion');
  assert.equal(adopted.tileset.id, 'ion-late');
  assert.equal(adopted.regionBlocked, true, 'dôvod EHP ostáva pravdivý');
});

test('texty: oba jazyky majú hlášky pre limit, návrat, dostupnosť a koniec; čas pokusu ako {time}', () => {
  const keys = ['loader.google-tiles-busy', 'mapstack.photoreal-busy', 'mapstack.photoreal-busy-gave-up', 'mapstack.photoreal-busy-toast', 'mapstack.photoreal-back', 'mapstack.photoreal-available', 'mapstack.photoreal-gave-up-toast'];
  for (const key of keys) {
    assert.equal(typeof EN_STRINGS[key], 'string', `EN ${key}`);
    assert.equal(typeof SK_STRINGS[key], 'string', `SK ${key}`);
  }
  assert.match(SK_STRINGS['mapstack.photoreal-busy'], /\{time\}/);
  assert.match(EN_STRINGS['mapstack.photoreal-busy'], /\{time\}/);
  assert.match(SK_STRINGS['mapstack.photoreal-busy-gave-up'], /\{attempts\}/);
});

test('zapojenie: main.js plánuje pokusy len pri minútovom limite, prevezme tileset celý a vráti Google 3D cestou UI', () => {
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /import \{ PHOTOREAL_FALLBACK_STACK, PHOTOREAL_RETRY_DELAYS_MS, retryClockLabel, schedulePhotorealRetry, shouldReturnToPhotoreal \} from '\.\/photorealRetry\.js';/);
  assert.match(main, /photorealRetryFailure = photorealRetryPaths\(tileError\) \? tileError : null;/);
  assert.match(main, /const fallbackSwitchGeneration = mapStackController\.getSwitchGeneration\(\);/);
  assert.ok(main.indexOf("await mapStackController.setStack(tileset ? 'photoreal' : 'osm', { silent: true });") < main.indexOf('const fallbackSwitchGeneration'), 'generácia až po záložnom štarte');
  assert.match(main, /if \(photorealRetryFailure\) \{/);
  assert.match(main, /schedulePhotorealRetry\(\{\n\s+failure: photorealRetryFailure,/);
  assert.match(main, /hasIonToken: !!cesiumToken && paths\.ion,\n\s+priorGoogleError: paths\.google \? null : \(last\?\.googleError \?\? null\),\n\s+tilesetOptions: photorealTilesetOptions\(\{ lowMemory \}\),/);
  assert.match(main, /viewer\.scene\.primitives\.add\(late, 0\);/);
  assert.match(main, /mapStackController\.setPhotorealTileset\(late, \{ source \}\);/);
  assert.match(main, /farGlobe\.destroy\?\.\(\);\n\s+farGlobe = installFar\(late\);/);
  assert.match(main, /window\.__godsEyeView\.tileset = late;/);
  assert.match(main, /fallbackGeneration: fallbackSwitchGeneration,/);
  assert.match(main, /styleManager\._setMapStack\('photoreal'\)/, 'cez UI: čipy, štítok aj odkaz sa zosúladia');
  assert.ok(main.indexOf('if (photorealRetryFailure) {') > main.indexOf('window.__godsEyeView = {'), 'plánuje sa, keď už je UI');
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  const start = ui.indexOf('  refreshMapStackChips() {');
  assert.ok(start > 0, 'StyleManager.refreshMapStackChips');
  const body = ui.slice(start, ui.indexOf('\n  }', start));
  assert.match(body, /renderMapStackChips\(this\._mapStackChips, stacks, \{ activeId, onSelect \}\);/);
  assert.doesNotMatch(body, /_renderMapStackState|_applyStackPostProcess/, 'post-process podkladu sa pri prekreslení čipov nemení');
});
