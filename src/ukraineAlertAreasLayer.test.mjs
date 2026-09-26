// src/ukraineAlertAreasLayer.test.mjs — vrstva POPLACHY (2026-09-26): entity podľa
// stupňa, prekreslenie len pri zmene, hover text poctivo „nie oficiálna mapa";
// os podáva hlásenia s časom kurzora; čipy v osi aj paneli; texty v oboch jazykoch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ALERT_COLOR, UKRAINE_OBLASTS_URL, createUkraineAlertAreasLayer, fetchUkraineOblasts } from './ukraineAlertAreasLayer.js';
import { mediaToAlert } from './data/ukraineMedia.js';
import { EN_STRINGS, SK_STRINGS } from './i18nStrings.js';

const STRINGS = { en: EN_STRINGS, sk: SK_STRINGS };

const oblastsFile = JSON.parse(readFileSync(new URL('../public/data/ukraine-oblasts.json', import.meta.url), 'utf8'));
const post = (text, t, id) => ({ id, url: `https://t.me/${id.slice(3)}`, text, publishedAt: t, lang: 'uk' });
const T0 = Date.UTC(2026, 8, 25, 20, 0);

function fakeViewer() {
  const events = { addEventListener() {}, removeEventListener() {} };
  const doc = { createElement: () => ({ className: '', hidden: true, style: { setProperty() {} }, remove() {}, textContent: '' }) };
  const viewer = {
    scene: { canvas: null, pick: () => null, requestRender() {}, postRender: events, primitives: { add: (p) => p, remove() {} } },
    dataSources: { add() {}, remove() {} },
    container: { appendChild() {}, ownerDocument: doc },
  };
  return { viewer, doc };
}

test('vrstva: bez zapnutia nič nesťahuje; po zapnutí polygón + obrys na oblasť, alfa podľa stupňa; iný stupeň = prekreslenie', async () => {
  const { viewer, doc } = fakeViewer();
  let fetched = 0;
  const layer = createUkraineAlertAreasLayer({ viewer, documentRef: doc, fetchOblasts: async () => { fetched += 1; return oblastsFile; }, translate: (k) => k });
  const alerts = [mediaToAlert(post('🛵 БпЛА на Київщину', T0 - 10 * 60_000, 'tg:kpszsu/1')), mediaToAlert(post('☄️ Балістика на Одесу', T0 - 100 * 60_000, 'tg:kpszsu/2'))];
  layer.setAlerts(alerts, T0);
  assert.equal(fetched, 0);
  assert.deepEqual(layer.getState().active, []);
  await layer.show();
  assert.equal(fetched, 1);
  const { ds, drawn } = layer._getStateForTest();
  assert.deepEqual(layer.getState().active, ['Kyiv Oblast', 'Odesa Oblast']);
  const kyiv = drawn.get('Kyiv Oblast');
  assert.equal(kyiv.level, 1);
  const kyivRings = oblastsFile.oblasts.find((o) => o.name === 'Kyiv Oblast').rings.length;
  assert.equal(kyiv.entities.length, 2 * kyivRings, 'polygón + obrys na prstenec');
  const poly = kyiv.entities.find((e) => e.polygon);
  assert.ok(Math.abs(poly.polygon.material.color.getValue().alpha - 0.3) < 1e-6);
  assert.equal(drawn.get('Odesa Oblast').level, 0.75);
  assert.ok(ds.entities.values.length >= 4);
  const before = kyiv.entities[0];
  layer.setAlerts(alerts, T0 + 5 * 60_000);
  assert.equal(drawn.get('Kyiv Oblast').entities[0], before, 'rovnaký stupeň = bez prekreslenia');
  layer.setAlerts(alerts, T0 + 100 * 60_000);
  assert.equal(drawn.get('Kyiv Oblast').level, 0.75, '110 min');
  assert.notEqual(drawn.get('Kyiv Oblast').entities[0], before);
  assert.ok(!drawn.has('Odesa Oblast'), '200 min = preč');
  layer.setAlerts(alerts, T0 + 165 * 60_000);
  assert.equal(drawn.get('Kyiv Oblast').level, 0.25, '175 min = posledný stupeň');
  layer.setAlerts(alerts, T0 + 200 * 60_000);
  assert.equal(drawn.size, 0);
  assert.equal(ds.entities.values.length, 0);
  layer.hide();
  assert.equal(layer.getState().shown, false);
  layer.destroy();
});

