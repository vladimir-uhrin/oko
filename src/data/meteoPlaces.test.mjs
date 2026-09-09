// src/data/meteoPlaces.test.mjs
// Mestá nad meteorologickým polom (2026-09-08): vzorkovanie mriežky, texty, smer vetra,
// body s viditeľnosťou podľa populácie, model karty pri myši.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PLACE_ID_PREFIX, createPlaceHoverCard, createPlacePoints, nearestWithinRadius, normalizePlaces, placeHoverModel,
  placeValueText, placeVisibleUntilM, sampleGrid, windDirectionText,
} from './meteoPlaces.js';

const T = { 'meteo.place.pending': '…', 'meteo.place.temp': 'Teplota 2 m', 'meteo.place.wind': 'Vietor 10 m', 'meteo.place.gust': 'Nárazy', 'meteo.place.pressure': 'Tlak MSL', 'meteo.place.precip': 'Zrážky', 'meteo.place.clouds': 'Oblačnosť', 'meteo.place.forecast': 'Predpoveď GFS · {label}', 'meteo.forecast': 'PREDPOVEĎ', 'meteo.place.card': 'Počasie v meste', 'meteo.place.close': 'Zavrieť' };
const translate = (k, vars = {}) => Object.entries(vars).reduce((s, [a, b]) => s.replaceAll(`{${a}}`, String(b)), T[k] ?? k);

test('sampleGrid: bilineárne z mriežky sever hore, −180 vľavo; mimo = NaN', () => {
  const grid = { cols: 3, rows: 3, values: new Float32Array([0, 10, 20, 30, 40, 50, 60, 70, 80]) };
  assert.equal(sampleGrid(grid, 90, -180), 0);
  assert.equal(sampleGrid(grid, -90, 180), 80);
  assert.equal(sampleGrid(grid, 0, 0), 40, 'stred');
  assert.equal(sampleGrid(grid, 45, -90), 20, 'medzi 0,10,30,40 → (0+10+30+40)/4');
  assert.ok(Number.isNaN(sampleGrid(null, 0, 0)));
});

test('texty hodnôt a smer vetra (meteorologicky: odkiaľ fúka)', () => {
  assert.equal(placeValueText(21.4, 'temp'), '21 °C');
  assert.equal(placeValueText(1013.2, 'pressure'), '1013 hPa');
  assert.equal(placeValueText(0.04, 'precip'), '0 mm/h');
  assert.equal(placeValueText(0.6, 'precip'), '0.6 mm/h');
  assert.equal(placeValueText(87, 'clouds'), '87 %');
  assert.equal(placeValueText(7.6, 'gust'), '8 m/s');
  assert.equal(placeValueText(NaN, 'temp'), '');
  assert.equal(windDirectionText(0, -5), '360° N', 'v < 0 = fúka zo severu');
  assert.equal(windDirectionText(-5, 0), '90° E', 'u < 0 = fúka z východu');
  assert.equal(windDirectionText(5, 5), '225° SW');
  assert.equal(windDirectionText(0.1, 0.1), '', 'bezvetrie bez smeru');
  assert.equal(windDirectionText(NaN, 1), '');
});

test('viditeľnosť podľa populácie a bundle miest (verejná doména, ≥ 100 k alebo hlavné mesto)', () => {
  assert.equal(placeVisibleUntilM(9000), Number.POSITIVE_INFINITY);
  assert.equal(placeVisibleUntilM(6000), 6_000_000);
  assert.equal(placeVisibleUntilM(424, true), 6_000_000, 'hlavné mesto ako 3 M+');
  assert.equal(placeVisibleUntilM(1200), 2_500_000);
  assert.equal(placeVisibleUntilM(424, false), 900_000);
  assert.equal(placeVisibleUntilM(120), 400_000);
  const json = JSON.parse(readFileSync(new URL('./local_data/natural_earth/places.json', import.meta.url), 'utf8'));
  assert.match(json.meta.license, /public domain/);
  const places = normalizePlaces(json);
  assert.ok(places.length >= 1000 && places.length <= 1400);
  assert.equal(places[0].name, 'Tokyo', 'zoradené podľa populácie');
  assert.equal(places[0].id, `${PLACE_ID_PREFIX}0`, 'id = prefix + index (pick → mesto)');
  const ba = places.find((p) => p.name === 'Bratislava');
  assert.deepEqual([ba.lat, ba.lon, ba.pop, ba.iso2, ba.capital], [48.15, 17.117, 424, 'SK', true]);
});

