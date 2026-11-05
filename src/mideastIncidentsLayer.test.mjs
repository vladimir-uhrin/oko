// src/mideastIncidentsLayer.test.mjs — vrstva OVERENÉ UDALOSTI modulu BLÍZKY VÝCHOD (etapa 4,
// 2026-11-05). Udalosti zo skutočných riadkov exportu GeoConfirmed (fixtúry) cez ten istý model ako
// archív servera. Správanie: sťahuje až pri dejisku a zapnutom čipe, brána priblíženia len schováva,
// obdobie osi (7 d / 30 d / od 28. 2.) s počtami zo súhrnu, dlhé obdobie po kusoch ≤ 31 dní, farba =
// druh, veľkosť = vek, bublina a karta (dátum, miesto, popis, štítok, odkaz), panel, texty, zapojenie.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';

import { INCIDENTS_POINT_ALPHA, INCIDENTS_POINT_SIZE, INCIDENTS_RELOAD_MS, createMideastIncidents, incidentColour } from './mideastIncidentsLayer.js';
import { MIDEAST_ACTORS, MIDEAST_INCIDENT_TYPES, parseGeoconfirmedIncidents } from './data/mideastIncidents.js';
import { createMideastPanel } from './mideastPanel.js';
import { EN_STRINGS, SK_STRINGS } from './i18nStrings.js';

const fixture = (name) => readFileSync(new URL(`./data/fixtures/${name}`, import.meta.url), 'utf8');
const ALL = [
  ...parseGeoconfirmedIncidents(fixture('geoconfirmed-iran-20261105.csv'), { conflict: 'iran' }).incidents,
  ...parseGeoconfirmedIncidents(fixture('geoconfirmed-israel-20261105.csv'), { conflict: 'israel' }).incidents,
].filter((x) => x.day <= '2026-03-31').sort((a, b) => b.t - a.t);
// „Teraz" = 31. 3. 2026: 13 udalostí od 28. 2. (Irán 28. 2. – 1. 3., Izrael 8., 20. a 29. 3.); okno 30 dní
// (od 2. 3.) = 3 udalosti, 7 dní (od 25. 3.) = 1, „od 28. 2." = 13.
const NOW = Date.parse('2026-03-31T12:00:00Z');
const IN30 = ALL.filter((x) => x.day >= '2026-03-02');
const GAZA = { id: 'gaza', rectDegrees: [34.15, 31.2, 34.6, 31.65] };
const OVERVIEW = { id: 'overview', rectDegrees: [30, 11, 63, 40], overview: true };

function fakeViewer() {
  const make = () => ({ className: '', hidden: true, style: { setProperty() {} }, remove() {}, textContent: '', children: [], appendChild(c) { this.children.push(c); return c; }, replaceChildren(...c) { this.children = c; }, setAttribute() {}, addEventListener() {} });
  const doc = { createElement: make };
  const viewer = { scene: { canvas: null, pick: () => null, requestRender() {} }, dataSources: { add() {}, remove() {} }, container: { appendChild() {}, ownerDocument: doc } };
  return { viewer, doc };
}
const daysOf = (list) => { const out = {}; for (const it of list) { out[it.day] = out[it.day] || { total: 0 }; out[it.day].total += 1; } return out; };
function fakeServer(list = ALL) {
  const asked = { incidents: [], summary: [] };
  return {
    asked,
    fetchImpl: async ({ from, to }) => { asked.incidents.push({ from, to }); return { sources: { geoconfirmed: { attribution: 'GeoConfirmed', conflicts: { iran: { fetchedAt: NOW - 3_600_000 } } } }, incidents: list.filter((x) => x.day >= from && x.day <= to) }; },
    fetchSummaryImpl: async ({ from, to, theatre }) => {
      asked.summary.push({ from, to, theatre });
      const inside = theatre === 'gaza' ? list.filter((x) => x.lon < 34.7 && x.lat < 31.7) : list;
      return { sources: null, days: daysOf(inside.filter((x) => x.day >= from && x.day <= to)) };
    },
  };
}
const translate = (k, v) => (v ? `${k}${JSON.stringify(v)}` : k);
const tSk = (k, v) => { const s = SK_STRINGS[k] ?? k; return v ? s.replace(/\{(\w+)\}/g, (m, name) => (name in v ? String(v[name]) : m)) : s; };

