import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAdsbLolAircraftState,
  normalizeAdsbLolPointResponse,
} from './adsbLolFallback.js';

test('normalizes adsb.lol units into an OpenSky-compatible state vector', () => {
  const state = normalizeAdsbLolAircraftState({
    hex: 'A1B2C3',
    flight: 'UAL123 ',
    lat: 30,
    lon: -97,
    alt_baro: 10000,
    alt_geom: 10200,
    gs: 200,
    track: 90,
    baro_rate: 600,
    seen_pos: 2,
    seen: 1,
    category: 'A3',
    t: 'B763 ',
    r: ' N397UP',
    ownOp: 'UNITED PARCEL SERVICE CO',
    desc: 'BOEING 767-300',
  }, 1000);

  assert.equal(state[0], 'a1b2c3');
  assert.equal(state[1], 'UAL123');
  assert.equal(state[2], null);
  assert.equal(state[3], 998);
  assert.equal(state[5], -97);
  assert.equal(state[6], 30);
  assert.equal(state[7], 3048);
  assert.ok(Math.abs(state[9] - 102.8888) < 0.001);
  assert.equal(state[10], 90);
  assert.ok(Math.abs(state[11] - 3.048) < 0.001);
  assert.equal(state[13], 3108.96);
  assert.equal(state[17], 4);
  // Feed-level identity ride-along (indices PAST the OpenSky 18-slot spec —
  // additive, so the OpenSky primary path stays byte-identical): the readsb
  // family (adsb.lol/adsb.fi) sends type/registration/operator/full-name for
  // most airframes and the old normalizer threw them away, leaving the
  // fallback fleet identity-blind until adsbdb enrichment landed.
  assert.equal(state[18], 'B763');
  assert.equal(state[19], 'N397UP');
  assert.equal(state[20], 'UNITED PARCEL SERVICE CO');
  assert.equal(state[21], 'BOEING 767-300');
});

test('identity ride-along fields default to null and keep the r-as-callsign fallback', () => {
  // No identity fields at all → nulls, never undefined (downstream destructure
  // treats undefined and null the same, but the vector must stay JSON-safe).
  const bare = normalizeAdsbLolAircraftState({ hex: 'abc123', lat: 1, lon: 2 }, 10);
  assert.equal(bare.length, 22);
  assert.equal(bare[18], null);
  assert.equal(bare[19], null);
  assert.equal(bare[20], null);
  assert.equal(bare[21], null);

  // A callsign-less record still heads with the registration in slot [1]
  // (pre-existing behavior) AND carries it structurally in slot [19] so the
  // card can render identity without guessing what slot [1] means.
  const tail = normalizeAdsbLolAircraftState({ hex: 'abc123', lat: 1, lon: 2, r: 'OM-ABC' }, 10);
  assert.equal(tail[1], 'OM-ABC');
  assert.equal(tail[19], 'OM-ABC');
});

test('keeps grounded fallback contacts and rejects rows without positions', () => {
  const normalized = normalizeAdsbLolPointResponse({
    now: 1_700_000_000_000,
    ac: [
      { hex: 'abc123', lat: 0, lon: 0, alt_baro: 'ground', gs: 8 },
      { hex: 'def456', lat: null, lon: 10, alt_baro: 5000 },
    ],
  });

  assert.equal(normalized.time, 1_700_000_000);
  assert.equal(normalized.states.length, 1);
  assert.equal(normalized.states[0][7], null);
  assert.equal(normalized.states[0][8], true);
});
