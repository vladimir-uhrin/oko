// scripts/lib/ukraineArchive.test.mjs — archív UKRAJINA na disku: dni, zlúčenie,
// VIINA rok (zip aj CSV, 304, zlyhanie = starý súbor), GeoConfirmed okno,
// médiá s vstreknutým fetch, hlásenia, zložená odpoveď. Bez siete.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import {
  archiveDayItems, archiveReport, backfillReports, collectMedia, coverageDays, dayList, dayShift, eventsPayload,
  geoconfirmedEvents, geoconfirmedRefresh, isDay, mergeItems, readDayItems, readReports, viinaEvents, viinaEventsFromBody, viinaStatus, viinaYear,
} from './ukraineArchive.mjs';

const VIINA_HEADER = 'viina_version,event_id_1pd,date,n_reports,event_ids,sources,geonameid,feature_code,asciiname,ADM1_NAME,ADM1_CODE,ADM2_NAME,ADM2_CODE,longitude,latitude,GEO_PRECISION,t_mil_b,a_rus_b,a_ukr_b,a_rus_init_b,a_ukr_init_b,a_civ_b,a_other_b,t_aad_b,t_airstrike_b,t_airalert_b,t_uav_b,t_armor_b,t_arrest_b,t_artillery_b,t_control_b,t_firefight_b,t_ied_b,t_raid_b,t_occupy_b,t_property_b,t_cyber_b,t_hospital_b,t_milcas_b,t_civcas_b,t_retreat_b,t_loc_b,t_san_b,tid';
const viinaRow = (id, date, over = {}) => {
  const base = { event_id_1pd: id, date, n_reports: '1', sources: 'pravdaua', geonameid: '704204', feature_code: 'PPL', asciiname: 'Lyman', ADM1_NAME: "Donets'k", longitude: '37.82', latitude: '48.96', GEO_PRECISION: 'ADM3', t_mil_b: '1', t_uav_b: '1', ...over };
  return VIINA_HEADER.split(',').map((h) => base[h] ?? '0').join(',');
};
const viinaCsv = (rows) => `${VIINA_HEADER}\n${rows.join('\n')}\n`;

