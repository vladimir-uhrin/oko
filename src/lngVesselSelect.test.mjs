// Riadok LNG tankera v karte Plynu (ui.js onFlyToVessel → selectVesselWhenLoaded).
// 2026-10-16: lode sú predvolene vypnuté, vrstva pri kliknutí štartuje studená
// a tanker do nej príde až po niekoľkých sekundách. Jediný pokus po 6 s zvyčajne
// minul a karta lode sa neotvorila. ui.js sa v Node nedá importovať (DOM pri
// načítaní modulu), preto test vyreže čistú funkciu zo zdroja a spustí ju
// s falošnými hodinami — overuje správanie, nie len tvar kódu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SUBJECT_RESTORE_DEADLINE_MS, SUBJECT_RESTORE_RETRY_MS } from './shareSubject.js';

const uiSource = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');

function helperSource() {
  const start = uiSource.indexOf('async function selectVesselWhenLoaded(');
  assert.ok(start > 0, 'ui.js má selectVesselWhenLoaded');
  const end = uiSource.indexOf('\nexport class StyleManager {', start);
  assert.ok(end > start, 'funkcia je pred StyleManager');
  return uiSource.slice(start, end);
}

/** Falošné hodiny: setTimeout a Date.now pod kontrolou testu. */
function fakeClock() {
  let now = 1_000_000;
  let nextId = 1;
  const timers = new Map();
  return {
    get now() { return now; },
    Date: { now: () => now },
    setTimeout(fn, ms = 0) {
      const id = nextId++;
      timers.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    pending() { return timers.size; },
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        await flush();
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = until;
      await flush();
    },
  };
}

async function flush() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function loadHelper({ clock, store }) {
  // Jediné voľné mená funkcie v ui.js: store, konštanty opakovania, časovač a hodiny.
  return new Function(
    'getContextStore',
    'SUBJECT_RESTORE_RETRY_MS',
    'SUBJECT_RESTORE_DEADLINE_MS',
    'setTimeout',
    'Date',
    `${helperSource()}\nreturn selectVesselWhenLoaded;`,
  )(() => store, SUBJECT_RESTORE_RETRY_MS, SUBJECT_RESTORE_DEADLINE_MS, clock.setTimeout.bind(clock), clock.Date);
}

/** Manažér s vrstvou lodí, ktorá tanker „dotiahne" až v čase readyAt. */
function fakeManager({ clock, readyAt = Infinity, mmsi = '538009999', setEnabled = null }) {
  const calls = { setEnabled: [], selectById: [] };
  const module = {
    selectById(id) {
      calls.selectById.push({ id, at: clock.now });
      return String(id) === mmsi && clock.now >= readyAt;
    },
  };
  const enabledLayers = new Set();
  return {
    calls,
    layers: new Map([['ais-live-vessels', { module }]]),
    setEnabled(layerId, enabled, options) {
      calls.setEnabled.push({ layerId, enabled, options });
      if (enabled) enabledLayers.add(layerId);
      else enabledLayers.delete(layerId);
      return setEnabled ? setEnabled() : Promise.resolve(true);
    },
    isEffectivelyEnabled: (layerId) => enabledLayers.has(layerId),
    /** Používateľ vrstvu vypne (napr. vo VRSTVY). */
    turnOff(layerId) { enabledLayers.delete(layerId); },
  };
}

test('LNG tanker: loď zo studenej vrstvy sa vyberie, aj keď príde až po 6 s', async () => {
  const clock = fakeClock();
  const store = { selectedAt: null };
  const selectVesselWhenLoaded = loadHelper({ clock, store });
  const startedAt = clock.now;
  // Studená vrstva: tanker príde až ~9 s po kliknutí (enable + update + 5 s brána kamery).
  const manager = fakeManager({ clock, readyAt: startedAt + 9_000 });
  let selected = null;
  void selectVesselWhenLoaded({ dataManager: manager, mmsi: '538009999' }).then((value) => { selected = value; });

  await clock.advance(6_500);
  assert.equal(selected, null, 'po 6,5 s sa ešte skúša');
  await clock.advance(5_000);
  assert.equal(selected, true, 'karta tankera sa otvorí, keď ho vrstva dotiahne');
  const successAt = manager.calls.selectById.at(-1).at;
  assert.ok(successAt >= startedAt + 9_000 && successAt <= startedAt + 9_000 + SUBJECT_RESTORE_RETRY_MS);
  assert.equal(clock.pending(), 0, 'po úspechu nezostane žiadny ďalší pokus');
  assert.deepEqual(manager.calls.setEnabled, [
    { layerId: 'ais-live-vessels', enabled: true, options: { origin: 'user' } },
  ], 'lode zapne ako voľbu používateľa');
});

