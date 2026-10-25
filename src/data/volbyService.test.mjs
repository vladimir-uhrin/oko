// src/data/volbyService.test.mjs — služba /api/volby (2026-10-24): sťahovanie s diskovou cache a TTL,
// podmienené dopyty, podávanie starého stavu pri výpadku, trasy a tvar odpovedí, výsledkové tabuľky
// ŠÚ SR po 20:00, registrácia vo vite.config.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { xlsxBuffer, zipBuffer } from './fixtures/xlsxFixture.mjs';
import {
  MINV_SOURCES, MINV_TTL_MS, SUSR_SOURCES, SUSR_TTL_BEFORE_MS, SUSR_TTL_COUNTING_MS, VOLBY_PATH,
  createVolbyService, isResultsTable, parseSusrZip, resultsSummary, susrTtlMs, volbyPlugin,
} from './volbyService.js';
import { POLLS_CLOSE_MS } from './volbyCandidates.js';

const STRANY = 'Názov politickej strany, názvy politických strán tvoriacich koalíciu, nezávislý kandidát';
const TITLE = ['Zoznam zaregistrovaných kandidátov', null];
const DATE = ['Voľby do orgánov samosprávy obcí  24. októbra 2026', null];
const minv = {
  predseda: xlsxBuffer([{ name: 'Voľby predsedu VÚC', rows: [TITLE, DATE,
    ['Kraj', 'Poradové               číslo kandidáta', 'Meno', 'Priezvisko', 'Titul pred menom', 'Titul za menom', 'Vek', 'Zamestnanie', 'Obec trvalého pobytu kandidáta', STRANY],
    ['Bratislavský samosprávny kraj', '1', 'Juraj', 'Droba', 'Mgr.', 'MBA, MA', '55', 'predseda', 'Bratislava - Staré Mesto', 'Sloboda a solidarita, Progresívne Slovensko'],
    ['Košický samosprávny kraj', '1', 'Rastislav', 'Trnka', 'Ing.', '', '45', 'predseda', 'Košice', 'Nezávislý kandidát']] }]),
  zupni: xlsxBuffer([{ name: 'Voľby poslancov VÚC', rows: [TITLE, DATE,
    ['Kraj', 'Volebný obvod', 'Poradové             číslo kandidáta', 'Meno', 'Priezvisko', 'Titul pred menom', 'Titul za menom', 'Vek', 'Zamestnanie', 'Obec TP kandidáta', STRANY],
    ['Bratislavský samosprávny kraj', '1', '1', 'Miroslava', 'Bátovská', 'Bc.', '', '51', 'manažérka', 'Bratislava - Staré Mesto', 'Progresívne Slovensko']] }]),
  starosta: xlsxBuffer([{ name: 'Voľby starostov obcí', rows: [TITLE, DATE,
    ['Okres', 'Obec', 'Poradové               číslo kandidáta', 'Meno', 'Priezvisko', 'Titul', 'Vek', 'Zamestnanie', STRANY, 'Kód okresu'],
    ['Bratislava', 'Bratislava', '1', 'Jozef', 'Ráž', 'JUDr. Ing.', '47', 'minister', 'Nezávislý kandidát', '100'],
    ['Dunajská Streda', 'Topoľníky', '1', 'Anna', 'Nagyová', 'Mgr.', '50', 'starostka', 'Szövetség - Aliancia', '201']] }]),
  poslanci: xlsxBuffer([{ name: 'Voľby poslancov zastupiteľstiev', rows: [TITLE, DATE,
    ['Okres', 'Obec', 'Volebný obvod', 'Poradové           číslo kandidáta', 'Meno', 'Priezvisko', 'Titul', 'Vek', 'Zamestnanie', STRANY, 'Kod okresu'],
    ['Dunajská Streda', 'Topoľníky', '1', '1', 'Béla', 'Nagy', '', '44', 'podnikateľ', 'Nezávislý kandidát', '201'],
    ['Dunajská Streda', 'Topoľníky', '1', '2', 'Zoltán', 'Kiss', 'Ing.', '39', 'učiteľ', 'Szövetség - Aliancia', '201']] }]),
};
const osoTables = (extra = []) => zipBuffer([
  ['OSO2026_SK_tab_info.xlsx', xlsxBuffer([{ name: 'Zoznam tabuliek', rows: [['Zoznam tabuliek', null], ['Názov súboru', 'Názov tabuľky'], ['OSO2026_SK_tab0dd', 'Územné členenie'], ['OSO2026_SK_tab0dx', 'Územné členenie za mestá Bratislava a Košice'], ['OSO2026_SK_tab03', 'Výsledky volieb starostov']] }])],
  ['OSO2026_SK_tab0dd.xlsx', xlsxBuffer([{ name: 'OSO2026_SK_tab0dd', rows: [['Územné členenie', null],
    ['Kód kraja', 'Názov kraja', 'Kód územného obvodu', 'Názov územného obvodu', 'Kód okresu', 'Názov okresu', 'Kód obce', 'Názov obce', 'Počet volebných obvodov', 'Počet okrskov', 'Počet volených poslancov', 'Typ volieb'],
    ['2', 'Trnavský kraj', '201', 'Dunajská Streda', '201', 'Dunajská Streda', '501891', 'Topoľníky', '1', '3', '9', 'Starosta a zastupiteľstvo']] }])],
  ['OSO2026_SK_tab0dx.xlsx', xlsxBuffer([{ name: 'OSO2026_SK_tab0dx', rows: [['Územné členenie za mestá Bratislava a Košice', null],
    ['Kód mesta', 'Názov mesta', 'Počet volebných obvodov', 'Počet okrskov', 'Počet volených poslancov', 'Typ volieb'],
    ['582000', 'Bratislava', '11', '388', '45', 'Starosta a zastupiteľstvo']] }])],
  ...extra,
]);
const oskTables = zipBuffer([
  ['OSK2026_SK_tab0db.xlsx', xlsxBuffer([{ name: 'OSK2026_SK_tab0db', rows: [['Územné členenie za volebné obvody', null],
    ['Kód kraja', 'Názov kraja', 'Kód volebného obvodu', 'Názov volebného obvodu', 'Počet volebných okrskov', 'Počet volených poslancov'],
    ['1', 'Bratislavský kraj', '101', 'Volebný obvod č. 1', '34', '4']] }])],
  ['OSK2026_SK_tab0dc.xlsx', xlsxBuffer([{ name: 'OSK2026_SK_tab0dc', rows: [['Územné členenie za obce', null],
    ['Kód kraja', 'Názov kraja', 'Kód volebného obvodu', 'Názov volebného obvodu', 'Kód obce', 'Názov obce', 'Počet volebných okrskov'],
    ['1', 'Bratislavský kraj', '101', 'Volebný obvod č. 1', '528595', 'Bratislava - Staré Mesto', '34']] }])],
]);
const RESULTS_TABLE = ['OSO2026_SK_tab03.xlsx', xlsxBuffer([{ name: 'OSO2026_SK_tab03', rows: [['Výsledky volieb starostov', null], ['Kód obce', 'Názov obce', 'Meno', 'Priezvisko', 'Počet hlasov'], ['501891', 'Topoľníky', 'Anna', 'Nagyová', '412']] }])];

