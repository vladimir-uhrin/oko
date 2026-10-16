// src/farGlobe.test.mjs — Zem z výšky (2026-10-16): glóbus s Blue Marble / Black Marble z výšky, fotoreál zblízka.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FAR_GLOBE_ENTER_M, FAR_GLOBE_EXIT_M, FAR_GLOBE_LIGHTING_M, FAR_GLOBE_NIGHT_ENTER_M, FAR_GLOBE_NIGHT_EXIT_M, FAR_GLOBE_NIGHT_STYLE,
  FAR_GLOBE_NIGHT_URL, FAR_GLOBE_DAY_URL, FAR_GLOBE_READY_CAP_MS, NIGHT_SUN_ELEVATION_DEG, farGlobeWanted, installFarGlobe, sunElevationDegAt,
} from './farGlobe.js';
import { GLOBE_RADIUS_M, LIGHTING_FADE_IN_M, LIGHTING_FADE_OUT_M } from './globeLighting.js';
import { IMAGERY_ROLE } from './imageryOrder.js';
import { ZOOM_BORDERS_SHOW_BELOW_M } from './data/zoomBorders.js';
import { startViewFor } from './camera.js';
import * as Cesium from 'cesium';

test('rozhodnutie cez deň: nad 1 000 km glóbus, pod 700 km fotoreál (hysteréza); len na fotoreáli; počas preletu nie', () => {
  assert.equal(farGlobeWanted({ heightM: 1_100_000, stackId: 'photoreal' }), true);
  assert.equal(farGlobeWanted({ heightM: 900_000, stackId: 'photoreal' }), false, 'pod prahom vstupu bez zmeny');
  assert.equal(farGlobeWanted({ heightM: 900_000, stackId: 'photoreal', far: true }), true, 'hysteréza: aktívny drží do 700 km');
  assert.equal(farGlobeWanted({ heightM: 600_000, stackId: 'photoreal', far: true }), false);
  assert.equal(FAR_GLOBE_ENTER_M, 1_000_000); assert.equal(FAR_GLOBE_EXIT_M, 700_000);
  assert.equal(farGlobeWanted({ heightM: 5_000_000, stackId: 'photoreal', flying: true }), false, 'prelet kamery: fotoreál si prednačíta cieľ');
  for (const id of ['osm', 'bing-aerial', 'stadia-dark', 'karta', null]) assert.equal(farGlobeWanted({ heightM: 5_000_000, stackId: id }), false, `${id}: glóbus riadi radič`);
  assert.equal(farGlobeWanted({ heightM: NaN, stackId: 'photoreal', far: true }), true, 'bez výšky sa stav nemení');
});

test('rozhodnutie v noci: glóbus drží dlhšie (vstup 850 km, návrat 600 km) — len kým je Black Marble ostrá (~1 texel/px pri 600 km)', () => {
  assert.equal(farGlobeWanted({ heightM: 900_000, stackId: 'photoreal', night: true }), true);
  assert.equal(farGlobeWanted({ heightM: 900_000, stackId: 'photoreal', night: false }), false, 'cez deň 900 km ešte fotoreál');
  assert.equal(farGlobeWanted({ heightM: 650_000, stackId: 'photoreal', night: true, far: true }), true, 'noc: 650 km stále glóbus');
  assert.equal(farGlobeWanted({ heightM: 550_000, stackId: 'photoreal', night: true, far: true }), false, 'pod 600 km by sa dlaždice zväčšovali');
  assert.equal(FAR_GLOBE_NIGHT_ENTER_M, 850_000); assert.equal(FAR_GLOBE_NIGHT_EXIT_M, 600_000);
  assert.ok(FAR_GLOBE_LIGHTING_M.fadeIn < FAR_GLOBE_NIGHT_EXIT_M, 'noc naplno skôr, než sa vráti fotoreál');
  assert.equal(NIGHT_SUN_ELEVATION_DEG, -6);
});

