// src/data/volbyCandidates.test.mjs — model kandidátov VOĹBY 2026 (2026-10-24): spojenie registra MV SR
// s číselníkom ŠÚ SR podľa kódu okresu a mena, celomestské voľby Bratislavy a Košíc, náhradné kódy,
// hľadanie, kraje s obvodmi, fáza dňa.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CITY_DISTRICT_CODES, KRAJE, POLLS_CLOSE_MS, buildKraje, buildModel, buildObce, candidateName, electionPhase, field,
  foldText, krajByName, krajByOkresCode, krajDetail, obecDetail, overview, parseCandidate, searchObce, summarize, topMesta,
} from './volbyCandidates.js';

const STRANY = 'Názov politickej strany, názvy politických strán tvoriacich koalíciu, nezávislý kandidát';
const uz = (kraj, okresCode, okres, code, name, seats, okrsky = 3, vo = 1) => ({
  'Kód kraja': kraj, 'Názov kraja': KRAJE[Number(kraj) - 1].name, 'Kód územného obvodu': okresCode, 'Názov územného obvodu': okres,
  'Kód okresu': okresCode, 'Názov okresu': okres, 'Kód obce': code, 'Názov obce': name, 'Počet volebných obvodov': String(vo),
  'Počet okrskov': String(okrsky), 'Počet volených poslancov': String(seats), 'Typ volieb': 'Starosta a zastupiteľstvo',
});
const UZEMIE = [
  uz('1', '101', 'Bratislava I', '528595', 'Bratislava - Staré Mesto', 25, 34, 8),
  uz('2', '201', 'Dunajská Streda', '501891', 'Topoľníky', 9),
  uz('2', '201', 'Dunajská Streda', '501956', 'Veľký Meder', 13, 9, 2),
  uz('4', '403', 'Nitra', '500011', 'Nitra', 31, 70, 7),
];
const MESTA = [{ 'Kód mesta': '582000', 'Názov mesta': 'Bratislava', 'Počet volebných obvodov': '11', 'Počet okrskov': '388', 'Počet volených poslancov': '45', 'Typ volieb': 'Starosta a zastupiteľstvo' }];
const st = (okres, obec, n, meno, priezvisko, titul, vek, zam, strany, kod) => ({
  Okres: okres, Obec: obec, 'Poradové               číslo kandidáta': n, Meno: meno, Priezvisko: priezvisko, Titul: titul, Vek: vek, Zamestnanie: zam, [STRANY]: strany, 'Kód okresu': kod,
});
const STAROSTA = [
  st('Bratislava', 'Bratislava', '3', 'Jozef', 'Ráž', 'JUDr. Ing.', '47', 'minister', 'Nezávislý kandidát', '100'),
  st('Bratislava', 'Bratislava', '1', 'Ľubomír', 'Geci', null, '29', 'softvérový vývojár', 'Myslovensko', '100'),
  st('Dunajská Streda', 'Topoľníky', '1', 'Anna', 'Nagyová', 'Mgr.', '50', 'starostka', 'Szövetség - Aliancia', '201'),
  st('Dunajská Streda', 'Topoľníky', '2', 'Peter', 'Kiss', '', '41', 'podnikateľ', 'Nezávislý kandidát', '201'),
  st('Nitra', 'Nitra', '1', 'Marek', 'Hattas', '', '38', 'primátor', 'Tím kraj Nitra; Progresívne Slovensko', '403'),
  st('Nitra', 'Zaniknutá Ves', '1', 'Ján', 'Nový', '', '60', 'dôchodca', 'Smer - sociálna demokracia', '403'),
];
const po = (okres, obec, obvod, n, meno, priezvisko, kod) => ({
  Okres: okres, Obec: obec, 'Volebný obvod': obvod, 'Poradové           číslo kandidáta': n, Meno: meno, Priezvisko: priezvisko, Titul: '', Vek: '40', Zamestnanie: 'x', [STRANY]: 'Nezávislý kandidát', 'Kod okresu': kod,
});
const POSLANCI = [
  po('Dunajská Streda', 'Topoľníky', '1', '2', 'B', 'Bb', '201'), po('Dunajská Streda', 'Topoľníky', '1', '1', 'A', 'Aa', '201'),
  po('Bratislava', 'Bratislava', '2', '1', 'C', 'Cc', '100'), po('Bratislava', 'Bratislava', '1', '1', 'D', 'Dd', '100'),
];
const PREDSEDA = [
  { Kraj: 'Bratislavský samosprávny kraj', 'Poradové               číslo kandidáta': '2', Meno: 'Rastislav', Priezvisko: 'Gajarský', 'Titul pred menom': 'Mgr.', 'Titul za menom': 'MBA', Vek: '48', Zamestnanie: 'prednosta', 'Obec trvalého pobytu kandidáta': 'Bratislava - Ružinov', [STRANY]: 'Smer - sociálna demokracia, Hlas - sociálna demokracia' },
  { Kraj: 'Bratislavský samosprávny kraj', 'Poradové               číslo kandidáta': '1', Meno: 'Juraj', Priezvisko: 'Droba', 'Titul pred menom': 'Mgr.', 'Titul za menom': 'MBA, MA', Vek: '55', Zamestnanie: 'predseda samosprávneho kraja', 'Obec trvalého pobytu kandidáta': 'Bratislava - Staré Mesto', [STRANY]: 'Sloboda a solidarita, Progresívne Slovensko' },
  { Kraj: 'Košický samosprávny kraj', 'Poradové               číslo kandidáta': '1', Meno: 'K', Priezvisko: 'Kk', 'Titul pred menom': '', 'Titul za menom': '', Vek: '', Zamestnanie: '', 'Obec trvalého pobytu kandidáta': 'Košice', [STRANY]: 'Nezávislý kandidát' },
];
const ZUPNI = [
  { Kraj: 'Bratislavský samosprávny kraj', 'Volebný obvod': '1', 'Poradové             číslo kandidáta': '1', Meno: 'Miroslava', Priezvisko: 'Bátovská', 'Titul pred menom': 'Bc.', 'Titul za menom': '', Vek: '51', Zamestnanie: 'manažérka', 'Obec TP kandidáta': 'Bratislava - Staré Mesto', [STRANY]: 'Progresívne Slovensko' },
  { Kraj: 'Bratislavský samosprávny kraj', 'Volebný obvod': '7', 'Poradové             číslo kandidáta': '1', Meno: 'X', Priezvisko: 'Xx', 'Titul pred menom': '', 'Titul za menom': '', Vek: '30', Zamestnanie: '', 'Obec TP kandidáta': 'Senec', [STRANY]: 'Nezávislý kandidát' },
];
const OBVODY_KRAJ = [
  { 'Kód kraja': '1', 'Názov kraja': 'Bratislavský kraj', 'Kód volebného obvodu': '101', 'Názov volebného obvodu': 'Volebný obvod č. 1', 'Počet volebných okrskov': '34', 'Počet volených poslancov': '4' },
  { 'Kód kraja': '1', 'Názov kraja': 'Bratislavský kraj', 'Kód volebného obvodu': '107', 'Názov volebného obvodu': 'Volebný obvod č. 7', 'Počet volebných okrskov': '40', 'Počet volených poslancov': '5' },
];
const OBCE_OBVODY = [
  { 'Kód kraja': '1', 'Názov kraja': 'Bratislavský kraj', 'Kód volebného obvodu': '101', 'Názov volebného obvodu': 'Volebný obvod č. 1', 'Kód obce': '528595', 'Názov obce': 'Bratislava - Staré Mesto', 'Počet volebných okrskov': '34' },
];
const GEO = [['528595', 48.1447, 17.1095, 'obec'], ['501891', 47.9, 17.78, 'obec'], ['582000', 48.1486, 17.1077, 'obec'], ['500011', 48.3069, 18.0864, 'obec'], ['501956', 47.86, 17.77, 'okres']];
const TABLES = { predseda: PREDSEDA, zupni: ZUPNI, starosta: STAROSTA, poslanci: POSLANCI, uzemie: UZEMIE, mesta: MESTA, obvodyKraj: OBVODY_KRAJ, obceObvody: OBCE_OBVODY, geo: GEO };

