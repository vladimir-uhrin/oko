// src/data/ukraineFrontChange.test.mjs — zmena frontu za týždeň (2026-09-26):
// rastrový rozdiel ruskej kontroly dvoch snímok DeepState (obsadené / oslobodené,
// km²), posun dňa, a strana sídla pre špendlík KARTY, keď je Wikipédia stará.
// Číslo je ODVODENÉ z dvoch denných polygónov mirroru — legenda aj tip to hovoria.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CHANGE_DAYS, CHANGE_CELL_DEG, daysBetween, occupiedChangeRaster, shiftDay,
} from './ukraineContactLine.js';
import { pickPlaceSide } from './ukraineBase.js';
import { kartaChangeText, kartaLegendItems, kartaTitleModel } from '../ukraineKartaOverlay.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';

const square = (kind, w, s, e, n) => ({ kind, ring: [[w, s], [e, s], [e, n], [w, n], [w, s]], bbox: [w, s, e, n] });

test('shiftDay/daysBetween: UTC, cez mesiac aj rok, neplatné = null', () => {
  assert.equal(shiftDay('2026-09-26', -7), '2026-09-19');
  assert.equal(shiftDay('2026-01-03', -7), '2025-12-27');
  assert.equal(shiftDay('2026-02-28', 1), '2026-03-01');
  assert.equal(shiftDay('26.9.2026', -7), null);
  assert.equal(shiftDay('2026-09-26', NaN), null);
  assert.equal(daysBetween('2026-09-19', '2026-09-26'), 7);
  assert.equal(daysBetween('2026-09-26', '2026-09-19'), -7);
  assert.equal(daysBetween(null, '2026-09-26'), null);
  assert.equal(CHANGE_DAYS, 7);
});

test('occupiedChangeRaster: posun štvorca na východ = obsadený pás vpravo, oslobodený vľavo, plochy ≈ km²', () => {
  // predtým 37,0–37,5 × 48,0–48,5; dnes 37,1–37,6 (posun o 0,1° na východ)
  const before = [square('occupied', 37.0, 48.0, 37.5, 48.5)];
  const now = [square('occupied', 37.1, 48.0, 37.6, 48.5)];
  const ch = occupiedChangeRaster(now, before);
  assert.ok(ch, 'raster existuje');
  assert.equal(ch.cellDeg, CHANGE_CELL_DEG);
  // 0,1° × 0,5° pás = 10 × 50 buniek
  assert.equal(ch.ruCells, 500, 'obsadené bunky');
  assert.equal(ch.cells, 500, 'oslobodené bunky');
  // plocha: 0,1° dĺžky (≈ 7,45 km na 48,25°) × 0,5° šírky (55,66 km) ≈ 415 km²
  const expect = 0.1 * 111.32 * Math.cos((48.25 * Math.PI) / 180) * 0.5 * 111.32;
  assert.ok(Math.abs(ch.gainedKm2 - expect) < expect * 0.03, `gained ${ch.gainedKm2} ≈ ${expect.toFixed(1)}`);
  assert.ok(Math.abs(ch.lostKm2 - expect) < expect * 0.03, `lost ${ch.lostKm2} ≈ ${expect.toFixed(1)}`);
  // obsadené bunky ležia východne od pôvodnej východnej hrany, oslobodené západne od novej západnej
  let gainedWest = Infinity; let lostEast = -Infinity;
  for (let r = 0; r < ch.height; r += 1) for (let c = 0; c < ch.width; c += 1) {
    const idx = r * ch.width + c; const lon = ch.bbox.west + (c + 0.5) * ch.cellDeg;
    if (ch.ruValues[idx]) gainedWest = Math.min(gainedWest, lon);
    if (ch.values[idx]) lostEast = Math.max(lostEast, lon);
  }
  assert.ok(gainedWest >= 37.5 - 1e-9 && lostEast <= 37.1 + 1e-9, 'strany sedia');
  // bbox pokrýva obe snímky
  assert.ok(ch.bbox.west <= 37.0 && ch.bbox.east >= 37.6 && ch.bbox.south <= 48.0 && ch.bbox.north >= 48.5);
});

test('occupiedChangeRaster: bez zmeny = nula; bez ruských polygónov na jednej strane = null; sivá zóna sa neráta', () => {
  const same = [square('occupied', 36, 47, 36.4, 47.3)];
  const ch = occupiedChangeRaster(same, same.map((p) => ({ ...p })));
  assert.ok(ch && ch.cells === 0 && ch.ruCells === 0 && ch.gainedKm2 === 0 && ch.lostKm2 === 0);
  assert.equal(occupiedChangeRaster(same, []), null);
  assert.equal(occupiedChangeRaster([], same), null);
  assert.equal(occupiedChangeRaster(same, [square('grey', 36, 47, 36.4, 47.3)]), null, 'sivá zóna nie je ruská kontrola');
  assert.equal(occupiedChangeRaster(same, same, { maxCells: 10 }), null, 'poistka pamäte');
});

test('pickPlaceSide: čerstvá Wikipédia má prednosť, stará ustúpi DeepState; bez oboch null', () => {
  assert.equal(pickPlaceSide({ wiki: 'contested', deepstate: 'ru', wikiStale: false }), 'contested');
  assert.equal(pickPlaceSide({ wiki: 'contested', deepstate: 'ru', wikiStale: true }), 'ru');
  assert.equal(pickPlaceSide({ wiki: 'ua', deepstate: null, wikiStale: true }), 'ua', 'DeepState mlčí → Wikipédia dopĺňa');
  assert.equal(pickPlaceSide({ wiki: null, deepstate: 'ua' }), 'ua');
  assert.equal(pickPlaceSide({}), null);
});

