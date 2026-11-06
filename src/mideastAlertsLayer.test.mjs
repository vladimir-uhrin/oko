// src/mideastAlertsLayer.test.mjs — vrstva POPLACHY · Izrael, ukazovatele a panel (BLÍZKY VÝCHOD etapa 6,
// 2026-11-06). Oblasti a počty zo skutočných výrezov mirroru (fixtúry) cez ten istý model ako archív
// servera. Správanie: nič pred dejiskom, aktívne len pri dejiskách Izraela a okolia, obdobie automaticky
// prvé neprázdne, polygóny s výplňou podľa počtu, karta po slovensky, panel s čipmi a kartou súčtov,
// texty v oboch jazykoch, CSS, zapojenie v conflictScenes.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';

import { ALERTS_RELOAD_MS, alertsTheatreActive, createMideastAlerts } from './mideastAlertsLayer.js';
import { createMideastHumanitarian, createMideastInternet } from './mideastIndicators.js';
import { ALERT_KINDS, ALERT_LEVELS, buildAlertAreas, parseAlertsMirror, parsePythonStringDict } from './data/mideastAlerts.js';
import { parseT4pSummary } from './data/mideastHumanitarian.js';
import { OONI_COUNTRIES, internetIndicator, parseOoniAggregation } from './data/mideastInternet.js';
import { createMideastPanel } from './mideastPanel.js';
import { EN_STRINGS, SK_STRINGS } from './i18nStrings.js';
import { ALERTS_MIRROR_JS, ALERT_DISTRICTS_PY, ALERT_POLYGONS, OONI_IR_AGGREGATION, T4P_SUMMARY_V3 } from './data/fixtures/mideastStage6Fixtures.mjs';

const NOW = Date.parse('2026-03-10T12:00:00Z'); // 7 d = od 4. 3. (len 9. 3.), 30 d = od 28. 2.
const PARSED = parseAlertsMirror(ALERTS_MIRROR_JS);
const AREAS = buildAlertAreas({ catalog: PARSED.catalog, polygons: ALERT_POLYGONS, districts: parsePythonStringDict(ALERT_DISTRICTS_PY) }).areas;
const ISRAEL = { id: 'israel', rectDegrees: [34.2, 29.4, 35.95, 33.4] };
const IRAN = { id: 'iran', rectDegrees: [44, 25, 63.5, 39.8] };

function fakeViewer() {
  const make = () => ({ className: '', hidden: true, style: { setProperty() {} }, remove() {}, textContent: '', children: [], lang: '', dir: '', appendChild(c) { this.children.push(c); return c; }, replaceChildren(...c) { this.children = c; }, setAttribute() {}, addEventListener() {} });
  const doc = { createElement: make };
  const viewer = { scene: { canvas: null, pick: () => null, requestRender() {} }, dataSources: { add() {}, remove() {} }, container: { appendChild() {}, ownerDocument: doc } };
  return { viewer, doc };
}
/** Falošný server: okno dní z fixtúry (ako alertsPayload). */
function fakeServer() {
  const asked = { ranges: [], areas: 0 };
  return {
    asked,
    fetchImpl: async ({ from, to }) => {
      asked.ranges.push(`${from}:${to}`);
      const days = {}; const areas = {};
      for (const [day, v] of Object.entries(PARSED.days)) {
        if (day < from || day > to) continue;
        days[day] = { r: v.r, w: v.w, d: v.d };
        for (const [slug, c] of Object.entries(v.areas)) { const a = areas[slug] || (areas[slug] = { r: 0, w: 0, d: 0 }); a.r += c.r; a.w += c.w; a.d += c.d; }
      }
      return { from, to, dataUpdated: PARSED.dataUpdated, fetchedAt: NOW - 3_600_000, coverage: { first: '2026-02-28', last: '2026-06-14' }, source: { attribution: 'Pikud HaOref' }, days, areas };
    },
    fetchAreasImpl: async () => { asked.areas += 1; return { areas: AREAS, source: { attribution: 'amitfin' } }; },
  };
}
const translate = (k, v) => (v ? `${k}${JSON.stringify(v)}` : k);
const tSk = (k, v) => { const s = SK_STRINGS[k] ?? k; return v ? s.replace(/\{(\w+)\}/g, (m, name) => (name in v ? String(v[name]) : m)) : s; };
const tick = () => new Promise((r) => setImmediate(r));
/** sk-SK oddeľuje tisíce úzkou nezlomnou medzerou — v tvrdeniach obyčajná. */
const plain = (s) => String(s).replace(/[  ]/g, ' ');

