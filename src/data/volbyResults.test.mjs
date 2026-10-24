// src/data/volbyResults.test.mjs — výsledky ŠÚ SR (2026-10-24): rozpoznanie stĺpcov v oboch štýloch hlavičiek
// (kódy 2022 aj opisy 2026), druh tabuľky z titulku a čísla, sčítanie cez okrsky, podiely, zvolený/vedie,
// účasť, spracovanie okrskov, kraje (predseda, obvody), prehľad a stav pre mapu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from './volbyCandidates.js';
import {
  aggregateCandidates, buildResults, classifyTable, findHeaderRow, mapColumns, obecMapState, rankCandidates, resultsOverview, tableKind,
} from './volbyResults.js';

const STRANY = 'Názov politickej strany, názvy politických strán tvoriacich koalíciu, nezávislý kandidát';
const MODEL = buildModel({
  predseda: [
    { Kraj: 'Prešovský samosprávny kraj', 'Poradové číslo kandidáta': '8', Meno: 'Milan', Priezvisko: 'Majerský', 'Titul pred menom': 'PaedDr.', 'Titul za menom': 'PhD.', Vek: '55', Zamestnanie: 'predseda', 'Obec trvalého pobytu kandidáta': 'Levoča', [STRANY]: 'KDH' },
    { Kraj: 'Prešovský samosprávny kraj', 'Poradové číslo kandidáta': '9', Meno: 'Milan', Priezvisko: 'Mazurek', 'Titul pred menom': '', 'Titul za menom': '', Vek: '32', Zamestnanie: 'poslanec', 'Obec trvalého pobytu kandidáta': 'Kežmarok', [STRANY]: 'Republika' },
  ],
  zupni: [
    { Kraj: 'Prešovský samosprávny kraj', 'Volebný obvod': '1', 'Poradové číslo kandidáta': '1', Meno: 'A', Priezvisko: 'Aa', 'Titul pred menom': '', 'Titul za menom': '', Vek: '40', Zamestnanie: '', 'Obec TP kandidáta': 'Bardejov', [STRANY]: 'Nezávislý kandidát' },
    { Kraj: 'Prešovský samosprávny kraj', 'Volebný obvod': '1', 'Poradové číslo kandidáta': '2', Meno: 'B', Priezvisko: 'Bb', 'Titul pred menom': '', 'Titul za menom': '', Vek: '41', Zamestnanie: '', 'Obec TP kandidáta': 'Bardejov', [STRANY]: 'KDH' },
  ],
  starosta: [
    { Okres: 'Dunajská Streda', Obec: 'Topoľníky', 'Poradové číslo kandidáta': '1', Meno: 'Anna', Priezvisko: 'Nagyová', Titul: 'Mgr.', Vek: '50', Zamestnanie: 'starostka', [STRANY]: 'Aliancia', 'Kód okresu': '201' },
    { Okres: 'Dunajská Streda', Obec: 'Topoľníky', 'Poradové číslo kandidáta': '2', Meno: 'Peter', Priezvisko: 'Kiss', Titul: '', Vek: '41', Zamestnanie: 'podnikateľ', [STRANY]: 'Nezávislý kandidát', 'Kód okresu': '201' },
  ],
  poslanci: [
    { Okres: 'Dunajská Streda', Obec: 'Topoľníky', 'Volebný obvod': '1', 'Poradové číslo kandidáta': '1', Meno: 'Béla', Priezvisko: 'Nagy', Titul: '', Vek: '44', Zamestnanie: '', [STRANY]: 'Nezávislý kandidát', 'Kod okresu': '201' },
    { Okres: 'Dunajská Streda', Obec: 'Topoľníky', 'Volebný obvod': '1', 'Poradové číslo kandidáta': '2', Meno: 'Zoltán', Priezvisko: 'Kiss', Titul: 'Ing.', Vek: '39', Zamestnanie: '', [STRANY]: 'Aliancia', 'Kod okresu': '201' },
    { Okres: 'Dunajská Streda', Obec: 'Topoľníky', 'Volebný obvod': '1', 'Poradové číslo kandidáta': '3', Meno: 'Éva', Priezvisko: 'Tóth', Titul: '', Vek: '35', Zamestnanie: '', [STRANY]: 'Aliancia', 'Kod okresu': '201' },
  ],
  uzemie: [{ 'Kód kraja': '2', 'Názov kraja': 'Trnavský kraj', 'Kód územného obvodu': '201', 'Názov územného obvodu': 'Dunajská Streda', 'Kód okresu': '201', 'Názov okresu': 'Dunajská Streda', 'Kód obce': '501891', 'Názov obce': 'Topoľníky', 'Počet volebných obvodov': '1', 'Počet okrskov': '2', 'Počet volených poslancov': '2', 'Typ volieb': 'Starosta a zastupiteľstvo' }],
  obvodyKraj: [{ 'Kód kraja': '7', 'Názov kraja': 'Prešovský kraj', 'Kód volebného obvodu': '701', 'Názov volebného obvodu': 'Volebný obvod č. 1', 'Počet volebných okrskov': '3', 'Počet volených poslancov': '1' }],
  obceObvody: [{ 'Kód kraja': '7', 'Názov kraja': 'Prešovský kraj', 'Kód volebného obvodu': '701', 'Názov volebného obvodu': 'Volebný obvod č. 1', 'Kód obce': '519006', 'Názov obce': 'Bardejov', 'Počet volebných okrskov': '3' }],
}, { generatedAt: 1 });

