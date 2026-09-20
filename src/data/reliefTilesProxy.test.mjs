// src/data/reliefTilesProxy.test.mjs — proxy normal dlaždíc: cesta, upstream URL,
// disková cache navždy, single-flight, chyby upstreamu, limiter, metódy.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import { RELIEF_MAX_LEVEL, parseReliefPath, reliefClientKey, reliefTilesProxy, reliefUpstreamUrl } from './reliefTilesProxy.js';

test('parseReliefPath: platné z/x/y, strop levelu, rozsah x/y, iný tvar = null', () => {
  assert.deepEqual(parseReliefPath('/12/2478/1406.png'), { z: 12, x: 2478, y: 1406 });
  assert.deepEqual(parseReliefPath('/0/0/0.png?v=1'), { z: 0, x: 0, y: 0 });
  assert.equal(parseReliefPath(`/${RELIEF_MAX_LEVEL + 1}/1/1.png`), null);
  assert.equal(parseReliefPath('/12/4096/1.png'), null, 'x mimo 2^z');
  assert.equal(parseReliefPath('/12/1/1.jpg'), null);
  assert.equal(parseReliefPath('/../etc/passwd'), null);
  assert.equal(reliefUpstreamUrl({ z: 12, x: 2478, y: 1406 }), 'https://s3.amazonaws.com/elevation-tiles-prod/normal/12/2478/1406.png');
});

test('reliefClientKey: CF-Connecting-IP za tunelom, inak socket', () => {
  assert.equal(reliefClientKey({ headers: { 'cf-connecting-ip': '1.2.3.4' }, socket: { remoteAddress: '::1' } }), '1.2.3.4');
  assert.equal(reliefClientKey({ headers: {}, socket: { remoteAddress: '::1' } }), '::1');
});

function fakeRes() {
  return { status: 0, headers: null, body: null, writeHead(s, h) { this.status = s; this.headers = h; }, end(b) { this.body = b; } };
}
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

test('handler: prvý GET ide na upstream a zapíše cache, druhý ide z disku bez fetchu; hlavičky immutable; single-flight', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'oko-relief-'));
  const calls = [];
  const plugin = reliefTilesProxy({ root, fetchImpl: async (url) => { calls.push(url); await new Promise((r) => setTimeout(r, 5)); return { ok: true, status: 200, headers: new Map([['content-type', 'image/png']]), arrayBuffer: async () => png }; }, log: () => {} });
  const req = { method: 'GET', url: '/12/2478/1406.png', headers: {}, socket: { remoteAddress: '::1' } };
  const [r1, r2] = [fakeRes(), fakeRes()];
  await Promise.all([plugin._handler(req, r1), plugin._handler(req, r2)]);
  assert.equal(calls.length, 1, 'súbežné požiadavky na tú istú dlaždicu = jeden fetch');
  assert.equal(r1.status, 200); assert.equal(r1.headers['Content-Type'], 'image/png');
  assert.match(r1.headers['Cache-Control'], /immutable/);
  assert.equal(r1.headers['X-OKO-Source'], 'upstream');
  assert.equal(Buffer.compare(r1.body, png), 0);
  const cached = await fsp.readFile(path.join(plugin._dir, '12', '2478', '1406.png'));
  assert.equal(Buffer.compare(cached, png), 0, 'cache na disku');
  const r3 = fakeRes();
  await plugin._handler(req, r3);
  assert.equal(calls.length, 1, 'z disku bez fetchu');
  assert.equal(r3.headers['X-OKO-Source'], 'cache');
  await fsp.rm(root, { recursive: true, force: true });
});

test('handler: zlá cesta 400, iná metóda 405, upstream 404 → 404 (bez zápisu), upstream 500 → 502, zlý typ → 502, limiter 429', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'oko-relief-'));
  let upstream = { ok: false, status: 404, headers: new Map(), arrayBuffer: async () => png };
  let t = 0;
  const plugin = reliefTilesProxy({ root, fetchImpl: async () => upstream, now: () => t, log: () => {} });
  const mk = (url, method = 'GET') => ({ method, url, headers: {}, socket: { remoteAddress: '::1' } });
  let res = fakeRes(); await plugin._handler(mk('/x/y/z.png'), res); assert.equal(res.status, 400);
  res = fakeRes(); await plugin._handler(mk('/12/1/1.png', 'POST'), res); assert.equal(res.status, 405);
  res = fakeRes(); await plugin._handler(mk('/12/1/1.png'), res); assert.equal(res.status, 404);
  await assert.rejects(fsp.stat(path.join(plugin._dir, '12', '1', '1.png')), 'chýbajúca dlaždica sa neukladá');
  upstream = { ok: false, status: 500, headers: new Map(), arrayBuffer: async () => png };
  res = fakeRes(); await plugin._handler(mk('/12/1/2.png'), res); assert.equal(res.status, 502);
  upstream = { ok: true, status: 200, headers: new Map([['content-type', 'text/html']]), arrayBuffer: async () => png };
  res = fakeRes(); await plugin._handler(mk('/12/1/3.png'), res); assert.equal(res.status, 502);
  upstream = { ok: true, status: 200, headers: new Map([['content-type', 'image/png']]), arrayBuffer: async () => png };
  for (let i = 0; i < 900; i += 1) { res = fakeRes(); await plugin._handler(mk(`/13/${i}/1.png`), res); }
  res = fakeRes(); await plugin._handler(mk('/13/905/1.png'), res); assert.equal(res.status, 429, '901. požiadavka v minúte = 429');
  t = 61_000;
  res = fakeRes(); await plugin._handler(mk('/13/906/1.png'), res); assert.equal(res.status, 200, 'po minúte znova');
  await fsp.rm(root, { recursive: true, force: true });
});

test('plugin sa registruje pod /api/relief (dev aj preview)', () => {
  const used = [];
  const plugin = reliefTilesProxy({ root: os.tmpdir() });
  const server = { middlewares: { use(p) { used.push(p); } } };
  plugin.configureServer(server); plugin.configurePreviewServer(server);
  assert.deepEqual(used, ['/api/relief', '/api/relief']);
  assert.equal(plugin.name, 'oko-relief-tiles');
});
