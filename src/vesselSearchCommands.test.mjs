// src/vesselSearchCommands.test.mjs — lode v jednotnom hľadaní (2026-10-11, bod 3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVesselSearchCommands, looksLikeVesselQuery } from './vesselSearchCommands.js';
import { parseMtGeneral, parseMtSearchResults } from './data/vesselTrackSources.js';

test('kedy sa pýtať servera: meno ≥ 3 písmená alebo MMSI/IMO', () => {
  assert.equal(looksLikeVesselQuery('minerva'), true);
  assert.equal(looksLikeVesselQuery('9410909'), true, 'IMO');
  assert.equal(looksLikeVesselQuery('241190000'), true, 'MMSI');
  assert.equal(looksLikeVesselQuery('ab'), false);
  assert.equal(looksLikeVesselQuery('12345'), false);
});

test('parsovanie hľadania: meno vs číslo, typ a vlajka z popisu; identita z general', () => {
  // Skutočné odpovede (2026-10-11).
  assert.deepEqual(parseMtSearchResults([
    { id: '328023', type: 'Vessel', value: 'TURIEC', desc: 'Inland, Pushtow, two cargo barges [SK]' },
    { id: '1', type: 'Port', value: 'X', desc: 'Y' },
  ]), [{ shipId: '328023', name: 'TURIEC', typeText: 'Inland, Pushtow, two cargo barges', flagIso2: 'sk', currentName: null, dead: false }]);
  assert.deepEqual(parseMtSearchResults([{ id: '214707', type: 'Vessel', value: '9410909', desc: 'MINERVA ZEN [GR]' }]),
    [{ shipId: '214707', name: 'MINERVA ZEN', typeText: null, flagIso2: 'gr', currentName: null, dead: false }]);
  // Bývalé meno inej lode (skutočný výsledok „minerva zen").
  assert.deepEqual(parseMtSearchResults([{ id: '285427', type: 'Vessel', value: 'MINERVA ZEN', desc: 'OCEAN JEWEL [PA] (Current Name)' }]),
    [{ shipId: '285427', name: 'MINERVA ZEN', typeText: null, flagIso2: 'pa', currentName: 'OCEAN JEWEL', dead: false }]);
  assert.deepEqual(parseMtGeneral({ mmsi: 267168000, imo: null, name: 'TURIEC', subtype: 'Inland, Pushtow', countryCode: 'SK' }),
    { mmsi: '267168000', imo: null, name: 'TURIEC', typeText: 'Inland, Pushtow', flagIso2: 'sk' });
});

test('výsledky: loď v pamäti sa vyberie; zo servera — známa vo vrstve sa vyberie, inak let na poslednú polohu', async () => {
  const selected = [];
  const live = {
    searchVessels: (q) => (q.toUpperCase().includes('GCL') ? [{ mmsi: '355806000', name: 'GCL GREECE', score: 70 }] : []),
    selectByMmsi: (m) => { selected.push(['live', m]); return m === '355806000'; },
  };
  const gfw = { selectContact: (m) => { selected.push(['gfw', m]); return false; } };
  const remote = [];
  const notes = [];
  const fetchImpl = async (url) => {
    if (url.startsWith('/api/vessel-info/search')) return { ok: true, json: async () => ({ results: [{ shipId: '214707', name: 'MINERVA ZEN', typeText: 'Oil/Chemical Tanker', flagIso2: 'gr' }] }) };
    if (url.startsWith('/api/vessel-info/ship')) return { ok: true, json: async () => ({ shipId: '214707', mmsi: '241190000', name: 'MINERVA ZEN', position: { lat: 34.13, lon: -68.88, t: Date.parse('2026-10-10T02:57:38Z') } }) };
    return { ok: false };
  };
  const cmds = createVesselSearchCommands({ live, delayed: [gfw], fetchImpl, translate: (k, v) => `${k} ${JSON.stringify(v || {})}`, notify: (n) => notes.push(n), onRemoteShip: (s) => remote.push(s) });
  const local = cmds.queryCommands('gcl');
  assert.equal(local.length, 1);
  assert.equal(local[0].group, 'vessels');
  local[0].run();
  assert.deepEqual(selected.at(-1), ['live', '355806000']);
  const world = await cmds.asyncResults('minerva zen');
  assert.equal(world[0].label, 'MINERVA ZEN');
  assert.equal(world[0].hint, 'Oil/Chemical Tanker · GR');
  assert.equal(world[0].group, 'vessels-world');
  await cmds._runRemoteForTest({ shipId: '214707', name: 'MINERVA ZEN' });
  assert.deepEqual(selected.slice(-2), [['live', '241190000'], ['gfw', '241190000']], 'najprv skúsi vrstvy');
  assert.equal(remote.length, 1, 'mimo vrstiev → poloha z registra');
  assert.equal(remote[0].position.lat, 34.13);
  assert.match(notes.at(-1), /cmd\.vessel\.flying/);
  assert.deepEqual(await cmds.asyncResults('ab'), [], 'krátky dopyt server nezaťaží');
});

