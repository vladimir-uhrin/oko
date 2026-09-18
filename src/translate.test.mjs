import assert from 'node:assert/strict';
import test from 'node:test';

import { translateText, translateCacheKey, _clearTranslateCache } from './translate.js';

test('translateCacheKey is per (target-language, text)', () => {
  assert.equal(translateCacheKey('Hello', 'sk'), 'sk|Hello');
  assert.notEqual(translateCacheKey('Hello', 'sk'), translateCacheKey('Hello', 'cs'));
});

test('translateText hits the proxy once per (to,text), sharing in-flight and caching', async () => {
  _clearTranslateCache();
  let calls = 0;
  const fetcher = async () => { calls += 1; return { ok: true, json: async () => ({ text: 'Ahoj' }) }; };
  const a = translateText('Hello', 'sk', { fetcher });
  const b = translateText('Hello', 'sk', { fetcher }); // shares the in-flight promise
  assert.equal(await a, 'Ahoj');
  assert.equal(await b, 'Ahoj');
  assert.equal(await translateText('Hello', 'sk', { fetcher }), 'Ahoj'); // cache hit
  assert.equal(calls, 1, 'one upstream call for the same text');
});

test('translateText returns the original on empty input or any failure', async () => {
  _clearTranslateCache();
  assert.equal(await translateText('', 'sk'), '');
  assert.equal(await translateText('Hi', 'sk', { fetcher: async () => ({ ok: false, json: async () => null }) }), 'Hi');
  assert.equal(await translateText('Yo', 'sk', { fetcher: async () => { throw new Error('net'); } }), 'Yo');
});
