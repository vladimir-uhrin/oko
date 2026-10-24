// src/data/volbyObceLayer.test.mjs — mapa obcí VOĽBY 2026 (2026-10-24): štýl a viditeľnosť podľa veľkosti a
// stavu výsledkov, popis s vedúcim kandidátom, čítanie /api/volby/obce-body, životný cyklus na falošnom
// viewer-i (body, popisky, výber, obnova len prefarbí), registrácia v registri vrstiev a v main.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  OBCE_BODY_URL, OBEC_PICK_RADIUS_PX, OBEC_STATE_COLORS, VOLBY_OBCE_LAYER_ID, createVolbyObceLayer, labelText, labelVisibleUntilM, nearestWithin,
  parseObceBody, pointStyle, pointVisibleUntilM,
} from './volbyObceLayer.js';
import { LAYER_STATE_REGISTRY } from './layerState.js';
import { LAYER_CATEGORY, LAYER_KEYWORDS } from '../layerCategories.js';

const BODY = {
  columns: ['code', 'name', 'lat', 'lon', 'seats', 'state', 'lead', 'leadPct'],
  rows: [
    ['582000', 'Bratislava', 48.1486, 17.1077, 45, 0, '', null],
    ['501891', 'Topoľníky', 47.9, 17.78, 9, 0, '', null],
    ['500011', 'Nitra', 48.3069, 18.0864, 31, 0, '', null],
    ['bad', 'Bez polohy', null, null, 5, 0, '', null],
  ],
};

test('pure: viditeľnosť a štýl podľa mandátov, farby stavu, popis s vedúcim kandidátom, parse', () => {
  assert.equal(pointVisibleUntilM(45, true), 6_000_000);
  assert.equal(pointVisibleUntilM(31), 6_000_000);
  assert.equal(pointVisibleUntilM(13), 3_000_000);
  assert.equal(pointVisibleUntilM(7), 1_800_000);
  assert.ok(labelVisibleUntilM(45, true) > labelVisibleUntilM(13) && labelVisibleUntilM(13) > labelVisibleUntilM(9) && labelVisibleUntilM(9) > labelVisibleUntilM(5));
  assert.deepEqual(pointStyle({ seats: 45, city: true, state: 0 }), { pixelSize: 5.5, color: OBEC_STATE_COLORS[0] });
  assert.deepEqual(pointStyle({ seats: 9, state: 1 }), { pixelSize: 3.2, color: '#ffd166' });
  assert.deepEqual(pointStyle({ seats: 5, state: 2 }), { pixelSize: 2.6, color: '#4ade80' });
  assert.equal(pointStyle({ seats: 5, state: 9 }).color, OBEC_STATE_COLORS[0], 'neznámy stav = bez výsledkov');
  assert.equal(labelText({ name: 'Nitra', state: 0, lead: 'X Y', leadPct: 40 }), 'Nitra', 'pred výsledkami len meno');
  assert.equal(labelText({ name: 'Nitra', state: 1, lead: 'Marek Hattas', leadPct: 51.4 }), 'Nitra\nMarek Hattas 51 %');
  assert.equal(labelText({ name: 'Nitra', state: 2, lead: 'Marek Hattas', leadPct: null }), 'Nitra\nMarek Hattas');
  const parsed = parseObceBody(BODY);
  assert.equal(parsed.length, 3, 'riadok bez polohy vypadne');
  assert.deepEqual(parsed[0], { code: '582000', name: 'Bratislava', lat: 48.1486, lon: 17.1077, seats: 45, city: true, state: 0, lead: '', leadPct: null });
  assert.equal(parsed[1].city, false);
  assert.deepEqual(parseObceBody(null), []);
  const pts = [{ code: 'a', x: 100, y: 100 }, { code: 'b', x: 110, y: 100 }, { code: 'c', x: 300, y: 300 }];
  assert.equal(nearestWithin(pts, { x: 108, y: 101 }), 'b');
  assert.equal(nearestWithin([pts[0]], { x: 100 + OBEC_PICK_RADIUS_PX, y: 100 }), 'a', 'presne na polomere ešte áno');
  assert.equal(nearestWithin(pts, { x: 100 + OBEC_PICK_RADIUS_PX, y: 100 }), 'b', 'bližší bod vyhráva');
  assert.equal(nearestWithin(pts, { x: 200, y: 200 }), null);
  assert.equal(nearestWithin([{ code: 'x', x: NaN, y: 1 }], { x: 0, y: 0 }), null);
});