/** Minimálny STORED zip s jedným členom (bez CRC — readZipEntries CRC nekontroluje). */
function storedZip(name, data) {
  const nameBuf = Buffer.from(name, 'utf8');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(0, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0, 10); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(0, 42);
  const dirOffset = 30 + nameBuf.length + data.length;
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(46 + nameBuf.length, 12); eocd.writeUInt32LE(dirOffset, 16);
  return Buffer.concat([local, nameBuf, data, central, nameBuf, eocd]);
}
const response = (body, { status = 200, headers = {} } = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  arrayBuffer: async () => { const b = Buffer.isBuffer(body) ? body : Buffer.from(String(body)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
});
const tmpRoot = async () => fsp.mkdtemp(path.join(os.tmpdir(), 'oko-ukr-archive-'));
const NOW = Date.UTC(2026, 8, 19, 12);

test('dni a zlúčenie položiek', () => {
  assert.equal(isDay('2026-09-19'), true);
  assert.equal(isDay('2026-13-01'), false);
  assert.deepEqual(dayList('2026-09-18', '2026-09-20'), ['2026-09-18', '2026-09-19', '2026-09-20']);
  assert.deepEqual(dayList('2026-09-20', '2026-09-18'), []);
  assert.equal(dayShift('2026-09-19', -1), '2026-09-18');
  const m = mergeItems([{ id: 'a', image: null, title: 'A', archivedAt: 1 }], [{ id: 'a', image: 'https://i/1.jpg', title: 'A2' }, { id: 'b', title: 'B' }], { now: 5 });
  assert.equal(m.added, 1);
  assert.equal(m.updated, 1);
  const a = m.items.find((x) => x.id === 'a');
  assert.equal(a.image, 'https://i/1.jpg', 'prázdne pole sa doplní');
  assert.equal(a.title, 'A', 'plné pole ostáva');
  assert.equal(a.archivedAt, 1);
  assert.equal(m.items.find((x) => x.id === 'b').archivedAt, 5);
});

test('položky po dňoch: zápis, zlúčenie, čítanie, pokrytie', async () => {
  const root = await tmpRoot();
  const t1 = Date.UTC(2026, 8, 19, 10); const t2 = Date.UTC(2026, 8, 18, 23, 59);
  const r1 = await archiveDayItems(root, 'news', [{ url: 'https://x/1', title: 'one', publishedAt: t1, image: null }, { url: 'https://x/2', title: 'two', publishedAt: t2 }, { url: 'https://x/3', title: 'no time' }], { now: NOW });
  assert.deepEqual(r1, { days: 2, added: 2, updated: 0 });
  const r2 = await archiveDayItems(root, 'news', [{ url: 'https://x/1', title: 'one', publishedAt: t1, image: 'https://i/1.jpg' }], { now: NOW + 1 });
  assert.deepEqual(r2, { days: 1, added: 0, updated: 1 });
  const day19 = await readDayItems(root, 'news', '2026-09-19');
  assert.equal(day19.length, 1);
  assert.equal(day19[0].image, 'https://i/1.jpg');
  assert.deepEqual(await coverageDays(root, 'news', '2026-09-17', '2026-09-19'), ['2026-09-18', '2026-09-19']);
  assert.deepEqual(await readDayItems(root, 'news', '2026-09-17'), []);
});

test('VIINA rok: zip → udalosti, čerstvosť, 304, zlyhanie nechá starý súbor, rozsah dní', async () => {
  const root = await tmpRoot();
  const csv = viinaCsv([viinaRow('1', '20260918'), viinaRow('2', '20260919'), viinaRow('3', '20260919', { t_uav_b: '0', t_san_b: '1', t_mil_b: '0' })]);
  assert.equal(viinaEventsFromBody(Buffer.from(csv)).length, 2, 'holý CSV');
  const zip = storedZip('event_1pd_latest_2026.csv', Buffer.from(csv));
  assert.equal(viinaEventsFromBody(zip).length, 2, 'zip');
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, ims: init?.headers?.['If-Modified-Since'] || null }); return response(zip, { headers: { 'last-modified': 'Sat, 19 Sep 2026 06:00:00 GMT' } }); };
  const first = await viinaYear(root, 2026, { fetchImpl, now: NOW });
  assert.equal(first.status, 'updated');
  assert.equal(first.count, 2);
  assert.equal(calls[0].url, 'https://media.githubusercontent.com/media/zhukovyuri/VIINA/main/Data/event_1pd_latest_2026.zip');
  assert.equal((await viinaYear(root, 2026, { fetchImpl, now: NOW + 3_600_000 })).status, 'fresh', 'do 24 h bez siete');
  assert.equal(calls.length, 1);
  const notModified = await viinaYear(root, 2026, { fetchImpl: async (url, init) => response('', { status: 304 }), now: NOW + 2 * 86_400_000 });
  assert.equal(notModified.status, 'not-modified');
  const failed = await viinaYear(root, 2026, { fetchImpl: async () => { throw new Error('offline'); }, now: NOW + 5 * 86_400_000 });
  assert.equal(failed.status, 'stale');
  assert.equal(failed.count, 2);
  const events = await viinaEvents(root, '2026-09-19', '2026-09-19');
  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'viina:2');
  assert.equal((await viinaEvents(root, '2026-09-01', '2026-09-30')).length, 2);
  assert.equal((await viinaEvents(root, '2025-12-31', '2025-12-31')).length, 0, 'chýbajúci rok = prázdno');
  const status = await viinaStatus(root, { now: NOW });
  assert.equal(status[2026].count, 2);
  assert.equal(status[2022], null);
  const missing = await viinaYear(root, 2022, { fetchImpl: async () => response('nope', { status: 404 }), now: NOW });
  assert.equal(missing.status, 'missing');
});