const sheet = (name, title, rows) => ({ name, title, sheets: [{ name, rows }] });

test('mapColumns: kódy 2022 aj opisné hlavičky 2026; „hlasovacích lístkov" nie sú hlasy; obvod kraja len v OSK', () => {
  const c2022 = mapColumns(['OBEC', 'VOOBEC', 'OKRSOK', 'PC_HL', 'P_HL', 'P_HL_PCT', 'KANDIDAT']);
  assert.deepEqual(c2022, { obec: 0, obvod: 1, okrsok: 2, n: 3, votes: 4, pct: 5, elected: 6 });
  const c2026 = mapColumns(['Kód obce', 'Volebný obvod v obci', 'Okrsok', 'Poradie na hlasovacom lístku', 'Počet platných hlasov', 'Podiel platných hlasov v %', 'Kandidát']);
  assert.deepEqual(c2026, { obec: 0, obvod: 1, okrsok: 2, n: 3, votes: 4, pct: 5, elected: 6 });
  const turnout = mapColumns(['Kód obce', 'Volebný obvod', 'Okrsok', 'Počet voličov zapísaných v zoznamoch voličov', 'Počet voličov, ktorí sa zúčastnili na hlasovaní', 'Účasť v %', 'Počet voličov, ktorí odovzdali obálku', 'Podiel voličov, ktorí odovzdali obálku v %', 'Počet platných hlasovacích lístkov odovzdaných pre voľby do zastupiteľstva', 'Počet platných hlasovacích lístkov odovzdaných pre voľby starostu']);
  assert.equal(turnout.registered, 3);
  assert.equal(turnout.voted, 4);
  assert.equal(turnout.turnout, 5);
  assert.equal(turnout.votes, undefined, 'počty lístkov nie sú hlasy kandidátov');
  const osk = mapColumns(['Kód kraja', 'Kód volebného obvodu', 'Kód obce', 'Okrsok', 'Poradie na hlasovacom lístku', 'Počet platných hlasov'], 'osk');
  assert.deepEqual(osk, { kraj: 0, obvodKraj: 1, obec: 2, okrsok: 3, n: 4, votes: 5 });
  assert.equal(findHeaderRow([['Výsledky', null], ['Kód obce', 'Okrsok', 'Počet platných hlasov', 'Poradie na hlasovacom lístku'], ['1', '2']]), 1);
  assert.equal(findHeaderRow([['len text'], ['x', 'y']]), -1);
});

