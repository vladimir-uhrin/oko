// src/data/localRequestGate.test.mjs — „len lokálne" za verejným tunelom (2026-09-30).
// cloudflared doručuje návštevníkov okolive.sk z 127.0.0.1, takže loopback soket nestačí:
// ACARS bol verejný napriek dokumentovanému LEN LOKÁLNE. Lokálna je len požiadavka bez
// hlavičiek Cloudflare/proxy a s hostiteľom localhost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDirectLocalRequest } from '../../vite.config.js';

const req = (remoteAddress, headers) => ({ socket: { remoteAddress }, headers });

test('priamo z tohto počítača: loopback + hostiteľ localhost/127.0.0.1/::1', () => {
  assert.equal(isDirectLocalRequest(req('127.0.0.1', { host: 'localhost:4173' })), true);
  assert.equal(isDirectLocalRequest(req('::1', { host: '[::1]:4173' })), true);
  assert.equal(isDirectLocalRequest(req('::ffff:127.0.0.1', { host: '127.0.0.1:4173' })), true);
  assert.equal(isDirectLocalRequest(req('127.0.0.1', { host: 'oko.localhost' })), true);
});

test('cez tunel alebo proxy nie je lokálne, hoci soket je loopback', () => {
  assert.equal(isDirectLocalRequest(req('127.0.0.1', { host: 'okolive.sk', 'cf-connecting-ip': '203.0.113.9', 'cf-ray': '8a1b' })), false);
  assert.equal(isDirectLocalRequest(req('::1', { host: 'okolive.sk' })), false, 'cudzí hostiteľ');
  assert.equal(isDirectLocalRequest(req('127.0.0.1', { host: 'localhost', 'cf-connecting-ip': '203.0.113.9' })), false, 'podvrhnutý Host za tunelom');
  assert.equal(isDirectLocalRequest(req('127.0.0.1', { host: 'localhost', 'x-forwarded-for': '198.51.100.7' })), false);
  assert.equal(isDirectLocalRequest(req('192.168.1.20', { host: 'localhost' })), false, 'iný počítač v sieti');
  assert.equal(isDirectLocalRequest(req(undefined, undefined)), false);
});
