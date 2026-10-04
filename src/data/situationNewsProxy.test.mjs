// src/data/situationNewsProxy.test.mjs — proxy situačných správ z vite.config.js so spoločnou
// bránou GDELT (2026-10-03). Test SPRÁVANIA celej cesty: v logu služby oko-api zlyhalo 165
// zo 188 dopytov na GDELT (128 × 429) a každá stavba regiónu čakala na odpoveď 429 ~8–12 s.
// Po prvej 429 musia ďalšie regióny GDELT preskočiť (žiadny dopyt), odpovedať z RSS
// vydavateľov a Google News a nečakať; región sa nikdy nesmie stratiť kvôli GDELT.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { situationNewsProxy } from '../../vite.config.js';
import { sharedGdeltGate } from './gdeltGate.js';

const rss = (titles) => `<?xml version="1.0"?><rss><channel>${titles.map((t, i) => `<item><title>${t}</title><link>https://example.org/a/${encodeURIComponent(t)}-${i}</link><pubDate>${new Date(Date.now() - i * 60_000).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;

function fakeRes() {
  const headers = {};
  const res = {
    statusCode: 200, body: null, headers,
    writeHead(status, h = {}) { res.statusCode = status; for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v; return res; },
    end(chunk) { res.body = chunk ?? null; return res; },
  };
  return res;
}

async function withProxy(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-snp-'));
  const cwd = process.cwd();
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('api.gdeltproject.org')) return new Response('Please limit requests to one every 5 seconds or contact kalev.leetaru5@gmail.com', { status: 429 });
    if (u.includes('news.google.com')) return new Response(rss(['Israeli strike hits Nabatieh', 'Drone attack near Isfahan', 'Strike on Khan Younis tent camp']), { status: 200 });
    return new Response(rss(['Israeli drone strike in south Lebanon kills two', 'Explosion reported in Tehran', 'Ceasefire talks on Gaza resume']), { status: 200 });
  };
  process.chdir(dir); // disková cache proxy ide do dočasného priečinka, nie do .gev-cache repa
  try {
    const plugin = situationNewsProxy();
    const routes = [];
    plugin.configureServer({ middlewares: { use(route, handler) { routes.push({ route, handler }); } } });
    const handler = routes.find((r) => r.route === '/api/situation-news').handler;
    const ask = async (region) => {
      const res = fakeRes();
      const started = Date.now();
      await handler({ method: 'GET', url: `/?region=${region}`, headers: { host: 'localhost:4173' }, socket: { remoteAddress: '127.0.0.1' } }, res);
      return { res, ms: Date.now() - started, json: res.body ? JSON.parse(res.body) : null };
    };
    await fn({ ask, calls });
  } finally {
    process.chdir(cwd);
    globalThis.fetch = realFetch;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('po 429 od GDELT ďalší región GDELT nepýta, odpovie zo záložných zdrojov a nečaká', async () => {
  await withProxy(async ({ ask, calls }) => {
    const first = await ask('lebanon');
    assert.equal(first.res.statusCode, 200);
    assert.ok(first.json.items.length > 0, 'región má správy aj bez GDELT');
    assert.doesNotMatch(first.json.source, /GDELT/, 'GDELT v zložení nie je, keď neodpovedal');
    assert.equal(calls.filter((u) => u.includes('gdeltproject')).length, 1, 'jeden pokus o GDELT');
    assert.ok(sharedGdeltGate().state().pausedUntil > Date.now(), '429 zapla pauzu brány');

    const gdeltBefore = calls.filter((u) => u.includes('gdeltproject')).length;
    const second = await ask('iran');
    assert.equal(second.res.statusCode, 200);
    assert.ok(second.json.items.length > 0);
    assert.equal(calls.filter((u) => u.includes('gdeltproject')).length, gdeltBefore, 'počas pauzy ani jeden dopyt na GDELT');
    assert.ok(second.ms < 3_000, `druhý región nečaká na GDELT (${second.ms} ms)`);
    assert.equal(sharedGdeltGate().state().skippedBackoff >= 1, true);
  });
});

test('neznámy región je 400 a GDELT sa vôbec nepýta', async () => {
  await withProxy(async ({ ask, calls }) => {
    const bad = await ask('atlantis');
    assert.equal(bad.res.statusCode, 400);
    assert.equal(calls.length, 0);
  });
});
