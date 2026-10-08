// src/data/meteoMapOverlay.test.mjs — mapa nad meteo poľom ako na Windy (2026-10-07): mená miest
// presne pri bodkách, uzavreté pobrežia, výška nad drapériou, načítanie bez pádu, zapojenie do vrstvy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { METEO_OVERLAY_HEIGHT_M, cityLabelPlan, createMeteoMapOverlay, loadMeteoMapData, ringToFlat, BORDERS_URL, COAST_URL } from './meteoMapOverlay.js';
import { METEO_DRAPE_HEIGHT_M, ISOLINE_HEIGHT_M } from './meteoLayer.js';
import { placeVisibleUntilM } from './meteoPlaces.js';

test('výška: nad drapériou poľa, pod izobarami', () => {
  assert.ok(METEO_OVERLAY_HEIGHT_M > METEO_DRAPE_HEIGHT_M, 'čiary musia byť nad poľom, inak ich zakryje');
  assert.ok(METEO_OVERLAY_HEIGHT_M < ISOLINE_HEIGHT_M);
});

test('mená miest: viditeľné presne tam, kde bodka mesta; zlé riadky preč', () => {
  const plan = cityLabelPlan([
    { name: 'Tokyo', lat: 35.7, lon: 139.7, pop: 35676, capital: true },
    { name: 'Bratislava', lat: 48.15, lon: 17.11, pop: 423, capital: true },
    { name: 'Trnava', lat: 48.37, lon: 17.59, pop: 65, capital: false },
    { name: '', lat: 1, lon: 1 },
    { name: 'X', lat: NaN, lon: 1 },
    null,
  ]);
  assert.deepEqual(plan.map((p) => p.name), ['Tokyo', 'Bratislava', 'Trnava']);
  assert.equal(plan[0].maxDistance, placeVisibleUntilM(35676, true));
  assert.equal(plan[1].maxDistance, placeVisibleUntilM(423, true), 'hlavné mesto ako bodka');
  assert.equal(plan[2].maxDistance, placeVisibleUntilM(65, false), 'malé mesto až zblízka');
  assert.deepEqual(cityLabelPlan(undefined), []);
});

test('pobrežie je uzavretá čiara, hranica nie; plochý zoznam lon, lat, výška', () => {
  assert.deepEqual(ringToFlat([[1, 2], [3, 4], [5, 6]], 100), [1, 2, 100, 3, 4, 100, 5, 6, 100, 1, 2, 100]);
  assert.deepEqual(ringToFlat([[1, 2], [3, 4]], 100, false), [1, 2, 100, 3, 4, 100]);
  assert.deepEqual(ringToFlat([[1, 2]]), []);
});

test('načítanie: pobrežia a hranice z Natural Earth v repe; výpadok = prázdne, nehádže', async () => {
  const calls = [];
  const data = await loadMeteoMapData(async (url) => {
    calls.push(url);
    if (url === COAST_URL) return { ok: true, json: async () => ({ rings: [[[0, 0], [1, 0], [1, 1]]] }) };
    return { ok: true, json: async () => ({ lines: [[[0, 0], [1, 1]]] }) };
  });
  assert.deepEqual(calls.sort(), [BORDERS_URL, COAST_URL].sort());
  assert.equal(data.coast.length, 1);
  assert.equal(data.borders.length, 1);
  assert.deepEqual(await loadMeteoMapData(async () => { throw new Error('net'); }), { coast: [], borders: [] });
  assert.deepEqual(await loadMeteoMapData(async () => ({ ok: false })), { coast: [], borders: [] });
  const land = JSON.parse(readFileSync(new URL('./local_data/natural_earth/land.json', import.meta.url), 'utf8'));
  const borders = JSON.parse(readFileSync(new URL('./local_data/natural_earth/borders.json', import.meta.url), 'utf8'));
  assert.ok(land.rings.length > 500 && borders.lines.length > 300, 'skutočné dáta v repe majú tvar, ktorý čítame');
});

test('vrstva: mapa nad poľom sa stavia s miestami, zhasína s poľom a odchádza pri vypnutí', () => {
  const src = readFileSync(new URL('./meteoLayer.js', import.meta.url), 'utf8');
  assert.match(src, /_mapOverlay = mapOverlayFactory\(\{ coast: _mapData\.coast, borders: _mapData\.borders, places: _places \|\| \[\] \}\);/);
  assert.match(src, /if \(_mapOverlay\) _mapOverlay\.show = fade > 0\.02;/, 'pri nízkej kamere zhasne s poľom');
  assert.match(src, /function clearPlaces\(\) \{[\s\S]*?clearMapOverlay\(\);/, 'vypnutie a zničenie vrstvy mapu odstráni');
});

test('prekrytie s viacerými čiarami sa dá zničiť — inak padne vypnutie meteo vrstvy', (t) => {
  // Material.fromType v Node siaha na DOM triedy; stačia prázdne, plátno tu nie je.
  for (const name of ['HTMLCanvasElement', 'HTMLImageElement', 'HTMLVideoElement', 'ImageBitmap', 'OffscreenCanvas']) {
    if (name in globalThis) continue;
    globalThis[name] = class {};
    t.after(() => { delete globalThis[name]; });
  }
  const ring = [[17, 48], [17.5, 48], [17.5, 48.5], [17, 48]];
  const overlay = createMeteoMapOverlay({ coast: [ring, ring], borders: [ring, ring] });
  assert.doesNotThrow(() => overlay.destroy());
  assert.equal(overlay.isDestroyed(), true);
});
