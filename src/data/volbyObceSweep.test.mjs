// src/data/volbyObceSweep.test.mjs — výsledky všetkých obcí zo stránky ŠÚ SR (graph01 + tab05, tvar overený
// 25. 10. 2026 ráno na Topoľníkoch), trieda obce pre mapu, zaujímavosti a šetrný zber s cache.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVolbyObceSweep, isIncumbentJob, obecResult, parseObecSummary, volbyRecords } from './volbyObceSweep.js';
import { liveCandidates } from './volbyLive.js';

// skutočné riadky ŠÚ SR (Topoľníky, 25. 10. 2026 6:20)
const GRAPH = [{ C01: 'Topoľníky', C03: '100,00', C04: '2 639', C05: '1 770', C06: '67,07', C07: '1 769', C08: '99,94', C09: '1 731', C10: '1 722', C11: 'Tünde Várady', C12: 'NEKA', C13: '1 160', C14: '67,01', C15: '9', C16: '9', C17: 1 }];
const TAB05 = [
  { C01: '2', C02: 'Tünde', C03: 'Várady', C04: 'NEKA', C05: '1 160', C06: '67,01', C07: 'zvolený' },
  { C01: '1', C02: 'László', C03: 'Bacsó', C04: 'Magyar Szövetség - Maďarská aliancia', C05: '571', C06: '32,98', C07: '' },
];
const OBEC = { code: '501921', name: 'Topoľníky', okres: 'Dunajská Streda', starosta: [
  { n: 1, meno: 'László', priezvisko: 'Bacsó', zamestnanie: 'starosta obce' },
  { n: 2, meno: 'Tünde', priezvisko: 'Várady', zamestnanie: 'samostatná odborná referentka obecného úradu' },
] };

test('isIncumbentJob: starosta/starostka/primátor podľa zamestnania, nie „zástupca starostu"', () => {
  for (const job of ['starosta obce', 'Starostka obce', 'primátor mesta', 'primátorka', 'starosta mestskej časti', 'starosta']) assert.equal(isIncumbentJob(job), true, job);
  for (const job of ['zástupca starostu', 'samostatná odborná referentka obecného úradu', 'podnikateľ', '', 'prednosta obecného úradu']) assert.equal(isIncumbentJob(job), false, job);
});

test('parseObecSummary + obecResult: Topoľníky — starosta podľa registra prehral (lost), účasť, rozdiel hlasov', () => {
  const s = parseObecSummary(GRAPH);
  assert.deepEqual([s.pct, s.registered, s.voted, s.turnoutPct, s.winner, s.seats, s.typ], [100, 2639, 1770, 67.07, 'Tünde Várady', 9, 1]);
  const r = obecResult(OBEC, s, liveCandidates(TAB05));
  assert.equal(r.cls, 'lost');
  assert.equal(r.done, true);
  assert.equal(r.winner.priezvisko, 'Várady');
  assert.equal(r.second.priezvisko, 'Bacsó');
  assert.equal(r.margin, 589);
  assert.equal(r.incumbent.priezvisko, 'Bacsó');
  // starosta vyhral → held; nikto z kandidátov nie je starosta → open; bez zvoleného → none; nespracované → pending
  const held = obecResult({ ...OBEC, starosta: [{ ...OBEC.starosta[0], zamestnanie: 'podnikateľ' }, { ...OBEC.starosta[1], zamestnanie: 'starostka obce' }] }, s, liveCandidates(TAB05));
  assert.equal(held.cls, 'held');
  assert.equal(obecResult({ ...OBEC, starosta: OBEC.starosta.map((c) => ({ ...c, zamestnanie: 'učiteľ' })) }, s, liveCandidates(TAB05)).cls, 'open');
  assert.equal(obecResult(OBEC, { ...s, winner: null }, liveCandidates(TAB05.map((r0) => ({ ...r0, C07: '' })))).cls, 'none');
  assert.equal(obecResult(OBEC, { ...s, pct: 40 }, liveCandidates(TAB05)).cls, 'pending');
  assert.equal(obecResult(OBEC, s, liveCandidates([TAB05[0]])).single, true);
});

