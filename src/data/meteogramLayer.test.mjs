// src/data/meteogramLayer.test.mjs
// Meteogram vo vrstve počasia (2026-10-08): klik bez ťahania do prázdneho miesta otvorí predpoveď
// pre bod, ťahanie a objekty iných vrstiev nie, klik na stĺpec posunie mapu, vypnutie zavrie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createMeteoLayer } from './meteoLayer.js';
import { _resetActiveMapStackForTest, setActiveMapStack } from './activeMapStack.js';

const CATALOG = { model: 'GFS 0.25°', run: '2026-10-08T00:00:00Z', steps: ['2026-10-08T03:00:00Z', '2026-10-08T06:00:00Z', '2026-10-08T09:00:00Z'], attribution: 'x', stale: false };
const T0 = Date.parse('2026-10-08T00:00:00Z');
const SERIES = {
  model: 'GFS 0.25°', lat: 48.1, lon: 17.1, elevation: 140, utcOffsetSec: 7200,
  times: Array.from({ length: 24 }, (_, i) => T0 + i * 3600_000),
  temp: Array.from({ length: 24 }, (_, i) => 10 + i),
  precip: Array(24).fill(0), clouds: Array(24).fill(40), wind: Array(24).fill(3), windDir: Array(24).fill(200), gust: Array(24).fill(6), pressure: Array(24).fill(1013),
};

function fakeDoc() {
  const el = () => ({ className: '', children: [], hidden: false, dataset: {}, style: {}, attrs: {},
    getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }),
    appendChild(c) { this.children.push(c); return c; }, append(...c) { this.children.push(...c); }, replaceChildren(...c) { this.children = c; },
    addEventListener() {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() {}, classList: { toggle() {} } });
  return { body: { appendChild() {} }, createElement: el };
}