test('nesťahuje pri štarte; pri dejisku a zapnutom čipe súhrn + okno 30 dní; brána len schováva; odchod vypne', async () => {
  const { viewer, doc } = fakeViewer();
  const server = fakeServer();
  const layer = createMideastIncidents({ viewer, documentRef: doc, translate, now: () => NOW, ...server });
  assert.equal(layer.isEnabled(), true, 'čip predvolene zapnutý');
  assert.equal(server.asked.incidents.length + server.asked.summary.length, 0, 'bez dejiska žiadny dopyt');
  const { ds } = layer._getStateForTest();
  await layer.setActive(OVERVIEW);
  assert.deepEqual(server.asked.summary, [{ from: '2026-02-28', to: '2026-03-31', theatre: null }], 'prehľad = celý región, súhrn od 28. 2.');
  assert.deepEqual(server.asked.incidents, [{ from: '2026-03-02', to: '2026-03-31' }], 'okno 30 dní');
  assert.equal(ds.show, true);
  assert.equal(ds.entities.values.length, IN30.length);
  assert.ok(ds.credit, 'atribúcia GeoConfirmed + UCDP v kredite');
  const st = layer.getState();
  assert.equal(st.period, '30d');
  assert.deepEqual(st.periodCounts, { '7d': 1, '30d': 3, all: 13 });
  assert.equal(st.summary.total, 3);
  assert.equal(st.fetchedAt, NOW - 3_600_000);
  await layer.hide();
  assert.equal(ds.show, false);
  assert.equal(ds.credit, undefined);
  await layer.show();
  assert.equal(ds.show, true);
  await layer.setActive(false);
  assert.equal(ds.show, false);
  assert.equal(server.asked.incidents.length, 1, 'všetko z jedného stiahnutia');
  layer.destroy();
});

test('dejisko: počty a súhrn v rámci dejiska, body v celom regióne; súhrn dejiska sa pýta zvlášť', async () => {
  const { viewer, doc } = fakeViewer();
  const server = fakeServer();
  const layer = createMideastIncidents({ viewer, documentRef: doc, translate, now: () => NOW, ...server });
  await layer.setActive(GAZA);
  assert.deepEqual(server.asked.summary.at(-1), { from: '2026-02-28', to: '2026-03-31', theatre: 'gaza' });
  const st = layer.getState();
  assert.equal(st.theatre, 'gaza');
  assert.equal(st.summary.total, 1, 'v Gaze je v okne jedna udalosť (8. 3.)');
  assert.equal(st.periodCounts['30d'], 1);
  assert.equal(layer._getStateForTest().ds.entities.values.length, IN30.length, 'body mimo záberu nič nestoja');
  layer.destroy();
});

test('os: obdobie 7 d a „od 28. 2." — dlhé obdobie po kusoch ≤ 31 dní, kusy sa cachujú; neznáme obdobie nič nerobí', async () => {
  const { viewer, doc } = fakeViewer();
  const server = fakeServer();
  const later = Date.parse('2026-05-20T12:00:00Z');
  const layer = createMideastIncidents({ viewer, documentRef: doc, translate, now: () => later, ...server });
  await layer.setActive(OVERVIEW);
  assert.equal(layer.getState().incidents.length, 0, 'v posledných 30 dňoch (od 21. 4.) nič');
  await layer.setPeriod('all');
  const chunks = server.asked.incidents.slice(1);
  assert.deepEqual(chunks, [{ from: '2026-04-20', to: '2026-05-20' }, { from: '2026-03-20', to: '2026-04-19' }, { from: '2026-02-28', to: '2026-03-19' }]);
  assert.equal(layer.getState().incidents.length, ALL.length);
  assert.equal(layer.getState().period, 'all');
  await layer.setPeriod('7d');
  assert.equal(layer.getState().incidents.length, 0);
  await layer.setPeriod('all');
  assert.equal(server.asked.incidents.length, 5, 'staré kusy z cache, znova sa pýta len kus posledných dní');
  await layer.setPeriod('nonsense');
  assert.equal(layer.getState().period, 'all');
  layer.destroy();
});

