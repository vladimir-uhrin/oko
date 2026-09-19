// src/data/pipelineHoverCard.test.mjs
// Hover karta potrubia (etapa 3, 2026-09-19): čistý model (meno, látka,
// riadky z OSM, odkaz na way, body ENTSOG) a DOM karta nad falošným
// dokumentom — plyn s tokom, plyn bez bodu, ropa bez živých dát, výmena
// rúry pod kurzorom zahodí neskorý tok, Escape a × zatvoria.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPipelineHoverCard, pipelineHoverModel } from './pipelineHoverCard.js';

const tKey = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);

/** Minimálny DOM: elementy s textContent, deťmi, atribútmi a listenermi. */
function fakeDocument() {
  const listeners = new Map();
  const makeEl = (tag) => {
    const el = {
      tag, children: [], textContent: '', hidden: false, style: {}, dataset: {}, attrs: {}, className: '', listeners: {},
      appendChild(c) { el.children.push(c); c.parent = el; return c; },
      append(...cs) { for (const c of cs) el.appendChild(c); },
      replaceChildren(...cs) { el.children = []; el.append(...cs); },
      remove() { if (el.parent) el.parent.children = el.parent.children.filter((c) => c !== el); },
      addEventListener(t, fn) { el.listeners[t] = fn; },
      setAttribute(k, v) { el.attrs[k] = v; },
      contains(n) { return n === el || el.children.some((c) => c.contains?.(n)); },
      get offsetWidth() { return 300; }, get offsetHeight() { return 200; },
    };
    return el;
  };
  const body = makeEl('body');
  const doc = {
    body, documentElement: { clientWidth: 1000, clientHeight: 700 }, activeElement: null,
    createElement: makeEl,
    addEventListener(t, fn) { listeners.set(t, fn); }, removeEventListener(t) { listeners.delete(t); },
    fire(t, e) { listeners.get(t)?.(e); },
  };
  return doc;
}
const text = (el) => [el.textContent, ...el.children.map(text)].filter(Boolean).join(' ');
const byClass = (el, cls) => (String(el.className).split(/\s+/).includes(cls) ? [el] : []).concat(...el.children.map((c) => byClass(c, cls)));

const NS1 = { id: 'osm-way-1', properties: { name: 'Nord Stream 1', operator: 'Nord Stream AG', diameterMm: 1153, lengthKm: 1220, from: 'Vyborg', to: 'Lubmin', pressure: '220 bar', status: 'operating', osm: 1, substance: 'gas' } };
const STUB = { id: 'osm-way-2', properties: { diameterMm: 300, lengthKm: 0.8, status: 'disused', osm: 2, substance: 'gas' } };
const DRUZBA = { id: 'osm-way-77', properties: { name: 'Družba', substance: 'oil', operator: 'MERO', diameterMm: 530, lengthKm: 300, osm: 77 } };

test('pipelineHoverModel: látka, meno, riadky z OSM, odkaz na way, body ENTSOG podľa mena; ropa bez bodov', () => {
  const m = pipelineHoverModel(NS1, { translate: tKey, lang: 'sk' });
  assert.equal(m.kind, 'gas');
  assert.equal(m.kindText, 'gas.pipeline-kind-gas');
  assert.equal(m.title, 'Nord Stream 1');
  assert.equal(m.osmUrl, 'https://www.openstreetmap.org/way/1');
  assert.deepEqual(m.flowIds, ['greifswald-opal', 'greifswald-nel']);
  // Prevádzkovateľ je v karte zvlášť (s originálom), v riadkoch nie je.
  assert.deepEqual(m.rows.map(([k]) => k), ['gas.pipeline-diameter-label', 'gas.pipeline-segment', 'gas.pipeline-route', 'gas.pipeline-pressure', 'gas.pipeline-status-label']);
  assert.deepEqual(m.rows[2], ['gas.pipeline-route', 'Vyborg → Lubmin']);
  assert.deepEqual(m.operator, { text: 'Nord Stream AG', original: null });
  assert.equal(m.original, null);
  assert.deepEqual(m.countries, []);
  const o = pipelineHoverModel(DRUZBA, { translate: tKey });
  assert.equal(o.kind, 'oil');
  assert.equal(o.title, 'Družba');
  assert.deepEqual(o.flowIds, [], 'ropa nikdy nedostane bod ENTSOG');
  // Cyrilika: titulok v latinke, originál zvlášť; krajiny zo snímku; uloženie z OSM.
  const c = pipelineHoverModel({ id: 'osm-way-9', properties: { name: 'Уренгой — Помары — Ужгород', operator: 'ООО «Газпром трансгаз Югорск»', countries: ['RU', 'UA'], location: 'underground', substance: 'gas', osm: 9 } }, { translate: tKey });
  assert.equal(c.title, 'Urengoy — Pomary — Uzhgorod');
  assert.equal(c.original, 'Уренгой — Помары — Ужгород');
  assert.deepEqual(c.operator, { text: 'OOO «Gazprom transgaz Yugorsk»', original: 'ООО «Газпром трансгаз Югорск»' });
  assert.deepEqual(c.countries, ['RU', 'UA']);
  assert.deepEqual(c.rows, [['gas.pipeline-location', 'gas.pipeline-location-underground'], ['gas.pipeline-status-label', 'gas.pipeline-status-operating']]);
  assert.deepEqual(c.flowIds, ['sudzha', 'kapusany-in']);
  const s = pipelineHoverModel(STUB, { translate: tKey });
  assert.equal(s.title, 'gas.pipeline-unnamed');
  assert.deepEqual(s.flowIds, []);
  assert.equal(pipelineHoverModel(null), null);
  assert.equal(pipelineHoverModel({ id: 'x', properties: { osm: 'nie' } }).osmUrl, null);
});

