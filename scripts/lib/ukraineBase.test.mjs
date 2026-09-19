// scripts/lib/ukraineBase.test.mjs — podklad UKRAJINA (etapa 1): dopyty,
// mená, zlúčenie ciest cez dlaždice, spájanie úsekov, rieky s prahom, oblasti.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CRIMEA_BBOX,
  RIVER_MIN_KM,
  RU_BORDER_STRIP,
  UKRAINE_OUTLINE,
  UKRAINE_TILES,
  buildOblastsQuery,
  buildPlacesQuery,
  buildRiversQuery,
  buildRoadsQuery,
  chainLines,
  intersectBbox,
  mergeWays,
  nameLang,
  oblastFeatures,
  parsePopulation,
  placeFeature,
  riverFeatures,
  roadFeatures,
  summarizeFeatures,
} from './ukraineBase.mjs';

test('dlaždice pokrývajú okno bez dier a bez prekryvu', () => {
  for (let i = 1; i < UKRAINE_TILES.length; i += 1) {
    assert.equal(UKRAINE_TILES[i][1], UKRAINE_TILES[i - 1][3], 'západ ďalšej = východ predošlej');
  }
  assert.equal(intersectBbox([44, 22, 53, 27], RU_BORDER_STRIP), null, 'západná dlaždica sa ruského pásu nedotýka');
  assert.deepEqual(intersectBbox([44, 32, 53, 36.5], RU_BORDER_STRIP), [50.2, 33.8, 52.6, 36.5]);
});

test('obrys Ukrajiny je uzavretý polygón v [lat, lon] a Krym má vlastný rámec', () => {
  assert.ok(UKRAINE_OUTLINE.length > 100);
  assert.deepEqual(UKRAINE_OUTLINE[0], UKRAINE_OUTLINE[UKRAINE_OUTLINE.length - 1], 'prvý = posledný vrchol');
  for (const [lat, lon] of UKRAINE_OUTLINE) {
    assert.ok(lat > 44 && lat < 53 && lon > 21 && lon < 41, `vrchol mimo okna: ${lat}, ${lon}`);
  }
  assert.ok(Math.min(...UKRAINE_OUTLINE.map(([lat]) => lat)) > 44.9, 'Natural Earth obrys končí nad Krymom (de facto POV)');
  assert.ok(CRIMEA_BBOX[0] < 44.5 && CRIMEA_BBOX[2] > 46, 'krymský rámec siaha po Perekop');
});

