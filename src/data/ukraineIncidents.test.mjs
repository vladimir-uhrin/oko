// src/data/ukraineIncidents.test.mjs — klasifikácia a gazetteer regiónu ukraine (etapa 2).
import test from 'node:test';
import assert from 'node:assert/strict';

import { UKRAINE_GAZETTEER, UKRAINE_INCIDENT_RULES, classifyUkraineIncident } from './ukraineIncidents.js';
import { locateIncident } from './gulfIncidents.js';

test('klasifikácia: úder, požiar, infraštruktúra len s činom, námorná, pozemná, PVO; inak null', () => {
  assert.equal(classifyUkraineIncident('Russian missile strike hits Kharkiv apartment block').type, 'strike');
  assert.equal(classifyUkraineIncident('Shahed drones attack Odesa overnight').type, 'strike');
  assert.equal(classifyUkraineIncident('Explosions reported in Sevastopol').type, 'fire');
  assert.equal(classifyUkraineIncident('Power plant in Kremenchuk damaged, blackout in the region').type, 'infrastructure');
  assert.equal(classifyUkraineIncident("Ukraine's energy sector needs investment, minister says"), null, 'infraštruktúra bez činu nie je udalosť');
  assert.equal(classifyUkraineIncident('Sea drone damages Russian warship in the Black Sea').type, 'naval');
  assert.equal(classifyUkraineIncident('Russian forces advance near Pokrovsk, capture village').type, 'ground');
  assert.equal(classifyUkraineIncident('Ukraine says it repelled assaults near Kupiansk').type, 'ground', 'útok pred PVO');
  assert.equal(classifyUkraineIncident('Air defence shot down 40 drones overnight').type, 'air-defence');
  assert.equal(classifyUkraineIncident('Zelensky meets EU leaders in Brussels'), null);
  assert.equal(classifyUkraineIncident(''), null);
  assert.equal(classifyUkraineIncident('Drone strike on refinery').severity, 'critical');
  assert.equal(classifyUkraineIncident('Troops advance toward Lyman').severity, 'major');
  assert.equal(classifyUkraineIncident('Missiles intercepted over Kyiv').type, 'air-defence', 'zostrelené = PVO, kým nič nezasiahli');
  assert.equal(classifyUkraineIncident('Drones shot down but debris hits homes in Kyiv').type, 'strike', 'zásah preváži PVO');
  assert.equal(classifyUkraineIncident('Drone attack on tanker in the Black Sea').type, 'naval', 'námorné pred úderom');
  assert.equal(classifyUkraineIncident('Missile strike on Odesa port').type, 'strike', 'prístav bez námorného objektu je úder');
  assert.ok(UKRAINE_INCIDENT_RULES.length >= 5);
});

test('gazetteer: konkrétne mesto pred oblasťou a štátom, varianty prepisu, ruské pohraničie', () => {
  assert.equal(locateIncident('Strike on Pokrovsk direction, Donetsk region', UKRAINE_GAZETTEER).name, 'Pokrovsk');
  assert.equal(locateIncident('Kostyantynivka shelled overnight', UKRAINE_GAZETTEER).name, 'Kostiantynivka');
  assert.equal(locateIncident('Blast in Kiev', UKRAINE_GAZETTEER).name, 'Kyiv');
  assert.equal(locateIncident('Drones over Belgorod region', UKRAINE_GAZETTEER).name, 'Belgorod');
  assert.equal(locateIncident('Fighting in the Kursk region', UKRAINE_GAZETTEER).name, 'Kursk');
  assert.equal(locateIncident('Explosions at Zaporizhzhia nuclear plant', UKRAINE_GAZETTEER).name, 'Enerhodar (Zaporizhzhia NPP)');
  assert.equal(locateIncident('Warship hit in the Black Sea', UKRAINE_GAZETTEER).name, 'Black Sea');
  assert.equal(locateIncident('Talks in Brussels', UKRAINE_GAZETTEER), null);
  const names = new Set();
  for (const p of UKRAINE_GAZETTEER) {
    assert.ok(Number.isFinite(p.lat) && Number.isFinite(p.lon), p.name);
    assert.ok(p.lat > 43 && p.lat < 57 && p.lon > 21 && p.lon < 48, `mimo okna: ${p.name}`);
    assert.ok(p.aliases.length >= 1 && p.aliases.every((a) => a === a.toLowerCase()), `aliasy malými: ${p.name}`);
    assert.equal(names.has(p.name), false, `duplicitné meno ${p.name}`);
    names.add(p.name);
  }
  assert.ok(UKRAINE_GAZETTEER.length >= 80);
});
