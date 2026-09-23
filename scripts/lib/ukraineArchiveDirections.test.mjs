// scripts/lib/ukraineArchiveDirections.test.mjs — karta smeru (B5) na strane
// archívu: odseky smerov po dňoch (/directions) a preparsovanie uložených
// hlásení po oprave parsera (záloha originálu, deň sa nepresúva). Bez siete.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import { archiveDir, directionsPayload, reparseReports, reportFingerprint } from './ukraineArchive.mjs';

const tmpRoot = async () => fsp.mkdtemp(path.join(os.tmpdir(), 'oko-ukr-dirs-'));
const writeReport = async (root, day, report) => {
  const dir = path.join(archiveDir(root), 'reports');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, `${day}.json`), JSON.stringify(report));
};
const readReport = async (root, day) => JSON.parse(await fsp.readFile(path.join(archiveDir(root), 'reports', `${day}.json`), 'utf8'));
const html = (paragraphs) => `<div class="single-content">${paragraphs.map((p) => `<p>${p}</p>`).join('')}</div>`;
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, arrayBuffer: async () => { const b = Buffer.from(body); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } });

// Päť smerov (parser vyžaduje ≥ 5), súhrnná veta v tvare, ktorý starý parser nepoznal.
const ARTICLE = [
  'Минулої доби на фронті відбулося 221 бойове зіткнення. Найбільше атак російські війська здійснили на Костянтинівському та Покровському напрямках.',
  'Про це йдеться в оперативній інформації Генерального штабу ЗСУ станом на 08:00 30 серпня.',
  'На Лиманському напрямку українські підрозділи відбили дев\'ять атак.',
  'На Краматорському напрямку штурмових дій противник не проводив.',
  'Найбільше атак за добу — 31 — російські війська здійснили на Костянтинівському напрямку . Ворог штурмував у районах Іллінівки.',
  'Ще 30 атак противник здійснив на Покровському напрямку .',
  'На Олександрівському напрямку противник чотири рази атакував у бік Березового.',
];
const OLD = {
  ok: true, total: null, reportedAt: '2026-08-30T05:00:00.000Z', reportedAtText: '08:00 30.8.', publishedAt: Date.UTC(2026, 7, 30, 5, 30), url: 'https://armyinform.example/2026/08/30/a/', fetchedAt: 111, day: '2026-08-30',
  directions: [
    { gs: 'Костянтинівський', attacks: 221, text: 'x', shared: true },
    { gs: 'Покровський', attacks: 221, text: 'x', shared: true },
    { gs: 'Лиманський', attacks: 9, text: 'y', shared: false },
  ],
};

test('directionsPayload: len odseky smerov po dňoch, chýbajúci deň chýba', async () => {
  const root = await tmpRoot();
  await writeReport(root, '2026-09-20', { total: 240, reportedAt: '2026-09-20T05:00:00.000Z', reportedAtText: '08:00 20.9.', strikes: { airStrikes: 9 }, directions: [
    { gs: 'Лиманський', attacks: 5, text: 'На Лиманському…', shared: false, extra: 1 },
    { gs: '', attacks: 1, text: 'bez mena' },
    { gs: 'Покровський', attacks: 'x', text: 7 },
  ] });
  await writeReport(root, '2026-09-22', { total: null, directions: null });
  const json = await directionsPayload(root, '2026-09-20', '2026-09-22', { now: 5 });
  assert.deepEqual(Object.keys(json.days), ['2026-09-20', '2026-09-22'], '21. chýba — karta z toho spraví dieru');
  assert.deepEqual(json.days['2026-09-20'], {
    total: 240, reportedAt: '2026-09-20T05:00:00.000Z', reportedAtText: '08:00 20.9.',
    directions: [
      { gs: 'Лиманський', attacks: 5, text: 'На Лиманському…', shared: false },
      { gs: 'Покровський', attacks: null, text: '', shared: false },
    ],
  });
  assert.deepEqual(json.days['2026-09-22'], { total: null, reportedAt: null, reportedAtText: null, directions: [] });
  assert.equal(json.generatedAt, 5);
  assert.match(json.attribution, /CC BY 4\.0/);
});

test('reportFingerprint: poradie smerov a texty nerozhodujú, počty áno', () => {
  const a = { total: 1, directions: [{ gs: 'B', attacks: 2 }, { gs: 'A', attacks: 1, text: 't' }] };
  const b = { total: 1, directions: [{ gs: 'A', attacks: 1, text: 'iný' }, { gs: 'B', attacks: 2 }] };
  assert.equal(reportFingerprint(a), reportFingerprint(b));
  assert.notEqual(reportFingerprint(a), reportFingerprint({ ...b, total: 2 }));
});

