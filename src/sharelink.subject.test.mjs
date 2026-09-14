// src/sharelink.subject.test.mjs
// Predmet zdieľania v hashi (2026-09-14): parse `subj`, zápis z providera,
// odovzdanie do onRestore.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShareLinkManager } from './sharelink.js';

function makeManager(hash = '', options = {}) {
  globalThis.window = { location: { hash, href: `http://localhost/${hash}` } };
  globalThis.history = {
    replaceState(_state, _title, nextHash) {
      window.location.hash = nextHash;
    },
  };
  const viewer = {
    camera: {
      changed: { addEventListener() {} },
      positionCartographic: { latitude: 0.84, longitude: 0.30, height: 1200 },
      heading: 0,
      pitch: -Math.PI / 3,
      roll: 0,
      flyTo() {},
      setView() {},
    },
  };
  return new ShareLinkManager(viewer, options);
}

test('hash s `subj` sa rozparsuje na predmet; chýbajúci alebo nevalidný = null', () => {
  assert.deepEqual(makeManager('#lat=48.1&lon=17.1&subj=gas-flows.s.kapusany-in').parseInitialHash().subject,
    { layerId: 'gas-flows', kind: 'selected', id: 'kapusany-in' });
  assert.deepEqual(makeManager('#lat=48.1&lon=17.1&subj=flights.t.4b1805').parseInitialHash().subject,
    { layerId: 'flights', kind: 'tracked', id: '4b1805' });
  assert.equal(makeManager('#lat=48.1&lon=17.1').parseInitialHash().subject, null);
  assert.equal(makeManager('#lat=48.1&lon=17.1&subj=garbage').parseInitialHash().subject, null);
});

test('provider predmetu zapisuje `subj` do hashu a bez predmetu ho vynechá', () => {
  const manager = makeManager('');
  let subject = { layerId: 'ais-live-vessels', kind: 'selected', id: '244660815' };
  manager.setSubjectStateProvider(() => subject);
  const params = manager._buildHashParams();
  assert.equal(params.get('subj'), 'ais-live-vessels.s.244660815');
  subject = null;
  assert.equal(manager._buildHashParams().get('subj'), null, 'bez predmetu bez parametra');
  manager.setSubjectStateProvider(() => ({ layerId: 'flights', kind: 'hovered', id: 'x' }));
  assert.equal(manager._buildHashParams().get('subj'), null, 'nevalidný predmet sa nezapíše');
});

test('applyState odovzdá predmet do onRestore spolu s ostatným stavom', async () => {
  const restored = [];
  const manager = makeManager('#lat=48.1&lon=17.1&subj=satellites.t.25544', {
    onRestore: async (state) => { restored.push(state); },
    isNavigationCurrent: () => true,
  });
  const state = manager.parseInitialHash();
  await manager.applyState(state, { applyCamera: false });
  assert.equal(restored.length, 1);
  assert.deepEqual(restored[0].subject, { layerId: 'satellites', kind: 'tracked', id: '25544' });
  const plain = makeManager('#lat=48.1&lon=17.1', { onRestore: async (state) => { restored.push(state); }, isNavigationCurrent: () => true });
  await plain.applyState(plain.parseInitialHash(), { applyCamera: false });
  assert.equal(restored[1].subject, null);
});
