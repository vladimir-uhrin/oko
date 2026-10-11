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
