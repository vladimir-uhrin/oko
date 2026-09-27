// src/followedFlights.test.mjs
// Sledované lety (2026-09-27, vlastník: „pridaj možnosť aj sledovanie letov, ale len pre
// prihlásených na kartičku; aj pre neprihlásených, ale presmeruj ich na prihlásenie").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FOLLOW_PENDING_TTL_MS,
  FOLLOW_POLL_MS,
  createFollowedFlights,
  followLabelFor,
  followStatus,
  followTransitions,
  installFollowButton,
} from './followedFlights.js';
import { EN_STRINGS, SK_STRINGS } from './i18nStrings.js';
import { AUTH_EN, AUTH_SK } from './auth/strings.js';

const t = (key, vars) => {
  let text = EN_STRINGS[key] || AUTH_EN[key] || key;
  for (const [k, v] of Object.entries(vars || {})) text = text.replaceAll(`{${k}}`, String(v));
  return text;
};

/** Dvojník klienta účtu: stav + zoznam na „serveri". */
function fakeAccount({ user = null, failWith = null } = {}) {
  let state = { user, status: user ? 'authenticated' : 'guest' };
  const listeners = new Set();
  const server = [];
  const calls = { open: [], close: 0, follow: [], unfollow: [] };
  const client = {
    getState: () => state,
    subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
    async follows() { return { follows: server.slice() }; },
    async follow(data) {
      calls.follow.push(data);
      if (failWith) throw Object.assign(new Error(failWith), { status: 409 });
      const key = data.callsign && /^[A-Z]{3}\d/.test(data.callsign) ? `cs:${data.callsign}` : `hex:${data.hex}`;
      const i = server.findIndex((f) => f.key === key);
      const row = { key, hex: data.hex, callsign: data.callsign, label: data.label, addedAt: 1 };
      if (i >= 0) server[i] = row; else server.unshift(row);
      return { follows: server.slice() };
    },
    async unfollow(key) {
      calls.unfollow.push(key);
      const i = server.findIndex((f) => f.key === key);
      if (i >= 0) server.splice(i, 1);
      return { follows: server.slice() };
    },
  };
  return {
    account: { client, open: async (...args) => { calls.open.push(args); }, close: () => { calls.close += 1; } },
    calls,
    server,
    login(u = { id: 'u1' }) { state = { user: u, status: 'authenticated' }; for (const fn of listeners) fn(state); },
    logout() { state = { user: null, status: 'guest' }; for (const fn of listeners) fn(state); },
  };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const AUA = { icao24: '44003a', callsign: 'AUA40H', registration: 'OE-LBE', route: { origin: { code: 'BCN' }, destination: { code: 'VIE' } } };

test('popis letu a stav voči živým dátam', () => {
  assert.equal(followLabelFor(AUA), 'AUA40H · BCN → VIE');
  assert.equal(followLabelFor({ icao24: '4b1815', registration: 'HB-JCA' }), 'HB-JCA');
  assert.equal(followLabelFor({ hex: '4b1815' }), '4b1815');
  const contacts = [{ hex: 'aaaaaa', callsign: 'AUA40H', onGround: false }, { hex: '4b1815', callsign: null, onGround: true }];
  assert.equal(followStatus({ key: 'cs:AUA40H' }, contacts).status, 'air', 'let dopravcu = iný stroj, ten istý znak');
  assert.equal(followStatus({ key: 'hex:4b1815' }, contacts).status, 'ground');
  assert.equal(followStatus({ key: 'cs:WZZ1' }, contacts).status, 'offline');
});

test('prechody: prvé vyhodnotenie nič nehlási; vzlet, pristátie, prvé objavenie vo vzduchu raz za reláciu', () => {
  const seen = new Set();
  const m = (o) => new Map(Object.entries(o));
  assert.deepEqual(followTransitions(null, m({ a: 'air', b: 'ground', c: 'offline' }), seen), [], 'baseline po prihlásení');
  assert.deepEqual(followTransitions(m({ a: 'air', b: 'ground', c: 'offline' }), m({ a: 'ground', b: 'air', c: 'air' }), seen),
    [{ key: 'a', type: 'landed' }, { key: 'b', type: 'airborne' }, { key: 'c', type: 'airborne' }]);
  // c zmizne z pokrytia a vráti sa — už raz ohlásený, nič
  assert.deepEqual(followTransitions(m({ c: 'air' }), m({ c: 'offline' }), seen), []);
  assert.deepEqual(followTransitions(m({ c: 'offline' }), m({ c: 'air' }), seen), []);
});

test('host: klik otvorí prihlásenie s dôvodom, nič sa neuloží; po prihlásení sa let pridá sám a panel zavrie', async () => {
  const fake = fakeAccount();
  const toasts = [];
  const followed = createFollowedFlights({ account: fake.account, translate: t, notify: (x) => toasts.push(x), setIntervalImpl: () => 1, clearIntervalImpl: () => {} });
  assert.equal(followed.isSignedIn(), false);
  assert.equal(await followed.toggle(AUA), false);
  assert.deepEqual(fake.calls.open, [[null, { reason: 'follow.login-reason' }]], 'presmerovanie na prihlásenie s vetou prečo');
  assert.equal(fake.calls.follow.length, 0, 'host nič neukladá');
  assert.ok(followed.hasPending());
  fake.login();
  await tick(); await tick();
  assert.equal(fake.calls.close, 1, 'po prihlásení sa panel zavrie');
  assert.deepEqual(fake.calls.follow, [{ hex: '44003a', callsign: 'AUA40H', label: 'AUA40H · BCN → VIE' }]);
  assert.equal(followed.getFollows()[0].key, 'cs:AUA40H');
  assert.deepEqual(toasts, ['Following AUA40H · BCN → VIE']);
  assert.equal(followed.hasPending(), false);
  followed.destroy();
});

test('host, ktorý sa prihlási až o dlho neskôr, nedostane let pridaný nečakane', async () => {
  const fake = fakeAccount();
  let clock = 1_000_000;
  const followed = createFollowedFlights({ account: fake.account, translate: t, now: () => clock, setIntervalImpl: () => 1, clearIntervalImpl: () => {} });
  await followed.toggle(AUA);
  clock += FOLLOW_PENDING_TTL_MS + 1;
  fake.login();
  await tick(); await tick();
  assert.equal(fake.calls.follow.length, 0);
  assert.equal(fake.calls.close, 0);
  followed.destroy();
});

test('prihlásený: pridať, odobrať, stav v palete, klik v palete priletí k lietadlu; odhlásenie zoznam skryje', async () => {
  const fake = fakeAccount({ user: { id: 'u1' } });
  const toasts = [];
  const intervals = [];
  const tracked = [];
  let live = [{ hex: 'bbbbbb', callsign: 'AUA40H', onGround: false, altitudeM: 10000 }];
  const followed = createFollowedFlights({
    account: fake.account,
    translate: t,
    notify: (x) => toasts.push(x),
    findContacts: () => live,
    trackContact: (hex) => { tracked.push(hex); return true; },
    setIntervalImpl: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    clearIntervalImpl: (id) => { intervals[id - 1].fn = null; },
  });
  await tick();
  assert.equal(await followed.toggle(AUA), true);
  assert.ok(followed.entryFor({ icao24: 'cccccc', callsign: 'AUA40H' }), 'let dopravcu sleduje znak, nie stroj');
  assert.equal(intervals.at(-1).ms, FOLLOW_POLL_MS, 'porovnávanie so živými dátami beží len keď je čo sledovať');
  const [cmd] = followed.commands();
  assert.equal(cmd.group, 'follows');
  assert.equal(cmd.label, 'AUA40H · BCN → VIE');
  assert.equal(cmd.hint, 'in the air');
  cmd.run();
  assert.deepEqual(tracked, ['bbbbbb']);
  // pristátie ohlási toast
  live = [{ hex: 'bbbbbb', callsign: 'AUA40H', onGround: true, altitudeM: 150 }];
  intervals.at(-1).fn();
  assert.equal(toasts.at(-1), 'AUA40H · BCN → VIE has landed');
  // mimo dát: paleta to povie, klik nepriletí nikam
  live = [];
  followed.evaluate();
  const [offline] = followed.commands();
  assert.equal(offline.hint, 'not in the live data now');
  offline.run();
  assert.equal(toasts.at(-1), 'AUA40H · BCN → VIE is not in the live data right now');
  // odobrať
  assert.equal(await followed.toggle(AUA), true);
  assert.deepEqual(fake.calls.unfollow, ['cs:AUA40H']);
  assert.equal(followed.getFollows().length, 0);
  assert.equal(intervals.at(-1).fn, null, 'prázdny zoznam = žiadne porovnávanie');
  // odhlásenie
  await followed.toggle(AUA);
  fake.logout();
  assert.deepEqual(followed.commands(), [], 'host nemá v palete sledované lety');
  followed.destroy();
});

test('plný zoznam a chyba servera povedia pravdu, nič nepredstierajú', async () => {
  const fake = fakeAccount({ user: { id: 'u1' }, failWith: 'follow_limit' });
  const toasts = [];
  const followed = createFollowedFlights({ account: fake.account, translate: t, notify: (x) => toasts.push(x), setIntervalImpl: () => 1, clearIntervalImpl: () => {} });
  await tick();
  assert.equal(await followed.toggle(AUA), false);
  assert.equal(toasts.at(-1), 'You can follow at most 50 flights');
  assert.equal(followed.getFollows().length, 0);
  followed.destroy();
});

test('tlačidlo SLEDOVAŤ: zrkadlí KOKPIT, host vidí zámok, sledovaný let je stlačený', async () => {
  const makeEl = (tag) => {
    const el = {
      tagName: tag, children: [], hidden: false, dataset: {}, attrs: {}, listeners: {}, className: '', textContent: '', title: '', parentNode: null, id: '', type: '',
      append(...nodes) { for (const n of nodes) { n.parentNode = el; el.children.push(n); } },
      insertBefore(n) { n.parentNode = el; el.children.push(n); },
      setAttribute(k, v) { el.attrs[k] = String(v); }, getAttribute(k) { return el.attrs[k]; },
      addEventListener(type, fn) { el.listeners[type] = fn; }, removeEventListener() {},
      remove() {}, nextSibling: null,
    };
    return el;
  };
  const body = makeEl('body');
  const entry = makeEl('button');
  entry.hidden = true;
  body.append(entry);
  const doc = { createElement: makeEl, getElementById: (id) => (id === 'cockpit-entry' ? entry : null), body };
  const fake = fakeAccount();
  const followed = createFollowedFlights({ account: fake.account, translate: t, setIntervalImpl: () => 1, clearIntervalImpl: () => {} });
  let tracked = null;
  const ui = installFollowButton({ doc, followed, getTracked: () => tracked, translate: t });
  const button = ui.element;
  assert.equal(button.id, 'follow-flight');
  assert.equal(button.hidden, true, 'bez sledovaného lietadla nie je');
  tracked = AUA; entry.hidden = false; ui.sync();
  assert.equal(button.hidden, false);
  assert.equal(button.dataset.guest, 'true');
  assert.equal(button.children[0].textContent, 'lock');
  assert.equal(button.children[1].textContent, 'FOLLOW');
  assert.match(button.title, /signed-in/);
  button.listeners.click();
  await tick();
  assert.equal(fake.calls.open.length, 1, 'host → prihlásenie');
  fake.login();
  await tick(); await tick();
  assert.equal(button.getAttribute('aria-pressed'), 'true', 'po prihlásení je let sledovaný');
  assert.equal(button.children[1].textContent, 'FOLLOWING');
  assert.equal(button.children[0].textContent, 'notifications_active');
  entry.hidden = true; ui.sync();
  assert.equal(button.hidden, true, 'kokpit/bez sledovania = preč');
  ui.destroy();
  followed.destroy();
});

test('preklady v oboch jazykoch; zapojenie v main.js; CSS zrkadlí KOKPIT a skrýva sa v kokpite', () => {
  for (const key of ['follow.button', 'follow.button-on', 'follow.title-guest', 'follow.title-add', 'follow.title-remove', 'follow.added',
    'follow.removed', 'follow.limit', 'follow.error', 'follow.airborne', 'follow.landed', 'follow.status.air', 'follow.status.ground',
    'follow.status.offline', 'follow.not-live', 'cmd.group.follows']) {
    assert.ok(EN_STRINGS[key], `EN ${key}`);
    assert.ok(SK_STRINGS[key], `SK ${key}`);
  }
  for (const key of ['follow.login-reason', 'auth.hero-4']) { assert.ok(AUTH_EN[key]); assert.ok(AUTH_SK[key]); }
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /accountCenter = initAuthPanel\(\)/);
  assert.match(main, /createFollowedFlights\(\{\s*account: accountCenter,/);
  assert.match(main, /findContacts: \(identity\) => flightsLayer\.findContactsByIdentity\?\.\(identity\)/);
  assert.match(main, /cmds\.push\(\.\.\.\(followedFlights\?\.commands\(\) \|\| \[\]\)\)/);
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /#follow-flight \{\s*position: fixed;\s*left: calc\(50% \+ 270px\);\s*bottom: 80px;/);
  assert.match(css, /body\.cockpit-mode #follow-flight,\s*body\.ui-clean-view #follow-flight,\s*body\.recording-mode #follow-flight \{ display: none !important; \}/);
  assert.match(css, /body\.oko-mobile #follow-flight \{ bottom: calc\(var\(--oko-dock-lift\) \+ 128px\); \}/);
});
