import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DISPUTED_DASH_LENGTH, FADE_MS, HOME_ALPHA_MAX, HOME_WIDTH, LINE_ALPHA, LINE_WIDTH,
  createCountryBoundaries, fadeStep, homeAlpha, homeLines, parseBoundariesGeojsonl,
} from './countryBoundaries.js';

test('parseBoundariesGeojsonl keeps LineStrings, drops malformed / non-lines / too-short; vlastnosti vždy objekt', () => {
  const good = JSON.stringify({ type: 'Feature', id: 1, geometry: { type: 'LineString', coordinates: [[55, 25], [56, 26]] }, properties: { l: 'AE', r: 'OM', cls: 'international' } });
  const noProps = JSON.stringify({ type: 'Feature', id: 4, geometry: { type: 'LineString', coordinates: [[55, 25], [56, 26]] } });
  const shortLine = JSON.stringify({ type: 'Feature', id: 2, geometry: { type: 'LineString', coordinates: [[55, 25]] } });
  const point = JSON.stringify({ type: 'Feature', id: 3, geometry: { type: 'Point', coordinates: [55, 25] } });
  const feats = parseBoundariesGeojsonl([good, noProps, shortLine, point, 'not json', ''].join('\n'));
  assert.equal(feats.length, 2);
  assert.equal(feats[0].properties.l, 'AE');
  assert.deepEqual(feats[1].properties, {});
});

