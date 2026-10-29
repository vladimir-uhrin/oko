// src/data/aircraftOwner.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAircraftOwner, aircraftOwnerLabel } from './aircraftOwner.js';

const company = (name) => ({ kind: 'company', name });
const priv = (name) => ({ kind: 'private', name });

test('dopravcovia podľa trojpísmenového kódu ICAO (vzorky z adsbdb)', () => {
  assert.deepEqual(classifyAircraftOwner('Ryanair', { flagCode: 'RYR', typeCode: 'B738' }), company('Ryanair'));
  assert.deepEqual(classifyAircraftOwner('Smartwings', { flagCode: 'TVS', typeCode: 'B38M' }), company('Smartwings'));
  assert.deepEqual(classifyAircraftOwner('Lufthansa', { flagCode: 'DLH' }), company('Lufthansa'));
});

test('firmy a organizácie podľa právnej formy alebo druhu', () => {
  assert.deepEqual(classifyAircraftOwner('Nike Inc', { flagCode: 'G650', typeCode: 'G650' }), company('Nike Inc'));
  assert.deepEqual(classifyAircraftOwner('LUKE AIRLINES LLC'), company('LUKE AIRLINES LLC'));
  assert.deepEqual(classifyAircraftOwner('Historical Aircraft Restoration Society', { flagCode: 'P2' }), company('Historical Aircraft Restoration Society'));
  assert.deepEqual(classifyAircraftOwner('Aeroklub Prievidza'), company('Aeroklub Prievidza'));
  assert.deepEqual(classifyAircraftOwner('Air Transport Europe, spol. s r.o.'), company('Air Transport Europe, spol. s r.o.'));
  assert.deepEqual(classifyAircraftOwner('Pilatus Flugzeugwerke AG'), company('Pilatus Flugzeugwerke AG'));
  assert.deepEqual(classifyAircraftOwner('WELLS FARGO TRUST CO NA TRUSTEE'), company('WELLS FARGO TRUST CO NA TRUSTEE'));
  assert.deepEqual(classifyAircraftOwner('Volvo AB'), company('Volvo AB'));
});

test('súkromné osoby: meno z registra, zástupné Private bez mena', () => {
  assert.deepEqual(classifyAircraftOwner('Private', { flagCode: 'SB91', typeCode: 'SB91' }), { kind: 'private' });
  assert.deepEqual(classifyAircraftOwner('SMITH JOHN A'), priv('SMITH JOHN A'));
  assert.deepEqual(classifyAircraftOwner('SMITH S A'), priv('SMITH S A')); // iniciály nie sú „S.A."
  assert.deepEqual(classifyAircraftOwner('Novák Peter'), priv('Novák Peter'));
  // kód typu v poli prevádzkovateľa (adsbdb to robí pri malých strojoch) nie je dopravca
  assert.deepEqual(classifyAircraftOwner('Huber Franz', { flagCode: 'C172', typeCode: 'C172' }), priv('Huber Franz'));
  assert.deepEqual(classifyAircraftOwner('Huber Franz', { flagCode: 'DHC', typeCode: 'DHC' }), priv('Huber Franz'));
});

test('prázdny register = nič na karte', () => {
  assert.equal(classifyAircraftOwner(null), null);
  assert.equal(classifyAircraftOwner('   '), null);
});

test('text na karte: firma aj súkromný menom, dopravca sa neopakuje', () => {
  const t = (key, vars) => (key === 'card.owner' ? `vlastník ${vars.name}` : key === 'card.owner-private' ? 'súkromný vlastník' : key === 'card.owner-private-named' ? `súkromný vlastník ${vars.name}` : key);
  assert.equal(aircraftOwnerLabel({ kind: 'company', name: 'Nike Inc' }, null, t), 'vlastník Nike Inc');
  assert.equal(aircraftOwnerLabel({ kind: 'private' }, null, t), 'súkromný vlastník');
  assert.equal(aircraftOwnerLabel({ kind: 'private', name: 'SMITH JOHN A' }, null, t), 'súkromný vlastník SMITH JOHN A');
  assert.equal(aircraftOwnerLabel({ kind: 'company', name: 'Ryanair' }, 'Ryanair', t), '');
  assert.equal(aircraftOwnerLabel({ kind: 'company', name: 'Wizz Air' }, 'Wizz Air Hungary', t), '');
  assert.equal(aircraftOwnerLabel({ kind: 'company', name: 'AerCap Ireland Ltd' }, 'Ryanair', t), 'vlastník AerCap Ireland Ltd');
  assert.equal(aircraftOwnerLabel(null, 'Ryanair', t), '');
});