function harness({ pick = () => undefined, pointOk = true, nowMs = T0 + 4 * 3600_000 } = {}) {
  const fetches = [];
  const drapes = [];
  const gram = { calls: [], open: false };
  const panel = {
    showLoading(name) { gram.calls.push(['loading', name]); gram.open = true; },
    showModel(m) { gram.calls.push(['model', m.columns.length, m.columns[0].t]); gram.open = true; },
    showError(name) { gram.calls.push(['error', name]); gram.open = true; },
    setActiveTime(iso) { gram.active = iso; },
    hide() { gram.open = false; },
    isOpen: () => gram.open,
    destroy() {},
  };
  let factoryArgs = null;
  let timelineArgs = null;
  const timeline = { index: 0, steps: [], run: '', status: '', setSteps(list, run) { this.steps = list; this.run = run; }, setIndex(i) { this.index = i; }, setStatus(st) { this.status = st; }, getIndex() { return this.index; }, setPlaying(p) { this.playing = p; }, isPlaying() { return Boolean(this.playing); }, show() {}, hide() {}, destroy() {} };
  const listeners = {};
  const primitives = new Set();
  const canvas = {
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
  const viewer = {
    container: {},
    scene: {
      canvas,
      primitives: { add(p) { primitives.add(p); return p; }, remove(p) { primitives.delete(p); } },
      pick: (pos, w, h) => pick(pos, w, h),
      globe: { ellipsoid: Cesium.Ellipsoid.WGS84 },
      camera: { pickEllipsoid: () => Cesium.Cartesian3.fromDegrees(17.12, 48.14) },
    },
    camera: { moveStart: { addEventListener: () => () => {} } },
  };
  const layer = createMeteoLayer({
    fetchImpl: async (url) => {
      fetches.push(url);
      if (url.startsWith('/api/meteo/point')) return pointOk ? { ok: true, json: async () => SERIES } : { ok: false, status: 502, json: async () => ({}) };
      return { ok: true, json: async () => CATALOG };
    },
    imageLoader: async (url) => ({ src: url }),
    primitiveFactory: ({ image, field }) => { const d = { primitive: { show: false }, material: { uniforms: { image, channel: field.channel } } }; drapes.push(d); return d; },
    particlesFactory: () => ({ isSupported: () => true, setWind() {}, setMix() {}, setRamp() {}, start() {}, stop() {}, destroy() {} }),
    timelineFactory: (d, args) => { timelineArgs = args; return timeline; },
    pointsFactory: () => ({ fake: 'points' }),
    hoverFactory: () => ({ show() {}, update() {}, hide() {}, destroy() {}, isHovered: () => false }),
    meteogramFactory: (doc, args) => { factoryArgs = args; return panel; },
    markerFactory: () => ({ marker: true }),
    mapDataLoader: async () => ({ coast: [], borders: [] }),
    now: () => nowMs,
    doc: fakeDoc(),
    win: { dispatchEvent() {} },
  });
  const fire = (type, x, y, extra = {}) => { for (const fn of listeners[type] || []) fn({ clientX: x, clientY: y, button: 0, pointerType: 'mouse', ...extra }); };
  const click = (x = 100, y = 100, moveTo = null) => { fire('pointerdown', x, y); const [ux, uy] = moveTo || [x, y]; fire('pointerup', ux, uy); };
  return { layer, viewer, fetches, gram, timeline, click, primitives, drapes, factoryArgs: () => factoryArgs, timelineArgs: () => timelineArgs };
}

const settle = () => new Promise((r) => setTimeout(r, 15));

async function enabled(opts) {
  const presence = await import('./radarPresence.js');
  presence._resetRadarPresenceForTest();
  _resetActiveMapStackForTest();
  setActiveMapStack({ id: 'photoreal' });
  const h = harness(opts);
  h.layer.init(h.viewer);
  h.layer.enable();
  await settle();
  return h;
}

test('klik do prázdneho miesta otvorí meteogram pre bod, so značkou na mape', async () => {
  const h = await enabled();
  h.click();
  await settle();
  const point = h.fetches.find((u) => u.startsWith('/api/meteo/point'));
  assert.ok(point, 'pýta predpoveď pre bod');
  const q = new URL(point, 'http://x').searchParams;
  assert.equal(Number(q.get('lat')).toFixed(2), '48.14');
  assert.equal(Number(q.get('lon')).toFixed(2), '17.12');
  assert.equal(h.gram.calls[0][0], 'loading');
  assert.deepEqual(h.gram.calls[1], ['model', 7, T0 + 3 * 3600_000]); // od 03Z (najbližšie k 04Z), 24 h / 3 = 7 stĺpcov
  assert.equal(h.gram.active, CATALOG.steps[0]);
  const state = h.layer._getStateForTest();
  assert.equal(state.marker, true);
  assert.ok(state.meteogram);
});

test('ťahanie mapy meteogram neotvorí', async () => {
  const h = await enabled();
  h.click(100, 100, [140, 100]);
  await settle();
  assert.equal(h.fetches.some((u) => u.startsWith('/api/meteo/point')), false);
  assert.equal(h.gram.calls.length, 0);
});

test('lietadlo, loď… v okolí kliku má prednosť; bodka mesta meteogram otvorí', async () => {
  let picked = 'a1b2c3';
  let size = null;
  const h = await enabled({ pick: (pos, w) => { size = w; return picked ? { id: picked } : undefined; } });
  h.click();
  await settle();
  assert.equal(h.gram.calls.length, 0);
  assert.ok(size >= 9, 'pick v okolí aspoň 9 px (lietadlá berú 6 px)');
  picked = 'place:12';
  h.click();
  await settle();
  assert.equal(h.gram.calls[0][0], 'loading');
});

test('klik na stĺpec posunie mapu na ten krok; vypnutie vrstvy meteogram zavrie a značku zmaže', async () => {
  const h = await enabled();
  h.click();
  await settle();
  h.factoryArgs().onPickTime(Date.parse(CATALOG.steps[2]));
  assert.equal(h.timeline.index, 2);
  h.factoryArgs().onPickTime(Date.parse('2026-10-20T00:00:00Z')); // mimo osi — nič
  assert.equal(h.timeline.index, 2);
  h.layer.disable();
  assert.equal(h.gram.open, false);
  assert.equal(h.layer._getStateForTest().marker, false);
});

test('chyba servera ukáže v páse „nedostupné", nie prázdnu tabuľku', async () => {
  const h = await enabled({ pointOk: false });
  const warn = console.warn; console.warn = () => {};
  try {
    h.click();
    await settle();
  } finally { console.warn = warn; }
  assert.equal(h.gram.calls[0][0], 'loading');
  assert.equal(h.gram.calls[1][0], 'error');
});

test('zapnutý radar nahradí farebné pole (ako Windy), po vypnutí sa pole vráti; radar sa hlási sám', async () => {
  const { anyRadarActive, isMeteoFieldVisible, _resetRadarPresenceForTest } = await import('./radarPresence.js');
  const { createShmuRadarLayer } = await import('./shmuRadar.js');
  _resetRadarPresenceForTest(); // pred init meteo vrstvy — tá sa v init prihlási za poslucháča
  const h = await enabled();
  const drape = h.drapes.at(-1);
  assert.ok(drape, 'pole je nakreslené');
  assert.equal(drape.primitive.show, true);
  const radar = createShmuRadarLayer({ id: 'opera-radar', fetchImpl: async () => ({ ok: false, status: 503 }) });
  radar.init({ scene: { primitives: { add() {}, remove() {} } } });
  radar.enable();
  assert.equal(anyRadarActive(), true);
  assert.equal(drape.primitive.show, false, 'radar pole skryl');
  assert.equal(isMeteoFieldVisible(), false, 'výstrahy a stanice vedia, že pole nie je — idú k zemi');
  radar.disable();
  assert.equal(anyRadarActive(), false);
  assert.equal(drape.primitive.show, true, 'po vypnutí radaru sa pole vráti');
  assert.equal(isMeteoFieldVisible(), true);
  radar.destroy();
  h.layer.disable();
});

test('os začína krokom najbližším k „teraz“, kým si používateľ nevyberie sám', async () => {
  const { nearestStepIndex } = await import('./meteoLayer.js');
  assert.equal(nearestStepIndex(CATALOG.steps, Date.parse('2026-10-08T08:10:00Z')), 2);
  assert.equal(nearestStepIndex(CATALOG.steps, Date.parse('2026-10-08T00:00:00Z')), 0);
  const h = await enabled({ nowMs: Date.parse('2026-10-08T08:10:00Z') });
  assert.equal(h.timeline.index, 2, '09Z je najbližšie k 08:10');
  h.timelineArgs().onIndex(0);
  await h.layer.update();
  assert.equal(h.timeline.index, 0, 'zvolený krok nový katalóg neprepíše');
});

test('pri zapnutom radare os ukazuje jeho snímky (meranie) a posúvanie ovláda radar; po vypnutí sa vráti predpoveď', async () => {
  const { createShmuRadarLayer, radarTimelineSteps } = await Promise.all([import('./shmuRadar.js'), import('./meteoLayer.js')]).then(([a, b]) => ({ ...a, ...b }));
  assert.deepEqual(radarTimelineSteps(['2026-10-08T19:40:00Z', '2026-10-08T19:50:00Z'], 'sk').map((x) => x.label), ['Št 8. 10. 19:40 UTC', 'Št 8. 10. 19:50 UTC']);
  const h = await enabled();
  const frames = ['2026-10-08T19:30:00.000Z', '2026-10-08T19:40:00.000Z', '2026-10-08T19:50:00.000Z'];
  const shown = [];
  const radar = createShmuRadarLayer({
    id: 'opera-radar', name: 'Radar EÚ', fadeMs: 0, // prelínanie overuje shmuRadarFade.test.mjs
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, iso: frames[2], png: '/p.png', bounds: { west: -40, south: 31, east: 58, north: 74 }, frames: frames.map((iso) => ({ iso, png: '/' + iso })) }) }),
    primitiveFactory: () => { const p = { show: false }; shown.push(p); return p; },
  });
  radar.init({ scene: { primitives: { add() {}, remove() {} } } });
  radar.enable();
  await radar.update();
  assert.equal(h.timeline.steps.length, 3, 'os má snímky radaru');
  assert.match(h.timeline.run, /Radar EÚ/);
  assert.match(h.timeline.status, /RADAR/);
  assert.equal(h.timeline.playing, true, 'slučka radaru beží — tlačidlo prehrávania to ukazuje');
  h.timelineArgs().onIndex(1);
  assert.equal(h.timeline.playing, false, 'posúvanie slučku zastavilo');
  assert.equal(shown.filter((p) => p.show).length, 1);
  assert.equal(shown[1].show, true, 'posúvanie zobrazilo snímku 19:40');
  radar.disable();
  assert.equal(h.timeline.steps.length, CATALOG.steps.length, 'po vypnutí radaru je na osi znova predpoveď');
  assert.doesNotMatch(h.timeline.status, /RADAR/);
  radar.destroy();
  h.layer.disable();
});

test('os radaru: rozpätie podľa snímok a značky času sa neprekrývajú (padne aj posledná)', async () => {
  const { radarSpanLabel, radarTimelineSteps } = await import('./meteoLayer.js');
  const frames = Array.from({ length: 12 }, (_, i) => new Date(Date.parse('2026-10-09T09:00:00Z') + i * 600_000).toISOString());
  assert.equal(radarSpanLabel(frames), '2\u00a0h');
  assert.equal(radarSpanLabel(frames.slice(0, 5)), '50\u00a0min');
  const ticks = radarTimelineSteps(frames, 'sk').map((s) => s.day);
  assert.equal(ticks.at(-1), '10:50');
  assert.equal(ticks.at(-2), '', 'predposledná bez značky — inak „10:5011:00“');
  assert.equal(ticks.filter(Boolean).length, 6);
});
