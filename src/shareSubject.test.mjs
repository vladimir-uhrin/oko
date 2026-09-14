// src/shareSubject.test.mjs
// Predmet zdieľania (2026-09-14): kódovanie do hashu, čítanie z vrstiev
// a kontextu, obnova u príjemcu s opakovaním.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHARE_SUBJECT_PARAM,
  applyShareSubject,
  decodeShareSubject,
  encodeShareSubject,
  readShareSubject,
  readShareSubjectLabel,
  subjectIdFromContextId,
} from './shareSubject.js';

test('encode/decode: vrstva.druh.id, bodky v id prežijú, nevalidné → null', () => {
  assert.equal(SHARE_SUBJECT_PARAM, 'subj');
  assert.equal(encodeShareSubject({ layerId: 'flights', kind: 'tracked', id: '4b1805' }), 'flights.t.4b1805');
  assert.equal(encodeShareSubject({ layerId: 'gas-flows', kind: 'selected', id: 'kapusany-in' }), 'gas-flows.s.kapusany-in');
  assert.equal(encodeShareSubject({ layerId: 'satellites', kind: 'tracked', id: 25544 }), 'satellites.t.25544');
  assert.deepEqual(decodeShareSubject('flights.t.4b1805'), { layerId: 'flights', kind: 'tracked', id: '4b1805' });
  assert.deepEqual(decodeShareSubject('earthquakes.s.us7000abcd.v1'), { layerId: 'earthquakes', kind: 'selected', id: 'us7000abcd.v1' }, 'bodka v id');
  assert.equal(encodeShareSubject(null), null);
  assert.equal(encodeShareSubject({ layerId: 'flights', kind: 'hovered', id: 'x' }), null, 'neznámy druh');
  assert.equal(encodeShareSubject({ layerId: 'Flights', kind: 'tracked', id: 'x' }), null, 'id vrstvy len malé písmená');
  assert.equal(encodeShareSubject({ layerId: 'flights', kind: 'tracked', id: '<script>' }), null, 'id bez značiek');
  assert.equal(decodeShareSubject('flights.t'), null);
  assert.equal(decodeShareSubject('.t.x'), null);
  assert.equal(decodeShareSubject('flights.x.4b1805'), null);
  assert.equal(decodeShareSubject(''), null);
  assert.equal(decodeShareSubject(undefined), null);
});

test('subjectIdFromContextId: predpony kontextu preč (ais-, vrstva:), inak nezmenené', () => {
  assert.equal(subjectIdFromContextId('ais-live-vessels', 'ais-244660815'), '244660815');
  assert.equal(subjectIdFromContextId('gas-flows', 'gas-flows:kapusany-in'), 'kapusany-in');
  assert.equal(subjectIdFromContextId('earthquakes', 'us7000abcd'), 'us7000abcd');
  assert.equal(subjectIdFromContextId('gas-flows', ''), null);
});

function fakeManager({ modules = {}, enabled = [] } = {}) {
  const enabledSet = new Set(enabled);
  return {
    calls: [],
    layers: new Map(Object.entries(modules).map(([id, module]) => [id, { module }])),
    isEnabled: (id) => enabledSet.has(id),
    async setEnabled(id, on, options) { this.calls.push(['setEnabled', id, on, options]); if (on) enabledSet.add(id); else enabledSet.delete(id); },
  };
}

