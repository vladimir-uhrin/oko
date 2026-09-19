// src/data/ukraineEvents.test.mjs — model udalostí UKRAJINA (etapa 3a): VIINA riadky,
// GeoConfirmed CSV s etickým filtrom, správy → udalosti, pripojenie, okno, zhluky, karty.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attachNews,
  casualtiesFromHeadline,
  clusterEvents,
  dayKey,
  dayToMs,
  eventCardModel,
  eventStatusText,
  eventTimeText,
  eventsInWindow,
  geoconfirmedRowToEvent,
  geoconfirmedType,
  newsItemToEvent,
  parseCsv,
  parseGeoconfirmedCsv,
  parseViinaCsv,
  pickCards,
  placeFromPlusCode,
  splitCsvLine,
  summarizeEvents,
  viinaClassify,
  viinaRowToEvent,
} from './ukraineEvents.js';

const VIINA_HEADER = 'viina_version,event_id_1pd,date,n_reports,event_ids,sources,geonameid,feature_code,asciiname,ADM1_NAME,ADM1_CODE,ADM2_NAME,ADM2_CODE,longitude,latitude,GEO_PRECISION,t_mil_b,a_rus_b,a_ukr_b,a_rus_init_b,a_ukr_init_b,a_civ_b,a_other_b,t_aad_b,t_airstrike_b,t_airalert_b,t_uav_b,t_armor_b,t_arrest_b,t_artillery_b,t_control_b,t_firefight_b,t_ied_b,t_raid_b,t_occupy_b,t_property_b,t_cyber_b,t_hospital_b,t_milcas_b,t_civcas_b,t_retreat_b,t_loc_b,t_san_b,tid';
const viinaRow = (over = {}) => {
  const base = { viina_version: 'bert_20260919024116', event_id_1pd: '218649', date: '20260919', n_reports: '3', event_ids: '4454996', sources: 'pravdaua', geonameid: '704204', feature_code: 'PPL', asciiname: 'Lyman', ADM1_NAME: "Donets'k", ADM1_CODE: '655', ADM2_NAME: "Krasnolymans'kyi", ADM2_CODE: '18941', longitude: '37.82245', latitude: '48.96409', GEO_PRECISION: 'ADM3' };
  for (const h of VIINA_HEADER.split(',')) if (!(h in base)) base[h] = '0';
  return { ...base, ...over };
};

test('CSV: úvodzovky, čiarky v poli, BOM, bodkočiarka', () => {
  assert.deepEqual(splitCsvLine('a,"b,c","d ""q""",e'), ['a', 'b,c', 'd "q"', 'e']);
  assert.deepEqual(parseCsv('﻿x;y\n1;"a;b"\n', ';'), [{ x: '1', y: 'a;b' }]);
  assert.deepEqual(parseCsv(''), []);
  assert.equal(dayToMs('20260919'), Date.UTC(2026, 8, 19));
  assert.equal(dayToMs('2026-09-19'), Date.UTC(2026, 8, 19));
  assert.equal(dayToMs('x'), null);
  assert.equal(dayKey(Date.UTC(2026, 8, 19, 23, 59)), '2026-09-19');
});

test('VIINA: klasifikácia príznakov (poradie zbraní, závažnosť, nevojenské = null)', () => {
  assert.deepEqual(viinaClassify(viinaRow({ t_mil_b: '1', t_airstrike_b: '1', t_uav_b: '1' })), { type: 'strike', sub: 'air', severity: 'critical' });
  assert.deepEqual(viinaClassify(viinaRow({ t_mil_b: '1', t_uav_b: '1' })), { type: 'strike', sub: 'drone', severity: 'critical' });
  assert.deepEqual(viinaClassify(viinaRow({ t_mil_b: '1', t_artillery_b: '1' })), { type: 'artillery', sub: null, severity: 'major' });
  assert.deepEqual(viinaClassify(viinaRow({ t_mil_b: '1', t_artillery_b: '1', t_civcas_b: '1' })), { type: 'artillery', sub: null, severity: 'critical' });
  assert.deepEqual(viinaClassify(viinaRow({ t_mil_b: '1', t_aad_b: '1' })), { type: 'air-defence', sub: null, severity: 'minor' });
  assert.deepEqual(viinaClassify(viinaRow({ t_mil_b: '1', t_aad_b: '1', t_milcas_b: '1' })), { type: 'air-defence', sub: null, severity: 'major' });
  assert.deepEqual(viinaClassify(viinaRow({ t_mil_b: '1', t_control_b: '1' })), { type: 'ground', sub: 'control', severity: 'major' });
  assert.deepEqual(viinaClassify(viinaRow({ t_mil_b: '1', t_hospital_b: '1' })), { type: 'infrastructure', sub: 'hospital', severity: 'critical' });
  assert.deepEqual(viinaClassify(viinaRow({ t_mil_b: '1', t_airalert_b: '1' })), { type: 'alert', sub: null, severity: 'minor' });
  assert.deepEqual(viinaClassify(viinaRow({ t_mil_b: '1' })), { type: 'other', sub: null, severity: 'minor' });
  assert.equal(viinaClassify(viinaRow({ t_san_b: '1' })), null, 'sankcie nie sú udalosť na mape');
  assert.equal(viinaClassify(viinaRow({ t_arrest_b: '1' })), null);
});