test('GeoConfirmed okno: každý deň dostane súbor, staré dni sa neobnovujú, etický filter', async () => {
  const root = await tmpRoot();
  const csv = '﻿Date;Name;Faction;Origin;Latitude;Longitude;PlusCode;Description;Source;Geolocation;Equipment;EquipmentItems;Units;OrbatUnits;Id\n2026-09-18;a;Russia;UAV;48.9;37.8;"GH4P+X43 Lyman, Donetsk Oblast, Ukraine";"FPV strike on a truck";https://x.com/1;;;;;;id1\n2026-09-18;b;Ukraine;PIC;48.9;37.8;"x Lyman";"UA position";https://x.com/2;;;;3rd Brigade;;id2\n;NPP;Special;;47.5;34.5;"x Enerhodar";;;;;;;;id3\n';
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return response(csv); };
  const r = await geoconfirmedRefresh(root, '2026-09-17', '2026-09-19', { fetchImpl, now: NOW });
  assert.equal(r.status, 'updated');
  assert.equal(r.count, 1, 'ukrajinská frakcia a bezdátumové preč');
  assert.deepEqual(await coverageDays(root, 'geoconfirmed', '2026-09-16', '2026-09-19'), ['2026-09-17', '2026-09-18', '2026-09-19']);
  const events = await geoconfirmedEvents(root, '2026-09-17', '2026-09-19');
  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'gc:id1');
  assert.equal((await geoconfirmedRefresh(root, '2026-09-17', '2026-09-19', { fetchImpl, now: NOW + 60_000 })).status, 'fresh');
  assert.equal(calls, 1);
  assert.equal((await geoconfirmedRefresh(root, '2026-09-17', '2026-09-19', { fetchImpl, now: NOW + 7 * 3_600_000 })).status, 'updated', 'po 6 h znova');
  assert.equal((await geoconfirmedRefresh(root, '2026-09-17', '2026-09-19', { fetchImpl, now: NOW + 40 * 86_400_000 })).status, 'fresh', 'po 14 dňoch sú dni konečné');
  assert.equal((await geoconfirmedRefresh(root, '2026-09-19', '2026-09-17', { fetchImpl })).status, 'bad-range');
  assert.equal((await geoconfirmedRefresh(root, '2026-09-20', '2026-09-21', { fetchImpl: async () => response('', { status: 503 }), now: NOW })).status, 'error');
});

test('médiá: každý prítok samostatne, zlyhanie jedného nezhodí ostatné', async () => {
  const yt = '<feed xmlns:yt="x" xmlns:media="y"><entry><yt:videoId>abcdefgh</yt:videoId><title>Drone strike on Kharkiv</title><published>2026-09-19T10:00:00+00:00</published><media:group><media:thumbnail url="https://i.ytimg.com/vi/abcdefgh/hqdefault.jpg"/><media:description>x</media:description></media:group></entry></feed>';
  const tg = '<div class="tgme_widget_message_wrap"><div data-post="dsns_telegram/5"><a class="tgme_widget_message_photo_wrap" style="background-image:url(\'https://cdn4.telesco.pe/file/a.jpg\')"></a><div class="tgme_widget_message_text js-message_text" dir="auto">Одеса: пожежа після атаки дронів</div><time datetime="2026-09-19T11:00:00+00:00"></time></div></div>';
  const fetchImpl = async (url) => {
    if (url.includes('youtube.com/feeds')) return response(yt);
    if (url.includes('t.me/s/dsns_telegram')) return response(tg);
    if (url.includes('t.me/s/')) return response('', { status: 503 });
    if (url.includes('armyinform')) throw new Error('timeout');
    return response('', { status: 404 });
  };
  const logs = [];
  const { items, failures } = await collectMedia({ fetchImpl, log: (m) => logs.push(m), youtube: [{ id: 'UC1', label: 'Kyiv Independent', filter: false }], telegram: [{ name: 'dsns_telegram', label: 'ДСНС', badge: 'official-ua' }, { name: 'kpszsu', label: 'ПС', badge: 'official-ua' }] });
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.provider), ['youtube', 'telegram']);
  assert.deepEqual(failures.map((f) => f.label), ['telegram:kpszsu', 'armyinform']);
  assert.equal(logs.length, 1);
  const root = await tmpRoot();
  const r = await archiveDayItems(root, 'media', items, { now: NOW });
  assert.equal(r.added, 2);
  assert.equal((await readDayItems(root, 'media', '2026-09-19')).length, 2);
});