test('foldText, field bez diakritiky, kraj podľa mena a okresu, parseCandidate, meno s titulmi', () => {
  assert.equal(foldText(' Žitná - Radiša '), 'zitna radisa');
  assert.equal(field({ 'Kod okresu': '201' }, 'Kód okresu'), '201');
  assert.equal(field({ 'Poradové               číslo kandidáta': '3' }, 'Poradové číslo kandidáta'), '3');
  assert.equal(krajByName('Banskobystrický samosprávny kraj').code, '6');
  assert.equal(krajByName('Žilinský kraj').short, 'ZA');
  assert.equal(krajByName('7').name, 'Prešovský kraj');
  assert.equal(krajByName('Moravský'), null);
  assert.equal(krajByOkresCode('806').name, 'Košický kraj');
  assert.equal(krajByOkresCode(''), null);
  const c = parseCandidate(PREDSEDA[1]);
  assert.deepEqual(c, { n: 1, meno: 'Juraj', priezvisko: 'Droba', titulPred: 'Mgr.', titulZa: 'MBA, MA', vek: 55, zamestnanie: 'predseda samosprávneho kraja', bydlisko: 'Bratislava - Staré Mesto', strany: 'Sloboda a solidarita, Progresívne Slovensko', nezavisly: false });
  assert.equal(candidateName(c), 'Mgr. Juraj Droba, MBA, MA');
  const s = parseCandidate(STAROSTA[0]);
  assert.equal(s.titulPred, 'JUDr. Ing.');
  assert.equal(s.nezavisly, true);
  assert.equal(candidateName(s), 'JUDr. Ing. Jozef Ráž');
  assert.equal(parseCandidate(PREDSEDA[2]).vek, null, 'prázdny vek = null, nie NaN');
});