test('body: farba = druh, veľkosť a sýtosť = vek, čerstvé navrchu, poloha z udalosti', async () => {
  const { viewer, doc } = fakeViewer();
  const layer = createMideastIncidents({ viewer, documentRef: doc, translate, now: () => NOW, ...fakeServer() });
  await layer.setActive(OVERVIEW);
  const { ds } = layer._getStateForTest();
  const entity = (id) => ds.entities.values.find((e) => e.properties.incidentId.getValue() === id);
  const fresh = ALL.find((x) => x.day === '2026-03-29');
  const p = entity(fresh.id).point;
  assert.equal(p.pixelSize.getValue(), INCIDENTS_POINT_SIZE.fresh);
  assert.ok(Math.abs(p.color.getValue().alpha - INCIDENTS_POINT_ALPHA.fresh) < 1e-6);
  const css = Cesium.Color.fromCssColorString(incidentColour(fresh.type));
  assert.ok(Math.abs(p.color.getValue().red - css.red) < 1e-6);
  const recent = ALL.find((x) => x.day === '2026-03-08');
  assert.equal(entity(recent.id).point.pixelSize.getValue(), INCIDENTS_POINT_SIZE.recent);
  await layer.setPeriod('all');
  const old = ALL.find((x) => x.day === '2026-02-28');
  assert.equal(entity(old.id).point.pixelSize.getValue(), INCIDENTS_POINT_SIZE.old, '31 dní = starší');
  assert.equal(ds.entities.values.at(-1).properties.incidentId.getValue(), ALL[0].id, 'najnovšia pridaná posledná = navrchu');
  const pos = Cesium.Cartographic.fromCartesian(entity(fresh.id).position.getValue());
  assert.ok(Math.abs(Cesium.Math.toDegrees(pos.latitude) - fresh.lat) < 1e-4);
  assert.equal(incidentColour('nonsense'), '#8aa0b6');
  layer.destroy();
});

test('bublina a karta po slovensky: druh, dátum, miesto, aktér, popis, štítok „OSINT · geolokované", odkazy; žiadne jednotky ani mená', async () => {
  const { viewer, doc } = fakeViewer();
  let cfg = null;
  const layer = createMideastIncidents({ viewer, documentRef: doc, translate: tSk, lang: 'sk', now: () => NOW, ...fakeServer(), createHoverTip: (o) => { cfg = o; return { el: {}, install() {}, hide() {}, destroy() {} }; } });
  await layer.setActive(OVERVIEW);
  await layer.setPeriod('all');
  const shot = ALL.find((x) => x.type === 'air-defence');
  viewer.scene.pick = () => ({ id: { properties: { incidentId: { getValue: () => shot.id } } } });
  const hit = cfg.resolve({ x: 10, y: 10 });
  assert.equal(hit.accent, incidentColour('air-defence'));
  assert.match(hit.text, /^zásah PVO · 1\. 3\. 2026 · Al Ad'ami, Kuwait · vykonal: Irán · Iranian Shahed drone shot down/);
  assert.match(hit.text, /OSINT · geolokované, približná poloha$/);
  const { cardModel, card } = layer._getStateForTest();
  const model = cardModel(ALL.find((x) => x.conflict === 'israel' && x.actor === 'hezbollah').id);
  assert.equal(model.type, 'dron');
  assert.equal(model.actor, 'vykonal: Hizballáh');
  assert.equal(model.level, 'OSINT · geolokované');
  assert.deepEqual(model.links.map((l) => l.text), ['GeoConfirmed ↗', 'pôvodný príspevok ↗']);
  assert.equal(model.links[0].href, 'https://geoconfirmed.org/map/israel');
  layer.openCard(shot.id);
  assert.equal(card.hidden, false);
  assert.equal(layer.getState().selected, shot.id);
  await layer.hide();
  assert.equal(card.hidden, true, 'pohľad na planétu kartu zavrie');
  for (const it of ALL) assert.doesNotMatch(JSON.stringify(cardModel(it.id) || {}), /Haddad|members were|Units|Brigade/);
  layer.destroy();
});

test('výpadok: 404 = „ešte nie sú stiahnuté", staré body ostanú; obnova každých 30 min len pri dejisku', async () => {
  const { viewer, doc } = fakeViewer();
  const server = fakeServer();
  let fail = false;
  const timers = []; const cleared = [];
  const layer = createMideastIncidents({
    viewer, documentRef: doc, translate, now: () => NOW,
    fetchSummaryImpl: server.fetchSummaryImpl,
    fetchImpl: async (o) => { if (fail) { const e = new Error('no_incidents_snapshot'); e.status = 404; throw e; } return server.fetchImpl(o); },
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: (id) => cleared.push(id),
  });
  await layer.setActive(OVERVIEW);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, INCIDENTS_RELOAD_MS);
  fail = true;
  timers[0].fn();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(layer.getState().error, 'no_incidents_snapshot');
  assert.equal(layer._getStateForTest().ds.entities.values.length, IN30.length, 'staré body ostali');
  await layer.setActive(false);
  assert.deepEqual(cleared, [1]);
  layer.destroy();
});

