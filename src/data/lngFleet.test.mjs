// src/data/lngFleet.test.mjs
// LNG tankery v dosahu AIS (2026-09-13): index zoznamu Wikidata, typ tankera,
// klasifikácia (potvrdené IMO/MMSI, pravdepodobné meno / meno+dĺžka /
// terminál+dĺžka, nikdy nákladné lode), serverový payload, model karty
// (stav feedu, zoradenie: do EÚ, potvrdené, čerstvé), fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GAS_LNG_FLEET_API, LNG_EU_TERMINAL_RE, LNG_FLEET_MAX_ROWS, LNG_FLEET_MIN_LENGTH_M, buildLngFleetIndex, buildLngFleetModel, buildLngFleetPayload,
  classifyLngContact, fetchLngFleet, fleetFeedState, formatAge, isTankerType,
} from './lngFleet.js';

const tKey = (key, vars) => (vars && Object.keys(vars).length ? `${key} ${JSON.stringify(vars)}` : key);
const NOW = Date.UTC(2026, 8, 13, 10);
const FLEET = {
  snapshot: '2026-09-13T18:00:00.000Z', license: 'CC0 1.0 — Wikidata', ships: 3, withMmsi: 2,
  rows: [
    { imo: '9385673', name: 'GDF Suez Neptune', mmsi: ['257356000'], lengthM: 283.1, built: '2009', operator: 'Höegh LNG', flag: 'Norway' },
    { imo: '9253284', name: 'FSRU Toscana', mmsi: [], lengthM: 306.5, built: '2013', operator: null, flag: null },
    { imo: '9680188', name: 'Asia Integrity', mmsi: ['311000227'], lengthM: 285, built: null, operator: null, flag: 'Bahamas' },
  ],
};
const INDEX = buildLngFleetIndex(FLEET);
const row = (o) => ({ mmsi: '000000000', name: 'X', imo: null, type: '80', destination: null, length_m: null, draught_m: null, speed: 0, course: 0, nav_status: 0, lat: 51, lon: 3, last_position_epoch: Math.floor(NOW / 1000) - 120, ...o });

test('buildLngFleetIndex a isTankerType', () => {
  assert.equal(INDEX.ships, 3);
  assert.equal(INDEX.byImo.get('9253284').name, 'FSRU Toscana');
  assert.equal(INDEX.byMmsi.get('257356000').imo, '9385673');
  assert.equal(INDEX.withMmsi, 2);
  assert.equal(buildLngFleetIndex(null).ships, 0, 'bez zoznamu prázdny index, nie pád');
  assert.equal(isTankerType('80'), true);
  assert.equal(isTankerType(89), true);
  assert.equal(isTankerType('70'), false, 'nákladná loď');
  assert.equal(isTankerType('Tanker'), true);
  assert.equal(isTankerType('Cargo'), false);
  assert.equal(isTankerType(null), null);
  assert.equal(isTankerType('0'), null, '0 = neznámy typ');
});

