// src/data/ukraineKartaRybarLook.test.mjs — KARTA „ako Rybar" (2026-09-26, vlastník:
// „sprav"): tmavomodrý tón ukrajinskej strany a bordové okupované územie, väčšie
// tučné popisy sídiel (Inter) a bližší výrez smeru zhora.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  FRONT_KARTA_HEIGHT_PER_DEG, FRONT_KARTA_MIN_HEIGHT_M, FRONT_KARTA_PITCH_DEG, frontSceneById, frontSceneFraming,
} from '../ukraineFrontScenes.js';
import { DEEPSTATE_STYLES, UA_TINT_PX_PER_DEG, paintUaTintCanvas, ringsBBox } from '../ukraineDeepStateLayer.js';
import { KARTA_LABEL_FAMILY, UKRAINE_BASE_STYLES } from './ukraineBaseLayer.js';
import { placeLabelFont } from './ukraineReportLayer.js';
import { KARTA_LEGEND_COLORS, kartaLegendItems } from '../ukraineKartaOverlay.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';

test('výrez smeru v KARTE: zhora a o polovicu bližšie, os pohľadu mieri do stredu rámca; prehľad a mimo KARTY bez zmeny', () => {
  const rect = frontSceneById('lyman').rectDegrees;
  const old = frontSceneFraming(rect);
  const k = frontSceneFraming(rect, { karta: true });
  assert.equal(k.pitchDeg, FRONT_KARTA_PITCH_DEG);
  assert.ok(FRONT_KARTA_PITCH_DEG <= -78, 'takmer zhora ako mapa');
  const slant = (f) => f.heightM / Math.sin((Math.abs(f.pitchDeg) * Math.PI) / 180);
  assert.ok(slant(k) < slant(old) * 0.62, `vzdialenosť ku stredu ${Math.round(slant(k) / 1000)} km vs ${Math.round(slant(old) / 1000)} km`);
  assert.ok(Math.abs(k.heightM - 1.35 * FRONT_KARTA_HEIGHT_PER_DEG) < 1, 'výška podľa rozpätia');
  // os pohľadu dopadne do stredu rámca (lat 49,01)
  const hitLat = k.lat + k.heightM / Math.tan((Math.abs(k.pitchDeg) * Math.PI) / 180) / 111_320;
  assert.ok(Math.abs(hitLat - (rect[1] + rect[3]) / 2) < 1e-9);
  assert.equal(frontSceneFraming([0, 0, 0.1, 0.1], { karta: true }).heightM, FRONT_KARTA_MIN_HEIGHT_M, 'spodný strop');
  const ov = frontSceneFraming(frontSceneById('front').rectDegrees, { overview: true, karta: true });
  assert.deepEqual(ov, frontSceneFraming(frontSceneById('front').rectDegrees, { overview: true }), 'prehľad celého frontu sa nemení');
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /frontSceneFraming\(scene\.rectDegrees, \{ overview: Boolean\(scene\.overview\), karta: !scene\.overview \}\)/);
});

test('KARTA: bordové okupované územie a tón ukrajinskej strany; legenda aj os to hovoria', () => {
  const k = DEEPSTATE_STYLES.karta;
  assert.equal(k.fillCss.occupied, '#8e2330');
  assert.ok(k.fillAlpha.occupied >= 0.6, 'sýta ako u Rybara');
  assert.ok(k.uaTint && k.uaTint.css && k.uaTint.alpha > 0.15 && k.uaTint.alpha < 0.5, 'tón, nie plná výplň — reliéf presvitá');
  assert.equal(DEEPSTATE_STYLES.default.uaTint, undefined, 'mimo KARTY bez tónu');
  assert.equal(KARTA_LEGEND_COLORS.occupied, k.fillCss.occupied);
  assert.equal(KARTA_LEGEND_COLORS.uaArea, k.uaTint.css);
  const keys = (style) => kartaLegendItems({ deepstate: { shown: true, source: 'mirror', features: 3, contact: 1, style }, translate: (x) => x }).map((i) => i.key);
  assert.ok(keys('karta').includes('ua-area'));
  assert.ok(!keys('default').includes('ua-area'));
  assert.match(SK_STRINGS['ukraine.karta.legend.ua-area'], /odvodené/);
  assert.match(EN_STRINGS['ukraine.karta.legend.ua-area'], /derived/);
  assert.ok(EN_STRINGS['ukraine.ds.ua-area'] && SK_STRINGS['ukraine.ds.ua-area']);
  const src = readFileSync(new URL('../ukraineDeepStateLayer.js', import.meta.url), 'utf8');
  assert.match(src, /id: `\$\{UKRAINE_DEEPSTATE_ID\}:ua-tint`, rectangle: \{[^}]*classificationType: Cesium\.ClassificationType\.BOTH \} \}\);/, 'bez vlastností — žiadna bublina nad celou Ukrajinou');
  assert.match(src, /DEEPSTATE_RU_KINDS\.includes\(f\.kind\) \|\| f\.kind === 'grey'/, 'vyrezané ruské aj sivé polygóny');
  assert.match(src, /if \(band && zc\) bandForTint = \{ canvas: zc, bbox: _zone\.bbox \};/, 'vyrezaný pás bojov');
});