test('reparseReports: DRY RUN nič nezapíše; ostrý beh zálohuje originál a prepíše len zmenený deň', async () => {
  const root = await tmpRoot();
  await writeReport(root, '2026-08-30', OLD);
  await writeReport(root, '2026-08-31', { ...OLD, url: null, day: '2026-08-31' });
  const fetches = [];
  const fetchImpl = async (url) => { fetches.push(url); return response(html(ARTICLE)); };
  const logs = [];
  const backupDir = path.join(root, 'backup');
  const dry = await reparseReports(root, { from: '2026-08-29', to: '2026-08-31', backupDir, fetchImpl, pauseMs: 0, now: 999, dryRun: true, log: (m) => logs.push(m) });
  assert.deepEqual(dry.updated, ['2026-08-30']);
  assert.deepEqual(dry.skipped, [{ day: '2026-08-31', reason: 'no-url' }]);
  assert.equal((await readReport(root, '2026-08-30')).total, null, 'dry run nezapisuje');
  await assert.rejects(fsp.access(backupDir));
  assert.match(logs[0], /súčet \? → 221/);

  const live = await reparseReports(root, { from: '2026-08-30', to: '2026-08-30', backupDir, fetchImpl, pauseMs: 0, now: 999 });
  assert.deepEqual(live.updated, ['2026-08-30']);
  const fixed = await readReport(root, '2026-08-30');
  assert.equal(fixed.total, 221);
  assert.deepEqual(Object.fromEntries(fixed.directions.map((d) => [d.gs, d.attacks])), { 'Костянтинівський': 31, 'Покровський': 30, 'Лиманський': 9, 'Краматорський': 0, 'Олександрівський': 4 });
  assert.equal(fixed.day, '2026-08-30');
  assert.equal(fixed.fetchedAt, 111, 'čas stiahnutia sa nemení — archivár naďalej porovnáva s ním');
  assert.equal(fixed.reparsedAt, 999);
  assert.equal(fixed.url, OLD.url);
  const backup = JSON.parse(await fsp.readFile(path.join(backupDir, '2026-08-30.json'), 'utf8'));
  assert.equal(backup.directions[0].attacks, 221, 'záloha nesie pôvodný stav');

  const again = await reparseReports(root, { from: '2026-08-30', to: '2026-08-30', backupDir, fetchImpl, pauseMs: 0, now: 1000 });
  assert.equal(again.same, 1);
  assert.deepEqual(again.updated, []);
  assert.equal(JSON.parse(await fsp.readFile(path.join(backupDir, '2026-08-30.json'), 'utf8')).directions[0].attacks, 221, 'druhý beh zálohu neprepíše');
});

test('reparseReports: iný deň po parse, HTTP chyba a neparsovateľný článok sa preskočia bez zápisu', async () => {
  const root = await tmpRoot();
  // Starý omyl: článok z 30. 8. uložený pod 1. 8. (ako „11 серпня" v septembri).
  await writeReport(root, '2026-08-01', { ...OLD, day: '2026-08-01', reportedAt: '2026-08-01T05:00:00.000Z', url: 'https://a/1' });
  await writeReport(root, '2026-08-02', { ...OLD, day: '2026-08-02', url: 'https://a/2' });
  await writeReport(root, '2026-08-03', { ...OLD, day: '2026-08-03', url: 'https://a/3' });
  const fetchImpl = async (url) => {
    if (url.endsWith('/1')) return response(html(ARTICLE)); // článok hovorí 30. 8., archív ho má pod 1. 8.
    if (url.endsWith('/2')) return response('nie', 503);
    return response('<p>bez hlásenia, len krátky text o ničom dôležitom</p>');
  };
  await assert.rejects(reparseReports(root, { from: '2026-08-01', to: '2026-08-03', fetchImpl }), /backupDir/);
  const r = await reparseReports(root, { from: '2026-08-01', to: '2026-08-03', backupDir: path.join(root, 'b'), fetchImpl, pauseMs: 0 });
  assert.deepEqual(r.skipped.map((s) => [s.day, s.reason.split(' ')[0]]), [['2026-08-01', 'day-mismatch'], ['2026-08-02', 'HTTP'], ['2026-08-03', 'unparsed']]);
  assert.equal((await readReport(root, '2026-08-01')).total, null, 'cudzí deň sa neprepíše');
});
