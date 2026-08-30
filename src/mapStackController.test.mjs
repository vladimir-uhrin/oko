import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { MAP_STACKS, MapStackController } from './mapStackController.js';

// ÚGKK Ortofotomozaika SR — SK stack (OKO, Fáza 1). Podmienky služby a limity
// preverenia sú v DATA_SOURCES.md a docs/SK-NOTES.md; tieto testy pinnú
// descriptor a provider tak, aby sa šetrný tvar (512 px, SR rectangle, jediná
// čistá vrstva) nedal omylom rozbiť.

const ugkk = () => MAP_STACKS.find((stack) => stack.id === 'ugkk-ortofoto');

test('ÚGKK stack descriptor je keyless WMS s čistou mozaikovou vrstvou', () => {
  const stack = ugkk();
  assert.ok(stack, 'stack ugkk-ortofoto chýba v MAP_STACKS');
  assert.equal(stack.kind, 'wms');
  assert.equal(stack.requiresIon, false);
  assert.equal(new URL(stack.wms.url).host, 'zbgisws.skgeodesy.sk');
  assert.ok(stack.wms.url.startsWith('https://'));
  // Vrstva '1' = Ortofoto; '2'/'3' (Footprint/Boundary) kreslia zelený klad
  // cez celú mozaiku — do podkladu nepatria.
  assert.equal(stack.wms.layers, '1');
  assert.equal(stack.wms.tileSize, 512);
  assert.ok(Number.isInteger(stack.wms.maximumLevel) && stack.wms.maximumLevel <= 20);
  assert.match(stack.wms.credit, /GKÚ/);
});

test('ÚGKK stack je dostupný bez ion tokenu aj bez Google tilesetu', () => {
  const controller = new MapStackController({}, {});
  assert.equal(controller.isStackAvailable('ugkk-ortofoto'), true);
  assert.equal(controller.isStackAvailable('bing-aerial'), false);
  assert.equal(controller.isStackAvailable('photoreal'), false);
});

test('provider je WMS s 512 px dlaždicami, orezaný na SR a cachovaný', async () => {
  const controller = new MapStackController({}, {});
  const stack = ugkk();
  const provider = await controller._getImageryProvider(stack);

  assert.ok(provider instanceof Cesium.WebMapServiceImageryProvider);
  assert.equal(provider.tileWidth, 512);
  assert.equal(provider.tileHeight, 512);
  assert.equal(provider.maximumLevel, stack.wms.maximumLevel);

  // Rectangle musí pokrývať SR a nesmie byť celoglobálny — mimo pokrytia
  // mozaiky sa nesmie generovať žiadny request na verejnú službu GKÚ.
  const r = provider.rectangle;
  const [west, south, east, north] = stack.wms.rectangleDegrees;
  const close = (rad, deg) => Math.abs(Cesium.Math.toDegrees(rad) - deg) < 0.01;
  assert.ok(close(r.west, west) && close(r.south, south), 'rectangle nesedí na SR (JZ roh)');
  assert.ok(close(r.east, east) && close(r.north, north), 'rectangle nesedí na SR (SV roh)');
  assert.ok(Cesium.Math.toDegrees(r.east) - Cesium.Math.toDegrees(r.west) < 10, 'rectangle je podozrivo široký');

  assert.match(provider.credit?.html ?? String(provider.credit), /GKÚ/);

  const again = await controller._getImageryProvider(stack);
  assert.equal(again, provider, 'provider sa má cachovať per stack');
});
