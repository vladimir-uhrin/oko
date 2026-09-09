// src/data/meteoLayer.test.mjs
// Meteorológia sveta — vrstva GFS (2026-09-08, prototyp): životný cyklus s dvojníkmi,
// čipy poľa/častíc, podklad, register tokenov, proxy tripwire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMeteoLayer, METEO_BASEMAP_ID, METEO_LAYER_ID, fieldMaterialFabric } from './meteoLayer.js';
import { _resetActiveMapStackForTest, setActiveMapStack } from './activeMapStack.js';

function fakeDoc() {
  const canvasCtx = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} };
  const elements = [];
  return {
    body: { appendChild(el) { elements.push(el); } },
    createElement(tag) {
      const el = { tag, width: 0, height: 0, className: '', children: [], hidden: false, dataset: {}, style: {}, attrs: {},
        getContext: () => canvasCtx, appendChild(c) { this.children.push(c); return c; }, append(...c) { this.children.push(...c); },
        replaceChildren(...c) { this.children = c; }, addEventListener() {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() {},
        classList: { toggle() {} } };
      if (tag === 'img') el.decode = () => Promise.resolve();
      return el;
    },
    elements,
  };
}

function harness({ isolineFactory = null, gridReader = null, catalog = { model: 'GFS 0.25°', run: '2026-09-08T12:00:00Z', steps: ['2026-09-08T18:00:00Z', '2026-09-08T21:00:00Z', '2026-09-09T00:00:00Z'], attribution: 'x', stale: false }, imageOk = true } = {}) {
  const calls = { fetch: [], images: [], particles: [], events: [], primitives: [] };
  const doc = fakeDoc();
  const win = { dispatchEvent(e) { calls.events.push(e.detail); } };
  const particles = {
    isSupported: () => true,
    setWind: (img, r) => calls.particles.push(['setWind', r.uRange[0], Boolean(r.next)]),
    setMix: (f) => calls.particles.push(['setMix', Number(f.toFixed(2))]),
    setRamp: () => calls.particles.push(['setRamp']),
    start: () => calls.particles.push(['start']),
    stop: () => calls.particles.push(['stop']),
    destroy: () => calls.particles.push(['destroy']),
  };
  const timeline = { steps: [], index: 0, shown: false, status: '',
    setSteps(list, run) { this.steps = list; this.run = run; }, setIndex(i) { this.index = i; }, getIndex() { return this.index; },
    setPlaying() {}, isPlaying: () => false, setStatus(s) { this.status = s; }, show() { this.shown = true; }, hide() { this.shown = false; }, destroy() {} };
  const layer = createMeteoLayer({
    fetchImpl: async (url) => { calls.fetch.push(url); return { ok: true, json: async () => catalog }; },
    imageLoader: async (url) => { calls.images.push(url); return imageOk ? { src: url } : null; },
    primitiveFactory: ({ image, field }) => { const p = { primitive: { show: false }, material: { uniforms: { image, channel: field.channel } } }; calls.primitives.push(p); return p; },
    particlesFactory: () => particles,
    timelineFactory: () => timeline,
    pointsFactory: () => ({ fake: 'points' }),
    hoverFactory: () => ({ show() {}, update() {}, hide() {}, destroy() {}, isHovered: () => false, current: () => null }),
    ...(isolineFactory ? { isolineFactory } : {}),
    ...(gridReader ? { gridReader } : {}),
    doc,
    win,
  });
  const viewer = { container: {}, scene: { primitives: { add() {}, remove() {} } } };
  return { layer, viewer, calls, timeline };
}

