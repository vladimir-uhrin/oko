// src/ukmtoIncidentsLayer.test.mjs — vrstva INCIDENTY LODÍ · UKMTO (etapa 5c, 2026-10-03).
// Incidenty zo skutočnej odpovede UKMTO (fixtúra) cez ten istý parser ako archív servera.
// Správanie: sťahuje až pri aktívnej scéne a zapnutom čipe (nie pri štarte), brána priblíženia
// len schováva, farba = druh, veľkosť = vek, hover cituje varovanie a menuje zdroj, výpadok
// nechá staré body, texty v oboch jazykoch, zapojenie v main.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';

import { UKMTO_POINT_ALPHA, UKMTO_POINT_SIZE, UKMTO_RELOAD_MS, createUkmtoIncidents, ukmtoColour, ukmtoSlug } from './ukmtoIncidentsLayer.js';
import { UKMTO_ATTRIBUTION, UKMTO_LICENSE_URL, UKMTO_TYPES, parseUkmtoIncidents } from './data/ukmto.js';
import { EN_STRINGS, SK_STRINGS } from './i18nStrings.js';

const incidents = parseUkmtoIncidents(JSON.parse(readFileSync(new URL('./data/fixtures/ukmto-all-20261003.json', import.meta.url), 'utf8')));
const NOW = Date.parse('2026-10-03T16:00:00Z');
const payload = () => ({ incidents, fetchedAt: NOW - 600_000, archived: incidents.length, attribution: UKMTO_ATTRIBUTION, licenseUrl: UKMTO_LICENSE_URL, source: 'https://www.ukmto.org/recent-incidents' });

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

test('nesťahuje pri štarte: až zapnutý čip + aktívna scéna; brána priblíženia len schováva', async () => {
  const { viewer, doc } = fakeViewer();
  const asked = [];
  const layer = createUkmtoIncidents({ viewer, documentRef: doc, translate, now: () => NOW, fetchImpl: async (o) => { asked.push(o); return payload(); } });
  assert.equal(layer.isEnabled(), true, 'čip je predvolene zapnutý');
  assert.equal(layer.getState().active, false);
  assert.equal(asked.length, 0, 'bez scény žiadny dopyt');
  const { ds } = layer._getStateForTest();
  assert.equal(ds.show, false);
  await layer.setActive(true);
  assert.deepEqual(asked, [{ days: 90 }]);
  assert.equal(ds.show, true);
  assert.equal(ds.entities.values.length, incidents.length);
  assert.ok(ds.credit, 'atribúcia UKMTO + OGL v kredite');
  await layer.hide();
  assert.equal(ds.show, false, 'pohľad na planétu');
  assert.equal(ds.credit, undefined);
  assert.equal(layer.isEnabled(), true, 'čip ostáva');
  await layer.show();
  assert.equal(ds.show, true);
  await layer.setEnabled(false);
  assert.equal(ds.show, false);
  await layer.setEnabled(true);
  await layer.setActive(false);
  assert.equal(ds.show, false, 'odchod zo scény (front, všeobecný rám)');
  assert.equal(asked.length, 1, 'všetko z jedného stiahnutia');
});

test('vypnutý čip pred prvou scénou: scéna nič nesťahuje, kým ho používateľ nezapne', async () => {
  const { viewer, doc } = fakeViewer();
  let fetched = 0;
  const layer = createUkmtoIncidents({ viewer, documentRef: doc, translate, now: () => NOW, fetchImpl: async () => { fetched += 1; return payload(); } });
  await layer.setEnabled(false);
  await layer.setActive(true);
  assert.equal(fetched, 0);
  await layer.setEnabled(true);
  assert.equal(fetched, 1);
});

