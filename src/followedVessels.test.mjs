// src/followedVessels.test.mjs — sledované lode (2026-10-11, bod 6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { followKey, followMatches, sanitizeFollow, validFollowKey } from './auth/follows.js';
import {
  createFollowedVessels,
  followBellPlacement,
  vesselFollowHint,
  vesselFollowStatus,
  vesselFollowTransitions,
} from './followedVessels.js';
import { createFollowedFlights } from './followedFlights.js';

test('kľúč lode mmsi:, validácia aj na serveri; lety sa nezmenili', () => {
  assert.equal(followKey({ mmsi: '241190000' }), 'mmsi:241190000');
  assert.equal(followKey({ mmsi: 241190000 }), 'mmsi:241190000');
  assert.equal(followKey({ mmsi: '2411900' }), null, 'krátke MMSI');
  assert.equal(followKey({ hex: '4ca1d3', callsign: 'AUA40H' }), 'cs:AUA40H');
  assert.equal(validFollowKey('mmsi:241190000'), true);
  assert.equal(validFollowKey('mmsi:24119000x'), false);
  assert.deepEqual(sanitizeFollow({ mmsi: '241190000', label: 'MINERVA\u0000 ZEN' }),
    { key: 'mmsi:241190000', hex: null, callsign: null, label: 'MINERVA ZEN', mmsi: '241190000' });
  assert.equal(sanitizeFollow({ mmsi: '241190000' }).label, '241190000');
  assert.equal(followMatches({ key: 'mmsi:241190000' }, { mmsi: 241190000 }), true);
  assert.equal(followMatches({ key: 'mmsi:241190000' }, { hex: '241190' }), false);
});

test('stav: živé AIS má prednosť, inak plavba z registra', () => {
  const sailing = { voyage: { lastPort: 'Newport News', departedAt: 1 }, destinationPort: { name: 'Wilmington' } };
  const docked = { voyage: { lastPort: 'Wilmington', arrivedAt: 5, departedAt: null } };
  assert.deepEqual(vesselFollowStatus(null, sailing), { status: 'underway', port: 'Newport News', to: 'Wilmington', source: 'register' });
  assert.deepEqual(vesselFollowStatus(null, docked), { status: 'port', port: 'Wilmington', to: null, source: 'register' });
  assert.equal(vesselFollowStatus({ sog: 12.4, navStatus: 0 }, docked).status, 'underway', 'živé AIS prebije starý register');
  assert.equal(vesselFollowStatus({ sog: 0, navStatus: 5 }, sailing).status, 'port', 'moored');
  assert.equal(vesselFollowStatus({ sog: 0.2, navStatus: 1 }, null).status, 'anchor');
  assert.equal(vesselFollowStatus({ sog: 1.5, navStatus: 0 }, null).status, 'stopped', 'manéver pod 3 kn nie je cesta');
  assert.equal(vesselFollowStatus({ sog: 0.3, navStatus: 15 }, docked).status, 'port', 'stojí a register hovorí prístav');
  assert.equal(vesselFollowStatus(null, null).status, 'unknown');
});

test('prechody: vyplávala / priplávala; základ, kotva a neznámy nič nehlásia', () => {
  const m = (pairs) => new Map(pairs.map(([k, s]) => [k, { status: s }]));
  assert.deepEqual(vesselFollowTransitions(null, m([['a', 'underway']])), []);
  assert.deepEqual(vesselFollowTransitions(m([['a', 'port'], ['b', 'underway'], ['c', 'anchor'], ['d', 'unknown']]),
    m([['a', 'underway'], ['b', 'port'], ['c', 'underway'], ['d', 'underway']])),
  [{ key: 'a', type: 'departed' }, { key: 'b', type: 'arrived' }, { key: 'c', type: 'departed' }]);
  assert.deepEqual(vesselFollowTransitions(m([['a', 'underway']]), m([['a', 'anchor']])), [], 'kotva na rejde nie je príchod');
});

