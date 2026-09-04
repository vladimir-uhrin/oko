import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { MAP_STACKS, MapStackController } from './mapStackController.js';

// ÚGKK Ortofotomozaika SR — SK stack (OKO, Fáza 1). Podmienky služby a limity
// preverenia sú v DATA_SOURCES.md a docs/SK-NOTES.md; tieto testy pinnú
// descriptor a provider tak, aby sa šetrný tvar (512 px, SR rectangle, jediná
// čistá vrstva) nedal omylom rozbiť.

const ugkk = () => MAP_STACKS.find((stack) => stack.id === 'ugkk-ortofoto');

test('ÚGKK stack descriptor je keyless WMS s čistou mozaikovou vrstvou', () => {
  const stack = ugkk();
  assert.ok(stack, 'stack ugkk-ortofoto chýba v MAP_STACKS');
  assert.equal(stack.kind, 'wms');
  assert.equal(stack.requiresIon, false);
  // Mozaika pokrýva len SR — bez OSM podkladu je zvyšok glóbusu čierny.
  assert.equal(stack.underlayStackId, 'osm');
  assert.equal(new URL(stack.wms.url).host, 'zbgisws.skgeodesy.sk');
  assert.ok(stack.wms.url.startsWith('https://'));
  // Vrstva '1' = Ortofoto; '2'/'3' (Footprint/Boundary) kreslia zelený klad
  // cez celú mozaiku — do podkladu nepatria.
  assert.equal(stack.wms.layers, '1');
  assert.equal(stack.wms.tileSize, 512);
  assert.ok(Number.isInteger(stack.wms.maximumLevel) && stack.wms.maximumLevel <= 20);
  assert.match(stack.wms.credit, /GKÚ/);
});

test('ÚGKK stack je dostupný bez ion tokenu aj bez Google tilesetu', () => {
  const controller = new MapStackController({}, {});
  assert.equal(controller.isStackAvailable('ugkk-ortofoto'), true);
  assert.equal(controller.isStackAvailable('bing-aerial'), false);
  assert.equal(controller.isStackAvailable('photoreal'), false);
});

test('provider je WMS s 512 px dlaždicami, orezaný na SR a cachovaný', async () => {
  const controller = new MapStackController({}, {});
  const stack = ugkk();
  const provider = await controller._getImageryProvider(stack);

  assert.ok(provider instanceof Cesium.WebMapServiceImageryProvider);
  assert.equal(provider.tileWidth, 512);
  assert.equal(provider.tileHeight, 512);
  assert.equal(provider.maximumLevel, stack.wms.maximumLevel);

  // Rectangle musí pokrývať SR a nesmie byť celoglobálny — mimo pokrytia
  // mozaiky sa nesmie generovať žiadny request na verejnú službu GKÚ.
  const r = provider.rectangle;
  const [west, south, east, north] = stack.wms.rectangleDegrees;
  const close = (rad, deg) => Math.abs(Cesium.Math.toDegrees(rad) - deg) < 0.01;
  assert.ok(close(r.west, west) && close(r.south, south), 'rectangle nesedí na SR (JZ roh)');
  assert.ok(close(r.east, east) && close(r.north, north), 'rectangle nesedí na SR (SV roh)');
  assert.ok(Cesium.Math.toDegrees(r.east) - Cesium.Math.toDegrees(r.west) < 10, 'rectangle je podozrivo široký');

  assert.match(provider.credit?.html ?? String(provider.credit), /GKÚ/);

  const again = await controller._getImageryProvider(stack);
  assert.equal(again, provider, 'provider sa má cachovať per stack');
});

// ── Voľba terénu (OKO 2026-09-01) ────────────────────────────────────────────
// Bez tokenu bol merge terén (/api/sk-terrain — DMR 3.5 nad SR + Re:Earth vo
// svete) jediná možnosť; s ion tokenom ho Cesium World Terrain vždy prebil,
// takže SK terén nebolo ako vidieť. `terrainPreference` je ten prepínač.