test('volbyRecords: počty, najtesnejšie víťazstvo, účasť (malé obce pod 100 voličov mimo), najväčšie mesto s porazeným starostom', () => {
  const mk = (code, name, cls, margin, turnoutPct, registered, extra = {}) => ({ code, name, okres: 'X', done: true, cls, elected: cls !== 'none', margin, candidates: 2, turnoutPct, registered,
    winner: { meno: 'A', priezvisko: name, nezavisly: code === '1' }, second: { meno: 'B', priezvisko: 'B' }, incumbent: { meno: 'S', priezvisko: 'Starý' }, single: false, typ: 1, ...extra });
  const list = [mk('1', 'Alfa', 'held', 3, 80, 500), mk('2', 'Beta', 'lost', 40, 30, 20_000), mk('3', 'Gama', 'open', 1, 95, 60), mk('4', 'Delta', 'none', null, 50, 300),
    { code: '5', name: 'Epsilon', done: false, cls: 'pending' }, mk('6', 'Zeta', 'held', 200, 20, 1000, { single: true, candidates: 1, margin: null })];
  const rec = volbyRecords(list);
  assert.deepEqual([rec.counts.done, rec.counts.held, rec.counts.lost, rec.counts.open, rec.counts.none, rec.counts.single, rec.counts.independent], [5, 2, 1, 1, 1, 1, 1]);
  assert.deepEqual(rec.closest.map((r) => [r.name, r.margin]), [['Gama', 1], ['Alfa', 3], ['Beta', 40]]);
  assert.equal(rec.highest[0].name, 'Alfa', 'Gama má len 60 voličov');
  assert.equal(rec.lowest[0].name, 'Zeta');
  assert.equal(rec.lostBig[0].name, 'Beta');
  assert.equal(rec.noMayor[0].name, 'Delta');
});

test('createVolbyObceSweep: najviac N naraz, cache na disk, hotové obce sa už nesťahujú, sieťová chyba ≠ prázdny výsledok', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'volby-sweep-'));
  const cacheFile = path.join(dir, 'sweep.json');
  const calls = []; let inFlight = 0; let peak = 0; let failOnce = true;
  const fetchImpl = async (url) => {
    calls.push(url); inFlight += 1; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    if (url.includes('/graph01/999999') && failOnce) { failOnce = false; throw new Error('ECONNRESET'); }
    if (url.includes('/graph01/')) return { ok: true, status: 200, text: async () => JSON.stringify(GRAPH) };
    if (url.includes('/tab05/')) return { ok: true, status: 200, text: async () => JSON.stringify(TAB05) };
    return { ok: false, status: 404, text: async () => '<html>' };
  };
  const obce = [OBEC, ...Array.from({ length: 9 }, (_, i) => ({ code: String(500000 + i), name: `O${i}`, starosta: [] })), { code: '999999', name: 'Chyba', starosta: [] }];
  const sweep = createVolbyObceSweep({ fetchImpl, cacheFile, concurrency: 3, log: { info() {}, warn() {} } });
  await sweep.round(obce);
  assert.ok(peak <= 3, `naraz ${peak}`);
  assert.equal(sweep.result(OBEC).cls, 'lost');
  assert.equal(sweep.result(obce[10]), null, 'chyba siete → bez záznamu, skúsi sa znova');
  const before = calls.length;
  await sweep.round(obce);
  assert.equal(calls.length - before, 2, 'len obec s chybou (graph01 + tab05)');
  // nová inštancia číta z disku a nič nesťahuje
  const again = createVolbyObceSweep({ fetchImpl: async () => { throw new Error('nemá sa volať'); }, cacheFile, log: { info() {}, warn() {} } });
  assert.equal(again.results(obce).length, 11);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('obecResult prijme aj detail obce (starosta = počet, kandidáti v kandidati.starosta) — pád QA servera 25. 10.', () => {
  const detail = { code: OBEC.code, name: OBEC.name, starosta: 2, kandidati: { starosta: OBEC.starosta, poslanci: [] } };
  assert.equal(obecResult(detail, parseObecSummary(GRAPH), liveCandidates(TAB05)).cls, 'lost');
  assert.equal(obecResult({ code: '1', name: 'X', starosta: 3 }, parseObecSummary(GRAPH), liveCandidates(TAB05)).cls, 'open', 'bez zoznamu kandidátov nič nepadne');
});

