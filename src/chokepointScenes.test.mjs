import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHOKEPOINT_SCENES,
  CHOKEPOINT_SCENE_LAYERS,
  applyChokepointScene,
  chokepointSceneAnnotationRequests,
  chokepointSceneById,
  chokepointSceneLabel,
  chokepointSceneLayerIds,
  chokepointSceneRectangle,
  chokepointSceneSubtitle,
  listChokepointScenes,
  validateChokepointScenes,
} from './chokepointScenes.js';
import { REGISTERED_LAYER_IDS } from './data/layerState.js';
import { EN_STRINGS, SK_STRINGS } from './i18nStrings.js';

test('catalog validates and every scene layer is a registered layer id', () => {
  assert.equal(validateChokepointScenes(), true);
  const registered = new Set(REGISTERED_LAYER_IDS);
  for (const layerId of CHOKEPOINT_SCENE_LAYERS) assert.ok(registered.has(layerId), layerId);
  assert.ok(CHOKEPOINT_SCENES.length >= 1);
  assert.ok(listChokepointScenes().some((scene) => scene.id === 'hormuz'));
});

test('every rectangle is a sane [W,S,E,N] box containing its own centre', () => {
  for (const scene of CHOKEPOINT_SCENES) {
    const [west, south, east, north] = scene.rectDegrees;
    assert.ok(west < east, `${scene.id} west<east`);
    assert.ok(south < north, `${scene.id} south<north`);
    assert.ok(scene.center.lon >= west && scene.center.lon <= east, `${scene.id} lon in rect`);
    assert.ok(scene.center.lat >= south && scene.center.lat <= north, `${scene.id} lat in rect`);
  }
});

test('validation rejects an unregistered layer, an inverted rect and an off-centre point', () => {
  assert.throws(() => validateChokepointScenes(CHOKEPOINT_SCENES, ['not-a-real-layer']), /not registered/);
  assert.throws(() => validateChokepointScenes([{
    id: 'x', name: 'X', center: { lat: 0, lon: 0 }, rectDegrees: [10, 0, 5, 5],
  }]), /inverted rect/);
  assert.throws(() => validateChokepointScenes([{
    id: 'x', name: 'X', center: { lat: 50, lon: 50 }, rectDegrees: [0, 0, 5, 5],
  }]), /outside rect/);
  assert.throws(() => validateChokepointScenes([
    { id: 'dup', name: 'A', center: { lat: 1, lon: 1 }, rectDegrees: [0, 0, 2, 2] },
    { id: 'dup', name: 'B', center: { lat: 1, lon: 1 }, rectDegrees: [0, 0, 2, 2] },
  ]), /Duplicate/);
});

test('lookup is case/space-insensitive and null for the unknown', () => {
  assert.equal(chokepointSceneById('hormuz')?.id, 'hormuz');
  assert.equal(chokepointSceneById('  HORMUZ ')?.id, 'hormuz');
  assert.equal(chokepointSceneById('atlantis'), null);
  assert.equal(chokepointSceneById(''), null);
  assert.equal(chokepointSceneById(undefined), null);
});

test('layer ids fall back to the shared set and honour a per-scene override', () => {
  const hormuz = chokepointSceneById('hormuz');
  assert.deepEqual(chokepointSceneLayerIds(hormuz), CHOKEPOINT_SCENE_LAYERS);
  assert.deepEqual(chokepointSceneLayerIds({ layerIds: ['flights'] }), ['flights']);
  assert.deepEqual(chokepointSceneRectangle(hormuz), hormuz.rectDegrees);
});

test('label uses the translation, or the honest English identity when it is missing', () => {
  const hormuz = chokepointSceneById('hormuz');
  const translate = (key) => (key === 'chokepoint.hormuz.name' ? 'Hormuzský prieliv' : key);
  assert.equal(chokepointSceneLabel(hormuz, translate), 'Hormuzský prieliv');
  // A translate that returns the key unchanged (missing string) → English name.
  assert.equal(chokepointSceneLabel(hormuz, (key) => key), 'Strait of Hormuz');
  assert.equal(chokepointSceneSubtitle(hormuz, (key) => key), '');
  assert.equal(chokepointSceneSubtitle(hormuz, () => 'because oil'), 'because oil');
});

test('annotation request is a single amber pin at the strait centre', () => {
  const hormuz = chokepointSceneById('hormuz');
  const requests = chokepointSceneAnnotationRequests(hormuz, (key) => key);
  assert.equal(requests.length, 1);
  const [pin] = requests;
  assert.equal(pin.type, 'pin');
  assert.equal(pin.latitude, hormuz.center.lat);
  assert.equal(pin.longitude, hormuz.center.lon);
  assert.equal(pin.color, 'amber');
  assert.equal(pin.label, 'Strait of Hormuz');
});

test('apply refuses an unknown scene and a missing layer enabler', async () => {
  const unknown = await applyChokepointScene('atlantis', { setLayerEnabled: () => true });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error, 'unknown-chokepoint');

  const noEnabler = await applyChokepointScene('hormuz', {});
  assert.equal(noEnabler.ok, false);
  assert.equal(noEnabler.error, 'no-layer-enabler');
});

test('apply enables every layer, frames the rect and marks the strait', async () => {
  const enabled = [];
  let framed = null;
  let annotatedWith = null;
  const result = await applyChokepointScene('hormuz', {
    setLayerEnabled: async (layerId) => { enabled.push(layerId); return true; },
    flyToRegion: (rect) => { framed = rect; },
    annotate: async (requests) => { annotatedWith = requests; return { drawn: requests.length, ok: true }; },
    translate: (key) => key,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.failedLayerIds, []);
  assert.equal(result.annotated, true);
  assert.deepEqual(enabled, [...CHOKEPOINT_SCENE_LAYERS]);
  assert.deepEqual(framed, chokepointSceneById('hormuz').rectDegrees);
  assert.equal(annotatedWith.length, 1);
});

test('a failing or throwing layer is reported without sinking the scene', async () => {
  const result = await applyChokepointScene('hormuz', {
    setLayerEnabled: async (layerId) => {
      if (layerId === 'gfw-sar') return false;
      if (layerId === 'aishub-vessels') throw new Error('boom');
      return true;
    },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(new Set(result.failedLayerIds), new Set(['gfw-sar', 'aishub-vessels']));
});

test('a rejected flight or annotation never fails the scene', async () => {
  const result = await applyChokepointScene('hormuz', {
    setLayerEnabled: () => true,
    flyToRegion: () => { throw new Error('camera busy'); },
    annotate: () => { throw new Error('engine down'); },
  });
  assert.equal(result.ok, true);
  assert.equal(result.annotated, false);
});

test('annotation success is read from the engine result shape', async () => {
  const base = { setLayerEnabled: () => true, flyToRegion: () => {} };
  const drew = await applyChokepointScene('suez', { ...base, annotate: () => ({ drawn: 1 }) });
  assert.equal(drew.annotated, true);
  const refused = await applyChokepointScene('suez', { ...base, annotate: () => ({ ok: false, drawn: 0 }) });
  assert.equal(refused.annotated, false);
});

test('every scene has EN and SK name + subtitle strings (dictionary parity)', () => {
  for (const scene of CHOKEPOINT_SCENES) {
    for (const dict of [EN_STRINGS, SK_STRINGS]) {
      assert.ok(dict[`chokepoint.${scene.id}.name`], `name for ${scene.id}`);
      assert.ok(dict[`chokepoint.${scene.id}.subtitle`], `subtitle for ${scene.id}`);
    }
  }
});
