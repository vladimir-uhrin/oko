// scripts/lib/serverRole.test.mjs — rola procesu Vite (2026-10-01, oddelenie verejného API od dev servera).
// Testy SPRÁVANIA: (1) čisté pravidlá roly; (2) skutočná konfigurácia vite.config.js v každej role —
// v role proxy nebeží záznam histórie, OpenSky ani zdieľanie (dva procesy by písali do jednej databázy
// a dvakrát míňali kredity) a /api aj /s idú na upstream; v role api nesleduje súbory ani HMR;
// bez premenných všetko ako doteraz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proxyConfig, resolveServerRole, roleServerOverrides, runsApiPlugins } from './serverRole.mjs';

test('rola: api / proxy na lokálny upstream / full; upstream mimo tohto počítača a neznáma rola = chyba', () => {
  assert.deepEqual(resolveServerRole({}), { role: 'full', upstream: null });
  assert.deepEqual(resolveServerRole({ OKO_ROLE: 'api', OKO_API_UPSTREAM: 'http://localhost:4175' }), { role: 'api', upstream: null }, 'api má prednosť — sám seba nepreposiela');
  assert.deepEqual(resolveServerRole({ OKO_API_UPSTREAM: 'http://localhost:4175/' }), { role: 'proxy', upstream: 'http://localhost:4175' });
  assert.deepEqual(resolveServerRole({ OKO_ROLE: 'dev', OKO_API_UPSTREAM: 'http://127.0.0.1:4175' }), { role: 'proxy', upstream: 'http://127.0.0.1:4175' });
  assert.throws(() => resolveServerRole({ OKO_API_UPSTREAM: 'https://okolive.sk' }), /localhost/, 'kľúče a súkromné API nesmú odísť z počítača');
  assert.throws(() => resolveServerRole({ OKO_API_UPSTREAM: 'http://localhost' }), /localhost:<port>/);
  assert.throws(() => resolveServerRole({ OKO_API_UPSTREAM: 'nie adresa' }), /neplatná/);
  assert.throws(() => resolveServerRole({ OKO_ROLE: 'produkcia' }), /neznáma rola/);
  assert.equal(runsApiPlugins({ role: 'proxy' }), false);
  assert.equal(runsApiPlugins({ role: 'api' }), true);
  assert.equal(runsApiPlugins({ role: 'full' }), true);
});

test('preposielanie: /api aj s WebSocketom, /s/<id> (nie /src/), bez zmeny Host a bez X-Forwarded-*', () => {
  const p = proxyConfig('http://localhost:4175');
  assert.deepEqual(p['/api'], { target: 'http://localhost:4175', ws: true, changeOrigin: false, xfwd: false });
  assert.ok(new RegExp('^/s/').test('/s/Ab12cd34EF.jpg'));
  assert.ok(!new RegExp('^/s/').test('/src/main.js'), 'zdrojáky dev servera sa nepreposielajú');
  assert.deepEqual(roleServerOverrides({ role: 'api' }), { watch: null, hmr: false });
  assert.deepEqual(roleServerOverrides({ role: 'full' }), {});
});

async function configFor(env) {
  const keys = ['OKO_ROLE', 'OKO_API_UPSTREAM'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  try {
    const { default: config } = await import('../../vite.config.js');
    const c = config({ mode: 'development', command: 'serve' });
    return { ...c, pluginNames: c.plugins.flat().filter(Boolean).map((p) => p.name) };
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

test('vite.config.js v role proxy: žiadny záznam histórie, OpenSky ani zdieľanie — /api a /s na oko-api; Cesium a preloader ostávajú', async () => {
  const c = await configFor({ OKO_API_UPSTREAM: 'http://localhost:4175' });
  for (const name of ['flight-history', 'opensky-proxy', 'oko-share', 'gbfs-proxy', 'oko-release-header']) {
    assert.ok(!c.pluginNames.includes(name), `${name} v role proxy nebeží`);
  }
  assert.ok(c.pluginNames.includes('oko-preloader-cache-bust'), 'stránka sa ďalej skladá lokálne');
  assert.equal(c.server.proxy['/api'].target, 'http://localhost:4175');
  assert.ok(c.server.proxy['^/s/']);
  assert.equal(c.optimizeDeps, undefined);
});

test('vite.config.js v role api: všetky API pluginy, bez sledovania súborov a HMR, bez predprípravy závislostí; bez premenných ako doteraz', async () => {
  const api = await configFor({ OKO_ROLE: 'api' });
  for (const name of ['flight-history', 'opensky-proxy', 'oko-share', 'oko-release-header']) assert.ok(api.pluginNames.includes(name), name);
  assert.equal(api.server.watch, null, 'kópia commitu sa nemení — žiadne reštarty pri úprave pracovného stromu');
  assert.equal(api.server.hmr, false);
  assert.equal(api.server.proxy, undefined);
  assert.deepEqual(api.optimizeDeps, { noDiscovery: true, include: [] });
  const full = await configFor({});
  assert.ok(full.pluginNames.includes('flight-history') && full.pluginNames.includes('opensky-proxy'));
  // .auth-data: oko-api tam zapisuje videá Štúdia — zamknuté mp4 zabilo oko-dev cez EBUSY (2026-10-04).
  assert.deepEqual(full.server.watch, { ignored: ['**/.gev-cache/**', '**/qa-shots/**', '**/.auth-data/**', '**/.gev-logs/**'] });
  assert.equal(full.server.proxy, undefined);
});
