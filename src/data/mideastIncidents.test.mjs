// src/data/mideastIncidents.test.mjs — model OVERENÝCH UDALOSTÍ modulu BLÍZKY VÝCHOD (etapa 4,
// 2026-11-05). Fixtúry = skutočné riadky exportu GeoConfirmed z 5. 11. 2026 (BOM, `;`, CRLF);
// UCDP = malý súbor v tvare skutočného GEDEvent_v26_0_9.csv (viacriadkové pole v úvodzovkách).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MIDEAST_INCIDENTS_FIRST_DAY, MIDEAST_INCIDENT_TYPES, countInRange, dedupIncidents, descriptionSentences, distanceKm, geoconfirmedDropReason,
  geoconfirmedExportUrl, geoconfirmedMapUrl, geoconfirmedRowToIncident, inRect, incidentAge, incidentChunks, incidentPeriodRange, incidentStatusText,
  incidentSummary, mideastIncidentActor, mideastIncidentType, parseCsvRecords, parseGeoconfirmedIncidents, parseUcdpIncidents, placeFromPlusCode,
  ucdpCandidateUrl, ucdpRowToIncident,
} from './mideastIncidents.js';
import { UCDP_CSV } from './fixtures/ucdpCandidateFixture.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const IRAN = fixture('geoconfirmed-iran-20261105.csv');
const ISRAEL = fixture('geoconfirmed-israel-20261105.csv');


test('CSV: BOM preč, `;` aj `,`, úvodzovky so zdvojením, nový riadok VNÚTRI úvodzoviek, CRLF, prázdne riadky', () => {
  const rows = parseCsvRecords('\uFEFFa;b;c\r\n1;"x;y";"he said ""hi"""\r\n\r\n2;"line1\nline2";\n', ';');
  assert.deepEqual(rows, [{ a: '1', b: 'x;y', c: 'he said "hi"' }, { a: '2', b: 'line1\nline2', c: '' }]);
  assert.deepEqual(parseCsvRecords(''), []);
  const ucdp = parseCsvRecords(UCDP_CSV, ',');
  assert.equal(ucdp.length, 7, 'viacriadkový výňatok článku nerozbije riadky');
  assert.equal(ucdp[0].country, 'Israel');
  assert.match(ucdp[0].source_article, /^Line one[\s\S]*second line, and a comma$/);
});

test('GeoConfirmed Irán: 19 skutočných riadkov → 10 udalostí; prázdny dátum, poloha kamery, jednotky, presuny, osoby a nekinetické preč', () => {
  const r = parseGeoconfirmedIncidents(IRAN, { conflict: 'iran' });
  assert.equal(r.rows, 19);
  assert.deepEqual(r.dropped, { 'no-date': 1, pov: 2, position: 2, 'non-kinetic': 2, units: 1, person: 1 });
  assert.equal(r.incidents.length, 10);
  for (const it of r.incidents) {
    assert.equal(it.src, 'geoconfirmed');
    assert.equal(it.conflict, 'iran');
    assert.ok(it.day >= MIDEAST_INCIDENTS_FIRST_DAY);
    assert.ok(Number.isFinite(it.lat) && Number.isFinite(it.lon));
    assert.equal(it.url, 'https://geoconfirmed.org/map/iran');
    assert.ok(!('units' in it) && !('orbat' in it) && !('faction' in it), 'jednotky ani frakcia sa neukladajú');
  }
  const byType = Object.fromEntries(incidentSummary(r.incidents).byType.map((x) => [x.type, x.count]));
  assert.deepEqual(byType, { missile: 2, air: 2, drone: 2, naval: 1, 'air-defence': 1, damage: 2 });
  const shot = r.incidents.find((x) => x.type === 'air-defence');
  assert.equal(shot.actor, 'ir', '„Iranian Shahed drone shot down over Kuwait"');
  assert.equal(shot.precision, 'approx', '„Rough location -" = približná poloha');
  assert.equal(shot.text, 'Iranian Shahed drone shot down over Kuwait near "Ananas (Bnaider)".');
  assert.equal(shot.place, "Al Ad'ami, Kuwait");
  const erbil = r.incidents.find((x) => x.type === 'air' && x.actor === 'ir');
  assert.equal(erbil.text, 'Black smoke rise and fire from U.S. military base at Erbil Airport. Reportedly caused by Iranian airstrike.', '„Area grid -" preč, aktér zo „caused by Iranian"');
  const bunker = r.incidents.find((x) => /Heidar Karrar/.test(x.text));
  assert.match(bunker.text, /^IRGC HQ Underground/, '„Picture 2,3,4 -" preč');
  assert.equal(bunker.actor, null, 'IRGC je tu cieľ, nie aktér');
  const bahrain = r.incidents.find((x) => /5th Fleet/.test(x.text));
  assert.equal(bahrain.actor, null, '„headquarters of the US 5th Fleet" je cieľ');
  assert.equal(bahrain.type, 'drone', 'Shahed');
});

