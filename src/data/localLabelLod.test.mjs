// src/data/localLabelLod.test.mjs
// Stupne popisu bodových vrstiev podľa priblíženia (2026-09-05). Rovnaký
// idiom ako airIconLod pri lietadlách: prahy výšky kamery s hysterézou.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LOCAL_LABEL_MIN_IMPORTANCE,
  LOCAL_LABEL_THRESHOLDS,
  LOCAL_LABEL_TIERS,
  labelVisibleInTier,
  localLabelTier,
} from './localLabelLod.js';
import { airportCompactLabel, airportImportance, airportShortCode } from './airportsData.js';
import { localInfrastructureOverlayCopy } from './localGeojson.js';

const LZIB = { name: 'M. R. Štefánik Airport', ident: 'LZIB', icao: 'LZIB', iata: 'BTS', type: 'large', municipality: 'Bratislava', country: 'SK', elevFt: 436 };

test('stupne: výška kamery určuje, koľko textu — od plnej karty po holý bod', () => {
  assert.equal(localLabelTier(20_000), 'full', 'pri pristátí plná karta');
  assert.equal(localLabelTier(150_000), 'compact', 'región');
  assert.equal(localLabelTier(700_000), 'code', 'kontinent — len kód');
  assert.equal(localLabelTier(3_000_000), 'hidden', 'pohľad na svet — bez textu');
  assert.equal(localLabelTier(NaN), 'full', 'bez viewera radšej plná karta');
  assert.deepEqual(LOCAL_LABEL_TIERS, ['full', 'compact', 'code', 'hidden']);
});

test('stupne: hysteréza — kamera na hranici neprepína text tam a späť', () => {
  const { code, compact, hidden } = LOCAL_LABEL_THRESHOLDS;
  for (const [name, band] of Object.entries({ code, compact, hidden })) {
    assert.ok(band.exit < band.enter, `${name}: exit musí byť pod enter`);
  }
  // Vo vnútri pásma platí predchádzajúca odpoveď.
  const between = (compact.enter + compact.exit) / 2;
  assert.equal(localLabelTier(between, 'full'), 'full', 'stúpanie: kým neprekročí enter, ostáva plná');
  assert.equal(localLabelTier(between, 'compact'), 'compact', 'klesanie: kým neklesne pod exit, ostáva skrátená');
  const betweenCode = (code.enter + code.exit) / 2;
  assert.equal(localLabelTier(betweenCode, 'compact'), 'compact');
  assert.equal(localLabelTier(betweenCode, 'code'), 'code');
  assert.equal(localLabelTier(betweenCode, 'hidden'), 'code', 'zostup zhora ide cez susedný stupeň, nie skokom');
  const betweenHidden = (hidden.enter + hidden.exit) / 2;
  assert.equal(localLabelTier(betweenHidden, 'code'), 'code');
  assert.equal(localLabelTier(betweenHidden, 'hidden'), 'hidden');
  assert.equal(localLabelTier(500_000, 'nonsense'), 'code', 'neznámy predchádzajúci stupeň = default');
});

test('stupne: ktoré objekty vôbec dostanú text — veľké skôr než malé', () => {
  const large = airportImportance({ type: 'large' });
  const medium = airportImportance({ type: 'medium' });
  const small = airportImportance({ type: 'small' });
  assert.ok(large > medium && medium > small);
  assert.equal(labelVisibleInTier('full', small), true, 'zblízka všetko');
  assert.equal(labelVisibleInTier('compact', small), false, 'malé letiská ustúpia skôr');
  assert.equal(labelVisibleInTier('compact', medium), true);
  assert.equal(labelVisibleInTier('code', medium), false, 'na kontinente len veľké');
  assert.equal(labelVisibleInTier('code', large), true);
  assert.equal(labelVisibleInTier('hidden', large), false, 'pri pohľade na svet nič');
  assert.equal(LOCAL_LABEL_MIN_IMPORTANCE.hidden, Number.POSITIVE_INFINITY);
});

