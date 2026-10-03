import test from 'node:test';
import assert from 'node:assert/strict';
import { openAuthStore } from './store.js';
import { createAdminSources, redactStatus, createBackup, listBackups } from './adminSources.js';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openAdminStore } from '../../admin/server/store.js';
import { createAdminRuntime } from '../../admin/server/runtime.js';
import { credentials, fixture } from './account-test-helpers.mjs';

const owner = { email: 'owner@oko.test', password: 'owner password phrase long', displayName: 'Owner' };

async function setup(t, options = {}) {
  const env = await fixture(t, options);
  env.store.createOwner(owner.email, owner.displayName, `test:${owner.password}`, env.clock.time);
  const admin = env.client();
  assert.equal((await admin.login(owner)).status, 200);
  const member = env.client();
  const registered = await member.register();
  assert.equal(registered.status, 201);
  return { ...env, admin, member, memberId: registered.data.user.id };
}

test('admin API je neviditeľné pre anonyma aj člena (404), vlastník dostane prehľad', async t => {
  const { client, admin, member } = await setup(t);
  for (const route of ['/api/admin/overview', '/api/admin/users', '/api/admin/audit', '/api/admin/nope']) {
    assert.equal((await client().request(route)).status, 404, `anon ${route}`);
    assert.equal((await member.request(route)).status, 404, `member ${route}`);
  }
  const overview = await admin.request('/api/admin/overview');
  assert.equal(overview.status, 200);
  assert.equal(overview.headers.get('cache-control'), 'no-store');
  assert.equal(overview.data.stats.users, 2);
  assert.equal(overview.data.stats.activeUsers, 2);
  assert.equal(overview.data.stats.new24h, 2);
  assert.equal((await admin.request('/api/admin/nope')).status, 404);
  assert.equal((await admin.post('/api/admin/overview')).status, 405);
});

