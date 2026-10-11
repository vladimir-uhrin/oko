// src/data/planespottersProxy.test.mjs — fotky lietadiel cez server (2026-10-11).
import test from 'node:test';
import assert from 'node:assert/strict';
import { hexFromPath, planespottersProxy } from './planespottersProxy.js';

const res = () => ({ writeHead(s, h) { this.s = s; this.h = h; }, end(b) { this.b = b; } });
const req = (url, ip = '1.2.3.4') => ({ method: 'GET', url, headers: {}, socket: { remoteAddress: ip } });

test('hex z cesty; zlý hex 400', async () => {
  assert.equal(hexFromPath('/hex/3C6444'), '3c6444');
  assert.equal(hexFromPath('/hex/3c64'), null);
  const p = planespottersProxy({ fetchImpl: async () => { throw new Error('no'); } });
  const r = res();
  await p._handler(req('/hex/zz'), r);
  assert.equal(r.s, 400);
});

test('upstream 200 → odpoveď a cache; 404 → {photos:[]} 200 (cache 6 h); 5xx → 502 bez cache; strop 120/min', async () => {
  const calls = [];
  let t = 1_000_000;
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith('/aaaaaa')) return { ok: true, status: 200, json: async () => ({ photos: [{ thumbnail: { src: 'https://x/t.jpg' }, link: 'https://x/p', photographer: 'P' }] }) };
    if (url.endsWith('/bbbbbb')) return { ok: false, status: 404 };
    return { ok: false, status: 503 };
  };
  const p = planespottersProxy({ fetchImpl, now: () => t });
  let r = res();
  await p._handler(req('/hex/aaaaaa'), r);
  assert.equal(r.s, 200);
  assert.equal(JSON.parse(r.b).photos[0].photographer, 'P');
  await p._handler(req('/hex/aaaaaa'), res());
  assert.equal(calls.length, 1, 'druhý dopyt z cache');
  r = res();
  await p._handler(req('/hex/bbbbbb'), r);
  assert.equal(r.s, 200);
  assert.deepEqual(JSON.parse(r.b), { photos: [] });
  await p._handler(req('/hex/bbbbbb'), res());
  assert.equal(calls.length, 2, 'bez fotky tiež v cache');
  t += 7 * 3600_000;
  await p._handler(req('/hex/bbbbbb'), res());
  assert.equal(calls.length, 3, 'po 6 h znova');
  r = res();
  await p._handler(req('/hex/cccccc'), r);
  assert.equal(r.s, 502);
  await p._handler(req('/hex/cccccc'), res());
  assert.equal(calls.length, 5, '502 sa nekešuje');
  for (let i = 0; i < 120; i += 1) await p._handler(req('/hex/aaaaaa', '9.9.9.9'), res());
  r = res();
  await p._handler(req('/hex/aaaaaa', '9.9.9.9'), r);
  assert.equal(r.s, 429);
});