test('nesťahuje pri štarte; aktívne len pri dejiskách Izraela a okolia; pri dejisku obrysy raz + celé obdobie + zvolené; brána len schováva', async () => {
  const { viewer, doc } = fakeViewer();
  const server = fakeServer();
  const layer = createMideastAlerts({ viewer, documentRef: doc, translate, now: () => NOW, ...server });
  assert.equal(layer.isEnabled(), true, 'čip predvolene zapnutý');
  assert.equal(server.asked.areas + server.asked.ranges.length, 0);
  const { ds } = layer._getStateForTest();
  await layer.setActive(IRAN);
  assert.equal(layer.getState().active, false, 'Irán nemá oblasti HFC');
  assert.equal(server.asked.areas, 0, 'bez aktívneho dejiska žiadny dopyt');
  assert.ok(alertsTheatreActive('gaza') && alertsTheatreActive({ id: 'overview' }) && !alertsTheatreActive('hormuz') && !alertsTheatreActive(null));
  await layer.setActive(ISRAEL);
  assert.equal(server.asked.areas, 1, 'obrysy raz');
  assert.deepEqual(server.asked.ranges, ['2026-02-28:2026-03-10', '2026-03-04:2026-03-10'], 'celé obdobie (os) + automaticky 7 d, lebo má poplach');
  const st = layer.getState();
  assert.equal(st.period, '7d');
  assert.deepEqual(st.periodCounts, { day: 13, '7d': 13, '30d': 69 + 3, all: 72 }, 'posledný deň = 9. 3.; w sa nepočíta');
  assert.equal(st.lastDay, '2026-03-09');
  assert.equal(ds.show, true);
  assert.equal(st.summary.alarms, 13);
  assert.equal(st.summary.areas, 3, 'Bnei Ayish 9. 3. len predbežné');
  await layer.hide();
  assert.equal(ds.show, false, 'brána schová');
  assert.equal(layer.getState().active, true);
  await layer.show();
  assert.equal(ds.show, true);
  await layer.setActive(false);
  assert.equal(ds.show, false);
  assert.equal(layer.getState().active, false);
  layer.destroy();
});

test('obdobie: voľba 30 d a od 28. 2. sa sťahujú raz (cache), posledný deň; neznáme obdobie nič; automatika ide na 30 d, keď 7 d je prázdnych', async () => {
  const { viewer, doc } = fakeViewer();
  const server = fakeServer();
  const layer = createMideastAlerts({ viewer, documentRef: doc, translate, now: () => NOW, ...server });
  await layer.setActive(ISRAEL);
  await layer.setPeriod('30d');
  assert.equal(server.asked.ranges.length, 2, '30 d = od 28. 2. do 10. 3. — to isté okno ako celé obdobie, z cache');
  assert.equal(layer.getState().summary.alarms, 72);
  await layer.setPeriod('all');
  assert.equal(server.asked.ranges.length, 2, '„od 28. 2." je už stiahnuté (celé obdobie)');
  await layer.setPeriod('day');
  assert.equal(server.asked.ranges.at(-1), '2026-03-09:2026-03-09');
  assert.equal(server.asked.ranges.length, 3);
  assert.equal(layer.getState().summary.alarms, 13);
  await layer.setPeriod('nonsense');
  assert.equal(layer.getState().period, 'day');
  await layer.setPeriod('7d');
  assert.equal(server.asked.ranges.length, 3, '7 d z cache');
  layer.destroy();
  // „teraz" = 25. 6.: 7 d (od 19. 6.) prázdne, 30 d má 14. 6. → automaticky 30 d
  const later = Date.parse('2026-06-25T12:00:00Z');
  const l2 = createMideastAlerts({ viewer, documentRef: doc, translate, now: () => later, ...fakeServer() });
  await l2.setActive(ISRAEL);
  assert.equal(l2.getState().period, '30d');
  assert.equal(l2.getState().summary.alarms, 1);
  l2.destroy();
});

