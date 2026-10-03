// src/airspaceAdvisoryLayer.test.mjs — vrstva VZDUŠNÝ PRIESTOR (EASA CZIB, etapa 5b, 2026-10-03).
// Telo servera z fixtúry (archív nad skutočnými odpoveďami EASA zo 3. 10. 2026 a výrezom VATSpy).
// Správanie: bez zapnutia nič nesťahuje; celý FIR = výplň + obrys, časť FIR = len prerušovaný
// obrys; farba podľa výšok; hover hovorí čo, odkedy-dokedy, odkiaľ; vypnutie všetko zmaže;
// výpadok servera nechá staré dáta a hlási chybu; texty v oboch jazykoch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';

import { AIRSPACE_COLOR_ALL, AIRSPACE_COLOR_BELOW, AIRSPACE_RELOAD_MS, airspaceColour, airspaceModels, createAirspaceAdvisory } from './airspaceAdvisoryLayer.js';
import { EN_STRINGS, SK_STRINGS } from './i18nStrings.js';

const payload = JSON.parse(readFileSync(new URL('./data/fixtures/airspace-payload-20261003.json', import.meta.url), 'utf8'));

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

test('modely: Blízky východ hore, len FIR s polygónom, odkaz len na easa.europa.eu', () => {
  const models = airspaceModels(payload);
  assert.equal(models.length, 5);
  assert.deepEqual(models.map((m) => m.mideast), [true, true, true, false, false], 'Sýria, Irak, Záliv pred Líbyou a Ukrajinou');
  const ua = models.find((m) => m.czib === 'CZIB-2022-01R14');
  assert.deepEqual(ua.firs, ['UKLV', 'UKBV'], 'kódy bez hranice (UKBU…) sa nekreslia');
  assert.equal(airspaceModels({ bulletins: [{ nid: 1, url: 'https://evil.example/x', firs: [] }], firs: {} })[0].url, null);
  assert.equal(airspaceColour({ altitude: 'below' }), AIRSPACE_COLOR_BELOW);
  assert.equal(airspaceColour({ altitude: 'all' }), AIRSPACE_COLOR_ALL);
  assert.deepEqual(airspaceModels(null), []);
});

test('vrstva: bez zapnutia nič nesťahuje; celý FIR výplň + obrys, časť FIR len prerušovaný obrys', async () => {
  const { viewer, doc } = fakeViewer();
  let fetched = 0;
  const layer = createAirspaceAdvisory({ viewer, documentRef: doc, translate, fetchImpl: async () => { fetched += 1; return payload; }, now: () => 1_000 });
  assert.equal(fetched, 0);
  assert.equal(layer.isEnabled(), false);
  await layer.setEnabled(true);
  assert.equal(fetched, 1);
  const { ds } = layer._getStateForTest();
  assert.equal(ds.show, true);
  const byNid = (nid) => ds.entities.values.filter((e) => e.properties.czibNid.getValue() === nid);
  const iraq = byNid('143862');
  assert.equal(iraq.filter((e) => e.polygon).length, 1, 'Irak: celý FIR → výplň');
  assert.equal(iraq.filter((e) => e.polyline).length, 1);
  assert.ok(Math.abs(iraq.find((e) => e.polygon).polygon.material.color.getValue().alpha - 0.16) < 1e-6);
  const gulf = byNid('143899');
  assert.equal(gulf.filter((e) => e.polygon).length, 0, 'Záliv „nad vodami" = časť FIR → bez výplne');
  assert.equal(gulf.filter((e) => e.polyline).length, 5, 'päť FIR obrysom');
  assert.ok(gulf[0].polyline.material instanceof Cesium.PolylineDashMaterialProperty, 'prerušovaný obrys');
  const libya = byNid('20582');
  const libyaFill = libya.find((e) => e.polygon).polygon.material.color.getValue();
  assert.ok(Math.abs(libyaFill.alpha - 0.12) < 1e-6, 'pod FL320 = slabšia jantárová výplň');
  assert.ok(Math.abs(libyaFill.red - Cesium.Color.fromCssColorString(AIRSPACE_COLOR_BELOW).red) < 1e-6);
  assert.ok(ds.credit, 'atribúcia EASA + VATSpy v kredite');
  const st = layer.getState();
  assert.equal(st.enabled, true);
  assert.equal(st.bulletins.length, 5);
  assert.deepEqual(st.missingFirs, ['UKBU', 'UKDV', 'UKFV', 'UKOV']);
  await layer.setEnabled(false);
  assert.equal(ds.entities.values.length, 0);
  assert.equal(ds.show, false);
  assert.equal(ds.credit, undefined);
});

