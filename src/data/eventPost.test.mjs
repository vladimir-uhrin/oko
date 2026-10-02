// src/data/eventPost.test.mjs — titulok a text príspevku udalosti (Udalosti, etapa 2, 2026-09-30).
// Testy SPRÁVANIA na udalosti FZ1073 zo skutočných stôp: fakty s časom UTC, čo videla len jedna
// sieť je označené, médiá menom a odkazom, typ len pri zhode médií, žiadne dávne diery ani cestovná
// výška; bez overenia správami žiadna veta o médiách.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  eventHeadline, eventShareHash, eventShareMeta, facebookShareUrl, flightLabel, flightLine, keyMoments, networksLead, outletName,
  postText, publicEventView,
} from './eventPost.js';
import { simplifyTrack } from './eventCard.js';
import { normalizeTrack } from './flightAnomalies.js';
import { fz1073, fz1073Event } from './fixtures/flightEventFixtures.mjs';

test('titulok: typ podľa zhody médií, inak podľa dát; let s aerolinkou a trasou', async () => {
  const e = await fz1073Event();
  assert.equal(flightLabel(e), 'FZ1073 (Fly Dubai) Dubai → Tel Aviv');
  assert.equal(eventHeadline(e), 'Nezákonný zásah na palube (únos): let FZ1073 (Fly Dubai) Dubai → Tel Aviv');
  assert.equal(eventHeadline({ ...e, news: { status: 'reported', type: null } }), 'Núdzový kód 7700: let FZ1073 (Fly Dubai) Dubai → Tel Aviv', 'bez zhody médií prvý núdzový kód z dát');
  assert.equal(eventHeadline({ ...e, route: null, news: null, triggers: e.triggers.filter((t) => t.kind === 'dive') }), 'Strmhlavé klesanie: let FDB1073');
  assert.equal(outletName('jta.org'), 'JTA');
  assert.equal(outletName('neznamy.example'), 'neznamy.example');
});

test('text príspevku: momenty udalosti s časom UTC, označené čo videla len jedna sieť, médiá a odkazy, zdroje údajov', async () => {
  const e = await fz1073Event();
  const kinds = keyMoments(e).map((m) => m.kind);
  assert.deepEqual(kinds, ['dive', 'gap', 'squawk', 'squawk', 'uturn', 'last-contact'], 'bez štartu, cestovnej výšky a dávnej diery nad Perzským zálivom');
  const text = postText(e, { url: 'https://okolive.sk/s/abc123XYZ0' });
  const lines = text.split('\n');
  assert.equal(lines[0], 'Nezákonný zásah na palube (únos): let FZ1073 (Fly Dubai) Dubai → Tel Aviv, 30. 9. 2026');
  assert.ok(lines.includes('• 05:31 — transpondér vysiela 7700 (núdza) (len sieť adsb.lol)'), text);
  assert.ok(lines.includes('• 05:36 — transpondér vysiela 7500 (nezákonný zásah) (len sieť adsb.lol)'));
  assert.ok(lines.some((l) => /^• 05:2\d — strmhlavé klesanie \d{1,2} \d{3} ft\/min/.test(l) && !l.includes('len sieť')), 'klesanie videli obe siete');
  assert.ok(lines.includes('Médiá (JTA, The Jerusalem Post, The Guardian, Arab News) informujú o pokuse o únos lietadla.'));
  assert.equal(lines.filter((l) => l.startsWith('https://')).length, 3, 'najviac 3 odkazy na správy');
  assert.ok(lines.includes('Rekonštrukcia letu na mape: https://okolive.sk/s/abc123XYZ0'));
  assert.equal(lines.at(-1), 'Údaje: OpenSky Network, adsb.lol (ODbL), plán letu adsbdb · okolive.sk', 'trasa letu je z adsbdb — uvedené');
  assert.equal(postText({ ...e, route: null }).split('\n').at(-1), 'Údaje: OpenSky Network, adsb.lol (ODbL) · okolive.sk');
  const draft = postText({ ...e, news: { status: 'reported', trusted: [{ domain: 'jta.org', url: 'https://x' }] } });
  assert.ok(!draft.includes('Médiá'), 'bez overenia správami žiadna veta o médiách');
  assert.ok(!draft.includes('Rekonštrukcia'), 'bez odkazu na OKO bez riadku odkazu');
});