function makeFetch(bodies, { status = 200, onCall = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, headers: init.headers || {} });
    onCall?.(url, init);
    const body = bodies(url);
    if (body === 304) return new Response(null, { status: 304 });
    if (!body) return new Response('nope', { status: 404 });
    return new Response(body, { status, headers: { ETag: `"${url.length}"`, 'Last-Modified': 'Tue, 20 Oct 2026 08:35:00 GMT' } });
  };
  return { fetchImpl, calls };
}
const allBodies = (url) => {
  for (const [key, src] of Object.entries(MINV_SOURCES)) if (url === src.url) return minv[key];
  if (url === SUSR_SOURCES.oso) return osoTables();
  if (url === SUSR_SOURCES.osk) return oskTables;
  return null;
};
const GEO = path.join(os.tmpdir(), `volby-geo-${process.pid}.json`);
fs.writeFileSync(GEO, JSON.stringify({ meta: {}, rows: [['501891', 47.9, 17.78, 'obec'], ['582000', 48.1486, 17.1077, 'obec']] }));
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'volby-cache-'));
const quiet = { info() {}, warn() {} };
const registry = { record() {} };

async function call(service, url) {
  let status = 0; let headers = {}; let body = '';
  const res = { writeHead: (s, h) => { status = s; headers = h; }, end: (b) => { body = b; } };
  let nexted = false;
  await service.middleware({ url, method: 'GET', headers: {} }, res, () => { nexted = true; });
  const isJson = String(headers['Content-Type'] || '').startsWith('application/json');
  return { status, headers, json: body && isJson ? JSON.parse(body) : null, text: typeof body === 'string' ? body : '', buffer: Buffer.isBuffer(body) ? body : null, nexted };
}