test('panel: čip UDALOSTI (predvolene zapnutý, bez dejiska vypnutý), os s počtami, druhy, najnovšie riadky otvárajú kartu, zdroj a poznámka', async () => {
  const make = (tag) => {
    const classes = new Set();
    const el = {
      tag, children: [], textContent: '', hidden: false, disabled: false, dataset: {}, attrs: {}, listeners: {}, type: '', title: '',
      get className() { return [...classes].join(' '); },
      set className(v) { classes.clear(); for (const c of String(v).split(/\s+/)) if (c) classes.add(c); },
      classList: { toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); }, contains: (c) => classes.has(c) },
      appendChild(c) { el.children.push(c); return c; }, replaceChildren(...cs) { el.children = [...cs]; },
      addEventListener(t, fn) { el.listeners[t] = fn; }, setAttribute(k, v) { el.attrs[k] = v; }, click() { el.listeners.click?.(); },
    };
    return el;
  };
  const pdoc = { createElement: make };
  const walk = (n, out = []) => { for (const c of n.children) { out.push(c); walk(c, out); } return out; };
  const byClass = (root, cls) => walk(root).filter((n) => n.classList.contains(cls));
  const { viewer, doc } = fakeViewer();
  const layer = createMideastIncidents({ viewer, documentRef: doc, translate: tSk, lang: 'sk', now: () => NOW, ...fakeServer() });
  const opened = [];
  const origOpen = layer.openCard;
  layer.openCard = (id) => { opened.push(id); origOpen(id); };
  const mount = make('div');
  const panel = createMideastPanel({ mountTarget: mount, theatres: [{ id: 'overview', name: 'Region', overview: true }], incidents: layer, translate: tSk, lang: 'sk', documentRef: pdoc });
  const chip = byClass(mount, 'mideast-chip-incidents')[0];
  assert.equal(chip.textContent, 'UDALOSTI · GeoConfirmed');
  assert.equal(chip.attrs['aria-pressed'], 'true');
  assert.equal(chip.disabled, true, 'bez dejiska');
  const legend = byClass(mount, 'mideast-inc-legend')[0];
  assert.equal(legend.hidden, true);
  await layer.setActive(OVERVIEW);
  assert.equal(chip.disabled, false);
  assert.equal(legend.hidden, false);
  const periods = byClass(legend, 'mideast-inc-period');
  assert.deepEqual(periods.map((b) => b.textContent), ['7 d · 1', '30 d · 3', 'od 28. 2. · 13']);
  assert.equal(periods[1].classList.contains('is-active'), true);
  periods[2].click();
  await new Promise((r) => setImmediate(r));
  const all = byClass(mount, 'mideast-inc-legend')[0];
  assert.equal(byClass(all, 'mideast-inc-period')[2].classList.contains('is-active'), true);
  const types = byClass(all, 'is-inc').map((n) => n.children[1].textContent);
  assert.ok(types.includes('raketa') && types.includes('zásah PVO'));
  const rows = byClass(all, 'mideast-inc-row');
  assert.equal(rows.length, 5);
  rows[0].click();
  assert.deepEqual(opened, [ALL[0].id]);
  assert.match(byClass(all, 'mideast-legend-since')[0].textContent, /GeoConfirmed \(OSINT\) · UCDP Candidate \(CC BY 4\.0\)$/);
  assert.match(byClass(all, 'mideast-legend-note')[0].textContent, /Polohy, presuny a základne jednotiek/);
  byClass(all, 'mideast-inc-period')[0].click();
  await new Promise((r) => setImmediate(r));
  assert.equal(layer.getState().period, '7d');
  chip.click();
  await new Promise((r) => setImmediate(r));
  assert.equal(layer.isEnabled(), false);
  assert.equal(legend.hidden, true);
  panel.destroy();
  layer.destroy();
});

