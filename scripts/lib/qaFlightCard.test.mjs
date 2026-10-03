// scripts/lib/qaFlightCard.test.mjs — čo kontrola karty lietadla pred publikovaním (scripts/qa-flight-card.mjs)
// považuje za úplnú kartu: volací znak, číslo letu, trasa „A → B" a čas pristátia. Chýbajúci údaj musí menovať.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hoverCardProblems } from '../qa-flight-card.mjs';

const FULL = 'NSZ7DE · D87DE Letová hladina FL380 (≈ 11 582 m) Rýchlosť 446 kts (827 km/h) · kurz 351° (S) Norwegian Air Sweden AOC '
  + 'CTA Catania (Taliansko) → CPH Copenhagen (Dánsko) 60 % trasy · zostáva 824 km · pristátie za 1 h (22:50) VÝŠKA odhad CTA CPH RÝCHLOSŤ CTA CPH';
const flight = { callsign: 'NSZ7DE', flightIata: 'D87DE' };

test('úplná karta lietadla nemá výhrady (aj po anglicky)', () => {
  assert.deepEqual(hoverCardProblems(FULL, flight), []);
  assert.deepEqual(hoverCardProblems('NSZ7DE · D87DE CTA Catania (Italy) → CPH Copenhagen (Denmark) 60 % of route · landing in 1 h (22:50)', flight), []);
});

test('chýbajúca trasa, čas pristátia alebo číslo letu sa pomenuje', () => {
  const noRoute = FULL.replace('CTA Catania (Taliansko) → CPH Copenhagen (Dánsko) ', '');
  assert.deepEqual(hoverCardProblems(noRoute, flight), ['chýba trasa (A → B)']);
  assert.deepEqual(hoverCardProblems(FULL.replace(' (22:50)', ''), flight), ['chýba čas pristátia (HH:MM)']);
  assert.deepEqual(hoverCardProblems(FULL.replace(' · D87DE', ''), flight), ['chýba číslo letu D87DE']);
  assert.deepEqual(hoverCardProblems('', flight), ['chýba volací znak NSZ7DE', 'chýba číslo letu D87DE', 'chýba trasa (A → B)', 'chýba čas pristátia (HH:MM)']);
  assert.equal(hoverCardProblems(null, {}).length, 2, 'bez známeho letu sa stále žiada trasa a čas');
});
