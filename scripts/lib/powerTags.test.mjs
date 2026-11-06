// scripts/lib/powerTags.test.mjs
// Tagy vedení vysokého napätia (ELEKTRINA, 2026-11-06): napätia, prah 220 kV,
// klasifikácia line/cable a vlastnosti prvku pre snímok.
import test from 'node:test';
import assert from 'node:assert/strict';

import { MIN_TRANSMISSION_VOLTS, classifyPowerLine, frequencyOf, powerLineProperties, voltagesOf } from './powerTags.mjs';

test('voltagesOf: jedno aj viac napätí, kilovolty, odpad', () => {
  assert.deepEqual(voltagesOf('400000'), [400000]);
  assert.deepEqual(voltagesOf('400000;110000'), [400000, 110000]);
  assert.deepEqual(voltagesOf('110000;400000;400000'), [400000, 110000], 'zostupne, bez duplikátov');
  assert.deepEqual(voltagesOf('400 kV'), [400000]);
  assert.deepEqual(voltagesOf('380'), [380000], 'holé číslo pod 2 000 = kilovolty');
  assert.deepEqual(voltagesOf('medium'), []);
  assert.deepEqual(voltagesOf(undefined), []);
});

test('classifyPowerLine: prah 220 kV, len line a cable, vlastné napätie cesty má prednosť', () => {
  assert.equal(MIN_TRANSMISSION_VOLTS, 220_000);
  assert.equal(classifyPowerLine({ power: 'line', voltage: '400000' }), 'line');
  assert.equal(classifyPowerLine({ power: 'line', voltage: '225000' }), 'line', 'francúzskych 225 kV patrí dnu');
  assert.equal(classifyPowerLine({ power: 'cable', voltage: '450000', frequency: '0' }), 'cable', 'HVDC kábel');
  assert.equal(classifyPowerLine({ power: 'line', voltage: '110000' }), null);
  assert.equal(classifyPowerLine({ power: 'line', voltage: '110000;400000' }), 'line', 'stačí jedno napätie nad prahom');
  assert.equal(classifyPowerLine({ power: 'substation', voltage: '400000' }), null, 'rozvodňa z relácie sa nekreslí');
  assert.equal(classifyPowerLine({ power: 'minor_line', voltage: '400000' }), null);
  assert.equal(classifyPowerLine({ power: 'line' }), null, 'bez napätia von');
  // Zlúčené tagy relácie + cesty: cesta s vlastným 110 kV v 400 kV relácii ide von,
  // cesta bez vlastného napätia dedí napätie relácie (zlučuje engine).
  assert.equal(classifyPowerLine({ route: 'power', power: 'line', voltage: '110000' }), null);
});

test('frequencyOf: 50, 0 (HVDC), 16.7, odpad', () => {
  assert.equal(frequencyOf('50'), 50);
  assert.equal(frequencyOf('0'), 0);
  assert.equal(frequencyOf('16,7'), 16.7);
  assert.equal(frequencyOf(''), null);
  assert.equal(frequencyOf('AC'), null);
});

test('powerLineProperties: meno bez ref, napätia, obvody, káble, frekvencia; základ engine prechádza', () => {
  const base = { name: 'V499', nameEn: null, nameSk: null, intName: null, nameLang: null, operator: 'SEPS', ref: 'V499', location: null, from: 'Lemešany', to: 'Moldava', status: 'operating', osm: 1, relation: 7 };
  const p = powerLineProperties({ power: 'line', voltage: '400000;110000', circuits: '2', cables: '6', wires: 'triple', frequency: '50', ref: 'V499', operator: 'SEPS' }, base);
  assert.equal(p.name, null, 'ref nie je meno');
  assert.equal(p.ref, 'V499');
  assert.equal(p.power, 'line');
  assert.equal(p.voltageV, 400000);
  assert.deepEqual(p.voltages, [400000, 110000]);
  assert.equal(p.circuits, 2);
  assert.equal(p.cables, 6);
  assert.equal(p.wires, 'triple');
  assert.equal(p.frequency, 50);
  assert.equal(p.from, 'Lemešany');
  assert.equal(p.relation, 7);
  assert.equal(p.status, 'operating');
  assert.ok(!('diameterMm' in p) && !('substance' in p), 'vedenie nemá priemer ani látku');
  const dc = powerLineProperties({ power: 'cable', voltage: '525000', frequency: '0', name: 'NordLink' }, { ...base, name: 'NordLink', ref: null });
  assert.equal(dc.power, 'cable');
  assert.equal(dc.frequency, 0);
  assert.equal(dc.name, 'NordLink');
  assert.equal(dc.circuits, null);
});
