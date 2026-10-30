// src/data/aircraftOwner.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GDPR_REGISTRY_COUNTRIES, classifyAircraftOwner, aircraftOwnerLabel } from './aircraftOwner.js';

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

test('súkromné osoby: meno z registra mimo EÚ/EHP, zástupné Private bez mena', () => {
  const US = { countryIso: 'US' };
  assert.deepEqual(classifyAircraftOwner('Private', { flagCode: 'SB91', typeCode: 'SB91', ...US }), { kind: 'private' });
  assert.deepEqual(classifyAircraftOwner('SMITH JOHN A', US), priv('SMITH JOHN A'));
  assert.deepEqual(classifyAircraftOwner('SMITH S A', US), priv('SMITH S A')); // iniciály nie sú „S.A."
  // kód typu v poli prevádzkovateľa (adsbdb to robí pri malých strojoch) nie je dopravca
  assert.deepEqual(classifyAircraftOwner('Huber Franz', { flagCode: 'C172', typeCode: 'C172', countryIso: 'CA' }), priv('Huber Franz'));
  assert.deepEqual(classifyAircraftOwner('Huber Franz', { flagCode: 'DHC', typeCode: 'DHC', countryIso: 'AU' }), priv('Huber Franz'));
});

test('GDPR (2026-10-30): register v EÚ/EHP alebo Švajčiarsku a neznámy štát = súkromný vlastník bez mena; firmy menom všade', () => {
  for (const iso of ['SK', 'CZ', 'AT', 'DE', 'FR', 'NO', 'IS', 'LI', 'CH', 'sk']) {
    assert.deepEqual(classifyAircraftOwner('Novák Peter', { countryIso: iso }), { kind: 'private' }, iso);
  }
  assert.deepEqual(classifyAircraftOwner('Novák Peter'), { kind: 'private' }, 'neznámy štát registra');
  assert.deepEqual(classifyAircraftOwner('Novák Peter', { countryIso: 'Slovakia' }), { kind: 'private' }, 'nie ISO kód = neznámy');
  assert.deepEqual(classifyAircraftOwner('Air Transport Europe, spol. s r.o.', { countryIso: 'SK' }), company('Air Transport Europe, spol. s r.o.'));
  assert.equal(GDPR_REGISTRY_COUNTRIES.size, 31);
  const cfg = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
  assert.match(cfg, /classifyAircraftOwner\(a\.registered_owner, \{ flagCode: a\.registered_owner_operator_flag_code, typeCode: a\.icao_type, countryIso: a\.registered_owner_country_iso_name \}\)/);
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

test('výdaj karty: meno súkromnej osoby zo starej cache sa pri európskom alebo neznámom registri odstráni', async () => {
  const { sanitizeAircraftOwner } = await import('./aircraftOwner.js');
  const old = { registration: 'OM-ABC', countryIso: 'SK', owner: { kind: 'private', name: 'Novák Peter' } };
  assert.deepEqual(sanitizeAircraftOwner(old), { ...old, owner: { kind: 'private' } });
  assert.deepEqual(sanitizeAircraftOwner({ ...old, countryIso: null }).owner, { kind: 'private' });
  const us = { registration: 'N123AB', countryIso: 'US', owner: { kind: 'private', name: 'SMITH JOHN A' } };
  assert.equal(sanitizeAircraftOwner(us), us);
  const firm = { countryIso: 'SK', owner: { kind: 'company', name: 'Air Transport Europe' } };
  assert.equal(sanitizeAircraftOwner(firm), firm);
  assert.equal(sanitizeAircraftOwner(null), null);
  const cfg = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
  assert.equal(cfg.split('{ found: true, ...sanitizeAircraftOwner(data) }').length - 1, 2, 'typ aj registrácia');
});
