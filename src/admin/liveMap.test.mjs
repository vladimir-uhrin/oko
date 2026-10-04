import test from 'node:test';
import assert from 'node:assert/strict';
import { VIEWS, autoView, canvasHeight, clusterPoints, makeProjection } from './liveMap.js';

test('projekcia mapy Naživo: rohy pohľadu padnú do plátna, sever hore', () => {
  const { project } = makeProjection(VIEWS.world, 1000, 400, 0);
  const [x0, y0] = project(-180, 80);
  const [x1, y1] = project(180, -58);
  assert.ok(x0 >= 0 && y0 >= 0 && x1 <= 1000 && y1 <= 400);
  assert.ok(project(17, 48)[1] < project(17, 30)[1], 'sever je vyššie');
  assert.ok(canvasHeight(VIEWS.central, 900) > canvasHeight(VIEWS.world, 900));
});

test('zhluky: blízke body sa zlúčia, body bez polohy vypadnú, presnosť mesta vyhráva', () => {
  const { project } = makeProjection(VIEWS.world, 1000, 400);
  const clusters = clusterPoints([
    { lat: 48.1, lon: 17.1, precision: 'city' }, { lat: 48.2, lon: 17.0, precision: 'country' },
    { lat: 40.7, lon: -74.0, precision: 'city' }, { lat: null, lon: null },
  ], project);
  assert.equal(clusters.length, 2);
  const bratislava = clusters.find(c => c.items.length === 2);
  assert.equal(bratislava.precise, true);
});

test('automatický pohľad: všetci na Slovensku → stredná Európa, s New Yorkom → svet', () => {
  assert.equal(autoView([{ lat: 48.7, lon: 21.3 }, { lat: 48.1, lon: 17.1 }]), 'central');
  assert.equal(autoView([{ lat: 48.7, lon: 21.3 }, { lat: 51.5, lon: -0.1 }]), 'europe');
  assert.equal(autoView([{ lat: 48.7, lon: 21.3 }, { lat: 40.7, lon: -74 }]), 'world');
  assert.equal(autoView([]), 'world');
});
