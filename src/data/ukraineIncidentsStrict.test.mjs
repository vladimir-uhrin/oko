// src/data/ukraineIncidentsStrict.test.mjs — prísny lokátor anglických správ pre
// Ukrajinu (2026-09-24): celé slová, menovce s prídavným menom, oblasť pri sídle.
// Prípady z reálneho archívu správ (D:/OKO/gev-cache/ukraine/events/news).
import test from 'node:test';
import assert from 'node:assert/strict';

import { GULF_GAZETTEER, locateIncident } from './gulfIncidents.js';
import { UKRAINE_GAZETTEER, UKRAINE_OBLASTS_EN } from './ukraineIncidents.js';

const at = (t) => locateIncident(t, UKRAINE_GAZETTEER)?.name ?? null;

test('celé slová: „Dnipropetrovsk region" nie je mesto Dnipro, „Pokrovsky Church" nie je Pokrovsk', () => {
  assert.equal(at('Four injured in Russian attacks across Dnipropetrovsk region'), 'Dnipropetrovsk Oblast');
  assert.equal(at("Russian drone attack on Kyiv's Dniprovskyi district: five injured"), 'Kyiv');
  assert.equal(at('Russian attack damages 120-year-old St. Pokrovsky Church in Kyiv'), 'Kyiv');
  assert.equal(at('Blast in Dnipro overnight'), 'Dnipro');
  assert.equal(at("Kharkiv's mayor reports strikes"), 'Kharkiv', 'privlastnenie áno');
});

test('menovce: prídavné meno pred menom sídla a vzdialená oblasť pri ňom', () => {
  assert.equal(at('Drones spotted near Nova Borova'), null, 'Nova Borova ≠ Borova');
  assert.equal(at('Shelling of Borova in Kharkiv region'), 'Borova');
  assert.equal(at('Lviv region: explosions reported in Pokrovsk'), 'Lviv Oblast', 'vymyslený menovec — oblasť pred ním');
  assert.equal(at('Explosions in Pokrovsk, Donetsk region'), 'Pokrovsk', 'blízka oblasť potvrdí sídlo');
  assert.equal(at('Drones from Lviv region hit Pokrovsk'), 'Pokrovsk', '„from … region" sídlo nekvalifikuje');
  assert.ok(Object.keys(UKRAINE_OBLASTS_EN).length >= 24);
});

test('titulky s viacerými miestami: oblasť rozhodne len keď miesto naozaj kvalifikuje', () => {
  // Holá čiarka, „and", pomlčka ani nový riadok sídlo nekvalifikujú.
  assert.equal(at('Strikes hit Pokrovsk, Lviv region also targeted'), 'Pokrovsk');
  assert.equal(at('Attacks on Pokrovsk and Lviv region overnight'), 'Pokrovsk');
  assert.equal(at('Lviv region alert lifted — shelling continues in Pokrovsk'), 'Pokrovsk');
  assert.equal(at('Aftermath of Russian missile strike on Kramatorsk\nLviv region was also targeted overnight.'), 'Kramatorsk');
  // Krajské mesto sa nikdy nedegraduje na menovca.
  assert.equal(at('Lviv region: debris fell in Kharkiv'), 'Kharkiv');
  // Nadpis a „In the X region," kvalifikujú.
  assert.equal(at('Lviv region: explosions reported in Pokrovsk'), 'Lviv Oblast');
  assert.equal(at('In the Lviv region, explosions near Pokrovsk'), 'Lviv Oblast');
  assert.equal(at('Explosions near Pokrovsk in the Lviv region'), 'Lviv Oblast');
});

test('ZÁLIV ostáva pri pôvodnom hľadaní podreťazcov', () => {
  assert.equal(locateIncident('Blast reported near Fujairah port', GULF_GAZETTEER).name, 'Fujairah');
  assert.equal(locateIncident('Houthis launch drone').name, 'Yemen', 'houthi v houthis (podreťazec) — ZÁLIV bez zmeny');
});