test('zoznam, hľadanie (LIKE escapovaný) a detail účtu', async t => {
  const { admin, memberId } = await setup(t);
  const all = await admin.request('/api/admin/users');
  assert.equal(all.data.total, 2);
  assert.ok(all.data.users.every(user => !('password_hash' in user) && !('passwordHash' in user)));
  const found = await admin.request('/api/admin/users?q=member');
  assert.deepEqual(found.data.users.map(user => user.id), [memberId]);
  assert.equal((await admin.request('/api/admin/users?q=%25')).data.total, 0, '% je doslovný znak, nie zástupný');
  const detail = await admin.request(`/api/admin/users/${memberId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.user.email, credentials.email);
  assert.equal(detail.data.user.sessions.length, 1);
  assert.ok(!JSON.stringify(detail.data).includes('test:'), 'žiadny hash hesla');
  assert.equal((await admin.request('/api/admin/users/00000000-0000-0000-0000-000000000000')).status, 404);
});

test('zápis bez CSRF alebo z cudzieho pôvodu neprejde', async t => {
  const { admin, memberId } = await setup(t);
  const route = `/api/admin/users/${memberId}/revoke-sessions`;
  assert.equal((await admin.post(route, {}, { headers: { 'X-CSRF-Token': '' } })).status, 403);
  assert.equal((await admin.post(route, {}, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await admin.request(`/api/admin/users/${memberId}`)).data.user.sessions.length, 1);
});

test('odhlásenie relácií člena sa zapíše do auditu aj do jeho aktivity', async t => {
  const { admin, member, memberId, store } = await setup(t);
  const result = await admin.post(`/api/admin/users/${memberId}/revoke-sessions`);
  assert.equal(result.status, 200);
  assert.equal(result.data.revoked, 1);
  assert.equal((await member.request('/api/account')).status, 401);
  const audit = await admin.request('/api/admin/audit');
  assert.equal(audit.data.audit[0].action, 'sessions_revoked');
  assert.equal(audit.data.audit[0].actorEmail, owner.email);
  assert.ok(store.adminUser(memberId, Date.now(), 86400_000).events.some(event => event.type === 'admin_sessions_revoked'));
});

test('zablokovaný účet stratí relácie a neprihlási sa; odblokovanie to vráti', async t => {
  const { admin, member, memberId, client } = await setup(t);
  const disabled = await admin.post(`/api/admin/users/${memberId}/disable`);
  assert.equal(disabled.status, 200);
  assert.ok(disabled.data.user.disabledAt);
  assert.equal((await member.request('/api/account')).status, 401);
  const wrong = await client().login({ email: credentials.email, password: 'definitely the wrong password' });
  assert.equal(wrong.data.error, 'invalid_credentials', 'bez hesla sa zablokovanie neprezradí');
  const blocked = await client().login(credentials);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.error, 'account_disabled');
  assert.equal((await admin.request('/api/admin/overview')).data.stats.disabled, 1);
  assert.equal((await admin.post(`/api/admin/users/${memberId}/enable`)).status, 200);
  assert.equal((await client().login(credentials)).status, 200);
});

test('zmazanie vyžaduje presný e-mail; audit neuchová e-mail zmazaného', async t => {
  const { admin, member, memberId } = await setup(t);
  const route = `/api/admin/users/${memberId}`;
  const mismatch = await admin.request(route, { method: 'DELETE', body: { confirm: 'someone@else.test' } });
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.data.error, 'confirm_mismatch');
  assert.equal((await admin.request(route, { method: 'DELETE', body: { confirm: credentials.email, extra: 1 } })).status, 400);
  const deleted = await admin.request(route, { method: 'DELETE', body: { confirm: credentials.email } });
  assert.equal(deleted.status, 200);
  assert.equal((await admin.request(route)).status, 404);
  assert.equal((await member.request('/api/account')).status, 401);
  const audit = await admin.request('/api/admin/audit');
  assert.equal(audit.data.audit[0].action, 'user_deleted');
  assert.ok(!JSON.stringify(audit.data).includes(credentials.email));
});

test('vlastník nezasiahne sám seba', async t => {
  const { admin, store } = await setup(t);
  const ownerId = store.userByEmail(owner.email).id;
  for (const action of ['disable', 'revoke-sessions']) {
    const result = await admin.post(`/api/admin/users/${ownerId}/${action}`);
    assert.equal(result.status, 409);
    assert.equal(result.data.error, 'owner_protected');
  }
  assert.equal((await admin.request(`/api/admin/users/${ownerId}`, { method: 'DELETE', body: { confirm: owner.email } })).status, 409);
});

test('feedy a server idú zo zdrojov; kľúče sa redigujú', async t => {
  const sources = { feeds: async () => [{ id: 'x', ok: true }], server: () => ({ node: 'v0' }), log: async () => 'line\n' };
  const { admin } = await setup(t, { adminSources: sources });
  assert.deepEqual((await admin.request('/api/admin/feeds')).data.feeds, [{ id: 'x', ok: true }]);
  assert.equal((await admin.request('/api/admin/overview')).data.server.node, 'v0');
  assert.equal((await admin.request('/api/admin/log')).data.log, 'line\n');
  assert.deepEqual(redactStatus({ hasKey: true, keyLength: 32, tokenLength: 40, apiKey: 'x', nested: [{ secret: 1, ok: 2 }], dailyCount: 3 }),
    { hasKey: true, nested: [{ ok: 2 }], dailyCount: 3 });
});

test('createAdminSources číta status cez loopback a sumarizuje CCTV', async () => {
  const calls = [];
  const sources = createAdminSources({ root: '/nonexistent', dbFile: '/nonexistent/db', port: () => 4173,
    fetchFeed: async (port, path) => {
      calls.push(`${port}${path}`);
      if (path === '/api/cctv/health') return { status: 200, ms: 1, body: { cameras: [{ status: 'ok' }, { status: 'ok' }, { status: 'error' }] } };
      if (path === '/api/tomtom/status') return { status: 200, ms: 2, body: { hasKey: true, tokenLength: 9, dailyCount: 5, budget: 10 } };
      return { status: 0, ms: 8000, body: null, error: 'timeout' };
    } });
  const feeds = await sources.feeds();
  assert.ok(calls.includes('4173/api/tomtom/status'));
  const tomtom = feeds.find(feed => feed.id === 'tomtom');
  assert.deepEqual(tomtom.data, { hasKey: true, dailyCount: 5, budget: 10 });
  assert.deepEqual(feeds.find(feed => feed.id === 'cctv').data, { cameras: 3, states: { ok: 2, error: 1 } });
  assert.equal(feeds.find(feed => feed.id === 'meteo').ok, false);
  const before = calls.length;
  await sources.feeds();
  assert.equal(calls.length, before, '30 s cache — žiadne opakované dopyty');
  assert.equal(await sources.log(), '');
});

test('stĺpec disabled_at sa pridá aditívne a opätovné otvorenie DB prejde', () => {
  const store = openAuthStore(':memory:');
  assert.equal(store.adminStats(Date.now(), 86400_000).disabled, 0);
  store.close();
});

// ── Rozšírenie 2026-10-03: telemetria, vypínače, oznam, údržba ──

async function setupWithRuntime(t) {
  const adminStore = openAdminStore(':memory:');
  const runtime = createAdminRuntime({ store: adminStore, timers: false });
  const directory = mkdtempSync(path.join(tmpdir(), 'oko-admin-backup-'));
  const dbFile = path.join(directory, 'accounts.sqlite');
  t.after(() => { runtime.stop(); adminStore.close(); rmSync(directory, { recursive: true, force: true }); });
  const env = await setup(t, { adminSources: {
    runtime: () => runtime, quotaStatus: async () => ({ tomtom: { dailyCount: 7, budget: 100, hasKey: true } }),
    backups: () => listBackups(dbFile), backup: targets => createBackup(dbFile, targets),
    cacheDirs: async () => [], clearCache: async () => ({ removed: 0, freed: 0 }),
  } });
  return { ...env, runtime, adminStore, directory };
}

test('nové admin cesty sú pre člena 404 a vlastník ich dostane', async t => {
  const { admin, member } = await setupWithRuntime(t);
  for (const route of ['/api/admin/analytics', '/api/admin/traffic', '/api/admin/errors', '/api/admin/costs',
    '/api/admin/feed-history', '/api/admin/notice', '/api/admin/maintenance', '/api/admin/accounts-chart']) {
    assert.equal((await member.request(route)).status, 404, route);
    const response = await admin.request(route);
    assert.equal(response.status, 200, route);
  }
  const chart = await admin.request('/api/admin/accounts-chart?days=7');
  assert.equal(chart.data.series.length, 7);
  assert.equal(chart.data.series.at(-1).registrations, 2);
  const costs = await admin.request('/api/admin/costs');
  assert.equal(costs.data.feeds.find(feed => feed.id === 'tomtom').provider.dailyCount, 7);
});

test('vypínač feedu a oznam cez API: CSRF, validácia, audit', async t => {
  const { admin, member, runtime } = await setupWithRuntime(t);
  assert.equal((await member.post('/api/admin/feeds/tomtom', { enabled: false })).status, 404);
  assert.equal((await admin.post('/api/admin/feeds/tomtom', { enabled: false }, { headers: { 'X-CSRF-Token': '' } })).status, 403);
  assert.equal((await admin.post('/api/admin/feeds/tomtom', { enabled: 'no' })).status, 400);
  assert.equal((await admin.post('/api/admin/feeds/nope', { enabled: false })).status, 404);
  const off = await admin.post('/api/admin/feeds/tomtom', { enabled: false });
  assert.equal(off.status, 200);
  assert.equal(runtime.feedSetting('tomtom').enabled, false);
  const cap = await admin.post('/api/admin/feeds/openai-voice', { dailyCap: 50, unitPrice: 0.06 });
  assert.equal(cap.data.setting.dailyCap, 50);
  assert.equal((await admin.post('/api/admin/notice', { text: 'Údržba', level: 'warn', hours: 2 })).status, 200);
  assert.equal(runtime.notice().notice.text, 'Údržba');
  assert.deepEqual(runtime.notice().disabled, ['TomTom doprava']);
  assert.equal((await admin.post('/api/admin/notice', { text: 'x'.repeat(300) })).status, 400);
  assert.equal((await admin.post('/api/admin/notice', { text: '' })).status, 200);
  assert.equal(runtime.notice().notice, null);
  const audit = (await admin.request('/api/admin/audit')).data.audit.map(entry => entry.action);
  assert.deepEqual(audit.slice(0, 4), ['notice_cleared', 'notice_set', 'feed_updated', 'feed_updated']);
});

test('chyby sa dajú vymazať; záloha vytvorí kópie oboch databáz', async t => {
  const { admin, runtime, directory } = await setupWithRuntime(t);
  runtime.recordError('client', 'Boom');
  runtime.recordError('server', 'Upstream down');
  assert.equal((await admin.request('/api/admin/errors')).data.errors.length, 2);
  assert.equal((await admin.request('/api/admin/errors?kind=client')).data.errors.length, 1);
  const cleared = await admin.request('/api/admin/errors', { method: 'DELETE', body: { kind: 'client' } });
  assert.equal(cleared.data.cleared, 1);
  assert.equal((await admin.request('/api/admin/errors')).data.errors.length, 1);
  const backup = await admin.post('/api/admin/maintenance/backup', {});
  assert.equal(backup.status, 200, JSON.stringify(backup.data));
  assert.equal(backup.data.made.length, 2);
  assert.deepEqual(readdirSync(path.join(directory, 'backups')).map(name => name.split('-')[0]).sort(), ['accounts', 'admin']);
  const reopened = openAdminStore(path.join(directory, 'backups', backup.data.made.find(name => name.startsWith('admin'))));
  assert.equal(reopened.errors().length, 1);
  reopened.close();
});
