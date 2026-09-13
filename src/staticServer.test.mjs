// src/staticServer.test.mjs
// Statický server pre produkčný build za verejným tunelom (2026-09-14):
// spustí scripts/oko-static-server.mjs nad dočasným „dist", overí index
// (no-cache + noindex), nemenné assety (immutable + ETag/304), robots.txt,
// 404, zákaz path traversal, /api → 502 (patrí dev serveru), HEAD.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';

const SCRIPT = new URL('../scripts/oko-static-server.mjs', import.meta.url);

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}

async function waitFor(url, tries = 50) {
  for (let i = 0; i < tries; i += 1) {
    try { const r = await fetch(url); if (r.status) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start: ${url}`);
}

test('oko-static-server: index no-cache + noindex, assets immutable + ETag/304, robots, 404, traversal, /api = 502, HEAD', async () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'oko-dist-'));
  mkdirSync(path.join(dist, 'assets'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>OKO</title><script type="module" src="/assets/index-abc.js"></script>');
  writeFileSync(path.join(dist, 'assets', 'index-abc.js'), 'console.log("oko")');
  writeFileSync(path.join(dist, 'logo.svg'), '<svg></svg>');
  const port = await freePort();
  const child = spawn(process.execPath, [SCRIPT.pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--port', String(port), '--dir', dist], { stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitFor(`${base}/robots.txt`);
    const index = await fetch(base + '/');
    assert.equal(index.status, 200);
    assert.equal(index.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(index.headers.get('cache-control'), 'no-cache', 'index sa vždy overuje — nový build musí byť vidieť hneď');
    assert.equal(index.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
    assert.match(await index.text(), /assets\/index-abc\.js/);
    const asset = await fetch(base + '/assets/index-abc.js');
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable', 'hashované assety sú nemenné → Cloudflare ich drží na hrane');
    assert.equal(asset.headers.get('content-type'), 'text/javascript; charset=utf-8');
    const etag = asset.headers.get('etag');
    assert.ok(etag);
    const notModified = await fetch(base + '/assets/index-abc.js', { headers: { 'if-none-match': etag } });
    assert.equal(notModified.status, 304);
    const svg = await fetch(base + '/logo.svg');
    assert.equal(svg.headers.get('content-type'), 'image/svg+xml');
    assert.equal(svg.headers.get('cache-control'), 'public, max-age=3600');
    const robots = await fetch(base + '/robots.txt');
    assert.equal(await robots.text(), 'User-agent: *\nDisallow: /\n');
    assert.equal((await fetch(base + '/nope.js')).status, 404);
    assert.equal((await fetch(base + '/assets/..%2F..%2Fpackage.json')).status, 403, 'zakódovaný traversal nevedie von z dist (Forbidden)');
    const api = await fetch(base + '/api/gas/status');
    assert.equal(api.status, 502);
    assert.equal((await api.json()).error, 'api_not_routed', '/api patrí dev serveru cez ingress cloudflared');
    const head = await fetch(base + '/assets/index-abc.js', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(readFileSync(path.join(dist, 'assets', 'index-abc.js')).length));
    assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
  } finally {
    child.kill();
  }
});