test('body: farba podľa druhu, veľkosť a sýtosť podľa veku, čerstvé navrchu', async () => {
  const { viewer, doc } = fakeViewer();
  const layer = createUkmtoIncidents({ viewer, documentRef: doc, translate, now: () => NOW, fetchImpl: async () => payload() });
  await layer.setActive(true);
  const { ds } = layer._getStateForTest();
  const entity = (ref) => { const id = incidents.find((x) => x.ref === ref).id; return ds.entities.values.find((e) => e.properties.ukmtoId.getValue() === id); };
  const style = (ref) => { const p = entity(ref).point; return { size: p.pixelSize.getValue(), colour: p.color.getValue() }; };
  const css = (c) => Cesium.Color.fromCssColorString(c);
  const fresh = style('149-26'); // útok 2. 10. — do 7 dní
  assert.equal(fresh.size, UKMTO_POINT_SIZE.fresh);
  assert.ok(Math.abs(fresh.colour.alpha - UKMTO_POINT_ALPHA.fresh) < 1e-6);
  assert.ok(Math.abs(fresh.colour.red - css(ukmtoColour('attack')).red) < 1e-6);
  const recent = style('127-26'); // upozornenie 5. 9. — do 30 dní
  assert.equal(recent.size, UKMTO_POINT_SIZE.recent);
  assert.ok(Math.abs(recent.colour.blue - css(ukmtoColour('advisory')).blue) < 1e-6);
  const old = style('090-26'); // únos 17. 7.
  assert.equal(old.size, UKMTO_POINT_SIZE.old);
  assert.ok(Math.abs(old.colour.alpha - UKMTO_POINT_ALPHA.old) < 1e-6);
  assert.ok(Math.abs(old.colour.red - css(ukmtoColour('hijack')).red) < 1e-6);
  assert.equal(ds.entities.values.at(-1).properties.ukmtoId.getValue(), incidents[0].id, 'najnovší incident je pridaný posledný = navrchu');
  const pos = Cesium.Cartographic.fromCartesian(entity('149-26').position.getValue());
  assert.ok(Math.abs(Cesium.Math.toDegrees(pos.latitude) - 26.22) < 0.01 && Math.abs(Cesium.Math.toDegrees(pos.longitude) - 56.57) < 0.01, 'bod leží na polohe z varovania');
  assert.equal(ukmtoColour('nonsense'), '#8aa0b6');
  assert.equal(ukmtoSlug('Strait of Hormuz'), 'strait-of-hormuz');
  assert.equal(ukmtoSlug(' Tanker '), 'tanker');
});

test('hover: číslo varovania, druh, čas UTC, oblasť, plavidlo, citát varovania, zdroj — po slovensky', async () => {
  const { viewer, doc } = fakeViewer();
  const layer = createUkmtoIncidents({ viewer, documentRef: doc, translate: tSk, lang: 'sk', now: () => NOW, fetchImpl: async () => payload() });
  await layer.setActive(true);
  const { tipText } = layer._getStateForTest();
  const tip = tipText(incidents[0].id);
  assert.match(tip, /^UKMTO 149-26 · útok · 2\. 10\. 2026,? 23:11 UTC · Hormuzský prieliv · tanker · „UKMTO has received a report of an incident 4nm east of Oman\./);
  assert.match(tip, /zdroj: UKMTO \(OGL v3\.0\) · hlásené, poloha podľa varovania$/);
  assert.ok(tip.length < 420, 'citát je skrátený');
  assert.equal(tipText('nope'), '');
  // popisky pre panel: neznáme miesto a druh padnú na text UKMTO, nie na holý kľúč
  assert.equal(layer.labels.place({ place: 'Mozambique Channel' }), 'Mozambique Channel');
  assert.equal(layer.labels.type({ type: 'other', typeName: 'Something New' }), 'iné');
  assert.equal(layer.labels.vessel({ vesselType: null }), '');
});

test('priebežná obnova: kým je čip zapnutý a scéna aktívna, stránka si každých 5 min pýta nové varovania; mimo scény nie', async () => {
  const { viewer, doc } = fakeViewer();
  const timers = [];
  const cleared = [];
  let fetched = 0;
  const fresh = { ...incidents[0], id: 'new-warning', ref: '150-26', t: NOW + 60_000 };
  const layer = createUkmtoIncidents({
    viewer, documentRef: doc, translate, now: () => NOW,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: (id) => cleared.push(id),
    fetchImpl: async () => { fetched += 1; return fetched === 1 ? payload() : { ...payload(), incidents: [fresh, ...incidents] }; },
  });
  assert.equal(timers.length, 0, 'bez scény žiadny časovač');
  await layer.setActive(true);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, UKMTO_RELOAD_MS);
  assert.equal(UKMTO_RELOAD_MS, 5 * 60_000, 'vlastník: čo najaktuálnejšie');
  await layer.hide();
  await layer.show();
  assert.equal(timers.length, 1, 'brána priblíženia časovač nezdvojí');
  timers[0].fn(); // tik obnovy
  await new Promise((r) => setImmediate(r));
  assert.equal(fetched, 2, 'tik sťahuje aj keď od načítania neprešlo celých 5 min podľa hodín testu');
  assert.equal(layer.getState().incidents[0].ref, '150-26', 'nové varovanie je v stave');
  assert.equal(layer._getStateForTest().ds.entities.values.length, incidents.length + 1, 'a na mape');
  await layer.setActive(false);
  assert.deepEqual(cleared, [1], 'odchod zo scény časovač zruší');
  timers[0].fn();
  await new Promise((r) => setImmediate(r));
  assert.equal(fetched, 2, 'neaktívna vrstva nesťahuje ani keby tik ešte prišiel');
  await layer.setActive(true);
  assert.equal(timers.length, 2, 'nová scéna = nový časovač');
  layer.destroy();
  assert.deepEqual(cleared, [1, 2]);
});