test('paintUaTintCanvas: pevnina farbou, ruské polygóny a pás vyrezané (destination-out), obdĺžnik s okrajom', () => {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (_t, k) => (k in _t ? _t[k] : (...a) => calls.push([k, ...a])),
    set: (t, k, v) => { t[k] = v; calls.push([`=${String(k)}`, v]); return true; },
  });
  const canvas = { getContext: () => ctx };
  const land = [[[30, 45], [36, 45], [36, 50], [30, 50], [30, 45]]];
  const out = paintUaTintCanvas(canvas, {
    landRings: land, cutRings: [[[[34, 46], [35, 46], [35, 47], [34, 47], [34, 46]]]],
    bandCanvas: { tag: 'band' }, bandBBox: { west: 33, south: 46, east: 34, north: 47 }, css: '#2f6aa3', alpha: 0.3,
  });
  assert.deepEqual(ringsBBox(land), [29.95, 44.95, 36.05, 50.05]);
  assert.deepEqual(out.bbox, { west: 29.95, south: 44.95, east: 36.05, north: 50.05 });
  assert.equal(canvas.width, Math.ceil(6.1 * UA_TINT_PX_PER_DEG));
  const seq = calls.map((c) => c[0]);
  const fillLand = seq.indexOf('fill');
  const cutMode = calls.findIndex((c) => c[0] === '=globalCompositeOperation' && c[1] === 'destination-out');
  assert.ok(fillLand >= 0 && cutMode > fillLand, 'najprv pevnina, potom výrez');
  assert.ok(calls.some((c) => c[0] === 'fill' && c[1] === 'evenodd'), 'polygóny s dierami');
  const draw = calls.find((c) => c[0] === 'drawImage');
  assert.ok(draw && draw[1].tag === 'band', 'pás vyrezaný');
  assert.ok(Math.abs(draw[2] - (33 - 29.95) * UA_TINT_PX_PER_DEG) < 1e-6 && Math.abs(draw[3] - (50.05 - 47) * UA_TINT_PX_PER_DEG) < 1e-6);
  assert.equal(calls.filter((c) => c[0] === '=globalCompositeOperation').pop()[1], 'source-over', 'režim vrátený');
  assert.equal(paintUaTintCanvas({ getContext: () => null }, { landRings: land, css: '#000', alpha: 1 }), null);
  assert.equal(ringsBBox([]), null);
});

test('popisy v KARTE: väčšie a tučné bezpätkové (Inter), sídla biele; mimo KARTY Plex Mono', () => {
  const k = UKRAINE_BASE_STYLES.karta;
  assert.ok(k.font > 1, 'väčšie než bežný štýl');
  assert.equal(k.family, KARTA_LABEL_FAMILY);
  assert.match(KARTA_LABEL_FAMILY, /^"Inter"/);
  assert.ok(k.weightMin >= 600 && k.weightMin <= 600, 'Inter sa načítava len do 600');
  assert.equal(k.placeLabelCss, '#f4f7fa');
  assert.equal(k.line, 0.5, 'čiary ostávajú jemné (vkus 2026-09-20)');
  assert.equal(UKRAINE_BASE_STYLES.default.family, undefined);
  assert.match(placeLabelFont('karta'), /^600 12\.5px "Inter"/);
  assert.match(placeLabelFont('default'), /^500 11px "IBM Plex Mono"/);
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /family=Inter:wght@[\d;]*600/, 'Inter 600 sa načítava');
  const src = readFileSync(new URL('./ukraineReportLayer.js', import.meta.url), 'utf8');
  assert.match(src, /e\.label\.font = placeLabelFont\(_styleMode\);/, 'prepnutie štýlu mení aj písmo sídiel z hlásenia');
});
