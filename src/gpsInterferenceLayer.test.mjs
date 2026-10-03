// src/gpsInterferenceLayer.test.mjs — vrstva RUŠENIE GPS · odvodené (etapa 5d, 2026-10-03).
// Telo servera sa skladá z tých istých čistých funkcií ako v archíve, nad skutočnou snímkou
// adsb.lol zo 3. 10. 2026 (fixtúra). Správanie: predvolene vypnuté a nič nesťahuje, bunky
// podľa stupňa (málo lietadiel sa nekreslí), hover hovorí počty, podiel, obdobie a zdroj,
// vypnutie všetko zmaže, výpadok nechá staré bunky, texty v oboch jazykoch, zapojenie v main.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';

import { GPS_FILL_ALPHA, GPS_RELOAD_MS, createGpsInterference, gpsDrawCells } from './gpsInterferenceLayer.js';
import { GPS_ATTRIBUTION, GPS_COLORS, gpsAddSnapshot, gpsEmptyDay, gpsFinalizeDay, gpsMergeDays } from './data/gpsInterference.js';
import { EN_STRINGS, SK_STRINGS } from './i18nStrings.js';

const fx = JSON.parse(readFileSync(new URL('./data/fixtures/adsblol-gps-circles-20261003.json', import.meta.url), 'utf8'));
function payload() {
  const work = gpsEmptyDay('2026-10-03');
  gpsAddSnapshot(work, Object.values(fx).flatMap((j) => j.ac));
  const merged = gpsMergeDays([gpsFinalizeDay(work)]);
  // druhý, vymyslený deň: bunka nad Hormuzom s 50 lietadlami a 4 zhoršenými → (4−1)/50 = 6 % (stredný stupeň)
  const extra = { day: '2026-10-02', snapshots: 96, aircraft: 50, cells: [[52, 112, 50, 4]] };
  const both = gpsMergeDays([gpsFinalizeDay(work), extra]);
  return {
    days: both.days, snapshots: both.snapshots, aircraft: both.aircraft, counts: both.counts, todayPartial: true, attribution: GPS_ATTRIBUTION,
    cells: both.cells.map((c) => [c.latIdx, c.lonIdx, c.total, c.bad, c.badAdjusted, c.level]),
    single: merged.counts,
  };
}
function fakeViewer() {
  const doc = { createElement: () => ({ className: '', hidden: true, style: { setProperty() {} }, remove() {}, textContent: '' }) };
  const viewer = {
    scene: { canvas: null, pick: () => null, requestRender() {} },
    dataSources: { add() {}, remove() {} },
    container: { appendChild() {}, ownerDocument: doc },
  };
  return { viewer, doc };
}
const translate = (k, v) => (v ? `${k}${JSON.stringify(v)}` : k);
const tSk = (k, v) => { const s = SK_STRINGS[k] ?? k; return v ? s.replace(/\{(\w+)\}/g, (m, name) => (name in v ? String(v[name]) : m)) : s; };

test('bunky na kreslenie: len stupne s farbou — bunky s málo lietadlami sa nekreslia', () => {
  const p = payload();
  const cells = gpsDrawCells(p);
  assert.equal(cells.length, p.counts.high + p.counts.medium + p.counts.none);
  assert.ok(cells.length < p.cells.length, 'väčšina buniek jednej snímky má málo lietadiel');
  const amman = cells.find((c) => c.key === '63:71');
  assert.deepEqual([amman.west, amman.south, amman.east, amman.north, amman.level, amman.ratio], [35.5, 31.5, 36, 32, 'high', 0.75]);
  const hormuz = cells.find((c) => c.key === '52:112');
  assert.equal(hormuz.level, 'medium');
  assert.equal(Math.round(hormuz.ratio * 100), 6);
  assert.deepEqual(gpsDrawCells(null), []);
  assert.deepEqual(gpsDrawCells({ cells: [[1, 2, 10, 1, 0, 'thin'], ['x', 2, 10, 1, 0, 'high'], [400, 2, 10, 5, 4, 'high']] }), [], 'málo lietadiel, zlý index, mimo glóbusu');
});