test('terrainPreference: auto rešpektuje token, sk ho prebije, world ostáva ion', () => {
  const withToken = (pref) => new MapStackController({}, { cesiumToken: 'ion-token', terrainPreference: pref });
  const noToken = (pref) => new MapStackController({}, { terrainPreference: pref });

  // auto = pôvodné správanie: rozhoduje prítomnosť tokenu.
  assert.equal(withToken('auto')._prefersWorldTerrain(), true);
  assert.equal(noToken('auto')._prefersWorldTerrain(), false);

  // sk = merge terén VŽDY, aj s tokenom (to je celý zmysel prepínača).
  assert.equal(withToken('sk')._prefersWorldTerrain(), false);
  assert.equal(noToken('sk')._prefersWorldTerrain(), false);

  // world = ion terén, ale bez tokenu sa nemá čím zapnúť → keyless.
  assert.equal(withToken('world')._prefersWorldTerrain(), true);
  assert.equal(noToken('world')._prefersWorldTerrain(), false);

  // Neznáma hodnota nesmie appku prepnúť do nedefinovaného stavu.
  for (const junk of ['SK', 'ion', '', null, undefined, 42, {}]) {
    const c = new MapStackController({}, { cesiumToken: 'ion-token', terrainPreference: junk });
    assert.equal(c.terrainPreference, 'auto', `'${String(junk)}' má spadnúť na auto`);
    assert.equal(c._prefersWorldTerrain(), true);
  }
});

test('getState hlási režim aj preferenciu terénu — názov triedy ich nerozlíši', () => {
  const controller = new MapStackController({}, { cesiumToken: 'ion-token', terrainPreference: 'sk' });
  const state = controller.getState();
  assert.equal(state.terrainPreference, 'sk');
  assert.equal(state.terrainMode, null, 'pred prvým globe stackom nie je terén nainštalovaný');
  assert.equal(state.terrainSource, null);
  assert.equal(state.hasCesiumIonToken, true);
});

