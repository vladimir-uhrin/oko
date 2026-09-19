// src/data/pipelineFlowLinks.test.mjs
// Väzby mien potrubí na body ENTSOG (etapa 3, 2026-09-19): každý bod existuje
// v katalógu, zhody sa zjednocujú, ropa nikdy nedostane bod, NS2 nie je NS1,
// a riadky toku sú z payloadu proxy s citáciou ENTSOG.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAS_FLOW_POINTS } from './gasFlows.js';
import { MAX_FLOW_POINTS_PER_PIPELINE, PIPELINE_FLOW_LINKS, pipelineFlowPointIds, pipelineFlowRows } from './pipelineFlowLinks.js';

const tKey = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);

test('každé id v tabuľke existuje v GAS_FLOW_POINTS a žiadne pravidlo nemá viac než strop', () => {
  const ids = new Set(GAS_FLOW_POINTS.map((p) => p.id));
  for (const link of PIPELINE_FLOW_LINKS) {
    assert.ok(link.name instanceof RegExp || link.operator instanceof RegExp, 'pravidlo má regex');
    assert.ok(link.ids.length >= 1 && link.ids.length <= MAX_FLOW_POINTS_PER_PIPELINE);
    for (const id of link.ids) assert.ok(ids.has(id), id);
  }
});

test('mená zo snímku → body: NS1 = OPAL + NEL, NS2 nič, OPAL / EUGAL = OPAL, TANAP = Kipoi, eustream podľa prevádzkovateľa', () => {
  assert.deepEqual(pipelineFlowPointIds({ name: 'Nord Stream 1', substance: 'gas' }), ['greifswald-opal', 'greifswald-nel']);
  assert.deepEqual(pipelineFlowPointIds({ name: 'Северный поток 1A' }), ['greifswald-opal', 'greifswald-nel']);
  assert.deepEqual(pipelineFlowPointIds({ name: 'Nord Stream 2' }), [], 'NS2 nikdy nespustený — nesmie ukázať tok NS1');
  assert.deepEqual(pipelineFlowPointIds({ name: 'Северный поток 2' }), []);
  assert.deepEqual(pipelineFlowPointIds({ name: 'OPAL / EUGAL' }), ['greifswald-opal']);
  assert.deepEqual(pipelineFlowPointIds({ name: 'Nordeuropäische Erdgasleitung (NEL)' }), ['greifswald-nel']);
  assert.deepEqual(pipelineFlowPointIds({ name: 'TANAP Trans Anadolu Doğal Gaz Boru Hattı' }), ['kipoi']);
  assert.deepEqual(pipelineFlowPointIds({ name: 'Trans Adriatic Pipeline' }), ['kipoi']);
  assert.deepEqual(pipelineFlowPointIds({ name: 'Türk Akımı Kara Kısmı-1 Doğalgaz Boru Hattı' }), ['strandzha2']);
  assert.deepEqual(pipelineFlowPointIds({ name: 'أنبوب الغاز بيدرو دوران فارال' }), ['tarifa-out'], 'GME po arabsky');
  assert.deepEqual(pipelineFlowPointIds({ name: 'Уренгой — Помари — Ужгород' }), ['sudzha', 'kapusany-in']);
  assert.deepEqual(pipelineFlowPointIds({ name: 'Газопровід "Союз"' }), ['kapusany-in']);
  assert.deepEqual(pipelineFlowPointIds({ name: 'Prepojovací plynovod Poľsko – Slovensko' }), ['vyrava-in', 'vyrava-out']);
  assert.deepEqual(pipelineFlowPointIds({ name: null, operator: 'Eustream' }), ['baumgarten-out', 'lanzhot-out']);
  assert.deepEqual(pipelineFlowPointIds({ name: 'Europipe II' }), ['dornum', 'emden']);
  // name:en a ref sa skúšajú tiež
  assert.deepEqual(pipelineFlowPointIds({ name: 'Plynovod', nameEn: 'Baltic Pipe' }), ['nybro']);
  assert.deepEqual(pipelineFlowPointIds({ ref: 'BBL' }), ['bacton-bbl']);
});

test('čo bod nemá, nedostane ho: Yamal, TAG, Langeled, bezmenné úseky; ropa nikdy', () => {
  assert.deepEqual(pipelineFlowPointIds({ name: 'Yamal - Europe' }), [], 'Mallnow/Kondratki v katalógu nie sú');
  assert.deepEqual(pipelineFlowPointIds({ name: 'Trans Austria Gasleitung (TAG)' }), []);
  assert.deepEqual(pipelineFlowPointIds({ name: 'Langeled' }), []);
  assert.deepEqual(pipelineFlowPointIds({ name: 'Statpipe', operator: 'Gassco' }), []);
  assert.deepEqual(pipelineFlowPointIds({}), []);
  assert.deepEqual(pipelineFlowPointIds({ name: 'Nord Stream 1', substance: 'oil' }), [], 'ropa nemá živé toky ani keby sa volala ako plynovod');
  assert.deepEqual(pipelineFlowPointIds({ name: 'Дружба', substance: 'crude_oil' }), []);
});

test('pipelineFlowRows: riadok na bod z payloadu proxy, nula = zero, chýbajúci = nodata, citácia ENTSOG', () => {
  const payload = {
    points: [
      { id: 'greifswald-opal', name: 'Greifswald / OPAL', from: 'RU', to: 'DE', dir: 'entry', noteKey: 'gas.note-nordstream', latest: { date: '2026-09-18', gwh: 0, status: 'Provisional' } },
      { id: 'kipoi', name: 'Kipoi (TAP)', from: 'TR', to: 'GR', dir: 'entry', latest: { date: '2026-09-18', gwh: 312.4, status: 'Confirmed' } },
    ],
    citation: 'ENTSOG TP 19-09-2026 https://transparency.entsog.eu/',
  };
  const out = pipelineFlowRows(payload, ['kipoi', 'greifswald-opal', 'narva'], { lang: 'sk', translate: tKey });
  assert.equal(out.citation, 'ENTSOG TP 19-09-2026 https://transparency.entsog.eu/');
  assert.equal(out.rows.length, 3);
  const [kipoi, opal, narva] = out.rows;
  assert.equal(kipoi.level, 'flow');
  assert.equal(kipoi.route, 'TR → GR');
  assert.match(kipoi.text, /^312\sGWh\/d$/, 'medzera pred jednotkou je U+202F, preto \\s');
  assert.match(kipoi.mcmText, /gas\.flow-mcm \{"v":"30"\}/, '312,4 GWh/d ≈ 29,6 mil. m³/d → zaokrúhlené na 30');
  assert.equal(kipoi.statusText, 'gas.flow-confirmed');
  assert.equal(opal.level, 'zero');
  assert.match(opal.text, /^0\sGWh\/d$/);
  assert.equal(opal.mcmText, '');
  assert.equal(opal.statusText, 'gas.flow-provisional');
  assert.equal(opal.note, 'gas.note-nordstream');
  assert.equal(narva.level, 'nodata', 'bod z katalógu bez riadku v payloade = bez dát, nie výnimka');
  assert.equal(narva.text, 'gas.flow-nodata');
  assert.equal(narva.name, 'Narva');
  // Prázdny payload → každý bod nodata, citácia prázdna.
  const empty = pipelineFlowRows(null, ['kipoi'], { translate: tKey });
  assert.equal(empty.rows[0].level, 'nodata');
  assert.equal(empty.citation, '');
});