test('telefón nad 3 000 km (živé lode odložené): sledovaná a nájdená loď najprv počká na načítanie, potom otvorí živú kartu', async () => {
  // aisLiveVessels.js aisLoadDeferred (2026-10-16): vrstva lode zo zemegule nesťahuje, kým ich niekto nepotrebuje.
  let loaded = false;
  let loads = 0;
  const selected = [];
  const live = {
    selectByMmsi: (m) => { selected.push(m); return loaded && m === '241190000'; },
    whenLiveData: async () => { loads += 1; loaded = true; return true; },
  };
  const fetched = [];
  const remote = [];
  const fetchImpl = async (url) => {
    fetched.push(url);
    if (url.startsWith('/api/vessel-info/ship')) return { ok: true, json: async () => ({ shipId: '214707', mmsi: '241190000', name: 'MINERVA ZEN', position: { lat: 34.13, lon: -68.88, t: 1 } }) };
    return { ok: true, json: async () => ({ name: 'X', lastPosition: { lat: 1, lon: 2, t: 3 } }) };
  };
  const cmds = createVesselSearchCommands({ live, fetchImpl, onRemoteShip: (s) => remote.push(s) });
  assert.equal(await cmds.openByMmsi('241190000'), true, 'sledovaná loď otvorí živý záznam');
  assert.equal(loads, 1);
  assert.deepEqual(fetched, [], 'žiadna poloha z registra');
  assert.equal(remote.length, 0);

  loaded = false;
  await cmds._runRemoteForTest({ shipId: '214707', name: 'MINERVA ZEN' });
  assert.equal(loads, 2);
  assert.equal(remote.length, 0, 'klik vo výsledkoch servera vyberie živú loď, nie značku z registra');
  assert.deepEqual(selected.slice(-2), ['241190000', '241190000']);
});

/**
 * Vypnutá vrstva živých lodí ako v aisLiveVessels.js: kým nie je zapnutá, pamäť je prázdna
 * (selectByMmsi → false) a whenLiveData hneď vráti false. setEnabled ju zapne až po await —
 * ako manager.js, ktorý čaká na enable() a prvé update().
 */