test('GeoConfirmed Izrael: Units, osoby (príslušníci, obete) a polohy (opevnenia, „IDF position") preč; mená osôb z karty vystrihnuté', () => {
  const r = parseGeoconfirmedIncidents(ISRAEL, { conflict: 'israel' });
  assert.equal(r.rows, 9);
  assert.deepEqual(r.dropped, { units: 1, person: 2, position: 2 });
  assert.deepEqual(r.incidents.map((x) => [x.type, x.actor]), [['air', 'il'], ['artillery', null], ['drone', 'hezbollah'], ['air', 'il']]);
  const haddad = r.incidents.at(-1);
  assert.equal(haddad.text, 'Israeli airstrike on an apartment at the Al-Mu\'taz building.', 'veta s menom veliteľa a obeťou vystrihnutá');
  const katiba = r.incidents[0];
  assert.equal(katiba.text, 'Geolocation of an Israeli airstrike near the Al-Katiba mosque.', 'veta „two hamas members were targeted" vystrihnutá');
  assert.equal(r.incidents[1].type, 'artillery', 'ATGM patrí k pozemnej palbe, nie k raketám');
  for (const it of r.incidents) assert.doesNotMatch(JSON.stringify(it), /Haddad|members were|Casualties/);
});

test('etický filter po pravidlách (syntetické riadky)', () => {
  const row = (Description, extra = {}) => ({ Date: '2026-05-01', Latitude: '33.1', Longitude: '35.4', Description, Units: '', OrbatUnits: '', ...extra });
  assert.equal(geoconfirmedDropReason(row('Airstrike on a building.', { Units: 'Golani Brigade' })), 'units');
  assert.equal(geoconfirmedDropReason(row('Point of view - explosion in the city.')), 'pov');
  assert.equal(geoconfirmedDropReason(row('0:12-0:20 - Point fo view - smoke.')), 'pov', 'aj s preklepom a časovou značkou');
  assert.equal(geoconfirmedDropReason(row('Explosion seen from the beach.')), 'pov');
  for (const text of ['IDF establishing positions near the village.', 'Convoy heading north.', 'New checkpoint on the road.', 'Hezbollah drone attack on an IDF outpost.',
    'IDF tanks deployed near the border.', 'Strike on the 401st Brigade HQ.', 'Forces captured the airport.', 'Vehicles gathered north of the hill.', 'Attack on the Al-Abbad border post.']) {
    assert.equal(geoconfirmedDropReason(row(text)), 'position', text);
  }
  for (const text of ['Arrest of three men in the city.', 'Drone strike on Hezbollah operatives.', 'A journalist was hit by a drone.', 'Injured people brought to the hospital after a strike.']) {
    assert.equal(geoconfirmedDropReason(row(text)), 'person', text);
  }
  assert.equal(geoconfirmedDropReason(row('Protest against the government.')), 'non-kinetic');
  assert.equal(geoconfirmedDropReason(row('Iranian Base')), 'non-kinetic', 'základňa bez úderu nie je udalosť');
  assert.equal(geoconfirmedDropReason(row('Reported E-3 Sentry AWACS at Prince Sultan Air Base')), 'non-kinetic', 'technika na základni = poloha, nie udalosť');
  assert.equal(geoconfirmedDropReason(row('Destroyed building at a missile base following strikes.')), null, 'úder NA základňu je udalosť');
  assert.equal(geoconfirmedDropReason(row('Damaged car after reported Israeli strike. Two people were injured.')), null, 'osoba len v druhej vete → udalosť ostáva, veta vypadne');
  assert.equal(incidentStatusText('Damaged car after reported Israeli strike. Two people were injured.'), 'Damaged car after reported Israeli strike.');
  const r = geoconfirmedRowToIncident(row('Explosion in the port.', { Date: '', }));
  assert.deepEqual(r, { drop: 'no-date' });
  assert.deepEqual(geoconfirmedRowToIncident(row('Explosion.', { Latitude: '0', Longitude: '0' })), { drop: 'coords' });
  assert.deepEqual(geoconfirmedRowToIncident(row('Explosion.', { Date: '2025-12-31' }), { conflict: 'syria', minDay: '2026-01-01' }), { drop: 'before' });
});

