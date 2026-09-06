// src/photorealTileset.test.mjs
// Google 3D: Google priamo, pri EHP 403 cez Cesium ion (2026-09-06, „inak nefunguje mi google").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GOOGLE_3D_ION_ASSET_ID,
  PHOTOREAL_TILESET_OPTIONS,
  createPhotorealTileset,
  describe,
  isGoogleRegionBlocked,
} from './photorealTileset.js';

const EEA_MESSAGE = 'Your request cannot be served because satellite tiles and 3D tiles are not available for your account and region. Learn more here: https://developers.google.com/maps/comms/eea/map-tiles.';

test('ion asset je ten istý, ktorý Cesium používa interne, a tileset options zrkadlia Cesium defaulty', () => {
  assert.equal(GOOGLE_3D_ION_ASSET_ID, 2275207);
  const cesium = readFileSync(new URL('../node_modules/cesium/Build/CesiumUnminified/index.js', import.meta.url), 'utf8');
  assert.match(cesium, /const ionAssetId = 2275207;/, 'Cesium zmenil interný ion asset — over nový');
  assert.match(cesium, /cacheBytes \?\? 1536 \* 1024 \* 1024/);
  assert.equal(PHOTOREAL_TILESET_OPTIONS.cacheBytes, 1536 * 1024 * 1024);
  assert.equal(PHOTOREAL_TILESET_OPTIONS.maximumCacheOverflowBytes, 1024 * 1024 * 1024);
  assert.equal(PHOTOREAL_TILESET_OPTIONS.enableCollision, true);
});

test('EHP odmietnutie sa rozpozná podľa textu Google, iné chyby nie', () => {
  assert.equal(isGoogleRegionBlocked(new Error(EEA_MESSAGE)), true);
  assert.equal(isGoogleRegionBlocked({ statusCode: 403, response: EEA_MESSAGE }), true);
  assert.equal(isGoogleRegionBlocked(new Error('Requests from referer <empty> are blocked.')), false);
  assert.equal(isGoogleRegionBlocked({ statusCode: 429 }), false);
  assert.equal(isGoogleRegionBlocked(null), false);
});

test('describe nikdy nevynesie kľúč z URL v chybe', () => {
  const text = describe(new Error('Request failed https://tile.googleapis.com/v1/3dtiles/root.json?key=AIzaSECRET123&x=1'));
  assert.doesNotMatch(text, /AIzaSECRET123/);
  assert.match(text, /key=…/);
  assert.equal(describe({ statusCode: 503 }), 'HTTP 503');
  assert.equal(describe(undefined), '');
});

test('Google funguje → source google, ion sa nevolá', async () => {
  const calls = [];
  const result = await createPhotorealTileset({
    hasGoogleKey: true,
    hasIonToken: true,
    createGoogle: async (api, opts) => { calls.push(['google', api, opts]); return { id: 'g' }; },
    fromIonAssetId: async () => { calls.push(['ion']); return { id: 'i' }; },
  });
  assert.equal(result.source, 'google');
  assert.equal(result.tileset.id, 'g');
  assert.equal(result.googleError, null);
  assert.equal(result.regionBlocked, false);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], { onlyUsingWithGoogleGeocoder: true });
  assert.equal(calls[0][2].enableCollision, true);
});

test('Google 403 EHP + ion token → source ion s rovnakými options, googleError sa nesie ďalej', async () => {
  const calls = [];
  const result = await createPhotorealTileset({
    hasGoogleKey: true,
    hasIonToken: true,
    createGoogle: async () => { throw new Error(EEA_MESSAGE); },
    fromIonAssetId: async (assetId, opts) => { calls.push([assetId, opts]); return { id: 'i' }; },
  });
  assert.equal(result.source, 'ion');
  assert.equal(result.tileset.id, 'i');
  assert.equal(result.regionBlocked, true);
  assert.match(String(result.googleError?.message), /region/);
  assert.deepEqual(calls, [[2275207, { ...PHOTOREAL_TILESET_OPTIONS }]]);
});

test('bez ion tokenu sa fallback neskúša — chyba nesie googleError a regionBlocked', async () => {
  let ionCalled = false;
  await assert.rejects(
    createPhotorealTileset({
      hasGoogleKey: true,
      hasIonToken: false,
      createGoogle: async () => { throw new Error(EEA_MESSAGE); },
      fromIonAssetId: async () => { ionCalled = true; return {}; },
    }),
    (error) => error.regionBlocked === true && error.ionError === null && /region/.test(error.message),
  );
  assert.equal(ionCalled, false);
});

test('bez Google kľúča ide rovno ion; zlyhanie oboch = jedna chyba s oboma dôvodmi', async () => {
  const viaIon = await createPhotorealTileset({
    hasGoogleKey: false,
    hasIonToken: true,
    createGoogle: async () => { throw new Error('must not be called'); },
    fromIonAssetId: async () => ({ id: 'i' }),
  });
  assert.equal(viaIon.source, 'ion');
  assert.equal(viaIon.regionBlocked, false);

  await assert.rejects(
    createPhotorealTileset({
      hasGoogleKey: true,
      hasIonToken: true,
      createGoogle: async () => { throw new Error('Requests from referer <empty> are blocked.'); },
      fromIonAssetId: async () => { throw { statusCode: 401 }; },
    }),
    (error) => /Google: .*referer.*Cesium ion: HTTP 401/.test(error.message) && error.regionBlocked === false,
  );
});

test('tripwire: main.js používa createPhotorealTileset a controller dostáva dôvod aj zdroj', () => {
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /import \{ createPhotorealTileset, isGoogleRegionBlocked \} from '\.\/photorealTileset\.js';/);
  assert.match(main, /await createPhotorealTileset\(\{/);
  assert.doesNotMatch(main, /Cesium\.createGooglePhotorealistic3DTileset\(/, 'priame volanie by ion fallback obišlo');
  assert.match(main, /photorealUnavailableReason/);
  assert.match(main, /photorealSource/);
});