test('TTL ŠÚ SR podľa fázy, rozpoznanie výsledkových tabuliek, parseSusrZip s titulkami', () => {
  assert.equal(susrTtlMs(POLLS_CLOSE_MS - 3600_000), SUSR_TTL_BEFORE_MS);
  assert.equal(susrTtlMs(POLLS_CLOSE_MS - 10 * 60_000), SUSR_TTL_COUNTING_MS, 'pol hodiny pred zatvorením už často');
  assert.equal(susrTtlMs(POLLS_CLOSE_MS + 1), SUSR_TTL_COUNTING_MS);
  assert.equal(isResultsTable('OSO2026_SK_tab03'), true);
  assert.equal(isResultsTable('OSK2026_SK_tab12a'), true);
  assert.equal(isResultsTable('OSO2026_SK_tab0dd'), false);
  assert.equal(isResultsTable('OSO2026_SK_tab0c'), false);
  assert.equal(isResultsTable('OSO2026_SK_tab_info'), false);
  const tables = parseSusrZip(osoTables([RESULTS_TABLE]));
  assert.deepEqual([...tables.keys()].sort(), ['OSO2026_SK_tab03', 'OSO2026_SK_tab0dd', 'OSO2026_SK_tab0dx', 'OSO2026_SK_tab_info']);
  assert.equal(tables.get('OSO2026_SK_tab0dd').title, 'Územné členenie');
  assert.equal(tables.get('OSO2026_SK_tab03').title, 'Výsledky volieb starostov');
  assert.deepEqual(resultsSummary(tables), { tables: [{ name: 'OSO2026_SK_tab03', title: 'Výsledky volieb starostov', rows: 1 }] });
  assert.equal(resultsSummary(parseSusrZip(osoTables())), null);
});

