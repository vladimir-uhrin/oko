// Server sa pýta sám seba (Štúdio, kontrola feedov, stav v admine) — musí trafiť aj server, ktorý počúva
// len na IPv6 ::1. Tak beží služba oko-api (Vite --host localhost na Windows); natvrdo 127.0.0.1 tam
// skončilo ECONNREFUSED a Štúdio nevyrobilo ani jeden návrh (2026-10-04). Testy so skutočným spojením —
// ostatné testy podstrkujú falošné fetchJson/fetchStatus/fetchFeed, preto to nezachytili.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { loopbackJson } from './studio/index.js';
import { loopbackStatus } from './runtime.js';
import { loopbackGet } from '../../auth/server/adminSources.js';

async function serve(t, host) {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, path: req.url, host: req.headers.host }));
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, host, resolve); });
  } catch (error) {
    return null; // stroj bez IPv6 (alebo bez IPv4) — tento variant sa preskočí
  }
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server.address().port;
}

for (const host of ['::1', '127.0.0.1']) {
  test(`server počúva len na ${host}: Štúdio, kontrola feedov aj stav v admine ho nájdu`, async t => {
    const port = await serve(t, host);
    if (!port) return t.skip(`${host} nie je na tomto stroji k dispozícii`);
    const studio = await loopbackJson(port, '/api/launches');
    assert.equal(studio.status, 200, 'Štúdio (loopbackJson)');
    assert.deepEqual([studio.body.ok, studio.body.path], [true, '/api/launches']);
    assert.equal(studio.body.host, `localhost:${port}`, 'Host hlavička ostáva localhost');
    assert.equal((await loopbackStatus(port, '/api/meteo/status')).status, 200, 'kontrola feedov (loopbackStatus)');
    const admin = await loopbackGet(port, '/api/tomtom/status', 5000);
    assert.deepEqual([admin.status, admin.body?.path], [200, '/api/tomtom/status'], 'stav v admine (loopbackGet)');
  });
}