test('stupne: text sa KRÁTI, nie zmenšuje — kód, kód s mestom, plná karta', () => {
  assert.equal(airportShortCode(LZIB), 'BTS');
  assert.equal(airportShortCode({ ident: 'LZZI', icao: 'LZZI' }), 'LZZI', 'bez IATA nastúpi ICAO');
  assert.equal(airportShortCode({}), '');
  assert.equal(airportCompactLabel(LZIB), 'BTS · Bratislava');
  assert.equal(airportCompactLabel({ name: 'Nowhere Field' }), 'Nowhere Field', 'bez kódu a mesta ostane názov');

  const code = localInfrastructureOverlayCopy(LZIB, 'local-airports', 'code');
  assert.equal(code.title, 'BTS');
  assert.deepEqual(code.details, []);
  assert.equal(code.titleFlag, null, 'vlajka pri holom kóde je šum');

  const compact = localInfrastructureOverlayCopy(LZIB, 'local-airports', 'compact');
  assert.equal(compact.title, 'BTS · Bratislava');
  assert.deepEqual(compact.details, [], 'jeden riadok, žiadne detaily');
  assert.equal(compact.titleFlag, 'sk');

  const full = localInfrastructureOverlayCopy(LZIB, 'local-airports', 'full');
  assert.equal(full.title, 'M. R. Štefánik Airport');
  assert.ok(full.details.length >= 2, 'plná karta má kódy aj typ s výškou');
  assert.equal(full.titleFlag, 'sk');
  // Predvolený stupeň ostáva plný — vrstvy bez LOD sa nezmenili.
  assert.deepEqual(localInfrastructureOverlayCopy(LZIB, 'local-airports'), full);
});

test('stupne: prístavy dostanú vo vzdialenom stupni LOCODE, ostatné vrstvy len skrátený názov', () => {
  const port = { name: 'Rotterdam', locode: 'NLRTM', size: 'Large', country: 'Netherlands' };
  assert.equal(localInfrastructureOverlayCopy(port, 'local-ports', 'code').title, 'NLRTM');
  assert.equal(localInfrastructureOverlayCopy(port, 'local-ports', 'compact').title, 'Rotterdam');
  assert.deepEqual(localInfrastructureOverlayCopy(port, 'local-ports', 'compact').details, []);
  const dam = { name: 'Gabčíkovo', tags: { river: 'Dunaj' } };
  assert.equal(localInfrastructureOverlayCopy(dam, 'local-dams', 'code').title, 'Gabčíkovo');
  assert.deepEqual(localInfrastructureOverlayCopy(dam, 'local-dams', 'code').details, []);
});