test('predvolene vypnuté a nič nesťahuje; po zapnutí obdĺžnik na bunku vo farbe stupňa; vypnutie zmaže', async () => {
  const { viewer, doc } = fakeViewer();
  const asked = [];
  const layer = createGpsInterference({ viewer, documentRef: doc, translate, now: () => 1000, fetchImpl: async (o) => { asked.push(o); return payload(); } });
  assert.equal(layer.isEnabled(), false);
  assert.equal(asked.length, 0);
  await layer.setEnabled(true);
  assert.deepEqual(asked, [{ days: 2 }]);
  const { ds, cells } = layer._getStateForTest();
  assert.equal(ds.show, true);
  assert.equal(ds.entities.values.length, cells().length);
  const entity = (key) => ds.entities.values.find((e) => e.properties.gpsCell.getValue() === key);
  const fill = (key) => entity(key).rectangle.material.color.getValue();
  const css = (c) => Cesium.Color.fromCssColorString(c);
  assert.ok(Math.abs(fill('63:71').alpha - GPS_FILL_ALPHA.high) < 1e-6);
  assert.ok(Math.abs(fill('63:71').red - css(GPS_COLORS.high).red) < 1e-6);
  assert.ok(Math.abs(fill('52:112').green - css(GPS_COLORS.medium).green) < 1e-6);
  const rect = entity('63:71').rectangle.coordinates.getValue();
  assert.ok(Math.abs(Cesium.Math.toDegrees(rect.west) - 35.5) < 1e-9 && Math.abs(Cesium.Math.toDegrees(rect.north) - 32) < 1e-9, 'obdĺžnik presne na bunke 0,5°');
  const calm = cells().find((c) => c.level === 'none');
  assert.ok(Math.abs(fill(calm.key).alpha - GPS_FILL_ALPHA.none) < 1e-6, 'pokojná bunka len slabou zelenou (kde sú dáta)');
  assert.ok(ds.credit);
  const st = layer.getState();
  assert.equal(st.loaded, true);
  assert.deepEqual(st.days, ['2026-10-02', '2026-10-03']);
  assert.equal(st.todayPartial, true);
  assert.equal(st.counts.high, 1);
  await layer.setEnabled(false);
  assert.equal(ds.entities.values.length, 0);
  assert.equal(ds.show, false);
  assert.equal(ds.credit, undefined);
});

test('hover: čo to je, bunka, počty, podiel po odpočte, obdobie a zdroj — po slovensky', async () => {
  const { viewer, doc } = fakeViewer();
  const layer = createGpsInterference({ viewer, documentRef: doc, translate: tSk, lang: 'sk', fetchImpl: async () => payload() });
  await layer.setEnabled(true);
  const { tipText } = layer._getStateForTest();
  assert.equal(tipText('63:71'), 'Rušenie GPS (odvodené) · šírka 31,5–32°, dĺžka 35,5–36° · lietadlá: 4, so zhoršenou presnosťou: 4 · podiel po odpočte jedného lietadla za deň: 75 % · 2. 10. 2026 – 3. 10. 2026 · zdroj: adsb.lol (ODbL) · výpočet OKO, odvodené');
  assert.match(tipText('52:112'), /lietadlá: 50, so zhoršenou presnosťou: 4 · podiel po odpočte jedného lietadla za deň: 6 %/);
  assert.equal(tipText('0:0'), '');
});

test('výpadok servera: chyba v stave, staré bunky ostanú; obnova až po 10 min; 404 = zberač ešte nemá dáta', async () => {
  const { viewer, doc } = fakeViewer();
  let t = 0; let fail = false; let fetched = 0;
  const layer = createGpsInterference({ viewer, documentRef: doc, translate, now: () => t, fetchImpl: async () => { fetched += 1; if (fail) { const e = new Error('no_gps_snapshot'); e.status = 404; throw e; } return payload(); } });
  await layer.setEnabled(true);
  await layer.setEnabled(false);
  await layer.setEnabled(true);
  assert.equal(fetched, 1, 'opätovné zapnutie do 10 min bez dopytu');
  t = GPS_RELOAD_MS + 1; fail = true;
  await layer.setEnabled(false);
  await layer.setEnabled(true);
  assert.equal(fetched, 2);
  assert.equal(layer.getState().error, 'no_gps_snapshot');
  assert.ok(layer._getStateForTest().ds.entities.values.length > 0, 'staré bunky ostali nakreslené');
  const fresh = createGpsInterference({ viewer, documentRef: doc, translate, fetchImpl: async () => { const e = new Error('no_gps_snapshot'); e.status = 404; throw e; } });
  await fresh.setEnabled(true);
  assert.equal(fresh.getState().loaded, false);
  assert.equal(fresh.getState().error, 'no_gps_snapshot');
});

