// src/data/riverDirection.test.mjs — os rieky pre natočenie stojacich lodí (2026-09-27).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RIVER_SNAP_M,
  _setRiverIndexForTest,
  buildRiverIndex,
  loadRiverIndex,
  nearestRiverSegment,
  onRiverIndexReady,
  riverUpstreamBearing,
  upstreamBearingFrom,
} from './riverDirection.js';

// rieka tečúca na východ pozdĺž 48,1384° (ako Dunaj pri osobnom prístave v Bratislave)
const EAST = [[[17.09, 48.1384], [17.13, 48.1384]]];

test('najbližší úsek: smer po prúde, vzdialenosť; ďalej ako RIVER_SNAP_M nič', () => {
  const idx = buildRiverIndex(EAST);
  assert.equal(idx.segments, 1);
  const seg = nearestRiverSegment(idx, 48.1394, 17.115); // ~110 m severne (kotvisko)
  assert.ok(Math.abs(seg.downstreamDeg - 90) < 0.5, 'po prúde na východ');
  assert.ok(seg.distanceM > 100 && seg.distanceM < 125);
  assert.equal(RIVER_SNAP_M, 700);
  assert.equal(nearestRiverSegment(idx, 48.16, 17.115), null, '2,4 km od rieky');
  assert.equal(nearestRiverSegment(idx, NaN, 17.1), null);
  assert.equal(nearestRiverSegment(null, 48.1, 17.1), null);
});

test('proti prúdu = kam sa stavia príď vyviazanej riečnej lode (Vikingy v BA hlásia 268–273°)', () => {
  const idx = buildRiverIndex(EAST);
  assert.ok(Math.abs(upstreamBearingFrom(idx, 48.1394, 17.115) - 270) < 0.5);
  // rieka tečúca na juh (zákrut pri Petržalke) → proti prúdu na sever
  const south = buildRiverIndex([[[17.1453, 48.1278], [17.1454, 48.1214]]]);
  const up = upstreamBearingFrom(south, 48.125, 17.146);
  assert.ok(up < 2 || up > 358, `sever, bolo ${up}`);
  // index cez viac buniek mriežky: úsek dlhší ako bunka sa nájde aj v strede
  const long = buildRiverIndex([[[16.9, 48.14], [17.3, 48.14]]]);
  assert.ok(Math.abs(upstreamBearingFrom(long, 48.141, 17.1) - 270) < 0.5);
});

test('lenivé načítanie: pred indexom null, po ňom smer a poslucháči; zlyhanie nič nezhodí', async () => {
  _setRiverIndexForTest(null);
  assert.equal(riverUpstreamBearing(48.1394, 17.115), null, 'kým nie je index, loď ostáva pri doterajšom smere');
  let ready = 0;
  const off = onRiverIndexReady(() => { ready += 1; });
  assert.equal(await loadRiverIndex({ fetchImpl: async () => ({ ok: false }) }), false);
  assert.equal(ready, 0);
  assert.equal(await loadRiverIndex({ fetchImpl: async () => { throw new Error('offline'); } }), false);
  assert.equal(await loadRiverIndex({ fetchImpl: async () => ({ ok: true, json: async () => ({ lines: EAST }) }) }), true);
  assert.equal(ready, 1);
  assert.ok(Math.abs(riverUpstreamBearing(48.1394, 17.115) - 270) < 0.5);
  assert.equal(await loadRiverIndex({ fetchImpl: async () => { throw new Error('nemá sa volať'); } }), true, 'raz načítané');
  off();
  _setRiverIndexForTest(null);
});

test('dáta: os Dunaja z OSM po prúde, celý tok, v Bratislave na východ; licencia a kredit', () => {
  const data = JSON.parse(readFileSync(new URL('./local_data/rivers/danube.json', import.meta.url), 'utf8'));
  assert.match(data.license, /ODbL 1\.0/);
  assert.match(data.source, /relation 89652/);
  assert.ok(data.lines.length > 100);
  const lons = data.lines.flat().map((p) => p[0]);
  assert.ok(Math.min(...lons) < 9 && Math.max(...lons) > 29, 'od Schwarzwaldu po delta');
  const idx = buildRiverIndex(data.lines);
  // osobný prístav v Bratislave (Rázusovo nábrežie): proti prúdu ≈ západ
  const up = upstreamBearingFrom(idx, 48.1394, 17.115);
  assert.ok(up > 250 && up < 290, `proti prúdu v BA ${up}`);
  const credits = readFileSync(new URL('./dataCredits.js', import.meta.url), 'utf8');
  assert.match(credits, /key: 'danube-centerline'/);
  assert.match(readFileSync(new URL('./local_data/rivers/README.md', import.meta.url), 'utf8'), /ODbL/);
});