test('texty v oboch jazykoch: čip, legenda, obdobia, druhy, aktéri, štítky; CSS; zapojenie v conflictScenes.js', () => {
  const keys = ['mideast.part.incidents', 'mideast.inc.title', 'mideast.inc.period', 'mideast.inc.latest', 'mideast.inc.none', 'mideast.inc.inactive', 'mideast.inc.since',
    'mideast.inc.source', 'mideast.inc.note', 'mideast.inc.loading', 'mideast.inc.error', 'mideast.inc.missing', 'mideast.inc.credit', 'mideast.inc.actor', 'mideast.inc.parties',
    'mideast.inc.deaths', 'mideast.inc.close', 'mideast.inc.link.gc', 'mideast.inc.link.original', 'mideast.inc.link.ucdp', 'mideast.inc.level.gc', 'mideast.inc.level.gc-approx',
    'mideast.inc.level.ucdp', 'mideast.inc.prec.exact', 'mideast.inc.prec.near', 'mideast.inc.prec.district',
    ...['7d', '30d', 'all'].map((p) => `mideast.inc.period.${p}`),
    ...MIDEAST_INCIDENT_TYPES.map((x) => `mideast.inc.type.${x.id}`),
    ...MIDEAST_ACTORS.map((a) => `mideast.inc.actor.${a}`)];
  for (const k of keys) {
    assert.ok(EN_STRINGS[k], `EN ${k}`);
    assert.ok(SK_STRINGS[k], `SK ${k}`);
  }
  assert.match(SK_STRINGS['mideast.inc.level.gc'], /^OSINT · geolokované$/);
  for (const s of [SK_STRINGS, EN_STRINGS]) for (const k of keys) assert.doesNotMatch(s[k], /\p{Emoji_Presentation}/u, `bez emoji: ${k}`);
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  for (const cls of ['.mideast-inc-periods', '.mideast-inc-period', '.mideast-inc-row', '.oko-mideast-inc-card', '.oko-mideast-inc-card[hidden]', '.oko-mideast-inc-link']) assert.ok(css.includes(cls), cls);
  const scenes = readFileSync(new URL('./conflictScenes.js', import.meta.url), 'utf8');
  assert.match(scenes, /import \{ createMideastIncidents \} from '\.\/mideastIncidentsLayer\.js';/);
  assert.match(scenes, /let mideastIncidents = null;[^\n]*\n[\s\S]*?const revealGate = createSceneRevealGate\(/, 'premenná vzniká PRED bránou');
  assert.match(scenes, /if \(visible\) void mideastIncidents\?\.show\(\); else void mideastIncidents\?\.hide\(\);/);
  assert.match(scenes, /mideastIncidents = createMideastIncidents\(\{ viewer \}\);/);
  assert.match(scenes, /incidents: mideastIncidents,/);
  assert.match(scenes, /void mideastIncidents\?\.setActive\(scene \|\| false\);/, 'dejisko dostane celé (počty v rámci dejiska)');
  assert.equal((scenes.match(/void mideastIncidents\?\.setActive\(false\)/g) || []).length, 3, 'front, všeobecný rám a úžina vrstvu vypnú');
});