test('enable: katalóg → os so 3 krokmi, rez vetra načítaný, drapéria + častice zapnuté, podklad vyžiadaný (Blue Marble) a pri vypnutí vrátený', async () => {
  _resetActiveMapStackForTest();
  setActiveMapStack({ id: 'photoreal' });
  const { layer, viewer, calls, timeline } = harness();
  layer.init(viewer);
  layer.enable();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.fetch[0], '/api/meteo/catalog');
  assert.ok(calls.fetch.some((u) => u.endsWith('natural_earth/places.json')), 'mestá pre popisky sa načítajú raz');
  assert.equal(timeline.steps.length, 3);
  assert.equal(timeline.shown, true);
  // Jazyk v Node je EN (i18n default), v prehliadači SK — test berie oba.
  assert.match(timeline.run, /GFS 0[,.]25° · (beh|run) 08[./]09\.? 12Z/);
  assert.ok(calls.images.some((u) => u.includes('var=wind&time=2026-09-08T18')));
  assert.equal(calls.primitives.length, 1);
  assert.equal(calls.primitives[0].primitive.show, true);
  assert.ok(calls.particles.some((c) => c[0] === 'setWind' && c[1] === -60));
  assert.ok(calls.particles.some((c) => c[0] === 'start'));
  assert.deepEqual(calls.events[0], { id: METEO_BASEMAP_ID, reason: 'meteo' });
  assert.match(layer.source, /NOAA\/NCEP GFS 0[,.]25° · (beh|run) 08[./]09\.? 12Z · NSF Unidata THREDDS · (PREDPOVEĎ|FORECAST)/);
  assert.equal(layer.getStats().count, 3);
  // prednačítanie ďalších krokov
  assert.ok(calls.images.some((u) => u.includes('time=2026-09-08T21')));
  setActiveMapStack({ id: METEO_BASEMAP_ID });
  layer.disable();
  assert.equal(calls.primitives[0].primitive.show, false);
  assert.ok(calls.particles.some((c) => c[0] === 'stop'));
  assert.deepEqual(calls.events.at(-1), { id: 'photoreal', reason: 'meteo-restore' });
  assert.equal(timeline.shown, false);
  _resetActiveMapStackForTest();
});

test('čipy: TEPLOTA prepne pole (kanál R, rez temp), ČASTICE vypne častice; legenda je rampa; chyba rezu = poctivý stav', async () => {
  _resetActiveMapStackForTest();
  setActiveMapStack({ id: 'osm' });
  const { layer, viewer, calls, timeline } = harness();
  layer.init(viewer);
  layer.enable();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.events.length, 0, 'na OSM sa podklad nemení');
  const controls = layer.getRowControls();
  assert.deepEqual(controls.chips.map((c) => [c.id, c.active]), [['field-wind', true], ['field-temp', false], ['field-pressure', false], ['field-precip', false], ['field-clouds', false], ['field-gust', false], ['particles', true]]);
  assert.equal(controls.legend[0].label, '0 m/s');
  assert.equal(layer.setParams({ field: 'temp' }), true);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(calls.images.some((u) => u.includes('var=temp&time=2026-09-08T18')));
  assert.equal(calls.primitives[0].material.uniforms.channel, 0);
  assert.equal(layer.getRowControls().legend[0].label, '-40 °C');
  layer.setParams({ particles: false });
  assert.ok(calls.particles.some((c) => c[0] === 'stop'));
  assert.deepEqual(layer.getParams(), { field: 'temp', particles: false });
  // zlyhanie rezu
  const bad = harness({ imageOk: false });
  bad.layer.init(bad.viewer);
  bad.layer.enable();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(bad.calls.primitives.length, 0);
  assert.match(bad.timeline.status, /pole nedostupné|field unavailable/);
  assert.match(String(bad.layer.getStats().error), /pole nedostupné|field unavailable/);
  _resetActiveMapStackForTest();
});