test('obce: spojenie podľa okresu a mena, mesto Bratislava (kód okresu 100 → 582000), náhradný kód pre nespojenú obec, polohy', () => {
  const obce = buildObce(TABLES);
  const byCode = new Map(obce.map((o) => [o.code, o]));
  assert.equal(obce.length, 6, '4 obce + mesto + nespojená');
  const topolniky = byCode.get('501891');
  assert.equal(topolniky.counts.starosta, 2);
  assert.deepEqual(topolniky.starosta.map((c) => c.n), [1, 2], 'zoradené podľa poradového čísla');
  assert.deepEqual(topolniky.poslanci, [{ obvod: '1', kandidati: [parseCandidate(POSLANCI[1]), parseCandidate(POSLANCI[0])] }]);
  assert.equal(topolniky.lat, 47.9);
  assert.equal(topolniky.precision, 'obec');
  assert.equal(topolniky.kraj, 'Trnavský kraj');
  const ba = byCode.get(CITY_DISTRICT_CODES[100]);
  assert.equal(ba.name, 'Bratislava');
  assert.equal(ba.city, true);
  assert.equal(ba.seats, 45);
  assert.deepEqual(ba.starosta.map((c) => c.priezvisko), ['Geci', 'Ráž']);
  assert.deepEqual(ba.poslanci.map((x) => x.obvod), ['1', '2'], 'obvody v číselnom poradí');
  assert.equal(ba.krajCode, '1');
  const nitra = byCode.get('500011');
  assert.equal(nitra.counts.starosta, 1);
  const ghost = obce.find((o) => o.unmatched);
  assert.equal(ghost.code, 'x403-zaniknuta-ves');
  assert.equal(ghost.name, 'Zaniknutá Ves');
  assert.equal(ghost.okres, 'Nitra');
  assert.equal(ghost.kraj, 'Nitriansky kraj');
  assert.equal(ghost.lat, null);
  assert.equal(byCode.get('501956').precision, 'okres');
  assert.equal(byCode.get('528595').counts.starosta, 0, 'Staré Mesto bez kandidátov v tomto fixture');
});

