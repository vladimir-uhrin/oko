// src/mapScaleBar.test.mjs — mierka v km a režim mapy (2026-09-24, „prehľadnosť
// ako špičkové portály"): pekné kroky, len v režime mapy; os vie zbaliť legendu
// bez uloženia voľby a vysvetľuje značky hlásenia GŠ; CSS režimu mapy nemení
// geometriu doku.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SCALE_MAX_PX, createMapScaleBar, niceScale } from './mapScaleBar.js';

test('niceScale: najdlhší pekný krok do 110 px, text m/km, sk desatinná čiarka', () => {
  assert.deepEqual(niceScale(0.5), { km: 50, px: 100, label: '50 km' }, '0,5 km/px → 50 km = 100 px');
  assert.deepEqual(niceScale(0.2), { km: 20, px: 100, label: '20 km' });
  assert.equal(niceScale(0.002).label, '200 m');
  assert.equal(niceScale(0.001, SCALE_MAX_PX, 'sk').label, '100 m');
  assert.ok(niceScale(0.5).px <= SCALE_MAX_PX);
  assert.equal(niceScale(0), null);
  assert.equal(niceScale(NaN), null);
  assert.equal(niceScale(1e-6), null, 'pod najmenším krokom nič');
});

test('mierka: mimo režimu mapy skrytá; bez scény neškodná', () => {
  assert.deepEqual(createMapScaleBar({}).getState(), { shown: false });
  const body = { children: [], classList: { contains: () => false }, appendChild(c) { this.children.push(c); } };
  const mk = () => ({ className: '', hidden: false, style: {}, children: [], textContent: '', setAttribute() {}, appendChild(c) { this.children.push(c); }, remove() {} });
  const doc = { body, createElement: mk, querySelector: () => null, defaultView: { innerHeight: 800 } };
  const scene = { canvas: { clientWidth: 1000, clientHeight: 800 }, camera: { pickEllipsoid: () => null }, postRender: { addEventListener() {}, removeEventListener() {} } };
  const bar = createMapScaleBar({ viewer: { scene, container: { ownerDocument: doc } }, documentRef: doc });
  bar.update();
  assert.equal(bar._el.hidden, true);
  assert.equal(bar.getState().shown, false);
  bar.destroy();
});

test('brána priblíženia platí aj v 2D (PLÁTNO): vzdialenosť z kartografickej polohy, nie z positionWC', async () => {
  const Cesium = await import('cesium');
  const { createSceneRevealGate } = await import('./sceneRevealGate.js');
  const flips = [];
  const cam = {
    // V 2D je positionWC v premietnutom rámci — ďaleko od ECEF stredu scény.
    positionWC: new Cesium.Cartesian3(12.7e6, 4e6, 3e6),
    positionCartographic: Cesium.Cartographic.fromDegrees(37.6, 48.9, 250_000),
  };
  const body = { classList: { toggle() {} } };
  const doc = { body, head: { appendChild() {} }, createElement: () => ({ setAttribute() {} }), getElementById: () => null };
  const gate = createSceneRevealGate({ viewer: { scene: { camera: cam, postRender: { addEventListener() {}, removeEventListener() {} } } }, documentRef: doc, onChange: (v) => flips.push(v) });
  gate.activate({ lat: 48.95, lon: 37.8 });
  assert.deepEqual(flips, [true], 'priblížený nad smerom = odhalené aj v 2D');
  assert.equal(gate.isRevealed(), true);
});

test('režim mapy sa zosúladí pri každej zmene scény (aj bez preklopenia brány)', () => {
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  // 2026-09-26: tretia rodina scén (dejiská BLÍZKEHO VÝCHODU) rozšírila výraz o activeTheatre.
  assert.match(main, /const syncMapFocus = \(\) => setMapFocus\(revealGate\.isRevealed\(\) && Boolean\(activeFrontScene \|\| activeChokepoint \|\| activeTheatre\)\);/);
  assert.ok((main.match(/syncMapFocus\(\);/g) || []).length >= 3, 'front, úžina a situácia bez scény');
});

test('CSS režimu mapy: len opacity/visibility (geometria doku bez zmeny), súradnice HUD ostanú', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const rule = /body\.oko-map-focus #command-dock:not\(:hover\):not\(:focus-within\) \{([^}]*)\}/.exec(css);
  assert.ok(rule, 'dok sa zosvetlí mimo myši a fokusu');
  assert.doesNotMatch(rule[1], /bottom|top|transform|margin|height|position/, 'bez zmeny geometrie');
  assert.match(css, /body\.oko-map-focus #intel-hud \.hud-top-left,/);
  assert.doesNotMatch(css, /body\.oko-map-focus #intel-hud \.hud-bottom-left/, 'súradnice vľavo dole ostávajú');
  assert.match(css, /\.oko-scale \{ position: fixed;/, 'mierka má geometriu v style.css');
});

test('časová os: voľbu legendy nikto neprepisuje; riadok hlásenia GŠ vysvetľuje meče, farby aj „neuvedené" a ukáže sa len s vrstvou', async () => {
  const src = readFileSync(new URL('./ukraineTimeline.js', import.meta.url), 'utf8');
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /setLegendCollapsed/, 'scéna legendu automaticky nezbaľuje (predvolene je zbalená, voľba patrí používateľovi)');
  for (const cls of ['is-rp-marker', 'is-rp-0', 'is-rp-low', 'is-rp-mid', 'is-rp-high', 'is-rp-na']) assert.ok(src.includes(`'${cls}'`), cls);
  assert.match(src, /rpBox\.hidden = !report\.isShown\?\.\(\);/, 'len keď vrstva hlásenia kreslí');
  const strings = readFileSync(new URL('./i18nStrings.js', import.meta.url), 'utf8');
  assert.doesNotMatch(strings, /'ukraine\.rp\.marker': '✕/, 'glyf je vo vzorke, nie dvakrát v texte');
  const { reportIntensityColor } = await import('./data/ukraineReportLayer.js');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  // Farby legendy = farby značiek na mape.
  const color = (cls) => new RegExp(`\\.oko-ukr-tl-ctl-item\\.${cls} \\.oko-ukr-tl-ctl-sw \\{ background: (#[0-9a-f]{6}); \\}`).exec(css)?.[1];
  assert.equal(color('is-rp-0'), reportIntensityColor(0));
  assert.equal(color('is-rp-low'), reportIntensityColor(5));
  assert.equal(color('is-rp-mid'), reportIntensityColor(12));
  assert.equal(color('is-rp-high'), reportIntensityColor(29));
});
