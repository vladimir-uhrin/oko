// src/data/ukraineEventsClient.test.mjs — klientský sklad: kusy ≤ 31 dní, cache
// a TTL, zloženie modelu (správy a médiá pripojené), médiá okna, súhrn, hlásenie dňa.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasVisualMedia, assembleEvents, chunkRanges, createUkraineEventStore, mediaInWindow } from './ukraineEventsClient.js';

const D = 86_400_000;
const T0 = Date.UTC(2026, 8, 19, 12);

test('chunkRanges: denné kusy ≤ 31 dní', () => {
  assert.deepEqual(chunkRanges(Date.UTC(2026, 8, 19, 5), Date.UTC(2026, 8, 19, 20)), [{ from: '2026-09-19', to: '2026-09-19' }]);
  const r = chunkRanges(Date.UTC(2026, 6, 1), Date.UTC(2026, 8, 19));
  assert.deepEqual(r, [{ from: '2026-07-01', to: '2026-07-31' }, { from: '2026-08-01', to: '2026-08-31' }, { from: '2026-09-01', to: '2026-09-19' }]);
  assert.deepEqual(chunkRanges(T0, T0 - D), []);
});

test('assembleEvents: VIINA + správa + médium na tom istom mieste a dni = jedna udalosť s médiami', () => {
  const payload = {
    events: [{ id: 'viina:1', t: Date.UTC(2026, 8, 19), dayOnly: true, lat: 48.99, lon: 37.8, place: 'Lyman', type: 'strike', sub: 'drone', severity: 'critical', level: 'reported', src: 'viina', approx: false, reports: 2, sources: [], image: null, status: null }],
    news: [
      { title: 'Russian drone attack on Lyman injures 3', url: 'https://news/1', source: 'BBC News', publishedAt: Date.UTC(2026, 8, 19, 9), image: 'https://img/1.jpg' },
      { title: 'RT says something', url: 'https://www.rt.com/x', source: 'rt.com', publishedAt: Date.UTC(2026, 8, 19, 10) },
    ],
    media: [
      { kind: 'video', provider: 'youtube', id: 'yt:abc', videoId: 'abc', url: 'https://www.youtube.com/watch?v=abc', embed: 'https://www.youtube-nocookie.com/embed/abc', thumb: 'https://i.ytimg.com/vi/abc/hqdefault.jpg', title: 'Drone strike on Lyman', description: '', publishedAt: Date.UTC(2026, 8, 19, 11), channel: 'Kyiv Independent', badge: null, lang: 'en' },
      { kind: 'photo', provider: 'telegram', id: 'tg:dsns_telegram/1', url: 'https://t.me/dsns_telegram/1', embed: 'https://t.me/dsns_telegram/1?embed=1&mode=tme', thumb: 'https://cdn4.telesco.pe/file/a.jpg', photos: ['https://cdn4.telesco.pe/file/a.jpg'], videos: 0, text: 'Одеса: пожежа після атаки', publishedAt: Date.UTC(2026, 8, 19, 8), channel: 'ДСНС', badge: 'official-ua', lang: 'uk' },
      { kind: 'video', provider: 'youtube', id: 'yt:zzz', url: 'https://www.youtube.com/watch?v=zzz', embed: 'x', thumb: 't', title: 'Markets rally', description: '', publishedAt: Date.UTC(2026, 8, 19, 7), channel: 'Reuters', lang: 'en' },
    ],
  };
  const events = assembleEvents([payload, payload], { startMs: Date.UTC(2026, 8, 19), endMs: Date.UTC(2026, 8, 19, 23) });
  assert.equal(events.length, 3, 'Lyman (zlúčené), Odesa (médium), Reuters bez miesta; RT vypadlo');
  const lyman = events.find((e) => e.id === 'viina:1');
  assert.equal(lyman.media.length, 1);
  assert.equal(lyman.media[0].embed, 'https://www.youtube-nocookie.com/embed/abc');
  assert.equal(lyman.image, 'https://img/1.jpg');
  assert.equal(lyman.injured, 3);
  assert.equal(lyman.sources.length, 2);
  assert.ok(!events.some((e) => e.id === 'news:https://www.rt.com/x'), 'sankčný blocklist aj na klientovi');
  const odesa = events.find((e) => e.id === 'tg:dsns_telegram/1');
  assert.equal(odesa.place, 'Odesa');
  assert.equal(odesa.level, 'official');
  const media = mediaInWindow(events);
  assert.equal(media.length, 3);
  assert.equal(media[0].eventId, 'viina:1', 'najnovšie médium prvé (11:00)');
  assert.equal(media[0].place, 'Lyman');
});

