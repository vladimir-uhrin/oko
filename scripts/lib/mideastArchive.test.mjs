// scripts/lib/mideastArchive.test.mjs — archív KONTROLY SÍDIEL modulu BLÍZKY VÝCHOD
// (etapa 2, 2026-09-26): snímka modulu Wikipédie so vstreknutým fetch (mock MediaWiki
// JSON podľa `titles`/`rvstart` v URL), rozloženie na disku po moduloch, tvar snímky
// (licencia, revízie, neznáme ikony), čerstvosť (6 h / konečný minulý deň / force),
// chybové cesty (HTTP, strop veľkosti, bez revízie, neznámy modul), história po
// týždňoch s injektovanou pauzou a jedným dopytom naraz. Bez siete, dočasný koreň.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import {
  CONTROL_FRESH_MS, MIDEAST_CONTROL_FIRST_DAY, MIDEAST_CONTROL_MODULE_IDS, USER_AGENT, WIKI_REVISION_MAX_BYTES,
  archiveDir, controlBackfill, controlDays, controlDir, controlFile, controlFor, controlIndex, isMideastModuleId, nowToMs,
  wikiControlSnapshot, wikiPageUrl, wikiRevision, wikiRevisionPermalink,
} from './mideastArchive.mjs';
import { wikiControlModuleById } from '../../src/data/wikiControl.js';

const NOW = Date.UTC(2026, 8, 26, 12); // 26. 9. 2026 12:00 UTC
const HOUR = 3_600_000;
const DAY = 86_400_000;
const tmpRoot = async () => fsp.mkdtemp(path.join(os.tmpdir(), 'oko-mideast-archive-'));
const response = (body, { status = 200, headers = {} } = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => JSON.parse(String(body)),
  arrayBuffer: async () => { const b = Buffer.isBuffer(body) ? body : Buffer.from(String(body)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
});
/** Odpoveď so streamom tela (skutočný fetch): `chunks` = pole Uint8Array, alebo `pull` = generátor bez konca. */
const streamResponse = ({ chunks = null, pull = null, status = 200, headers = {} } = {}) => {
  const stats = { pulled: 0, cancelled: false };
  let i = 0;
  const body = new ReadableStream({
    pull(controller) {
      stats.pulled += 1;
      if (pull) { controller.enqueue(pull(stats.pulled)); return; }
      if (i < chunks.length) controller.enqueue(chunks[i++]); else controller.close();
    },
    cancel() { stats.cancelled = true; },
  });
  return { res: { ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, body }, stats };
};
const wikiJson = (revid, content, timestamp = '2026-09-25T10:00:00Z') => JSON.stringify({ query: { pages: [{ title: 'x', revisions: [{ revid, timestamp, size: content.length, slots: { main: { content } } }] }] } });
const NO_REVISION = JSON.stringify({ query: { pages: [{ title: 'x', revisions: [] }] } });

/** Libanon: sivá 68a = LAF, červená = Hizballáh; „Weird icon.svg" nie je v legende → počíta sa ako neznáma. */
const LUA_LEBANON = 'return {\n\tmarks = {\n\t\t{ lat = "33.886", long = "35.505", mark = "Map-dot-grey-68a.svg", marksize = "32", label = "[[Beirut]]" },\n\t\t{ lat = "33.8498887", long = "35.5099583", mark = "Location dot red.svg", marksize = "26", label = "[[Dahieh]]" },\n\t\t{ lat = "33.9", long = "35.6", mark = "Weird icon.svg", marksize = "8", label = "[[Nikde]]" },\n\t}\n}';
const LUA_LEBANON_OLD = 'return { marks = {\n{ lat = "33.886", long = "35.505", mark = "Map-dot-grey-68a.svg", marksize = "32", label = "[[Beirut]]" },\n} }';
/** Izrael–Palestína: modrá Izrael, limetková Hamas, zelená PS. */
const LUA_IP = 'return { marks = {\n{ lat = "31.67", long = "34.57", mark = "Location dot blue.svg", marksize = "20", label = "[[Ashkelon]]" },\n{ lat = "31.5", long = "34.47", mark = "Location dot lime.svg", marksize = "23", label = "[[Gaza City]]" },\n{ lat = "31.9", long = "35.2", mark = "Location dot green.svg", marksize = "14", label = "[[Ramallah]]" },\n} }';
const LEBANON_TITLE = 'Module:Lebanese insurgency detailed map';
const IP_TITLE = 'Module:Israeli-Palestinian conflict detailed map';

/** Mock MediaWiki: rozhoduje podľa `titles` a `rvstart`; zapisuje volania aj hlavičky. */
function mockWiki() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push({ url, title: u.searchParams.get('titles'), start: u.searchParams.get('rvstart'), headers: init?.headers || {} });
    const title = u.searchParams.get('titles') || '';
    const start = u.searchParams.get('rvstart');
    if (title === LEBANON_TITLE) {
      if (start && start < '2026-01-01') return response(NO_REVISION);
      return start && start < '2026-09-10' ? response(wikiJson(101, LUA_LEBANON_OLD, '2026-08-30T08:00:00Z')) : response(wikiJson(202, LUA_LEBANON));
    }
    if (title === IP_TITLE) return response(wikiJson(303, LUA_IP, '2026-09-24T18:30:00Z'));
    return response(NO_REVISION);
  };
  return { calls, fetchImpl };
}