const fakeCollection = () => { const items = []; return { show: true, add(o) { items.push(o); return o; }, removeAll() { items.length = 0; }, get(i) { return items[i]; }, get length() { return items.length; } }; };
const fakeCollections = () => ({ points: fakeCollection(), labels: fakeCollection() });

function fakeViewer() {
  const primitives = [];
  return {
    scene: { primitives: { add: (c) => { primitives.push(c); return c; }, remove: (c) => { const i = primitives.indexOf(c); if (i >= 0) primitives.splice(i, 1); return i >= 0; } }, canvas: null, pick: () => null },
    _primitives: primitives,
  };
}

test('vrstva: init skryje kolekcie, enable načíta body a popisky, klik cez select ohlási obec, obnova stavov len prefarbí, disable/destroy upracú', async () => {
  let body = BODY;
  const calls = [];
  const layer = createVolbyObceLayer({ fetchImpl: async (url) => { calls.push(url); return { ok: true, json: async () => body }; }, now: () => 123, collections: fakeCollections });
  const viewer = fakeViewer();
  layer.init(viewer);
  assert.equal(viewer._primitives.length, 2);
  assert.equal(viewer._primitives[0].show, false);
  assert.equal(layer.enable(), true);
  assert.equal(viewer._primitives[0].show, true);
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, [OBCE_BODY_URL]);
  let st = layer._stateForTest();
  assert.equal(st.rows, 3);
  assert.equal(st.points, 3);
  assert.equal(st.labels, 3);
  const stats = layer.getStats();
  assert.equal(stats.count, 3);
  assert.equal(stats.lastUpdate, 123);
  assert.equal(stats.error, null);
  const selected = [];
  layer.onSelect = (code) => selected.push(code);
  assert.equal(layer.select('501891', { origin: 'map' }), true);
  assert.deepEqual(selected, ['501891']);
  assert.equal(layer.select('582000'), true, 'výber z panela neohlasuje späť');
  assert.deepEqual(selected, ['501891']);
  assert.equal(layer.select('nope'), false);
  // Po 20:00: ten istý zoznam obcí s výsledkami → prefarbenie bez prestavby (rovnaký počet bodov).
  body = { ...BODY, rows: BODY.rows.map((r) => (r[0] === '500011' ? ['500011', 'Nitra', 48.3069, 18.0864, 31, 2, 'Marek Hattas', 51.4] : r)) };
  assert.equal(await layer.update(viewer, {}), true);
  st = layer._stateForTest();
  assert.equal(st.points, 3);
  const labels = viewer._primitives[1];
  const nitra = [...Array(labels.length)].map((_, i) => labels.get(i)).find((l) => l.id === 'obec:500011');
  assert.equal(nitra.text, 'Nitra\nMarek Hattas 51 %');
  assert.equal(nitra.distanceDisplayCondition.far, labelVisibleUntilM(31));
  assert.equal(layer.getStats().resultsFinal, 1);
  // Chyba siete: stav ostáva, error nastavený, stale.
  body = null;
  const failing = createVolbyObceLayer({ fetchImpl: async () => ({ ok: false, status: 503 }), collections: fakeCollections });
  failing.init(fakeViewer());
  assert.equal(await failing.update(null, {}), false);
  assert.equal(failing.getStats().error, 'HTTP 503');
  assert.equal(layer.disable(), true);
  assert.equal(viewer._primitives[0].show, false);
  layer.destroy();
  assert.equal(viewer._primitives.length, 0);
  assert.equal(layer._stateForTest().rows, 0);
});

test('registrácia: token v registri stavu vrstiev, kategória a kľúčové slová, main.js registruje a prepája s panelom', () => {
  const entry = LAYER_STATE_REGISTRY.find((e) => e.id === VOLBY_OBCE_LAYER_ID);
  assert.deepEqual(entry, { id: VOLBY_OBCE_LAYER_ID, token: 'V', disposition: 'enabled-only' });
  const tokens = LAYER_STATE_REGISTRY.map((e) => e.token);
  assert.equal(new Set(tokens).size, tokens.length, 'jedinečné tokeny');
  assert.equal(LAYER_CATEGORY[VOLBY_OBCE_LAYER_ID], 'city');
  assert.ok(LAYER_KEYWORDS[VOLBY_OBCE_LAYER_ID].includes('voľby'));
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /import volbyObceLayer from '\.\/data\/volbyObceLayer\.js';/);
  assert.match(main, /dataManager\.register\(volbyObceLayer\);/);
  assert.match(main, /volbyObceLayer\.onSelect = /);
  assert.ok(Cesium.DistanceDisplayCondition, 'Cesium dostupné v Node (ako ostatné vrstvy)');
});