test('prvý dopyt stiahne 6 súborov a postaví model; druhý ide z disku; po TTL podmienené sťahovanie (304)', async () => {
  let clock = POLLS_CLOSE_MS - 8 * 3600_000;
  const now = () => clock;
  let mode = 'full';
  const { fetchImpl, calls } = makeFetch((url) => (mode === '304' ? 304 : allBodies(url)));
  const cacheDir = tmpDir();
  const service = createVolbyService({ cacheDir, fetchImpl, now, geoPath: GEO, registry, log: quiet });
  const first = await call(service, '/prehlad');
  assert.equal(first.status, 200);
  assert.equal(calls.length, 6, '4 XLSX MV SR + 2 ZIPy ŠÚ SR');
  assert.equal(first.json.phase, 'before');
  assert.deepEqual(first.json.counts, { obce: 2, obceNezaradene: 0, starosta: 2, poslanci: 2, predseda: 2, zupni: 1 });
  assert.equal(first.json.results, null, 'pred 20:00 žiadne výsledkové tabuľky');
  assert.equal(first.json.sources.minv.ok, true);
  assert.equal(first.json.sources.susr.lastModified, 'Tue, 20 Oct 2026 08:35:00 GMT');
  assert.match(first.headers['Cache-Control'], /max-age=60/);
  assert.equal(fs.readdirSync(cacheDir).length, 12, 'súbor + meta pre každý zdroj');

  // Nová inštancia (reštart služby) číta z disku — nič sa nesťahuje.
  const restarted = createVolbyService({ cacheDir, fetchImpl, now, geoPath: GEO, registry, log: quiet });
  const second = await call(restarted, '/obce?q=topo');
  assert.equal(second.status, 200);
  assert.equal(calls.length, 6, 'čerstvá cache = bez siete');
  assert.deepEqual(second.json.results.map((o) => [o.code, o.name, o.starosta, o.poslanci, o.lat]), [['501891', 'Topoľníky', 1, 2, 47.9]]);

  // Po TTL číselníkov ŠÚ SR: podmienený dopyt s ETagom, 304 → stav ostáva, čas obnovy sa posunie.
  clock += SUSR_TTL_BEFORE_MS + 1;
  mode = '304';
  assert.equal(restarted.isStale(), true);
  await call(restarted, '/prehlad');
  await restarted._state.refreshing;
  const susrCalls = calls.slice(6);
  assert.equal(susrCalls.length, 2, 'MV SR má TTL 12 h — nesťahuje sa');
  assert.ok(susrCalls.every((c) => c.headers['If-None-Match'] === `"${c.url.length}"`), 'If-None-Match z uloženého ETagu');
  assert.equal(restarted.isStale(), false);
  assert.equal((await call(restarted, '/status')).json.obce, 2);
});

test('trasy: kraj, obec (aj mesto 582000), hľadanie s limitom a krátkym dopytom, tabuľky, 404, 405', async () => {
  const { fetchImpl } = makeFetch(allBodies);
  const service = createVolbyService({ cacheDir: tmpDir(), fetchImpl, now: () => POLLS_CLOSE_MS - 3600_000, geoPath: GEO, registry, log: quiet });
  const kraj = await call(service, '/kraj/1');
  assert.equal(kraj.status, 200);
  assert.equal(kraj.json.predseda[0].priezvisko, 'Droba');
  assert.deepEqual(kraj.json.obvody.map((o) => [o.code, o.seats, o.kandidati.length, o.obce.length]), [['101', 4, 1, 1]]);
  assert.match(kraj.headers['Cache-Control'], /max-age=300/);
  assert.equal((await call(service, '/kraj/9')).status, 404);
  const obec = await call(service, '/obec/501891');
  assert.equal(obec.json.name, 'Topoľníky');
  assert.equal(obec.json.kandidati.starosta[0].priezvisko, 'Nagyová');
  assert.deepEqual(obec.json.kandidati.poslanci[0].kandidati.map((c) => c.priezvisko), ['Nagy', 'Kiss']);
  const ba = await call(service, '/obec/582000');
  assert.equal(ba.json.city, true);
  assert.equal(ba.json.kandidati.starosta[0].priezvisko, 'Ráž');
  assert.equal((await call(service, '/obec/000000')).status, 404);
  assert.equal((await call(service, '/obce?q=t')).status, 400, 'jedno písmeno nestačí');
  assert.equal((await call(service, '/obce?q=582000')).json.results[0].name, 'Bratislava', 'kód obce prejde aj ako číslo');
  assert.equal((await call(service, '/obce?q=brati&limit=1')).json.results.length, 1);
  const tabulky = await call(service, '/tabulky');
  assert.equal(tabulky.json.count, 5);
  assert.ok(tabulky.json.tables.every((t) => t.results === false));
  const tab = await call(service, '/tabulka/OSO2026_SK_tab0dd');
  assert.equal(tab.json.title, 'Územné členenie');
  assert.equal(tab.json.sheets[0].rows.length, 3);
  assert.equal((await call(service, '/tabulka/nic')).status, 404);
  const unknown = await call(service, '/nieco');
  assert.equal(unknown.nexted, true, 'neznáma trasa ide ďalej (next)');
  let status = 0;
  await service.middleware({ url: '/prehlad', method: 'POST', headers: {} }, { writeHead: (s) => { status = s; }, end() {} }, () => {});
  assert.equal(status, 405);
});