test('stupne: tripwire — zapnuté pre letiská a prístavy, vrstva ich vyhodnocuje raz za prechod', () => {
  const layers = readFileSync(new URL('./localLayers.js', import.meta.url), 'utf8');
  const airportsBlock = layers.slice(layers.indexOf('AIRPORTS_LAYER_ID,'), layers.indexOf('const ports'));
  assert.match(airportsBlock, /labelLod: true/, 'letiská majú stupne');
  const portsBlock = layers.slice(layers.indexOf('PORTS_LAYER_ID,'), layers.indexOf('const dams'));
  assert.match(portsBlock, /labelLod: true/, 'prístavy tiež');
  const geo = readFileSync(new URL('./localGeojson.js', import.meta.url), 'utf8');
  assert.match(geo, /_labelTier = localLabelTier\(/, 'stupeň sa počíta raz za prechod, nie per záznam');
  // Gate MUSÍ ísť na vlastnú škálu vrstvy (300/150/60), nie na zložené skóre
  // z labelPriorityFromProperties — to pripočíta 1 000 za samotný názov, takže
  // malé letisko prešlo hranicou pre huby (nájdené naživo 2026-09-05).
  assert.match(geo, /labelVisibleInTier\(_labelTier, record\.importance\)/);
  assert.match(geo, /function labelImportanceFromProperties/);
  assert.match(geo, /importance: labelImportanceFromProperties\(properties, id\)/);
  assert.match(geo, /record\.entryTier !== _labelTier/, 'entry sa prebuduje len pri zmene stupňa');
});

test('stupne: platia aj pre geometriu — bod sa zmenšuje a filtruje, stopka žije len zblízka', async () => {
  const {
    LOCAL_POINT_MIN_IMPORTANCE, LOCAL_POINT_STYLE,
    pointStyleForTier, pointVisibleInTier, stemVisibleInTier,
  } = await import('./localLabelLod.js');
  // Bod je lacnejší než karta, takže sa filtruje miernejšie než text:
  // v strednom stupni ostávajú všetky, popis už len veľkým a stredným.
  assert.equal(pointVisibleInTier('compact', 60), true, 'malé letisko má zblízka aj v strednom stupni bod');
  assert.equal(labelVisibleInTier('compact', 60), false, 'ale nie popis');
  assert.equal(pointVisibleInTier('code', 60), false);
  assert.equal(pointVisibleInTier('code', 150), true);
  assert.equal(pointVisibleInTier('hidden', 150), false, 'pri pohľade na svet len huby');
  assert.equal(pointVisibleInTier('hidden', 300), true);
  assert.ok(LOCAL_POINT_MIN_IMPORTANCE.hidden > LOCAL_POINT_MIN_IMPORTANCE.code);
  // Veľkosť klesá so vzdialenosťou a obrys zmizne skôr než bod.
  const sizes = ['full', 'compact', 'code', 'hidden'].map((t) => pointStyleForTier(t).pixelSize);
  assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a), 'veľkosť monotónne klesá');
  assert.equal(pointStyleForTier('hidden').outlineWidth, 0, 'obrys na 4 px bode je väčšina bodu');
  assert.deepEqual(pointStyleForTier('nezmysel'), LOCAL_POINT_STYLE.full, 'neznámy stupeň = plný');
  // Stopka ukotvuje značku do terénu — vo výške je to čiara cez pol glóbusu.
  assert.equal(stemVisibleInTier('full'), true);
  for (const t of ['compact', 'code', 'hidden']) assert.equal(stemVisibleInTier(t), false, t);

  const geo = readFileSync(new URL('./localGeojson.js', import.meta.url), 'utf8');
  assert.match(geo, /pointVisibleInTier\(_labelTier, record\.importance\)/);
  assert.match(geo, /record\.entity\.polyline\.show = stemVisibleInTier\(_labelTier\)/);
  assert.match(geo, /record\.entity !== viewer\.selectedEntity/, 'vybraný objekt sa nikdy neskryje');
  assert.match(geo, /_labelTier !== record\.geometryTier/, 'štýl sa prepisuje len pri zmene stupňa');
});

test('stupne: bez stopky značka sadá na zem — body nesmú vyletieť mimo gule', () => {
  // Zdvih drží značku ~65 px nad zemou a rastie LINEÁRNE so vzdialenosťou
  // kamery: pri pohľade na svet je to vyše 2 000 km nad povrchom a body sa
  // vysypali za okraj gule (screenshot používateľa 2026-09-05).
  const geo = readFileSync(new URL('./localGeojson.js', import.meta.url), 'utf8');
  assert.match(geo, /function updateLocalStemGeometry\(viewer, record, now, knownDistance = null, lift = true\)/);
  assert.match(geo, /const tipHeight = lift\s*\n?\s*\? record\.groundHeight \+ effectiveDistance \* fovFactor\s*\n?\s*: record\.groundHeight;/);
  assert.match(geo, /const stemLift = !labelLod \|\| stemVisibleInTier\(_labelTier\);/, 'zdvih len tam, kde je stopka');
  // Len VOLANIA (deklarácia má "knownDistance = null"), a každé musí niesť stemLift.
  const calls = (geo.match(/updateLocalStemGeometry\(viewer, record, now[^)]*\)/g) || [])
    .filter((c) => !c.includes('knownDistance'));
  assert.ok(calls.length >= 3, `tri volania, našlo ${calls.length}`);
  for (const call of calls) assert.match(call, /stemLift\)$/, `každé volanie nesie stemLift: ${call}`);
});
