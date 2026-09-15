// src/data/aishubVesselsCore.test.mjs
// AISHub cez aiscast — čisté pomôcky (2026-09-15): parser bboxu so stropom
// plochy, preklad na poradie aiscastu, normalizácia GeoJSON feature na riadok.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AISHUB_MAX_AREA_SQ_DEG,
  aishubBboxError,
  aishubUpstreamBbox,
  normalizeAishubCollection,
  normalizeAishubFeature,
  parseAishubBbox,
} from './aishubVesselsCore.js';

test('parseAishubBbox: štyri čísla west,south,east,north; inak null', () => {
  assert.deepEqual(parseAishubBbox('16.5,47.5,18.5,48.3'), { west: 16.5, south: 47.5, east: 18.5, north: 48.3 });
  assert.deepEqual(parseAishubBbox(' -5 , 50 , -3 , 51 '), { west: -5, south: 50, east: -3, north: 51 });
  assert.equal(parseAishubBbox('1,2,3'), null);
  assert.equal(parseAishubBbox('a,b,c,d'), null);
  assert.equal(parseAishubBbox(''), null);
  assert.equal(parseAishubBbox(null), null);
});

test('aishubBboxError: rozsah, poradie, strop plochy (~90 sq°) — priveľký výrez sa odmietne', () => {
  assert.equal(aishubBboxError({ west: 16.5, south: 47.5, east: 18.5, north: 48.3 }), null);
  assert.match(aishubBboxError({ west: 16.5, south: 47.5, east: 200, north: 48.3 }), /out of range/);
  assert.match(aishubBboxError({ west: 18.5, south: 47.5, east: 16.5, north: 48.3 }), /west<east/);
  assert.match(aishubBboxError({ west: 0, south: 0, east: 10, north: 48.3 }), /exceeds/, '10×48 = 483 sq° > 90');
  assert.match(aishubBboxError(null), /four numbers/);
  // presne na hranici je OK, tesne nad ňou nie
  assert.equal(aishubBboxError({ west: 0, south: 0, east: 9, north: 10 }), null, '9×10 = 90 sq° je OK');
  assert.match(aishubBboxError({ west: 0, south: 0, east: 9, north: 10.1 }), /exceeds/);
  assert.equal(AISHUB_MAX_AREA_SQ_DEG, 90);
});

test('aishubUpstreamBbox: appka posiela west,south,east,north; aiscast chce south,west,north,east', () => {
  assert.equal(aishubUpstreamBbox({ west: 1, south: 50, east: 2, north: 51 }), '50,1,51,2');
});

test('normalizeAishubFeature: geometria [lon,lat] → riadok; MMSI a poloha povinné; typ/meno voliteľné; seen → ms', () => {
  const feature = {
    geometry: { type: 'Point', coordinates: [1.802, 51.076] },
    properties: { mmsi: 256007000, cog: 294.9, sog: 0.1, heading: 29, nav_status: 1, seen: '2026-09-15T20:10:23Z', source: 'aishub', station: 'aishub' },
  };
  const row = normalizeAishubFeature(feature);
  assert.equal(row.mmsi, '256007000');
  assert.equal(row.lon, 1.802);
  assert.equal(row.lat, 51.076);
  assert.equal(row.sog, 0.1);
  assert.equal(row.cog, 294.9);
  assert.equal(row.heading, 29);
  assert.equal(row.source, 'aishub');
  assert.equal(row.name, null);
  assert.equal(row.type, null);
  assert.equal(row.observedAt, Date.parse('2026-09-15T20:10:23Z'));
  // statický záznam so menom a typom
  const withStatic = normalizeAishubFeature({ geometry: { coordinates: [10, 20] }, properties: { mmsi: '211234567', name: ' NORDIC ', ship_type: 70, callsign: 'DABC', source: 'aisstream' } });
  assert.equal(withStatic.name, 'NORDIC');
  assert.equal(withStatic.type, '70', 'číselný AIS typ ostáva reťazcom');
  assert.equal(withStatic.callsign, 'DABC');
  assert.equal(withStatic.source, 'aisstream');
  // odmietnutia
  assert.equal(normalizeAishubFeature({ properties: { mmsi: '', name: 'X' }, geometry: { coordinates: [1, 2] } }), null, 'bez MMSI nič');
  assert.equal(normalizeAishubFeature({ properties: { mmsi: '256007000' }, geometry: { coordinates: [999, 2] } }), null, 'zlá poloha nič');
  assert.equal(normalizeAishubFeature({ properties: { mmsi: '256007000' } }), null, 'bez geometrie nič');
  assert.equal(normalizeAishubFeature(null), null);
});

test('normalizeAishubCollection: riadky + počty po zdrojoch + atribúcia po zdrojoch', () => {
  const json = {
    type: 'FeatureCollection',
    attribution: { aishub: 'Open Waters AIS (https://openwaters.io/ais/). AISHub (https://www.aishub.net)', aisstream: 'Open Waters AIS. aisstream.io' },
    features: [
      { geometry: { coordinates: [1, 51] }, properties: { mmsi: '111111111', source: 'aishub' } },
      { geometry: { coordinates: [1.1, 51.1] }, properties: { mmsi: '222222222', source: 'aishub' } },
      { geometry: { coordinates: [1.2, 51.2] }, properties: { mmsi: '333333333', source: 'aisstream' } },
      { geometry: { coordinates: [999, 0] }, properties: { mmsi: '444444444', source: 'aishub' } }, // zahodí sa
    ],
  };
  const out = normalizeAishubCollection(json);
  assert.equal(out.rows.length, 3);
  assert.deepEqual(out.counts, { aishub: 2, aisstream: 1 });
  assert.match(out.attribution.aishub, /AISHub/);
  assert.deepEqual(normalizeAishubCollection({}).rows, []);
});
