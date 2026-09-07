import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { MAP_STACKS, MapStackController, gibsImageryDay } from './mapStackController.js';

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

test('NASA GIBS: WMTS poradie z/y/x, včerajší deň, strop levelu a kredit', () => {
  const gibs = MAP_STACKS.find((s) => s.id === 'gibs-truecolor');
  assert.ok(gibs, 'stack existuje');
  assert.equal(gibs.kind, 'xyz');
  assert.equal(gibs.requiresIon, false);
  // GIBS je WMTS REST: TileMatrix/TileRow/TileCol = z/y/x. Prehodené indexy
  // vrátia HTTP 200 s cudzou dlaždicou — mapa je rozhádzaná, nie prázdna.
  assert.ok(gibs.xyz.url.endsWith('/{z}/{y}/{x}.jpg'), gibs.xyz.url);
  assert.ok(gibs.xyz.url.startsWith('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/'), gibs.xyz.url);
  assert.match(gibs.xyz.url, /GoogleMapsCompatible_Level9/);
  assert.match(gibs.xyz.url, /\/default\/\d{4}-\d{2}-\d{2}\//, 'deň snímky je v URL');
  assert.equal(gibs.xyz.maximumLevel, 9, 'vrstva vyššie dlaždice nemá');
  assert.match(gibs.xyz.credit, /NASA/);
  // Deň = VČERA v UTC: dnešná mozaika je ešte deravá.
  assert.equal(gibsImageryDay(Date.UTC(2026, 8, 5, 12)), '2026-09-04');
  assert.equal(gibsImageryDay(Date.UTC(2026, 0, 1, 0, 30)), '2025-12-31', 'prechod cez rok');
});

// ── Nočné svetlá miest (NASA Black Marble) ──────────────────────────
// Vrstvu vlastní controller, ale zapína ju prepínač Deň/noc — musí teda
// prežiť prepnutie podkladu, zakaždým sadnúť NAVRCH a na fotoreáli zmiznúť.

/** Viewer, ktorý vie povedať poradie vrstiev (Cesium kolekcia je tu zbytočná). */
function layeredViewer({ googleTileset = null } = {}) {
  const layers = [];
  return {
    layers,
    viewer: {
      imageryLayers: {
        add: (layer, index) => {
          if (index == null) layers.push(layer);
          else layers.splice(index, 0, layer);
        },
        remove: (layer) => {
          const i = layers.indexOf(layer);
          if (i >= 0) layers.splice(i, 1);
          return i >= 0;
        },
        removeAll: () => layers.splice(0, layers.length),
      },
      scene: { globe: {}, requestRender: () => {} },
      terrainProvider: null,
    },
    googleTileset,
  };
}

test('nočné svetlá pribudnú nad podklad a ostanú navrchu aj po prepnutí stacku', async () => {
  const { viewer, layers } = layeredViewer();
  const controller = new MapStackController(viewer, {});

  await controller._activateGlobeStack(MAP_STACKS.find((s) => s.id === 'osm'), null);
  assert.equal(layers.length, 1, 'bez prepínača žiadne svetlá navyše');

  assert.equal(controller.setNightLightsEnabled(true), true);
  assert.equal(controller.hasNightLightsLayer(), true);
  assert.equal(layers.length, 2);
  assert.equal(layers.at(-1), controller._nightLightsLayer, 'svetlá musia byť navrchu');

  // Prepnutie podkladu vkladá novú imagery vrstvu na index 0 — svetlá musia
  // skončiť znova nad ňou, nie pod ňou.
  const light = controller._nightLightsLayer;
  await controller._activateGlobeStack(MAP_STACKS.find((s) => s.id === 'stadia-dark'), null);
  assert.equal(layers.at(-1), controller._nightLightsLayer, 'po prepnutí sú svetlá pod podkladom');
  assert.equal(controller._nightLightsLayer, light, 'vrstva sa recykluje, nestavia nanovo');
  assert.equal(layers.filter((l) => l === light).length, 1, 'vrstva je v kolekcii dvakrát');
});

test('ÚGKK stack: svetlá idú nad podklad aj nad jeho underlay', async () => {
  const { viewer, layers } = layeredViewer();
  const controller = new MapStackController(viewer, {});
  controller.setNightLightsEnabled(true);

  await controller._activateGlobeStack(ugkk(), null);
  assert.equal(layers.length, 3, 'OSM underlay + ortofoto + svetlá');
  assert.equal(layers.at(-1), controller._nightLightsLayer);
});

test('fotoreál vrstvu odoberie (glóbus je skrytý), návrat na glóbus ju vráti', async () => {
  const { viewer, layers } = layeredViewer();
  const controller = new MapStackController(viewer, { googleTileset: { show: true }, nightShaderFactory: () => ({}) });
  controller.setNightLightsEnabled(true);

  await controller._activateGlobeStack(MAP_STACKS.find((s) => s.id === 'osm'), null);
  assert.equal(controller.hasNightLightsLayer(), true);

  await controller._activatePhotoreal(null);
  assert.equal(controller.hasNightLightsLayer(), false, 'na fotoreáli vrstva nemá čo osvetľovať');
  assert.equal(layers.length, 0);

  // Prepínač si stav pamätá — návrat na glóbus svetlá obnoví bez ďalšieho kliku.
  await controller._activateGlobeStack(MAP_STACKS.find((s) => s.id === 'osm'), null);
  assert.equal(controller.hasNightLightsLayer(), true);
});

test('vypnutie prepínača vrstvu naozaj odoberie zo scény', async () => {
  const { viewer, layers } = layeredViewer();
  const controller = new MapStackController(viewer, {});
  controller.setNightLightsEnabled(true);
  await controller._activateGlobeStack(MAP_STACKS.find((s) => s.id === 'osm'), null);
  assert.equal(layers.length, 2);

  assert.equal(controller.setNightLightsEnabled(false), false);
  assert.equal(controller.hasNightLightsLayer(), false);
  assert.equal(layers.length, 1, 'podklad ostáva, svetlá nie');
});

test('vrstva nesie terminátorové miešanie — dayAlpha 0, nightAlpha 1', async () => {
  const { viewer } = layeredViewer();
  const controller = new MapStackController(viewer, {});
  controller.setNightLightsEnabled(true);
  await controller._activateGlobeStack(MAP_STACKS.find((s) => s.id === 'osm'), null);

  const layer = controller._nightLightsLayer;
  // Bez dayAlpha 0 by nepriehľadná snímka prekryla aj dennú stranu glóbusu.
  assert.equal(layer.dayAlpha, 0);
  assert.equal(layer.nightAlpha, 1);
  assert.ok(layer.colorToAlpha, 'tmavé pozadie snímky sa musí vyrezať');
});

test('World Terrain sa žiada BEZ vertex normál — inak nočné svetlá prekryjú aj deň', () => {
  // Shader glóbusu: s normálami ENABLE_VERTEX_LIGHTING, bez nich
  // ENABLE_DAYNIGHT_SHADING — a dayAlpha/nightAlpha imagery vrstiev sa mieša
  // len pod tým druhým. `requestVertexNormals: true` by nočné svetlá potichu
  // rozsvietilo aj cez deň (stalo sa 2026-09-06). Hillshade z normál nevidno:
  // osvetlenie je pod 1 500 km vypnuté (globeLighting.js).
  const src = fs.readFileSync(new URL('./mapStackController.js', import.meta.url), 'utf8');
  assert.match(src, /fromWorldTerrain\(\{\s*requestVertexNormals: false,?\s*\}\)/, 'World Terrain musí byť bez normál');
  assert.doesNotMatch(src, /requestVertexNormals: true/);
});

test('nočné svetlá blednú s výškou presne ako osvetlenie glóbusu', async () => {
  // Cesium mieša dayAlpha/nightAlpha len podľa Slnka; pod 1 500 km osvetlenie
  // vyhasne a mesto dostane dennú mapu — svetlá by cez ňu svietili ako fľaky.
  let listener = null;
  let removed = 0;
  const { viewer, layers } = layeredViewer();
  viewer.scene.camera = { positionCartographic: { height: 12_000_000 } };
  viewer.scene.preRender = {
    addEventListener: (fn) => { listener = fn; return () => { removed += 1; listener = null; }; },
  };
  const controller = new MapStackController(viewer, {});
  controller.setNightLightsEnabled(true);
  await controller._activateGlobeStack(MAP_STACKS.find((s) => s.id === 'osm'), null);
  const layer = controller._nightLightsLayer;
  assert.ok(typeof listener === 'function', 'preRender listener je pripojený');
  assert.equal(layer.alpha, 1, 'pohľad na svet: naplno');

  viewer.scene.camera.positionCartographic.height = 800_000;
  listener();
  assert.equal(layer.alpha, 0, 'mesto: svetlá zhasnú spolu s osvetlením');

  viewer.scene.camera.positionCartographic.height = 2_750_000;
  listener();
  assert.ok(Math.abs(layer.alpha - 0.5) < 1e-9, 'medzi tým lineárne');

  // Prepnutie stacku listener nezdvojí…
  await controller._activateGlobeStack(MAP_STACKS.find((s) => s.id === 'stadia-dark'), null);
  assert.equal(removed, 0);
  // …a vypnutie ho odoberie.
  controller.setNightLightsEnabled(false);
  assert.equal(removed, 1, 'listener sa musí odpojiť');
  assert.equal(listener, null);
  assert.equal(layers.length, 1);
});

test('NASA statické podklady: Blue Marble a ASTER reliéf — čas literál default, z/y/x, jpeg, stropy', () => {
  const marble = MAP_STACKS.find((s) => s.id === 'gibs-blue-marble');
  const aster = MAP_STACKS.find((s) => s.id === 'aster-relief');
  assert.ok(marble && aster, 'oba stacky existujú');
  for (const stack of [marble, aster]) {
    assert.equal(stack.kind, 'xyz');
    assert.equal(stack.requiresIon, false);
    // GIBS je WMTS REST: z/y/x. Prehodené indexy vrátia 200 s cudzou dlaždicou.
    assert.ok(stack.xyz.url.endsWith('/{z}/{y}/{x}.jpeg'), stack.xyz.url);
    assert.ok(stack.xyz.url.startsWith('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/'));
    // Statická vrstva: dátum v pozícii času = HTTP 400 → prázdna guľa bez chyby.
    assert.match(stack.xyz.url, /\/default\/default\/GoogleMapsCompatible_Level\d+\//, 'čas musí byť literál default');
    assert.doesNotMatch(stack.xyz.url, /\d{4}-\d{2}-\d{2}/, 'žiadny dátum v URL');
    assert.match(stack.xyz.credit, /NASA/);
    assert.equal(stack.contactContrast, undefined, 'satelitná tonalita → default dark (biele siluety)');
  }
  assert.match(marble.xyz.url, /BlueMarble_ShadedRelief_Bathymetry/);
  assert.equal(marble.xyz.maximumLevel, 8, 'Level 8 je maximum vrstvy (GetCapabilities 2026-09-06)');
  assert.match(aster.xyz.url, /ASTER_GDEM_Color_Shaded_Relief/);
  assert.match(aster.xyz.url, /GoogleMapsCompatible_Level12/);
  assert.equal(aster.xyz.maximumLevel, 12);
  // Povinný kredit METI/NASA pri ASTER GDEM.
  assert.match(aster.xyz.credit, /ASTER GDEM is a product of METI and NASA/);
  const controller = new MapStackController({}, {});
  assert.equal(controller.isStackAvailable('gibs-blue-marble'), true);
  assert.equal(controller.isStackAvailable('aster-relief'), true);
});

test('fotoreál: dôvod nedostupnosti a zdroj (ion) idú do prezentácie, nič nerozhodujú', () => {
  const blocked = new MapStackController({}, { photorealUnavailableReason: 'Google blokuje 3D dlaždice pre EHP' });
  const photoreal = blocked.getStacks().find((s) => s.id === 'photoreal');
  assert.equal(photoreal.available, false);
  assert.match(photoreal.unavailableReason, /Google 3D je nedostupný|Google 3D is unavailable/);
  assert.match(photoreal.unavailableReason, /EHP/, 'tooltip nesie konkrétny dôvod z bootu');
  assert.equal(photoreal.sourceNote, '');
  assert.equal(blocked.getState().photorealSource, null);

  const viaIon = new MapStackController({}, { googleTileset: { show: false }, photorealSource: 'ion' });
  const pr = viaIon.getStacks().find((s) => s.id === 'photoreal');
  assert.equal(pr.available, true);
  assert.match(pr.sourceNote, /Cesium ion/);
  assert.equal(viaIon.getState().photorealSource, 'ion');
  // Ostatné stacky poznámku nenesú.
  assert.ok(viaIon.getStacks().filter((s) => s.id !== 'photoreal').every((s) => s.sourceNote === ''));

  const direct = new MapStackController({}, { googleTileset: { show: false }, photorealSource: 'google' });
  assert.equal(direct.getStacks().find((s) => s.id === 'photoreal').sourceNote, '');
  // Neznáma hodnota zdroja sa normalizuje na null, nie na reťazec.
  assert.equal(new MapStackController({}, { photorealSource: 'x' }).getState().photorealSource, null);
});

test('nočné svetlá: zosilnenie sleduje kontrast podkladu pri každom prepnutí', async () => {
  const { viewer } = layeredViewer();
  const controller = new MapStackController(viewer, {});
  controller.setNightLightsEnabled(true);
  await controller._activateGlobeStack(MAP_STACKS.find((s) => s.id === 'osm'), null);
  const light = controller._nightLightsLayer.brightness;
  await controller._activateGlobeStack(MAP_STACKS.find((s) => s.id === 'stadia-dark'), null);
  const dark = controller._nightLightsLayer.brightness;
  assert.ok(light > dark, 'svetlá OSM potrebuje silnejšie svetlá než tmavá Stadia');
  assert.equal(light, 3);
  assert.equal(dark, 1.8);
  // Späť na OSM: recyklovaná vrstva dostane zosilnenie svetlej mapy znova.
  await controller._activateGlobeStack(MAP_STACKS.find((s) => s.id === 'osm'), null);
  assert.equal(controller._nightLightsLayer.brightness, 3);
});

test('Stadia štýly: svetlé podklady bez stlmenia, kontrast light, Stamen kredit, keyless', () => {
  const ids = ['stadia-smooth', 'stadia-outdoors', 'stadia-terrain'];
  const controller = new MapStackController({}, {});
  for (const id of ids) {
    const stack = MAP_STACKS.find((s) => s.id === id);
    assert.ok(stack, id + ' chýba v MAP_STACKS');
    assert.equal(stack.kind, 'xyz');
    assert.equal(stack.requiresIon, false);
    assert.equal(new URL(stack.xyz.url.replace(/\{[zxy]\}/g, '0')).host, 'tiles.stadiamaps.com');
    assert.doesNotMatch(stack.xyz.url, /api_key/, 'kľúč nikdy do URL (pravidlo 3)');
    // @2x = retina, logická veľkosť ostáva 256 (lekcia 2026-09-04).
    assert.equal(stack.xyz.tileSize, 256);
    assert.match(stack.xyz.url, /@2x\.png$/);
    assert.equal(stack.contactContrast, 'light', 'svetlý štýl → tmavé siluety kontaktov');
    assert.equal(stack.xyz.adjust, undefined, 'svetlé štýly sa nestlmujú');
    assert.match(stack.xyz.credit, /Stadia Maps/);
    assert.equal(controller.isStackAvailable(id), true);
  }
  assert.match(MAP_STACKS.find((s) => s.id === 'stadia-terrain').xyz.credit, /Stamen Design/, 'Stamen štýl musí menovať Stamen Design');
});

test('fotoreál: deň/noc nasadí customShader na tileset, glóbusový stack ho odoberie, vypnutie tiež', async () => {
  const { hasPhotorealNight } = await import('./photorealNight.js');
  const { viewer } = layeredViewer();
  const tileset = { show: true };
  let built = 0;
  const controller = new MapStackController(viewer, { googleTileset: tileset, nightShaderFactory: () => { built += 1; return { id: built }; } });
  controller.setNightLightsEnabled(true);
  await controller._activatePhotoreal(null);
  assert.equal(hasPhotorealNight(tileset), true, 'na fotoreáli ide deň/noc cez shader');
  assert.equal(controller.hasNightLightsLayer(), false, 'imagery svetlá na skrytom glóbuse nie');

  await controller._activateGlobeStack(MAP_STACKS.find((s) => s.id === 'osm'), null);
  assert.equal(hasPhotorealNight(tileset), false, 'na glóbuse shader dole (tileset je aj tak skrytý)');
  assert.equal(controller.hasNightLightsLayer(), true);

  await controller._activatePhotoreal(null);
  assert.equal(hasPhotorealNight(tileset), true);
  controller.setNightLightsEnabled(false);
  assert.equal(hasPhotorealNight(tileset), false, 'prepínač vypnutý = žiadne zotmenie');
  assert.equal(built, 1, 'shader sa stavia raz a recykluje');
  // Bez tilesetu (EHP 403 aj cez ion) je to no-op.
  const bare = new MapStackController(viewer, {});
  bare.setNightLightsEnabled(true);
  await bare._activatePhotoreal(null);
});