test('VIINA: riadok → udalosť (deň, sídlo, presnosť, aktér, počet správ) a celý CSV', () => {
  const ev = viinaRowToEvent(viinaRow({ t_mil_b: '1', t_artillery_b: '1', a_rus_init_b: '1', a_rus_b: '1', sources: 'pravdaua,unian' }));
  assert.equal(ev.id, 'viina:218649');
  assert.equal(ev.t, Date.UTC(2026, 8, 19));
  assert.equal(ev.dayOnly, true);
  assert.deepEqual([ev.lat, ev.lon], [48.96409, 37.82245]);
  assert.equal(ev.place, 'Lyman');
  assert.equal(ev.precision, 'settlement');
  assert.equal(ev.approx, false);
  assert.equal(ev.actor, 'ru');
  assert.equal(ev.reports, 3);
  assert.deepEqual(ev.outlets, ['pravdaua', 'unian']);
  assert.equal(ev.level, 'reported');
  assert.equal(viinaRowToEvent(viinaRow({ t_mil_b: '1', t_uav_b: '1', GEO_PRECISION: 'ADM1' })).approx, true, 'oblastná presnosť = približné');
  assert.equal(viinaRowToEvent(viinaRow({ t_san_b: '1' })), null);
  const csv = `${VIINA_HEADER}\n${VIINA_HEADER.split(',').map((h) => viinaRow({ t_mil_b: '1', t_uav_b: '1' })[h]).join(',')}\n${VIINA_HEADER.split(',').map((h) => viinaRow({ t_san_b: '1' })[h]).join(',')}\n`;
  const events = parseViinaCsv(csv);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'strike');
});

test('GeoConfirmed: typ z popisu, miesto z plus kódu, etický filter (jednotky, frakcia Ukraine, pozície), odkazy', () => {
  assert.deepEqual(geoconfirmedType('Geran-4 drones targeted three dry cargo ships in the port of Chornomorsk', 'UAV').type, 'strike');
  assert.equal(geoconfirmedType('Iskander missile strike on a warehouse').type, 'strike');
  assert.equal(geoconfirmedType('Damaged train station building following a reported Russian drone attack', 'PIC').type, 'strike');
  assert.equal(geoconfirmedType('Artillery shelling of the outskirts').type, 'artillery');
  assert.equal(geoconfirmedType('Pantsir air defense system').type, 'air-defence');
  assert.equal(geoconfirmedType('Landing ship hit in Sevastopol').type, 'naval');
  assert.equal(geoconfirmedType('Burning warehouse after explosion').type, 'infrastructure');
  assert.equal(geoconfirmedType('something else').type, 'other');
  assert.equal(placeFromPlusCode('GH4P+X43 Enerhodar, Zaporizhia Oblast, Ukraine'), 'Enerhodar');
  assert.equal(placeFromPlusCode('9H7JR24G+XX Bol\'shaya Tarlovka, Republic of Tatarstan, Russia'), 'Bol\'shaya Tarlovka');
  assert.equal(placeFromPlusCode(''), null);
  const row = (o) => ({ Date: '2026-09-17', Name: '17 SEP 2026', Faction: 'Neutral', Origin: 'PIC', Latitude: '49.3717', Longitude: '35.4497', PlusCode: '9CC5+22 Krasnohrad, Kharkiv Oblast, Ukraine', Description: 'Damaged train station building Krasnohrad following a reported Russian drone attack.', Source: 'https://x.com/a/status/1, https://t.me/b/2', Geolocation: '', Equipment: '', EquipmentItems: '', Units: '', OrbatUnits: '', Id: 'abc', ...o });
  const ev = geoconfirmedRowToEvent(row());
  assert.equal(ev.id, 'gc:abc');
  assert.equal(ev.level, 'osint');
  assert.equal(ev.place, 'Krasnohrad');
  assert.equal(ev.type, 'strike');
  assert.equal(ev.sources.length, 2);
  assert.equal(ev.sources[0].url, 'https://x.com/a/status/1');
  assert.equal(ev.status, 'Damaged train station building Krasnohrad following a reported Russian drone attack.');
  assert.equal(geoconfirmedRowToEvent(row({ Faction: 'Ukraine' })), null, 'ukrajinská frakcia sa nekreslí');
  assert.equal(geoconfirmedRowToEvent(row({ Units: '3rd Assault Brigade' })), null, 'riadok s jednotkou sa nekreslí');
  assert.equal(geoconfirmedRowToEvent(row({ Description: 'RU attacks reported UA drone team position with FPV in Lyman' })), null, 'opis pozície sa nekreslí');
  assert.equal(geoconfirmedRowToEvent(row({ Date: '' })), null, 'bez dátumu nie');
  assert.equal(geoconfirmedRowToEvent(row({ Description: '0:29-0:32 - FPV strike on a truck' })).status, 'FPV strike on a truck', 'časová značka videa sa odstrihne');
  const csv = 'Date;Name;Faction;Origin;Latitude;Longitude;PlusCode;Description;Source;Geolocation;Equipment;EquipmentItems;Units;OrbatUnits;Id\n2026-09-17;x;Russia;UAV;48.9;37.8;"GH4P+X43 Lyman, Donetsk Oblast, Ukraine";"FPV strike, ";https://x.com/1;;;;;;id1\n;NPP;Special;;47.5;34.5;"GH4P+X43 Enerhodar";;;;;;;;id2\n';
  assert.equal(parseGeoconfirmedCsv(csv).length, 1);
});