test('DOM karta: plyn s tokom → „načítavam" a potom riadky s citáciou ENTSOG; plyn bez bodu a ropa dostanú vysvetlenie namiesto čísla', () => {
  const doc = fakeDocument();
  const card = createPipelineHoverCard({ document: doc, translate: tKey, lang: () => 'sk', regionName: (iso) => ({ AL: 'Albánsko', GR: 'Grécko' })[iso] || '', snapshotDate: () => '2026-09-19T03:07:39Z' });
  const root = doc.body.children[0];
  assert.equal(root.className, 'pipeline-hover-card');
  // Krajiny s vlajkami a menami v jazyku UI; dátum snímku v päte (pravidlo 2).
  card.show({ id: 'osm-way-5', properties: { name: 'Trans Adriatic Pipeline', countries: ['AL', 'GR'], substance: 'gas', osm: 5 } }, { x: 1, y: 1 });
  const countries = byClass(root, 'pipeline-hover-countries')[0];
  assert.match(text(countries), /Albánsko/);
  assert.match(text(countries), /Grécko/);
  assert.deepEqual(byClass(countries, 'pipeline-hover-flag').map((f) => f.alt), ['AL', 'GR']);
  assert.match(text(byClass(root, 'pipeline-hover-foot')[0]), /gas\.pipeline-snapshot \{"date":"2026-09-19"\}/);
  assert.doesNotMatch(text(root), /gas\.pipeline-group/, 'bez skupiny bez riadku trasy');
  card.hide();
  // Celá trasa (etapa 6): riadok s počtom úsekov a km, len keď je úsekov viac.
  card.show({ id: 'osm-way-6', properties: { name: 'Uzhhorod – Košice', substance: 'gas', osm: 6 } }, { x: 1, y: 1 }, { group: { count: 3, lengthKm: 1234 } });
  assert.match(text(byClass(root, 'pipeline-hover-rows')[0]), /gas\.pipeline-group gas\.pipeline-group-value \{"n":3,"km":"1\s234"\}/);
  card.hide();
  assert.equal(root.hidden, true);
  // NS1: čaká na dva body
  assert.deepEqual(card.show(NS1, { x: 100, y: 50 }), ['greifswald-opal', 'greifswald-nel']);
  assert.equal(root.hidden, false);
  assert.equal(root.dataset.kind, 'gas');
  assert.equal(root.style.left, '118px');
  assert.equal(root.style.top, '66px');
  assert.match(text(root), /gas\.pipeline-kind-gas/);
  assert.match(text(root), /Nord Stream 1/);
  assert.match(text(root), /Vyborg → Lubmin/);
  assert.match(text(root), /OSM way 1/);
  assert.match(text(root), /© OpenStreetMap contributors · ODbL/);
  assert.match(text(root), /gas\.pipeline-flow-loading/);
  assert.match(text(root), /gas\.pipeline-hover-hint/);
  const byTag = (el, tag) => (el.tag === tag ? [el] : []).concat(...el.children.map((c) => byTag(c, tag)));
  const link = byTag(root, 'a')[0];
  assert.equal(link.href, 'https://www.openstreetmap.org/way/1');
  assert.equal(link.rel, 'noopener noreferrer');
  // Tok dorazí: riadky + citácia (čl. 5.2 ENTSOG TP)
  const payload = { points: [{ id: 'greifswald-opal', name: 'Greifswald / OPAL', from: 'RU', to: 'DE', latest: { date: '2026-09-18', gwh: 0, status: 'Provisional' }, noteKey: 'gas.note-nordstream' }], citation: 'ENTSOG TP 19-09-2026 https://transparency.entsog.eu/' };
  assert.equal(card.setFlows(NS1, payload), true);
  const flow = byClass(root, 'pipeline-hover-flow')[0];
  assert.doesNotMatch(text(flow), /gas\.pipeline-flow-loading/);
  assert.match(text(flow), /RU → \s*DE · Greifswald \/ OPAL/, 'vlajky + kódy + meno bodu');
  const flags = byClass(flow, 'pipeline-hover-flag');
  assert.deepEqual(flags.map((f) => f.alt), ['RU', 'DE', 'RU', 'DE'], 'vlajka pre from aj to pri oboch bodoch');
  assert.match(flags[0].src, /\/ru\.svg$/);
  assert.match(text(flow), /0\sGWh\/d/, 'medzera pred jednotkou je U+202F');
  assert.match(text(flow), /gas\.flow-provisional/);
  assert.match(text(flow), /gas\.note-nordstream/);
  assert.match(text(flow), /ENTSOG TP 19-09-2026/);
  assert.match(text(flow), /gas\.pipeline-flow-note/);
  assert.match(text(flow), /Greifswald \/ NEL/, 'bod z katalógu bez riadku v payloade je „bez dát", nie vynechaný');
  // Rovnaká rúra znova = len presun, nič sa neprekreslí a nič sa nečaká
  assert.deepEqual(card.show(NS1, { x: 5, y: 5 }), []);
  assert.equal(root.style.left, '23px');
  // Chyba proxy → „nedostupné"
  card.show(STUB, { x: 1, y: 1 });
  card.show(NS1, { x: 1, y: 1 });
  assert.equal(card.setFlows(NS1, null), true);
  assert.match(text(byClass(root, 'pipeline-hover-flow')[0]), /gas\.pipeline-flow-unavailable/);
  // Plyn bez bodu
  assert.deepEqual(card.show(STUB, { x: 1, y: 1 }), []);
  assert.match(text(root), /gas\.pipeline-unnamed/);
  assert.match(text(root), /gas\.pipeline-flow-none/);
  assert.equal(card.setFlows(STUB, payload), false, 'bez bodov nie je čo dopĺňať');
  // Ropa
  assert.deepEqual(card.show(DRUZBA, { x: 1, y: 1 }), []);
  assert.equal(root.dataset.kind, 'oil');
  assert.match(text(root), /gas\.pipeline-kind-oil/);
  assert.match(text(root), /gas\.pipeline-flow-oil-none/);
  assert.doesNotMatch(text(root), /gas\.pipeline-flow-loading/);
  card.destroy();
  assert.equal(doc.body.children.length, 0);
});

