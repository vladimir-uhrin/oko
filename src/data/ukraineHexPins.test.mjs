// src/data/ukraineHexPins.test.mjs — bod 4 návrhu po upratanom ráme (2026-09-26):
// sídla na KARTE ako šesťuholníky vo farbe strany (vzorka Rybar), odznaky ciest
// podľa triedy (na úrovni smeru len hlavné), a ukrajinská strana z mirroru
// DeepState mimo okupovaného územia a mimo odvodeného pásu pri línii.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { HEX_PIN_PX, ROAD_SHIELD_FAR_M, SIDE_PIN_COLORS, hexPinVertices, roadShieldFarM } from './ukraineBaseLayer.js';
import { kartaLegendItems } from '../ukraineKartaOverlay.js';

test('hexPinVertices: šesť vrcholov na kružnici, špička hore', () => {
  const v = hexPinVertices(10, 10, 8);
  assert.equal(v.length, 6);
  for (const [x, y] of v) assert.ok(Math.abs(Math.hypot(x - 10, y - 10) - 8) < 1e-9);
  assert.ok(Math.abs(v[0][0] - 10) < 1e-9 && Math.abs(v[0][1] - 2) < 1e-9, 'prvý vrchol hore');
  assert.ok(HEX_PIN_PX.city > HEX_PIN_PX.town && HEX_PIN_PX.town > HEX_PIN_PX.village);
  assert.ok(SIDE_PIN_COLORS.ua && SIDE_PIN_COLORS.ru && SIDE_PIN_COLORS.contested);
});

test('roadShieldFarM: na úrovni smeru (≈ 180 km) len M/H/E a P; T/O zbližša, miestne celkom zblízka', () => {
  const DIRECTION_M = 180_000;
  for (const ref of ['M-03', 'H-26', 'E40']) assert.equal(roadShieldFarM(ref), ROAD_SHIELD_FAR_M, ref);
  assert.ok(roadShieldFarM('P-78') > DIRECTION_M, 'P ešte na smere');
  for (const ref of ['T-05-13', 'T-21-15', 'O0526']) assert.ok(roadShieldFarM(ref) < DIRECTION_M && roadShieldFarM(ref) >= 100_000, ref);
  for (const ref of ['C-211411', 'C211411', '', null]) assert.ok(roadShieldFarM(ref) <= 60_000, String(ref));
  const src = readFileSync(new URL('./ukraineBaseLayer.js', import.meta.url), 'utf8');
  assert.match(src, /const farM = Math\.min\(roadStyle\(pick\.cls\)\.farM, roadShieldFarM\(specs\[0\]\.text\)\);/);
});

test('podklad: sídlo so známou stranou na KARTE = šesťuholník (billboard, data URL), bod skrytý, popisok odsunutý', () => {
  const src = readFileSync(new URL('./ukraineBaseLayer.js', import.meta.url), 'utf8');
  assert.match(src, /return c\.toDataURL\('image\/png'\)/, 'data URL — jeden záznam atlasu na farbu');
  assert.match(src, /const hex = side \? hexImage\(css\) : null;/);
  assert.match(src, /e\.point\.show = !hex;/);
  assert.match(src, /e\.billboard\.show = Boolean\(hex\);/);
  assert.match(src, /e\.label\.pixelOffset = new Cesium\.Cartesian2\(hex \? Math\.round\(\(HEX_PIN_PX\[record\.cls\] \|\| HEX_PIN_PX\.village\) \/ 2\) \+ 4 : 8, -1\)/);
  assert.match(src, /billboard: \{\s*show: false,\s*width: HEX_PIN_PX\[props\.cls\]/, 'billboard vzniká skrytý, dosah ako bod');
  // mimo KARTY strana nie je → vždy bod
  assert.match(src, /if \(_styleMode !== 'karta' \|\| typeof _sideResolver !== 'function'\) return \{ css: base, side: null \};/);
});

test('legenda KARTY: sídla ako šesťuholníky', () => {
  const items = kartaLegendItems({ deepstate: { shown: true, source: 'mirror', features: 3, contact: 1, style: 'karta' }, translate: (k) => k });
  for (const key of ['pin-ua', 'pin-ru']) {
    const it = items.find((i) => i.key === key);
    assert.ok(it && it.glyph === 'hex' && !it.dot, key);
  }
  const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.oko-karta-swatch-glyph\.glyph-hex \{[^}]*clip-path: polygon\(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%\)/);
});

test('DeepState z mirroru: mimo okupovaného a za pásom na pevnine = UA; v páse a mimo Ukrajiny nevieme', async () => {
  const { createUkraineDeepStateLayer } = await import('../ukraineDeepStateLayer.js');
  const { FRONT_ZONE_KM } = await import('./ukraineContactLine.js');
  const doc = { createElement: () => ({ className: '', hidden: false, remove() {} }) };
  const viewer = { scene: { primitives: { add: (x) => x, remove() {} }, requestRender() {} }, dataSources: { add() {}, remove() {} }, container: { ownerDocument: doc, appendChild() {} } };
  const layer = createUkraineDeepStateLayer({ viewer, documentRef: doc, terrainSampler: async (pts) => pts.map(() => 0) });
  const sq = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
  // okupovaný štvorec v Donbase (pevnina UA), západná hrana 37,5° = línia
  layer.setSnapshot({ day: '2026-09-26', source: 'mirror', features: [{ type: 'Polygon', kind: 'occupied', rings: [sq(37.5, 48.0, 38.5, 48.8)] }] });
  assert.ok(layer.getState().contact >= 1, 'línia existuje');
  assert.equal(layer.sideAt(38.0, 48.4), 'ru', 'vnútri');
  const kmLon = 1 / (111.32 * Math.cos((48.4 * Math.PI) / 180));
  assert.equal(layer.sideAt(37.5 - 2 * kmLon, 48.4), null, `2 km od línie (pás ${FRONT_ZONE_KM} km) — sivá zóna, nevieme`);
  assert.equal(layer.sideAt(37.5 - 20 * kmLon, 48.4), 'ua', '20 km od línie na pevnine UA');
  assert.equal(layer.sideAt(30.5, 50.45), 'ua', 'Kyjev');
  assert.equal(layer.sideAt(36.6, 50.6), null, 'Belgorod (Rusko) — nie UA');
  assert.equal(layer.sideAt(19.0, 48.0), null, 'Slovensko');
  // archív z API (nie mirror): pôvodné správanie — mimo polygónov 'ua'
  layer.setSnapshot({ day: '2026-09-26', source: 'archive', features: [{ type: 'Polygon', kind: 'occupied', rings: [sq(37.5, 48.0, 38.5, 48.8)] }] });
  assert.equal(layer.sideAt(37.5 - 2 * kmLon, 48.4), 'ua');
  layer.destroy();
});