test('pravdivý úvod: „dve nezávislé siete" len keď obe majú údaje a udalosť je potvrdená (naživo FZ1073 pred denným archívom: len OpenSky)', async () => {
  const e = await fz1073Event();
  assert.equal(postText(e).split('\n')[2], 'Čo zachytili dve nezávislé siete prijímačov (OpenSky, adsb.lol), časy UTC:');
  const onlyOpenSky = { ...e, status: 'unverified', coverage: e.coverage.map((c) => (c.id === 'adsblol' ? { ...c, points: 0, fromT: null, toT: null } : c)) };
  assert.equal(networksLead(onlyOpenSky), 'Čo zachytila sieť prijímačov OpenSky (druhá sieť to zatiaľ nepotvrdila), časy UTC:');
  assert.ok(!postText(onlyOpenSky).includes('dve nezávislé siete'));
  assert.equal(networksLead({ ...e, status: 'unverified' }), 'Čo zachytili siete prijímačov (OpenSky, adsb.lol) — zatiaľ bez overenia druhou sieťou, časy UTC:');
  assert.deepEqual(publicEventView(onlyOpenSky).networks, ['OpenSky']);
});

test('verejný pohľad: SK aj EN texty, momenty so súradnicami, médiá menom a len http(s) odkazom, bez interných polí; odkaz nad udalosťou; popis pre FB', async () => {
  const e = await fz1073Event();
  const { oko, adsblol } = fz1073();
  e.track = simplifyTrack(normalizeTrack([...oko, ...adsblol]));
  e.window = { fromT: e.firstT - 7200, toT: e.lastT + 3600 };
  e.news = { ...e.news, query: 'tajný dopyt', trusted: [...e.news.trusted, { domain: 'bbc.com', url: 'javascript:alert(1)', title: 'x' }] };
  e.secondNetwork = [{ url: 'https://adsb.lol/…', status: 200 }];
  const v = publicEventView(e);
  assert.equal(v.headline.sk, 'Nezákonný zásah na palube (únos): let FZ1073 (Fly Dubai) Dubai → Tel Aviv');
  assert.equal(v.headline.en, 'Unlawful interference on board (hijacking): flight FZ1073 (Fly Dubai) Dubai → Tel Aviv');
  assert.equal(v.flightLine.en, 'Flight FZ1073 · Fly Dubai · Dubai → Tel Aviv');
  assert.equal(flightLine(e), 'Let FZ1073 · Fly Dubai · Dubai → Tel Aviv');
  assert.equal(v.moments.length, 6);
  assert.ok(v.moments.every((m) => Number.isFinite(m.lat) && Number.isFinite(m.lon) && m.text.sk && m.text.en));
  assert.equal(v.moments.find((m) => m.kind === 'squawk').text.en, 'transponder squawks 7700 (emergency)');
  assert.deepEqual(v.news.sources.map((s) => s.name), ['JTA', 'The Jerusalem Post', 'The Guardian', 'Arab News'], 'odkaz javascript: vypadne');
  assert.equal(v.publishable, true);
  assert.equal(v.published, null);
  const json = JSON.stringify(v);
  for (const secret of ['tajný dopyt', 'secondNetwork', 'adsb.lol/…', 'typeDomains']) assert.ok(!json.includes(secret), secret);
  const hash = new URLSearchParams(eventShareHash(e));
  assert.equal(hash.get('event'), '8965d1-20260930T0521');
  assert.equal(hash.get('pitch'), '-90');
  const lat = Number(hash.get('lat'));
  const lon = Number(hash.get('lon'));
  assert.ok(lat > 26 && lat < 31 && lon > 36 && lon < 42, `záber nad miestom udalosti (Saudská Arábia), nie nad Dubajom: ${lat}, ${lon}`);
  assert.ok(Number(hash.get('alt')) >= 250_000 && Number(hash.get('alt')) <= 4_000_000);
  assert.equal(eventShareHash({ ...e, track: [], timeline: [] }), null, 'bez polohy žiadny odkaz');
  const meta = eventShareMeta(e);
  assert.equal(meta.title, 'Nezákonný zásah na palube (únos): let FZ1073 (Fly Dubai) Dubai → Tel Aviv, 30. 9. 2026');
  assert.equal(meta.description, 'Overené dvoma nezávislými sieťami prijímačov (OpenSky, adsb.lol) a médiami (JTA, The Jerusalem Post, The Guardian, Arab News). Rekonštrukcia letu na mape OKO.');
  assert.equal(facebookShareUrl('https://okolive.sk/s/Ab12cd34EF'), 'https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fokolive.sk%2Fs%2FAb12cd34EF');
});

