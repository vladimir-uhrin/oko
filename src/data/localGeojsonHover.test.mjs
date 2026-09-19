// src/data/localGeojsonHover.test.mjs
// Hover popup nad značkou lokálnej vrstvy (2026-09-19, prístav Mariupol na
// ropovode: „aj tie uzly sprav vyskakovacie"): pointermove → 80 ms → pick 7×7
// → karta s menom, vlajkou (z mena štátu WPI) a riadkami; cudzia značka nič;
// ťahanie/klik/kamera/odchod zatvoria; disable odpojí, destroy zničí kartu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalGeoJsonLayer } from './localGeojson.js';
import { PORTS_LAYER_ID } from './portsData.js';

class MockEvent {
  constructor() { this.listeners = new Set(); }
  addEventListener(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  raise(...a) { for (const fn of [...this.listeners]) fn(...a); }
}

test('prístav: hover ukáže kartu s vlajkou z mena štátu; cudzia značka nie; zatváranie a odpojenie', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  globalThis.window = { dispatchEvent() {} };
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    // Polygón, nie Point: Cesium pri bode kreslí pin cez canvas a v Node niet
    // `document` (rovnaký dôvod ako v harnesse localGeojson.test.mjs). Hover
    // je na geometrii nezávislý — rozhoduje __localLayerId a vlastnosti.
    text: async () => JSON.stringify({ type: 'Feature', id: 'wpi-44010', geometry: { type: 'Polygon', coordinates: [[[37.56, 47.07], [37.58, 47.07], [37.58, 47.09], [37.56, 47.07]]] }, properties: { name: 'Mariupol', locode: 'UAMPL', country: 'Ukraine', size: 'Medium', harborType: 'Coastal Natural', chanDepthM: 8 } }),
  });
  const dataSources = [];
  const canvas = { clientWidth: 800, clientHeight: 600, listeners: {}, addEventListener(t, fn) { this.listeners[t] = fn; }, removeEventListener(t) { delete this.listeners[t]; } };
  const moveStart = new MockEvent();
  const pick = { value: null, last: null };
  const viewer = {
    selectedEntity: undefined,
    dataSources: { add(ds) { dataSources.push(ds); return ds; }, remove(ds) { const i = dataSources.indexOf(ds); if (i >= 0) dataSources.splice(i, 1); return i >= 0; } },
    camera: { positionWC: { x: 1, y: 2, z: 3 }, moveEnd: new MockEvent(), moveStart, flyTo() {} },
    scene: { canvas, preRender: new MockEvent(), pick(pos, w, h) { pick.last = [pos.x, pos.y, w, h]; return pick.value; }, requestRender() {}, screenSpaceCameraController: { enableInputs: true } },
  };
  const shown = []; let hidden = 0; let inside = false;
  const hover = { show(input, at, key) { shown.push([key, input.title, input.titleFlag, input.kindText, input.details]); return true; }, hide() { hidden += 1; }, destroy() { this.destroyed = true; }, isHovered: () => inside, current: () => null };
  const timers = [];
  const hoverTimers = { set: (fn) => { timers.push(fn); return timers.length; }, clear: (id) => { timers[id - 1] = null; } };
  const runTimers = () => { const pending = timers.splice(0).filter(Boolean); for (const fn of pending) fn(); };
  const layer = createLocalGeoJsonLayer({
    id: PORTS_LAYER_ID, url: '/ports.geojsonl', name: 'Ports', color: '#7fd1c0', source: 'NGA WPI',
    overlayHost: { setVisible() {}, setEntries() {}, clearSource() {} },
    screenSpaceEventHandlerFactory: () => ({ setInputAction() {}, destroy() {} }),
    hoverFactory: () => hover, hoverTimers, translate: (k) => k,
  });
  try {
    await layer.enable(viewer);
    assert.deepEqual(Object.keys(canvas.listeners).sort(), ['pointerdown', 'pointerleave', 'pointermove'], 'listenery po zapnutí');
    const entity = dataSources[0].entities.values.find((e) => e.__localLayerId === PORTS_LAYER_ID);
    assert.ok(entity, 'načítaná značka nesie id vrstvy');
    // Pohyb nad značkou → po tiku pick 7×7 → karta.
    pick.value = { id: entity };
    canvas.listeners.pointermove({ clientX: 120, clientY: 80, buttons: 0 });
    assert.equal(shown.length, 0, 'karta až po pauze');
    runTimers();
    assert.deepEqual(pick.last, [120, 80, 7, 7]);
    assert.equal(shown.length, 1);
    const [key, title, flag, kind, details] = shown[0];
    assert.equal(key, entity.id);
    assert.equal(title, 'Mariupol');
    assert.equal(flag, 'ua', 'WPI má „Ukraine" — vlajka cez countryIso2FromName');
    assert.equal(kind, 'layer.local-ports.name · NGA WPI');
    assert.match(details[0], /UAMPL · MEDIUM · COASTAL NATURAL/);
    assert.match(details[1], /CH 8M · Ukraine/);
    // Cudzia značka (iná vrstva) → karta sa schová.
    pick.value = { id: { __localLayerId: 'local-airports', id: 'x' } };
    canvas.listeners.pointermove({ clientX: 10, clientY: 10, buttons: 0 }); runTimers();
    assert.equal(shown.length, 1);
    assert.equal(hidden, 1);
    inside = true;
    pick.value = null;
    canvas.listeners.pointermove({ clientX: 11, clientY: 11, buttons: 0 }); runTimers();
    assert.equal(hidden, 1, 'kurzor v karte ju drží');
    inside = false;
    canvas.listeners.pointermove({ clientX: 11, clientY: 11, buttons: 1 });
    assert.equal(hidden, 2, 'ťahanie zatvorí');
    canvas.listeners.pointerdown({});
    assert.equal(hidden, 3);
    moveStart.raise();
    assert.equal(hidden, 4, 'pohyb kamery zatvorí');
    canvas.listeners.pointerleave({});
    assert.equal(hidden, 4);
    runTimers();
    assert.equal(hidden, 5, 'odchod z plátna po 220 ms');
    layer.disable(viewer);
    assert.deepEqual(Object.keys(canvas.listeners), []);
    assert.equal(moveStart.listeners.size, 0);
    layer.destroy(viewer);
    assert.equal(hover.destroyed, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
  }
});
