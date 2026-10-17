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
  isMinuteRateLimited,
  photorealRetryPaths,
  EEA_BLOCK_STORAGE_KEY,
  EEA_BLOCK_TTL_MS,
  readEeaBlock,
  writeEeaBlock,
  rememberedEeaError,
  shouldRememberEea,
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
  // 2026-09-15: vypnuté, aby šikmý pohľad nízko nad zemou nevykresľoval
  // roztrhaný pás z hrubých dlaždíc (Google aj ion fallback).
  assert.equal(PHOTOREAL_TILESET_OPTIONS.dynamicScreenSpaceError, false);
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

test('minútový limit (429 RESOURCE_EXHAUSTED „per minute") sa rozpozná; denný limit, EHP 403 ani sieť nie', () => {
  const body = JSON.stringify({ error: { code: 429, message: "Quota exceeded for quota metric '3D Tiles root requests' and limit '3D Tiles root requests per minute' of service 'tile.googleapis.com'", status: 'RESOURCE_EXHAUSTED' } });
  assert.equal(isMinuteRateLimited({ statusCode: 429, response: body }), true);
  assert.equal(isMinuteRateLimited({ statusCode: 429 }), true, 'stav stačí aj bez tela');
  assert.equal(isMinuteRateLimited(new Error(body)), true, 'text bez stavu');
  assert.equal(isMinuteRateLimited({ statusCode: 429, response: body.replace('per minute', 'per day') }), false);
  assert.equal(isMinuteRateLimited({ statusCode: 403, response: EEA_MESSAGE }), false);
  assert.equal(isMinuteRateLimited({ statusCode: 0 }), false);
  assert.equal(isMinuteRateLimited(null), false);
  assert.deepEqual(photorealRetryPaths({ googleError: { statusCode: 403, response: EEA_MESSAGE }, ionError: { statusCode: 429 } }), { google: false, ion: true });
  assert.deepEqual(photorealRetryPaths({ googleError: { statusCode: 429 }, ionError: { statusCode: 401 } }), { google: true, ion: false });
  assert.equal(photorealRetryPaths({ googleError: new Error(EEA_MESSAGE), ionError: { statusCode: 401 } }), null);
  assert.equal(photorealRetryPaths(new Error('crawler')), null);
});

test('priorGoogleError: Google sa nevolá, jeho chyba stojí za neho (aj regionBlocked), ion ide', async () => {
  let googleCalled = false;
  const prior = new Error(EEA_MESSAGE);
  const result = await createPhotorealTileset({
    hasGoogleKey: true,
    hasIonToken: true,
    priorGoogleError: prior,
    createGoogle: async () => { googleCalled = true; return {}; },
    fromIonAssetId: async () => ({ id: 'i' }),
  });
  assert.equal(googleCalled, false);
  assert.equal(result.source, 'ion');
  assert.equal(result.googleError, prior);
  assert.equal(result.regionBlocked, true);
});

test('EHP 403 zapamätané na 24 h: platnosť, poškodená hodnota, výnimka úložiska', () => {
  const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
  const s = mem();
  const t = 1_800_000_000_000;
  assert.equal(readEeaBlock(s, t), false, 'bez záznamu');
  assert.equal(writeEeaBlock(s, t), true);
  assert.equal(s.m.get(EEA_BLOCK_STORAGE_KEY), String(t));
  assert.equal(readEeaBlock(s, t + 60_000), true);
  assert.equal(readEeaBlock(s, t + EEA_BLOCK_TTL_MS - 1), true);
  assert.equal(readEeaBlock(s, t + EEA_BLOCK_TTL_MS), false, 'po 24 h znova skúsiť Google');
  assert.equal(readEeaBlock(s, t - 1000), false, 'čas z budúcnosti (posunuté hodiny) neplatí');
  assert.equal(EEA_BLOCK_TTL_MS, 24 * 3600 * 1000);
  s.setItem(EEA_BLOCK_STORAGE_KEY, 'nezmysel');
  assert.equal(readEeaBlock(s, t), false);
  const broken = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceeded'); } };
  assert.equal(readEeaBlock(broken, t), false);
  assert.equal(writeEeaBlock(broken, t), false);
  assert.equal(readEeaBlock(null, t), false);
});

test('príznak zapisuje len skutočne zistené EHP 403 — nie zapamätaná chyba, 429 ani iné', () => {
  assert.equal(isGoogleRegionBlocked(rememberedEeaError()), true, 'zapamätaná chyba hovorí pravdu o EHP');
  assert.equal(shouldRememberEea({ regionBlocked: true, googleError: new Error(EEA_MESSAGE) }), true);
  assert.equal(shouldRememberEea({ regionBlocked: true, googleError: { statusCode: 403, response: EEA_MESSAGE } }), true);
  assert.equal(shouldRememberEea({ regionBlocked: true, googleError: rememberedEeaError() }), false, 'inak by sa príznak predlžoval donekonečna');
  assert.equal(shouldRememberEea({ regionBlocked: false, googleError: { statusCode: 429 } }), false);
  assert.equal(shouldRememberEea(null), false);
});

test('s platným príznakom sa Google kľúč nevolá, ion ide a regionBlocked ostáva pravdivé', async () => {
  let googleCalls = 0;
  const result = await createPhotorealTileset({
    hasGoogleKey: true,
    hasIonToken: true,
    priorGoogleError: rememberedEeaError(),
    createGoogle: async () => { googleCalls += 1; return {}; },
    fromIonAssetId: async () => ({ id: 'i' }),
  });
  assert.equal(googleCalls, 0);
  assert.equal(result.source, 'ion');
  assert.equal(result.regionBlocked, true);
  assert.equal(shouldRememberEea(result), false);
});

test('zapojenie: main.js číta príznak pred načítaním a zapisuje ho po skutočnom EHP 403 (úspech aj zlyhanie)', () => {
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /const eeaRemembered = readEeaBlock\(eeaStorage\(\)\);\n\s+const photoreal = await createPhotorealTileset\(\{/);
  assert.match(main, /priorGoogleError: eeaRemembered \? rememberedEeaError\(\) : null,\n\s+\}\);\n\s+if \(shouldRememberEea\(photoreal\)\) writeEeaBlock\(eeaStorage\(\)\);/);
  assert.match(main, /if \(shouldRememberEea\(tileError\)\) writeEeaBlock\(eeaStorage\(\)\);/);
  assert.match(main, /const eeaStorage = \(\) => \{ try \{ return window\.localStorage; \} catch \{ return null; \} \};/);
});

test('tripwire: main.js používa createPhotorealTileset a controller dostáva dôvod aj zdroj', () => {
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /import \{ createPhotorealTileset, isGoogleRegionBlocked[^}]*\} from '\.\/photorealTileset\.js';/);
  assert.match(main, /tilesetOptions: photorealTilesetOptions\(\{ lowMemory \}\)/, 'mobil dostane menšiu cache (2026-10-15)');
  assert.match(main, /await createPhotorealTileset\(\{/);
  assert.doesNotMatch(main, /Cesium\.createGooglePhotorealistic3DTileset\(/, 'priame volanie by ion fallback obišlo');
  assert.match(main, /photorealUnavailableReason/);
  assert.match(main, /photorealSource/);
});