test('classifyLngContact: potvrdené IMO/MMSI; pravdepodobné meno, meno + dĺžka, terminál + dĺžka; nákladné lode a malé tankery nikdy', () => {
  assert.deepEqual(classifyLngContact(row({ imo: '9385673', name: 'GDF SUEZ NEPTUNE', type: '70' }), INDEX).confidence, 'confirmed', 'IMO vyhráva aj nad zlým AIS typom');
  assert.equal(classifyLngContact(row({ mmsi: '311000227', name: 'ASIA INTEGRITY' }), INDEX).reason, 'wikidata-mmsi');
  assert.equal(classifyLngContact(row({ name: 'GASLOG GENEVA', length_m: null }), INDEX).reason, 'name', 'silné meno stačí aj bez dĺžky');
  assert.equal(classifyLngContact(row({ name: 'MARAN GAS ACHILLES', type: null }), INDEX).reason, 'name', 'neznámy typ so silným menom');
  assert.equal(classifyLngContact(row({ name: 'LNG MERAK' }), INDEX).confidence, 'likely');
  assert.equal(classifyLngContact(row({ name: 'FLEX ARTEMIS', length_m: 294 }), INDEX).reason, 'name-size');
  assert.equal(classifyLngContact(row({ name: 'FLEX ARTEMIS', length_m: 120 }), INDEX), null, 'slabé meno bez dĺžky nestačí');
  assert.equal(classifyLngContact(row({ name: 'BW ELM', length_m: 225 }), INDEX), null, 'BW pod 250 m = LPG, nie LNG');
  assert.equal(classifyLngContact(row({ name: 'SOME TANKER', length_m: 290, destination: 'PLSWI' }), INDEX).reason, 'terminal-size');
  assert.equal(classifyLngContact(row({ name: 'SOME TANKER', length_m: 290, destination: 'SABINE PASS' }), INDEX).reason, 'terminal-size');
  assert.equal(classifyLngContact(row({ name: 'SOME TANKER', length_m: 290, destination: 'FUJAIRAH' }), INDEX), null);
  assert.equal(classifyLngContact(row({ name: 'LNG CARRIER', type: '70' }), INDEX), null, 'známy iný typ = nikdy');
  assert.equal(classifyLngContact(row({ name: 'GAS GROUPER', length_m: 230 }), INDEX), null, '„GAS" samo nestačí (LPG)');
  assert.equal(classifyLngContact(row({ name: 'HOEGH TROVE', type: '70', length_m: 200 }), INDEX), null, 'Höegh autoloď nie je LNG');
  assert.equal(classifyLngContact(row({ name: 'MINERVA PELAGIA', length_m: 250, destination: 'GEDSER' }), INDEX), null, 'ropný tanker s LNG-podobným prefixom (živý falošný zásah 13. 9.) nie je LNG');
  assert.equal(classifyLngContact(row({ name: 'ENERGY CENTURION', length_m: 333 }), INDEX), null, 'VLCC „Energy …" nie je LNG');
  assert.equal(classifyLngContact(row({ name: 'ANNA KNUTSEN', length_m: 277 }), INDEX), null, 'Knutsen shuttle tanker nie je LNG');
  assert.equal(classifyLngContact(row({ name: 'CADIZ KNUTSEN', length_m: null }), INDEX).reason, 'name', 'Knutsen LNG lode sú menované');
  assert.equal(LNG_FLEET_MIN_LENGTH_M, 250);
  assert.ok(LNG_EU_TERMINAL_RE.test('SWINOUJSCIE') && LNG_EU_TERMINAL_RE.test('DEWVN') && !LNG_EU_TERMINAL_RE.test('RAS LAFFAN'));
});