test('KARTA: text zmeny v titulku a vzorky v legende len so spočítaným rozdielom; formát podľa jazyka', () => {
  const t = (k, p) => `${k}${p ? ':' + Object.entries(p).map(([a, b]) => `${a}=${b}`).join(',') : ''}`;
  const ds = { shown: true, source: 'mirror', features: 12, change: { days: 7, fromDay: '2026-09-19', toDay: '2026-09-26', gainedKm2: 1234.4, lostKm2: 3.6, gainedCells: 1500, lostCells: 4 } };
  assert.equal(kartaChangeText(ds, t, 'en'), 'ukraine.karta.change:days=7,gained=1,234,lost=4');
  assert.match(kartaChangeText(ds, t, 'sk'), /gained=1 234|gained=1 234/, 'slovenské tisíce s medzerou');
  assert.equal(kartaChangeText({ ...ds, change: null }, t), '');
  assert.equal(kartaChangeText({ ...ds, shown: false }, t), '', 'skrytá vrstva nič nehlási');
  const model = kartaTitleModel({ dateText: '26.9.2026', changeText: 'Z', translate: t });
  assert.equal(model.subtitle, 'ukraine.karta.state:date=26.9.2026 · Z');
  const items = kartaLegendItems({ deepstate: ds, translate: t }).map((i) => i.key);
  assert.ok(items.includes('gained') && items.includes('lost'));
  const onlyGained = kartaLegendItems({ deepstate: { ...ds, change: { ...ds.change, lostCells: 0 } }, translate: t }).map((i) => i.key);
  assert.ok(onlyGained.includes('gained') && !onlyGained.includes('lost'), 'bez oslobodených buniek bez vzorky');
  assert.ok(!kartaLegendItems({ deepstate: { ...ds, change: null }, translate: t }).some((i) => i.key === 'gained'));
});

test('i18n: kľúče zmeny v oboch jazykoch hovoria „odvodené"', () => {
  for (const k of ['ukraine.ds.gained', 'ukraine.ds.lost', 'ukraine.ds.change-line', 'ukraine.ds.change-tip', 'ukraine.ds.gained-tip', 'ukraine.ds.lost-tip', 'ukraine.karta.legend.gained', 'ukraine.karta.legend.lost', 'ukraine.karta.change']) {
    assert.ok(EN_STRINGS[k] && SK_STRINGS[k], `${k} v EN aj SK`);
  }
  assert.match(SK_STRINGS['ukraine.ds.change-tip'], /odvodené|nie údaj DeepState/);
  assert.match(EN_STRINGS['ukraine.ds.change-tip'], /derived|not a DeepState figure/);
  assert.match(SK_STRINGS['ukraine.karta.legend.gained'], /odvodené/);
});

test('vrstva DeepState: zmena sa načíta po snímke, kreslí sa ako obdĺžnik nad pásmom a stav ju hlási', () => {
  const src = readFileSync(new URL('../ukraineDeepStateLayer.js', import.meta.url), 'utf8');
  assert.match(src, /change: Object\.freeze\(\{ gainedCss: '#ff2d55'/, 'štýl default');
  assert.match(src, /change: Object\.freeze\(\{ mode: 'vector', lostCss: '#8fd3ff'/, 'štýl karta: vektorové plochy s jasnou hranou (2026-09-26)');
  // Odstup je nastaviteľný (denné video 2026-10-05), predvolene CHANGE_DAYS = 7.
  assert.match(src, /let _changeDays = CHANGE_DAYS;/);
  assert.match(src, /const wantDay = shiftDay\(day, -_changeDays\);/);
  assert.match(src, /snap\.day < day/, 'staršia snímka musí byť naozaj staršia (fallback proxy ide len dozadu)');
  assert.match(src, /if \(_destroyed \|\| _snapshot\?\.day !== day\) return;/, 'výsledok pre iný deň sa zahodí');
  assert.match(src, /id: `\$\{UKRAINE_DEEPSTATE_ID\}:change`,\s*rectangle: \{[^}]*zIndex: 8 \}/, 'obdĺžnik zmeny nad pásmom');
  assert.match(src, /rebuild\(\);\s*emit\(\);\s*void loadChange\(\);/, 'po snímke sa spustí výpočet zmeny');
  assert.match(src, /scene\.drillPick\(pos, 4, 6, 6\)/, 'mimo zmenených buniek sa ukáže, čo je pod obdĺžnikom');
  assert.match(src, /changeLoading: Boolean\(_changeTask\)/);
  const tl = readFileSync(new URL('../ukraineTimeline.js', import.meta.url), 'utf8');
  assert.match(tl, /sw\('is-ds-gained', translate\('ukraine\.ds\.gained'\)\)/);
  assert.match(tl, /'ukraine\.ds\.change-line'/);
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /pickPlaceSide\(\{ wiki: ukraineControl\.sideAt\(lon, lat\), deepstate: ukraineDeepState\.sideAt\(lon, lat\), wikiStale: Boolean\(ukraineControl\.getState\?\.\(\)\?\.stale\) \}\)/);
});