test('správy → udalosť: trieda, miesto, obete z titulku, obrázok podľa pravidla zdroja, bez miesta null', () => {
  assert.deepEqual(casualtiesFromHeadline('Russian strike on Kharkiv kills 2, injures 12'), { killed: 2, injured: 12 });
  assert.deepEqual(casualtiesFromHeadline('Three people killed in drone attack on Odesa'), { killed: 3, injured: null });
  assert.deepEqual(casualtiesFromHeadline('Woman injured in Russian attack in Kyiv region'), { killed: null, injured: null }, 'bez čísla žiadne číslo');
  const item = { title: 'Russian missile strike on Kramatorsk kills 2, injures 5', url: 'https://x/1', source: 'Ukrinform', publishedAt: Date.UTC(2026, 8, 19, 14, 27), image: 'https://img/1.jpg', badge: 'official-ua' };
  const ev = newsItemToEvent(item);
  assert.equal(ev.place, 'Kramatorsk');
  assert.equal(ev.type, 'strike');
  assert.equal(ev.severity, 'critical');
  assert.equal(ev.killed, 2);
  assert.equal(ev.injured, 5);
  assert.equal(ev.level, 'official');
  assert.equal(ev.image, 'https://img/1.jpg');
  assert.equal(ev.dayOnly, false);
  assert.equal(ev.actor, 'ru');
  assert.equal(newsItemToEvent({ ...item, image: 'https://img/2.jpg', noImage: true }).image, null, 'noImage = žiadny obrázok');
  assert.equal(newsItemToEvent({ title: 'Zelensky meets EU leaders', url: 'https://x/2', publishedAt: 1 }), null);
  assert.equal(newsItemToEvent({ title: 'Drone strike reported overnight', url: 'https://x/3', publishedAt: 1 }), null, 'bez miesta nie');
});