test('polygóny: entita na oblasť s obrysom, výplň = stupeň podľa počtu, odtieň = prevládajúci druh, oblasť bez poplachu skrytá', async () => {
  const { viewer, doc } = fakeViewer();
  const layer = createMideastAlerts({ viewer, documentRef: doc, translate, now: () => NOW, ...fakeServer() });
  await layer.setActive(ISRAEL);
  const { entities } = layer._getStateForTest();
  assert.equal(entities.size, 4);
  const tlv = entities.get('tel-aviv-center');
  assert.equal(tlv.show, true, 'Tel Aviv 9. 3.: 5 rakiet');
  const fill = (e) => e.polygon.material.color.getValue();
  assert.equal(fill(tlv).alpha, ALERT_LEVELS[1].alpha, '5 = stupeň l2');
  const red = Cesium.Color.fromCssColorString(ALERT_KINDS[0].css);
  assert.equal(fill(tlv).red, red.red);
  assert.equal(entities.get('bny-aysh').show, false, 'len predbežné upozornenia = nič');
  assert.ok(tlv.polygon.hierarchy.getValue().positions.length >= 10);
  await layer.setPeriod('30d');
  assert.equal(entities.get('bny-aysh').show, true);
  assert.equal(fill(entities.get('bny-aysh')).alpha, ALERT_LEVELS[2].alpha, '17 rakiet = l3');
  const ks = entities.get('kryyt-shmvnh');
  assert.equal(fill(ks).alpha, ALERT_LEVELS[2].alpha, '10 + 3 = 13 → l3');
  const purple = Cesium.Color.fromCssColorString(ALERT_KINDS[1].css);
  assert.notEqual(fill(ks).red, purple.red, 'rakety (10) prevládajú nad dronmi (3)');
  layer.destroy();
});

test('bublina a karta po slovensky: hebrejské meno s okresom, počty po druhoch, obdobie, „história, nie varovanie", dátum dát mirroru, odkaz', async () => {
  const { viewer, doc } = fakeViewer();
  const layer = createMideastAlerts({ viewer, documentRef: doc, translate: tSk, lang: 'sk', now: () => NOW, ...fakeServer() });
  await layer.setActive(ISRAEL);
  const { tipText, cardModel, card } = layer._getStateForTest();
  const tip = tipText('kryyt-shmvnh');
  assert.match(tip, /^קריית שמונה · קו העימות · rakety a strely 6 · nepriateľské lietadlo \(drony\) 0 · predbežné upozornenia 9 · 7 d · história, nie varovanie$/);
  assert.equal(tipText('nikto'), '');
  const m = cardModel('tel-aviv-center');
  assert.equal(m.name, 'תל אביב - מרכז העיר');
  assert.equal(m.district, 'דן');
  assert.deepEqual(m.rows.map((r) => [r.label, r.value]), [['rakety a strely', 5], ['nepriateľské lietadlo (drony)', 0], ['predbežné upozornenia', 6]]);
  assert.equal(m.period, '7 d');
  assert.equal(m.dataUpdated, '3. 11. 2026');
  assert.match(m.note, /nie varovný systém/);
  assert.equal(m.link.href, 'https://oref-alerts.github.io/');
  layer.openCard('tel-aviv-center');
  assert.equal(card.hidden, false);
  assert.equal(layer.getState().selected, 'tel-aviv-center');
  const name = card.children[0].children[1];
  assert.equal(name.lang, 'he');
  assert.equal(name.dir, 'rtl');
  layer.closeCard();
  assert.equal(card.hidden, true);
  layer.openCard('nikto');
  assert.equal(card.hidden, true);
  layer.destroy();
});

