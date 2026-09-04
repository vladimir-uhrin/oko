// src/data/contactPalette.test.mjs
// Paleta ikon kontaktov podľa kontrastu podkladu (2026-09-05).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CONTACT_ICON_TINTS,
  MAP_STACK_CHANGED_EVENT,
  basemapContrastForStack,
  bindContactPaletteToMapStack,
  contactIconTint,
  getBasemapContrast,
  onContactPaletteChange,
  setBasemapContrast,
  _resetContactPaletteForTest,
} from './contactPalette.js';

test('default je tmavý kontrast = biela silueta bez tintu', () => {
  _resetContactPaletteForTest();
  assert.equal(getBasemapContrast(), 'dark');
  assert.equal(contactIconTint('civil'), null);
  assert.equal(contactIconTint('military'), null);
  assert.equal(basemapContrastForStack(null), 'dark');
  assert.equal(basemapContrastForStack({ id: 'photoreal' }), 'dark', 'bez údaju = tmavý (bezpečný default)');
  assert.equal(basemapContrastForStack({ contactContrast: 'light' }), 'light');
});

test('svetlý podklad dáva civilným aj vojenským zapečený tint', () => {
  _resetContactPaletteForTest();
  assert.equal(setBasemapContrast('light'), true);
  assert.equal(contactIconTint('civil'), CONTACT_ICON_TINTS.light.civil);
  assert.equal(contactIconTint('military'), CONTACT_ICON_TINTS.light.military);
  assert.ok(contactIconTint('civil') && contactIconTint('military'));
  assert.notEqual(contactIconTint('civil'), contactIconTint('military'), 'vojenský ostáva rozlíšený');
  assert.equal(setBasemapContrast('light'), false, 'bez zmeny sa nič nehlási');
  _resetContactPaletteForTest();
});

test('poslucháči sa volajú len pri zmene a dajú sa odhlásiť', () => {
  _resetContactPaletteForTest();
  const seen = [];
  const off = onContactPaletteChange((c) => seen.push(c));
  setBasemapContrast('dark');
  assert.deepEqual(seen, [], 'rovnaká hodnota = žiadne prerastrovanie flotily');
  setBasemapContrast('light');
  setBasemapContrast('nezmysel');
  assert.deepEqual(seen, ['light', 'dark'], 'neznáma hodnota číta ako tmavá');
  off();
  setBasemapContrast('light');
  assert.deepEqual(seen, ['light', 'dark']);
  _resetContactPaletteForTest();
});

test('väzba na udalosť podkladu: počiatočný stav + zmeny + odpojenie', () => {
  _resetContactPaletteForTest();
  const handlers = new Map();
  const target = {
    addEventListener: (name, fn) => handlers.set(name, fn),
    removeEventListener: (name) => handlers.delete(name),
  };
  const unbind = bindContactPaletteToMapStack(target, { id: 'osm', contactContrast: 'light' });
  assert.equal(getBasemapContrast(), 'light', 'prvý setStack je tichý — stav sa berie z podkladu pri štarte');
  const handler = handlers.get(MAP_STACK_CHANGED_EVENT);
  assert.ok(handler);
  handler({ detail: { activeStack: { id: 'stadia-dark' } } });
  assert.equal(getBasemapContrast(), 'dark');
  handler({ detail: { activeStack: { id: 'osm', contactContrast: 'light' } } });
  assert.equal(getBasemapContrast(), 'light');
  handler({});
  assert.equal(getBasemapContrast(), 'dark', 'chýbajúci detail nezhodí, číta ako tmavý');
  unbind();
  assert.equal(handlers.size, 0);
  assert.doesNotThrow(() => bindContactPaletteToMapStack(null)());
  _resetContactPaletteForTest();
});

test('tripwire: obe letecké vrstvy pečú tint do SVG a prerastrujú na zmenu', () => {
  for (const file of ['./flights.js', './militaryFlights.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const name = file.includes('military') ? 'military' : 'flights';
    // Jediný zapisovač bb.image žiada tint z palety — nie billboard.color.
    assert.match(source, /aircraftIcon\(_iconKind\(icao24, klass\), raster, bb\._gevStrobeOn === true, contactIconTint\(/, `${name}: sync žiada tint`);
    assert.match(source, /onContactPaletteChange\(/, `${name}: prihlásený na zmenu palety`);
    assert.match(source, /_paletteUnsub\(\);/, `${name}: odhlási sa pri destroy`);
  }
  // 3D modely flotily (režim „Modely blízke" pod 800 km) sledujú tú istú
  // paletu — inak by ikona bola atramentová a model biely, a pri 129 km na
  // OSM by stroj ostal sivou škvrnou (nález zo screenshotu 2026-09-05).
  const flights = readFileSync(new URL('./flights.js', import.meta.url), 'utf8');
  assert.match(flights, /return contactIconTint\('civil'\) === 'ink' \? MODEL_INK_TINT : Cesium\.Color\.WHITE;/, 'model civil sleduje paletu');
  assert.match(flights, /MODEL_INK_TINT = Cesium\.Color\.fromCssColorString\(TINT_FILLS\.ink\)/, 'rovnaká atramentová ako ikona');
  assert.match(flights, /m\.color = _modelColor\(icao24\)\.withAlpha\(m\.color\.alpha\);/, 'modely sa premaľujú pri zmene palety');
  // OSM je jediný svetlý podklad; main.js viaže paletu na udalosť podkladu.
  const stacks = readFileSync(new URL('../mapStackController.js', import.meta.url), 'utf8');
  assert.match(stacks, /id: 'osm',[\s\S]{0,500}contactContrast: 'light'/, 'OSM je označený ako svetlý');
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /bindContactPaletteToMapStack\(window, mapStackController\.getActiveStack\(\)\)/, 'main.js viaže paletu');
});