test('incumbentScore: v meste primátor pred starostami mestských častí (Košice 2026), v mestskej časti jej starosta', async () => {
  const { incumbentScore } = await import('./volbyObceSweep.js');
  assert.ok(incumbentScore('primátor mesta') > incumbentScore('starosta mestskej časti'));
  assert.ok(incumbentScore('starosta obce') > incumbentScore('starostka mestskej časti'));
  assert.ok(incumbentScore('starosta mestskej časti', { district: true }) > incumbentScore('primátor mesta', { district: true }));
  assert.equal(incumbentScore('vodič'), 0);
  const kosice = { code: '599981', name: 'Košice', starosta: [
    { n: 1, meno: 'Lenka', priezvisko: 'Kovačevičová', zamestnanie: 'starostka mestskej časti' },
    { n: 2, meno: 'Ladislav', priezvisko: 'Lörinc', zamestnanie: 'starosta mestskej časti' },
    { n: 5, meno: 'Jaroslav', priezvisko: 'Polaček', zamestnanie: 'primátor mesta' },
  ] };
  const tab = [
    { C01: '2', C02: 'Ladislav', C03: 'Lörinc', C04: 'Košická strana', C05: '27 364', C06: '39,89', C07: 'zvolený' },
    { C01: '5', C02: 'Jaroslav', C03: 'Polaček', C04: 'KDH', C05: '14 766', C06: '21,52', C07: '' },
  ];
  const r = obecResult(kosice, { pct: 100, typ: 1 }, liveCandidates(tab));
  assert.equal(r.cls, 'lost');
  assert.equal(r.incumbent.priezvisko, 'Polaček');
});

test('partyKey: strana víťaza podľa prvej strany na kandidátke; „STAROSTOVIA A NEZÁVISLÍ" nie je nezávislý kandidát', async () => {
  const { partyKey } = await import('./volbyObceSweep.js');
  assert.equal(partyKey('NEKA'), 'neka');
  assert.equal(partyKey('SMER - SD'), 'smer');
  assert.equal(partyKey('SMER - SD, HLAS - sociálna demokracia, SNS'), 'smer');
  assert.equal(partyKey('HLAS - sociálna demokracia, SMER - SD'), 'hlas');
  assert.equal(partyKey('Magyar Szövetség - Maďarská aliancia'), 'ma');
  assert.equal(partyKey('KDH'), 'kdh');
  assert.equal(partyKey('Progresívne Slovensko, SaS'), 'ps');
  assert.equal(partyKey('SaS'), 'sas');
  assert.equal(partyKey('REPUBLIKA'), 'rep');
  assert.equal(partyKey('SNS'), 'sns');
  assert.equal(partyKey('STAROSTOVIA A NEZÁVISLÍ KANDIDÁTI'), 'other');
  assert.equal(partyKey(''), null);
  const r = obecResult(OBEC, parseObecSummary(GRAPH), liveCandidates(TAB05));
  assert.deepEqual([r.party, r.coalition], ['neka', false]);
  const rec = volbyRecords([r, { ...r, code: 'x', party: 'smer', coalition: true }]);
  assert.deepEqual(rec.counts.parties, { neka: 1, smer: 1 });
  assert.equal(rec.counts.coalitions, 1);
});