test('výpadok: 404 = „ešte nie sú stiahnuté", chyba obrysov zvlášť; obnova každých 30 min len pri dejisku', async () => {
  const { viewer, doc } = fakeViewer();
  const timers = [];
  const missing = createMideastAlerts({ viewer, documentRef: doc, translate, now: () => NOW, fetchAreasImpl: async () => { const e = new Error('no_alert_areas'); e.status = 404; throw e; }, fetchImpl: fakeServer().fetchImpl });
  await missing.setActive(ISRAEL);
  assert.equal(missing.getState().error, 'no_alert_areas');
  assert.equal(missing.getState().loaded, false);
  missing.destroy();
  const noData = createMideastAlerts({ viewer, documentRef: doc, translate, now: () => NOW, fetchAreasImpl: fakeServer().fetchAreasImpl, fetchImpl: async () => { const e = new Error('no_alerts_snapshot'); e.status = 404; throw e; } });
  await noData.setActive(ISRAEL);
  assert.equal(noData.getState().error, 'no_alerts_snapshot');
  noData.destroy();
  const layer = createMideastAlerts({ viewer, documentRef: doc, translate, now: () => NOW, setTimer: (fn, ms) => { timers.push(ms); return 1; }, clearTimer: () => timers.pop(), ...fakeServer() });
  assert.equal(timers.length, 0);
  await layer.setActive(ISRAEL);
  assert.deepEqual(timers, [ALERTS_RELOAD_MS]);
  await layer.setActive(false);
  assert.equal(timers.length, 0, 'bez dejiska časovač stojí');
  layer.destroy();
});

test('ukazovatele bez mapy: súčty len pri Gaze/Západnom brehu/Libanone, internet podľa krajín dejiska; nič pred dejiskom; 404 = missing', async () => {
  let humCalls = 0;
  const hum = createMideastHumanitarian({ now: () => NOW, fetchImpl: async () => { humCalls += 1; return { fetchedAt: NOW, source: { attribution: 'T4P' }, summary: parseT4pSummary(T4P_SUMMARY_V3) }; } });
  assert.equal(humCalls, 0);
  await hum.setActive({ id: 'iran' });
  assert.equal(hum.getState().active, false);
  assert.equal(humCalls, 0);
  await hum.setActive({ id: 'gaza' });
  assert.equal(humCalls, 1);
  const g = hum.getState();
  assert.equal(g.key, 'gaza');
  assert.equal(g.rows[0].value, 74618);
  assert.equal(g.block.lastUpdate, '2026-11-05');
  await hum.setActive('west-bank');
  assert.equal(humCalls, 1, 'cache 30 min');
  assert.equal(hum.getState().rows.find((r) => r.id === 'settlerAttacks').value, 5148);
  await hum.setActive(null);
  assert.equal(hum.getState().active, false);
  hum.destroy();
  const rows = parseOoniAggregation(OONI_IR_AGGREGATION);
  const countries = Object.fromEntries(OONI_COUNTRIES.map((cc) => [cc, internetIndicator(rows, Date.parse('2026-11-06T12:00:00Z'))]));
  const net = createMideastInternet({ now: () => NOW, fetchImpl: async () => ({ fetchedAt: NOW, source: { attribution: 'OONI', explorer: 'https://explorer.ooni.org/' }, countries }) });
  await net.setActive({ id: 'hormuz' });
  assert.equal(net.getState().active, false);
  await net.setActive({ id: 'south-lebanon' });
  assert.deepEqual(net.getState().countries.map((c) => c.cc), ['LB', 'IL']);
  assert.equal(net.getState().countries[0].level, 'same');
  await net.setActive({ id: 'overview' });
  assert.equal(net.getState().countries.length, 6);
  net.destroy();
  const gone = createMideastInternet({ now: () => NOW, fetchImpl: async () => { const e = new Error('no_internet_snapshot'); e.status = 404; throw e; } });
  await gone.setActive('iran');
  assert.equal(gone.getState().error, 'missing');
  gone.destroy();
});