test('rozloženie a pomocníci: koreň mideast/events, adresár na modul, id modulov, URL Wikipédie', () => {
  assert.equal(archiveDir('R'), path.join('R', '.gev-cache', 'mideast', 'events'));
  assert.equal(controlDir('R', 'lebanon'), path.join('R', '.gev-cache', 'mideast', 'events', 'control', 'lebanon'));
  assert.equal(controlFile('R', 'yemen', '2026-09-26'), path.join(controlDir('R', 'yemen'), '2026-09-26.json'));
  assert.deepEqual([...MIDEAST_CONTROL_MODULE_IDS], ['israel-palestine', 'yemen', 'syria', 'lebanon']);
  for (const id of MIDEAST_CONTROL_MODULE_IDS) { assert.equal(isMideastModuleId(id), true, id); assert.doesNotMatch(id, /[:/\\]/, 'id slúži ako názov adresára (Windows: bez dvojbodky)'); }
  assert.equal(isMideastModuleId('ukraine'), false, 'Ukrajina má vlastný archív');
  assert.equal(isMideastModuleId(''), false);
  assert.equal(wikiPageUrl(IP_TITLE), 'https://en.wikipedia.org/wiki/Module:Israeli-Palestinian_conflict_detailed_map');
  assert.equal(wikiRevisionPermalink(LEBANON_TITLE, 202), 'https://en.wikipedia.org/w/index.php?title=Module%3ALebanese+insurgency+detailed+map&oldid=202');
  assert.match(USER_AGENT, /^OKO-mideast\/0\.1 \(.*vladouh76@gmail\.com\)$/, 'popisný UA s kontaktom (etiketa Wikimedia)');
  assert.equal(WIKI_REVISION_MAX_BYTES, 6 * 1024 * 1024);
});

