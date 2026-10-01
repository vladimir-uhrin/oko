// src/eventMarkers.test.mjs — značky momentov udalosti na glóbuse (Udalosti, etapa 2b, 2026-09-30).
// Testy SPRÁVANIA: čísla 1…N v poradí momentov, moment bez polohy sa preskočí (číslo ostane
// rovnaké ako v karte), výška ako v prehrávači, zmazanie upratuje, prelet nad udalosť zvisle nadol.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createEventMarkers } from './eventMarkers.js';

function fakeViewer() {
  const entities = [];
  const flights = [];
  let renders = 0;
  return {
    entities: {
      add: (e) => { entities.push(e); return e; },
      remove: (e) => { const i = entities.indexOf(e); if (i >= 0) entities.splice(i, 1); return i >= 0; },
      list: entities,
    },
    camera: { flyTo: (opts) => flights.push(opts) },
    scene: { requestRender: () => { renders += 1; } },
    flights,
    renders: () => renders,
  };
}

test('značky: čísla v poradí momentov, bez polohy preskočí, výška ako v prehrávači; zmazanie aj opätovné zobrazenie upratuje', () => {
  const viewer = fakeViewer();
  const images = [];
  const markers = createEventMarkers(viewer, { image: (n) => { images.push(n); return `img-${n}`; } });
  markers.show([
    { lat: 29.1, lon: 39.2, alt: 9853 },
    { lat: null, lon: null },
    { lat: 28.5, lon: 38.9, alt: -20 },
  ]);
  assert.deepEqual(viewer.entities.list.map((e) => e.id), ['oko-event-moment:1', 'oko-event-moment:3'], 'číslo 3 ostáva 3 — ako v karte');
  assert.deepEqual(images, [1, 3]);
  const carto = Cesium.Cartographic.fromCartesian(viewer.entities.list[0].position);
  assert.ok(Math.abs(Cesium.Math.toDegrees(carto.latitude) - 29.1) < 1e-9 && Math.abs(carto.height - 9853) < 1e-3, 'poloha a výška nad elipsoidom');
  assert.ok(Math.abs(Cesium.Cartographic.fromCartesian(viewer.entities.list[1].position).height) < 1e-3, 'záporná výška → 0');
  assert.equal(viewer.entities.list[0].billboard.disableDepthTestDistance, Number.POSITIVE_INFINITY, 'terén značku neskryje');
  markers.show([{ lat: 1, lon: 2, alt: 0 }]);
  assert.equal(viewer.entities.list.length, 1, 'nové zobrazenie zmaže predošlé');
  markers.clear();
  assert.equal(viewer.entities.list.length, 0);
  assert.equal(markers.count(), 0);
  assert.ok(viewer.renders() >= 3, 'scéna sa prekreslí (requestRenderMode)');
});

test('prelet: zvisle nadol nad momentmi udalosti; bez polohy žiadny prelet', () => {
  const viewer = fakeViewer();
  const markers = createEventMarkers(viewer, { image: () => 'x' });
  const view = {
    firstT: 1000, lastT: 2000,
    moments: [{ t: 1000, kind: 'dive', lat: 29, lon: 39, alt: 10000 }, { t: 2000, kind: 'last-contact', lat: 30, lon: 38, alt: 4000 }],
    track: [[900, 28.9, 39.1, 33000], [2100, 30.1, 37.9, 12000]],
  };
  assert.equal(markers.flyTo(view), true);
  const [fly] = viewer.flights;
  const c = Cesium.Cartographic.fromCartesian(fly.destination);
  assert.ok(Math.abs(Cesium.Math.toDegrees(c.latitude) - 29.5) < 0.2 && Math.abs(Cesium.Math.toDegrees(c.longitude) - 38.5) < 0.2, 'stred nad udalosťou');
  assert.ok(Math.abs(c.height - 250_000) < 1, `malá udalosť = najnižší záber 250 km (${c.height})`);
  assert.equal(fly.orientation.pitch, -Cesium.Math.PI_OVER_TWO);
  assert.equal(markers.flyTo({ moments: [], track: [] }), false);
  assert.equal(viewer.flights.length, 1);
});

test('moment zo správ (verejný pohľad `reported`, napr. pristátie, ktoré siete nevideli): prázdna značka, rovnaké číslo', () => {
  const viewer = fakeViewer();
  const markers = createEventMarkers(viewer, { image: (n) => `img-${n}`, reportedImage: (n) => `news-${n}` });
  markers.show([{ lat: 29.1, lon: 39.2, alt: 9853 }, { lat: 28.37, lon: 36.62, alt: null, reported: true }]);
  assert.deepEqual(viewer.entities.list.map((e) => [e.id, e.billboard.image]), [['oko-event-moment:1', 'img-1'], ['oko-event-moment:2', 'news-2']]);
  assert.ok(Math.abs(Cesium.Cartographic.fromCartesian(viewer.entities.list[1].position).height) < 1e-3, 'bez nameranej výšky na zemi');
});
