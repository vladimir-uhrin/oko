import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  createEarthquakePulse, earthquakePulseStyle, earthquakeRippleMaxRadius, earthquakeFeltRadiusM,
  tangentScreenMatrix, EARTHQUAKE_PULSE_CSS, EARTHQUAKE_PULSE_RINGS,
} from './earthquakePulse.js';
import { createEarthquakesLayer } from './earthquakes.js';

const time = Date.parse('2026-09-05T12:00:00Z');
function record(id, x = 100, y = 100, mag = 5) {
  return { event: { id: String(id), mag, time, depth: 12 }, position: { x, y, z: 50 } };
}
function harness() {
  class Element {
    children = []; dataset = {}; style = { setProperty(key, value) { this[key] = value; } };
    appendChild(child) { this.children.push(child); child.parentElement = this; }
    setAttribute() {}
    remove() { this.parentElement.children = this.parentElement.children.filter(c => c !== this); }
  }
  const parent = new Element(); const listeners = new Map(); let callback; let removed = 0;
  const doc = { hidden: false, createElement: () => new Element(),
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const scene = { mode: Cesium.SceneMode.SCENE3D, canvas: { parentElement: parent, clientWidth: 1600, clientHeight: 1000 },
    camera: {}, postRender: { addEventListener(fn) { callback = fn; return () => { removed++; }; } } };
  const pulse = createEarthquakePulse({ scene }, { document: doc, now: () => time,
    project: (_, position) => ({ x: position.x, y: position.y }), occluder: () => ({ isPointVisible: p => !p.farSide }) });
  return { pulse, scene, doc, parent, listeners, tick: () => callback(), get removed() { return removed; },
    get root() { return parent.children[0]; }, get nodes() { return parent.children[0].children.slice(1); } };
}

test('pulz: svetový polomer rastie s magnitúdou (zdvojnásobenie/stupeň), s podlahou a stropom', () => {
  assert.equal(earthquakeRippleMaxRadius(3), 6000, 'M3 na podlahe');
  assert.equal(earthquakeRippleMaxRadius(4), 8000);
  assert.equal(earthquakeRippleMaxRadius(5), 16000);
  assert.equal(earthquakeRippleMaxRadius(7), 64000);
  assert.ok(earthquakeRippleMaxRadius(9) <= 500000, 'strop');
  assert.ok(earthquakeRippleMaxRadius(5) > earthquakeRippleMaxRadius(4), 'monotónne');
  assert.equal(earthquakeRippleMaxRadius(NaN), 6000, 'nefinitná = podlaha');
});

test('pulz: štýl — farba podľa hĺbky, opacity slabne s vekom, stale je tlmené', () => {
  const event = record('USGS:123').event;
  const fresh = earthquakePulseStyle(event, time);
  // M5 >= 4.5 → vlna sa rozbieha po citeľný dosah (nie kompaktný ripple).
  assert.equal(fresh.maxRadius, earthquakeFeltRadiusM(5));
  assert.equal(earthquakePulseStyle({ ...event, mag: 3 }, time).maxRadius, earthquakeRippleMaxRadius(3), 'slabé ostávajú kompaktné');
  assert.equal(fresh.opacity, 1);
  assert.deepEqual(earthquakePulseStyle(event, time), fresh, 'deterministické');
  assert.ok(fresh.delay <= 0 && fresh.delay > -4.2);
  assert.equal(fresh.color, '#ff6859', 'plytké = červené');
  assert.equal(earthquakePulseStyle({ ...event, depth: 100 }, time).color, '#ffad56');
  assert.equal(earthquakePulseStyle({ ...event, depth: 400 }, time).color, '#ffe08a');
  assert.equal(earthquakePulseStyle({ ...event, depth: null }, time).color, '#a6b1be');
  assert.ok(earthquakePulseStyle(event, time + 86400000).opacity < .5, 'staršie tichšie');
  assert.equal(earthquakePulseStyle({ ...event, stale: true }, time).color, '#a6b1be');
});

test('pulz: dotyková matica — top-down kruh, sklon skosí do elipsy, degenerácia = malý kruh', () => {
  // Zhora: východ aj sever majú rovnakú dĺžku na obrazovke a sú kolmé → kruh.
  const topDown = tangentScreenMatrix({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 });
  assert.ok(Math.abs(topDown.a - 1) < 1e-6 && Math.abs(topDown.d - 1) < 1e-6);
  assert.ok(Math.abs(topDown.b) < 1e-6 && Math.abs(topDown.c) < 1e-6);
  // Sklon: sever sa na obrazovke skráti (foreshortening) → |d os| < |a os|.
  const tilted = tangentScreenMatrix({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 40 });
  const axU = Math.hypot(tilted.a, tilted.b), axV = Math.hypot(tilted.c, tilted.d);
  assert.ok(axV < axU, 'skosená elipsa leží na guli');
  // Strop: obrovský polomer na obrazovke sa oreže, pomer skosenia ostáva.
  const clamped = tangentScreenMatrix({ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 0, y: 2000 }, { maxPx: 260 });
  assert.ok(Math.hypot(clamped.a, clamped.b) * 100 <= 260 + 1e-6, 'orezané na strop');
  assert.ok(Math.abs(Math.hypot(clamped.c, clamped.d) / Math.hypot(clamped.a, clamped.b) - 0.5) < 1e-6, 'pomer 2:1 zachovaný');
  // Degenerácia: chýbajúca projekcia → malý izotropný kruh, nie NaN.
  const degen = tangentScreenMatrix({ x: 0, y: 0 }, null, { x: 0, y: 100 });
  assert.ok(Number.isFinite(degen.a) && degen.a > 0 && degen.b === 0 && degen.c === 0);
  assert.match(EARTHQUAKE_PULSE_CSS, /prefers-reduced-motion:reduce/);
  assert.match(EARTHQUAKE_PULSE_CSS, /data-stale="true"[^}]+animation:none/);
});