test('texty v oboch jazykoch a zapojenie v main.js', () => {
  const keys = ['mideast.part.gps', 'mideast.gps.title', 'mideast.gps.high', 'mideast.gps.medium', 'mideast.gps.none', 'mideast.gps.cells', 'mideast.gps.stats', 'mideast.gps.partial',
    'mideast.gps.source', 'mideast.gps.note', 'mideast.gps.loading', 'mideast.gps.error', 'mideast.gps.missing', 'mideast.gps.empty', 'mideast.gps.tip', 'mideast.gps.tip-cell',
    'mideast.gps.tip-count', 'mideast.gps.tip-share', 'mideast.gps.tip-source', 'mideast.gps.credit'];
  for (const k of keys) {
    assert.ok(EN_STRINGS[k], `EN ${k}`);
    assert.ok(SK_STRINGS[k], `SK ${k}`);
  }
  assert.match(SK_STRINGS['mideast.gps.note'], /nie meranie rušičiek/);
  assert.match(SK_STRINGS['mideast.gps.note'], /spoofing sa takto neodhalí/);
  assert.match(SK_STRINGS['mideast.part.gps'], /odvodené/, 'slovo „odvodené" priamo na čipe');
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /import \{ createGpsInterference \} from '\.\/gpsInterferenceLayer\.js';/);
  const created = main.indexOf('const gpsInterference = createGpsInterference({ viewer });');
  assert.ok(created > 0 && main.indexOf('const mideastPanel = createMideastPanel({') > created, 'vrstva vzniká pred panelom');
  assert.match(main, /createMideastPanel\(\{[\s\S]*?gps: gpsInterference,[\s\S]*?\}\);/);
});

test('hover zapojenie: bunka pod kurzorom → počty s farbou stupňa; vypnutá vrstva nehľadá', async () => {
  const { viewer, doc } = fakeViewer();
  const picks = [];
  let under = '63:71';
  viewer.scene.pick = (pos, w, h) => { picks.push({ x: pos.x, y: pos.y, w, h }); return under ? { id: { properties: { gpsCell: { getValue: () => under } } } } : undefined; };
  let cfg = null;
  const calls = [];
  const layer = createGpsInterference({
    viewer, documentRef: doc, translate: tSk, lang: 'sk', fetchImpl: async () => payload(),
    createHoverTip: (o) => { cfg = o; return { el: {}, install() { calls.push('install'); }, hide() { calls.push('hide'); }, destroy() { calls.push('destroy'); } }; },
  });
  assert.equal(cfg.className, 'oko-gps-tip');
  assert.equal(cfg.isActive(), false, 'vrstva je predvolene vypnutá');
  await layer.setEnabled(true);
  assert.ok(calls.includes('install'));
  assert.equal(cfg.isActive(), true);
  const hit = cfg.resolve({ x: 700, y: 410 });
  assert.match(hit.text, /^Rušenie GPS \(odvodené\) · šírka 31,5–32°, dĺžka 35,5–36° · /);
  assert.equal(hit.accent, GPS_COLORS.high);
  assert.deepEqual(picks.at(-1), { x: 700, y: 410, w: 4, h: 4 });
  under = '52:112';
  assert.equal(cfg.resolve({ x: 1, y: 1 }).accent, GPS_COLORS.medium);
  under = null;
  assert.equal(cfg.resolve({ x: 1, y: 1 }), null);
  calls.length = 0;
  await layer.setEnabled(false);
  assert.equal(cfg.isActive(), false);
  assert.ok(calls.includes('hide'), 'vypnutie bublinu zhasne');
  layer.destroy();
  assert.ok(calls.includes('destroy'));
});
