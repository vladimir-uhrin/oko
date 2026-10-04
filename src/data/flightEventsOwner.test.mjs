// src/data/flightEventsOwner.test.mjs — súkromné časti udalostí pod účtom vlastníka (2026-10-03, vlastník:
// „táto funkcia je len pre mňa, nemá byť verejná, tak by mala byť pod mojím účtom"). Testy SPRÁVANIA cez
// skutočný HTTP server so skutočnou službou účtu: zoznam a zverejnenie vidí vlastník prihlásený
// z „internetu" (nie lokálne), cudzí účet aj hosť dostanú 404 ako doteraz, zápis bez CSRF neprejde,
// lokálny prístup bez účtu ostáva; bez OKO_OWNER_EMAILS nikto zvonku.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openAuthStore } from '../auth/server/store.js';
import { createAuthService, parseOwnerEmails } from '../auth/server/http.js';
import { fastPasswords } from '../auth/server/account-test-helpers.mjs';
import { createFlightEventsService } from './flightEventsService.js';

const OWNER = { email: 'owner@example.com', password: 'the owner password phrase', displayName: 'Vlastník' };
const OTHER = { email: 'member@example.com', password: 'the member password phrase', displayName: 'Člen' };

async function fixture(t, { ownerEmails = 'owner@example.com' } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-events-owner-'));
  const store = openAuthStore(':memory:');
  const auth = createAuthService({ store, passwords: fastPasswords, mailer: { configured: false } });
  const owners = parseOwnerEmails(ownerEmails);
  const isOwner = (req, res, opts) => { const u = auth.identify(req, res, opts); return Boolean(u && owners.includes(u.email)); };
  const events = createFlightEventsService({
    getStore: () => ({ async triggersSince() { return []; }, async track() { return []; }, async flightsOf() { return []; } }),
    eventsDir: dir,
    // „Internet": nič nie je lokálne — len účet rozhoduje.
    isLocal: (req) => req.headers['x-test-local'] === '1',
    isOwner,
    log: () => {},
    tickMs: 3_600_000,
  });
  // Udalosť v úložisku (neoverená — stačí na zoznam a detail).
  events.store.save({ id: 'abc123-20260922T1320', icao24: 'abc123', callsign: 'TEST1', status: 'unverified', firstT: 1_790_000_000, lastT: 1_790_000_600, triggers: [], timeline: [], track: [], coverage: [], news: null, analyzedT: 1 });
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/events')) { req.url = req.url.slice('/api/events'.length) || '/'; void events.handle(req, res); return; }
    void auth.middleware(req, res, () => { res.end('public'); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { events.stop(); await new Promise((r) => server.close(r)); await auth.close(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  function client() {
    let cookie = '';
    let csrf = '';
    async function request(route, { method = 'GET', body, headers = {} } = {}) {
      const response = await fetch(base + route, { method, headers: { Cookie: cookie, Origin: base, 'User-Agent': 'Mozilla/5.0 test', ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      if (data && Object.hasOwn(data, 'csrfToken')) csrf = data.csrfToken || '';
      return { status: response.status, data };
    }
    return {
      request,
      async register(input) { await request('/api/auth/csrf'); return request('/api/auth/register', { method: 'POST', body: input }); },
      setCsrf(v) { csrf = v; },
    };
  }
  return { base, client, events };
}

test('vlastník prihlásený účtom vidí zoznam, detail a text; cudzí účet a hosť dostanú 404; lokálne bez účtu ako doteraz', async (t) => {
  const { client } = await fixture(t);
  const guest = client();
  assert.equal((await guest.request('/api/events')).status, 404, 'hosť zvonku: 404');
  const owner = client();
  assert.equal((await owner.register(OWNER)).status, 201);
  const list = await owner.request('/api/events');
  assert.equal(list.status, 200, 'vlastník zvonku vidí zoznam');
  assert.equal(list.data.events.length, 1);
  assert.equal((await owner.request('/api/events/abc123-20260922T1320')).status, 200, 'detail');
  assert.equal((await owner.request('/api/events/abc123-20260922T1320/post')).status, 200, 'text príspevku');
  assert.equal((await owner.request('/api/events/public/abc123-20260922T1320')).status, 200, 'náhľad nezverejnenej (ako lokálne)');
  const other = client();
  assert.equal((await other.register(OTHER)).status, 201);
  assert.equal((await other.request('/api/events')).status, 404, 'cudzí účet: 404 ako hosť');
  assert.equal((await other.request('/api/events/public/abc123-20260922T1320')).status, 404, 'cudzí účet nevidí náhľad');
  assert.equal((await guest.request('/api/events', { headers: { 'x-test-local': '1' } })).status, 200, 'lokálne bez účtu stále áno');
});

test('zápis pod účtom: so CSRF prejde až k akcii, bez CSRF alebo s cudzím pôvodom 404/403; bez OKO_OWNER_EMAILS nikto zvonku', async (t) => {
  const { base, client } = await fixture(t);
  const owner = client();
  await owner.register(OWNER);
  // Zverejnenie neoverenej udalosti služba odmietne vecne (409/400), nie prístupovo (404/403).
  const withCsrf = await owner.request('/api/events/abc123-20260922T1320/publish', { method: 'POST', body: {} });
  assert.ok([400, 409].includes(withCsrf.status), `so CSRF sa dostane k akcii (HTTP ${withCsrf.status})`);
  owner.setCsrf('');
  const noCsrf = await owner.request('/api/events/abc123-20260922T1320/publish', { method: 'POST', body: {} });
  assert.equal(noCsrf.status, 404, 'bez CSRF ako hosť');
  const foreign = await fetch(`${base}/api/events/abc123-20260922T1320/publish`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(foreign.status, 404, 'cudzí pôvod');
  const { client: client2 } = await fixture(t, { ownerEmails: '' });
  const o2 = client2();
  await o2.register(OWNER);
  assert.equal((await o2.request('/api/events')).status, 404, 'bez zoznamu vlastníkov nikto zvonku');
  assert.deepEqual(parseOwnerEmails(' A@B.sk, c@d.eu;x '), ['a@b.sk', 'c@d.eu']);
});
