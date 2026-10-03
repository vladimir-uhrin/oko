// src/mideastControlLayer.test.mjs — správca KONTROLY SÍDIEL Blízkeho východu (etapa 2,
// 2026-09-26): lenivé vrstvy po moduloch, ukáž/schovaj podľa dejiska, čip (enabled),
// tvar stavu, rámec rastra = dejisko + okraj, vlastné mená zdroja/entity/kľúča výberu,
// karta s textami modulu (kľúče i18n existujú), odhlásenie, destroy; po oponentúre
// (2026-09-26) rez bodov podľa kódov modulu a mimo rastra, zóny len prvého modulu dejiska,
// deň snímky pamätaný po vrstvách, brána priblíženia v main.js. Cesium je skutočné,
// falošný je len viewer (scene.canvas null → bez ScreenSpaceEventHandler).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { MIDEAST_CONTROL_ID, THEATRE_RASTER_PAD_DEG, createMideastControl, theatreControlModules, theatreRasterBbox } from './mideastControlLayer.js';
import { NEAR_SETTLEMENT_FAR_M, REAR_SETTLEMENT_FAR_M, controlPointRelevance } from './ukraineControlLayer.js';
import { theatreById } from './data/mideastTheatres.js';
import { wikiControlCodes, wikiControlModuleById } from './data/wikiControl.js';
import { SK_STRINGS } from './i18nStrings.js';

function fakeViewer() {
  const events = { addEventListener() {}, removeEventListener() {} };
  const ctx = { fillStyle: '', strokeStyle: '', lineWidth: 1, filter: '', imageSmoothingEnabled: false, clearRect() {}, fillRect() {}, rect() {}, clip() {}, stroke() {}, beginPath() {}, moveTo() {}, lineTo() {}, save() {}, restore() {}, drawImage() {} };
  const doc = { createElement: (tag) => (tag === 'canvas' ? { width: 0, height: 0, getContext: () => ctx } : { className: '', hidden: true, style: { setProperty() {} }, remove() {}, textContent: '' }) };
  const viewer = {
    scene: { canvas: null, pick: () => null, requestRender() {}, postRender: events, primitives: { add: (p) => p, remove() {} } },
    dataSources: { add() {}, remove() {} },
    container: { appendChild() {}, ownerDocument: doc },
  };
  return { viewer, doc };
}