test('buildLngFleetPayload: len LNG riadky, potvrdené prvé, polia z úložiska, stav polohy, počty, feed a zoznam', () => {
  const rows = [
    row({ mmsi: '257356000', imo: '9385673', name: 'GDF SUEZ NEPTUNE', destination: 'SWINOUJSCIE', eta: '09-15 06:00', speed: 12.3, course: 45, length_m: 283, draught_m: 11.2 }),
    row({ mmsi: '111111111', name: 'GASLOG GENEVA', destination: 'GATE TERMINAL', speed: 0.1, last_position_epoch: Math.floor(NOW / 1000) - 3 * 3600 }),
    row({ mmsi: '222222222', name: 'MAERSK ESSEX', type: '70', length_m: 366 }),
    row({ mmsi: '333333333', name: 'NORDIC AURORA', type: '80', length_m: 250, destination: 'FUJAIRAH' }),
  ];
  const p = buildLngFleetPayload(rows, INDEX, { now: NOW, feed: { status: 'live', active: true, retained: 4, lastMessageAt: '2026-09-13T09:59:00Z', error: null } });
  assert.deepEqual(p.counts, { scanned: 4, lng: 2, confirmed: 1, likely: 1 });
  assert.deepEqual(p.rows.map((r) => [r.mmsi, r.confidence, r.reason, r.positionState]), [['257356000', 'confirmed', 'wikidata-imo', 'fresh'], ['111111111', 'likely', 'name', 'last-known']]);
  const neptune = p.rows[0];
  assert.deepEqual([neptune.name, neptune.imo, neptune.lengthM, neptune.draughtM, neptune.speedKts, neptune.course, neptune.destination, neptune.eta, neptune.lat, neptune.lon], ['GDF SUEZ NEPTUNE', '9385673', 283, 11.2, 12.3, 45, 'SWINOUJSCIE', '09-15 06:00', 51, 3]);
  assert.deepEqual(neptune.ship, { name: 'GDF Suez Neptune', built: '2009', operator: 'Höegh LNG', lengthM: 283.1 });
  assert.equal(p.rows[1].ship, null);
  assert.equal(p.feed.active, true);
  assert.deepEqual(p.fleet, { ships: 3, withMmsi: 2, snapshot: '2026-09-13T18:00:00.000Z', license: 'CC0 1.0 — Wikidata' });
  assert.equal(p.fetchedAt, NOW);
  const many = buildLngFleetPayload(Array.from({ length: 80 }, (_, i) => row({ mmsi: String(400000000 + i), name: `LNG SHIP ${i}` })), INDEX, { now: NOW });
  assert.equal(many.rows.length, LNG_FLEET_MAX_ROWS, 'strop riadkov');
  assert.equal(many.counts.lng, 80, 'počet je skutočný aj nad stropom');
});

test('fleetFeedState a formatAge', () => {
  assert.equal(fleetFeedState(null), 'off');
  assert.equal(fleetFeedState({ status: 'idle', active: false }), 'off');
  assert.equal(fleetFeedState({ status: 'missing-key', active: false }), 'missing-key');
  assert.equal(fleetFeedState({ status: 'live', active: true }), 'live');
  assert.equal(fleetFeedState({ status: 'connecting', active: true }), 'connecting');
  assert.equal(fleetFeedState({ status: 'reconnecting', active: true, error: 'socket closed' }), 'error');
  assert.equal(formatAge(Math.floor(NOW / 1000) - 5 * 60, NOW, tKey), 'gas.fleet-age-min {"n":5}');
  assert.equal(formatAge(Math.floor(NOW / 1000) - 3 * 3600, NOW, tKey), 'gas.fleet-age-h {"n":3}');
  assert.equal(formatAge(null, NOW, tKey), '');
});

