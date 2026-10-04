import test from 'node:test';
import assert from 'node:assert/strict';
import { openAdminStore } from './store.js';
import { createAlerts, ALERT_DEFAULTS } from './alerts.js';

const NOW = Date.UTC(2026, 9, 4, 10, 0);

function setup(t, { mailer = null, clock = { time: NOW } } = {}) {
  const store = openAdminStore(':memory:');
  t.after(() => store.close());
  const mails = [];
  const m = mailer || { configured: true, async send(message) { mails.push(message); } };
  const alerts = createAlerts({ store, mailer: m, now: () => clock.time, log: () => {}, timers: false, defaultEmail: 'vlastnik@okolive.sk',
    feeds: [{ id: 'tomtom', label: 'TomTom doprava' }] });
  return { store, alerts, mails, clock };
}
const sample = (at, ok, status = ok ? 200 : 502) => ({ at, feed: 'tomtom', ok: ok ? 1 : 0, status, ms: 100 });

test('predvolene vypnuté: nič sa neposiela; príjemca z OKO_OWNER_EMAILS; nastavenie validuje', async t => {
  const { alerts, mails } = setup(t);
  assert.deepEqual(alerts.settings(), { ...ALERT_DEFAULTS, email: 'vlastnik@okolive.sk' });
  assert.deepEqual(await alerts.check(), { skipped: 'disabled' });
  assert.equal(mails.length, 0);
  assert.throws(() => alerts.setSettings({ email: 'nie je mail' }), /invalid_input/);
  assert.throws(() => alerts.setSettings({ feedDownMinutes: 5 }), /invalid_input/);
  assert.equal(alerts.setSettings({ enabled: true, feedDownMinutes: 30 }).feedDownMinutes, 30);
  assert.equal(alerts.setSettings({ email: '' }).email, null, 'prázdny = bez e-mailu');
});

test('feed nedostupný N minút → jeden e-mail, ďalší najskôr o 6 h; čiastočný výpadok nie', async t => {
  const { store, alerts, mails, clock } = setup(t);
  alerts.setSettings({ enabled: true, feedDownMinutes: 30 });
  store.flush({ traffic: [], pageviews: [], visitors: [], errors: [], samples: [sample(NOW - 25 * 60e3, false), sample(NOW - 15 * 60e3, true), sample(NOW - 5 * 60e3, false)] });
  assert.deepEqual((await alerts.check()).sent, [], 'jedna úspešná kontrola = nie je výpadok');
  store.flush({ traffic: [], pageviews: [], visitors: [], errors: [], samples: [sample(NOW + 5 * 60e3, false)] });
  clock.time = NOW + 20 * 60e3; // okno 30 min: 3 neúspešné vzorky
  const { sent } = await alerts.check();
  assert.equal(sent.length, 1);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'vlastnik@okolive.sk');
  assert.match(mails[0].subject, /^OKO: TomTom doprava je nedostupný/);
  assert.match(mails[0].text, /30 min/);
  clock.time += 60 * 60e3;
  store.flush({ traffic: [], pageviews: [], visitors: [], errors: [], samples: [sample(clock.time - 20 * 60e3, false), sample(clock.time - 10 * 60e3, false)] });
  assert.deepEqual((await alerts.check()).sent, [], 'ten istý feed do 6 h nie');
  assert.equal(alerts.history().length, 1);
});

test('nové chyby servera a 5xx od poslednej kontroly; varovania a klient nie', async t => {
  const { store, alerts, mails, clock } = setup(t);
  alerts.setSettings({ enabled: true });
  clock.time = NOW + 60e3;
  store.flush({ traffic: [], pageviews: [], visitors: [], samples: [], errors: [
    { sig: 'a', kind: 'server', message: 'TypeError: x is undefined', detail: '', count: 3, firstAt: NOW + 30e3, lastAt: NOW + 50e3 },
    { sig: 'b', kind: 'http', message: 'HTTP 502 GET /api/tomtom', detail: '', count: 1, firstAt: NOW + 40e3, lastAt: NOW + 40e3 },
    { sig: 'c', kind: 'warn', message: 'iba varovanie', detail: '', count: 9, firstAt: NOW + 40e3, lastAt: NOW + 40e3 },
    { sig: 'd', kind: 'server', message: 'stará chyba', detail: '', count: 1, firstAt: NOW - 3600e3, lastAt: NOW + 40e3 },
  ] });
  const { sent } = await alerts.check();
  assert.equal(sent.length, 1);
  assert.match(mails[0].subject, /2 nové chyby na serveri/);
  assert.match(mails[0].text, /TypeError: x is undefined \(3×\)/);
  assert.ok(!/varovanie|stará chyba/.test(mails[0].text));
  assert.deepEqual((await alerts.check()).sent, [], 'tie isté chyby druhýkrát nie');
});

test('zlyhané zverejnenie zo Štúdia, bez mailera len zoznam, skúška ide vždy, limit 12 e-mailov denne', async t => {
  const { alerts, mails, clock } = setup(t);
  alerts.setSettings({ enabled: true });
  alerts.onStudioAlert({ kind: 'publish_failed', id: 'd1', title: 'Zemetrasenie', targets: ['facebook'], error: 'Graph down', attempts: 4 });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(mails[0].subject, /Zverejnenie zlyhalo: Zemetrasenie/);
  assert.match(mails[0].text, /po 4 pokusoch/);
  alerts.onStudioAlert({ kind: 'other' });
  for (let i = 0; i < 15; i++) { clock.time += 1000; await alerts.notify({ kind: 'feed_down', key: `k${i}`, subject: `s${i}`, text: 't' }); }
  assert.equal(mails.length, 12, 'denný strop');
  const test_ = await alerts.test();
  assert.equal(test_.mailed, true, 'skúška ignoruje strop');
  const { alerts: offline } = setup(t, { mailer: { configured: false } });
  offline.setSettings({ enabled: true });
  const entry = await offline.test();
  assert.deepEqual([entry.mailed, offline.history().length, offline.status().mailer], [false, 1, false]);
  const { alerts: broken } = setup(t, { mailer: { configured: true, send: async () => { throw new Error('mail_delivery_failed'); } } });
  broken.setSettings({ enabled: true });
  assert.equal((await broken.test()).mailError, 'mail_delivery_failed');
});
