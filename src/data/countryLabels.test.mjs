// src/data/countryLabels.test.mjs — názvy štátov pri priblížení (2026-10-16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cameraZoomLevel, createCountryLabels, displayName, labelVisible, spaced } from './countryLabels.js';
import { ZOOM_BORDERS_SHOW_BELOW_M } from './zoomBorders.js';

const rad = (deg) => (deg * Math.PI) / 180;

test('úroveň priblíženia z výšky kamery: prah hraníc (5 000 km nad Slovenskom) ≈ 4 = MIN_LABEL Slovenska; zemeguľa ≈ 2; mesto ≈ 8', () => {
  const atBorders = cameraZoomLevel(ZOOM_BORDERS_SHOW_BELOW_M, rad(48.7));
  assert.ok(atBorders > 3.6 && atBorders < 4.4, `prah hraníc ${atBorders.toFixed(2)}`);
  const globe = cameraZoomLevel(20_000_000, rad(48.7));
  assert.ok(globe > 1.5 && globe < 2.5, `zemeguľa ${globe.toFixed(2)}`);
  const city = cameraZoomLevel(260_000, rad(48.7));
  assert.ok(city > 8 && city < 9, `mesto ${city.toFixed(2)}`);
  assert.ok(cameraZoomLevel(1_000_000, rad(0)) > cameraZoomLevel(1_000_000, rad(60)), 'pri rovníku je záber širší v metroch, úroveň vyššia');
  assert.equal(cameraZoomLevel(0), 0);
  assert.equal(cameraZoomLevel(NaN), 0);
});

test('viditeľnosť popisky: medzi MIN_LABEL a MAX_LABEL (Slovensko 4–9: pri 5 000 km áno, nad zemeguľou nie, pri 50 km nie)', () => {
  const sk = { minLabel: 4, maxLabel: 9 };
  assert.equal(labelVisible(sk, 4.0), true);
  assert.equal(labelVisible(sk, 2.0), false);
  assert.equal(labelVisible(sk, 9.5), false);
  assert.equal(labelVisible({}, 5), true, 'bez úrovní vždy');
  const de = { minLabel: 1.7, maxLabel: 6.7 };
  assert.equal(labelVisible(de, 2.0), true, 'Nemecko už nad zemeguľou');
  const va = { minLabel: 5, maxLabel: 10, tiny: 4 };
  assert.equal(labelVisible(va, 5.2), false, 'mikroštát pri pohľade na Európu ešte nie');
  assert.equal(labelVisible(va, 6.2), true, 'o úroveň neskôr áno');
});

test('meno štátu: Intl.DisplayNames v jazyku, záloha anglické meno, neznámy kód ostáva kódom', () => {
  const DN = class { constructor(langs) { this.lang = langs[0]; } of(code) { if (code === 'ZZ') throw new RangeError('x'); if (code === 'XK') return 'XK'; return `${this.lang}:${code}`; } };
  assert.equal(displayName('SK', 'sk', { DisplayNames: DN }), 'sk:SK');
  assert.equal(displayName('XK', 'sk', { DisplayNames: DN, fallback: 'Kosovo' }), 'Kosovo', 'kód vrátený ako kód = záloha');
  assert.equal(displayName('ZZ', 'sk', { DisplayNames: DN, fallback: 'Nikde' }), 'Nikde', 'výnimka = záloha');
  assert.equal(displayName('ZZ', 'sk', { DisplayNames: DN }), 'ZZ');
  assert.equal(displayName('SK', 'sk', { DisplayNames: null, fallback: 'Slovakia' }), 'Slovakia', 'bez Intl záloha');
  // skutočné Intl v Node: slovenčina aj angličtina
  assert.equal(displayName('SK', 'sk'), 'Slovensko');
  assert.equal(displayName('SK', 'en'), 'Slovakia');
  assert.equal(displayName('CZ', 'sk'), 'Česko');
});

test('riedené verzálky ako v HUD', () => {
  assert.equal(spaced('Slovensko'), 'S L O V E N S K O');
  assert.equal(spaced('Česká republika'), 'Č E S K Á   R E P U B L I K A');
  assert.equal(spaced(''), '');
});

/** Falošné Cesium a scéna bez WebGL. */
function harness({ height = 1_100_000, lat = 48.7 } = {}) {
  const listeners = new Set();
  const added = [];
  class LabelCollection { constructor() { this.items = []; } add(o) { const l = { ...o }; this.items.push(l); return l; } get length() { return this.items.length; } }
  const CesiumRef = {
    LabelCollection,
    Cartesian3: { fromDegrees: (lon, lat2, h) => ({ lon, lat: lat2, h }) },
    Color: { fromCssColorString: (s) => ({ css: s }) },
    LabelStyle: { FILL_AND_OUTLINE: 2 }, HorizontalOrigin: { CENTER: 0 }, VerticalOrigin: { CENTER: 0 },
    Ellipsoid: { WGS84: {} },
    EllipsoidalOccluder: class { isPointVisible(p) { return p.lon < 100; } },
  };
  const scene = {
    primitives: { add: (p) => { added.push(p); return p; }, remove: (p) => { const i = added.indexOf(p); if (i >= 0) added.splice(i, 1); return i >= 0; } },
    postRender: { addEventListener: (fn) => listeners.add(fn), removeEventListener: (fn) => listeners.delete(fn) },
    camera: { positionCartographic: { height, latitude: rad(lat) }, positionWC: { x: 1 } },
    requestRender() {},
  };
  const data = { labels: [
    { iso2: 'SK', lon: 19.05, lat: 48.73, rank: 6, minLabel: 4, maxLabel: 9, nameEn: 'Slovakia' },
    { iso2: 'DE', lon: 9.68, lat: 50.96, rank: 2, minLabel: 1.7, maxLabel: 6.7, nameEn: 'Germany' },
    { iso2: 'VA', lon: 12.45, lat: 41.9, rank: 6, minLabel: 5, maxLabel: 10, tiny: 4, nameEn: 'Vatican City' },
    { iso2: 'JP', lon: 138.3, lat: 36.3, rank: 2, minLabel: 1.7, maxLabel: 6.7, nameEn: 'Japan' },
    { iso2: '-99', lon: 46, lat: 9, nameEn: 'Somaliland' },
  ] };
  let t = 50_000;
  const labels = createCountryLabels({ scene, lang: 'sk', fetch: async () => ({ ok: true, json: async () => data }), CesiumRef, now: () => t });
  const frame = (dt = 300) => { t += dt; for (const fn of [...listeners]) fn(); };
  return { labels, scene, added, frame, get collection() { return added[0]; } };
}