test('snímka dnes: súbor control/<modul>/<deň>.json, tvar (licencia, revízie s permalinkom, súhrn s neznámymi ikonami), UA a titul v dopyte', async () => {
  const root = await tmpRoot();
  const { calls, fetchImpl } = mockWiki();
  const r = await wikiControlSnapshot(root, 'lebanon', { fetchImpl, now: NOW });
  assert.equal(r.status, 'updated');
  assert.equal(r.day, '2026-09-26');
  assert.equal(r.module, 'lebanon');
  assert.equal(r.count, 2, 'Bejrút + Dahieh; neznáma ikona sa nezaraďuje');
  assert.equal(r.revisionAt, '2026-09-25T10:00:00Z');
  assert.deepEqual(r.unmapped, { 'Weird icon.svg': 1 });
  assert.equal(calls.length, 1, 'jeden titul = jeden dopyt');
  assert.equal(calls[0].title, LEBANON_TITLE);
  assert.equal(calls[0].start, null, 'najnovšia revízia bez rvstart');
  assert.equal(calls[0].headers['User-Agent'], USER_AGENT);
  assert.equal(calls[0].headers.Accept, 'application/json');
  const file = controlFile(root, 'lebanon', '2026-09-26');
  const snap = JSON.parse(await fsp.readFile(file, 'utf8'));
  assert.equal(snap.day, '2026-09-26');
  assert.equal(snap.kind, 'control');
  assert.equal(snap.module, 'lebanon');
  assert.equal(snap.fetchedAt, NOW);
  assert.equal(snap.at, null);
  assert.equal(snap.revisionAt, '2026-09-25T10:00:00Z');
  assert.deepEqual(snap.revisions, { main: { title: LEBANON_TITLE, revid: 202, timestamp: '2026-09-25T10:00:00Z', size: LUA_LEBANON.length, url: wikiRevisionPermalink(LEBANON_TITLE, 202) } });
  assert.equal(snap.license, 'CC BY-SA 4.0');
  assert.equal(snap.attribution, `Wikipedia contributors · ${LEBANON_TITLE} · CC BY-SA 4.0`);
  assert.equal(snap.source, 'https://en.wikipedia.org/wiki/Module:Lebanese_insurgency_detailed_map');
  assert.equal(snap.count, 2);
  assert.equal(snap.points.length, 2);
  assert.deepEqual(snap.points.map((p) => [p.name, p.side, p.module]), [['Beirut', 'laf', 'main'], ['Dahieh', 'hezbollah', 'main']]);
  assert.equal(snap.summary.total, 2);
  assert.equal(snap.summary.settlements.laf, 1);
  assert.equal(snap.summary.settlements.hezbollah, 1);
  assert.deepEqual(snap.summary.unmapped, { 'Weird icon.svg': 1 }, 'neznáme ikony sa POČÍTAJÚ v súhrne');
  assert.equal(snap.skipped, 0);
  assert.equal(snap.sideless, 0);
  assert.equal(snap.invalid, 0);
  assert.deepEqual(Object.keys(snap.summary.settlements).slice(0, 5), wikiControlModuleById('lebanon').sides.map((s) => s.id), 'strany v poradí konfigurácie');
  assert.deepEqual(await controlDays(root, 'lebanon'), ['2026-09-26']);
  assert.deepEqual(await controlDays(root, 'israel-palestine'), [], 'iný modul má vlastný adresár');
  assert.deepEqual(await controlIndex(root), {
    'israel-palestine': { snapshots: 0, first: null, last: null }, yemen: { snapshots: 0, first: null, last: null },
    syria: { snapshots: 0, first: null, last: null }, lebanon: { snapshots: 1, first: '2026-09-26', last: '2026-09-26' },
  });
});