test('odkazy: zdroj z blocklistu sankcií EÚ sa zahodí, ostatné najviac dva', () => {
  const r = geoconfirmedRowToIncident({ Date: '2026-05-01', Latitude: '33.1', Longitude: '35.4', Description: 'Airstrike on a building.', Units: '', Source: 'https://www.presstv.ir/Detail/1, https://x.com/a/status/1 https://t.me/b/2 https://x.com/c/status/3' }, { conflict: 'israel' });
  assert.deepEqual(r.incident.sources, ['https://x.com/a/status/1', 'https://t.me/b/2']);
});

test('druh a aktér z popisu', () => {
  const cases = [
    ['Syrian air defenses intercept a kamikaze drone.', 'air-defence', 'sy'],
    ['A Yemeni fuel tanker was hit by an Ansar Allah FPV drone.', 'naval', 'houthi'],
    ['Aftermath of the reported Iranian ballistic missile hit in Tel Aviv.', 'missile', 'ir'],
    ['Destroyed structure at "Lar Missile Base" following strikes.', 'damage', null],
    ['Hezbollah \'Ababil\' drone attacks an IDF APC.', 'drone', 'hezbollah'],
    ['Israeli/US strike on a launcher site.', 'damage', 'il'],
    ['The Abbasabad police station was destroyed following U.S./Israeli strikes.', 'damage', 'us'],
    ['Pickup hit by drone dropped grenade of Yemeni army forces.', 'drone', null],
    ['Reported Houthi pickup attacked by Yemeni army drone dropped grenade.', 'drone', 'ye-gov'],
    ['An artillery strike, conducted by Ansar Allah forces, targeted a road.', 'artillery', 'houthi'],
    ['Explosion of a car bomb in the streets of Damascus.', 'damage', null],
    ['Damage at runway at ez-Zuhur Airbase after Israeli airstrike.', 'air', 'il'],
    ['Smoke over the city.', 'damage', null],
    ['Something happened.', 'other', null],
  ];
  for (const [text, type, actor] of cases) {
    assert.equal(mideastIncidentType(text), type, `druh: ${text}`);
    assert.equal(mideastIncidentActor(text), actor, `aktér: ${text}`);
  }
  assert.equal(mideastIncidentActor('Building hit at an IRGC compound.', 'United States Air Force'), 'us', 'letectvo z OrbatUnits = aktér');
  assert.equal(mideastIncidentActor('Destroyed buildings at the headquarters.', 'IRGC Aerospace Force'), null, 'velenie Iránu v OrbatUnits je cieľ, nie aktér');
  assert.ok(MIDEAST_INCIDENT_TYPES.every((x) => /^#[0-9a-f]{6}$/.test(x.css)));
});

test('popis: vety, časové značky videa, orez na hranici slova', () => {
  assert.deepEqual(descriptionSentences('A., B. C , , D'), ['A', 'B.', 'C', 'D']);
  assert.equal(incidentStatusText('Vid1 0:14-0:27/Vid2 1:08-1:42 - A drone hit a truck'), 'A drone hit a truck.');
  assert.equal(incidentStatusText('(0:06-0:12) Strike on a building.'), 'Strike on a building.');
  const long = incidentStatusText(`Strike ${'on a very long description '.repeat(20)}`, { max: 80 });
  assert.ok(long.length <= 80 && long.endsWith('…'));
  assert.equal(incidentStatusText(''), null);
  assert.equal(placeFromPlusCode('GH4P+X43 Enerhodar, Zaporizhia Oblast, Ukraine'), 'Enerhodar, Zaporizhia Oblast');
  assert.equal(placeFromPlusCode(''), null);
});

test('UCDP: len región, presný deň, poloha do okresu, od 28. 2.; nekóduje mená, obete ako odhad, strany organizácie', () => {
  const r = parseUcdpIncidents(UCDP_CSV);
  assert.equal(r.rows, 7);
  assert.deepEqual(r.dropped, { country: 1, 'place-precision': 1, 'date-precision': 1, before: 1 });
  assert.deepEqual(r.incidents.map((x) => x.id), ['ucdp:700001', 'ucdp:700005', 'ucdp:700007']);
  const [gaza, taiz, unknown] = r.incidents;
  assert.equal(gaza.type, 'air', 'druh z titulku');
  assert.equal(gaza.actor, null, 'štátny konflikt: strana A nie je nutne útočník');
  assert.deepEqual(gaza.parties, ['Government of Israel', 'Hamas']);
  assert.equal(gaza.deaths, 3);
  assert.equal(gaza.place, 'Gaza');
  assert.equal(gaza.precision, 'exact');
  assert.equal(taiz.actor, 'houthi', 'jednostranné násilie: strana A je páchateľ');
  assert.equal(taiz.country, 'Yemen');
  assert.equal(taiz.precision, 'near');
  assert.deepEqual(unknown.parties, [], 'kódy XXX nie sú strana');
  for (const it of r.incidents) assert.doesNotMatch(JSON.stringify(it), /Line one|article|headline/i, 'text článku sa neukladá');
  assert.equal(ucdpRowToIncident({ country: 'Israel', date_start: 'x' }).drop, 'no-date');
  assert.equal(ucdpCandidateUrl(2026, 9), 'https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_0_9.csv');
});

test('dedup GC × UCDP: ten istý deň do 2 km → UCDP vypadne, GC dostane príznak; iný deň alebo ďalej ostáva; rovnaké id raz', () => {
  const gc = parseGeoconfirmedIncidents(ISRAEL, { conflict: 'israel' }).incidents;
  const ucdp = parseUcdpIncidents(UCDP_CSV).incidents; // 700007 = 8. 3. pri Al-Katiba (31.51787, 34.43635)
  const { incidents, duplicates } = dedupIncidents([...gc, ...ucdp, gc[0]]);
  assert.equal(duplicates, 1);
  assert.ok(!incidents.some((x) => x.id === 'ucdp:700007'));
  assert.equal(incidents.find((x) => x.id === gc[0].id).ucdp, true);
  assert.equal(incidents.filter((x) => x.id === gc[0].id).length, 1);
  assert.ok(incidents.some((x) => x.id === 'ucdp:700001'), 'iný deň');
  assert.ok(Math.abs(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) - 111.19) < 0.1);
});

test('dejisko, vek, obdobia osi, kusy po 31 dňoch, počty zo súhrnu', () => {
  assert.equal(inRect({ lat: 31.4, lon: 34.4 }, [34.15, 31.2, 34.6, 31.65]), true);
  assert.equal(inRect({ lat: 33.4, lon: 35.5 }, [34.15, 31.2, 34.6, 31.65]), false);
  assert.equal(inRect({ lat: 31.9, lon: 34.4 }, [34.15, 31.2, 34.6, 31.65]), true, 'okraj +0,5°');
  assert.equal(inRect({ lat: 0, lon: 0 }, null), true);
  const now = Date.parse('2026-11-05T12:00:00Z');
  assert.equal(incidentAge(now - 3 * 86_400_000, now), 'fresh');
  assert.equal(incidentAge(now - 20 * 86_400_000, now), 'recent');
  assert.equal(incidentAge(now - 60 * 86_400_000, now), 'old');
  assert.deepEqual(incidentPeriodRange('7d', now), { from: '2026-10-30', to: '2026-11-05', days: 7 });
  assert.deepEqual(incidentPeriodRange('30d', now), { from: '2026-10-07', to: '2026-11-05', days: 30 });
  assert.deepEqual(incidentPeriodRange('all', now), { from: '2026-02-28', to: '2026-11-05', days: 251 });
  assert.deepEqual(incidentPeriodRange('30d', Date.parse('2026-03-05T00:00:00Z')).from, '2026-02-28', 'nikdy pred začiatkom archívu');
  const chunks = incidentChunks('2026-02-28', '2026-11-05');
  assert.equal(chunks.length, 9);
  assert.deepEqual(chunks[0], { from: '2026-10-06', to: '2026-11-05' });
  assert.equal(chunks.at(-1).from, '2026-02-28');
  assert.ok(chunks.every((c) => (Date.parse(c.to) - Date.parse(c.from)) / 86_400_000 + 1 <= 31));
  assert.deepEqual(incidentChunks('2026-11-05', '2026-11-01'), []);
  assert.equal(countInRange({ '2026-11-01': { total: 2 }, '2026-10-01': { total: 5 }, '2026-11-05': { total: 1 } }, '2026-10-30', '2026-11-05'), 3);
  assert.equal(geoconfirmedExportUrl('iran', '2026-02-28', '2026-11-05'), 'https://geoconfirmed.org/api/Map/export/Iran/csv?start=2026-02-28&end=2026-11-05');
  assert.equal(geoconfirmedMapUrl('yemen'), 'https://geoconfirmed.org/map/yemen');
});