test('popisky: načítanie, mená po slovensky riedené, skryté kým nie sú zapnuté; podľa úrovne a za glóbusom', async () => {
  const h = harness({ height: 1_100_000 }); // krajina: úroveň ≈ 6
  assert.equal(await h.labels.load(), 4, 'bez platného ISO sa vynechá');
  assert.equal(h.collection.items.length, 4);
  const sk = h.collection.items.find((l) => l.id === 'country-labels:SK');
  assert.equal(sk.text, 'S L O V E N S K O');
  assert.equal(sk.show, false, 'kým zoomBorders nezapne, nič');
  h.labels.setVisible(true);
  assert.equal(sk.show, true);
  assert.equal(h.collection.items.find((l) => l.id === 'country-labels:DE').show, true);
  assert.equal(h.collection.items.find((l) => l.id === 'country-labels:VA').show, true, 'Vatikán od úrovne 5');
  assert.equal(h.collection.items.find((l) => l.id === 'country-labels:JP').show, false, 'Japonsko za glóbusom (falošný occluder)');
  assert.equal(h.labels.shown, 3);
  // vyššie (3 000 km → úroveň ≈ 4,4): Vatikán zmizne, Slovensko ostáva
  h.scene.camera.positionCartographic.height = 3_000_000;
  h.frame();
  assert.equal(h.collection.items.find((l) => l.id === 'country-labels:VA').show, false);
  assert.equal(sk.show, true);
  // zemeguľa (20 000 km → ≈ 2): len veľké
  h.scene.camera.positionCartographic.height = 20_000_000;
  h.frame();
  assert.equal(sk.show, false);
  assert.equal(h.collection.items.find((l) => l.id === 'country-labels:DE').show, true);
  h.labels.setVisible(false);
  assert.equal(h.labels.shown, 0);
  assert.ok(h.collection.items.every((l) => !l.show));
});

test('domovská krajina je svetlejšia a väčšia; destroy odstráni kolekciu; bez scény no-op', async () => {
  const h = harness();
  await h.labels.load();
  const sk = h.collection.items.find((l) => l.id === 'country-labels:SK');
  const de = h.collection.items.find((l) => l.id === 'country-labels:DE');
  h.labels.setHome('sk');
  assert.equal(h.labels.home, 'SK');
  assert.notEqual(sk.font, de.font, 'iný rez písma');
  assert.notEqual(sk.fillColor.css, de.fillColor.css, 'svetlejšia');
  h.labels.setHome(null);
  assert.equal(sk.font, de.font);
  h.labels.destroy();
  assert.equal(h.added.length, 0);
  const none = createCountryLabels({ scene: null });
  assert.equal(await none.load(), 0);
  none.setVisible(true);
  assert.equal(none.visible, false);
});

test('dataset popisiek: Natural Earth, platné ISO2, Slovensko s úrovňami 4–9', () => {
  const data = JSON.parse(readFileSync(new URL('./local_data/natural_earth/country-labels.json', import.meta.url), 'utf8'));
  assert.match(data.meta.license, /public domain/);
  assert.ok(data.labels.length > 200);
  assert.ok(data.labels.every((l) => /^[A-Z]{2}$/.test(l.iso2) && Number.isFinite(l.lon) && Number.isFinite(l.lat)));
  const sk = data.labels.find((l) => l.iso2 === 'SK');
  assert.deepEqual([sk.minLabel, sk.maxLabel, sk.nameEn], [4, 9, 'Slovakia']);
  assert.ok(Math.abs(sk.lon - 19.05) < 0.01 && Math.abs(sk.lat - 48.734) < 0.01);
});

test('zapojenie: main.js vytvorí popisky s jazykom používateľa a dá ich zoomBorders', () => {
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /import \{ createCountryLabels \} from '\.\/data\/countryLabels\.js';/);
  assert.match(main, /const countryLabels = createCountryLabels\(\{ scene: viewer\.scene, lang: currentLanguage\(\) \}\);/);
  assert.match(main, /installZoomBorders\(\{ scene: viewer\.scene, boundaries: countryBoundaries, labels: countryLabels, getStackId: \(\) => mapStackController\.getActiveId\(\) \}\)/);
});