test('materiál: fabric číta kanál, dekóduje rozsah a mapuje na rampu; tripwire registra ("6"), main.js, proxy a CSS', () => {
  const fabric = fieldMaterialFabric();
  assert.equal(fabric.type, 'OkoMeteoField');
  assert.match(fabric.source, /float raw = channel < 0\.5 \? px\.r : \(channel < 1\.5 \? px\.g : px\.b\);/);
  assert.match(fabric.source, /texture\(ramp, vec2\(u, 0\.5\)\)/);
  // Google 3D (2026-09-09 „google zle zobrazuje vrstvy"): pole 10 km nad elipsoidom, bez hĺbkového
  // testu (terén fotoreálu ho prerážal) a s orezaním zadných stien (druhá pologuľa nepresvitá).
  const layerSrc = readFileSync(new URL('./meteoLayer.js', import.meta.url), 'utf8');
  assert.match(layerSrc, /export const METEO_DRAPE_HEIGHT_M = 10_000;/);
  assert.match(layerSrc, /depthTest: \{ enabled: false \},\s*depthMask: false,\s*cull: \{ enabled: true, face: Cesium\.CullFace\.BACK \},/);
  assert.match(layerSrc, /export const METEO_FADE_OUT_HEIGHT_M = 12_000;/, 'útlm pod drapériou');
  const registry = readFileSync(new URL('./layerState.js', import.meta.url), 'utf8');
  assert.match(registry, /\{ id: 'meteo-gfs', token: '6', disposition: 'enabled-only' \}/);
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /dataManager\.register\(meteoLayer\);/);
  assert.match(main, /window\.addEventListener\('gev:request-map-stack'/);
  const vite = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
  assert.match(vite, /function meteoProxy\(\)/);
  assert.match(vite, /thredds\.ucar\.edu\/thredds\/ncss\/grid\/grib\/NCEP\/GFS\/Global_0p25deg\/Best/);
  assert.match(vite, /accept=netcdf/);
  assert.match(vite, /const RATE_PER_HOUR = 60;/);
  assert.match(vite, /middlewares\.use\('\/api\/meteo'/);
  assert.ok(vite.slice(vite.indexOf('    plugins: [')).includes('meteoProxy(),'));
  const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.wind-particles-canvas \{[\s\S]*?z-index: 4;/);
  assert.match(css, /\.meteo-timeline \{[\s\S]*?position: fixed;/);
  assert.equal(METEO_LAYER_ID, 'meteo-gfs');
});

test('fáza polia: TLAK → izobary (mriežka z obrázka → marching squares → továreň), iné pole ich zruší; zrážky majú alfu 0 bez javu', async () => {
  _resetActiveMapStackForTest();
  setActiveMapStack({ id: 'osm' });
  const isoCalls = [];
  const removed = [];
  // 1440×721 by bolo pomalé: čítačka vráti malý vrch 41×41 (rovnaký ako v meteoIsolines.test).
  const gridReader = () => { const cols = 41, rows = 41; const values = new Float32Array(cols * rows); for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) { const dx = (c - 20) / 8, dy = (r - 20) / 8; values[r * cols + c] = 1000 + 30 * Math.exp(-(dx * dx + dy * dy)); } return { values, cols, rows }; };
  const { layer, viewer, calls } = harness({ gridReader, isolineFactory: (lines, field) => { isoCalls.push([lines.length, field.id, lines[0]?.level]); return { id: isoCalls.length }; } });
  viewer.scene.primitives.remove = (x) => removed.push(x);
  layer.init(viewer);
  layer.enable();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(isoCalls.length, 0, 'vietor bez izočiar');
  layer.setParams({ field: 'pressure' });
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(calls.images.some((u) => u.includes('var=pressure')));
  assert.equal(isoCalls.length, 1);
  assert.ok(isoCalls[0][0] > 3, 'niekoľko izobar');
  assert.equal(isoCalls[0][1], 'pressure');
  assert.equal(calls.primitives[0].material.uniforms.alpha, 0.78, 'alfa podľa poľa');
  layer.setParams({ field: 'precip' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(removed.length, 1, 'izobary odstránené pri zmene poľa');
  assert.equal(calls.primitives[0].material.uniforms.alpha, 0.96);
  layer.disable();
  _resetActiveMapStackForTest();
});

test('plynulé prehrávanie (Windy): mixT a častice idú spojito 0→1 medzi krokmi, potom sa krok prepne; ďalší krok sa v materiáli aj časticiach načíta vopred', async () => {
  _resetActiveMapStackForTest();
  setActiveMapStack({ id: 'osm' });
  const frames = [];
  const calls = { particles: [], primitives: [] };
  let onPlay = null;
  const timeline = { index: 0, setSteps() {}, setIndex(i) { this.index = i; }, getIndex() { return this.index; }, setPlaying() {}, isPlaying: () => false, setStatus() {}, show() {}, hide() {}, destroy() {} };
  const layer = createMeteoLayer({
    fetchImpl: async () => ({ ok: true, json: async () => ({ model: 'GFS', run: '2026-09-08T12:00:00Z', steps: ['2026-09-08T18:00:00Z', '2026-09-08T21:00:00Z', '2026-09-09T00:00:00Z'], attribution: '', stale: false }) }),
    imageLoader: async (url) => ({ src: url }),
    primitiveFactory: ({ image, imageNext, field }) => { const p = { primitive: { show: false }, material: { uniforms: { image, imageNext, mixT: 0, channel: field.channel } } }; calls.primitives.push(p); return p; },
    particlesFactory: () => ({ isSupported: () => true, setWind: (i, r) => calls.particles.push(['setWind', Boolean(r.next), r.clear]), setMix: (f) => calls.particles.push(['setMix', Number(f.toFixed(2))]), setRamp() {}, start() {}, stop() {}, destroy() {} }),
    timelineFactory: (doc, opts) => { onPlay = opts.onPlay; return timeline; },
    pointsFactory: () => ({ fake: 'points' }),
    hoverFactory: () => ({ show() {}, update() {}, hide() {}, destroy() {}, isHovered: () => false, current: () => null }),
    doc: fakeDoc(), win: { dispatchEvent() {} },
    requestFrame: (cb) => { frames.push(cb); return frames.length; },
    cancelFrame: () => {},
  });
  layer.init({ container: {}, scene: { primitives: { add() {}, remove() {} } } });
  layer.enable();
  await new Promise((r) => setTimeout(r, 10));
  const drape = calls.primitives.at(-1);
  assert.ok(drape.material.uniforms.imageNext.src.includes('time=2026-09-08T21'), 'ďalší krok je v materiáli');
  assert.deepEqual(calls.particles.find((c) => c[0] === 'setWind'), ['setWind', true, true], 'častice dostali ďalší krok; prvé nastavenie stopy zmaže');
  // play: tick po 1 200 ms = polovica kroku (METEO_PLAY_STEP_MS 2 400)
  onPlay(true);
  const tick = () => { const cb = frames.pop(); frames.length = 0; return cb; };
  // dt na snímok je zhora obmedzené na 100 ms (skok karty nezrýchli čas): 12 × 100 ms = 1 200 ms ≈ polovica kroku
  let now = 1000;
  tick()(now);           // prvý snímok: dt 16 ms
  for (let i = 0; i < 12; i += 1) { now += 100; tick()(now); }
  const f = layer._getStateForTest().fraction;
  assert.ok(f > 0.5 && f < 0.52, `podiel ~0,5: ${f}`);
  assert.ok(Math.abs(drape.material.uniforms.mixT - f) < 1e-9, 'mixT drapérie = podiel');
  assert.equal(calls.particles.at(-1)[0], 'setMix');
  for (let i = 0; i < 14; i += 1) { now += 100; tick()(now); }
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(layer._getStateForTest().index, 1, 'po 1,0 sa krok prepol');
  assert.equal(timeline.index, 1);
  const lastWind = calls.particles.filter((c) => c[0] === 'setWind').at(-1);
  assert.equal(lastWind[2], false, 'pri prehrávaní sa stopy nemažú (spojitý vietor)');
  onPlay(false);
  assert.equal(layer._getStateForTest().fraction, 0);
  layer.disable();
  _resetActiveMapStackForTest();
});