test('tableKind: titulok vyhráva, potom číslo tabuľky; účasť a mandáty podľa stĺpcov', () => {
  const cols = { obec: 0, n: 3, votes: 4 };
  assert.equal(tableKind({ name: 'OSO2026_SK_tab05f', title: 'Počet a podiel platných hlasov pre kandidátov na starostu obce za okrsky', columns: cols }), 'starosta');
  assert.equal(tableKind({ name: 'OSO2026_SK_tab08f', title: 'Počet a podiel platných hlasov pre kandidátov na poslancov za okrsky', columns: cols }), 'poslanci');
  assert.equal(tableKind({ name: 'OSK2026_SK_tab05f', title: 'Kandidáti na predsedu samosprávneho kraja', columns: cols, scope: 'osk' }), 'predseda');
  assert.equal(tableKind({ name: 'OSK2026_SK_tab08f', title: 'Kandidáti na poslancov zastupiteľstva', columns: cols, scope: 'osk' }), 'zupni');
  assert.equal(tableKind({ name: 'OSO2026_SK_tab05f', title: '', columns: cols }), 'starosta', 'bez titulku podľa čísla');
  assert.equal(tableKind({ name: 'OSO2026_SK_tab08f', title: '', columns: cols }), 'poslanci');
  assert.equal(tableKind({ name: 'OSO2026_SK_tab02bf', title: 'x', columns: { registered: 3, voted: 4 } }), 'ucast');
  assert.equal(tableKind({ name: 'OSO2026_SK_tab02ad', title: 'x', columns: { seats: 2, seatsElected: 3 } }), 'mandaty');
  assert.equal(tableKind({ name: 'OSO2026_SK_tab0c', title: 'Zoznam politických strán', columns: {} }), 'unknown');
  assert.equal(classifyTable(sheet('OSO2026_SK_tab0c', 'strany', [['Kód', 'Názov'], ['1', 'x']])), null, 'číselník bez známych stĺpcov');
});

test('aggregateCandidates + rankCandidates: súčet cez okrsky, podiel, zvolený podľa značky, inak vedie; vzdanie sa', () => {
  const columns = mapColumns(['OBEC', 'VOOBEC', 'OKRSOK', 'PC_HL', 'P_HL', 'P_HL_PCT', 'KANDIDAT']);
  const groups = aggregateCandidates([
    ['501891', '1', '1', '1', '120', '60,00', ''], ['501891', '1', '1', '2', '80', '40,00', ''],
    ['501891', '1', '2', '1', '30', '30,00', ''], ['501891', '1', '2', '2', '70', '70,00', ''],
    ['999999', '1', '1', '1', '5', '100,00', 'X'],
    [null, '1', '1', '1', '5', '100,00', ''],
  ], columns, (row) => row[0] || null);
  assert.deepEqual([...groups.keys()], ['501891', '999999']);
  const ranked = rankCandidates(groups.get('501891').cands);
  assert.deepEqual(ranked.map((c) => [c.n, c.votes, c.pct, c.rank, c.leads, c.elected]), [[1, 150, 50, 1, true, false], [2, 150, 50, 2, false, false]], 'remíza: menšie číslo prvé, vedie len prvý');
  assert.equal(groups.get('501891').okrsky.size, 2);
  const withdrawn = rankCandidates(groups.get('999999').cands)[0];
  assert.equal(withdrawn.withdrawn, true);
  assert.equal(withdrawn.leads, false);
  const elected = rankCandidates(new Map([[1, { n: 1, votes: 10, flag: null }], [2, { n: 2, votes: 90, flag: 'elected' }]]));
  assert.deepEqual(elected.map((c) => [c.n, c.elected, c.leads]), [[2, true, false], [1, false, false]], 'so značkou nikto „nevedie"');
  assert.deepEqual(rankCandidates(new Map([[1, { n: 1, votes: 0, flag: null }]]))[0].leads, false, 'bez hlasov nikto nevedie');
  assert.deepEqual(rankCandidates(new Map([[1, { n: 1, votes: 5, flag: null }], [2, { n: 2, votes: 4, flag: null }], [3, { n: 3, votes: 3, flag: null }]]), { seats: 2 }).map((c) => c.leads), [true, true, false]);
});