test('panel: čip POPLACHY (predvolene zapnutý, mimo dejísk vypnutý), obdobia s počtami, druhy, riadky oblastí otvárajú kartu, dátum mirroru, poznámka; INTERNET a karta súčtov', async () => {
  const make = (tag) => {
    const classes = new Set();
    const el = {
      tag, children: [], textContent: '', hidden: false, disabled: false, dataset: {}, attrs: {}, listeners: {}, type: '', title: '', lang: '', dir: '', href: '',
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
  const layer = createMideastAlerts({ viewer, documentRef: doc, translate: tSk, lang: 'sk', now: () => NOW, ...fakeServer() });
  const opened = [];
  const origOpen = layer.openCard;
  layer.openCard = (id) => { opened.push(id); origOpen(id); };
  const hum = createMideastHumanitarian({ now: () => NOW, fetchImpl: async () => ({ fetchedAt: NOW, source: { attribution: 'T4P' }, summary: parseT4pSummary(T4P_SUMMARY_V3) }) });
  const rows = parseOoniAggregation(OONI_IR_AGGREGATION);
  const net = createMideastInternet({ now: () => NOW, fetchImpl: async () => ({ fetchedAt: NOW, source: { attribution: 'OONI' }, countries: { IL: internetIndicator(rows, Date.parse('2026-11-06T12:00:00Z')), LB: { level: 'quiet', recent: null, baseline: 3.1, delta: null, measurements: 12, lastDay: '2026-11-06', sparkline: [] } } }) });
  const mount = make('div');
  const panel = createMideastPanel({ mountTarget: mount, theatres: [{ id: 'israel', name: 'Israel' }], alerts: layer, humanitarian: hum, internet: net, translate: tSk, lang: 'sk', documentRef: pdoc });
  const chip = byClass(mount, 'mideast-chip-alerts')[0];
  assert.equal(chip.textContent, 'POPLACHY · Izrael');
  assert.equal(chip.attrs['aria-pressed'], 'true');
  assert.equal(chip.disabled, true, 'bez dejiska');
  const legend = byClass(mount, 'mideast-alerts-legend')[0];
  assert.equal(legend.hidden, true);
  const netChip = byClass(mount, 'mideast-chip-internet')[0];
  assert.equal(netChip.textContent, 'INTERNET · OONI');
  assert.equal(netChip.disabled, true);
  assert.equal(byClass(mount, 'mideast-hum-card')[0].hidden, true);
  await layer.setActive(ISRAEL);
  await net.setActive(ISRAEL);
  await hum.setActive(ISRAEL);
  assert.equal(chip.disabled, false);
  assert.equal(legend.hidden, false);
  assert.equal(byClass(mount, 'mideast-hum-card')[0].hidden, true, 'Izrael nemá súčty T4P');
  const periods = byClass(legend, 'mideast-inc-period');
  assert.deepEqual(periods.map((b) => b.textContent), ['posledný deň · 13', '7 d · 13', '30 d · 72', 'od 28. 2. · 72']);
  assert.equal(periods[1].classList.contains('is-active'), true, 'automaticky 7 d');
  const kinds = byClass(legend, 'is-alert').map((n) => `${n.children[1].textContent} ${n.children[2].textContent}`);
  assert.deepEqual(kinds, ['rakety a strely 13', 'nepriateľské lietadlo (drony) 0', 'predbežné upozornenia 21']);
  assert.ok(byClass(legend, 'mideast-legend-state').some((n) => n.textContent === '3 oblastí s poplachom'));
  const areaRows = byClass(legend, 'mideast-alerts-row');
  assert.equal(areaRows.length, 3);
  assert.equal(areaRows[0].dataset.slug, 'kryyt-shmvnh', 'najviac poplachov prvé');
  assert.equal(areaRows[0].children[1].lang, 'he');
  areaRows[0].click();
  assert.deepEqual(opened, ['kryyt-shmvnh']);
  assert.match(byClass(legend, 'mideast-legend-since')[0].textContent, /^dáta mirroru k 3\. 11\. 2026 · posledný poplach 9\. 3\. 2026$/);
  assert.match(byClass(legend, 'mideast-legend-note')[0].textContent, /^NIE JE to varovný systém/);
  periods[2].click();
  await tick();
  assert.equal(layer.getState().period, '30d');
  assert.equal(byClass(byClass(mount, 'mideast-alerts-legend')[0], 'mideast-inc-period')[2].classList.contains('is-active'), true);
  // INTERNET: riadok IL so stupňom, LB „ticho"
  const netLegend = byClass(mount, 'mideast-net-legend')[0];
  assert.equal(netLegend.hidden, false);
  const netRows = byClass(netLegend, 'mideast-net-row');
  assert.deepEqual(netRows.map((r) => r.dataset.cc), ['IL']);
  assert.equal(netRows[0].children[0].textContent, 'Izrael');
  assert.equal(netRows[0].children[1].textContent, 'bez zmeny');
  assert.match(plain(netRows[0].children[2].textContent), /^7 d 41,3 % blokovaných · 30 d predtým 44,7 % · 129 025 meraní$/);
  assert.match(byClass(netLegend, 'mideast-legend-note')[0].textContent, /Nekomerčná licencia/);
  await net.setActive({ id: 'south-lebanon' });
  const lb = byClass(byClass(mount, 'mideast-net-legend')[0], 'mideast-net-row').find((r) => r.dataset.cc === 'LB');
  assert.equal(lb.children[1].textContent, 'málo meraní — možný výpadok');
  // súčty: Gaza
  await hum.setActive({ id: 'gaza' });
  const humCard = byClass(mount, 'mideast-hum-card')[0];
  assert.equal(humCard.hidden, false);
  assert.equal(byClass(humCard, 'mideast-legend-title')[0].textContent, 'Obete · Gaza');
  const humRows = byClass(humCard, 'mideast-hum-row');
  assert.deepEqual(humRows.slice(0, 2).map((r) => [r.children[0].textContent, plain(r.children[1].textContent)]), [['zabití', '74 618'], ['z toho deti', '20 179']]);
  assert.match(byClass(humCard, 'mideast-legend-since')[0].textContent, /^hlásenie k 5\. 11\. 2026 · podľa ministerstva zdravotníctva v Gaze/);
  assert.match(byClass(humCard, 'mideast-legend-note')[0].textContent, /nikdy mená obetí/);
  chip.click();
  await tick();
  assert.equal(layer.isEnabled(), false);
  assert.equal(legend.hidden, true);
  panel.destroy();
  layer.destroy(); hum.destroy(); net.destroy();
});

test('texty v oboch jazykoch, bez emoji; CSS; zapojenie v conflictScenes.js', () => {
  const keys = ['mideast.part.alerts', 'mideast.alerts.title', 'mideast.alerts.period', 'mideast.alerts.areas', 'mideast.alerts.top', 'mideast.alerts.none', 'mideast.alerts.inactive',
    'mideast.alerts.loading', 'mideast.alerts.error', 'mideast.alerts.missing', 'mideast.alerts.data', 'mideast.alerts.lastDay', 'mideast.alerts.source', 'mideast.alerts.credit',
    'mideast.alerts.note', 'mideast.alerts.tip.note', 'mideast.alerts.card.note', 'mideast.alerts.card.updated', 'mideast.alerts.level', 'mideast.alerts.link.mirror',
    ...['day', '7d', '30d', 'all'].map((p) => `mideast.alerts.period.${p}`), ...ALERT_KINDS.map((k) => `mideast.alerts.kind.${k.id}`),
    'mideast.part.internet', 'mideast.net.title', 'mideast.net.recent', 'mideast.net.baseline', 'mideast.net.measurements', 'mideast.net.none', 'mideast.net.inactive', 'mideast.net.loading',
    'mideast.net.error', 'mideast.net.missing', 'mideast.net.source', 'mideast.net.link', 'mideast.net.note',
    ...OONI_COUNTRIES.map((cc) => `mideast.net.country.${cc}`), ...['worse', 'better', 'same', 'quiet', 'none'].map((l) => `mideast.net.level.${l}`),
    ...['gaza', 'west_bank', 'lebanon'].flatMap((k) => [`mideast.hum.title.${k}`, `mideast.hum.source.${k}`]),
    ...['killed', 'children', 'women', 'medical', 'press', 'civilDefence', 'injured', 'injuredChildren', 'settlerAttacks'].map((r) => `mideast.hum.row.${r}`),
    'mideast.hum.report', 'mideast.hum.none', 'mideast.hum.loading', 'mideast.hum.error', 'mideast.hum.missing', 'mideast.hum.note'];
  for (const k of keys) {
    assert.ok(EN_STRINGS[k], `EN ${k}`);
    assert.ok(SK_STRINGS[k], `SK ${k}`);
  }
  for (const s of [SK_STRINGS, EN_STRINGS]) for (const k of keys) assert.doesNotMatch(s[k], /\p{Emoji_Presentation}/u, `bez emoji: ${k}`);
  assert.match(SK_STRINGS['mideast.alerts.note'], /NIE JE to varovný systém/);
  assert.match(EN_STRINGS['mideast.alerts.note'], /NOT a warning system/);
  assert.match(SK_STRINGS['mideast.hum.note'], /nikdy mená/);
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  for (const cls of ['.mideast-net-row', '.mideast-net-level.is-worse', '.mideast-net-level.is-quiet', '.mideast-hum-rows', '.mideast-hum-value', '.oko-mideast-alerts-rows', '.mideast-alerts-name']) assert.ok(css.includes(cls), cls);
  const scenes = readFileSync(new URL('./conflictScenes.js', import.meta.url), 'utf8');
  assert.match(scenes, /import \{ createMideastAlerts \} from '\.\/mideastAlertsLayer\.js';/);
  assert.match(scenes, /import \{ createMideastHumanitarian, createMideastInternet \} from '\.\/mideastIndicators\.js';/);
  assert.match(scenes, /let mideastAlerts = null;[^\n]*\n[\s\S]*?const revealGate = createSceneRevealGate\(/, 'premenná vzniká PRED bránou');
  assert.match(scenes, /if \(visible\) void mideastAlerts\?\.show\(\); else void mideastAlerts\?\.hide\(\);/);
  assert.match(scenes, /mideastAlerts = createMideastAlerts\(\{ viewer \}\);/);
  assert.match(scenes, /alerts: mideastAlerts,\n\s+humanitarian: mideastHumanitarian,\n\s+internet: mideastInternet,/);
  assert.match(scenes, /void mideastAlerts\?\.setActive\(scene \|\| false\);\n\s+void mideastHumanitarian\?\.setActive\(scene \|\| null\);\n\s+void mideastInternet\?\.setActive\(scene \|\| null\);/);
  assert.equal((scenes.match(/void mideastAlerts\?\.setActive\(false\); void mideastHumanitarian\?\.setActive\(null\); void mideastInternet\?\.setActive\(null\);/g) || []).length, 3, 'front, všeobecný rám a úžina všetko vypnú');
});