const NOW = Date.UTC(2026, 8, 26, 12);
const IP_POINTS = [
  { lat: 31.5047, lon: 34.4668, icon: 'Location dot lime.svg', side: 'hamas', kind: 'settlement', pressure: null, direction: null, size: 23, pop: '200k', name: 'Gaza City', link: 'Gaza City' },
  { lat: 31.525, lon: 34.5967, icon: 'Location dot blue.svg', side: 'israel', kind: 'settlement', pressure: null, direction: null, size: 14, pop: '20k', name: 'Sderot', link: 'Sderot' },
  { lat: 31.42, lon: 34.38, icon: '80x80-lime-blue-anim.gif', side: 'contested', kind: 'settlement', pressure: null, direction: null, size: 8, pop: '5k', name: 'Netzarim', link: null, between: ['israel', 'hamas'] },
];
const zeros = (ids) => Object.fromEntries(ids.map((id) => [id, 0]));
const IP_SIDES = ['israel', 'pa', 'hamas', 'hezbollah', 'lebanon-locals', 'laf', 'syria', 'jordan', 'popular-forces'];
const ipSnapshot = (day, revisionAt = '2026-09-22T18:56:08Z') => ({
  day: '2026-09-25', module: 'israel-palestine', revisionAt,
  revisions: { main: { title: 'Module:Israeli-Palestinian conflict detailed map', revid: 1, timestamp: revisionAt, url: 'https://en.wikipedia.org/' } },
  count: 3, summary: { settlements: { ...zeros(IP_SIDES), israel: 1, hamas: 1, contested: 1, mixed: 0, none: 0 }, infrastructure: zeros(IP_SIDES), unmapped: {} },
  points: IP_POINTS, license: 'CC BY-SA 4.0', attribution: 'Wikipedia · Israeli-Palestinian conflict detailed map · CC BY-SA 4.0', source: 'wikipedia',
  requestedAt: day, snapshots: 3, first: '2026-09-11', last: '2026-09-25',
});
function fakeFetch({ revisionAt } = {}) {
  const calls = [];
  const fetchControl = async (moduleId, day) => {
    calls.push([moduleId, day]);
    if (moduleId === 'israel-palestine') return ipSnapshot(day, revisionAt);
    const err = new Error('no_control_snapshot'); err.status = 404; throw err;
  };
  return { calls, fetchControl };
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const noTerrain = async () => null;

test('čisté pomocníky: rámec dejiska s okrajom 0,2° (orez na ±90°), moduly dejiska bez neznámych a duplicít', () => {
  assert.equal(THEATRE_RASTER_PAD_DEG, 0.2);
  const b = theatreRasterBbox({ rectDegrees: [34.15, 31.2, 34.6, 31.65] });
  assert.ok(near(b.west, 33.95) && near(b.south, 31.0) && near(b.east, 34.8) && near(b.north, 31.85), JSON.stringify(b));
  assert.equal(theatreRasterBbox({ rectDegrees: [0, 89.95, 1, 90] }).north, 90, 'orez na pól');
  assert.equal(theatreRasterBbox(null), null);
  assert.equal(theatreRasterBbox({ rectDegrees: [1, 2, 3] }), null);
  assert.deepEqual(theatreControlModules({ control: ['yemen', 'mars', 'yemen', 'israel-palestine', 'ukraine'] }), ['yemen', 'israel-palestine'], 'ukraine nie je modul Blízkeho východu');
  assert.deepEqual(theatreControlModules(theatreById('south-lebanon')), ['israel-palestine', 'lebanon']);
  assert.deepEqual(theatreControlModules(theatreById('hormuz')), []);
  assert.deepEqual(theatreControlModules(null), []);
});

test('bez viewera je správca inertný, no s plným API', async () => {
  const inert = createMideastControl({ viewer: null });
  assert.equal(inert.id, MIDEAST_CONTROL_ID);
  assert.deepEqual(inert.getState(), { enabled: false, visible: false, theatreId: null, day: null, style: 'default', modules: [] });
  await inert.setTheatre(theatreById('gaza')); await inert.setEnabled(true); await inert.setDay('2026-09-20');
  assert.equal(inert.isEnabled(), false); assert.equal(inert.isShown(), false);
  assert.equal(await inert.show(), false); inert.hide(); inert.setStyle('karta');
  assert.equal(typeof inert.onChange(() => {}), 'function');
  inert.destroy();
  const { viewer } = fakeViewer();
  assert.equal(createMideastControl({ viewer: { ...viewer, container: {} }, documentRef: null }).getState().enabled, false, 'bez dokumentu tiež inertný');
});

test('dejisko Gaza: vrstva IP vznikne lenivo, ukáže sa a natiahne snímku; stav, rámec rastra, mená zdroja/entity/kľúča; hormuz ju schová', async () => {
  const { viewer, doc } = fakeViewer();
  const { calls, fetchControl } = fakeFetch();
  const m = createMideastControl({ viewer, documentRef: doc, fetchControl, now: () => NOW, translate: (k) => SK_STRINGS[k] ?? k, terrainSampler: noTerrain });
  const { layers, store } = m._getStateForTest();
  assert.equal(layers.size, 0, 'nič sa nevytvára pred dejiskom');
  assert.equal(m.isEnabled(), true, 'čip predvolene zapnutý');
  assert.deepEqual(m.getState(), { enabled: true, visible: true, theatreId: null, day: null, style: 'default', modules: [] });

  await m.setTheatre(theatreById('gaza'));
  assert.deepEqual([...layers.keys()], ['israel-palestine']);
  assert.deepEqual(calls, [['israel-palestine', '2026-09-26']], 'deň = dnes z now()');
  const ip = layers.get('israel-palestine');
  assert.equal(ip.id, 'mideast-control:israel-palestine');
  assert.equal(ip.isShown(), true);
  const st = m.getState();
  assert.equal(st.theatreId, 'gaza');
  assert.equal(st.modules.length, 1);
  const mod = st.modules[0];
  assert.deepEqual(Object.keys(mod).sort(), ['ageDays', 'count', 'error', 'id', 'loading', 'requestedAt', 'revisionAt', 'shown', 'stale', 'summary'].sort());
  assert.equal(mod.id, 'israel-palestine'); assert.equal(mod.shown, true); assert.equal(mod.loading, false); assert.equal(mod.error, null);
  assert.equal(mod.revisionAt, '2026-09-22T18:56:08Z'); assert.equal(mod.requestedAt, '2026-09-26'); assert.equal(mod.ageDays, 3); assert.equal(mod.stale, false);
  assert.equal(mod.count, 3); assert.equal(mod.summary.settlements.hamas, 1);

  const inner = ip._getStateForTest();
  assert.equal(inner.ds.name, 'mideast-control:israel-palestine');
  assert.equal(inner.points.length, 3);
  assert.ok(inner.points.get(0).id['mideastControl:israel-palestine'], 'kľúč výberu per modul');
  assert.equal(inner.points.get(0).id.ukraineControl, undefined);
  assert.ok(inner.zoneEntity, 'raster nakreslený na falošné plátno');
  assert.equal(inner.zoneEntity.id, 'mideast-control:israel-palestine:zones');
  const want = theatreRasterBbox(theatreById('gaza'));
  for (const k of ['west', 'south', 'east', 'north']) assert.ok(near(inner.raster.bbox[k], want[k]), `raster ${k}`);
  assert.equal(inner.raster.cellDeg, 0.02, 'cellDeg z konfigurácie modulu, nie 0,05');
  assert.ok(inner.raster.counts.contested > 0 && inner.raster.counts.hamas >= 0 && 'israel' in inner.raster.counts, 'počty podľa strán modulu');
  // Karta: texty modulu z i18n (kľúče existujú), dvojica sporného sídla, druh z rodičovského prefixu.
  assert.equal(inner.tipText(IP_POINTS[0]), `Gaza City · ${SK_STRINGS['mideast.ctl.israel-palestine.hamas']} · ${SK_STRINGS['mideast.ctl.kind.settlement']}`);
  assert.equal(inner.tipText(IP_POINTS[2]), `Netzarim · ${SK_STRINGS['mideast.ctl.contested']} · ${SK_STRINGS['mideast.ctl.kind.settlement']} · ${SK_STRINGS['mideast.ctl.israel-palestine.israel']} ↔ ${SK_STRINGS['mideast.ctl.israel-palestine.hamas']}`);
  // Tlak z oblúka cez `mideast.ctl.pressure` (tvar bez skloňovania), nie ukrajinské „tlak {side}" (translate tu premenné nedosadzuje).
  assert.equal(inner.tipText({ ...IP_POINTS[2], pressure: 'israel', direction: 'EE' }), `Netzarim · ${SK_STRINGS['mideast.ctl.contested']} · ${SK_STRINGS['mideast.ctl.kind.settlement']} · ${SK_STRINGS['mideast.ctl.israel-palestine.israel']} ↔ ${SK_STRINGS['mideast.ctl.israel-palestine.hamas']} · ${SK_STRINGS['mideast.ctl.pressure']}`);
  assert.ok(store._cache.has('israel-palestine:2026-09-26'));

  await m.setTheatre(theatreById('hormuz'));
  assert.equal(ip.isShown(), false, 'dejisko bez modulov schová vrstvu');
  assert.deepEqual(m.getState().modules, []);
  assert.equal(m.isShown(), false);
  await m.setTheatre(null);
  assert.equal(ip.isShown(), false);
  assert.equal(layers.size, 1, 'vrstva ostáva (lenivo vytvorená, nezahadzuje sa)');
  m.destroy();
});

test('juh Libanonu = dva moduly (lebanon 404 = missing, nie porucha); prepnutie dejiska prekreslí rámec; snímka sa nesťahuje znova', async () => {
  const { viewer, doc } = fakeViewer();
  const { calls, fetchControl } = fakeFetch();
  const m = createMideastControl({ viewer, documentRef: doc, fetchControl, now: () => NOW, translate: (k) => k, terrainSampler: noTerrain });
  const { layers } = m._getStateForTest();
  await m.setTheatre(theatreById('gaza'));
  await m.setTheatre(theatreById('south-lebanon'));
  assert.deepEqual([...layers.keys()], ['israel-palestine', 'lebanon']);
  assert.deepEqual(calls, [['israel-palestine', '2026-09-26'], ['lebanon', '2026-09-26']], 'IP sa nesťahuje druhý raz — snímka ostala');
  const st = m.getState();
  assert.deepEqual(st.modules.map((x) => x.id), ['israel-palestine', 'lebanon']);
  const leb = st.modules[1];
  assert.equal(leb.shown, true); assert.equal(leb.error, 'no_control_snapshot'); assert.equal(leb.revisionAt, null); assert.equal(leb.count, 0); assert.equal(leb.loading, false);
  const ipRaster = layers.get('israel-palestine')._getStateForTest().raster;
  const want = theatreRasterBbox(theatreById('south-lebanon'));
  for (const k of ['west', 'south', 'east', 'north']) assert.ok(near(ipRaster.bbox[k], want[k]), `raster IP prekreslený na juh Libanonu (${k})`);
  assert.equal(layers.get('lebanon')._getStateForTest().raster, null, 'bez snímky bez rastra');
  // Späť na Gazu: libanonská vrstva sa schová, IP ostáva bez ďalšieho dopytu.
  await m.setTheatre(theatreById('gaza'));
  assert.equal(layers.get('lebanon').isShown(), false);
  assert.equal(layers.get('israel-palestine').isShown(), true);
  assert.equal(calls.length, 2);
  m.destroy();
});

test('čip: setEnabled(false) schová vrstvy a stav to hlási; show()/hide() zvonka nemenia čip; setStyle a setDay sa posúvajú vrstvám', async () => {
  const { viewer, doc } = fakeViewer();
  const { calls, fetchControl } = fakeFetch();
  const m = createMideastControl({ viewer, documentRef: doc, fetchControl, now: () => NOW, translate: (k) => k, terrainSampler: noTerrain });
  const { layers } = m._getStateForTest();
  await m.setTheatre(theatreById('west-bank'));
  const ip = layers.get('israel-palestine');
  assert.equal(ip.isShown(), true);
  await m.setEnabled(false);
  assert.equal(m.isEnabled(), false);
  assert.equal(ip.isShown(), false);
  assert.equal(m.getState().enabled, false);
  assert.equal(m.getState().modules[0].shown, false, 'moduly dejiska sa hlásia aj pri vypnutom čipe (legenda vie, čo by kreslila)');
  await m.setEnabled(true);
  assert.equal(ip.isShown(), true);
  // Brána/scéna: hide() bez zmeny čipu.
  m.hide();
  assert.equal(ip.isShown(), false);
  assert.equal(m.isEnabled(), true);
  assert.equal(m.getState().visible, false);
  assert.equal(await m.show(), true);
  assert.equal(ip.isShown(), true);
  // Štýl podkladu: existujúce aj budúce vrstvy.
  m.setStyle('karta');
  assert.equal(ip.getStyle(), 'karta');
  assert.equal(m.getState().style, 'karta');
  await m.setTheatre(theatreById('yemen'));
  assert.equal(layers.get('yemen').getStyle(), 'karta', 'nová vrstva dostane aktuálny štýl');
  m.setStyle('nezmysel');
  assert.equal(ip.getStyle(), 'default');
  // Deň: zobrazené vrstvy si natiahnu snímku pre deň, skryté nie.
  const before = calls.length;
  await m.setDay('2026-09-20');
  assert.equal(m.getState().day, '2026-09-20');
  assert.deepEqual(calls.slice(before), [['yemen', '2026-09-20']], 'len zobrazený jemenský modul');
  await m.setDay('zle');
  assert.equal(m.getState().day, null);
  m.destroy();
});

test('onChange hlási zmeny a odhlásenie ich zastaví; zastaraná revízia = stale podľa prahu modulu (IP 14 dní); destroy zruší vrstvy', async () => {
  const { viewer, doc } = fakeViewer();
  const { fetchControl } = fakeFetch({ revisionAt: '2026-08-01T00:00:00Z' });
  const m = createMideastControl({ viewer, documentRef: doc, fetchControl, now: () => NOW, translate: (k) => k, terrainSampler: noTerrain });
  let n = 0; let last = null;
  const off = m.onChange((s) => { n += 1; last = s; });
  await m.setTheatre(theatreById('gaza'));
  assert.ok(n >= 2, `emit pri dejisku aj po snímke (${n})`);
  assert.equal(last.modules[0].stale, true);
  assert.equal(last.modules[0].ageDays, 56);
  const seen = n;
  off();
  await m.setEnabled(false);
  assert.equal(n, seen, 'po odhlásení už nič');
  const { layers } = m._getStateForTest();
  const ip = layers.get('israel-palestine');
  m.destroy();
  assert.equal(layers.size, 0);
  assert.equal(ip.isShown(), false);
  await m.setTheatre(theatreById('gaza'));
  assert.equal(layers.size, 0, 'po destroy sa nič nevytvára');
});

// Rez bodov (oponentúra 2026-09-26): sporný kód buniek je v module N+1 (IP 10), nie ukrajinská 3
// (= Hamas v IP), a raster kryje len dejisko — bod mimo neho je tyl, nie „pri páse". Body v Gaze:
const CULL_POINTS = [
  { lat: 31.50, lon: 34.40, side: 'hamas', kind: 'settlement', size: 8, name: 'A', link: 'A' }, // pri páse (Izrael 21 km na východ)
  { lat: 31.50, lon: 34.62, side: 'israel', kind: 'settlement', size: 8, name: 'B', link: 'B' }, // 4 bunky od pásu
  { lat: 31.12, lon: 34.05, side: 'hamas', kind: 'settlement', size: 8, name: 'C', link: 'C' }, // osamote v tyle (vlastné bunky = kód 3)
  { lat: 33.00, lon: 35.50, side: 'hamas', kind: 'settlement', size: 8, name: 'D', link: 'D' }, // mimo rastra dejiska Gaza
];
test('rez bodov podľa modulu: sporný kód z konfigurácie (nie ukrajinská 3 = Hamas), mimo rastra dejiska = tyl; predvolené voľby Ukrajiny nezmenené', async () => {
  const { viewer, doc } = fakeViewer();
  const fetchControl = async (moduleId, day) => ({ ...ipSnapshot(day), count: CULL_POINTS.length, points: CULL_POINTS });
  const m = createMideastControl({ viewer, documentRef: doc, fetchControl, now: () => NOW, translate: (k) => k, terrainSampler: noTerrain });
  await m.setTheatre(theatreById('gaza'));
  const inner = m._getStateForTest().layers.get('israel-palestine')._getStateForTest();
  const codes = wikiControlCodes(wikiControlModuleById('israel-palestine'));
  assert.equal(codes.contested, 10); assert.equal(codes.hamas, 3);
  const far = (i) => inner.points.get(i).distanceDisplayCondition?.far ?? null;
  assert.equal(far(0), NEAR_SETTLEMENT_FAR_M, 'A pri páse');
  assert.equal(far(1), NEAR_SETTLEMENT_FAR_M, 'B 4 bunky od pásu = near (s ukrajinským kódom by zmizlo už pri 90 km)');
  assert.equal(far(2), REAR_SETTLEMENT_FAR_M, 'C osamote v tyle = rear (na bunkách Hamasu s kódom 3 by ukrajinský kód dal near)');
  assert.equal(far(3), REAR_SETTLEMENT_FAR_M, 'D mimo rastra dejiska = rear, nie „ako pri páse"');
  // Čistá funkcia nad tým istým rastrom: voľby modulu vs predvolené voľby Ukrajiny (staré správanie ostáva).
  const r = inner.raster;
  assert.deepEqual(CULL_POINTS.map((p) => controlPointRelevance(p, r, { cells: 5, contested: codes.contested, outside: 'rear' })), ['near', 'near', 'rear', 'rear']);
  assert.deepEqual(CULL_POINTS.map((p) => controlPointRelevance(p, r, { cells: 5 })), ['near', 'rear', 'near', 'near'], 'Ukrajina: kód 3 a mimo rastra = near');
  assert.equal(controlPointRelevance(CULL_POINTS[3], null, { outside: 'rear' }), 'near', 'bez rastra vždy „ako pri páse" (aj pre modul)');
  m.destroy();
});

const LEB_SIDES = ['laf', 'hezbollah', 'israel', 'lebanon-locals', 'syria'];
const lebSnapshot = (day) => ({
  day: '2026-09-26', module: 'lebanon', revisionAt: '2026-09-24T09:00:00Z',
  revisions: { main: { title: 'Module:Lebanese insurgency detailed map', revid: 2, timestamp: '2026-09-24T09:00:00Z', url: 'https://en.wikipedia.org/' } },
  count: 2, summary: { settlements: { ...zeros(LEB_SIDES), laf: 1, hezbollah: 1, contested: 0, mixed: 0, none: 0 }, infrastructure: zeros(LEB_SIDES), unmapped: {} },
  points: [
    { lat: 33.56, lon: 35.37, side: 'laf', kind: 'settlement', size: 14, name: 'Sidon', link: 'Sidon' },
    { lat: 33.27, lon: 35.20, side: 'hezbollah', kind: 'settlement', size: 8, name: 'Tyre', link: 'Tyre' },
  ],
  license: 'CC BY-SA 4.0', attribution: 'Wikipedia contributors · Module:Lebanese insurgency detailed map · CC BY-SA 4.0', source: 'wikipedia',
  requestedAt: day, snapshots: 1, first: '2026-09-26', last: '2026-09-26',
});
test('dva moduly v dejisku: raster zón kreslí len prvý modul (juh Libanonu = IP), druhý pridáva len body; poradie dejiska rozhoduje', async () => {
  const { viewer, doc } = fakeViewer();
  const fetchControl = async (moduleId, day) => (moduleId === 'lebanon' ? lebSnapshot(day) : ipSnapshot(day));
  const m = createMideastControl({ viewer, documentRef: doc, fetchControl, now: () => NOW, translate: (k) => k, terrainSampler: noTerrain });
  const { layers } = m._getStateForTest();
  await m.setTheatre(theatreById('south-lebanon'));
  const ip = layers.get('israel-palestine'); const leb = layers.get('lebanon');
  assert.equal(ip.getState().zonesVisible, true); assert.equal(leb.getState().zonesVisible, false);
  assert.equal(ip._getStateForTest().ds.show, true, 'zóny IP viditeľné');
  assert.equal(leb._getStateForTest().ds.show, false, 'zóny libanonského modulu skryté — dva priesvitné rastre by sa nad tými istými dedinami zlievali');
  assert.ok(leb._getStateForTest().raster, 'raster sa aj tak počíta (rez bodov), len sa nekreslí');
  assert.equal(leb._getStateForTest().points.show, true, 'body libanonského modulu ostávajú');
  assert.equal(leb.getState().points, 2);
  assert.equal(m.getState().modules[1].count, 2, 'legenda druhého modulu ostáva plná');
  // Iné poradie dejiska → zóny má prvý v zozname.
  await m.setTheatre({ id: 'test-lebanon-first', rectDegrees: theatreById('south-lebanon').rectDegrees, control: ['lebanon', 'israel-palestine'] });
  assert.equal(leb.getState().zonesVisible, true); assert.equal(ip.getState().zonesVisible, false);
  assert.equal(ip._getStateForTest().ds.show, false); assert.equal(leb._getStateForTest().ds.show, true);
  // Späť na Gazu: IP je jediný → zóny späť, libanonská vrstva skrytá.
  await m.setTheatre(theatreById('gaza'));
  assert.equal(ip.getState().zonesVisible, true); assert.equal(ip._getStateForTest().ds.show, true);
  assert.equal(leb.isShown(), false);
  m.destroy();
});

test('setDay kým je vrstva skrytá: správca si pamätá deň každej vrstvy a pri show() ju natiahne znova; rovnaký deň bez dopytu', async () => {
  const { viewer, doc } = fakeViewer();
  const { calls, fetchControl } = fakeFetch();
  const m = createMideastControl({ viewer, documentRef: doc, fetchControl, now: () => NOW, translate: (k) => k, terrainSampler: noTerrain });
  const { layers } = m._getStateForTest();
  await m.setTheatre(theatreById('gaza'));
  await m.setTheatre(theatreById('hormuz'));
  assert.deepEqual(calls, [['israel-palestine', '2026-09-26']]);
  await m.setDay('2026-09-20');
  assert.equal(calls.length, 1, 'skrytá vrstva sa neťahá hneď');
  assert.equal(m.getState().day, '2026-09-20');
  await m.setTheatre(theatreById('gaza'));
  assert.deepEqual(calls, [['israel-palestine', '2026-09-26'], ['israel-palestine', '2026-09-20']], 'pri show() so zmeneným dňom sa snímka natiahne znova');
  const ip = layers.get('israel-palestine');
  assert.equal(ip.getState().requestedAt, '2026-09-20', 'mapa hovorí o žiadanom dni');
  assert.equal(m.getState().modules[0].requestedAt, '2026-09-20', 'legenda tiež');
  await m.setTheatre(theatreById('west-bank'));
  m.hide(); assert.equal(await m.show(), true);
  assert.equal(calls.length, 2, 'rovnaký deň = bez dopytu');
  // Návrat na dnes pri zobrazenej vrstve: hneď (zo skladu — dnešná snímka je v cache, bez dopytu na server).
  await m.setDay(null);
  assert.equal(ip.getState().requestedAt, '2026-09-26');
  assert.equal(calls.length, 2);
  m.destroy();
});

// Zapojenie v main.js (agent C, 2026-09-26): správca vzniká PRED panelom a panel ho
// dostáva ako `control`; dejisko ho prepína, odchod z dejiska (smer frontu, úžina,
// všeobecná vetva frameConflict) ho nuluje; štýl podkladu sa mu posúva ako vrstvám
// UKRAJINY; brána priblíženia ho schová/ukáže bez zmeny čipu; nikdy nie je v reťazi
// ukraineBase.setSideResolver. Nástražné drôty nad textom zdroja — rovnaký vzor ako
// mideastPanel.test.mjs a ukraineAlertAreasLayer.test.mjs.
test('tripwires main.js: správca pred panelom a v ňom, window API, setTheatre v 4 miestach, štýl podkladu, brána priblíženia, mimo resolvera strán UKRAJINY', () => {
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');

  // Brána priblíženia: pri pohľade na planétu sa body aj raster schovajú, čip ostáva (show/hide, nikdy setEnabled).
  assert.match(main, /const revealGate = createSceneRevealGate\(\{[\s\S]*?onChange: \(visible\) => \{[\s\S]*?if \(visible\) void mideastControl\.show\(\); else mideastControl\.hide\(\);[\s\S]*?\},\s*\}\);/, 'brána priblíženia schová/ukáže kontrolu sídiel');
  const gate = main.slice(main.indexOf('const revealGate = createSceneRevealGate('), main.indexOf('window.__godsEyeView.sceneRevealGate'));
  assert.doesNotMatch(gate, /mideastControl\.setEnabled/, 'brána nemení čip');

  assert.match(main, /import \{ createMideastControl \} from '\.\/mideastControlLayer\.js';/);
  assert.match(main, /const mideastControl = createMideastControl\(\{ viewer \}\);/);
  assert.match(main, /window\.__godsEyeView\.mideastControl = mideastControl;/);
  // Správca musí existovať skôr než panel, ktorý z neho kreslí čip a legendu.
  const created = main.indexOf('const mideastControl = createMideastControl({ viewer });');
  const panel = main.indexOf('const mideastPanel = createMideastPanel({');
  assert.ok(created > 0 && panel > created, 'createMideastControl pred createMideastPanel');
  // Etapa 5b (2026-10-03): za správcom kontroly ide do panela aj VZDUŠNÝ PRIESTOR · EASA.
  assert.match(main, /createMideastPanel\(\{[\s\S]*?applyTheatre: \(id\) => runMideastTheatre\(id\),\s*control: mideastControl,\s*airspace: airspaceAdvisory,\s*\}\)/);

  // Dejisko prepne moduly (po stave, pred rámovaním); smer frontu, úžina a všeobecná vetva
  // frameConflict ho nulujú — štyri miesta, presne štyri volania setTheatre.
  const runTheatre = main.slice(main.indexOf('const runMideastTheatre = (id) =>'), main.indexOf('window.__godsEyeView.mideastTheatres'));
  assert.match(runTheatre, /mideastPanel\?\.setActiveTheatre\?\.\(scene\?\.id \|\| null\);[\s\S]*?void mideastControl\.setTheatre\(scene \|\| null\);[\s\S]*?return applyMideastTheatre\(id, theatreDeps\);/, 'setTheatre(scene) po stave a pred rámovaním');
  const runFront = main.slice(main.indexOf('const runFrontScene = (id) =>'), main.indexOf('const ukraineDirectionCard'));
  const runChoke = main.slice(main.indexOf('const runChokepointScene = (id) =>'), main.indexOf('window.__godsEyeView.chokepointScenes'));
  const frameElse = main.slice(main.indexOf('activeChokepoint = null; activeFrontScene = null; activeTheatre = null;'), main.indexOf('restoreAutoKarta();', main.indexOf('activeChokepoint = null; activeFrontScene = null; activeTheatre = null;')));
  for (const [name, body] of [['runFrontScene', runFront], ['runChokepointScene', runChoke], ['frameConflict else', frameElse]]) {
    assert.match(body, /void mideastControl\.setTheatre\(null\);/, `${name} schová kontrolu sídiel dejiska`);
  }
  assert.equal([...main.matchAll(/mideastControl\.setTheatre\(/g)].length, 4, 'presne štyri volania setTheatre (dejisko + 3 odchody)');

  // Štýl podkladu ako pri vrstvách UKRAJINY (hillshade = karta), pri štarte aj pri zmene.
  assert.match(main, /const applyMideastControlStyle = \(stack\) => mideastControl\.setStyle\(stack\?\.kind === 'hillshade' \? 'karta' : 'default'\);/);
  assert.match(main, /applyMideastControlStyle\(getActiveMapStack\(\)\);/);
  assert.match(main, /onActiveMapStackChange\(applyMideastControlStyle\);/);

  // Nikdy v reťazi resolvera strán podkladu UKRAJINY — iný modul, iná legenda.
  const resolver = main.slice(main.indexOf('ukraineBase.setSideResolver('), main.indexOf(';', main.indexOf('ukraineBase.setSideResolver(')));
  assert.doesNotMatch(resolver, /mideastControl/, 'mideastControl mimo ukraineBase.setSideResolver');
});
