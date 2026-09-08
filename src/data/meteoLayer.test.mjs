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

function harness({ catalog = { model: 'GFS 0.25°', run: '2026-09-08T12:00:00Z', steps: ['2026-09-08T18:00:00Z', '2026-09-08T21:00:00Z', '2026-09-09T00:00:00Z'], attribution: 'x', stale: false }, imageOk = true } = {}) {
  const calls = { fetch: [], images: [], particles: [], events: [], primitives: [] };
  const doc = fakeDoc();
  const win = { dispatchEvent(e) { calls.events.push(e.detail); } };
  const particles = {
    isSupported: () => true,
    setWind: (img, r) => calls.particles.push(['setWind', r.uRange[0]]),
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
  assert.deepEqual(calls.fetch, ['/api/meteo/catalog']);
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
  assert.deepEqual(controls.chips.map((c) => [c.id, c.active]), [['field-wind', true], ['field-temp', false], ['particles', true]]);
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