test('text stavu do palety', () => {
  const t = (k, v) => `${k}${v ? JSON.stringify(v) : ''}`;
  assert.equal(vesselFollowHint({ status: 'underway', to: 'Wilmington' }, t), 'follow.vessel.status.underway-to{"port":"Wilmington"}');
  assert.equal(vesselFollowHint({ status: 'port', port: null }, t), 'follow.vessel.status.port');
  assert.equal(vesselFollowHint(null, t), 'follow.vessel.status.unknown');
});

test('zvonček je vľavo od krížika v tej istej výške', () => {
  const p = followBellPlacement({ x: 100, y: 50, w: 300, h: 200 });
  assert.equal(p.y, 56);
  assert.equal(p.x, 100 + 300 - 26 - 6 - 26 - 6);
});

function fakeAccount() {
  let state = { user: null };
  const subs = new Set();
  let list = [];
  const calls = [];
  const client = {
    getState: () => state,
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    follows: async () => ({ follows: list }),
    follow: async (body) => { calls.push(['follow', body]); const item = sanitizeFollow(body); list = [{ key: item.key, hex: item.hex, callsign: item.callsign, label: item.label }, ...list.filter((f) => f.key !== item.key)]; return { follows: list }; },
    unfollow: async (key) => { calls.push(['unfollow', key]); list = list.filter((f) => f.key !== key); return { follows: list }; },
  };
  const opened = [];
  return {
    account: { client, open: async (_, o) => opened.push(o), close: () => {} },
    signIn(id = 'u1') { state = { user: { id } }; for (const fn of subs) fn(state); },
    setList(l) { list = l; },
    calls, opened,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('controller: host → prihlásenie a loď sa pridá sama; toast pri vyplávaní; lety lode nevidia', async () => {
  const acc = fakeAccount();
  const notes = [];
  let live = { sog: 0, navStatus: 5 };
  let clock = 1_000_000;
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const fetches = [];
  const followed = createFollowedVessels({
    account: acc.account,
    translate: (k, v) => `${k}${v ? JSON.stringify(v) : ''}`,
    notify: (n) => notes.push(n),
    findLive: () => live,
    fetchInfo: async (mmsi) => { fetches.push(mmsi); return { voyage: { lastPort: 'Wilmington', arrivedAt: 5, departedAt: null } }; },
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {},
    now: () => clock,
    storage,
  });
  const flights = createFollowedFlights({ account: acc.account, translate: (k) => k, setIntervalImpl: () => 2, clearIntervalImpl: () => {}, storage });
  // Host
  assert.equal(await followed.toggle({ mmsi: '241190000', name: 'MINERVA ZEN' }), false);
  assert.equal(acc.opened[0].reason, 'follow.vessel.login-reason');
  assert.equal(followed.hasPending(), true);
  // Prihlásenie → pridá sa sama
  acc.signIn();
  for (let i = 0; i < 6; i += 1) await tick();
  assert.deepEqual(acc.calls[0], ['follow', { mmsi: '241190000', label: 'MINERVA ZEN' }]);
  assert.equal(followed.getFollows().length, 1);
  assert.equal(flights.getFollows().length, 0, 'loď nie je v sledovaných letoch');
  assert.match(notes.at(-1), /follow\.vessel\.added/);
  // Základ (v prístave), potom vypláva
  await followed.evaluate({ baseline: true });
  assert.equal(followed.statusFor('241190000').status, 'port');
  live = { sog: 13.2, navStatus: 0 };
  clock += 30_000;
  await followed.evaluate();
  assert.match(notes.at(-1), /follow\.vessel\.departed-from.*Wilmington/);
  assert.equal(fetches.length, 1, 'register len raz za 15 min');
  // Paleta
  const cmds = followed.commands();
  assert.equal(cmds[0].group, 'follows');
  assert.equal(cmds[0].label, 'MINERVA ZEN');
  assert.match(cmds[0].hint, /underway/);
  // Odobratie
  await followed.toggle({ mmsi: '241190000' });
  assert.deepEqual(acc.calls.at(-1), ['unfollow', 'mmsi:241190000']);
  assert.equal(followed.getFollows().length, 0);
});