test('readShareSubject: sledovaný stroj má prednosť, inak vybraný kontext; vypnutá sledovacia vrstva sa ignoruje', () => {
  const flights = { getTrackedSubject: () => ({ layerId: 'flights', id: '4b1805', label: 'SWR11H' }) };
  const satellites = { getTrackedInfo: () => ({ noradId: 25544, name: 'ISS' }) };
  const manager = fakeManager({ modules: { flights, satellites }, enabled: ['flights', 'satellites', 'ais-live-vessels'] });
  assert.deepEqual(readShareSubject({ dataManager: manager, selectedContext: { layerId: 'ais-live-vessels', id: 'ais-244660815' } }),
    { layerId: 'flights', kind: 'tracked', id: '4b1805' });
  flights.getTrackedSubject = () => null;
  assert.deepEqual(readShareSubject({ dataManager: manager, selectedContext: null }),
    { layerId: 'satellites', kind: 'tracked', id: '25544' }, 'satelit cez getTrackedInfo().noradId');
  satellites.getTrackedInfo = () => null;
  assert.deepEqual(readShareSubject({ dataManager: manager, selectedContext: { layerId: 'ais-live-vessels', id: 'ais-244660815' } }),
    { layerId: 'ais-live-vessels', kind: 'selected', id: '244660815' });
  assert.deepEqual(readShareSubject({ dataManager: manager, selectedContext: { layerId: 'gas-flows', id: 'gas-flows:kapusany-in' } }),
    { layerId: 'gas-flows', kind: 'selected', id: 'kapusany-in' });
  const disabled = fakeManager({ modules: { flights: { getTrackedSubject: () => ({ id: '4b1805' }) } }, enabled: [] });
  assert.equal(readShareSubject({ dataManager: disabled }), null, 'vypnutá vrstva nič nezdieľa');
  assert.equal(readShareSubject({}), null);
});

test('readShareSubjectLabel: názov sledovaného stroja, inak vybraného objektu, inak null', () => {
  const manager = fakeManager({
    modules: { flights: { getTrackedSubject: () => ({ id: '4b1805', label: 'SWR11H' }) }, satellites: { getTrackedInfo: () => ({ noradId: 25544, name: ' ISS (ZARYA) ' }) } },
    enabled: ['flights', 'satellites'],
  });
  assert.equal(readShareSubjectLabel({ dataManager: manager, selectedContext: { label: 'Kapušany' } }), 'SWR11H');
  manager.layers.get('flights').module.getTrackedSubject = () => null;
  assert.equal(readShareSubjectLabel({ dataManager: manager }), 'ISS (ZARYA)');
  manager.layers.get('satellites').module.getTrackedInfo = () => null;
  assert.equal(readShareSubjectLabel({ dataManager: manager, selectedContext: { label: 'Kapušany' } }), 'Kapušany');
  assert.equal(readShareSubjectLabel({ dataManager: manager }), null);
});

test('applyShareSubject: trackById/selectById podľa druhu, vypnutá vrstva sa zapne, čakanie na dáta = pending', async () => {
  const flights = { tracked: [], trackById(id, options) { this.tracked.push([id, options]); return id === '4b1805'; } };
  const gas = { known: new Set(), selected: null, selectById(id) { if (!this.known.has(id)) return false; this.selected = id; return true; } };
  const manager = fakeManager({ modules: { flights, 'gas-flows': gas }, enabled: [] });

  assert.equal(await applyShareSubject({ dataManager: manager, subject: { layerId: 'flights', kind: 'tracked', id: '4b1805' } }), 'applied');
  assert.deepEqual(manager.calls, [['setEnabled', 'flights', true, { origin: 'share' }]], 'vrstva sa zapla pred sledovaním');
  assert.deepEqual(flights.tracked, [['4b1805', { origin: 'share' }]]);

  assert.equal(await applyShareSubject({ dataManager: manager, subject: { layerId: 'gas-flows', kind: 'selected', id: 'kapusany-in' } }), 'pending', 'stanice ešte nie sú načítané');
  gas.known.add('kapusany-in');
  assert.equal(await applyShareSubject({ dataManager: manager, subject: { layerId: 'gas-flows', kind: 'selected', id: 'kapusany-in' } }), 'applied');
  assert.equal(gas.selected, 'kapusany-in');

  assert.equal(await applyShareSubject({ dataManager: manager, subject: { layerId: 'nope', kind: 'selected', id: 'x' } }), 'unknown-layer');
  assert.equal(await applyShareSubject({ dataManager: manager, subject: { layerId: 'gas-flows', kind: 'tracked', id: 'x' } }), 'unsupported', 'stanica sa nesleduje, len vyberá');
  assert.equal(await applyShareSubject({ dataManager: null, subject: { layerId: 'flights', kind: 'tracked', id: 'x' } }), 'unsupported');
});