test('čerstvosť: do 6 h fresh (bez dopytu), po 6 h updated, force obchádza, minulý deň je po 2 dňoch konečný', async () => {
  const root = await tmpRoot();
  const { calls, fetchImpl } = mockWiki();
  assert.equal((await wikiControlSnapshot(root, 'lebanon', { fetchImpl, now: NOW })).status, 'updated');
  const fresh = await wikiControlSnapshot(root, 'lebanon', { fetchImpl, now: NOW + 60_000 });
  assert.equal(fresh.status, 'fresh');
  assert.equal(fresh.count, 2, 'fresh nesie počet z disku');
  assert.equal(fresh.revisionAt, '2026-09-25T10:00:00Z');
  assert.deepEqual(fresh.unmapped, { 'Weird icon.svg': 1 }, 'fresh nesie aj neznáme ikony z disku');
  assert.equal(calls.length, 1, 'fresh = žiadny dopyt');
  assert.equal((await wikiControlSnapshot(root, 'lebanon', { fetchImpl, now: NOW + CONTROL_FRESH_MS - 1 })).status, 'fresh');
  assert.equal((await wikiControlSnapshot(root, 'lebanon', { fetchImpl, now: NOW + 7 * HOUR })).status, 'updated', 'po 6 h sa dnešok stiahne znova');
  assert.equal(calls.length, 2);
  assert.equal((await wikiControlSnapshot(root, 'lebanon', { fetchImpl, now: NOW + 7 * HOUR + 1, force: true })).status, 'updated', 'force obchádza čerstvosť');
  assert.equal(calls.length, 3);
  // minulý deň: rvstart = koniec dňa UTC, po 2 dňoch konečný aj po týždňoch
  const past = await wikiControlSnapshot(root, 'lebanon', { at: '2026-09-01', fetchImpl, now: NOW });
  assert.equal(past.status, 'updated');
  assert.equal(past.day, '2026-09-01');
  assert.equal(past.count, 1, 'stará revízia má len Bejrút');
  assert.equal(past.revisionAt, '2026-08-30T08:00:00Z');
  assert.match(calls.at(-1).url, /rvdir=older&rvstart=2026-09-01T23%3A59%3A59Z/);
  const snap = JSON.parse(await fsp.readFile(controlFile(root, 'lebanon', '2026-09-01'), 'utf8'));
  assert.equal(snap.at, '2026-09-01');
  assert.equal(snap.revisions.main.revid, 101);
  const n = calls.length;
  assert.equal((await wikiControlSnapshot(root, 'lebanon', { at: '2026-09-01', fetchImpl, now: NOW + 40 * DAY })).status, 'fresh', 'konečný minulý deň sa nesťahuje znova');
  assert.equal(calls.length, n);
  // včerajšok (< 2 dni) sa ešte obnovuje po 6 h
  assert.equal((await wikiControlSnapshot(root, 'lebanon', { at: '2026-09-25', fetchImpl, now: NOW })).status, 'updated');
  assert.equal((await wikiControlSnapshot(root, 'lebanon', { at: '2026-09-25', fetchImpl, now: NOW + HOUR })).status, 'fresh');
  assert.equal((await wikiControlSnapshot(root, 'lebanon', { at: '2026-09-25', fetchImpl, now: NOW + 7 * HOUR })).status, 'updated');
  assert.deepEqual(await controlDays(root, 'lebanon'), ['2026-09-01', '2026-09-25', '2026-09-26']);
  // snímka platná pre deň = posledná so dňom ≤ deň
  assert.equal(await controlFor(root, 'lebanon', '2026-08-31'), null);
  assert.equal((await controlFor(root, 'lebanon', '2026-09-01')).count, 1);
  assert.equal((await controlFor(root, 'lebanon', '2026-09-20')).count, 1, 'pre 20. 9. platí snímka z 1. 9.');
  assert.equal((await controlFor(root, 'lebanon', '2026-09-26')).count, 2);
  assert.equal((await controlFor(root, 'lebanon', '2026-12-31')).count, 2);
  assert.equal(await controlFor(root, 'israel-palestine', '2026-09-26'), null, 'moduly sa nemiešajú');
});

test('dva moduly vedľa seba: vlastné adresáre, vlastné revízie a legendy', async () => {
  const root = await tmpRoot();
  const { fetchImpl } = mockWiki();
  const ip = await wikiControlSnapshot(root, 'israel-palestine', { fetchImpl, now: NOW });
  const lb = await wikiControlSnapshot(root, 'lebanon', { fetchImpl, now: NOW });
  assert.equal(ip.status, 'updated');
  assert.equal(ip.count, 3);
  assert.equal(ip.revisionAt, '2026-09-24T18:30:00Z');
  assert.deepEqual(ip.unmapped, {});
  assert.equal(lb.count, 2);
  const ipSnap = await controlFor(root, 'israel-palestine', '2026-09-26');
  assert.deepEqual(ipSnap.points.map((p) => [p.name, p.side]), [['Ashkelon', 'israel'], ['Gaza City', 'hamas'], ['Ramallah', 'pa']]);
  assert.equal(ipSnap.revisions.main.revid, 303);
  assert.equal(ipSnap.source, 'https://en.wikipedia.org/wiki/Module:Israeli-Palestinian_conflict_detailed_map');
  assert.equal((await controlIndex(root))['israel-palestine'].snapshots, 1);
  assert.equal((await controlIndex(root)).lebanon.snapshots, 1);
  const entries = await fsp.readdir(path.join(archiveDir(root), 'control'));
  assert.deepEqual(entries.sort(), ['israel-palestine', 'lebanon']);
});