test('doplnené zo správ (FZ1073): pristátie v Tabuku ako posledný moment „podľa správ" s médiami, pokles podľa Flightradar24 pri diere; dáta sietí sa nemenia', async () => {
  const { fz1073ReportedEvent } = await import('./fixtures/flightEventFixtures.mjs');
  const plain = await fz1073Event();
  const e = await fz1073ReportedEvent(plain);
  const ms = keyMoments(e);
  assert.deepEqual(ms.map((m) => m.kind), ['dive', 'gap', 'squawk', 'squawk', 'uturn', 'last-contact', 'reported-landing'], 'pristátie zo správ až po konci údajov');
  const landing = ms.at(-1);
  assert.deepEqual(landing.seenBy, [], 'pristátie žiadna sieť nevidela');
  const gap = ms.find((m) => m.kind === 'gap');
  assert.equal(gap.reportedNotes.length, 1, 'pokles 05:21–05:22 pri diere');
  // Momenty z dát sú tie isté ako bez správ (nič sa nedopočítalo).
  assert.deepEqual(ms.slice(0, 6).map(({ reportedNotes, ...m }) => m), keyMoments(plain));
  const lines = postText(e).split('\n');
  assert.ok(lines.includes('• 06:45 — núdzové pristátie na letisku Tabuk (TUU) — podľa správ (Arab News, Al Jazeera)'), lines.join('\n'));
  assert.ok(lines.some((l) => l.startsWith('• 05:22 — 9 min bez údajov — podľa správ pod 17 000 ft už o 05:22 (Al Jazeera, Arab News)')), lines.join('\n'));
  // Konkurencia sa nikde nemenuje (vlastník 10-02: „vždy spomínaj môj portál").
  assert.ok(!/flight\s*radar/i.test(postText(e)) && !/flight\s*radar/i.test(JSON.stringify(publicEventView(e))), 'Flightradar24 ani v texte, ani na verejnej karte');
  assert.equal(lines.filter((l) => l.startsWith('https://')).length, 3, 'stále najviac 3 odkazy');
  const honest = 'Údaje „podľa správ" siete prijímačov nezachytili — uvádzajú ich médiá pri každom bode.';
  assert.equal(lines[lines.indexOf('• 06:45 — núdzové pristátie na letisku Tabuk (TUU) — podľa správ (Arab News, Al Jazeera)') + 1], honest, 'hneď za zoznamom');
  assert.ok(!postText(plain).includes(honest), 'bez správ táto veta nie je');
  // Pristátie, ktoré videli dáta, má prednosť pred správou.
  const landed = { ...e, timeline: [...e.timeline.filter((m) => m.kind !== 'last-contact'), { kind: 'landing', t: e.lastT + 3000, lat: 28.37, lon: 36.62, seenBy: ['opensky'] }] };
  assert.ok(!keyMoments(landed).some((m) => m.kind === 'reported-landing'));
  // Verejný pohľad: moment zo správ označený, médiá s odkazmi; EN text.
  const v = publicEventView(e);
  const vl = v.moments.at(-1);
  assert.equal(vl.reported, true);
  assert.equal(vl.text.en, 'emergency landing at Tabuk (TUU) — per reports');
  assert.deepEqual(vl.media.map((s) => s.name), ['Arab News', 'Al Jazeera']);
  assert.ok(vl.media.every((s) => s.url.startsWith('https://')));
  assert.equal(v.moments.find((m) => m.kind === 'dive').reported, false);
  assert.ok(v.moments.find((m) => m.kind === 'gap').text.sk.includes('podľa správ pod 17 000 ft už o 05:22'));
  // Záber odkazu zahrnie aj letisko pristátia.
  const hash = new URLSearchParams(eventShareHash(e));
  assert.ok(Number(hash.get('lat')) < 30.2, 'stred záberu posunutý k Tabuku');
});