test('kraje: predsedovia zoradení, obvody s mandátmi a obcami, kandidáti podľa obvodu, počty', () => {
  const kraje = buildKraje(TABLES);
  assert.equal(kraje.length, 8);
  const ba = kraje[0];
  assert.deepEqual(ba.predseda.map((c) => c.priezvisko), ['Droba', 'Gajarský']);
  assert.deepEqual(ba.obvody.map((o) => [o.code, o.n, o.seats, o.kandidati.length, o.obce.length]), [['101', 1, 4, 1, 1], ['107', 7, 5, 1, 0]]);
  assert.deepEqual(ba.counts, { predseda: 2, poslanci: 2, seats: 9, obvody: 2, obce: 1 });
  assert.equal(kraje[7].counts.predseda, 1, 'Košický kraj má jedného');
  assert.deepEqual(kraje[1].counts, { predseda: 0, poslanci: 0, seats: 0, obvody: 0, obce: 0 }, 'kraj bez dát ostáva v zozname');
});

test('buildModel: obec vie svoj krajský obvod, kraj má stred; súhrn, prehľad, detaily, fáza', () => {
  const now = Date.UTC(2026, 9, 24, 10, 0, 0);
  const model = buildModel(TABLES, { generatedAt: now, sources: { minv: 'x' } });
  assert.equal(model.obecByCode.get('528595').krajObvod, '101');
  assert.deepEqual(model.kraje[0].center, { lat: +((48.1447 + 48.1486) / 2).toFixed(4), lon: +((17.1095 + 17.1077) / 2).toFixed(4) }, 'stred z obcí s presnosťou obec');
  assert.equal(model.kraje[1].center.lat, 47.9, 'Veľký Meder (stred okresu) sa do stredu kraja nepočíta');
  assert.deepEqual(summarize(model), { obce: 5, obceNezaradene: 1, starosta: 6, poslanci: 4, predseda: 3, zupni: 2 });
  const ov = overview(model, { nowMs: now });
  assert.equal(ov.phase, 'before');
  assert.equal(ov.pollsCloseAt, '2026-10-24T18:00:00.000Z');
  assert.equal(ov.kraje.length, 8);
  assert.ok(!('predseda' in ov.kraje[0]), 'prehľad nenesie kandidátov');
  assert.deepEqual(ov.mesta.map((m) => m.name), ['Bratislava', 'Nitra', 'Veľký Meder', 'Topoľníky'], 'mestá podľa mandátov, bez mestských častí');
  const kd = krajDetail(model, '1');
  assert.equal(kd.predseda.length, 2);
  assert.equal(kd.obvody[0].kandidati[0].priezvisko, 'Bátovská');
  assert.equal(krajDetail(model, '9'), null);
  const od = obecDetail(model, '528595');
  assert.deepEqual(od.krajObvod, { code: '101', name: 'Volebný obvod č. 1', seats: 4, kandidati: 1 });
  assert.equal(od.kandidati.starosta.length, 0);
  assert.equal(obecDetail(model, 'nope'), null);
  assert.equal(electionPhase(POLLS_CLOSE_MS - 1), 'before');
  assert.equal(electionPhase(POLLS_CLOSE_MS), 'counting');
});

test('hľadanie: začiatok mena pred výskytom, mesto pred mestskou časťou, kód obce, slovo v mene, limit', () => {
  const model = buildModel(TABLES);
  assert.deepEqual(searchObce(model, 'brat').map((o) => o.name), ['Bratislava', 'Bratislava - Staré Mesto']);
  assert.deepEqual(searchObce(model, 'staré mesto').map((o) => o.name), ['Bratislava - Staré Mesto']);
  assert.deepEqual(searchObce(model, 'TOPOL').map((o) => o.code), ['501891']);
  assert.deepEqual(searchObce(model, '500011').map((o) => o.name), ['Nitra']);
  assert.deepEqual(searchObce(model, 'meder').map((o) => o.name), ['Veľký Meder'], 'slovo vnútri mena');
  assert.equal(searchObce(model, 'a', 2).length, 2);
  assert.deepEqual(searchObce(model, ''), []);
  const row = searchObce(model, 'Nitra')[0];
  assert.deepEqual(Object.keys(row).sort(), ['city', 'code', 'kraj', 'krajCode', 'lat', 'lon', 'name', 'okres', 'okresCode', 'okrsky', 'poslanci', 'precision', 'seats', 'starosta', 'unmatched'].sort());
  assert.equal(topMesta(model, 1)[0].name, 'Bratislava');
});