test('DOM karta: neskorý tok pre inú rúru sa zahodí; Escape, × a odchod kurzora zatvoria; kurzor v karte ju drží', () => {
  const doc = fakeDocument();
  const card = createPipelineHoverCard({ document: doc, translate: tKey, lang: () => 'sk' });
  const root = doc.body.children[0];
  card.show(NS1, { x: 1, y: 1 });
  card.show(STUB, { x: 2, y: 2 });
  assert.equal(card.setFlows(NS1, { points: [], citation: 'x' }), false, 'kurzor už je inde — starý tok sa nekreslí');
  assert.equal(card.current(), STUB);
  doc.fire('keydown', { key: 'Escape' });
  assert.equal(root.hidden, true);
  assert.equal(card.current(), null);
  card.show(NS1, { x: 1, y: 1 });
  root.listeners.pointerenter();
  assert.equal(card.isHovered(), true);
  root.listeners.pointerleave();
  assert.equal(root.hidden, true);
  assert.equal(card.isHovered(), false);
  card.show(NS1, { x: 1, y: 1 });
  const close = byClass(root, 'pipeline-hover-close')[0];
  assert.equal(close.attrs['aria-label'], 'gas.pipeline-close');
  close.listeners.click();
  assert.equal(root.hidden, true);
  // Umiestnenie sa drží v okne
  card.show(NS1, { x: 990, y: 690 });
  assert.equal(root.style.left, '692px');
  assert.equal(root.style.top, '492px');
  // Bez dokumentu je karta neškodný no-op
  const none = createPipelineHoverCard({ document: null });
  assert.deepEqual(none.show(NS1, { x: 0, y: 0 }), undefined);
  assert.equal(none.isHovered(), false);
});
