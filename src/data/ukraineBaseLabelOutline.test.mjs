// src/data/ukraineBaseLabelOutline.test.mjs — lem popiskov podkladu UKRAJINA
// (2026-09-24): v bežnom štýle hrubší plný lem (meno sa strácalo v šrafe), KARTA
// ostáva ako vo vzorke (3 px, alfa 0,9) — vrátane sídiel, riek a oblastí.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';

import { BASE_LABEL_OUTLINE, createUkraineBaseLayer } from './ukraineBaseLayer.js';

const point = (id, cls, name, lon, lat, extra = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { id, cls, name, lang: 'uk', ...extra } });
const line = (props, coords) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: props });
const DATA = {
  meta: { snapshot: '2026-09-19T12:00:00.000Z', datasets: { places: { features: 2 } } },
  places: { type: 'FeatureCollection', features: [point(1, 'city', 'Краматорськ', 37.55, 48.72, { en: 'Kramatorsk', pop: 150000 }), point(2, 'town', 'Лиман', 37.80, 48.99, { pop: 20000 })] },
  villages: { type: 'FeatureCollection', features: [] },
  roads: { type: 'FeatureCollection', features: [] },
  rivers: { type: 'FeatureCollection', features: [line({ name: 'Сіверський Донець', en: 'Siverskyi Donets', lang: 'uk', km: 650 }, [[37.4, 48.95], [38.0, 48.95]])] },
  oblasts: { type: 'FeatureCollection', features: [line({ rels: [100, 200] }, [[37.0, 48.0], [38.0, 48.0]])], oblasts: [{ id: 100, name: 'Донецька область', en: 'Donetsk Oblast', iso: 'UA-14', center: [37.5, 48.3] }] },
};
const fakeFetch = async (url) => {
  const name = String(url).replace(/^.*\/api\/ukraine\/base\//, '').replace(/\?.*$/, '');
  if (!(name in DATA)) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => DATA[name] };
};
function fakeDataSource(id) {
  const values = [];
  return { id, show: true, entities: { values, add(e) { const en = { ...e }; values.push(en); return en; }, remove(e) { const i = values.indexOf(e); if (i >= 0) values.splice(i, 1); return i >= 0; } } };
}
function fakeViewer() {
  const moveEnd = { listeners: [], addEventListener(fn) { this.listeners.push(fn); return () => {}; } };
  return {
    dataSources: { add() {}, remove() {} },
    scene: { canvas: { clientWidth: 1200, clientHeight: 800, addEventListener() {}, removeEventListener() {} }, pick: () => null, requestRender() {} },
    camera: {
      positionCartographic: { height: 120_000, longitude: Cesium.Math.toRadians(37.75), latitude: Cesium.Math.toRadians(48.95) },
      computeViewRectangle: () => Cesium.Rectangle.fromDegrees(37.2, 48.6, 38.4, 49.4),
      moveEnd,
      flyTo() {},
    },
  };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

test('lem popiskov podkladu: bežný 4 px plný, KARTA 3 px / 0,9 (sídla, rieky, oblasti), späť bežný', async () => {
  assert.deepEqual({ ...BASE_LABEL_OUTLINE.default }, { width: 4, alpha: 1 });
  assert.deepEqual({ ...BASE_LABEL_OUTLINE.karta }, { width: 3, alpha: 0.9 }, 'KARTA ako pred 2026-09-24');
  const layer = createUkraineBaseLayer({
    viewer: fakeViewer(),
    fetchImpl: fakeFetch,
    translate: (k) => k,
    lang: () => 'sk',
    dataSourceFactory: fakeDataSource,
    handlerFactory: () => ({ setInputAction() {}, destroy() {} }),
    hoverFactory: () => ({ show() { return true; }, hide() {}, isHovered: () => false, destroy() {} }),
    groundSupport: () => true,
    terrainSampler: async (pts) => pts.map(() => 100),
    projectorFactory: () => () => ({ x: 100, y: 100 }),
    setTimer: () => 0,
    clearTimer: () => {},
  });
  await layer.show();
  await settle();
  const { sources } = layer._getStateForTest();
  const labels = () => Object.values(sources).flatMap((ds) => ds.entities.values).map((e) => e.label).filter(Boolean);
  const kinds = () => labels().length;
  assert.ok(kinds() >= 3, `sídla + rieka + oblasť (${kinds()})`);
  const check = (width, alpha, what) => {
    for (const l of labels()) {
      assert.equal(l.outlineWidth, width, `${what}: šírka`);
      assert.ok(Math.abs(l.outlineColor.alpha - alpha) < 1e-6, `${what}: alfa ${l.outlineColor.alpha}`);
    }
  };
  check(4, 1, 'bežný');
  layer.setStyle('karta');
  check(3, 0.9, 'karta');
  layer.setStyle('default');
  check(4, 1, 'späť bežný');
  layer.destroy();
});