test('body miest: id, veľkosť podľa významu, hĺbkový test ostáva (za obzorom zmiznú), viditeľnosť podľa populácie', () => {
  const places = normalizePlaces({ places: [['Praha', 50.08, 14.42, 1300, 2, 'CZ', 1], ['Nitra', 48.31, 18.09, 77, 8, 'SK', 0]] });
  const items = [];
  const points = createPlacePoints(places, { collectionFactory: () => ({ add(o) { items.push(o); return o; }, get length() { return items.length; } }) });
  assert.equal(points.length, 2);
  assert.equal(items[0].id, 'place:0');
  assert.equal(items[0].pixelSize, 4);
  assert.equal(items[1].pixelSize, 3);
  assert.equal(items[0].disableDepthTestDistance, undefined, 'žiadne vypnutie hĺbkového testu — body za obzorom sa nekreslia');
  assert.equal(items[1].distanceDisplayCondition.far, 400_000);
});

test('model karty: meno, štát/populácia/súradnice, riadky všetkých polí; „…" kým sa načítava, „—" bez hodnoty; vietor so smerom', () => {
  const place = { name: 'Bratislava', lat: 48.15, lon: 17.117, pop: 424, iso2: 'SK', capital: true };
  const m = placeHoverModel(place, { temp: 21.4, wind: { u: 3, v: 4 }, gust: undefined, pressure: NaN, precip: 0.6, clouds: 87 }, { stepLabel: 'Ut 8. 9. 21:00 UTC · +09 h', translate });
  assert.equal(m.title, 'Bratislava');
  assert.equal(m.subtitle, 'SK · 424 tis. · 48.15°, 17.12°');
  assert.deepEqual(m.rows, [
    ['Teplota 2 m', '21 °C'],
    ['Vietor 10 m', '5 m/s · 217° SW'],
    ['Nárazy', '…'],
    ['Tlak MSL', '—'],
    ['Zrážky', '0.6 mm/h'],
    ['Oblačnosť', '87 %'],
  ]);
  assert.equal(m.note, 'Predpoveď GFS · Ut 8. 9. 21:00 UTC · +09 h');
  const big = placeHoverModel({ name: 'Tokyo', lat: 35.687, lon: 139.749, pop: 35676, iso2: 'JP', capital: true }, {}, { translate });
  assert.equal(big.subtitle, 'JP · 35,7 M · 35.69°, 139.75°');
  assert.ok(big.rows.every(([, v]) => v === '…'), 'nič nenačítané = všade …');
  assert.equal(big.note, 'PREDPOVEĎ');
});

test('DOM karta: show/update/hide, bez dokumentu no-op', () => {
  const noop = createPlaceHoverCard({ document: null });
  noop.show({ name: 'x' }, { x: 0, y: 0 }); noop.hide(); noop.destroy();
  assert.equal(noop.isHovered(), false);
  const nodes = [];
  const mk = (tag) => ({ tag, children: [], hidden: false, style: {}, textContent: '', className: '', attrs: {}, offsetWidth: 200, offsetHeight: 150, listeners: {},
    appendChild(c) { this.children.push(c); return c; }, replaceChildren(...c) { this.children = c; }, setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(k, fn) { this.listeners[k] = fn; }, removeEventListener() {}, remove() { this.removed = true; }, contains: () => false });
  const doc = { body: { appendChild(el) { nodes.push(el); } }, documentElement: { clientWidth: 1000, clientHeight: 800 }, activeElement: null, createElement: (tag) => mk(tag), addEventListener() {}, removeEventListener() {} };
  const card = createPlaceHoverCard({ document: doc, translate });
  const root = nodes[0];
  assert.equal(root.hidden, true);
  const place = { name: 'Bratislava', lat: 48.15, lon: 17.117, pop: 424, iso2: 'SK', capital: true };
  card.show(place, { x: 100, y: 100 }, { temp: 20 }, 'krok');
  assert.equal(root.hidden, false);
  assert.equal(card.current(), place);
  assert.equal(root.style.left, '118px');
  const dd = () => root.children.find((c) => c.tag === 'dl').children.filter((c) => c.tag === 'dd').map((c) => c.textContent);
  assert.equal(dd()[0], '20 °C');
  assert.equal(dd()[1], '…');
  card.update({ temp: 20, wind: { u: 0, v: -6 } });
  assert.equal(dd()[1], '6 m/s · 360° N');
  card.hide();
  assert.equal(root.hidden, true);
  assert.equal(card.current(), null);
  card.destroy();
  assert.equal(root.removed, true);
});

test('nearestWithinRadius: najbližší kandidát v okruhu, mimo okruhu nič', () => {
  const A = { name: 'A' }; const B = { name: 'B' };
  const cands = [{ place: A, x: 100, y: 100 }, { place: B, x: 130, y: 100 }];
  assert.equal(nearestWithinRadius(cands, 105, 100, 22), A, 'bližšie k A');
  assert.equal(nearestWithinRadius(cands, 125, 100, 22), B, 'bližšie k B');
  assert.equal(nearestWithinRadius(cands, 200, 200, 22), null, 'mimo okruhu');
  assert.equal(nearestWithinRadius([], 0, 0), null);
  assert.equal(nearestWithinRadius(cands, 100, 121, 22), A, 'hrana okruhu (21 px) ešte trafí');
});
