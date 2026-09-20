// scripts/lib/ukraineAreas.test.mjs — plochy K2: dlaždice, dopyt, relácie, zjednodušenie, prahy, vlastníctvo.
import test from 'node:test';
import assert from 'node:assert/strict';

import { AREAS_MIN_KM2, areaClassOf, buildAreasQuery, chainRings, elementsToAreas, isTileKey, ringAreaKm2, ringsFromElement, simplifyLine, simplifyRing, tileBbox, tileKey, tilesForScenes } from './ukraineAreas.mjs';

test('kľúč dlaždice a späť, aj záporné súradnice', () => {
  assert.equal(tileKey(48.62, 37.15), 'N48E037');
  assert.equal(tileKey(-1.5, -0.2), 'S02W001');
  assert.deepEqual(tileBbox('N48E037'), [37, 48, 38, 49]);
  assert.deepEqual(tileBbox('S02W001'), [-1, -2, 0, -1]);
  assert.equal(tileBbox('bogus'), null);
  assert.equal(isTileKey('N48E037'), true); assert.equal(isTileKey('../x'), false);
});

test('dlaždice pre okná smerov: bez prehľadu, bez duplicít, od stredu Donbasu von', () => {
  const scenes = [
    { id: 'front', overview: true, rectDegrees: [32, 45.6, 40.4, 51.6] },
    { id: 'lyman', rectDegrees: [37.15, 48.62, 38.5, 49.4] },
    { id: 'kherson', rectDegrees: [31.9, 46.2, 33.75, 47.1] },
  ];
  const tiles = tilesForScenes(scenes);
  const keys = tiles.map((t) => t.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes('N48E037') && keys.includes('N49E038') && keys.includes('N46E031'));
  assert.ok(!keys.includes('N45E032'), 'prehľadové okno sa nepočíta');
  assert.equal(keys[0], 'N48E037', 'najbližšia k stredu Donbasu prvá');
  assert.ok(keys.indexOf('N46E031') > keys.indexOf('N49E038'), 'Cherson až po Donbase');
  assert.deepEqual(tiles[0].scenes, ['lyman']);
  assert.equal(tiles.length, 4 + 6, 'Lyman 2×2, Cherson 2×3');
});