test('sklad: kusy, TTL dnešného kusu, chyby kusov, súhrn, hlásenie dňa', async () => {
  let now = T0;
  const calls = [];
  const fetchEvents = async (from, to) => {
    calls.push(`${from}:${to}`);
    if (from === '2026-08-01') throw new Error('boom');
    return { events: [{ id: `v:${from}`, t: Date.parse(`${to}T00:00:00Z`), lat: 48, lon: 37, place: 'x', type: 'strike', severity: 'major', level: 'reported', src: 'viina', sources: [], approx: false, reports: 1 }], news: [], media: [], reports: { [to]: { total: 200 } }, coverage: { geoconfirmed: [to], news: [], media: [], reports: [to], viina: { 2026: { count: 1 } } } };
  };
  const summaryCalls = [];
  const fetchSummary = async (from, to) => { summaryCalls.push(`${from}:${to}`); return { days: { [to]: { viina: 5 } } }; };
  const store = createUkraineEventStore({ fetchEvents, fetchSummary, now: () => now });
  const a = await store.load(Date.UTC(2026, 7, 1), T0);
  assert.deepEqual(calls, ['2026-08-01:2026-08-31', '2026-09-01:2026-09-19']);
  assert.equal(a.errors.length, 1);
  assert.equal(a.events.length, 1);
  assert.equal(a.reports['2026-09-19'].total, 200);
  assert.deepEqual(a.coverage.geoconfirmed, ['2026-09-19']);
  await store.load(Date.UTC(2026, 8, 1), T0);
  assert.equal(calls.length, 2, 'dnešný kus ostáva v cache 60 s');
  now += 61_000;
  await store.load(Date.UTC(2026, 8, 1), T0);
  assert.equal(calls.length, 3, 'po TTL sa dnešný kus obnoví');
  await store.load(Date.UTC(2026, 7, 1), T0);
  assert.equal(calls.length, 4, 'kus, ktorý zlyhal, sa skúsi znova');
  const s = await store.summary(Date.UTC(2026, 1, 24), T0);
  await store.summary(Date.UTC(2026, 1, 24), T0);
  assert.deepEqual(summaryCalls, ['2026-02-24:2026-09-19']);
  assert.equal(s.days['2026-09-19'].viina, 5);
  const reports = { '2026-09-17': { total: 1 }, '2026-09-19': { total: 2 } };
  assert.equal(store.reportForDay(reports, Date.UTC(2026, 8, 18, 10)).total, 1, 'najbližší predchádzajúci deň');
  assert.equal(store.reportForDay(reports, Date.UTC(2026, 8, 25)), null);
});

test('pás FOTKY A VIDEÁ berie len to, čo naozaj má obrázok alebo video', () => {
  // Telegramové kanály sú z väčšiny text: 22. 9. 2026 malo okno 292 položiek,
  // z toho 196 textových hlásení bez prílohy — kreslili sa ako prázdne dlaždice.
  assert.equal(hasVisualMedia({ kind: 'text', thumb: null, photos: [], videos: 0 }), false);
  assert.equal(hasVisualMedia({ kind: 'photo', thumb: 'https://cdn/x.jpg' }), true);
  assert.equal(hasVisualMedia({ kind: 'photo', thumb: null, photos: ['https://cdn/a.jpg'] }), true, 'fotka bez náhľadu je stále fotka');
  // Prílohy ArmyInformu náhľad nemajú, ale prehrať sa dajú.
  assert.equal(hasVisualMedia({ kind: 'video', provider: 'file', thumb: null, photos: [] }), true);
  assert.equal(hasVisualMedia({ kind: 'text', videos: 2 }), true, 'počet videí rozhoduje aj bez kind');
  assert.equal(hasVisualMedia(null), false);
  assert.equal(hasVisualMedia({}), false);
});

test('mediaInWindow textové príspevky vyhodí a nezapočíta', () => {
  const events = [{
    id: 'e1', t: 3, place: 'Kyiv', type: 'strike', severity: 'minor', level: 'reported',
    media: [
      { kind: 'text', url: 'https://t.me/c/1', thumb: null, photos: [], videos: 0 },
      { kind: 'photo', url: 'https://t.me/c/2', thumb: 'https://cdn/2.jpg' },
      { kind: 'video', url: 'https://armyinform/3.mp4', thumb: null, provider: 'file' },
    ],
  }];
  const out = mediaInWindow(events);
  assert.equal(out.length, 2, 'z troch ostanú dve — text odpadne');
  assert.deepEqual(out.map((m) => m.kind).sort(), ['photo', 'video']);
  assert.ok(out.every((m) => m.eventId === 'e1' && m.place === 'Kyiv'), 'kontext udalosti ostáva');
});
