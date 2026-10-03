import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';
import { authPlugin } from './plugin.js';

test('configuration refuses a database inside publicly deployed directories', () => {
  for (const filename of ['public/accounts.sqlite', 'dist/accounts.sqlite', 'output/auth-build/accounts.sqlite']) {
    assert.throws(() => authPlugin({ AUTH_DB_PATH: filename }).config({ build: { outDir: 'output/auth-build' } }), /must not be inside/);
  }
});

test('actual Vite plugin leaves public routes open and denies DB/WAL/raw/file-system aliases', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'oko-auth-vite-test-'));
  const database = path.join(directory, 'private.accounts');
  const server = await createServer({ configFile: false, envFile: false, cacheDir: path.join(directory, 'vite'),
    plugins: [authPlugin({ AUTH_DB_PATH: database }), { name: 'public-fixture', configureServer(server) {
      server.middlewares.use('/api/public-fixture', (req, res) => res.end('public'));
    } }],
    server: { host: '127.0.0.1', port: 0, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'silent' });
  try {
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    const session = await fetch(base + '/api/auth/session');
    assert.equal(session.status, 200);
    assert.equal(session.headers.get('cache-control'), 'no-store');
    assert.equal((await session.json()).user, null);
    assert.equal((await fetch(base + '/api/account')).status, 401);
    assert.equal((await fetch(base + '/api/account/security')).status, 401);
    assert.equal((await fetch(base + '/api/account/export')).status, 401);
    for (const route of ['/api/account/verification', '/api/account/email', '/api/account/sessions/revoke']) {
      assert.equal((await fetch(base + route, { method: 'POST', headers: { Origin: base } })).status, 401);
    }
    assert.equal(await (await fetch(base + '/api/public-fixture')).text(), 'public');
    assert.equal((await fetch(base + '/logo.svg')).status, 200);
    const standalone = await fetch(base + '/account.html');
    assert.equal(standalone.status, 200);
    assert.equal(standalone.headers.get('cache-control'), 'no-store');
    assert.equal(standalone.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(standalone.headers.get('x-frame-options'), 'DENY');
    assert.match(standalone.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    // Admin panel (2026-10-03): stránka s rovnakými ochranami, API neprihlásenému neexistuje.
    const adminPage = await fetch(base + '/admin.html');
    assert.equal(adminPage.status, 200);
    assert.equal(adminPage.headers.get('cache-control'), 'no-store');
    assert.equal(adminPage.headers.get('x-frame-options'), 'DENY');
    assert.doesNotMatch(await adminPage.text(), /cesium/i);
    for (const route of ['/api/admin/overview', '/api/admin/feeds', '/api/admin/users']) {
      assert.equal((await fetch(base + route)).status, 404, route);
    }
    assert.ok([400, 403].includes((await fetch(base + '/src/auth/server/admin.js')).status));
    assert.ok([400, 403].includes((await fetch(base + '/api/%61dmin/overview')).status));
    for (const target of ['/.auth-data/accounts.sqlite', '/.auth-data/accounts.sqlite-wal?raw',
      '/@fs/' + database.replaceAll('\\', '/'), '/src/auth/server/store.js?raw', '/%2eauth-data/accounts.sqlite',
      '/api/%61ccount', '/api/%61ccount/security', '/api/account/%65xport']) {
      const result = await fetch(base + target);
      assert.ok([400, 403].includes(result.status), `${target}: ${result.status}`);
    }
    assert.ok(server.config.server.fs.deny.includes('.env'));
  } finally {
    await server.close();
    assert.ok(directory.startsWith(path.join(tmpdir(), 'oko-auth-vite-test-')));
    rmSync(directory, { recursive: true, force: true });
  }
});