test('buildResults: obce (starosta, poslanci, účasť, okrsky), kraje (predseda, obvody), súhrn, prehľad, stav mapy', () => {
  const tables = new Map([
    ['OSO2026_SK_tab05f', sheet('OSO2026_SK_tab05f', 'Počet a podiel platných hlasov pre kandidátov na starostu obce za okrsky', [
      ['Počet a podiel…', null], ['Kód obce', 'Volebný obvod v obci', 'Okrsok', 'Poradie na hlasovacom lístku', 'Počet platných hlasov', 'Podiel platných hlasov v %', 'Kandidát'],
      ['501891', '1', '1', '1', '200', '66,67', ''], ['501891', '1', '1', '2', '100', '33,33', ''],
    ])],
    ['OSO2026_SK_tab08f', sheet('OSO2026_SK_tab08f', 'Počet a podiel platných hlasov pre kandidátov na poslancov za okrsky', [
      ['x', null], ['Kód obce', 'Volebný obvod v obci', 'Okrsok', 'Poradie na hlasovacom lístku', 'Počet platných hlasov', 'Podiel platných hlasov v %', 'Kandidát'],
      ['501891', '1', '1', '1', '150', '', '1'], ['501891', '1', '1', '2', '120', '', '1'], ['501891', '1', '1', '3', '30', '', '0'],
      ['501891', '1', '2', '1', '10', '', '1'], ['501891', '1', '2', '2', '5', '', '1'], ['501891', '1', '2', '3', '1', '', '0'],
    ])],
    ['OSO2026_SK_tab02bf', sheet('OSO2026_SK_tab02bf', 'Súhrnné výsledky hlasovania za okrsky - Počet voličov a účasť', [
      ['x', null], ['Kód obce', 'Volebný obvod v obci', 'Okrsok', 'Počet voličov zapísaných v zoznamoch voličov', 'Počet voličov, ktorí sa zúčastnili na hlasovaní', 'Účasť v %'],
      ['501891', '1', '1', '600', '310', '51,67'], ['501891', '1', '2', '400', '190', '47,50'],
    ])],
    ['OSK2026_SK_tab05f', sheet('OSK2026_SK_tab05f', 'Počet a podiel platných hlasov pre kandidátov na predsedu samosprávneho kraja za okrsky', [
      ['x', null], ['Kód kraja', 'Kód volebného obvodu', 'Kód obce', 'Okrsok', 'Poradie na hlasovacom lístku', 'Počet platných hlasov', 'Podiel platných hlasov v %', 'Kandidát'],
      ['7', '701', '519006', '1', '8', '500', '', ''], ['7', '701', '519006', '1', '9', '400', '', ''],
      ['7', '701', '519006', '2', '8', '100', '', ''], ['7', '701', '519006', '2', '9', '300', '', ''],
    ])],
    ['OSK2026_SK_tab08f', sheet('OSK2026_SK_tab08f', 'Počet a podiel platných hlasov pre kandidátov na poslancov zastupiteľstva samosprávneho kraja za okrsky', [
      ['x', null], ['Kód kraja', 'Kód volebného obvodu', 'Kód obce', 'Okrsok', 'Poradie na hlasovacom lístku', 'Počet platných hlasov', 'Podiel platných hlasov v %', 'Kandidát'],
      ['7', '701', '519006', '1', '1', '50', '', ''], ['7', '701', '519006', '1', '2', '70', '', ''],
    ])],
    ['OSO2026_SK_tab0dd', sheet('OSO2026_SK_tab0dd', 'Územné členenie', [['Územné členenie', null], ['Kód kraja', 'Kód obce', 'Názov obce'], ['2', '501891', 'Topoľníky']])],
  ]);
  const r = buildResults(tables, MODEL, { generatedAt: 5 });
  assert.equal(r.available, true);
  assert.deepEqual(r.tables, { starosta: 'OSO2026_SK_tab05f', poslanci: 'OSO2026_SK_tab08f', ucast: 'OSO2026_SK_tab02bf', predseda: 'OSK2026_SK_tab05f', zupni: 'OSK2026_SK_tab08f' });
  const obec = r.obce.get('501891');
  assert.deepEqual(obec.starosta.map((c) => [c.n, c.priezvisko, c.votes, c.pct, c.leads, c.elected, c.known]), [[1, 'Nagyová', 200, 66.67, true, false, true], [2, 'Kiss', 100, 33.33, false, false, true]]);
  assert.equal(obec.starosta[0].strany, 'Aliancia');
  assert.equal(obec.poslanci.length, 1);
  assert.deepEqual(obec.poslanci[0].kandidati.map((c) => [c.n, c.votes, c.elected, c.leads]), [[1, 160, true, false], [2, 125, true, false], [3, 31, false, false]]);
  assert.equal(obec.poslanci[0].seats, 2);
  assert.deepEqual(obec.ucast, { registered: 1000, voted: 500, pct: 50 });
  assert.equal(obec.okrskyDone, 2, 'okrsky z poslancov aj účasti (odlišné)');
  assert.equal(obec.okrskyTotal, 2);
  assert.equal(obec.final, true);
  const kraj = r.kraje.get('7');
  assert.deepEqual(kraj.predseda.map((c) => [c.n, c.priezvisko, c.votes, c.pct, c.leads]), [[9, 'Mazurek', 700, 53.85, true], [8, 'Majerský', 600, 46.15, false]]);
  assert.equal(kraj.okrskyDone, 2);
  assert.equal(kraj.okrskyTotal, 3);
  assert.equal(kraj.final, false);
  assert.deepEqual(kraj.obvody.map((o) => [o.code, o.name, o.seats, o.kandidati[0].priezvisko, o.kandidati[0].leads]), [['701', 'Volebný obvod č. 1', 1, 'Bb', true]]);
  assert.deepEqual(r.summary, { okrskyDone: 2, okrskyTotal: 2, pct: 100, obceWithResults: 1, obceFinal: 1, registered: 1000, voted: 500, turnoutPct: 50 });
  const ov = resultsOverview(r);
  assert.equal(ov.generatedAt, new Date(5).toISOString());
  assert.deepEqual(ov.kraje, [{ code: '7', okrskyDone: 2, okrskyTotal: 3, final: false, lead: { n: 9, meno: 'Milan', priezvisko: 'Mazurek', strany: 'Republika', nezavisly: false, votes: 700, pct: 53.85, elected: false } }]);
  assert.equal(obecMapState(r, '501891'), 2);
  assert.equal(obecMapState(r, '000000'), 0);
  const empty = buildResults(new Map([['OSO2026_SK_tab0dd', tables.get('OSO2026_SK_tab0dd')]]), MODEL);
  assert.equal(empty.available, false);
  assert.equal(resultsOverview(empty), null);
  assert.equal(empty.summary.okrskyTotal, 2);
});

