// src/data/ukraineAttackArrows.test.mjs — šípky smerov útoku (KARTA, 2026-09-26):
// geometria od línie kontaktu k sídlu z hlásenia GŠ, hrúbka podľa útokov, väzby
// vrstiev a poctivé popisy („odvodené"). Plus ostré hrany frontu v KARTE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ARROW_BACK_KM, ARROW_HEAD_GAP_KM, ARROW_HEAD_L_KM, ARROW_HEAD_W_KM, ARROW_LEN_MAX, ARROW_LODS, ARROW_LEN_MIN, ARROW_MAX_KM, ARROW_MIN_KM, ARROW_SAMPLES, ARROW_SHAFT_KM,
  arrowBendSign, arrowScale, attackArrowPath, attackArrowPolygon,
} from './ukraineAttackArrows.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';
import { DEEPSTATE_STYLES } from '../ukraineDeepStateLayer.js';
import { KARTA_LEGEND_COLORS, kartaLegendItems } from '../ukraineKartaOverlay.js';

const KM = 111.32;
const kmBetween = (a, b) => { const kx = KM * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180); return Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * KM); };

test('attackArrowPath: začína za líniou v okupovanom území, končí pred sídlom, smeruje k nemu', () => {
  const from = { lon: 37.80, lat: 49.00 }; // bod línie
  const to = { lon: 37.80, lat: 49.06 };   // sídlo 6,7 km na sever
  const path = attackArrowPath(from, to, { name: 'Novoselivka' });
  assert.ok(Array.isArray(path) && path.length === ARROW_SAMPLES);
  const start = path[0]; const end = path[path.length - 1];
  // koniec 0,6 km pred sídlom; dĺžka = d + 3 km (6,7 + 3 = 9,7, v rozsahu 7–14) → začiatok
  // 9,7 − 6,1 = 3,6 km za líniou, v okupovanom území
  assert.ok(Math.abs(kmBetween(end, [to.lon, to.lat]) - ARROW_HEAD_GAP_KM) < 0.05, `end ${kmBetween(end, [to.lon, to.lat])} km`);
  assert.ok(end[1] < to.lat && end[1] > from.lat, 'koniec medzi líniou a sídlom');
  const d = kmBetween([from.lon, from.lat], [to.lon, to.lat]);
  const len = Math.max(ARROW_LEN_MIN, Math.min(d + ARROW_BACK_KM, ARROW_LEN_MAX));
  assert.ok(Math.abs(kmBetween(start, end) - len) < 0.3, `dĺžka ${kmBetween(start, end)} ≈ ${len} km (tetiva krivky)`);
  assert.ok(start[1] < from.lat, 'začiatok na opačnej strane línie než sídlo');
  // sídlo tesne pri línii (1,2 km): šípka má stále ARROW_LEN_MIN, nie pahýľ
  const near = attackArrowPath(from, { lon: from.lon, lat: from.lat + 1.2 / KM });
  assert.ok(Math.abs(kmBetween(near[0], near[near.length - 1]) - ARROW_LEN_MIN) < 0.3, 'blízke sídlo: plná dĺžka');
  assert.ok(near[0][1] < from.lat - 5 / KM, 'začiatok hlboko za líniou');
  // krivka je prehnutá: stred nie je na priamke (vzorka má krivé šípky)
  const mid = path[Math.floor(path.length / 2)];
  assert.ok(Math.abs(mid[0] - from.lon) > 1e-4, 'prehnutie do strany');
  assert.ok(path.every(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat)));
});

test('attackArrowPath: ďaleké sídlo sa zastrihne na ARROW_MAX_KM, sídlo na línii šípku nedostane, neplatný vstup null', () => {
  const from = { lon: 37.0, lat: 48.5 };
  const far = { lon: 37.0, lat: 48.5 + 30 / KM }; // 30 km
  const path = attackArrowPath(from, far);
  const end = path[path.length - 1];
  assert.ok(Math.abs(kmBetween([from.lon, from.lat], end) - ARROW_MAX_KM) < 0.05, 'koniec na strope');
  assert.ok(Math.abs(kmBetween(path[0], end) - ARROW_LEN_MAX) < 0.3, 'dĺžka na strope');
  assert.ok(path[0][1] < from.lat, 'začiatok stále za líniou');
  assert.equal(attackArrowPath(from, { lon: 37.0, lat: 48.5 + 0.5 / KM }), null, 'pod ARROW_MIN_KM');
  assert.ok(ARROW_MIN_KM < 1 && ARROW_MAX_KM >= 10);
  assert.equal(attackArrowPath(null, far), null);
  assert.equal(attackArrowPath(from, { lon: NaN, lat: 1 }), null);
});