test('výpadok servera: chyba v stave, staré body ostanú; návrat do scény sťahuje až po 5 min; súhrn pre legendu', async () => {
  const { viewer, doc } = fakeViewer();
  let t = NOW;
  let fail = false;
  let fetched = 0;
  const layer = createUkmtoIncidents({ viewer, documentRef: doc, translate, now: () => t, fetchImpl: async () => { fetched += 1; if (fail) { const e = new Error('no_ukmto_snapshot'); e.status = 404; throw e; } return payload(); } });
  await layer.setActive(true);
  const st = layer.getState();
  assert.equal(st.loaded, true);
  assert.equal(st.summary.total, 5);
  assert.deepEqual(st.summary.byType.map((x) => [x.type, x.count]), [['attack', 4], ['advisory', 1]]);
  assert.equal(st.summary.latest.length, 5);
  assert.equal(st.fetchedAt, NOW - 600_000);
  await layer.setActive(false);
  await layer.setActive(true);
  assert.equal(fetched, 1, 'návrat do scény do 5 min bez dopytu');
  t = NOW + UKMTO_RELOAD_MS + 1;
  fail = true;
  await layer.setActive(false);
  await layer.setActive(true);
  assert.equal(fetched, 2);
  assert.equal(layer.getState().error, 'no_ukmto_snapshot');
  assert.equal(layer._getStateForTest().ds.entities.values.length, incidents.length, 'staré body ostali');
});

test('texty v oboch jazykoch: čip, legenda, druhy, plavidlá, oblasti', () => {
  const keys = ['mideast.part.ukmto', 'mideast.ukmto.title', 'mideast.ukmto.latest', 'mideast.ukmto.none', 'mideast.ukmto.inactive', 'mideast.ukmto.since', 'mideast.ukmto.source',
    'mideast.ukmto.link', 'mideast.ukmto.note', 'mideast.ukmto.loading', 'mideast.ukmto.error', 'mideast.ukmto.missing', 'mideast.ukmto.tip-source', 'mideast.ukmto.credit', 'mideast.ukmto.type.other',
    ...UKMTO_TYPES.map((x) => `mideast.ukmto.type.${x.id}`),
    ...['tanker', 'cargo', 'merchant', 'other'].map((v) => `mideast.ukmto.v.${v}`),
    ...[...new Set(incidents.map((x) => x.place))].map((p) => `mideast.ukmto.p.${ukmtoSlug(p)}`)];
  for (const k of keys) {
    assert.ok(EN_STRINGS[k], `EN ${k}`);
    assert.ok(SK_STRINGS[k], `SK ${k}`);
  }
  assert.match(SK_STRINGS['mideast.ukmto.title'], /\{days\}/);
  assert.match(SK_STRINGS['mideast.ukmto.source'], /Open Government Licence v3\.0/);
  for (const vessel of new Set(incidents.map((x) => x.vesselType).filter(Boolean))) assert.ok(SK_STRINGS[`mideast.ukmto.v.${ukmtoSlug(vessel)}`], `druh plavidla ${vessel}`);
});

test('main.js: vrstva pozná bránu priblíženia, ide do panela a prepína sa pri každej scéne', () => {
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /import \{ createUkmtoIncidents \} from '\.\/ukmtoIncidentsLayer\.js';/);
  assert.match(main, /let ukmtoIncidents = null;[^\n]*\n[\s\S]*?const revealGate = createSceneRevealGate\(/, 'premenná vzniká PRED bránou (žiadna TDZ v spätnom volaní)');
  assert.match(main, /if \(visible\) void ukmtoIncidents\?\.show\(\); else void ukmtoIncidents\?\.hide\(\);/);
  assert.match(main, /ukmtoIncidents = createUkmtoIncidents\(\{ viewer \}\);\n\s+window\.__godsEyeView\.ukmtoIncidents = ukmtoIncidents;/);
  assert.match(main, /ukmto: ukmtoIncidents,/);
  assert.equal((main.match(/void ukmtoIncidents\?\.setActive\(false\);/g) || []).length, 2, 'scéna frontu a všeobecný rám vrstvu vypnú');
  assert.match(main, /void ukmtoIncidents\?\.setActive\(UKMTO_CHOKEPOINT_SCENES\.includes\(scene\?\.id\)\);/, 'úžiny len v oblasti UKMTO');
  assert.match(main, /void ukmtoIncidents\?\.setActive\(Boolean\(scene\)\);/, 'každé dejisko Blízkeho východu');
});
