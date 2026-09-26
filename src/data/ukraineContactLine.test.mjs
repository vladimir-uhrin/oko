// src/data/ukraineContactLine.test.mjs — línia kontaktu odvodená z polygónov
// DeepState (2026-09-24): len okraje, za ktorými leží ukrajinská pevnina; štátna
// hranica, pobrežie a hranica dvoch ruských druhov sa nekreslia.
import test from 'node:test';
import assert from 'node:assert/strict';

import { CONTACT_MIN_KM, contactLinePaths, pathLengthKm } from './ukraineContactLine.js';
import { UKRAINE_LAND_BBOX, UKRAINE_LAND_RINGS, UKRAINE_LAND_SOURCE } from './ukraineLand.js';

const sq = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
const LAND = [sq(30, 45, 40, 52)];

test('okupované vnútri pevniny: celý obvod je línia (jeden úsek, aj cez začiatok prstenca)', () => {
  const paths = contactLinePaths([{ kind: 'occupied', ring: sq(36, 47, 37, 48) }], LAND);
  assert.equal(paths.length, 1);
  const km = pathLengthKm(paths[0]);
  assert.ok(km > 300 && km < 400, `obvod ~2×(76+111) km (${Math.round(km)})`);
});

test('okraj na hranici pevniny (Rusko/more) sa nekreslí', () => {
  // Východná strana okupovaného leží na okraji pevniny (x = 40) — za ňou nie je Ukrajina.
  const paths = contactLinePaths([{ kind: 'occupied', ring: sq(38, 47, 40, 48) }], LAND);
  assert.equal(paths.length, 1);
  const eastPoints = paths[0].filter(([lon]) => lon === 40);
  assert.ok(eastPoints.length <= 2, 'východná hrana nie je súčasť línie (len jej koncové body)');
  assert.ok(!paths[0].some(([lon, lat], i) => i > 0 && lon === 40 && paths[0][i - 1][0] === 40), 'žiadny úsek pozdĺž x = 40');
});

test('hranica dvoch ruských druhov (okupované × ORDLO) nie je front', () => {
  const index = [
    { kind: 'occupied', ring: sq(36, 47, 37, 48) },
    { kind: 'ordlo', ring: sq(37, 47, 38, 48) },
  ];
  const paths = contactLinePaths(index, LAND);
  for (const p of paths) {
    for (let i = 1; i < p.length; i += 1) {
      const inner = p[i][0] === 37 && p[i - 1][0] === 37;
      assert.equal(inner, false, 'spoločná hrana x = 37 sa nekreslí');
    }
  }
  const total = paths.reduce((a, p) => a + pathLengthKm(p), 0);
  assert.ok(total > 480 && total < 560, `vonkajší obvod oboch ~ 2×152 + 2×111 km (${Math.round(total)})`);
});

test('iné druhy (šedá zóna, oslobodené) líniu nekreslia; bez pevniny/polygónov nič', () => {
  assert.deepEqual(contactLinePaths([{ kind: 'grey', ring: sq(36, 47, 37, 48) }], LAND), []);
  assert.deepEqual(contactLinePaths([{ kind: 'occupied', ring: sq(36, 47, 37, 48) }], []), []);
  assert.deepEqual(contactLinePaths([], LAND), []);
  assert.deepEqual(contactLinePaths(null, null), []);
  // Okupované pri šedej zóne: za okrajom je šedá zóna (nie ruská kontrola) na pevnine → front.
  const withGrey = contactLinePaths([{ kind: 'occupied', ring: sq(36, 47, 37, 48) }, { kind: 'grey', ring: sq(35.9, 47, 36, 48) }], LAND);
  assert.equal(withGrey.length, 1);
});

test('krátke úseky sa zahodia, krátke medzery premostia', () => {
  assert.equal(CONTACT_MIN_KM, 12);
  // Malý štvorec ~ 4 km obvodu → pod minimom.
  assert.deepEqual(contactLinePaths([{ kind: 'occupied', ring: sq(36, 47, 36.01, 47.01) }], LAND), []);
});

test('vrstva DeepState: línia sa kreslí nad plochami, stav nesie počet a dĺžku; legenda KARTY ju pridá len keď je', async () => {
  const { createUkraineDeepStateLayer, DEEPSTATE_STYLES } = await import('../ukraineDeepStateLayer.js');
  const { kartaLegendItems } = await import('../ukraineKartaOverlay.js');
  const doc = { createElement: () => ({ className: '', hidden: false, remove() {} }) };
  const viewer = { scene: { primitives: { add: (x) => x, remove() {} }, requestRender() {} }, dataSources: { add() {}, remove() {} }, container: { ownerDocument: doc, appendChild() {} } };
  const layer = createUkraineDeepStateLayer({ viewer, documentRef: doc, terrainSampler: async (pts) => pts.map(() => 0) });
  layer.setSnapshot({ day: '2026-09-24', source: 'mirror', features: [{ type: 'Polygon', kind: 'occupied', rings: [sq(36, 47, 37, 48)] }] });
  const st = layer.getState();
  assert.equal(st.contact, 1);
  assert.ok(st.contactKm > 300);
  assert.equal(layer.contactPaths().length, 1);
  const lines = layer._getStateForTest().ds.entities.values.filter((e) => String(e.id).includes(':contact:'));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].polyline.zIndex.getValue(), 10, 'nad obrysmi plôch');
  assert.equal(lines[0].polyline.width.getValue(), DEEPSTATE_STYLES.default.contact.width);
  layer.setStyle('karta');
  // KARTA (2026-09-26, vzorka Rybar „ostré hrany“): odvodená línia sa nekreslí — hranu robí sám obrys polygónu.
  assert.equal(DEEPSTATE_STYLES.karta.contact, null);
  assert.equal(layer._getStateForTest().ds.entities.values.some((e) => String(e.id).includes(':contact:')), false, 'KARTA: bez odvodenej línie');
  assert.equal(layer.getState().contact, 1, 'línia sa ďalej počíta (pásmo, šípky, náhľad)');
  const keys = (ds) => kartaLegendItems({ deepstate: ds, translate: (k) => k }).map((i) => i.key);
  assert.ok(keys({ shown: true, source: 'mirror', features: 1, contact: 1 }).includes('contact'));
  assert.ok(!keys({ shown: true, source: 'mirror', features: 1, contact: 0 }).includes('contact'));
  assert.ok(!keys({ shown: true, source: 'mirror', features: 1, contact: 1, style: 'karta' }).includes('contact'), 'v KARTE bez vzorky línie');
  assert.equal(kartaLegendItems({ deepstate: { shown: true, contact: 2 } }).find((i) => i.key === 'contact').line, true);
  layer.destroy();
});

test('pevnina Ukrajiny: Natural Earth 1:50m, bez Krymu (de facto), rozumný rozsah', () => {
  assert.match(UKRAINE_LAND_SOURCE, /Natural Earth/);
  assert.ok(UKRAINE_LAND_RINGS.length >= 1);
  assert.ok(UKRAINE_LAND_RINGS[0].length > 500, 'podrobnejší než zjednodušený obrys mapky');
  const [w, s, e, n] = UKRAINE_LAND_BBOX;
  assert.ok(w > 22 && w < 23 && e > 40 && e < 40.5 && s > 45 && n > 52 && n < 52.5);
});
