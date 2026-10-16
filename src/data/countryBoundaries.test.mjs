import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  FADE_MS, LINE_ALPHA, LINE_WIDTH, createCountryBoundaries, fadeStep, parseBoundariesGeojsonl,
} from './countryBoundaries.js';

test('parseBoundariesGeojsonl keeps LineStrings, drops malformed / non-lines / too-short', () => {
  const good = JSON.stringify({ type: 'Feature', id: 1, geometry: { type: 'LineString', coordinates: [[55, 25], [56, 26]] }, properties: {} });
  const shortLine = JSON.stringify({ type: 'Feature', id: 2, geometry: { type: 'LineString', coordinates: [[55, 25]] } });
  const point = JSON.stringify({ type: 'Feature', id: 3, geometry: { type: 'Point', coordinates: [55, 25] } });
  const feats = parseBoundariesGeojsonl([good, shortLine, point, 'not json', ''].join('\n'));
  assert.equal(feats.length, 1);
  assert.equal(feats[0].geometry.coordinates.length, 2);
});

test('fadeStep: k cieľu rýchlosťou alfa/FADE_MS, nikdy cez cieľ, bez času bez zmeny', () => {
  assert.equal(fadeStep(0, LINE_ALPHA, FADE_MS / 2), LINE_ALPHA / 2);
  assert.equal(fadeStep(0, LINE_ALPHA, FADE_MS * 3), LINE_ALPHA, 'nie cez cieľ');
  assert.equal(fadeStep(LINE_ALPHA, 0, FADE_MS / 4), LINE_ALPHA * 0.75);
  assert.equal(fadeStep(0.3, 0.3, 100), 0.3);
  assert.equal(fadeStep(0.3, 0, 0), 0.3);
  assert.equal(fadeStep(0.3, 0, NaN), 0.3);
});

/** Falošný viewer: groundPrimitives + postRender (prelínanie) + requestRender; továreň primitíva bez WebGL. */
function harness() {
  const listeners = new Set();
  const groundPrimitives = { items: [], removed: [], add(p) { this.items.push(p); return p; }, remove(p) { const i = this.items.indexOf(p); if (i >= 0) this.items.splice(i, 1); this.removed.push(p); return i >= 0; } };
  let renders = 0;
  const scene = {
    groundPrimitives,
    postRender: { addEventListener: (fn) => listeners.add(fn), removeEventListener: (fn) => listeners.delete(fn) },
    requestRender() { renders += 1; },
  };
  const created = [];
  const createPrimitive = ({ instances, color }) => { const p = { instances, appearance: { material: { uniforms: { color } } }, show: true }; created.push(p); return p; };
  let t = 10_000;
  const geojsonl = [
    JSON.stringify({ type: 'Feature', id: 1, geometry: { type: 'LineString', coordinates: [[17, 48], [18, 48.5], [19, 48.7]] } }),
    JSON.stringify({ type: 'Feature', id: 2, geometry: { type: 'LineString', coordinates: [[10, 10], [11, 11]] } }),
  ].join('\n');
  let fetchCalls = 0;
  const fetch = async () => { fetchCalls += 1; return { ok: true, text: async () => geojsonl }; };
  const layer = createCountryBoundaries({ viewer: { scene }, fetch, createPrimitive, now: () => t });
  const frame = (dt) => { t += dt; for (const fn of [...listeners]) fn(); };
  return { layer, scene, created, frame, get fetchCalls() { return fetchCalls; }, get fading() { return listeners.size; }, get renders() { return renders; }, get color() { return created[0]?.appearance.material.uniforms.color; } };
}

test('prewarm: jedno primitívum zo všetkých hraníc postavené vopred, priehľadné; bez viewera bezpečný no-op', async () => {
  const h = harness();
  assert.equal(await h.layer.prewarm(), 2, 'načíta a postaví obe hranice');
  assert.equal(h.created.length, 1, 'JEDEN GroundPolylinePrimitive');
  assert.equal(h.scene.groundPrimitives.items.length, 1);
  assert.equal(h.created[0].instances.length, 2, 'inštancia na hranicu');
  assert.equal(h.created[0].instances[0].id, 'country-boundaries:line:1');
  assert.equal(h.created[0].instances[0].geometry.width, LINE_WIDTH);
  assert.equal(h.color.alpha, 0, 'priehľadné, kým nikto nedrží');
  assert.equal(h.layer.visible, false);
  assert.equal(h.layer.count, 2);
  await h.layer.prewarm();
  assert.equal(h.fetchCalls, 1, 'druhýkrát sa nesťahuje');
  const noop = createCountryBoundaries({});
  assert.equal(await noop.show(), 0, 'no viewer → safe no-op');
  assert.equal(await noop.prewarm(), 0);
});