test('pulz: DOM — uzol má rovinu s dvoma prstencami + jadro, matica v rovine, čistí sa', () => {
  const h = harness();
  h.pulse.setVisible(true);
  h.pulse.setEvents([record('a', 200, 200, 6), record('b', 800, 400, 4)]);
  h.tick();
  assert.equal(h.nodes.length, 2);
  const node = h.nodes[0];
  const plane = node.children[0];
  assert.equal(plane.className, 'quake-plane');
  const pings = plane.children.filter((c) => String(c.className).includes('quake-ping'));
  assert.equal(pings.length, EARTHQUAKE_PULSE_RINGS, 'štyri fázovo posunuté prstence (pekný pulzar)');
  assert.equal(EARTHQUAKE_PULSE_RINGS, 4);
  assert.ok(plane.children.some((c) => c.className === 'quake-halo'), 'jemný halo');
  assert.equal(node.children[1].className, 'quake-core', 'jadro mimo roviny, ostáva okrúhle');
  assert.match(EARTHQUAKE_PULSE_CSS, /\.quake-ping-4/, 'štvrtá línia je v CSS');
  assert.match(String(plane.style.transform), /^matrix\(/, 'rovina nesie maticu dotykovej roviny');
  assert.match(String(node.style.transform), /^translate\(/);
  // Zmena množiny odstráni staré uzly.
  h.pulse.setEvents([record('a', 200, 200, 6)]);
  h.tick();
  assert.equal(h.nodes.length, 1);
  // Skrytie schová koreň bez pádu.
  h.pulse.setVisible(false); h.tick();
  assert.equal(h.root.hidden, true);
  h.pulse.destroy();
  assert.equal(h.removed, 1);
});

test('pulz: hitTest vráti ohnisko pod kurzorom, vrstva doňho posiela pripravené záznamy', () => {
  const h = harness();
  h.pulse.setVisible(true);
  h.pulse.setEvents([record('near', 500, 500, 5)]);
  h.tick();
  assert.equal(h.pulse.hitTest(504, 498), 'near');
  assert.equal(h.pulse.hitTest(700, 700), null);
  // kontrakt s vrstvou: createEarthquakesLayer existuje a pulz je jej súčasť
  assert.equal(typeof createEarthquakesLayer, 'function');
});

test('pulz: dosah otrasov — polomer rastie s magnitúdou, prah M4.5, odhad nie ShakeMap', async () => {
  const { earthquakeFeltRadiusM, EARTHQUAKE_FELT_MIN_MAG } = await import('./earthquakePulse.js');
  assert.equal(EARTHQUAKE_FELT_MIN_MAG, 4.5);
  assert.equal(Math.round(earthquakeFeltRadiusM(4.5) / 1000), 105);
  assert.equal(Math.round(earthquakeFeltRadiusM(5) / 1000), 148);
  assert.equal(Math.round(earthquakeFeltRadiusM(6) / 1000), 297);
  assert.equal(Math.round(earthquakeFeltRadiusM(7) / 1000), 594);
  assert.ok(earthquakeFeltRadiusM(8) <= 2_000_000, 'strop');
  assert.ok(earthquakeFeltRadiusM(6) > earthquakeFeltRadiusM(5), 'monotónne');
  assert.equal(earthquakeFeltRadiusM(NaN), 30000, 'podlaha');
  // Citeľný dosah je vždy väčší než symbolický disk (2^mag*1000).
  assert.ok(earthquakeFeltRadiusM(6) > Math.pow(2, 6) * 1000);
  // Vrstva kreslí prstenec do vlastného dataSource a v detaile má riadok.
  const src = readFileSync(new URL('./earthquakes.js', import.meta.url), 'utf8');
  assert.match(src, /new Cesium\.CustomDataSource\('earthquake-felt'\)/);
  assert.match(src, /event\.mag < EARTHQUAKE_FELT_MIN_MAG/, 'len významné otrasy');
  assert.match(src, /t\('quake\.felt'/, 'detail nesie odhad dosahu');
  assert.doesNotMatch(src.slice(src.indexOf('earthquake-felt')), /CallbackProperty/, 'felt kruh je statický (výkonový pin)');
});