test('terrainSource rozlíši merge s DMR od holého Re:Earth a od plochého fallbacku', async () => {
  // 'keyless' ako režim je nejednoznačné — všetky tri vetvy ho zdieľajú.
  // Tento test je poistka proti falošnému dôkazu „SK terén beží".
  // Sieť ani skutočný provider netreba: stubneme probe (fetch) aj konštrukciu
  // providera, testuje sa MAPOVANIE výsledku na zdroj.
  const originalFetch = globalThis.fetch;
  const originalFromUrl = Cesium.CesiumTerrainProvider.fromUrl;
  try {
    Cesium.CesiumTerrainProvider.fromUrl = async (url) => ({ _stubUrl: url });

    // Merge endpoint odpovedá → sk-merged (+ atribúcia ÚGKK).
    globalThis.fetch = async () => ({ ok: true });
    const merged = new MapStackController({}, {});
    const mergedProvider = await merged._getKeylessTerrainProvider();
    assert.equal(merged.getState().terrainSource, 'sk-merged');
    assert.match(mergedProvider._stubUrl, /\/api\/sk-terrain$/);

    // Bez proxy (produkčný build) → priamy Re:Earth.
    globalThis.fetch = async () => ({ ok: false });
    const direct = new MapStackController({}, {});
    const directProvider = await direct._getKeylessTerrainProvider();
    assert.equal(direct.getState().terrainSource, 'reearth');
    assert.match(directProvider._stubUrl, /^https:\/\//);

    // Konštrukcia zlyhá → plochý ellipsoid, a MUSÍ sa to priznať.
    Cesium.CesiumTerrainProvider.fromUrl = async () => { throw new Error('layer.json 500'); };
    const broken = new MapStackController({}, {});
    const warn = console.warn;
    console.warn = () => {};
    try {
      const flatProvider = await broken._getKeylessTerrainProvider();
      assert.ok(flatProvider instanceof Cesium.EllipsoidTerrainProvider);
    } finally {
      console.warn = warn;
    }
    assert.equal(broken.getState().terrainSource, 'flat', 'plochý fallback sa nesmie tváriť ako SK terén');
  } finally {
    globalThis.fetch = originalFetch;
    Cesium.CesiumTerrainProvider.fromUrl = originalFromUrl;
  }
});

test('main.js číta preferenciu z ?terrain= a podáva ju controlleru', async () => {
  const source = await import('node:fs').then((fs) => fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8'));
  assert.match(source, /new URLSearchParams\(window\.location\.search\)\.get\('terrain'\) \|\| 'auto'/);
  assert.match(source, /terrainPreference,/);
});

// ── Tmavý podklad (2026-09-03) ───────────────────────────────────────────────
// Pridaný pre kontrast vzdušných kontaktov: pri oddialení sa flotila kreslí
// bodkami (airIconLod.js) a biely bod na svetlej OSM mape sa stráca.

const stadia = () => MAP_STACKS.find((stack) => stack.id === 'stadia-dark');

test('tmavý podklad je keyless XYZ raster s globálnym pokrytím', () => {
  const stack = stadia();
  assert.ok(stack, 'stack stadia-dark chýba v MAP_STACKS');
  assert.equal(stack.kind, 'xyz');
  assert.equal(stack.requiresIon, false);
  // Na rozdiel od SK Orto pokrýva celý svet — podklad pod ním by bol plytvanie.
  assert.equal(stack.underlayStackId, undefined);
  assert.equal(new URL(stack.xyz.url.replace(/\{[zxy]\}/g, '0')).host, 'tiles.stadiamaps.com');
  assert.ok(stack.xyz.url.startsWith('https://'));
  // @2x dlaždice sú 512 px — musí sedieť s deklarovanou veľkosťou, inak sa
  // mapa rozmaže alebo sa sťahuje dvojnásobok dát.
  assert.match(stack.xyz.url, /@2x\.png$/);
  // @2x je RETINA rozlisenie, nie vacsi vyrez — logicka velkost ostava 256.
  // Deklarovat 512 znamenalo, ze Cesium kreslilo obsah 2x vacsi a nazvy statov
  // zaberali pol kontinentu (2026-09-04).
  assert.equal(stack.xyz.tileSize, 256);
  assert.ok(Number.isInteger(stack.xyz.maximumLevel) && stack.xyz.maximumLevel <= 20);
});

test('atribúcia tmavého podkladu menuje všetky tri povinné zdroje', () => {
  // Stadia vyžaduje kredit za DÁTA, ŠTÝL aj SOFTVÉR za nimi — nie je to
  // zdvorilosť, je to podmienka použitia.
  const stack = stadia();
  for (const required of [/Stadia/, /OpenMapTiles/, /OpenStreetMap/]) {
    assert.match(stack.xyz.credit, required);
  }
});

test('kľúč nikdy nejde do URL dlaždíc (pravidlo 3 CLAUDE.md)', () => {
  // Stadia autorizuje cez Origin/Referer; na localhoste kľúč netreba vôbec.
  // Keby ho sem niekto vložil, uniká do prehliadača každým requestom.
  const stack = stadia();
  assert.doesNotMatch(stack.xyz.url, /api_key|apikey|access_token|key=/i);
});

test('tmavý podklad je dostupný bez ion tokenu aj bez Google tilesetu', () => {
  const controller = new MapStackController({}, {});
  assert.equal(controller.isStackAvailable('stadia-dark'), true);
});

test('provider XYZ deklaruje LOGICKÚ veľkosť dlaždice a je cachovaný', async () => {
  const controller = new MapStackController({}, {});
  const stack = stadia();
  const provider = await controller._getImageryProvider(stack);
  assert.ok(provider);
  // 256, hoci obrázok má 512 px: @2x je retina rozlíšenie tej istej plochy.
  assert.equal(provider.tileWidth, 256);
  assert.equal(provider.tileHeight, 256);
  const again = await controller._getImageryProvider(stack);
  assert.equal(again, provider, 'provider sa nesmie stavať dvakrát');
});

test('tmavý podklad je stlmený, aby popisy neprekrikovali kontakty', () => {
  // Popisy sú v raster dlaždici zapečené — vypnúť sa nedajú a tmavý variant
  // bez nich Stadia nemá (`_no_labels` = 404). CARTO ho má, ale jeho keyless
  // dlaždica nesie vypálený nápis „API KEY REQUIRED". Stlmenie je jediná
  // čistá páka: mapa ostane čitateľná ako tvar, prestane súťažiť s bodkami.
  const adjust = stadia().xyz.adjust;
  assert.ok(adjust, 'descriptor nesie stlmenie');
  assert.ok(adjust.brightness > 0 && adjust.brightness < 1, 'stlmené, nie zhasnuté');
  assert.ok(adjust.contrast > 0 && adjust.contrast <= 1);
});

test('stlmenie sa naozaj prenesie na imagery vrstvu', async () => {
  const layers = [];
  const viewer = {
    imageryLayers: { add: (l) => layers.push(l), remove: () => {}, removeAll: () => {} },
    scene: { globe: {}, requestRender: () => {} },
    terrainProvider: null,
  };
  const controller = new MapStackController(viewer, {});
  await controller._activateGlobeStack(stadia(), null);
  const added = layers.at(-1);
  assert.ok(added, 'vrstva pribudla');
  assert.equal(added.brightness, stadia().xyz.adjust.brightness);
  assert.equal(added.contrast, stadia().xyz.adjust.contrast);
});
