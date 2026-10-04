// src/data/stateAircraftList.test.mjs — skutočný zoznam štátnych lietadiel SR (local_data/state-aircraft/sk.json).
// Parser záznam s chybou TICHO vynechá (zlý hex, chýbajúci zdroj) — tento test stráži, aby preklep v súbore
// nikdy nevyradil stroj zo sledovania a spätného importu bez povšimnutia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STATE_ROLES, parseStateAircraftList } from './stateAircraft.js';

const RAW = JSON.parse(readFileSync(new URL('./local_data/state-aircraft/sk.json', import.meta.url), 'utf8'));
const SK_BLOCK = [0x505c00, 0x505fff]; // ICAO Annex 10, zv. III, tab. 9-1 (overené 2026-09-30)

test('sk.json: každý stroj zo súboru prejde parserom (žiadny tichý výpadok pre preklep)', () => {
  const list = parseStateAircraftList(RAW);
  assert.equal(list.aircraft.length, RAW.aircraft.length, 'počet strojov po načítaní = počet v súbore');
  assert.equal(list.country, 'SK');
});

test('sk.json: hex v bloku SR, jedinečné hexy aj značky, úloha, aspoň dva zdroje, dátum overenia, since ≤ until', () => {
  const hexes = new Set();
  const regs = new Set();
  for (const a of RAW.aircraft) {
    const n = Number.parseInt(a.hex, 16);
    assert.ok(n >= SK_BLOCK[0] && n <= SK_BLOCK[1], `${a.reg}: hex ${a.hex} mimo bloku SR 505C00–505FFF`);
    assert.ok(!hexes.has(a.hex.toLowerCase()), `duplicitný hex ${a.hex}`);
    assert.ok(!regs.has(a.reg), `duplicitná značka ${a.reg}`);
    hexes.add(a.hex.toLowerCase());
    regs.add(a.reg);
    assert.ok(STATE_ROLES.includes(a.role), `${a.reg}: úloha ${a.role}`);
    assert.ok(Array.isArray(a.sources) && a.sources.length >= 2, `${a.reg}: aspoň dva zdroje`);
    assert.ok(a.sources.every((s) => /^https:\/\//.test(s)), `${a.reg}: zdroje ako https odkazy`);
    assert.match(a.verified, /^\d{4}-\d{2}-\d{2}$/, `${a.reg}: dátum overenia`);
    if (a.since && a.until) assert.ok(a.since <= a.until, `${a.reg}: since ≤ until`);
    assert.ok(a.operator?.sk && a.operator?.en, `${a.reg}: prevádzkovateľ SK aj EN`);
  }
});

test('sk.json: etapy podľa vlastníka — vládna letka LÚ MV SR (vláda) a dva Global 5000 Vzdušných síl (vojenské)', () => {
  const byReg = new Map(RAW.aircraft.map((a) => [a.reg, a]));
  for (const reg of ['OM-BYA', 'OM-BYK', 'OM-BYB', 'OM-BYC']) assert.equal(byReg.get(reg)?.role, 'government', reg);
  assert.equal(byReg.get('OM-BYC').until, '2025-02-11', 'vyradený stroj má koniec služby — import za ním nepokračuje');
  for (const reg of ['9513', '9633']) {
    assert.equal(byReg.get(reg)?.role, 'military', reg);
    assert.equal(byReg.get(reg)?.typeCode, 'GL5T', reg);
  }
});
