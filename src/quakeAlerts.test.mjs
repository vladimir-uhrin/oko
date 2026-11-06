import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQuakeAlerts } from './quakeAlerts.js';
import { parseQuakeLink, openQuakeLink } from './quakeDeepLink.js';
import { sanitizeFollow, validFollowKey, followMatches, isFlightFollowKey, isQuakeFollowKey, QUAKE_FOLLOW_KEY } from './auth/follows.js';

const t = (key) => key;

function account({ user = { id: 1 }, follows = [] } = {}) {
  const state = { user, follows: [...follows], opened: [], calls: [] };
  const client = {
    getState: () => ({ user: state.user }),
    subscribe() { return () => {}; },
    follows: async () => ({ follows: state.follows }),
    follow: async (data) => { state.calls.push(['follow', data]); const item = sanitizeFollow(data); state.follows.push(item); return { follows: state.follows }; },
    unfollow: async (key) => { state.calls.push(['unfollow', key]); state.follows = state.follows.filter(f => f.key !== key); return { follows: state.follows }; },
  };
  return { state, account: { client, open: async (_, o) => { state.opened.push(o.reason); } } };
}

test('follow key quake:sk: topic input only, never matches a flight or vessel contact, not counted as a flight', () => {
  assert.deepEqual(sanitizeFollow({ topic: 'quake-sk', label: 'ignored' }), { key: 'quake:sk', hex: null, callsign: null, label: 'Zemetrasenia citeľné na Slovensku' });
  assert.equal(sanitizeFollow({ topic: 'quake-cz' }), null);
  assert.equal(validFollowKey(QUAKE_FOLLOW_KEY), true); assert.equal(validFollowKey('quake:cz'), false);
  assert.equal(isQuakeFollowKey('quake:sk'), true); assert.equal(isFlightFollowKey('quake:sk'), false);
  assert.equal(isFlightFollowKey('hex:abc123'), true); assert.equal(isFlightFollowKey('mmsi:123456789'), false);
  assert.equal(followMatches({ key: 'quake:sk' }, { hex: 'sk' }), false);
  assert.equal(followMatches({ key: 'hex:abc123' }, { hex: 'ABC123' }), true);
});

test('guest is sent to sign in; signed-in toggle adds the follow and turns on push on this device', async () => {
  const guest = account({ user: null });
  const g = createQuakeAlerts({ account: guest.account, translate: t });
  assert.equal(g.status(), 'guest');
  assert.equal(await g.toggle(), false); assert.deepEqual(guest.state.opened, ['quake.alerts.login-reason']);

  const signed = account();
  let pushStatus = 'off'; let enabled = 0; const toasts = [];
  const alerts = createQuakeAlerts({ account: signed.account, translate: t, notify: (x) => toasts.push(x),
    push: { status: () => pushStatus, enable: async () => { enabled++; pushStatus = 'on'; return true; } } });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(alerts.status(), 'off');
  assert.equal(await alerts.toggle(), true);
  assert.deepEqual(signed.state.calls[0], ['follow', { topic: 'quake-sk' }]);
  assert.equal(enabled, 1); assert.equal(alerts.status(), 'on'); assert.equal(toasts.at(-1), 'quake.alerts.added');
  assert.equal(await alerts.toggle(), true);
  assert.deepEqual(signed.state.calls[1], ['unfollow', 'quake:sk']); assert.equal(alerts.status(), 'off');
});

test('existing subscription is read from the account; push unavailable is said, not hidden', async () => {
  const signed = account({ follows: [{ key: 'quake:sk', label: 'x' }] });
  const alerts = createQuakeAlerts({ account: signed.account, translate: t });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(alerts.status(), 'on');
  const other = account(); const toasts = [];
  const noPush = createQuakeAlerts({ account: other.account, translate: t, notify: (x) => toasts.push(x), push: { status: () => 'unavailable', enable: async () => false } });
  await new Promise(r => setTimeout(r, 0));
  await noPush.toggle(); assert.equal(toasts.at(-1), 'quake.alerts.added-nopush');
});

test('deep link ?quake=: id guard; enables the layer, waits for the catalog, selects and flies', async () => {
  assert.equal(parseQuakeLink('?quake=USGS%3Aus7000twg9'), 'USGS:us7000twg9');
  assert.equal(parseQuakeLink('?quake=EMSC:20261106_0000133'), 'EMSC:20261106_0000133');
  for (const bad of ['?quake=javascript:alert(1)', '?quake=USGS:', '?ship=123', '']) assert.equal(parseQuakeLink(bad), null, bad);
  const enabledCalls = []; let tries = 0; const flights = [];
  const ok = await openQuakeLink({ id: 'USGS:us1', dataManager: { setEnabled: async (...a) => enabledCalls.push(a) },
    layer: { selectById: () => ++tries >= 3, getSelectedInfo: () => ({ lat: 35, lon: 142 }) },
    flyTo: (info) => flights.push(info), wait: async () => {} });
  assert.equal(ok, true); assert.equal(tries, 3); assert.deepEqual(flights, [{ lat: 35, lon: 142 }]);
  assert.deepEqual(enabledCalls[0], ['earthquakes', true, { origin: 'link' }]);
  assert.equal(await openQuakeLink({ id: 'USGS:x', dataManager: { setEnabled: async () => {} }, layer: { selectById: () => false }, flyTo() {}, wait: async () => {}, attempts: 2 }), false);
});
