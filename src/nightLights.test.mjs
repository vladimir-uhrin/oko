import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as Cesium from 'cesium';
import {
  NIGHT_LIGHTS_URL,
  NIGHT_LIGHTS_MAX_LEVEL,
  NIGHT_LIGHTS_DAY_ALPHA,
  NIGHT_LIGHTS_NIGHT_ALPHA,
  NIGHT_LIGHTS_BACKGROUND_THRESHOLD,
  NIGHT_LIGHTS_BRIGHTNESS,
  nightLightsBrightnessFor,
  createNightLightsProvider,
  styleNightLightsLayer,
} from './nightLights.js';

test('Black Marble URL: WMTS REST z/y/x, statický čas, png', () => {
  // GIBS je WMTS REST: TileMatrix/TileRow/TileCol = z/y/x. Prehodené indexy
  // vrátia HTTP 200 s CUDZOU dlaždicou — mapa nie je prázdna, je rozhádzaná,
  // takže to neodhalí ani sieťová záložka.
  assert.ok(NIGHT_LIGHTS_URL.endsWith('/{z}/{y}/{x}.png'), NIGHT_LIGHTS_URL);
  assert.ok(NIGHT_LIGHTS_URL.startsWith('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/'));
  assert.match(NIGHT_LIGHTS_URL, /VIIRS_Black_Marble/);
  assert.match(NIGHT_LIGHTS_URL, /GoogleMapsCompatible_Level8/);
  assert.equal(NIGHT_LIGHTS_MAX_LEVEL, 8, 'vrstva vyššie dlaždice nemá');
});

test('čas je literál default, NIE dátum — Black Marble je statická kompozícia', () => {
  // Denná mozaika (gibs-truecolor) berie včerajšok; táto vrstva taký deň
  // nemá a dátum by vrátil HTTP 400 — prázdna nočná strana bez chyby v konzole.
  assert.match(NIGHT_LIGHTS_URL, /\/default\/default\/GoogleMapsCompatible/);
  assert.doesNotMatch(NIGHT_LIGHTS_URL, /\/\d{4}-\d{2}-\d{2}\//, 'v URL nesmie byť dátum');
  // Komentár o tom smie hovoriť (a hovorí, aby to niekto nezaviedol späť);
  // kód nie — preto sa komentáre pred kontrolou odstránia.
  const code = fs
    .readFileSync(new URL('./nightLights.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /gibsImageryDay/, 'modul nesmie počítať deň snímky');
});

test('provider je keyless UrlTemplate s kreditom NASA', () => {
  const provider = createNightLightsProvider();
  assert.ok(provider instanceof Cesium.UrlTemplateImageryProvider);
  assert.equal(provider.maximumLevel, NIGHT_LIGHTS_MAX_LEVEL);
  assert.equal(provider.tileWidth, 256);
  const credit = provider.credit?.html ?? String(provider.credit);
  assert.match(credit, /NASA/);
  assert.match(credit, /Black Marble/);
});

test('vrstva svieti len v noci a tmavé pozadie snímky sa vyreže', () => {
  const layer = styleNightLightsLayer({});
  // dayAlpha 0 NIE JE kozmetika: bez nej by nepriehľadná snímka prekryla aj
  // dennú stranu glóbusu.
  assert.equal(layer.dayAlpha, 0);
  assert.equal(NIGHT_LIGHTS_DAY_ALPHA, 0);
  assert.equal(layer.nightAlpha, 1);
  assert.equal(NIGHT_LIGHTS_NIGHT_ALPHA, 1);
  // Black Marble je nepriehľadné RGB (PNG bez alfa kanála) s takmer čiernym
  // pozadím — bez colorToAlpha by nočná strana stratila podklad.
  assert.ok(layer.colorToAlpha, 'vyrezanie pozadia chýba');
  assert.equal(layer.colorToAlphaThreshold, NIGHT_LIGHTS_BACKGROUND_THRESHOLD);
  // Prah je v sRGB (GlobeFS porovnáva surovú hodnotu textúry): musí byť nad
  // ambientnou kresbou pevniny v snímke (max. zložka do ~63/255 = 0.247),
  // inak nočná strana dostane tmavomodrú platňu namiesto podkladu, a pod
  // slabými svetlami — príliš veľký by zhasol aj mestá.
  assert.ok(NIGHT_LIGHTS_BACKGROUND_THRESHOLD >= 0.24 && NIGHT_LIGHTS_BACKGROUND_THRESHOLD < 0.4);
  // Nočnú stranu Cesium tlmí na 0,3 aj so svetlami; bez zosilnenia má mesto
  // rovnaký jas ako more. Strop: 4 × 0,3 by už prepálilo aj predmestia.
  // Bez kontrastu = 'dark' (bezpečnejší default ako v contactPalette).
  assert.equal(layer.brightness, NIGHT_LIGHTS_BRIGHTNESS.dark);
  assert.equal(styleNightLightsLayer({}, 'light').brightness, NIGHT_LIGHTS_BRIGHTNESS.light);
  assert.ok(NIGHT_LIGHTS_BRIGHTNESS.light >= 2 && NIGHT_LIGHTS_BRIGHTNESS.light <= 4);
  // Tmavý podklad má nočnú stranu o triedu tmavšiu — menej, ale stále > 1.
  assert.ok(NIGHT_LIGHTS_BRIGHTNESS.dark > 1 && NIGHT_LIGHTS_BRIGHTNESS.dark < NIGHT_LIGHTS_BRIGHTNESS.light);
  assert.equal(nightLightsBrightnessFor('light'), NIGHT_LIGHTS_BRIGHTNESS.light);
  assert.equal(nightLightsBrightnessFor(undefined), NIGHT_LIGHTS_BRIGHTNESS.dark);
});

test('styleNightLightsLayer je bezpečný bez vrstvy', () => {
  assert.equal(styleNightLightsLayer(null), null);
  assert.equal(styleNightLightsLayer(undefined), null);
});