test('arrowBendSign je stabilné a rôzne mená sa rozchádzajú; hrúbka podľa útokov', () => {
  assert.equal(arrowBendSign('Torske'), arrowBendSign('Torske'));
  assert.ok([1, -1].includes(arrowBendSign('Torske')) && [1, -1].includes(arrowBendSign('')));
  const signs = new Set(['Torske', 'Lyman', 'Yampil', 'Dibrova', 'Novoselivka', 'Kopanky', 'Shandryholove'].map(arrowBendSign));
  assert.equal(signs.size, 2, 'obe strany sa používajú');
  assert.equal(arrowScale(0), 0);
  assert.equal(arrowScale(null), 0);
  assert.equal(arrowScale(3), 1);
  assert.equal(arrowScale(12), 1.25);
  assert.equal(arrowScale(40), 1.5);
});

test('attackArrowPolygon: driek konštantnej šírky, hrot so špičkou na konci čiary, mierka rastie s útokmi', () => {
  const from = { lon: 37.80, lat: 49.00 }; const to = { lon: 37.80, lat: 49.06 };
  const path = attackArrowPath(from, to, { bend: 0 }); // rovná, aby sa dali merať šírky
  const ring = attackArrowPolygon(path);
  assert.ok(Array.isArray(ring) && ring.length >= 8);
  const tip = ring[Math.floor(ring.length / 2)];
  const end = path[path.length - 1];
  assert.ok(Math.abs(tip[0] - end[0]) < 1e-9 && Math.abs(tip[1] - end[1]) < 1e-9, 'špička = koniec čiary');
  const kx = KM * Math.cos(49.03 * Math.PI / 180);
  // prvý a posledný bod prstenca = ľavý a pravý roh drieku pri začiatku: šírka drieku
  assert.ok(Math.abs(Math.abs(ring[0][0] - ring[ring.length - 1][0]) * kx - ARROW_SHAFT_KM) < 0.02, 'šírka drieku');
  // rohy hrotu = ARROW_HEAD_W_KM od seba, ARROW_HEAD_L_KM pred špičkou
  const headIdx = Math.floor(ring.length / 2) - 1;
  const hl = ring[headIdx]; const hr = ring[headIdx + 2];
  assert.ok(Math.abs(Math.abs(hl[0] - hr[0]) * kx - ARROW_HEAD_W_KM) < 0.02, 'šírka hrotu');
  assert.ok(Math.abs((end[1] - hl[1]) * KM - ARROW_HEAD_L_KM) < 0.02, 'dĺžka hrotu');
  const big = attackArrowPolygon(path, { scale: 1.5 });
  assert.ok(Math.abs(Math.abs(big[0][0] - big[big.length - 1][0]) * kx - ARROW_SHAFT_KM * 1.5) < 0.02, 'mierka');
  assert.equal(attackArrowPolygon([[37, 49], [37, 49.001]]), null, 'prikrátka čiara');
  assert.equal(attackArrowPolygon(null), null);
});

test('ARROW_LODS: zblízka pôvodná šípka, z pohľadu na smer väčšia; pásma na seba nadväzujú', () => {
  assert.equal(ARROW_LODS.length, 2);
  const [near, far] = ARROW_LODS;
  assert.equal(near.near, 0);
  assert.equal(near.far, far.near, 'bez medzery a prekryvu');
  assert.ok(far.scale > near.scale && far.lenMinKm > near.lenMinKm && far.lenMaxKm > near.lenMaxKm);
  // šípka pre ďaleký pohľad je dlhšia, hrot stále 0,6 km pred sídlom
  const from = { lon: 37.8, lat: 49.0 }; const to = { lon: 37.8, lat: 49.0 + 2 / KM };
  const pNear = attackArrowPath(from, to, near); const pFar = attackArrowPath(from, to, far);
  assert.ok(kmBetween(pFar[0], pFar[pFar.length - 1]) > kmBetween(pNear[0], pNear[pNear.length - 1]) + 3);
  assert.ok(Math.abs(kmBetween(pFar[pFar.length - 1], [to.lon, to.lat]) - ARROW_HEAD_GAP_KM) < 0.05);
});