test('výpadok zdroja: bez cache sa model postaví z toho, čo je (náhradné kódy obcí); s cache sa podáva starý stav ako stale', async () => {
  let clock = POLLS_CLOSE_MS - 3600_000;
  const now = () => clock;
  let susrDown = true;
  const { fetchImpl } = makeFetch((url) => (susrDown && Object.values(SUSR_SOURCES).includes(url) ? null : allBodies(url)));
  const cacheDir = tmpDir();
  const service = createVolbyService({ cacheDir, fetchImpl, now, geoPath: GEO, registry, log: quiet });
  const first = await call(service, '/prehlad');
  assert.equal(first.status, 200, 'kandidáti MV SR stačia na odpoveď');
  assert.equal(first.json.sources.susr.ok, false);
  assert.deepEqual(first.json.sources.susr.errors, ['HTTP 404', 'HTTP 404']);
  assert.equal(first.json.counts.obceNezaradene, 2, 'bez číselníka ŠÚ SR majú obce náhradné kódy');
  const search = await call(service, '/obce?q=topo');
  assert.equal(search.json.results[0].code, 'x201-topolniky');
  assert.equal(search.json.results[0].unmatched, true);

  // ŠÚ SR nabehne → po TTL sa číselník dotiahne a obce dostanú pravé kódy.
  susrDown = false;
  clock += SUSR_TTL_BEFORE_MS + 1;
  await call(service, '/prehlad');
  await service._state.refreshing;
  assert.equal((await call(service, '/obce?q=topo')).json.results[0].code, '501891');
  assert.equal((await call(service, '/prehlad')).json.counts.obceNezaradene, 0);

  // Potom výpadok všetkého: starý stav ostáva, zdroje sú označené stale s chybou.
  const { fetchImpl: failing } = makeFetch(() => null);
  const stale = createVolbyService({ cacheDir, fetchImpl: failing, now: () => clock + MINV_TTL_MS + 1, geoPath: GEO, registry, log: quiet });
  const res = await call(stale, '/prehlad');
  assert.equal(res.status, 200);
  assert.equal(res.json.counts.starosta, 2);
  assert.equal(res.json.sources.minv.stale, true);
  assert.equal(res.json.sources.minv.ok, true, 'buffer z disku je k dispozícii');
  assert.deepEqual(res.json.sources.minv.errors.length, 4);
});

test('po 20:00: fáza sčítavanie, TTL 3 min, výsledkové tabuľky ŠÚ SR v prehľade aj v /tabulky', async () => {
  let withResults = false;
  const { fetchImpl, calls } = makeFetch((url) => (url === SUSR_SOURCES.oso ? osoTables(withResults ? [RESULTS_TABLE] : []) : allBodies(url)));
  let clock = POLLS_CLOSE_MS + 60_000;
  const service = createVolbyService({ cacheDir: tmpDir(), fetchImpl, now: () => clock, geoPath: GEO, registry, log: quiet });
  const before = await call(service, '/prehlad');
  assert.equal(before.json.phase, 'counting');
  assert.equal(before.json.results, null);
  withResults = true;
  clock += SUSR_TTL_COUNTING_MS + 1;
  await call(service, '/prehlad');
  await service._state.refreshing;
  assert.equal(calls.filter((c) => /.(zip|xlsx)$/.test(c.url)).length, 8, 'po 3 min sa dotiahli len ZIPy ŠÚ SR (živé JSON sa počítajú zvlášť)');
  const after = await call(service, '/prehlad');
  assert.deepEqual(after.json.results, { tables: [{ name: 'OSO2026_SK_tab03', title: 'Výsledky volieb starostov', rows: 1 }] });
  const tabulky = await call(service, '/tabulky');
  assert.equal(tabulky.json.tables.find((t) => t.name === 'OSO2026_SK_tab03').results, true);
  const tab = await call(service, '/tabulka/OSO2026_SK_tab03');
  assert.deepEqual(tab.json.sheets[0].rows[2], ['501891', 'Topoľníky', 'Anna', 'Nagyová', '412']);
  assert.equal(after.json.vysledky, null, 'tab03 bez stĺpcov hlasov nie je výsledková tabuľka modelu');
});

