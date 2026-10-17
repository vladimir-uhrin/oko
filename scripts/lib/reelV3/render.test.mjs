// Reel v3: stránka a súbory podáva zachytávanie požiadaviek — mapovanie URL → lokálny súbor.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveAsset } from './render.mjs';

test('engine.js je vždy vlastný súbor modulu', () => {
  assert.equal(path.basename(resolveAsset({}, '/engine.js')), 'engine.js');
});

test('presná cesta, priečinok s lomkou a neznáma cesta', () => {
  const files = { 'asset/basemap.json': 'C:/x/basemap.json', 'media/': 'D:/work/media' };
  assert.equal(resolveAsset(files, '/asset/basemap.json'), 'C:/x/basemap.json');
  assert.equal(resolveAsset(files, '/media/on56122-v2-1-4.14/00001.jpg'), path.join('D:/work/media', 'on56122-v2-1-4.14/00001.jpg'));
  assert.equal(resolveAsset(files, '/media/tabula%20fg.jpg'), path.join('D:/work/media', 'tabula fg.jpg'));
  assert.equal(resolveAsset(files, '/asset/chyba.json'), null);
});
