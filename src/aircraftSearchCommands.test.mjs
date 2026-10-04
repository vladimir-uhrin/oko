// Lietadlá v jednotnom hľadaní (2026-10-04): riadky palety, sledovanie živého, značka pre lietadlo len zo servera.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aircraftCommandLabel, createAircraftSearchCommands } from './aircraftSearchCommands.js';

function layer(id, contacts, trackable = new Set()) {
  const tracked = [];
  return {
    id, tracked, trackable,
    searchContacts: (q) => contacts.filter(c => c.match.includes(q)).map(c => ({ ...c })),
    trackById: (hex) => { if (!trackable.has(hex)) return false; tracked.push(hex); return true; },
  };
}

test('riadok: volací znak · ľudský typ, hint registrácia · prevádzkovateľ · FL alebo na zemi', () => {
  assert.deepEqual(aircraftCommandLabel({ hex: '508035', callsign: 'ADB3017', registration: 'UR-82072', typeCode: 'A124', operator: 'Antonov Airlines', altitudeFt: 31000 }),
    { label: 'ADB3017 · Antonov An-124 Ruslan', hint: 'UR-82072 · Antonov Airlines · FL310' });
  assert.equal(aircraftCommandLabel({ hex: '508035', onGround: true }, k => k).label, '508035');
  assert.equal(aircraftCommandLabel({ hex: '508035', onGround: true }, k => k).hint, 'cmd.aircraft.ground');
});

test('živé: obe vrstvy, duplicita podľa hexu, klik sleduje a zapne vypnutú vrstvu', () => {
  const flights = layer('flights', [{ hex: '508035', callsign: 'ADB3017', typeCode: 'A124', score: 80, match: 'ruslan' }], new Set(['508035']));
  const military = layer('military', [{ hex: '508035', callsign: 'ADB3017', score: 70, match: 'ruslan' }, { hex: 'ae1234', callsign: 'RCH123', score: 80, match: 'ruslan' }]);
  const enabled = new Set(['military']);
  const dataManager = { isEnabled: id => enabled.has(id), setEnabled: (id, on) => { if (on) enabled.add(id); } };
  const s = createAircraftSearchCommands({ flights, military, dataManager });
  const cmds = s.queryCommands('ruslan');
  assert.deepEqual(cmds.map(c => c.id).sort(), ['ac:508035', 'ac:ae1234']);
  cmds.find(c => c.id === 'ac:508035').run();
  assert.deepEqual(flights.tracked, ['508035']);
  assert.ok(enabled.has('flights'), 'vrstva lietadiel sa zapla');
});

test('svet: miesto nevolá server; 429 a „nelieta" ako poznámky; zdroj adsb.lol', async () => {
  const calls = [];
  const reply = { status: 200, body: { aircraft: [], meaning: ['Antonov An-124 Ruslan'] } };
  const fetchImpl = async (url) => { calls.push(url); return { ok: reply.status === 200, status: reply.status, json: async () => reply.body }; };
  const s = createAircraftSearchCommands({ flights: layer('flights', []), fetchImpl, translate: (k, v) => (v ? `${k}:${v.what}` : k) });
  assert.deepEqual(await s.asyncResults('Bratislava'), []);
  assert.equal(calls.length, 0, 'miesto nezaťažuje adsb.lol');
  assert.deepEqual((await s.asyncResults('Ruslan')).map(c => c.label), ['cmd.aircraft.none:Antonov An-124 Ruslan']);
  assert.equal(calls[0], '/api/aircraft-search?q=Ruslan');
  reply.body = { aircraft: [{ hex: '508035', callsign: 'ADB3017', typeCode: 'A124', lat: 48.17, lon: 17.21 }], meaning: [] };
  const found = await s.asyncResults('Ruslan');
  assert.deepEqual(found.map(c => c.kind || c.id), ['ac:508035', 'note']);
  assert.equal(found[1].label, 'cmd.aircraft.source');
  reply.status = 429;
  assert.equal((await s.asyncResults('Ruslan'))[0].label, 'cmd.aircraft.limited');
});

test('lietadlo len zo servera: značka + let kamery, prepne na sledovanie, keď ho vrstva načíta', () => {
  const timers = [];
  const flights = layer('flights', []);
  const entities = new Set();
  const flown = [];
  const Cesium = {
    Cartesian3: { fromDegrees: (lon, lat, h) => ({ lon, lat, h }) }, Cartesian2: function Cartesian2(x, y) { this.x = x; this.y = y; },
    Color: { WHITE: 'white', fromCssColorString: c => c },
  };
  const viewer = { entities: { add: e => { entities.add(e); return e; }, remove: e => entities.delete(e) }, camera: { flyTo: o => flown.push(o.destination) } };
  const notes = [];
  const s = createAircraftSearchCommands({ flights, viewer, Cesium, notify: t => notes.push(t), translate: (k, v) => (v ? `${k}:${v.name}` : k),
    setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
  s._runForTest({ hex: '508035', callsign: 'ADB3017', typeCode: 'A124', lat: 48.17, lon: 17.21, altitudeFt: 0 });
  assert.equal(entities.size, 1, 'dočasná značka');
  assert.deepEqual(flown[0], { lon: 17.21, lat: 48.17, h: 60_000 });
  assert.deepEqual(notes, ['cmd.aircraft.flying:ADB3017 · Antonov An-124 Ruslan']);
  // timers: [0] = prvý pokus o sledovanie (3 s), [1] = zmazanie značky (2 min)
  timers[0]();
  assert.equal(flights.tracked.length, 0, 'vrstva ho ešte nemá');
  flights.trackable.add('508035');
  timers[2](); // ďalší pokus: už ho má
  assert.deepEqual(flights.tracked, ['508035']);
  assert.equal(entities.size, 0, 'značka zmizne, keď sa sleduje naozaj');
});