test('homeLines: čiary dotýkajúce sa štátu vľavo alebo vpravo; neplatný kód = nič; alfa domovskej zosilnená so stropom', () => {
  const feats = [
    { id: 1, properties: { l: 'AT', r: 'SK' } }, { id: 2, properties: { l: 'SK', r: 'HU' } }, { id: 3, properties: { l: 'CZ', r: 'PL' } }, { id: 4, properties: {} },
  ];
  assert.deepEqual(homeLines(feats, 'sk').map((f) => f.id), [1, 2]);
  assert.deepEqual(homeLines(feats, 'Slovensko'), []);
  assert.deepEqual(homeLines(feats, null), []);
  assert.ok(homeAlpha(LINE_ALPHA) > LINE_ALPHA && homeAlpha(LINE_ALPHA) <= HOME_ALPHA_MAX);
  assert.equal(homeAlpha(0), 0);
  assert.equal(homeAlpha(1), HOME_ALPHA_MAX);
  assert.ok(HOME_WIDTH > LINE_WIDTH);
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
  const createPrimitive = ({ instances, color, dash, kind }) => { const p = { kind, dash: Boolean(dash), instances, appearance: { material: { uniforms: { color } } }, show: true }; created.push(p); return p; };
  let t = 10_000;
  const geojsonl = [
    JSON.stringify({ type: 'Feature', id: 1, geometry: { type: 'LineString', coordinates: [[17, 48], [18, 48.5], [19, 48.7]] }, properties: { l: 'AT', r: 'SK', cls: 'international' } }),
    JSON.stringify({ type: 'Feature', id: 2, geometry: { type: 'LineString', coordinates: [[10, 10], [11, 11]] }, properties: { l: 'XA', r: 'XB', cls: 'international' } }),
    JSON.stringify({ type: 'Feature', id: 3, geometry: { type: 'LineString', coordinates: [[74, 34], [75, 34.5]] }, properties: { l: 'IN', r: 'PK', cls: 'disputed' } }),
  ].join('\n');
  let fetchCalls = 0;
  const fetch = async () => { fetchCalls += 1; return { ok: true, text: async () => geojsonl }; };
  const layer = createCountryBoundaries({ viewer: { scene }, fetch, createPrimitive, now: () => t });
  const frame = (dt) => { t += dt; for (const fn of [...listeners]) fn(); };
  const byKind = (k) => created.filter((p) => p.kind === k);
  return { layer, scene, created, frame, byKind, get fetchCalls() { return fetchCalls; }, get fading() { return listeners.size; }, get renders() { return renders; }, alphaOf: (p) => p.appearance.material.uniforms.color.alpha };
}

test('prewarm: plné a čiarkované primitívum zo všetkých hraníc vopred, priehľadné; bez viewera bezpečný no-op', async () => {
  const h = harness();
  assert.equal(await h.layer.prewarm(), 3, 'načíta všetky tri čiary');
  assert.equal(h.created.length, 2, 'plné (medzinárodné) + čiarkované (sporné)');
  assert.equal(h.scene.groundPrimitives.items.length, 2);
  const solid = h.byKind('solid')[0]; const dashed = h.byKind('dashed')[0];
  assert.equal(solid.instances.length, 2); assert.equal(solid.dash, false);
  assert.equal(dashed.instances.length, 1); assert.equal(dashed.dash, true, 'sporné čiarkovane');
  assert.equal(solid.instances[0].id, 'country-boundaries:line:1');
  assert.equal(solid.instances[0].geometry.width, LINE_WIDTH);
  assert.equal(h.alphaOf(solid), 0, 'priehľadné, kým nikto nedrží');
  assert.equal(h.layer.visible, false);
  assert.equal(h.layer.count, 3);
  await h.layer.prewarm();
  assert.equal(h.fetchCalls, 1, 'druhýkrát sa nesťahuje');
  assert.ok(DISPUTED_DASH_LENGTH > 4);
  const noop = createCountryBoundaries({});
  assert.equal(await noop.show(), 0, 'no viewer → safe no-op');
  assert.equal(await noop.prewarm(), 0);
  noop.highlight('SK');
  assert.equal(noop.home, null);
});

test('zapnutie prelína alfu po snímkach do 0,45 a vypnutie späť na 0 (plné aj čiarkované); geometria sa neprestavuje', async () => {
  const h = harness();
  await h.layer.prewarm();
  assert.equal(await h.layer.show(), 3);
  assert.equal(h.layer.visible, true);
  assert.equal(h.fading, 1, 'prelínanie beží na postRender');
  h.frame(FADE_MS / 2);
  assert.ok(Math.abs(h.layer.alpha - LINE_ALPHA / 2) < 1e-9, 'v polovici času polovica alfy');
  assert.ok(Math.abs(h.alphaOf(h.byKind('solid')[0]) - LINE_ALPHA / 2) < 1e-9, 'uniform plných sleduje alfu');
  assert.ok(Math.abs(h.alphaOf(h.byKind('dashed')[0]) - LINE_ALPHA / 2) < 1e-9, 'uniform čiarkovaných tiež');
  h.frame(FADE_MS);
  assert.equal(h.layer.alpha, LINE_ALPHA);
  assert.equal(h.fading, 0, 'po dosiahnutí cieľa sa odpojí');
  assert.ok(h.renders > 0);
  h.layer.hide();
  assert.equal(h.layer.visible, false);
  h.frame(FADE_MS * 2);
  assert.equal(h.layer.alpha, 0);
  assert.equal(h.created.length, 2, 'stále tie isté primitíva');
  assert.equal(h.fetchCalls, 1);
});

test('vyžiadanie pred dokončením načítania: po načítaní sa hranice rozsvietia samy', async () => {
  const h = harness();
  const p = h.layer.retain('zoom');
  assert.equal(h.layer.visible, true);
  assert.equal(await p, 3);
  assert.equal(h.fading, 1, 'prelínanie sa spustilo po načítaní');
  h.frame(FADE_MS * 2);
  assert.equal(h.layer.alpha, LINE_ALPHA);
});

test('domovská krajina (vlastník: „ak je IP napr. SK, trocha zvýrazniť"): tretie primitívum z jej čiar, hrubšie a sýtejšie, prelína sa spolu; zmena a zrušenie', async () => {
  const h = harness();
  h.layer.highlight('sk');
  assert.equal(h.layer.home, 'SK', 'kód sa normalizuje');
  assert.equal(h.byKind('home').length, 0, 'pred načítaním ešte nič');
  await h.layer.prewarm();
  assert.equal(h.byKind('home').length, 1, 'po načítaní sa domovské primitívum postaví samo');
  const home = h.byKind('home')[0];
  assert.equal(home.instances.length, 1, 'len čiara AT–SK');
  assert.equal(home.instances[0].geometry.width, HOME_WIDTH);
  assert.equal(h.alphaOf(home), 0, 'tiež priehľadné, kým nikto nedrží');
  await h.layer.retain('zoom');
  h.frame(FADE_MS * 2);
  assert.ok(Math.abs(h.alphaOf(home) - homeAlpha(LINE_ALPHA)) < 1e-9, 'domovská sýtejšia');
  h.layer.highlight('IN');
  assert.equal(h.scene.groundPrimitives.removed.length, 1, 'staré domovské primitívum preč');
  assert.equal(h.byKind('home').length, 2);
  assert.equal(h.byKind('home')[1].instances.length, 1, 'IN–PK (sporná) sa dotýka Indie');
  assert.ok(Math.abs(h.alphaOf(h.byKind('home')[1]) - homeAlpha(LINE_ALPHA)) < 1e-9, 'nové hneď s aktuálnou alfou');
  h.layer.highlight(null);
  assert.equal(h.layer.home, null);
  assert.equal(h.scene.groundPrimitives.items.length, 2, 'ostali len základné');
  h.layer.highlight('ZZ');
  assert.equal(h.scene.groundPrimitives.items.length, 2, 'štát bez čiar = bez primitíva');
});

test('držitelia (2026-09-19): scéna, potrubia aj zoom; hranice ostanú, kým ich drží aspoň jeden', async () => {
  const h = harness();
  assert.equal(await h.layer.retain('gas-pipelines'), 3, 'vrstva potrubí si vyžiada hranice');
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
  assert.equal(h.layer.count, 0);
  const noop = createCountryBoundaries({});
  assert.equal(await noop.retain('x'), 0);
  assert.deepEqual(noop.holders, []);
});

test('dataset: čiary s kódmi štátov a triedou; Slovensko má 5 susedov; UA–RU medzinárodná; žiadna vnútorná čiara', () => {
  const text = readFileSync(new URL('./local_data/boundaries/boundaries.geojsonl', import.meta.url), 'utf8');
  const feats = parseBoundariesGeojsonl(text);
  assert.ok(feats.length > 100, 'bundled world borders present');
  assert.ok(feats.every((f) => f.geometry.coordinates.every(([lon, lat]) => Math.abs(lon) <= 180 && Math.abs(lat) <= 90)));
  assert.ok(feats.every((f) => f.properties.cls === 'international' || f.properties.cls === 'disputed'), 'len medzinárodné a sporné');
  const sk = homeLines(feats, 'SK');
  const neighbours = new Set(sk.flatMap((f) => [f.properties.l, f.properties.r]).filter((c) => c && c !== 'SK'));
  assert.deepEqual([...neighbours].sort(), ['AT', 'CZ', 'HU', 'PL', 'UA']);
  assert.ok(sk.every((f) => f.properties.cls === 'international'));
  assert.ok(feats.some((f) => ((f.properties.l === 'UA' && f.properties.r === 'RU') || (f.properties.l === 'RU' && f.properties.r === 'UA')) && f.properties.cls === 'international'), 'hranica Ukrajina–Rusko');
  // Perekop (de facto čiara Krymu v Natural Earth) v datasete nie je: žiadna čiara nezačína ani nekončí pri 33,6° v. d., 46,1° s. š.
  const nearPerekop = feats.filter((f) => f.geometry.coordinates.some(([lon, lat]) => Math.abs(lon - 33.6) < 0.4 && Math.abs(lat - 46.15) < 0.25));
  assert.equal(nearPerekop.length, 0, 'Krym nie je oddelený od Ukrajiny');
  const disputed = feats.filter((f) => f.properties.cls === 'disputed').length;
  assert.ok(disputed >= 20 && disputed <= 60, `sporné čiary čiarkovane (${disputed})`);
});

test('hranice = len plochá čiara na teréne a 3D dlaždiciach, žiadna stena (2026-10-10: „tú stenu hraníc vypni všade")', () => {
  const src = readFileSync(new URL('./countryBoundaries.js', import.meta.url), 'utf8');
  assert.match(src, /new Cesium\.GroundPolylineGeometry\(/, 'čiara na teréne');
  assert.match(src, /classificationType: Cesium\.ClassificationType\.BOTH/, 'terén aj 3D dlaždice (fotoreál)');
  assert.ok(!/WallGeometry|wall:/.test(src), 'stena nie');
  assert.match(src, /asynchronous: true/, 'geometria vo workeroch, hlavné vlákno voľné');
  assert.match(src, /Material\.fromType\('PolylineDash'/, 'sporné čiarkovane');
});

test('zapojenie: main.js postaví hranice vopred a zvýrazní domovskú krajinu z /api/whereami', () => {
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /const countryBoundaries = createCountryBoundaries\(\{ viewer \}\);\n[\s\S]{0,600}?void countryBoundaries\.prewarm\(\);/);
  assert.match(main, /void geoPromise\.then\(\(geo\) => \{\n\s+const home = \/\^\[A-Z\]\{2\}\$\/\.test\(geo\?\.country \|\| ''\) \? geo\.country : null;\n\s+if \(!home\) return;\n\s+countryBoundaries\.highlight\(home\);\n\s+countryLabels\.setHome\(home\);/);
  assert.match(main, /const locate = crawlerVisit \|\| embedView \? null : \(\) => geoPromise;/, 'prelet berie tú istú polohu');
});