test('attachNews: správa toho istého dňa do 15 km príbuzného typu sa pripojí (stav, obrázok, hodina, zdroj), inak samostatná', () => {
  const viina = viinaRowToEvent(viinaRow({ t_mil_b: '1', t_uav_b: '1', a_rus_init_b: '1' }));
  const near = newsItemToEvent({ title: 'Russian drone attack on Lyman injures 3', url: 'https://x/1', source: 'Ukrinform', publishedAt: Date.UTC(2026, 8, 19, 9, 5), image: 'https://img/1.jpg' });
  const far = newsItemToEvent({ title: 'Missile strike on Odesa port', url: 'https://x/2', source: 'BBC News', publishedAt: Date.UTC(2026, 8, 19, 10) });
  const otherDay = newsItemToEvent({ title: 'Drone attack on Lyman', url: 'https://x/3', source: 'UP', publishedAt: Date.UTC(2026, 8, 18, 10) });
  const merged = attachNews([viina], [near, far, otherDay]);
  assert.equal(merged.length, 3, 'VIINA + Odesa + Lyman z iného dňa');
  const lyman = merged.find((e) => e.id === 'viina:218649');
  assert.equal(lyman.status, 'Russian drone attack on Lyman injures 3');
  assert.equal(lyman.image, 'https://img/1.jpg');
  assert.equal(lyman.injured, 3);
  assert.equal(lyman.dayOnly, false);
  assert.equal(lyman.t, Date.UTC(2026, 8, 19, 9, 5));
  assert.equal(lyman.reports, 4);
  assert.deepEqual(lyman.sources.map((s) => s.url), ['https://x/1']);
  assert.equal(viina.status, null, 'vstup sa nemení');
});

test('okno, zhluky, výber kariet, súhrn', () => {
  const mk = (id, t, lat, lon, type, severity, extra = {}) => ({ id, t, lat, lon, type, severity, place: extra.place || id, approx: false, reports: 1, sources: [], src: 'viina', level: 'reported', ...extra });
  const d = (h) => Date.UTC(2026, 8, 19, h);
  const events = [
    mk('a', d(1), 48.9, 37.8, 'strike', 'critical', { place: 'Lyman' }),
    mk('b', d(2), 48.91, 37.81, 'artillery', 'major', { place: 'Lyman' }),
    mk('c', d(3), 48.28, 37.18, 'ground', 'major', { place: 'Pokrovsk' }),
    mk('d', d(4), 50.0, 36.2, 'air-defence', 'minor', { place: 'Kharkiv' }),
    mk('e', d(5), 49.6, 36.9, 'strike', 'critical', { place: 'somewhere', approx: true }),
    mk('f', Date.UTC(2026, 8, 18, 5), 46.5, 30.7, 'naval', 'major', { place: 'Odesa' }),
  ];
  const win = eventsInWindow(events, d(0), d(23));
  assert.deepEqual(win.map((e) => e.id), ['e', 'd', 'c', 'b', 'a'], 'od najnovšej, včerajšia von');
  const clusters = clusterEvents(win, 0.25);
  assert.equal(clusters.find((c) => c.ids.includes('a')).count, 2, 'Lyman a + b v jednej bunke');
  assert.equal(clusters.find((c) => c.ids.includes('a')).severity, 'critical');
  const cards = pickCards(win, { max: 3 });
  assert.deepEqual(cards.map((e) => e.id), ['a', 'c', 'd'], 'najzávažnejšie, jedna karta na miesto+rodinu (b vypadne), približné e vypadne');
  const s = summarizeEvents(win);
  assert.equal(s.total, 5);
  assert.equal(s.byType.strike, 2);
  assert.equal(s.bySeverity.critical, 2);
});

test('karta: typ, čas, stav bez mien, úroveň, zdroj', () => {
  const tKey = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
  const ev = viinaRowToEvent(viinaRow({ t_mil_b: '1', t_artillery_b: '1', a_rus_init_b: '1', t_civcas_b: '1', n_reports: '2' }));
  const model = eventCardModel(ev, { translate: tKey, lang: 'sk' });
  assert.equal(model.typeText, 'ukraine.ev.artillery');
  assert.equal(model.timeText, '19.9.');
  assert.equal(model.title, 'Lyman');
  assert.equal(model.status, 'ukraine.ev.actor-ru · ukraine.ev.civcas · ukraine.ev.reports {"n":2}');
  assert.equal(model.levelText, 'ukraine.level.reported');
  assert.equal(model.sourceText, 'ukraine.src.viina');
  assert.equal(model.url, null);
  const news = newsItemToEvent({ title: 'Russian strike on Kharkiv kills 2', url: 'https://x/1', source: 'BBC News', publishedAt: Date.UTC(2026, 8, 19, 14, 27) });
  const m2 = eventCardModel(news, { translate: tKey });
  assert.equal(m2.timeText, '19.9. 14:27 UTC');
  assert.equal(eventStatusText(news, tKey), 'Russian strike on Kharkiv kills 2 · ukraine.ev.killed {"n":2}');
  assert.equal(m2.sourceText, 'BBC News');
  assert.equal(m2.url, 'https://x/1');
  assert.equal(eventTimeText({ t: NaN }), '');
});
