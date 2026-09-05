import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIS_FRESH_MS, AIS_RETAIN_MS, acceptsAisFix, parseAisBounds, selectAisCoverage } from './aisCoverage.js';
import { buildVesselCard, buildSelectedVesselCard, isLastKnownVessel, mapAnalystRecord } from './aisLiveVessels.js';

const now = Date.parse('2026-09-05T12:00:00Z');
const row = (mmsi, lat = 50, lon = 5, age = 0) => ({ mmsi, lat, lon, last_position_epoch: (now - age) / 1000 });

test('saturated Europe cannot displace fresher-or-older contacts in other occupied cells', () => {
  const input = Array.from({ length: 100 }, (_, i) => row(String(i)));
  input.push(row('pacific', 0, -150, 60_000), row('asia', 20, 120, 120_000));
  const result = selectAisCoverage(input, { now, limit: 3 });
  assert.deepEqual(new Set(result.rows.map(r => r.mmsi)), new Set(['0', 'pacific', 'asia']));
  assert.equal(result.coverage.omittedByLimit, 99);
  assert.deepEqual(selectAisCoverage(input.reverse(), { now, limit: 3 }), result);
});

test('viewport crosses dateline and selected contact stays pinned without exceeding limit', () => {
  const bounds = parseAisBounds('170,-20,-170,20');
  const input = [row('east', 0, 179), row('west', 0, -179), row('outside', 0, 0)];
  assert.deepEqual(new Set(selectAisCoverage(input, { now, bounds }).rows.map(r => r.mmsi)), new Set(['east', 'west']));
  const result = selectAisCoverage(input, { now, bounds, selected: 'outside', limit: 2 });
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].mmsi, 'outside');
  assert.equal(result.coverage.inView, 2);
  assert.equal(result.coverage.omittedByLimit, 1);
  assert.equal(selectAisCoverage(input, { now, bounds, selected: 'outside', limit: 1 }).rows.length, 1);
});

test('fresh and last-known buckets have exact age boundaries and finite retention', () => {
  const input = [row('fresh', 0, 0, AIS_FRESH_MS - 1), row('old', 1, 1, AIS_FRESH_MS), row('expired', 2, 2, AIS_RETAIN_MS), row('invalid')];
  input[3].last_position_epoch = null;
  const result = selectAisCoverage(input, { now });
  assert.deepEqual(result.rows.map(r => r.position_state), ['fresh', 'last-known']);
  assert.equal(result.coverage.fresh, 1);
  assert.equal(result.coverage.lastKnown, 1);
  assert.equal(selectAisCoverage(input, { now, limit: 1 }).rows[0].mmsi, 'fresh');
  assert.equal(selectAisCoverage(input, { now: now + AIS_RETAIN_MS }).rows.length, 0);
});

test('static, missing-time, regressed, future and expired fixes cannot rejuvenate positions', () => {
  const previous = row('1', 0, 0, 1000);
  const time = new Date(now).toISOString();
  assert.equal(acceptsAisFix('ShipStaticData', time, previous, now), false);
  assert.equal(acceptsAisFix('StaticDataReport', time, previous, now), false);
  for (const value of [null, '', 'garbage', new Date(now - 2000).toISOString(), new Date(now + 120000).toISOString(), new Date(now - AIS_RETAIN_MS).toISOString()]) {
    assert.equal(acceptsAisFix('PositionReport', value, previous, now), false);
  }
  assert.equal(acceptsAisFix('ExtendedClassBPositionReport', time, previous, now), true);
});

test('bounds validation, poles and empty regions remain honest', () => {
  for (const value of ['1,2,3', '0,,0,0', '-181,0,0,0', '0,20,10,-20', 'x,0,0,0']) assert.equal(parseAisBounds(value), null);
  const result = selectAisCoverage([row('pole', 90, 180)], { now });
  assert.equal(result.rows.length, 1);
  assert.equal(Object.keys(result.coverage.regions).length, 72);
  assert.equal(Object.values(result.coverage.regions).filter(r => r.received === 0).length, 71);
  assert.match(result.coverage.meaning, /do not establish zero traffic/);
});

test('retained position stays fixed and is explicitly last-known in ambient, selected and analyst surfaces', () => {
  const record = { mmsi: '123', name: 'TEST', lat: 1, lon: 2, speed: 10, type: 'Cargo', positionState: 'last-known', lastPositionEpoch: (now - 3600_000) / 1000, position: { x: 1, y: 2, z: 3 } };
  assert.equal(isLastKnownVessel(record, now), true);
  const card = buildVesselCard(record);
  assert.equal(card.position, record.position);
  assert.match(card.details.join(' '), /LAST KNOWN/);
  assert.match(buildSelectedVesselCard(record, now).details.join(' '), /LAST KNOWN POSITION/);
  assert.equal(mapAnalystRecord(record).positionState, 'last-known');
  assert.equal(mapAnalystRecord(record).lastPositionEpoch, record.lastPositionEpoch);
});