const STAROSTA_RESULTS = ['OSO2026_SK_tab05f.xlsx', xlsxBuffer([{ name: 'OSO2026_SK_tab05f', rows: [['Počet a podiel platných hlasov pre kandidátov na starostu obce za okrsky', null],
  ['Kód obce', 'Volebný obvod v obci', 'Okrsok', 'Poradie na hlasovacom lístku', 'Počet platných hlasov', 'Podiel platných hlasov v %', 'Kandidát'],
  ['501891', '1', '1', '1', '200', '66,67', ''], ['501891', '1', '1', '2', '100', '33,33', ''], ['501891', '1', '2', '1', '50', '50,00', ''], ['501891', '1', '2', '2', '50', '50,00', '']] }])];
const UCAST_RESULTS = ['OSO2026_SK_tab02bf.xlsx', xlsxBuffer([{ name: 'OSO2026_SK_tab02bf', rows: [['Súhrnné výsledky hlasovania za okrsky - Počet voličov a účasť', null],
  ['Kód obce', 'Volebný obvod v obci', 'Okrsok', 'Počet voličov zapísaných v zoznamoch voličov', 'Počet voličov, ktorí sa zúčastnili na hlasovaní', 'Účasť v %'],
  ['501891', '1', '1', '600', '310', '51,67'], ['501891', '1', '2', '400', '190', '47,50']] }])];

test('výsledky v odpovediach: prehľad nesie súhrn a vedúcich, obec hlasy a účasť, /obce-body stav a vedúceho pre mapu', async () => {
  const { fetchImpl } = makeFetch((url) => (url === SUSR_SOURCES.oso ? osoTables([STAROSTA_RESULTS, UCAST_RESULTS]) : allBodies(url)));
  const service = createVolbyService({ cacheDir: tmpDir(), fetchImpl, now: () => POLLS_CLOSE_MS + 3600_000, geoPath: GEO, registry, log: quiet, sweep: false });
  const prehlad = await call(service, '/prehlad');
  assert.equal(prehlad.json.phase, 'counting');
  // tab0dd fixture: Topoľníky 3 okrsky; mesto Bratislava (388) sa do súčtu SR nepočíta (tie isté okrsky ako mestské časti).
  assert.deepEqual(prehlad.json.vysledky.summary, { okrskyDone: 2, okrskyTotal: 3, pct: 66.7, obceWithResults: 1, obceFinal: 0, registered: 1000, voted: 500, turnoutPct: 50 });
  assert.deepEqual(prehlad.json.vysledky.tables, { starosta: 'OSO2026_SK_tab05f', ucast: 'OSO2026_SK_tab02bf' });
  const obec = await call(service, '/obec/501891');
  assert.match(obec.headers['Cache-Control'], /max-age=60/, 's výsledkami kratšia cache');
  assert.equal(obec.json.vysledky.final, false, '2 z 3 okrskov');
  assert.equal(obec.json.vysledky.okrskyDone, 2);
  assert.deepEqual(obec.json.vysledky.ucast, { registered: 1000, voted: 500, pct: 50 });
  assert.deepEqual(obec.json.vysledky.starosta.map((c) => [c.n, c.priezvisko, c.votes, c.pct, c.leads]), [[1, 'Nagyová', 250, 62.5, true], [2, '', 150, 37.5, false]], 'kandidát č. 2 nie je v tomto registri — ostáva s číslom');
  const ba = await call(service, '/obec/582000');
  assert.equal(ba.json.vysledky, null, 'obec bez riadkov výsledkov');
  const body = await call(service, '/obce-body');
  assert.deepEqual(body.json.columns, ['code', 'name', 'lat', 'lon', 'seats', 'state', 'lead', 'leadPct', 'win', 'party']);
  const topolniky = body.json.rows.find((r) => r[0] === '501891');
  assert.deepEqual(topolniky, ['501891', 'Topoľníky', 47.9, 17.78, 9, 1, 'Anna Nagyová', 62.5, null, null]);
  const bratislava = body.json.rows.find((r) => r[0] === '582000');
  assert.deepEqual(bratislava.slice(4), [45, 0, '', null, null, null]);
  assert.equal((await call(service, '/status')).json.vysledky.summary.okrskyDone, 2);
  const kraj = await call(service, '/kraj/1');
  assert.equal(kraj.json.vysledky, null);
});