test('dopyty: polygón Ukrajiny (nie area — mirror bez areas vracia prázdno) + rámce len tam, kde sa pretínajú s dlaždicou', () => {
  const west = buildPlacesQuery(UKRAINE_TILES[0]);
  assert.match(west, /\[bbox:44,22,53,27\]/);
  assert.doesNotMatch(west, /area\[/, 'žiadny area filter');
  assert.match(west, /node\["place"~"\^\(city\|town\|village\)\$"\]\(poly:"47\.051 38\.41 47\.029 37\.738 /);
  assert.doesNotMatch(west, /50\.2,33\.8/, 'bez prieniku sa ruský pás neposiela (inak by sa sťahoval štyrikrát)');
  assert.doesNotMatch(west, /44\.3,32\.4/, 'bez prieniku sa krymský rámec neposiela');
  assert.match(west, /out body;$/);

  const east = buildRoadsQuery(UKRAINE_TILES[3]);
  assert.match(east, /way\["highway"~"\^\(motorway\|trunk\|primary\|secondary\)\$"\]\(50\.2,36\.5,52\.6,41\);/);
  assert.match(east, /out body geom;$/, 'cesty potrebujú id uzlov aj geometriu kvôli zlúčeniu cez dlaždice');

  const crimea = buildRiversQuery(UKRAINE_TILES[2]);
  assert.match(crimea, /way\["waterway"="river"\]\["name"\]\(poly:"/);
  assert.match(crimea, /way\["waterway"="river"\]\["name"\]\(44\.3,32\.4,46\.3,36\.5\);/, 'krymský rámec orezaný na dlaždicu');
  const oblasts = buildOblastsQuery();
  assert.match(oblasts, /rel\["boundary"="administrative"\]\["admin_level"="4"\]\["ISO3166-2"~"\^UA"\]->\.o;/);
  assert.match(oblasts, /\.o out body center;/);
  assert.match(oblasts, /way\(r\.o:"outer"\);/);
});

test('nameLang a population', () => {
  assert.equal(nameLang({ name: 'Лиман', 'name:uk': 'Лиман', 'name:ru': 'Лиман' }), 'uk', 'zhoda s uk vyhráva');
  assert.equal(nameLang({ name: 'Суджа', 'name:ru': 'Суджа', 'name:uk': 'Суджа ' }), 'uk', 'medzery sa čistia');
  assert.equal(nameLang({ name: 'Курск', 'name:ru': 'Курск' }), 'ru');
  assert.equal(nameLang({ name: 'Гомель', 'name:be': 'Гомель' }), 'be');
  assert.equal(nameLang({ name: 'X' }), null);
  assert.equal(parsePopulation('20 315'), 20315);
  assert.equal(parsePopulation('20315 (2001)'), 20315);
  assert.equal(parsePopulation('approx.'), null);
  assert.equal(parsePopulation(''), null);
});

test('placeFeature: bod s menami len keď sa líšia, zaokrúhlenie na 5 miest, mimo tried null', () => {
  const lyman = placeFeature({
    type: 'node', id: 1, lat: 48.98765432, lon: 37.80123456,
    tags: { place: 'city', name: 'Лиман', 'name:uk': 'Лиман', 'name:en': 'Lyman', 'name:ru': 'Лиман', population: '20315', wikidata: 'Q1' },
  });
  assert.deepEqual(lyman.geometry.coordinates, [37.80123, 48.98765]);
  assert.deepEqual(lyman.properties, { id: 1, cls: 'city', name: 'Лиман', lang: 'uk', en: 'Lyman', pop: 20315, wd: 'Q1' });
  assert.equal(placeFeature({ type: 'node', id: 2, lat: 49, lon: 37, tags: { place: 'hamlet', name: 'X' } }), null);
  assert.equal(placeFeature({ type: 'node', id: 3, lat: 49, lon: 37, tags: { place: 'village' } }), null, 'bez mena nie');
  assert.equal(placeFeature({ type: 'node', id: 4, tags: { place: 'village', name: 'X' } }), null, 'bez súradníc nie');
});

test('mergeWays: cesta orezaná na dve dlaždice sa zloží podľa id uzlov, tagy z prvého výskytu', () => {
  const west = { type: 'way', id: 10, tags: { highway: 'primary', ref: 'M-03' }, nodes: [1, 2, 3, 4], geometry: [{ lat: 49, lon: 36.4 }, { lat: 49, lon: 36.5 }, null, null] };
  const east = { type: 'way', id: 10, tags: { highway: 'primary', ref: 'M-03' }, nodes: [1, 2, 3, 4], geometry: [null, null, { lat: 49, lon: 36.6 }, { lat: 49, lon: 36.7 }] };
  const [merged] = mergeWays([west, east, { type: 'node', id: 99 }]);
  assert.equal(merged.id, 10);
  assert.deepEqual(merged.coords, [[36.4, 49], [36.5, 49], [36.6, 49], [36.7, 49]]);
  assert.equal(merged.tags.ref, 'M-03');
  // bez `nodes` (starší out geom) sa vezme geometria priamo
  const [plain] = mergeWays([{ type: 'way', id: 11, tags: {}, geometry: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }] }]);
  assert.deepEqual(plain.coords, [[1, 1], [2, 2]]);
  assert.deepEqual(mergeWays([{ type: 'way', id: 12, nodes: [1], geometry: [{ lat: 1, lon: 1 }] }]), [], 'jednobodová cesta von');
});

test('chainLines: spája dopredu, dozadu aj s obrátením smeru; nespojiteľné ostanú', () => {
  const a = [[0, 0], [1, 0]];
  const b = [[1, 0], [2, 0]]; // nadväzuje dopredu
  const c = [[3, 0], [2, 0]]; // nadväzuje dopredu obrátene
  const d = [[-1, 0], [0, 0]]; // nadväzuje dozadu
  const e = [[5, 5], [6, 6]]; // samostatná
  const chains = chainLines([b, a, c, d, e]);
  assert.equal(chains.length, 2);
  const long = chains.find((ch) => ch.length > 2);
  assert.deepEqual(long, [[-1, 0], [0, 0], [1, 0], [2, 0], [3, 0]]);
  assert.deepEqual(chains.find((ch) => ch.length === 2), e);
});

test('roadFeatures: zoskupenie podľa triedy a ref, spojenie úsekov, zjednodušenie, ostatné triedy von', () => {
  const ways = [
    { id: 1, tags: { highway: 'primary', ref: 'M-03' }, coords: [[36.4, 49], [36.45, 49.00001], [36.5, 49]] },
    { id: 2, tags: { highway: 'primary', ref: 'M-03' }, coords: [[36.5, 49], [36.6, 49]] },
    { id: 3, tags: { highway: 'secondary' }, coords: [[36.5, 49.1], [36.6, 49.1]] },
    { id: 4, tags: { highway: 'tertiary' }, coords: [[36.5, 49.2], [36.6, 49.2]] },
  ];
  const features = roadFeatures(ways);
  assert.equal(features.length, 2);
  const m03 = features.find((f) => f.properties.ref === 'M-03');
  assert.equal(m03.properties.cls, 'primary');
  assert.deepEqual(m03.geometry.coordinates, [[36.4, 49], [36.6, 49]], 'úseky spojené a kolineárny bod odstránený');
  const sec = features.find((f) => f.properties.cls === 'secondary');
  assert.equal('ref' in sec.properties, false, 'bez ref sa kľúč nezapisuje');
});

test('riverFeatures: súčet úsekov pod prahom vypadne, meno z najdlhšieho úseku, jazyk a en', () => {
  const donets = [
    { id: 1, tags: { waterway: 'river', name: 'Сіверський Донець', 'name:uk': 'Сіверський Донець', 'name:en': 'Siverskyi Donets' }, coords: [[37.0, 49.0], [37.5, 49.0]] },
    { id: 2, tags: { waterway: 'river', name: 'Сіверський Донець' }, coords: [[37.5, 49.0], [38.0, 49.0]] },
  ];
  const brook = [{ id: 3, tags: { waterway: 'river', name: 'Потічок' }, coords: [[37.0, 48.0], [37.01, 48.0]] }];
  const features = riverFeatures([...donets, ...brook]);
  assert.equal(features.length, 1, `jarok kratší než ${RIVER_MIN_KM} km vypadne`);
  const [f] = features;
  assert.equal(f.properties.name, 'Сіверський Донець');
  assert.equal(f.properties.en, 'Siverskyi Donets');
  assert.equal(f.properties.lang, 'uk');
  assert.ok(f.properties.km >= 70 && f.properties.km <= 75, `km ~73, dostali sme ${f.properties.km}`);
  assert.deepEqual(f.geometry.coordinates, [[37, 49], [38, 49]]);
});

test('oblastFeatures: register s ISO a ťažiskom, spoločná hranica raz s oboma id, inner/label sa nekreslia', () => {
  const elements = [
    { type: 'relation', id: 100, center: { lat: 49.0, lon: 37.5 }, tags: { name: 'Донецька область', 'name:uk': 'Донецька область', 'name:en': 'Donetsk Oblast', 'ISO3166-2': 'UA-14' },
      members: [{ type: 'way', ref: 1, role: 'outer' }, { type: 'way', ref: 2, role: 'outer' }, { type: 'way', ref: 3, role: 'inner' }, { type: 'node', ref: 9, role: 'admin_centre' }] },
    { type: 'relation', id: 200, tags: { name: 'Луганська область', 'ISO3166-2': 'UA-09' }, members: [{ type: 'way', ref: 2, role: 'outer' }] },
    { type: 'way', id: 1, nodes: [1, 2], geometry: [{ lat: 48, lon: 37 }, { lat: 48, lon: 38 }] },
    { type: 'way', id: 2, nodes: [2, 3], geometry: [{ lat: 48, lon: 38 }, { lat: 49, lon: 38 }] },
    { type: 'way', id: 3, nodes: [4, 5], geometry: [{ lat: 48.5, lon: 37.5 }, { lat: 48.6, lon: 37.6 }] },
    { type: 'way', id: 4, nodes: [6, 7], geometry: [{ lat: 40, lon: 30 }, { lat: 41, lon: 31 }] },
  ];
  const { features, index } = oblastFeatures(elements);
  assert.deepEqual(index.map((o) => o.iso), ['UA-09', 'UA-14']);
  const donetsk = index.find((o) => o.iso === 'UA-14');
  assert.deepEqual(donetsk.center, [37.5, 49]);
  assert.equal(donetsk.en, 'Donetsk Oblast');
  assert.equal(donetsk.lang, 'uk');
  assert.equal(features.length, 2, 'inner a cudzia cesta sa nekreslia');
  const shared = features.find((f) => f.properties.rels.length === 2);
  assert.deepEqual(shared.properties.rels, [100, 200]);
});

test('summarizeFeatures počíta body, súradnice aj km', () => {
  const s = summarizeFeatures([
    { geometry: { type: 'Point', coordinates: [1, 1] } },
    { geometry: { type: 'LineString', coordinates: [[37, 49], [38, 49]] } },
  ]);
  assert.equal(s.features, 2);
  assert.equal(s.coordinates, 3);
  assert.ok(s.lengthKm >= 72 && s.lengthKm <= 74);
});