test('Overpass dopyt: bbox S,W,N,E, štyri triedy, out geom', () => {
  const q = buildAreasQuery([37, 48, 38, 49]);
  assert.match(q, /\(48,37,49,38\)/);
  assert.match(q, /landuse.*residential\|industrial/);
  assert.match(q, /natural"="wood"/); assert.match(q, /natural"="water"/); assert.match(q, /railway"="rail"/);
  assert.match(q, /out geom;$/);
  assert.equal(areaClassOf({ landuse: 'industrial' }), 'built');
  assert.equal(areaClassOf({ natural: 'wood' }), 'forest');
  assert.equal(areaClassOf({ landuse: 'grass' }), null);
});

test('relácia: vonkajšie úseky sa zreťazia (aj otočené), vnútorné idú za nimi; otvorený spôsob = nič', () => {
  const rel = { type: 'relation', tags: { natural: 'wood' }, members: [
    { type: 'way', role: 'outer', geometry: [{ lon: 0, lat: 0 }, { lon: 1, lat: 0 }, { lon: 1, lat: 1 }] },
    { type: 'way', role: 'outer', geometry: [{ lon: 0, lat: 0 }, { lon: 0, lat: 1 }, { lon: 1, lat: 1 }] }, // otočený úsek
    { type: 'way', role: 'inner', geometry: [{ lon: 0.4, lat: 0.4 }, { lon: 0.6, lat: 0.4 }, { lon: 0.6, lat: 0.6 }, { lon: 0.4, lat: 0.6 }, { lon: 0.4, lat: 0.4 }] },
  ] };
  const g = ringsFromElement(rel);
  assert.equal(g.rings.length, 2);
  assert.equal(g.rings[0].length, 5, 'vonkajší prstenec uzavretý (5 bodov)');
  assert.deepEqual(g.rings[0][0], g.rings[0][4]);
  assert.equal(g.rings[1].length, 5);
  assert.equal(ringsFromElement({ type: 'way', tags: { natural: 'wood' }, geometry: [{ lon: 0, lat: 0 }, { lon: 1, lat: 0 }, { lon: 1, lat: 1 }] }), null, 'neuzavretý spôsob');
  assert.deepEqual(ringsFromElement({ type: 'way', tags: { railway: 'rail' }, geometry: [{ lon: 0, lat: 0 }, { lon: 1, lat: 1 }] }), { line: [[0, 0], [1, 1]] });
  assert.equal(chainRings([[[0, 0], [1, 0]], [[5, 5], [6, 6]]]).length, 0, 'nezreťaziteľné úseky = žiadny prstenec');
});

test('Douglas–Peucker: kolineárne body zmiznú, odchýlka nad toleranciu ostane; prstenec ostáva uzavretý', () => {
  const line = [[0, 0], [0.5, 0.00001], [1, 0], [1, 0.5], [1, 1]];
  assert.deepEqual(simplifyLine(line, 0.0001), [[0, 0], [1, 0], [1, 1]]);
  assert.deepEqual(simplifyLine(line, 0.000001), [[0, 0], [0.5, 0.00001], [1, 0], [1, 1]], 'malá tolerancia nechá odchýlku, presne kolineárny bod [1,0.5] zmizne');
  const ring = [[0, 0], [1, 0], [1, 0.00001], [1, 1], [0, 1], [0, 0]];
  const s = simplifyRing(ring, 0.0001);
  assert.deepEqual(s[0], s[s.length - 1]);
  assert.equal(s.length, 5);
  assert.ok(Math.abs(ringAreaKm2([[37, 48], [37.01, 48], [37.01, 48.01], [37, 48.01], [37, 48]]) - 0.83) < 0.02, '0,01°×0,01° pri 48° ≈ 0,83 km²');
});

test('elementsToAreas: prahy plochy, vlastníctvo podľa ťažiska, zaokrúhlenie, strop, železnice podľa prieniku', () => {
  const sq = (lon, lat, d, tags, type = 'way') => ({ type, id: Math.random(), tags, geometry: [{ lon, lat }, { lon: lon + d, lat }, { lon: lon + d, lat: lat + d }, { lon, lat: lat + d }, { lon, lat }] });
  const elements = [
    sq(37.2, 48.2, 0.02, { landuse: 'residential' }),          // ~3,3 km² → ostáva
    sq(37.3, 48.3, 0.0005, { landuse: 'residential' }),        // ~0,002 km² → tiny
    sq(37.99, 48.5, 0.03, { natural: 'wood' }),                // ťažisko 38,005 → cudzia dlaždica
    sq(37.5, 48.5, 0.03, { natural: 'wood' }),                 // ostáva
    sq(37.6, 48.6, 0.01, { natural: 'water' }),                // ~0,8 km² → ostáva
    { type: 'way', tags: { railway: 'rail' }, geometry: [{ lon: 36.9, lat: 48.5 }, { lon: 37.2, lat: 48.5 }] },
    { type: 'way', tags: { railway: 'rail' }, geometry: [{ lon: 36.5, lat: 48.5 }, { lon: 36.7, lat: 48.5 }] }, // mimo
    { type: 'way', tags: { landuse: 'grass' }, geometry: [] },
  ];
  const out = elementsToAreas(elements, { bbox: [37, 48, 38, 49] });
  assert.deepEqual(out.counts, { built: 1, forest: 1, water: 1, rail: 1 });
  assert.equal(out.dropped.tiny, 1); assert.equal(out.dropped.foreign, 2);
  assert.equal(out.built[0][0].length, 5);
  assert.equal(String(out.built[0][0][1][0]).split('.')[1].length <= 5, true, '5 desatinných');
  assert.ok(AREAS_MIN_KM2.forest > AREAS_MIN_KM2.built);
  const many = Array.from({ length: 5 }, (_, i) => sq(37.1 + i * 0.1, 48.1, 0.01 + i * 0.001, { natural: 'water' }));
  const capped = elementsToAreas(many, { bbox: [37, 48, 38, 49], maxPerClass: 2 });
  assert.equal(capped.counts.water, 2); assert.equal(capped.dropped.cap_water, 3);
  assert.ok(ringAreaKm2(capped.water[0][0]) >= ringAreaKm2(capped.water[1][0]), 'najväčšie prvé');
});