test('hover: číslo, FIR, výšky, časť/výnimky, platnosť, citát EASA a zdroj', async () => {
  const { viewer, doc } = fakeViewer();
  const layer = createAirspaceAdvisory({ viewer, documentRef: doc, translate, fetchImpl: async () => payload, lang: 'sk' });
  await layer.setEnabled(true);
  const { tipText } = layer._getStateForTest();
  const gulf = tipText('143899', 'OBBB');
  assert.match(gulf, /^CZIB-2026-07R3 · FIR OBBB · Airspace of the Persian Gulf and Gulf of Oman · mideast\.air\.all · mideast\.air\.partial · mideast\.air\.exceptions · mideast\.air\.until\{"date":"16\. 11\. 2026"\}/);
  assert.match(gulf, /„Not operate at all altitudes and flight levels within the airspace over the waters/);
  assert.match(gulf, /mideast\.air\.tip-source$/);
  assert.match(tipText('20582', 'HLLL'), /mideast\.air\.below\{"fl":320\}/);
  assert.equal(tipText('nope', null), '');
});

test('výpadok servera: chyba v stave, staré dáta ostanú; obnova až po 30 min', async () => {
  const { viewer, doc } = fakeViewer();
  let t = 0;
  let fail = false;
  let fetched = 0;
  const layer = createAirspaceAdvisory({ viewer, documentRef: doc, translate, now: () => t, fetchImpl: async () => { fetched += 1; if (fail) { const e = new Error('no_airspace_snapshot'); e.status = 404; throw e; } return payload; } });
  await layer.setEnabled(true);
  await layer.setEnabled(false);
  await layer.setEnabled(true);
  assert.equal(fetched, 1, 'opätovné zapnutie do 30 min bez dopytu');
  t = AIRSPACE_RELOAD_MS + 1;
  fail = true;
  await layer.setEnabled(false);
  await layer.setEnabled(true);
  assert.equal(fetched, 2);
  assert.equal(layer.getState().error, 'no_airspace_snapshot');
  assert.equal(layer.getState().bulletins.length, 5, 'staré bulletiny ostali');
  assert.ok(layer._getStateForTest().ds.entities.values.length > 0, 'a ostali nakreslené');
});

test('texty vrstvy a legendy v oboch jazykoch', () => {
  const keys = ['mideast.part.airspace', 'mideast.air.title', 'mideast.air.all', 'mideast.air.below', 'mideast.air.partial', 'mideast.air.partial-tip',
    'mideast.air.exceptions', 'mideast.air.until', 'mideast.air.lapsed', 'mideast.air.more', 'mideast.air.since', 'mideast.air.source', 'mideast.air.note',
    'mideast.air.loading', 'mideast.air.error', 'mideast.air.missing', 'mideast.air.link', 'mideast.air.tip-source', 'mideast.air.credit'];
  for (const k of keys) {
    assert.ok(EN_STRINGS[k], `EN ${k}`);
    assert.ok(SK_STRINGS[k], `SK ${k}`);
  }
  assert.match(SK_STRINGS['mideast.air.below'], /\{fl\}/);
  assert.match(SK_STRINGS['mideast.air.note'], /nie zákaz/);
  assert.match(EN_STRINGS['mideast.air.source'], /VATSpy.*CC BY-SA 4\.0/);
});

test('hover zapojenie: plocha FIR pod kurzorom → bulletin s farbou podľa výšok; vypnutá vrstva nehľadá', async () => {
  const { viewer, doc } = fakeViewer();
  const picks = [];
  let under = { nid: '143899', fir: 'OBBB' };
  viewer.scene.pick = (pos, w, h) => {
    picks.push({ x: pos.x, y: pos.y, w, h });
    return under ? { id: { properties: { czibNid: { getValue: () => under.nid }, firCode: { getValue: () => under.fir } } } } : undefined;
  };
  let cfg = null;
  const calls = [];
  const layer = createAirspaceAdvisory({
    viewer, documentRef: doc, translate, fetchImpl: async () => payload, lang: 'sk',
    createHoverTip: (o) => { cfg = o; return { el: {}, install() { calls.push('install'); }, hide() { calls.push('hide'); }, destroy() { calls.push('destroy'); } }; },
  });
  assert.equal(cfg.className, 'oko-air-tip');
  assert.equal(cfg.isActive(), false, 'vrstva je predvolene vypnutá');
  await layer.setEnabled(true);
  assert.ok(calls.includes('install'));
  assert.equal(cfg.isActive(), true);
  const hit = cfg.resolve({ x: 512, y: 300 });
  assert.match(hit.text, /^CZIB-2026-07R3 · FIR OBBB · /);
  assert.equal(hit.accent, AIRSPACE_COLOR_ALL, 'všetky výšky = červená');
  assert.deepEqual(picks.at(-1), { x: 512, y: 300, w: 6, h: 6 });
  under = { nid: '20582', fir: 'HLLL' };
  assert.equal(cfg.resolve({ x: 1, y: 1 }).accent, AIRSPACE_COLOR_BELOW, 'pod letovou hladinou = jantárová');
  under = null;
  assert.equal(cfg.resolve({ x: 1, y: 1 }), null);
  calls.length = 0;
  await layer.setEnabled(false);
  assert.equal(cfg.isActive(), false);
  assert.ok(calls.includes('hide'), 'vypnutie bublinu zhasne');
  layer.destroy();
  assert.ok(calls.includes('destroy'));
});