test('hlásenia GŠ: archív po dňoch, spätné naplnenie cez stránkovaný feed, zložená odpoveď', async () => {
  const root = await tmpRoot();
  const report = { ok: true, reportedAt: '2026-09-19T05:00:00.000Z', total: 213, directions: [{ name: 'Лиманський', attacks: 20 }], fetchedAt: NOW };
  assert.deepEqual(await archiveReport(root, report), { status: 'stored', day: '2026-09-19' });
  assert.deepEqual(await archiveReport(root, { ...report, total: 1, fetchedAt: NOW - 1 }), { status: 'kept', day: '2026-09-19' });
  assert.deepEqual(await archiveReport(root, { ok: true }), { status: 'no-day' });
  const reports = await readReports(root, '2026-09-18', '2026-09-19');
  assert.equal(reports['2026-09-19'].total, 213);
  const feedXml = (page) => `<rss><channel>${page === 1 ? '<item><title>213 боєзіткнень</title><link>https://armyinform.com.ua/a/</link><pubDate>Sat, 19 Sep 2026 05:00:00 +0000</pubDate></item><item><title>200 боєзіткнень</title><link>https://armyinform.com.ua/b/</link><pubDate>Fri, 18 Sep 2026 05:00:00 +0000</pubDate></item>' : ''}</channel></rss>`;
  const html = '<div class="single-content"><p>Загалом протягом минулої доби зафіксовано 200 бойових зіткнень.</p><p>На Лиманському напрямку ворог здійснив 20 атак.</p><p>На Покровському напрямку ворог здійснив 50 атак.</p><p>На Куп’янському напрямку ворог здійснив 5 атак.</p><p>На Сіверському напрямку ворог здійснив 6 атак.</p><p>На Торецькому напрямку ворог здійснив 7 атак.</p></div>';
  const fetched = [];
  const fetchImpl = async (url) => { fetched.push(url); if (url.includes('/feed')) return response(feedXml(url.includes('paged=') ? 2 : 1)); return response(html); };
  const normalizeRss = (xml) => (xml.match(/<item>[\s\S]*?<\/item>/g) || []).map((it) => ({ title: /<title>([^<]*)/.exec(it)[1], url: /<link>([^<]*)/.exec(it)[1], publishedAt: new Date(/<pubDate>([^<]*)/.exec(it)[1]).toISOString() }));
  const bf = await backfillReports(root, { fetchImpl, normalizeRss, pages: 2, pauseMs: 0, now: NOW });
  assert.equal(bf.seen, 2);
  assert.equal(bf.stored, 1, '19. 9. už archivovaný, 18. 9. sa stiahol');
  assert.ok(fetched.includes('https://armyinform.com.ua/b/'));
  assert.ok(!fetched.includes('https://armyinform.com.ua/a/'));
  const payload = await eventsPayload(root, '2026-09-18', '2026-09-19', { now: NOW });
  assert.equal(payload.days, 2);
  assert.deepEqual(payload.coverage.reports, ['2026-09-18', '2026-09-19']);
  assert.equal(payload.reports['2026-09-18'].total, 200);
  assert.deepEqual(payload.counts, { viina: 0, geoconfirmed: 0, news: 0, media: 0, reports: 2 });
  assert.equal(payload.coverage.viina[2026], null);
  assert.ok(payload.attribution.viina.includes('ODbL'));
});
