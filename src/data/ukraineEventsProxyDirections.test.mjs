// src/data/ukraineEventsProxyDirections.test.mjs — /api/ukraine/events/directions
// (karta smeru, B5): odseky smerov z archívu, strop 92 dní, cache 10 min. Bez siete.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { promises as fsp } from 'node:fs';

import { DIRECTIONS_MAX_DAYS, ukraineEventsProxy } from './ukraineEventsProxy.js';

const NOW = Date.UTC(2026, 8, 23, 12);
function fakeRes() {
  const out = { status: 0, headers: {}, body: null };
  return { out, writeHead(s, h) { out.status = s; out.headers = h; }, end(b) { out.body = b; } };
}
const decode = (res) => JSON.parse((res.out.headers['Content-Encoding'] === 'gzip' ? zlib.gunzipSync(res.out.body) : res.out.body).toString('utf8'));
async function call(plugin, url) {
  const server = { middlewares: { use: (p, h) => { server.handler = h; } }, httpServer: null };
  plugin.configureServer(server);
  const res = fakeRes();
  await server.handler({ method: 'GET', url, headers: {}, socket: { remoteAddress: '127.0.0.1' } }, res);
  return res;
}

test('/directions: dni s hlásením, strop rozsahu, zlý deň, cache', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'oko-ukr-dirproxy-'));
  const dir = path.join(root, '.gev-cache', 'ukraine', 'events', 'reports');
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, '2026-09-22.json');
  await fsp.writeFile(file, JSON.stringify({ total: 248, reportedAt: '2026-09-22T05:00:00.000Z', reportedAtText: '08:00 22.9.', directions: [{ gs: 'Лиманський', attacks: 5, text: 'На Лиманському…', shared: false }] }));
  const plugin = ukraineEventsProxy({ root, env: { UKRAINE_ARCHIVE: 'off' }, fetchImpl: async () => { throw new Error('bez siete'); }, now: () => NOW, setTimer: () => 0, clearTimer: () => {}, log: () => {} });

  const ok = await call(plugin, '/directions?from=2026-09-20&to=2026-09-23');
  assert.equal(ok.out.status, 200);
  const json = decode(ok);
  assert.deepEqual(Object.keys(json.days), ['2026-09-22']);
  assert.equal(json.days['2026-09-22'].directions[0].attacks, 5);
  assert.equal(json.days['2026-09-22'].reportedAtText, '08:00 22.9.');

  assert.equal(DIRECTIONS_MAX_DAYS, 92);
  const long = await call(plugin, '/directions?from=2026-06-01&to=2026-09-23');
  assert.equal(long.out.status, 400);
  assert.equal(decode(long).error, 'range_too_long');
  assert.equal((await call(plugin, '/directions?from=zle&to=2026-09-23')).out.status, 400);

  // Cache: zmena na disku sa do 10 min neprejaví (archív sa mení raz za hodinu).
  await fsp.writeFile(file, JSON.stringify({ total: 1, directions: [] }));
  assert.equal(decode(await call(plugin, '/directions?from=2026-09-20&to=2026-09-23')).days['2026-09-22'].total, 248);
});