test('zapnutie prelína alfu po snímkach do 0,6 a vypnutie späť na 0; geometria sa neprestavuje', async () => {
  const h = harness();
  await h.layer.prewarm();
  assert.equal(await h.layer.show(), 2);
  assert.equal(h.layer.visible, true);
  assert.equal(h.fading, 1, 'prelínanie beží na postRender');
  h.frame(FADE_MS / 2);
  assert.ok(Math.abs(h.layer.alpha - LINE_ALPHA / 2) < 1e-9, 'v polovici času polovica alfy');
  assert.ok(Math.abs(h.color.alpha - LINE_ALPHA / 2) < 1e-9, 'uniform materiálu sleduje alfu');
  h.frame(FADE_MS);
  assert.equal(h.layer.alpha, LINE_ALPHA);
  assert.equal(h.fading, 0, 'po dosiahnutí cieľa sa odpojí');
  assert.ok(h.renders > 0);
  h.layer.hide();
  assert.equal(h.layer.visible, false);
  h.frame(FADE_MS * 2);
  assert.equal(h.layer.alpha, 0);
  assert.equal(h.created.length, 1, 'stále to isté primitívum');
  assert.equal(h.fetchCalls, 1);
});

test('vyžiadanie pred dokončením načítania: po načítaní sa hranice rozsvietia samy', async () => {
  const h = harness();
  const p = h.layer.retain('zoom');
  assert.equal(h.layer.visible, true);
  assert.equal(await p, 2);
  assert.equal(h.fading, 1, 'prelínanie sa spustilo po načítaní');
  h.frame(FADE_MS * 2);
  assert.equal(h.layer.alpha, LINE_ALPHA);
});

test('držitelia (2026-09-19): scéna, potrubia aj zoom; hranice ostanú, kým ich drží aspoň jeden', async () => {
  const h = harness();
  assert.equal(await h.layer.retain('gas-pipelines'), 2, 'vrstva potrubí si vyžiada hranice');
  h.frame(FADE_MS * 2);
  assert.equal(h.layer.alpha, LINE_ALPHA);
  assert.deepEqual(h.layer.holders, ['gas-pipelines']);
  await h.layer.show(); // scéna úžiny
  await h.layer.retain('zoom');
  assert.deepEqual(h.layer.holders, ['gas-pipelines', 'scene', 'zoom']);
  h.layer.hide(); // scéna skončila
  h.layer.release('zoom');
  h.frame(FADE_MS * 2);
  assert.equal(h.layer.alpha, LINE_ALPHA, 'uvoľnenie scény a zoomu nezoberie hranice vrstve potrubí');
  h.layer.release('gas-pipelines');
  h.frame(FADE_MS * 2);
  assert.equal(h.layer.alpha, 0, 'posledný držiteľ preč = hranice preč');
  assert.deepEqual(h.layer.holders, []);
  h.layer.release('gas-pipelines');
  assert.equal(h.layer.visible, false, 'opakované uvoľnenie je neškodné');
  h.layer.destroy();
  assert.equal(h.scene.groundPrimitives.items.length, 0);
  assert.equal(h.scene.groundPrimitives.removed.length, 1);
  assert.equal(h.layer.count, 0);
  const noop = createCountryBoundaries({});
  assert.equal(await noop.retain('x'), 0);
  assert.deepEqual(noop.holders, []);
});

test('the bundled boundaries dataset exists and parses to real border lines', () => {
  const text = readFileSync(new URL('./local_data/boundaries/boundaries.geojsonl', import.meta.url), 'utf8');
  const feats = parseBoundariesGeojsonl(text);
  assert.ok(feats.length > 100, 'bundled world borders present');
  assert.ok(feats.every((f) => f.geometry.coordinates.every(([lon, lat]) => Math.abs(lon) <= 180 && Math.abs(lat) <= 90)));
});

test('hranice = len plochá čiara na teréne a 3D dlaždiciach, žiadna stena (2026-10-10: „tú stenu hraníc vypni všade")', () => {
  const src = readFileSync(new URL('./countryBoundaries.js', import.meta.url), 'utf8');
  assert.match(src, /new Cesium\.GroundPolylineGeometry\(/, 'čiara na teréne');
  assert.match(src, /classificationType: Cesium\.ClassificationType\.BOTH/, 'terén aj 3D dlaždice (fotoreál)');
  assert.ok(!/WallGeometry|wall:/.test(src), 'stena nie');
  assert.match(src, /asynchronous: true/, 'geometria vo workeroch, hlavné vlákno voľné');
});

test('zapojenie: main.js postaví hranice vopred hneď po vytvorení (pod úvodnou obrazovkou)', () => {
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /const countryBoundaries = createCountryBoundaries\(\{ viewer \}\);\n[\s\S]{0,600}?void countryBoundaries\.prewarm\(\);/);
});