test('hover: meno, vek, počty, citát a poctivosť zdroja; kredit len kým kreslí', async () => {
  const { viewer, doc } = fakeViewer();
  const layer = createUkraineAlertAreasLayer({ viewer, documentRef: doc, fetchOblasts: async () => oblastsFile, translate: (k, p) => `${k}${p ? JSON.stringify(p) : ''}`, lang: 'sk' });
  layer.setAlerts([mediaToAlert(post('🛵 Ударний БпЛА у напрямку Кривого Рогу зі сходу.', T0 - 12 * 60_000, 'tg:kpszsu/9'))], T0);
  await layer.show();
  const { ds, tipText } = layer._getStateForTest();
  const txt = tipText('Dnipropetrovsk Oblast');
  assert.match(txt, /^Dnipropetrovsk Oblast · ukraine\.al\.tip-ago\{"min":"12"\} · ukraine\.al\.tip-count\{"n":"1","total":"1","h":"3"\} · „🛵 Ударний БпЛА у напрямку Кривого Рогу зі сходу\.“ · ukraine\.al\.tip-source$/);
  assert.equal(tipText('Kyiv Oblast'), '');
  assert.ok(ds.credit, 'kredit kým kreslí');
  layer.hide();
  assert.equal(ds.credit, undefined);
  assert.equal(ALERT_COLOR, '#b07cff');
  assert.equal(UKRAINE_OBLASTS_URL, '/data/ukraine-oblasts.json');
  await assert.rejects(fetchUkraineOblasts({ fetcher: async () => ({ ok: false, status: 404 }) }), /HTTP 404/);
  await assert.rejects(fetchUkraineOblasts({ fetcher: async () => ({ ok: true, json: async () => ({}) }) }), /bad oblasts/);
});

test('os podáva hlásenia s časom kurzora; čipy POPLACHY v osi a paneli; nič sa nezapína samo; texty SK+EN', () => {
  const tl = readFileSync(new URL('./ukraineTimeline.js', import.meta.url), 'utf8');
  assert.match(tl, /alerts\?\.setAlerts\?\.\(result\.alerts \|\| \[\], state\.cursor\);/, 'cursor = LIVE teraz / prehrávanie kurzor');
  assert.match(tl, /translate\('ukraine\.part\.alerts'\)/);
  for (const cls of ['is-al-now', 'is-al-fading']) assert.ok(tl.includes(`'${cls}'`), cls);
  const panel = readFileSync(new URL('./ukrainePanel.js', import.meta.url), 'utf8');
  assert.match(panel, /ukraine-chip-alerts/);
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /createUkraineAlertAreasLayer\(\{ viewer \}\)/);
  assert.doesNotMatch(main, /ukraineAlerts\.show\(\)/, 'predvolene vypnuté (opt-in ako ŠKODY)');
  const client = readFileSync(new URL('./data/ukraineEventsClient.js', import.meta.url), 'utf8');
  assert.match(client, /alerts: assembleAlerts\(payloads/);
  for (const lang of ['en', 'sk']) for (const k of ['ukraine.part.alerts', 'ukraine.al.note', 'ukraine.al.now', 'ukraine.al.fading', 'ukraine.al.none', 'ukraine.al.legend', 'ukraine.al.tip-ago', 'ukraine.al.tip-count', 'ukraine.al.tip-source', 'ukraine.al.credit']) assert.ok(STRINGS[lang][k], `${lang} ${k}`);
  assert.match(STRINGS.sk['ukraine.al.note'], /NIE JE to oficiálna mapa sirén/);
  assert.match(STRINGS.en['ukraine.al.note'], /NOT the official air-raid siren map/);
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.is-al-now \.oko-ukr-tl-ctl-sw \{ background: rgba\(176, 124, 255/);
});