test('buildLngFleetModel: titulok s počtami, riadky zoradené (do EÚ, potvrdené, čerstvé), vlajka z MMSI, texty; feed vypnutý = ok false so stavom off', () => {
  const rows = [
    row({ mmsi: '111111111', name: 'GASLOG GENEVA', destination: 'FUJAIRAH', speed: 14, length_m: 290 }),
    row({ mmsi: '257356000', imo: '9385673', name: 'GDF SUEZ NEPTUNE', destination: 'SWINOUJSCIE', eta: '09-15 06:00', speed: 12.3, length_m: 283 }),
    row({ mmsi: '311000227', name: 'ASIA INTEGRITY', destination: null, speed: 0, last_position_epoch: Math.floor(NOW / 1000) - 2 * 3600 }),
  ];
  const payload = buildLngFleetPayload(rows, INDEX, { now: NOW, feed: { status: 'live', active: true, retained: 3, lastMessageAt: '2026-09-13T09:59:00Z', error: null } });
  const m = buildLngFleetModel(payload, { lang: 'sk', translate: tKey, nowMs: NOW, flagOf: (mmsi) => (mmsi === '257356000' ? { iso2: 'NO', name: 'Nórsko' } : null) });
  assert.equal(m.ok, true);
  assert.equal(m.state, 'live');
  assert.equal(m.headline.countText, '3');
  assert.equal(m.headline.label, 'gas.fleet-label {"scanned":"3"}');
  assert.equal(m.headline.sub, 'gas.fleet-confirmed-n {"n":2} · gas.fleet-likely-n {"n":1} · gas.fleet-eu-bound {"n":1} · gas.fleet-moving {"n":2,"fresh":2}');
  assert.deepEqual(m.rows.map((r) => r.mmsi), ['257356000', '311000227', '111111111'], 'do EÚ prvá, potom potvrdené (aj staršia poloha), potom pravdepodobné');
  const neptune = m.rows[0];
  assert.deepEqual([neptune.name, neptune.flag, neptune.confidence, neptune.confidenceText, neptune.reasonText, neptune.euBound, neptune.moving, neptune.level], ['GDF SUEZ NEPTUNE', { iso2: 'NO', name: 'Nórsko' }, 'confirmed', 'gas.fleet-confirmed', 'gas.fleet-reason-wikidata-imo', true, true, 'ok']);
  assert.equal(neptune.speedText, 'gas.fleet-speed {"v":"12,3"}');
  assert.equal(neptune.destinationText, 'SWINOUJSCIE · ETA 09-15 06:00');
  assert.equal(neptune.sizeText, '283 m · gas.fleet-built {"y":"2009"}');
  assert.equal(neptune.operator, 'Höegh LNG');
  assert.equal(neptune.ageText, 'gas.fleet-age-min {"n":2}');
  const asia = m.rows[1];
  assert.deepEqual([asia.level, asia.positionState, asia.destinationText, asia.flag], ['stale', 'last-known', 'gas.fleet-no-destination', null]);
  assert.equal(m.note, 'gas.fleet-note {"ships":"3"}');
  assert.equal(m.sourceLine, 'gas.fleet-source {"date":"2026-09-13"}');
  assert.deepEqual(m.freshness, { fetchedAt: NOW, feedLastMessageAt: '2026-09-13T09:59:00Z', retained: 3 });
  const off = buildLngFleetModel(buildLngFleetPayload([], INDEX, { now: NOW, feed: { status: 'idle', active: false, retained: 0 } }), { translate: tKey, nowMs: NOW });
  assert.deepEqual([off.ok, off.state, off.rows.length, off.headline.countText], [false, 'off', 0, '0']);
  assert.equal(buildLngFleetModel(null, { translate: tKey }).state, 'off');
});

test('fetchLngFleet a zoznam Wikidata v repe (CC0, IMO 7 číslic, provenance)', async () => {
  const calls = [];
  const out = await fetchLngFleet({ fetcher: async (url, init) => { calls.push([url, init?.cache]); return { ok: true, json: async () => ({ rows: [] }) }; } });
  assert.deepEqual(out, { rows: [] });
  assert.deepEqual(calls, [[GAS_LNG_FLEET_API, 'no-store']]);
  await assert.rejects(fetchLngFleet({ fetcher: async () => ({ ok: false, status: 503, json: async () => ({ error: 'off' }) }) }), (e) => e.status === 503 && e.code === 'off');
  const fleet = JSON.parse(readFileSync(new URL('./local_data/lng_fleet/lng-carriers.json', import.meta.url), 'utf8'));
  assert.match(fleet.license, /CC0/);
  assert.ok(fleet.rows.length >= 200, `zoznam má ${fleet.rows.length} lodí`);
  assert.ok(fleet.rows.every((s) => /^\d{7}$/.test(s.imo)), 'každá loď má 7-miestne IMO');
  assert.equal(new Set(fleet.rows.map((s) => s.imo)).size, fleet.rows.length, 'IMO sú jedinečné');
  const source = readFileSync(new URL('./local_data/lng_fleet/SOURCE.md', import.meta.url), 'utf8');
  assert.match(source, /CC0/);
  assert.match(source, /build-lng-fleet\.mjs/);
});