function shipsOffFixture({ enabled = false, inView = () => true } = {}) {
  const st = { enabled, calls: [], selected: [], fetched: [], remote: [] };
  const live = {
    selectByMmsi: (m) => {
      const hit = st.enabled && inView(m);
      if (hit) st.selected.push(m);
      return hit;
    },
    whenLiveData: async () => false,
  };
  const dataManager = {
    isEnabled: (id) => id === 'ais-live-vessels' && st.enabled,
    setEnabled: async (id, on, opts) => {
      st.calls.push([id, on, opts]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (id === 'ais-live-vessels') st.enabled = on;
    },
  };
  const fetchImpl = async (url) => {
    st.fetched.push(url);
    if (url.startsWith('/api/vessel-info/ship')) return { ok: true, json: async () => ({ shipId: '214707', mmsi: '241190000', name: 'MINERVA ZEN', position: { lat: 34.13, lon: -68.88, t: 1 } }) };
    return { ok: true, json: async () => ({ name: 'MINERVA ZEN', lastPosition: { lat: 34.13, lon: -68.88, t: 1 } }) };
  };
  const cmds = createVesselSearchCommands({ live, dataManager, fetchImpl, onRemoteShip: (s) => st.remote.push(s) });
  return { st, cmds };
}

test('lode vypnuté (predvolené od 2026-10-16): sledovaná loď a odkaz ?ship= lode zapnú a otvoria živú kartu', async () => {
  // d421beb: STARTUP_DEFAULT_LAYER_IDS = ['flights'] — openByMmsi (sledované lode, /?ship=, Web Push).
  const { st, cmds } = shipsOffFixture();
  assert.equal(await cmds.openByMmsi('241190000'), true, 'živý záznam, nie poloha z registra');
  assert.deepEqual(st.calls, [['ais-live-vessels', true, { origin: 'user' }]], 'lode zapne práve raz, ako voľba návštevníka');
  assert.deepEqual(st.selected, ['241190000'], 'loď vybraná až po zapnutí');
  assert.deepEqual(st.fetched, [], 'register sa nepýta');
  assert.equal(st.remote.length, 0);
});

test('lode vypnuté: klik na loď vo výsledkoch servera lode zapne a vyberie živý záznam', async () => {
  const { st, cmds } = shipsOffFixture();
  await cmds._runRemoteForTest({ shipId: '214707', name: 'MINERVA ZEN' });
  assert.deepEqual(st.calls, [['ais-live-vessels', true, { origin: 'user' }]]);
  assert.deepEqual(st.selected, ['241190000']);
  assert.equal(st.remote.length, 0, 'žiadna značka z registra');
});

test('lode vypnuté, loď mimo načítaného výrezu: poloha z registra, no lode ostanú zapnuté pre živý záznam po dolete', async () => {
  let landed = false;
  const { st, cmds } = shipsOffFixture({ inView: () => landed });
  assert.equal(await cmds.openByMmsi('241190000'), false);
  assert.deepEqual(st.calls, [['ais-live-vessels', true, { origin: 'user' }]], 'zapne, nevypne');
  assert.equal(st.enabled, true, 'vrstva ostane zapnutá — výrez po dolete ju načíta');
  assert.equal(st.remote.length, 1, 'zatiaľ poloha z registra');
  // Po dolete kamery (main.js ?ship= o 12 s) zapnutá vrstva loď už nájde.
  landed = true;
  assert.equal(await cmds.openByMmsi('241190000'), true);
  assert.equal(st.calls.length, 1, 'zapnutú vrstvu druhý raz nezapína');
});

test('lode vypnuté na telefóne nad 3 000 km: zapnutie načítanie odloží, loď stiahne až whenLiveData', async () => {
  // aisLiveVessels.js: enable() pri aisLoadDeferred nesťahuje (state.deferred); whenLiveData pri vypnutej vrstve → false.
  let enabled = false;
  let loaded = false;
  const order = [];
  const live = {
    selectByMmsi: (m) => loaded && m === '241190000',
    whenLiveData: async () => { order.push(enabled ? 'whenLiveData' : 'whenLiveData-off'); if (!enabled) return false; loaded = true; return true; },
  };
  const dataManager = {
    isEnabled: () => enabled,
    setEnabled: async () => { order.push('setEnabled'); await Promise.resolve(); enabled = true; },
  };
  const remote = [];
  const cmds = createVesselSearchCommands({ live, dataManager, fetchImpl: async () => ({ ok: false }), onRemoteShip: (s) => remote.push(s) });
  assert.equal(await cmds.openByMmsi('241190000'), true);
  assert.deepEqual(order, ['setEnabled', 'whenLiveData'], 'najprv zapne, potom načíta na požiadanie');
  assert.equal(remote.length, 0);
});

test('lode už zapnuté: openByMmsi ani výsledok servera vrstvu znova nezapínajú', async () => {
  const { st, cmds } = shipsOffFixture({ enabled: true, inView: () => false });
  assert.equal(await cmds.openByMmsi('241190000'), false);
  await cmds._runRemoteForTest({ shipId: '214707', name: 'MINERVA ZEN' });
  assert.deepEqual(st.calls, [], 'žiadne setEnabled');
  assert.equal(st.remote.length, 2, 'loď mimo výrezu → poloha z registra');
});

test('bez odložených lodí (počítač) sa nečaká: neznáma loď ide hneď na polohu z registra', async () => {
  const live = { selectByMmsi: () => false, whenLiveData: async () => false };
  const remote = [];
  const fetchImpl = async () => ({ ok: true, json: async () => ({ name: 'X', lastPosition: { lat: 1, lon: 2, t: 3 } }) });
  const cmds = createVesselSearchCommands({ live, fetchImpl, onRemoteShip: (s) => remote.push(s) });
  assert.equal(await cmds.openByMmsi('241190000'), false);
  assert.equal(remote.length, 1);
  assert.equal(remote[0].position.lat, 1);
});
