// src/data/zoomBorders.test.mjs — hranice štátov pri priblížení (2026-10-16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ZOOM_BORDERS_HIDE_ABOVE_M, ZOOM_BORDERS_HOLDER, ZOOM_BORDERS_SHOW_BELOW_M, ZOOM_BORDERS_STACKS, installZoomBorders, zoomBordersWanted,
} from './zoomBorders.js';
import { areaViewFor, startViewFor } from '../camera.js';

test('rozhodnutie: pod 5 000 km zapnúť, nad 6 000 km vypnúť (hysteréza), len na podkladoch bez vlastných hraníc', () => {
  assert.equal(zoomBordersWanted({ heightM: 4_900_000, stackId: 'photoreal' }), true);
  assert.equal(zoomBordersWanted({ heightM: 5_100_000, stackId: 'photoreal' }), false, 'nad prahom zapnutia bez zmeny');
  assert.equal(zoomBordersWanted({ heightM: 5_500_000, stackId: 'photoreal', shown: true }), true, 'zapnuté ostávajú až po 6 000 km');
  assert.equal(zoomBordersWanted({ heightM: 6_100_000, stackId: 'photoreal', shown: true }), false);
  assert.equal(zoomBordersWanted({ heightM: 260_000, stackId: 'bing-aerial' }), true, 'Bing letecký je tiež bez hraníc');
  for (const id of ['osm', 'stadia-dark', 'stadia-smooth', 'stadia-outdoors', 'stadia-terrain', 'karta', 'bing-labels', null]) {
    assert.equal(zoomBordersWanted({ heightM: 260_000, stackId: id, shown: true }), false, `${id}: vlastné hranice, nezdvojovať`);
  }
  assert.equal(zoomBordersWanted({ heightM: NaN, stackId: 'photoreal', shown: true }), true, 'bez výšky sa stav nemení');
  assert.deepEqual([...ZOOM_BORDERS_STACKS], ['photoreal', 'bing-aerial']);
  assert.ok(ZOOM_BORDERS_SHOW_BELOW_M < ZOOM_BORDERS_HIDE_ABOVE_M);
});

test('úvod: zemeguľa pri štarte je nad prahom (bez hraníc), prelet nad oblasť (mesto aj krajina) končí pod ním', () => {
  const globe = startViewFor(1440, 900, Date.parse('2026-10-16T10:00:00Z'));
  assert.ok(globe.heightM > ZOOM_BORDERS_HIDE_ABOVE_M, `zemeguľa ${globe.heightM} m nad prahom vypnutia`);
  const city = areaViewFor({ precision: 'city', lat: 48.15, lon: 17.11 });
  const country = areaViewFor({ precision: 'country', lat: 48.7, lon: 19.5 });
  assert.ok(city && city.heightM < ZOOM_BORDERS_SHOW_BELOW_M, 'mesto: hranice sa ukážu');
  assert.ok(country && country.heightM < ZOOM_BORDERS_SHOW_BELOW_M, 'krajina: hranice sa ukážu');
});

function harness() {
  const listeners = new Set();
  const scene = {
    postRender: { addEventListener: (fn) => listeners.add(fn), removeEventListener: (fn) => listeners.delete(fn) },
    camera: { positionCartographic: { height: 7_000_000 } },
  };
  const calls = [];
  const boundaries = { retain: async (who) => { calls.push(`retain:${who}`); return 1; }, release: (who) => { calls.push(`release:${who}`); } };
  let stack = 'photoreal'; let t = 1_000_000;
  const ctl = installZoomBorders({ scene, boundaries, getStackId: () => stack, now: () => t });
  const render = () => { for (const fn of listeners) fn(); };
  return { scene, calls, ctl, render, setStack: (s) => { stack = s; }, tick: (ms) => { t += ms; }, get listeners() { return listeners.size; } };
}

test('zapojenie: po vykreslení číta výšku a podklad, mení držiteľa „zoom" len pri zmene, najviac raz za 250 ms', () => {
  const h = harness();
  assert.equal(h.listeners, 1);
  h.render();
  assert.deepEqual(h.calls, [], 'zemeguľa 7 000 km: nič');
  h.scene.camera.positionCartographic.height = 1_100_000;
  h.render();
  assert.deepEqual(h.calls, [], 'do 250 ms sa znova nekontroluje');
  h.tick(300); h.render();
  assert.deepEqual(h.calls, ['retain:zoom']);
  assert.equal(h.ctl.shown, true);
  h.tick(300); h.render();
  assert.deepEqual(h.calls, ['retain:zoom'], 'bez zmeny žiadne ďalšie volanie');
  h.scene.camera.positionCartographic.height = 5_800_000;
  h.tick(300); h.render();
  assert.equal(h.ctl.shown, true, 'hysteréza: 5 800 km ešte drží');
  h.scene.camera.positionCartographic.height = 6_500_000;
  h.tick(300); h.render();
  assert.deepEqual(h.calls, ['retain:zoom', 'release:zoom']);
  assert.equal(h.ctl.shown, false);
});

test('zapojenie: prepnutie na podklad s vlastnými hranicami hranice pustí a návrat ich vráti; destroy odpojí a pustí', () => {
  const h = harness();
  h.scene.camera.positionCartographic.height = 260_000;
  assert.equal(h.ctl.check(true), true);
  h.setStack('stadia-dark');
  assert.equal(h.ctl.check(true), false);
  h.setStack('photoreal');
  assert.equal(h.ctl.check(true), true);
  assert.deepEqual(h.calls, ['retain:zoom', 'release:zoom', 'retain:zoom']);
  h.ctl.destroy();
  assert.equal(h.listeners, 0);
  assert.deepEqual(h.calls.at(-1), 'release:zoom');
  assert.equal(h.ctl.shown, false);
  // bez scény / hraníc bezpečný no-op
  const none = installZoomBorders({ scene: null, boundaries: null, getStackId: () => 'photoreal' });
  assert.equal(none.check(true), false);
  none.destroy();
});

test('zapojenie v main.js: držiteľ zoom nad countryBoundaries s aktívnym podkladom z MapStackController', () => {
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /import \{ installZoomBorders \} from '\.\/data\/zoomBorders\.js';/);
  assert.match(main, /installZoomBorders\(\{ scene: viewer\.scene, boundaries: countryBoundaries, getStackId: \(\) => mapStackController\.getActiveId\(\) \}\)/);
  assert.equal(ZOOM_BORDERS_HOLDER, 'zoom');
});