test('plugin: mount na /api/volby a predhriatie; vite.config.js ho registruje len s API pluginmi', async () => {
  const { fetchImpl } = makeFetch(allBodies);
  const plugin = volbyPlugin({ cacheDir: tmpDir(), fetchImpl, now: () => POLLS_CLOSE_MS - 3600_000, geoPath: GEO, registry, log: quiet });
  const mounts = [];
  plugin.configureServer({ middlewares: { use: (p, fn) => mounts.push([p, fn]) } });
  assert.equal(mounts[0][0], VOLBY_PATH);
  let status = 0; let body = '';
  await new Promise((resolve) => {
    mounts[0][1]({ url: '/prehlad', method: 'GET', headers: {} }, { writeHead: (s) => { status = s; }, end: (b) => { body = b; resolve(); } }, () => resolve());
  });
  assert.equal(status, 200);
  assert.equal(JSON.parse(body).kraje.length, 8);
  const src = fs.readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ safeMiddleware, volbyPlugin, volbyShareService \} from '\.\/src\/data\/volbyService\.js';/);
  // /s/v<kód> a /s/volby2026 idú cez službu volieb s odchytením chyby
  assert.ok(src.includes('(v\\d{6}|volby2026)'), 'zdieľacie adresy volieb');
  assert.ok(src.includes('safeMiddleware(volbyShareService(), req, res, next)'));
  assert.match(src, /\.\.\.\(apiPlugins \? \[[^\]]*volbyPlugin\(\)[^\]]*\] : \[\]\)/);
});

test('živé výsledky ŠÚ SR (JSON stránky) v prehľade, kraji a obci, kým ZIP výsledky nemá', async () => {
  const { fetchImpl } = makeFetch(allBodies);
  const cand = (n, priezvisko, votes, pct, extra = {}) => ({ n, meno: 'X', priezvisko, strany: 'S', known: true, nezavisly: false, votes, pct, rank: 1, elected: false, withdrawn: false, leads: false, ...extra });
  const live = {
    summary: async () => ({ osk: { okrskyTotal: 6029, okrskyDone: 1200, pct: 19.9 }, oso: { okrskyTotal: 2921, okrskyDone: 600, pct: 20.5 } }),
    predseda: async (k) => (k === '1' ? [cand(2, 'Gajarský', 5000, 52, { leads: true }), cand(1, 'Droba', 4600, 48, { rank: 2 })] : null),
    zupniObvod: async () => null,
    starosta: async (c) => (c === '501891' ? [cand(1, 'Nagyová', 300, 75, { elected: true })] : null),
  };
  const service = createVolbyService({ cacheDir: tmpDir(), fetchImpl, now: () => POLLS_CLOSE_MS + 3600_000, geoPath: GEO, registry, log: quiet, live, sweep: false });
  const p = (await call(service, '/prehlad')).json.vysledky;
  assert.equal(p.live, true);
  assert.deepEqual([p.summary.okrskyDone, p.summary.okrskyTotal, p.summary.pct], [1200, 6029, 19.9]);
  assert.equal(p.kraje.find((k) => k.code === '1').lead.priezvisko, 'Gajarský');
  const k = (await call(service, '/kraj/1')).json.vysledky;
  assert.deepEqual(k.predseda.map((c) => c.priezvisko), ['Gajarský', 'Droba']);
  assert.equal(k.okrskyDone, null);
  const o = (await call(service, '/obec/501891')).json.vysledky;
  assert.equal(o.starosta[0].elected, true);
  assert.equal(o.final, true);
  assert.equal((await call(service, '/obec/582000')).json.vysledky, null, 'obec bez súboru ŠÚ SR');
});