test('výška Slnka: nad Slovenskom o polnoci hlboko pod obzorom, na poludnie vysoko; bez vstupov NaN', () => {
  const sk = Cesium.Cartographic.fromDegrees(19.5, 48.7, 1_000_000);
  const midnight = Cesium.JulianDate.fromIso8601('2026-10-16T23:00:00Z');
  const noon = Cesium.JulianDate.fromIso8601('2026-10-16T11:00:00Z');
  const night = sunElevationDegAt(sk, midnight);
  const day = sunElevationDegAt(sk, noon);
  assert.ok(night < -30, `polnoc ${night.toFixed(1)}°`);
  assert.ok(day > 25 && day < 45, `poludnie v októbri ${day.toFixed(1)}°`);
  assert.ok(Number.isNaN(sunElevationDegAt(null, noon)));
});

test('úvod: zemeguľa pri štarte (7 000 km) je v diaľkovom režime; hranice (pod 5 000 km) sa ukážu ešte na glóbuse', () => {
  const globe = startViewFor(1440, 900, Date.parse('2026-10-16T19:00:00Z'));
  assert.equal(farGlobeWanted({ heightM: globe.heightM, stackId: 'photoreal' }), true);
  assert.ok(FAR_GLOBE_ENTER_M < ZOOM_BORDERS_SHOW_BELOW_M);
  assert.match(FAR_GLOBE_NIGHT_URL, /VIIRS_Black_Marble\/default\/default\//, 'statická Black Marble bez dátumu');
  assert.match(FAR_GLOBE_DAY_URL, /BlueMarble_ShadedRelief_Bathymetry\/default\/default\//);
});

function harness({ height = 7_000_000, lighting = true, night = false } = {}) {
  const listeners = new Set();
  const items = [];
  const imageryLayers = {
    get length() { return items.length; },
    get: (i) => items[i],
    add(layer, index) { if (Number.isInteger(index)) items.splice(index, 0, layer); else items.push(layer); return layer; },
    remove(layer) { const i = items.indexOf(layer); if (i >= 0) items.splice(i, 1); return i >= 0; },
    items,
  };
  const scene = {
    globe: { show: false, enableLighting: lighting, lightingFadeOutDistance: 0, lightingFadeInDistance: 0, tilesLoaded: false },
    camera: { positionCartographic: { height } },
    tweens: { length: 0 },
    postRender: { addEventListener: (fn) => listeners.add(fn), removeEventListener: (fn) => listeners.delete(fn) },
    requestRender() {},
  };
  const tileset = { show: true };
  let stack = 'photoreal'; let t = 1_000_000; let isNight = night;
  const timers = []; const farChanges = [];
  const mk = (name) => () => ({ name, show: true, dayAlpha: 1, nightAlpha: 1 });
  const ctl = installFarGlobe({ viewer: { scene, imageryLayers }, tileset, getStackId: () => stack, createDayLayer: mk('day'), createNightLayer: mk('night'), isNight: () => isNight, onFarChange: (f) => farChanges.push(f), now: () => t, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; } });
  return { scene, tileset, items, ctl, timers, farChanges, render: () => { for (const fn of [...listeners]) fn(); }, tick: (ms) => { t += ms; }, setStack: (s) => { stack = s; }, setNight: (n) => { isNight = n; }, get listeners() { return listeners.size; } };
}

test('vstup z výšky: tileset skrytý, glóbus s dennou vrstvou dole a nočnou navrchu (dayAlpha 0 / nightAlpha 1, zosilnená), prísne osvetlenie', () => {
  const h = harness({ height: 7_000_000 });
  h.ctl.check(true);
  assert.equal(h.ctl.far, true);
  assert.equal(h.tileset.show, false, 'Google dlaždice sa z výšky nesťahujú');
  assert.equal(h.scene.globe.show, true);
  assert.deepEqual(h.items.map((l) => l.name), ['day', 'night']);
  assert.equal(h.items[0].gevImageryRole, IMAGERY_ROLE.base);
  assert.equal(h.items[1].gevImageryRole, IMAGERY_ROLE.nightLights, 'prekryvy NASA sa vkladajú pod nočné svetlá');
  assert.equal(h.items[1].dayAlpha, 0);
  assert.equal(h.items[1].nightAlpha, 1);
  assert.deepEqual([h.items[1].brightness, h.items[1].contrast, h.items[1].gamma], [FAR_GLOBE_NIGHT_STYLE.brightness, FAR_GLOBE_NIGHT_STYLE.contrast, FAR_GLOBE_NIGHT_STYLE.gamma], 'nočná vrstva zosilnená proti tlmeniu 0,3');
  assert.ok(FAR_GLOBE_NIGHT_STYLE.brightness >= 3 && FAR_GLOBE_NIGHT_STYLE.gamma < 1);
  assert.equal(h.scene.globe.lightingFadeOutDistance, GLOBE_RADIUS_M + FAR_GLOBE_LIGHTING_M.fadeOut);
  assert.equal(h.scene.globe.lightingFadeInDistance, GLOBE_RADIUS_M + FAR_GLOBE_LIGHTING_M.fadeIn);
});

test('návrat zblízka: vrstvy preč, glóbus skrytý, tileset späť, štandardné osvetlenie; hysteréza deň/noc; prelet drží fotoreál', () => {
  const h = harness({ height: 7_000_000 });
  h.ctl.check(true);
  h.scene.camera.positionCartographic.height = 800_000;
  h.tick(300); h.render();
  assert.equal(h.ctl.far, true, '800 km ešte glóbus (hysteréza)');
  h.scene.camera.positionCartographic.height = 600_000;
  h.render();
  assert.equal(h.ctl.far, true, 'do 250 ms sa nekontroluje');
  h.tick(300); h.render();
  assert.equal(h.ctl.far, false, 'deň: 600 km = fotoreál');
  assert.deepEqual(h.farChanges, [true, false], 'onFarChange pri vstupe aj odchode (jas lietadiel)');
  assert.deepEqual(h.items, []);
  assert.equal(h.scene.globe.show, false);
  assert.equal(h.tileset.show, true);
  assert.equal(h.scene.globe.lightingFadeOutDistance, GLOBE_RADIUS_M + LIGHTING_FADE_OUT_M, 'štandard späť');
  assert.equal(h.scene.globe.lightingFadeInDistance, GLOBE_RADIUS_M + LIGHTING_FADE_IN_M);
  // noc: pri 600 km nič (pod nočným prahom vstupu 850 km), pri 900 km glóbus, drží do 600 km
  h.setNight(true);
  h.tick(300); h.render();
  assert.equal(h.ctl.far, false, 'noc, 600 km: pod nočným prahom vstupu');
  h.scene.camera.positionCartographic.height = 900_000;
  h.tick(300); h.render();
  assert.equal(h.ctl.far, true, 'noc, 900 km: glóbus');
  h.scene.camera.positionCartographic.height = 650_000;
  h.tick(300); h.render();
  assert.equal(h.ctl.far, true, 'noc, 650 km: glóbus stále (návrat až pod 600 km)');
  h.scene.camera.positionCartographic.height = 550_000;
  h.tick(300); h.render();
  assert.equal(h.ctl.far, false);
  // prelet z výšky: fotoreál, kým sa letí; po dolete podľa výšky
  h.scene.camera.positionCartographic.height = 7_000_000;
  h.scene.tweens.length = 1;
  h.tick(300); h.render();
  assert.equal(h.ctl.far, false, 'počas preletu fotoreál (prednačítanie cieľa)');
  h.scene.tweens.length = 0;
  h.tick(300); h.render();
  assert.equal(h.ctl.far, true);
});

test('Deň/noc vypnuté = nočná vrstva skrytá; prepnutie podkladu glóbus nechá radiču; destroy upratuje', () => {
  const h = harness({ height: 7_000_000, lighting: false });
  h.ctl.check(true);
  assert.equal(h.items[1].show, false, 'bez osvetlenia bez nočnej vrstvy');
  h.scene.globe.enableLighting = true;
  h.tick(300); h.render();
  assert.equal(h.items[1].show, true, 'po zapnutí Deň/noc sa vráti');
  h.setStack('osm');
  h.tick(300); h.render();
  assert.equal(h.ctl.far, false);
  assert.deepEqual(h.items, [], 'vlastné vrstvy preč');
  assert.equal(h.scene.globe.show, true, 'glóbus NEskrývať — OSM ho potrebuje, spravuje ho radič');
  assert.equal(h.tileset.show, false, 'tileset nezapínať — radič ho pri OSM skrýva');
  h.setStack('photoreal');
  h.tick(300); h.render();
  assert.equal(h.ctl.far, true, 'návrat na fotoreál z výšky = znova glóbus');
  h.ctl.destroy();
  assert.equal(h.listeners, 0);
  assert.equal(h.ctl.far, false);
  assert.equal(h.scene.globe.show, false);
  assert.equal(h.tileset.show, true);
  const none = installFarGlobe({ viewer: null, tileset: null, getStackId: () => 'photoreal' });
  assert.equal(none.check(true), false);
  none.destroy();
});

test('štart: whenReady sa splní, keď má glóbus z výšky dlaždice; zblízka hneď (netreba); strop 3 s', async () => {
  const h = harness({ height: 7_000_000 });
  let settled = null;
  h.ctl.whenReady.then((v) => { settled = v; });
  h.ctl.check(true);
  await Promise.resolve();
  assert.equal(settled, null, 'bez dlaždíc ešte čaká');
  h.scene.globe.tilesLoaded = true;
  h.tick(300); h.render();
  await Promise.resolve();
  assert.equal(settled, true);
  assert.equal(h.timers[0].ms, FAR_GLOBE_READY_CAP_MS, 'strop nastavený');
  const near = harness({ height: 260_000 });
  let nearSettled = null;
  near.ctl.whenReady.then((v) => { nearSettled = v; });
  near.ctl.check(true);
  await Promise.resolve();
  assert.equal(nearSettled, false, 'zblízka netreba čakať');
  const slow = harness({ height: 7_000_000 });
  let slowSettled = null;
  slow.ctl.whenReady.then((v) => { slowSettled = v; });
  slow.ctl.check(true);
  slow.timers[0].fn(); // strop
  await Promise.resolve();
  assert.equal(slowSettled, false, 'po strope štart pokračuje aj bez dlaždíc');
  const none = installFarGlobe({ viewer: null, tileset: null, getStackId: () => 'photoreal' });
  assert.equal(await none.whenReady, false);
});

test('zapojenie: main.js inštaluje Zem z výšky hneď po radiči, štart čaká na whenReady; stav „degradované" prekryvov NASA berie do úvahy viditeľný glóbus', () => {
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /import \{ installFarGlobe \} from '\.\/farGlobe\.js';/);
  assert.match(main, /const farGlobe = installFarGlobe\(\{\n\s+viewer, tileset, getStackId: \(\) => mapStackController\.getActiveId\(\),\n\s+onFarChange: \(far\) => flightsLayer\.setFleetBrightness\?\.\(far \? FLEET_FAR_BRIGHTNESS : 1\),\n\s+\}\);/, 'jas lietadiel ide s režimom');
  assert.match(main, /import flightsLayer, \{ FLEET_FAR_BRIGHTNESS \} from '\.\/data\/flights\.js';/);
  assert.ok(main.indexOf('const farGlobe = installFarGlobe(') < main.indexOf('void Promise.all(['), 'inštalácia pred štartovým čakaním');
  assert.match(main, /new Promise\(\(resolve\) => setTimeout\(resolve, 1000\)\),\n[^\n]*\n\s+farGlobe\.whenReady,\n\s+\]\)\.finally/);
  assert.match(main, /window\.__godsEyeView\.farGlobe = farGlobe;/);
  const active = readFileSync(new URL('./data/activeMapStack.js', import.meta.url), 'utf8');
  assert.match(active, /export function isGlobeHiddenForStack\(stack = _stack, scene = null\) \{\n\s+if \(scene\?\.globe\?\.show === true\) return false;/);
  const gibs = readFileSync(new URL('./data/gibsOverlays.js', import.meta.url), 'utf8');
  assert.match(gibs, /isGlobeHiddenForStack\(getActiveMapStack\(\), _viewer\?\.scene\)/);
});