test('KARTA: ostré hrany — plná výplň s tmavým obrysom, bez odvodenej línie; pás bojov s nižšou výplňou', () => {
  const k = DEEPSTATE_STYLES.karta;
  assert.equal(k.contact, null, 'odvodená línia sa v KARTE nekreslí');
  assert.ok(k.fillAlpha.occupied >= 0.4 && k.fillCss.occupied && k.outlineCss.occupied, 'výplň a obrys');
  assert.ok(k.width > DEEPSTATE_STYLES.karta.greyWidth && k.outline >= 0.9, 'obrys výraznejší než sivá zóna');
  assert.ok(k.combatBand.uaKm > k.combatBand.ruKm && k.combatBand.fillAlpha >= 0.2, 'sivá zóna ako Rybar: hlavne na ukrajinskej strane a viditeľná');
  const src = readFileSync(new URL('../ukraineDeepStateLayer.js', import.meta.url), 'utf8');
  assert.match(src, /st\.fillCss\?\.\[f\.kind\] \|\| DEEPSTATE_COLORS\[f\.kind\]/);
  assert.match(src, /st\.fillAlpha\?\.\[f\.kind\] \?\? DEEPSTATE_FILL_ALPHA\[f\.kind\]/);
  assert.match(src, /outlineColour\.withAlpha\(lib \? st\.liberatedOutline : st\.outline\)/);
  assert.match(src, /function nearestContactPoint\(lon, lat, \{ reportDay = null \} = \{\}\)/);
  assert.match(src, /sideAt, frontKm, nearestContactPoint,/);
});

test('vrstva hlásenia GŠ: šípky len s líniou, nie do okupovaného, len v KARTE; karta sídla ich vysvetľuje', () => {
  const src = readFileSync(new URL('./ukraineReportLayer.js', import.meta.url), 'utf8');
  assert.match(src, /if \(side === 'ru'\) continue;/, 'sídlo v okupovanom území bez šípky');
  assert.match(src, /if \(!cp \|\| !\(cp\.km <= ARROW_MAX_KM\)\) continue;/);
  assert.match(src, /polygon: \{ hierarchy: new Cesium\.PolygonHierarchy\(positions\)[^}]*zIndex: 13/, 'telo = pozemný polygón nad líniou');
  assert.match(src, /for \(const lod of ARROW_LODS\) \{/, 'dve úrovne detailu');
  assert.match(src, /new Cesium\.DistanceDisplayCondition\(lod\.near, Math\.min\(lod\.far, REPORT_BOLT_FAR_M\)\)/);
  assert.doesNotMatch(src, /PolylineArrowMaterialProperty/, 'PolylineArrow na primknutých čiarach nekreslí hrot');
  assert.match(src, /if \(a\.polygon\) a\.polygon\.show = on; if \(a\.polyline\) a\.polyline\.show = on;/, 'mimo KARTY skryté');
  assert.match(src, /arrows: \[\.\.\._placeRecords\.values\(\)\]\.filter\(\(r\) => r\.arrow\)\.length/);
  assert.match(src, /if \(record\.arrow\) details\.push\(translate\('ukraine\.report\.arrow-note'\)\);/);
  assert.match(src, /const moved = placeAnchors\(\);\s*\/\/[^\n]*\n\s*drawArrows\(\);/, 'nová línia = nové šípky');
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /contactPoint: \(lon, lat, opts\) => window\.__godsEyeView\.ukraineDeepState\?\.nearestContactPoint\?\.\(lon, lat, opts\) \?\? null,/);
  assert.match(main, /sideAt: \(lon, lat\) => window\.__godsEyeView\.ukraineDeepState\?\.sideAt\?\.\(lon, lat\) \?\? null,/);
  const tl = readFileSync(new URL('../ukraineTimeline.js', import.meta.url), 'utf8');
  assert.match(tl, /item\('is-rp-arrow', translate\('ukraine\.rp\.arrow'\)\)/);
  for (const k of ['ukraine.rp.arrow', 'ukraine.karta.legend.attack', 'ukraine.report.arrow-note']) assert.ok(EN_STRINGS[k] && SK_STRINGS[k], k);
  assert.match(SK_STRINGS['ukraine.report.arrow-note'], /odvodená/);
  assert.match(EN_STRINGS['ukraine.karta.legend.attack'], /derived/);
  const items = kartaLegendItems({ report: { shown: true, arrows: 3 }, translate: (k) => k });
  const attack = items.find((i) => i.key === 'attack');
  assert.ok(attack && attack.glyph === 'arrow' && attack.colorCss === KARTA_LEGEND_COLORS.attack);
  assert.ok(!kartaLegendItems({ report: { shown: true, arrows: 0 }, translate: (k) => k }).some((i) => i.key === 'attack'), 'bez šípok bez vzorky');
});