test('chybové cesty: neznámy modul, zlý deň, HTTP 503 (error / stale), bez revízie, strop 6 MB je čistá chyba a nič sa nezapíše', async () => {
  const root = await tmpRoot();
  const bad = await wikiControlSnapshot(root, 'ukraine', { fetchImpl: async () => { throw new Error('nemá sa volať'); }, now: NOW });
  assert.equal(bad.status, 'error');
  assert.match(bad.error, /unknown module 'ukraine'/);
  assert.match(bad.error, /israel-palestine, yemen, syria, lebanon/);
  const badDay = await wikiControlSnapshot(root, 'lebanon', { at: '2026-13-01', fetchImpl: async () => { throw new Error('nemá sa volať'); }, now: NOW });
  assert.equal(badDay.status, 'error');
  assert.match(badDay.error, /bad day/);
  const http = await wikiControlSnapshot(root, 'lebanon', { fetchImpl: async () => response('', { status: 503 }), now: NOW });
  assert.equal(http.status, 'error', 'bez predchádzajúcej snímky = error');
  assert.equal(http.count, 0);
  assert.match(http.error, /wiki HTTP 503/);
  assert.deepEqual(await controlDays(root, 'lebanon'), [], 'zlyhanie nič nezapíše');
  const none = await wikiControlSnapshot(root, 'lebanon', { fetchImpl: async () => response(NO_REVISION), now: NOW });
  assert.equal(none.status, 'error');
  assert.match(none.error, /no revision of Module:Lebanese insurgency detailed map/);
  const junk = await wikiControlSnapshot(root, 'lebanon', { fetchImpl: async () => response('<html>nie JSON</html>'), now: NOW });
  assert.match(junk.error, /invalid JSON/);
  const empty = await wikiControlSnapshot(root, 'lebanon', { fetchImpl: async () => response(wikiJson(1, 'return { marks = { } }')), now: NOW });
  assert.match(empty.error, /no control points parsed/);
  // strop veľkosti: skutočné telo nad 6 MB aj deklarovaný Content-Length
  const big = Buffer.alloc(WIKI_REVISION_MAX_BYTES + 1, 0x61);
  const capped = await wikiControlSnapshot(root, 'lebanon', { fetchImpl: async () => response(big), now: NOW });
  assert.equal(capped.status, 'error');
  assert.match(capped.error, /^too large \(6291457 B > 6291456 B\) en\.wikipedia\.org$/, 'jedna veta, bez dumpu tela');
  const declared = await wikiControlSnapshot(root, 'lebanon', { fetchImpl: async () => response('{}', { headers: { 'content-length': String(50 * 1024 * 1024) } }), now: NOW });
  assert.match(declared.error, /too large \(Content-Length 52428800 B/);
  assert.deepEqual(await controlDays(root, 'lebanon'), []);
  // s predchádzajúcou snímkou je zlyhanie 'stale' a stará snímka ostáva
  const { fetchImpl } = mockWiki();
  assert.equal((await wikiControlSnapshot(root, 'lebanon', { fetchImpl, now: NOW })).status, 'updated');
  const stale = await wikiControlSnapshot(root, 'lebanon', { fetchImpl: async () => response('', { status: 500 }), now: NOW, force: true });
  assert.equal(stale.status, 'stale');
  assert.equal(stale.count, 2, 'počet zo starej snímky');
  assert.equal(stale.revisionAt, '2026-09-25T10:00:00Z');
  assert.match(stale.error, /wiki HTTP 500/);
  assert.equal((await controlFor(root, 'lebanon', '2026-09-26')).revisions.main.revid, 202, 'stará snímka ostala na disku');
  // wikiRevision priamo: null, keď modul k času nemal revíziu
  assert.equal(await wikiRevision(async () => response(NO_REVISION), LEBANON_TITLE, '2020-01-01T23:59:59Z'), null);
  await assert.rejects(() => wikiRevision(async () => response('', { status: 429 }), LEBANON_TITLE), /wiki HTTP 429/);
});

test('strop tela po kúskoch: chunked odpoveď bez Content-Length sa preruší hneď nad 6 MB (abort + cancel), stream v medziach sa prečíta celý', async () => {
  const root = await tmpRoot();
  // nekonečný stream 1 MiB kúskov: čítanie musí skončiť po ~7 kúskoch, nie po 200 MB
  let seenSignal = null;
  const endless = streamResponse({ pull: () => new Uint8Array(1024 * 1024) });
  const capped = await wikiControlSnapshot(root, 'lebanon', { fetchImpl: async (url, init) => { seenSignal = init?.signal || null; return endless.res; }, now: NOW });
  assert.equal(capped.status, 'error');
  assert.match(capped.error, /^too large \(\d+ B > 6291456 B\) en\.wikipedia\.org$/, 'jedna veta, priebežný súčet, bez dumpu');
  const total = Number(/\((\d+) B/.exec(capped.error)[1]);
  assert.ok(total > WIKI_REVISION_MAX_BYTES && total <= WIKI_REVISION_MAX_BYTES + 1024 * 1024, `súčet ${total} = strop + najviac jeden kúsok`);
  assert.ok(endless.stats.pulled >= 7 && endless.stats.pulled <= 9, `stream sa čítal ${endless.stats.pulled}× — po prekročení stropu sa nečíta ďalej`);
  assert.equal(endless.stats.cancelled, true, 'čítač zrušený');
  assert.ok(seenSignal && seenSignal.aborted, 'signál fetchu je po prekročení zrušený (spojenie sa nedosťahuje)');
  assert.deepEqual(await controlDays(root, 'lebanon'), [], 'nič sa nezapíše');
  // stream v medziach: telo rozdelené na dva kúsky (aj uprostred viacbajtového znaku) sa zloží a rozparsuje
  const bytes = Buffer.from(wikiJson(505, LUA_LEBANON.replace('Beirut', 'Bejrút – ľ')), 'utf8');
  const cut = bytes.indexOf(Buffer.from('ľ', 'utf8')) + 1; // rez vnútri dvojbajtového „ľ"
  const ok = streamResponse({ chunks: [new Uint8Array(bytes.subarray(0, cut)), new Uint8Array(bytes.subarray(cut))] });
  const fine = await wikiControlSnapshot(root, 'lebanon', { fetchImpl: async () => ok.res, now: NOW });
  assert.equal(fine.status, 'updated', fine.error);
  assert.equal(fine.count, 2);
  assert.equal((await controlFor(root, 'lebanon', '2026-09-26')).points[0].name, 'Bejrút – ľ', 'kúsky sa spájajú pred dekódovaním UTF-8');
  assert.equal(ok.stats.cancelled, false);
  // rýchla cesta Content-Length ostáva a stream sa vôbec nečíta
  const declared = streamResponse({ pull: () => new Uint8Array(16), headers: { 'content-length': String(50 * 1024 * 1024) } });
  const early = await wikiControlSnapshot(root, 'lebanon', { fetchImpl: async () => declared.res, now: NOW + 7 * HOUR });
  assert.match(early.error, /too large \(Content-Length 52428800 B/);
  assert.ok(declared.stats.pulled <= 1, `deklarovaná veľkosť nad stropom = telo sa nečíta (ReadableStream si sám predplní frontu jedným pull: ${declared.stats.pulled})`);
});

test('`now` ako funkcia alebo číslo; NaN/reťazec = status error (snímka) alebo výnimka pred dopytom (história)', async () => {
  const root = await tmpRoot();
  const { calls, fetchImpl } = mockWiki();
  assert.equal(nowToMs(NOW), NOW);
  assert.equal(nowToMs(() => NOW), NOW, 'konvencia pluginu `now: () => ms`');
  for (const bad of [NaN, 'dnes', '1758888000000', () => Infinity, undefined, null, true, {}]) assert.ok(Number.isNaN(nowToMs(bad)), `nowToMs(${String(bad)}) musí byť NaN (Number(null) = 0 by bol tichý rok 1970)`);
  const fn = await wikiControlSnapshot(root, 'lebanon', { fetchImpl, now: () => NOW });
  assert.equal(fn.status, 'updated', 'funkcia namiesto čísla prejde');
  assert.equal(fn.day, '2026-09-26');
  assert.equal(JSON.parse(await fsp.readFile(controlFile(root, 'lebanon', '2026-09-26'), 'utf8')).fetchedAt, NOW, 'fetchedAt je číslo z funkcie');
  assert.equal((await wikiControlSnapshot(root, 'lebanon', { fetchImpl, now: () => NOW + HOUR })).status, 'fresh');
  const n = calls.length;
  for (const bad of [NaN, 'dnes', () => NaN, Infinity, null]) {
    const r = await wikiControlSnapshot(root, 'lebanon', { fetchImpl, now: bad });
    assert.equal(r.status, 'error', String(bad));
    assert.match(r.error, /^bad now/);
    assert.equal(r.module, 'lebanon');
    assert.equal(r.day, null, 'bez platného now nie je deň');
    const withAt = await wikiControlSnapshot(root, 'lebanon', { fetchImpl, now: bad, at: '2026-09-01' });
    assert.deepEqual([withAt.status, withAt.day], ['error', '2026-09-01'], 'so zadaným at ostáva deň v odpovedi');
    assert.match(withAt.error, /^bad now/);
  }
  assert.equal(calls.length, n, 'zlé now = žiadny dopyt');
  const stillUnknown = await wikiControlSnapshot(root, 'ukraine', { fetchImpl, now: NaN });
  assert.match(stillUnknown.error, /unknown module/, 'neznámy modul má prednosť pred zlým now');
  // história: funkcia prejde, NaN je chyba volajúceho pred prvým dopytom
  const sleep = async () => {};
  const hist = await controlBackfill(root, 'lebanon', { from: '2026-09-10', stepDays: 7, fetchImpl, now: () => NOW, sleep });
  assert.deepEqual(hist, { done: 3, skipped: 0, errors: 0 }, '10. 9., 17. 9., 24. 9.');
  const m = calls.length;
  await assert.rejects(() => controlBackfill(root, 'lebanon', { from: '2026-09-10', fetchImpl, now: NaN, sleep }), /bad now/);
  await assert.rejects(() => controlBackfill(root, 'lebanon', { from: '2026-09-10', fetchImpl, now: 'dnes', sleep }), /bad now/);
  assert.equal(calls.length, m, 'výnimka pred dopytom');
});

test('controlFor prechádza dni dozadu: nečitateľná snímka nezakryje staršiu platnú; keď sa nedá prečítať ani jedna, null', async () => {
  const root = await tmpRoot();
  const { fetchImpl } = mockWiki();
  assert.equal((await wikiControlSnapshot(root, 'lebanon', { at: '2026-09-20', fetchImpl, now: NOW })).status, 'updated');
  await fsp.writeFile(controlFile(root, 'lebanon', '2026-09-23'), '{"day":"2026-09-23","kind":"control","points":[', 'utf8'); // orezaný súbor (padnutý rename, ručná úprava)
  assert.deepEqual(await controlDays(root, 'lebanon'), ['2026-09-20', '2026-09-23'], 'adresár vidí oba dni');
  const pick = await controlFor(root, 'lebanon', '2026-09-24');
  assert.ok(pick, 'staršia platná snímka sa nájde');
  assert.equal(pick.day, '2026-09-20');
  assert.equal(pick.count, 2);
  assert.equal((await controlFor(root, 'lebanon', '2026-09-23')).day, '2026-09-20', 'aj pri dopyte priamo na chybný deň');
  assert.equal((await controlFor(root, 'lebanon', '2026-09-20')).day, '2026-09-20');
  assert.equal(await controlFor(root, 'lebanon', '2026-09-19'), null, 'pred prvou snímkou nič');
  // aj s odovzdaným zoznamom dní
  assert.equal((await controlFor(root, 'lebanon', '2026-12-31', { days: ['2026-09-20', '2026-09-23'] })).day, '2026-09-20');
  // keď je nečitateľná aj jediná spôsobilá snímka → null (proxy z toho robí 500, nie 404)
  await fsp.writeFile(controlFile(root, 'lebanon', '2026-09-20'), 'nie JSON', 'utf8');
  assert.equal(await controlFor(root, 'lebanon', '2026-09-24'), null);
  assert.deepEqual(await controlDays(root, 'lebanon'), ['2026-09-20', '2026-09-23'], 'dni ostávajú v zozname — volajúci rozlíši „nič" od „nečitateľné"');
});

test('história po týždňoch: jeden dopyt naraz s pauzou, existujúce dni preskočené, strop, chyby pred vznikom modulu sa počítajú', async () => {
  const root = await tmpRoot();
  const { calls, fetchImpl: wiki } = mockWiki();
  let inflight = 0; let maxInflight = 0;
  const fetchImpl = async (url, init) => {
    inflight += 1; maxInflight = Math.max(maxInflight, inflight);
    await new Promise((r) => setImmediate(r));
    try { return await wiki(url, init); } finally { inflight -= 1; }
  };
  const pauses = [];
  const sleep = async (ms) => { pauses.push(ms); };
  const r = await controlBackfill(root, 'lebanon', { from: '2026-08-20', stepDays: 7, pauseMs: 1200, fetchImpl, now: NOW, sleep });
  assert.deepEqual(r, { done: 6, skipped: 0, errors: 0 }, '20.8., 27.8., 3.9., 10.9., 17.9., 24.9. (všetky < now − 1 d)');
  assert.deepEqual(await controlDays(root, 'lebanon'), ['2026-08-20', '2026-08-27', '2026-09-03', '2026-09-10', '2026-09-17', '2026-09-24']);
  assert.deepEqual(pauses, [1200, 1200, 1200, 1200, 1200, 1200], 'pauza po každom dopyte cez injektovaný sleep');
  assert.equal(maxInflight, 1, 'Wikipedia etiketa: nikdy dva dopyty naraz');
  assert.equal(calls.length, 6);
  assert.ok(calls.every((c) => c.title === LEBANON_TITLE && /T23:59:59Z$/.test(c.start)), 'každý dopyt je k koncu dňa UTC');
  assert.equal((await controlFor(root, 'lebanon', '2026-09-05')).count, 1, 'staré revízie majú len Bejrút');
  assert.equal((await controlFor(root, 'lebanon', '2026-09-24')).count, 2);
  // druhý beh: všetko existuje, žiadny dopyt, žiadna pauza
  pauses.length = 0;
  const again = await controlBackfill(root, 'lebanon', { from: '2026-08-20', stepDays: 7, fetchImpl, now: NOW, sleep });
  assert.deepEqual(again, { done: 0, skipped: 6, errors: 0 });
  assert.deepEqual(pauses, []);
  assert.equal(calls.length, 6);
  // strop: len 2 nové (14-dňový krok od 1. 7.)
  const limited = await controlBackfill(root, 'lebanon', { from: '2026-07-01', stepDays: 14, limit: 2, fetchImpl, now: NOW, sleep });
  assert.deepEqual(limited, { done: 2, skipped: 0, errors: 0 });
  assert.deepEqual((await controlDays(root, 'lebanon')).slice(0, 2), ['2026-07-01', '2026-07-15']);
  // pred vznikom modulu: mock vracia „bez revízie" → chyby sa počítajú, beh pokračuje
  const early = await controlBackfill(root, 'lebanon', { from: '2025-12-18', stepDays: 7, limit: 1, fetchImpl, now: NOW, sleep });
  assert.equal(early.errors, 2, '18. 12. a 25. 12. 2025 bez revízie');
  assert.equal(early.done, 1, 'prvý deň roku 2026 (1. 1.) už má revíziu → strop 1 zastaví');
  assert.equal(MIDEAST_CONTROL_FIRST_DAY, '2026-02-28', 'predvolený začiatok histórie podľa plánu; hlbšie cez --from');
  await assert.rejects(() => controlBackfill(root, 'nope', { fetchImpl, now: NOW, sleep }), /unknown module 'nope'/);
  await assert.rejects(() => controlBackfill(root, 'lebanon', { from: 'zle', fetchImpl, now: NOW, sleep }), /bad from day/);
});
