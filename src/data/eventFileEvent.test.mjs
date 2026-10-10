// Udalosť zo súboru bez núdzového kódu (2026-10-09, krúženie lietadla ruskej vlády pri Moskve): vlastný názov,
// popis momentu, úvodná veta a veta pri momente z údajov OKO, štítok zdroja namiesto „NÁHĽAD — EŠTE NEOVERENÉ".
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventWhat } from './eventPost.js';
import { momentPhrase } from './eventTimeline.js';
import { narrationLines } from './eventNarration.js';

const T = 1791548670;
const event = {
  id: '14fa3b-20261009T1003', icao24: '14fa3b', callsign: 'RSD708', reg: 'RA-64059', typeCode: 'T204', military: true,
  firstT: T - 9000, lastT: T + 9000, triggers: [],
  what: 'Krúženie pri Moskve',
  badge: 'ÚDAJE OKO · OPENSKY + ADSB.LOL',
  intro: { spoken: 'Moskva zavrela letiská pre drony.', caption: 'Moskva zavrela letiská pre drony.' },
  timeline: [
    { kind: 'extra', t: T, lat: 55.8, lon: 39.25, alt: 6111, label: 'začiatok krúženia (15:24 MSK)', spoken: 'O pätnástej dvadsaťštyri začalo krúžiť.', caption: 'O 15:24 začalo krúžiť.' },
    { kind: 'extra', t: T + 6535, lat: 55.74, lon: 39.21, alt: 5502, label: 'koniec krúženia (17:14 MSK)' },
  ],
  track: [[T - 9000, 42.6, 51.7, 35000], [T, 55.8, 39.25, 20000], [T + 9000, 55.6, 37.29, 970]],
};

test('názov udalosti zo súboru namiesto predvoleného „strmhlavé klesanie"', () => {
  assert.equal(eventWhat(event), 'Krúženie pri Moskve');
  assert.equal(eventWhat({ ...event, what: undefined }), 'Strmhlavé klesanie', 'bez názvu ako doteraz');
});

test('popis momentu zo súboru namiesto „extra"', () => {
  assert.equal(momentPhrase(event.timeline[0]), 'začiatok krúženia (15:24 MSK)');
});

test('úvodná veta a veta pri momente z údajov OKO; moment bez vety mlčí', () => {
  const lines = narrationLines(event);
  assert.deepEqual(lines.map((l) => l.id), ['flight', 'm0', 'portal']);
  assert.equal(lines[0].spoken, 'Moskva zavrela letiská pre drony.');
  assert.equal(lines[1].caption, 'O 15:24 začalo krúžiť.');
  const plain = narrationLines({ ...event, intro: undefined });
  assert.match(plain[0].spoken, /^Let /, 'bez úvodnej vety ostáva „Let …"');
});