test('výsledky všetkých obcí (zber): /obce-body farba víťaza, /zaujimavosti, karta obce a súhrnná karta (HTML + JPEG)', async () => {
  const { fetchImpl } = makeFetch(allBodies);
  const R = { code: '501891', name: 'Topoľníky', okres: 'Dunajská Streda', done: true, cls: 'lost', elected: true, turnoutPct: 67.07, registered: 2639, voted: 1770,
    winner: { n: 2, meno: 'Tünde', priezvisko: 'Várady', strany: 'NEKA', nezavisly: true, votes: 1160, pct: 67.01 }, second: { n: 1, meno: 'László', priezvisko: 'Bacsó', strany: 'MA', votes: 571, pct: 32.98 },
    margin: 589, marginPct: 34.03, party: 'neka', coalition: false, single: false, candidates: 2, incumbent: { n: 1, meno: 'László', priezvisko: 'Bacsó', zamestnanie: 'starosta obce' }, seats: 9, typ: 1 };
  let rounds = 0;
  const sweep = { maybeRound: () => { rounds += 1; }, status: () => ({ cached: 1, lastRoundAt: 1 }), result: (o) => (o.code === '501891' ? R : null), results: (obce) => obce.map((o) => (o.code === '501891' ? R : null)).filter(Boolean) };
  const service = createVolbyService({ cacheDir: tmpDir(), fetchImpl, now: () => POLLS_CLOSE_MS + 3600_000, geoPath: GEO, registry, log: quiet, sweep, live: { summary: async () => ({}), predseda: async () => null, zupniObvod: async () => null, starosta: async () => null } });
  const body = await call(service, '/obce-body');
  assert.deepEqual(body.json.rows.find((r) => r[0] === '501891').slice(5), [2, 'Tünde Várady', 67.01, 'lost', 'neka']);
  assert.ok(rounds >= 1, 'zber sa spustí pri požiadavke');
  const z = (await call(service, '/zaujimavosti')).json;
  assert.equal(z.available, true);
  assert.deepEqual([z.counts.done, z.counts.lost], [1, 1]);
  assert.equal(z.lostBig[0].name, 'Topoľníky');
  const page = await call(service, '/karta/501891');
  assert.match(page.text, /og:image" content="[^"]*\/s\/v501891\.jpg"/);
  assert.match(page.text, /Tünde Várady/);
  // hotový výsledok → návštevník ide na ľahkú stránku výsledkov obce, nie do 3D aplikácie (mobil vo Facebooku)
  assert.match(page.text, /location\.replace\("https:\/\/okolive\.sk\/volby-2026\/[a-z0-9-]+\/topolniky\/"\)/);
  assert.doesNotMatch(page.text, /\/\?volby=501891/);
  const jpg = await call(service, '/karta/501891.jpg');
  assert.equal(jpg.headers['Content-Type'], 'image/jpeg');
  assert.ok(jpg.buffer.length > 5000 && jpg.buffer[0] === 0xff && jpg.buffer[1] === 0xd8, 'JPEG');
  const ov = await call(service, '/karta-volby');
  assert.match(ov.text, /og:image" content="[^"]*\/s\/volby2026\.jpg"/);
  assert.match(ov.text, /location\.replace\("https:\/\/okolive\.sk\/volby-2026\/"\)/, 'súhrnná karta vedie na prehľad výsledkov');
  const ovJpg = await call(service, '/karta-volby.jpg');
  assert.equal(ovJpg.headers['Content-Type'], 'image/jpeg');
  assert.equal((await call(service, '/karta/123456')).status, 404);
});

test('safeMiddleware: výnimka v obsluhe = 500, proces nepadne', async () => {
  const { safeMiddleware } = await import('./volbyService.js');
  let status = 0; let body = '';
  const res = { headersSent: false, writeHead: (s) => { status = s; }, end: (b) => { body = b; } };
  await safeMiddleware({ middleware: async () => { throw new TypeError('x.filter is not a function'); } }, { url: '/karta/1' }, res, () => {});
  assert.equal(status, 500);
  assert.match(body, /internal/);
});