test('štýl 2022 (kódy stĺpcov, bez titulkov): starosta/poslanci podľa čísla tabuľky, neznámy kandidát ostáva s číslom', () => {
  const tables = new Map([
    ['OSO2022_SK_tab05f', sheet('OSO2022_SK_tab05f', null, [['OBEC', 'VOOBEC', 'OKRSOK', 'PC_HL', 'P_HL', 'P_HL_PCT', 'KANDIDAT'], ['501891', '1', '1', '7', '9', '100,00', '1']])],
    ['OSO2022_SK_tab08f', sheet('OSO2022_SK_tab08f', null, [['OBEC', 'VOOBEC', 'OKRSOK', 'PC_HL', 'P_HL', 'P_HL_PCT', 'KANDIDAT'], ['501891', '1', '1', '1', '9', '100,00', '1']])],
  ]);
  const r = buildResults(tables, MODEL);
  const obec = r.obce.get('501891');
  assert.deepEqual(obec.starosta.map((c) => [c.n, c.known, c.elected, c.priezvisko]), [[7, false, true, '']]);
  assert.equal(obec.poslanci[0].kandidati[0].priezvisko, 'Nagy');
  assert.equal(obec.final, false, '1 z 2 okrskov');
  assert.equal(obec.okrskyDone, 1);
});