test('LNG tanker: zapnutie lodí sa počká pred prvým pokusom o výber', async () => {
  const clock = fakeClock();
  const store = { selectedAt: null };
  const selectVesselWhenLoaded = loadHelper({ clock, store });
  let finishEnable;
  const manager = fakeManager({
    clock,
    readyAt: clock.now,
    setEnabled: () => new Promise((resolve) => { finishEnable = resolve; }),
  });
  let selected = null;
  void selectVesselWhenLoaded({ dataManager: manager, mmsi: '538009999' }).then((value) => { selected = value; });

  await clock.advance(3_000);
  assert.equal(manager.calls.selectById.length, 0, 'kým sa vrstva zapína, výber sa neskúša');
  finishEnable(true);
  await flush();
  assert.equal(selected, true, 'hneď po zapnutí sa tanker vyberie');
  assert.equal(manager.calls.selectById.length, 1);
});

test('LNG tanker: opakovanie skončí, keď si používateľ medzitým vyberie niečo iné', async () => {
  const clock = fakeClock();
  const store = { selectedAt: null };
  const selectVesselWhenLoaded = loadHelper({ clock, store });
  const startedAt = clock.now;
  const manager = fakeManager({ clock, readyAt: startedAt + 10_000 });
  let selected = null;
  void selectVesselWhenLoaded({ dataManager: manager, mmsi: '538009999' }).then((value) => { selected = value; });

  await clock.advance(4_000);
  const attemptsBefore = manager.calls.selectById.length;
  assert.ok(attemptsBefore >= 2, 'do 4 s sa skúšalo opakovane');
  // Používateľ klikol na iné lietadlo alebo loď.
  store.selectedAt = clock.now;
  await clock.advance(20_000);
  assert.equal(selected, false, 'neskorý pokus neprebije novší výber používateľa');
  assert.equal(manager.calls.selectById.length, attemptsBefore, 'po novom výbere sa už nič neskúša');
  assert.equal(clock.pending(), 0);
});

test('LNG tanker: opakovanie skončí, keď používateľ lode medzitým vypne', async () => {
  const clock = fakeClock();
  const store = { selectedAt: null };
  const selectVesselWhenLoaded = loadHelper({ clock, store });
  const startedAt = clock.now;
  // Vypnutá vrstva si staré záznamy drží — bez kontroly by ju neskorý pokus vybral.
  const manager = fakeManager({ clock, readyAt: startedAt + 6_000 });
  let selected = null;
  void selectVesselWhenLoaded({ dataManager: manager, mmsi: '538009999' }).then((value) => { selected = value; });

  await clock.advance(3_000);
  manager.turnOff('ais-live-vessels');
  const attemptsBefore = manager.calls.selectById.length;
  await clock.advance(20_000);
  assert.equal(selected, false, 'vo vypnutej vrstve sa loď nevyberie');
  assert.equal(manager.calls.selectById.length, attemptsBefore);
  assert.equal(clock.pending(), 0);
});

test('LNG tanker: opakovanie má strop 30 s a potom prestane', async () => {
  const clock = fakeClock();
  const store = { selectedAt: null };
  const selectVesselWhenLoaded = loadHelper({ clock, store });
  const startedAt = clock.now;
  const manager = fakeManager({ clock }); // tanker nikdy nepríde (napr. mimo pokrytia AIS)
  let selected = null;
  void selectVesselWhenLoaded({ dataManager: manager, mmsi: '538009999' }).then((value) => { selected = value; });

  await clock.advance(SUBJECT_RESTORE_DEADLINE_MS + 10_000);
  assert.equal(selected, false);
  assert.equal(clock.pending(), 0, 'žiadny pokus nebeží donekonečna');
  const last = manager.calls.selectById.at(-1).at;
  assert.ok(last - startedAt <= SUBJECT_RESTORE_DEADLINE_MS + SUBJECT_RESTORE_RETRY_MS, 'posledný pokus do 30 s');
  assert.ok(manager.calls.selectById.length >= 20, 'skúša sa každých 1,5 s');
  for (let i = 1; i < manager.calls.selectById.length; i += 1) {
    assert.equal(manager.calls.selectById[i].at - manager.calls.selectById[i - 1].at, SUBJECT_RESTORE_RETRY_MS);
  }
});

test('LNG tanker: riadok karty Plynu používa opakovaný výber, nie jediný pokus po 6 s', () => {
  const start = uiSource.indexOf('onFlyToVessel: ({ mmsi, lat, lon }) => {');
  assert.ok(start > 0, 'onFlyToVessel je v ui.js');
  const handler = uiSource.slice(start, uiSource.indexOf('onEnableAis:', start));
  assert.match(handler, /selectVesselWhenLoaded\(\{\s*dataManager: this\._dataManager,\s*mmsi,/);
  assert.doesNotMatch(handler, /setTimeout\(select, 6000\)/);
  assert.match(handler, /viewer\.camera\.flyTo\(/, 'prelet nad tanker ostáva');
});
