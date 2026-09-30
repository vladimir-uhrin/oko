// src/data/eventNews.test.mjs — overenie udalosti správami (Udalosti, etapa 2, 2026-09-30, vlastník:
// „potrebujem len overené, nie fake!"). Testy SPRÁVANIA: overené až pri 2 rôznych dôveryhodných
// médiách, článok musí patriť k TOMUTO letu (číslo letu alebo aerolinka + mesto/štát trasy), typ
// udalosti len pri zhode 2 médií a titulky o falošných správach sa do typu nerátajú. Titulky sú
// preformulované podľa skutočného pokrytia FZ1073 (30. 9.), nie kópie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEWS_MIN_TRUSTED, flightIdentity, matchesFlight, newsQuery, newsUrl, newsVerdict, parseTrustedList, trustedDomainOf } from './eventNews.js';
import { FDB1073_ROUTE } from './fixtures/flightEventFixtures.mjs';

const TRUSTED = parseTrustedList({ domains: ['jpost.com', 'jta.org', 'theguardian.com', 'arabnews.com', 'reuters.com', 'WWW.bbc.co.uk', 'nie domena'] });
const at = (iso) => Date.parse(iso);
const A = (source, iso, title, url = `https://${source}/a/${encodeURIComponent(title).slice(0, 40)}`) => ({ source, publishedAt: at(iso), title, url });

test('zoznam médií a doména: malé písmená, bez www, subdomény áno, neplatné riadky preč', () => {
  assert.deepEqual(TRUSTED, ['jpost.com', 'jta.org', 'theguardian.com', 'arabnews.com', 'reuters.com', 'bbc.co.uk']);
  assert.equal(trustedDomainOf('www.jpost.com', TRUSTED), 'jpost.com');
  assert.equal(trustedDomainOf('news.bbc.co.uk', TRUSTED), 'bbc.co.uk');
  assert.equal(trustedDomainOf('notjpost.com', TRUSTED), null, 'len celá doména, nie koniec reťazca');
});

test('identita letu z adsbdb a dopyt: aerolinka aj bez medzier („Fly Dubai" / flydubai), číslo letu, slová incidentu, pevné okno', () => {
  const id = flightIdentity('FDB1073', FDB1073_ROUTE);
  assert.deepEqual([id.airline, id.flightIata, id.flightNumber, id.origin.city, id.destination.city, id.destination.country],
    ['Fly Dubai', 'FZ1073', '1073', 'Dubai', 'Tel Aviv', 'Israel']);
  assert.equal(flightIdentity('XYZ1', { airline: null }), null, 'bez aerolinky sa správy nedajú priradiť');
  const q = newsQuery(id);
  assert.match(q, /^\("Fly Dubai" OR FlyDubai OR FZ1073\) \(hijack OR .*"shot down".*\)$/);
  const url = new URL(newsUrl(q, { fromMs: at('2026-09-30T04:22:00Z'), toMs: at('2026-10-02T05:22:00Z') }));
  assert.equal(url.searchParams.get('startdatetime'), '20260930042200');
  assert.equal(url.searchParams.get('enddatetime'), '20261002052200');
  assert.equal(url.searchParams.get('sort'), 'dateasc');
});

test('článok k TOMUTO letu: číslo letu alebo aerolinka s mestom či štátom trasy; iná aerolinka alebo iná trasa nie', () => {
  const id = flightIdentity('FDB1073', FDB1073_ROUTE);
  assert.equal(matchesFlight({ title: 'How flight 1073 got through a 17,000ft plunge' }, id), true);
  assert.equal(matchesFlight({ title: 'FZ 1073 diverted' }, id), true);
  assert.equal(matchesFlight({ title: 'FlyDubai halts Tel Aviv service during investigation' }, id), true);
  assert.equal(matchesFlight({ title: 'Israeli passenger on flydubai jet praises crew' }, id), true, 'štát cieľa (Israeli)');
  assert.equal(matchesFlight({ title: 'Flydubai opens new route to Almaty' }, id), false, 'iná trasa');
  assert.equal(matchesFlight({ title: 'Emirates flight from Dubai diverted' }, id), false, 'iná aerolinka');
});

test('verdikt: 4 dôveryhodné médiá → OVERENÉ, typ únos (zhoda 2 médií), bulvár a neznáme weby sa nerátajú, falošná správa nie je hlas', () => {
  const id = flightIdentity('FDB1073', FDB1073_ROUTE);
  const window = { fromMs: at('2026-09-30T04:22:00Z'), toMs: at('2026-10-01T12:00:00Z') };
  const articles = [
    A('news.az', '2026-09-30T07:45:00Z', 'Israel scrambles jets after hijacking alert on Dubai-Tel Aviv flight'),
    A('jta.org', '2026-09-30T18:00:00Z', 'Passengers from the attempted flydubai hijacking are back in Israel'),
    A('jpost.com', '2026-09-30T19:30:00Z', 'Why two extra pilots were aboard during the attempted flydubai hijacking in Israel-bound jet'),
    A('jpost.com', '2026-09-30T19:30:00Z', 'Hoaxer fools TV with fake flydubai hijacking claim about Tel Aviv flight'),
    A('theguardian.com', '2026-09-30T19:30:00Z', 'How flight 1073 survived its 17,000ft plunge'),
    A('arabnews.com', '2026-09-30T20:30:00Z', 'Israeli FlyDubai passenger thanks Saudi Arabia after emergency landing'),
    A('mirror.co.uk', '2026-09-30T08:00:00Z', 'Terror on flydubai jet to Tel Aviv'),
    A('reuters.com', '2026-09-29T10:00:00Z', 'Flydubai adds flights to Tel Aviv', undefined),
  ];
  const v = newsVerdict(articles, id, TRUSTED, window);
  assert.equal(v.status, 'verified');
  assert.deepEqual(v.trusted.map((t) => t.domain), ['jta.org', 'jpost.com', 'theguardian.com', 'arabnews.com'], 'najskorší článok každého média, mimo okna (reuters deň predtým) nie');
  assert.equal(v.otherCount, 1, 'bulvár sa neráta; news.az nemá v titulku aerolinku ani číslo letu — k letu nepriradený');
  assert.equal(v.type, 'hijack');
  assert.deepEqual(v.typeDomains.sort(), ['jpost.com', 'jta.org']);
  assert.equal(v.firstT, at('2026-09-30T18:00:00Z') / 1000);
  // Jedno dôveryhodné médium = len „hlásené"; typ bez zhody dvoch médií nie je.
  const one = newsVerdict(articles.filter((a) => a.source !== 'jpost.com' && a.source !== 'theguardian.com' && a.source !== 'arabnews.com'), id, TRUSTED, window);
  assert.deepEqual([one.status, one.type], ['reported', null]);
  assert.equal(one.trusted.length, NEWS_MIN_TRUSTED - 1);
  // Falošná správa z jpost nie je hlas za únos: jta + falošná jpost = typ z inej zhody.
  const hoax = newsVerdict(articles.filter((a) => !(a.source === 'jpost.com' && /extra pilots/.test(a.title))), id, TRUSTED, window);
  assert.notEqual(hoax.type, 'hijack', 'únos nepotvrdený dvoma médiami (falošná správa sa nepočíta)');
  assert.equal(hoax.type, 'emergency', 'núdza: The Guardian + Arab News');
  assert.equal(newsVerdict([], id, TRUSTED, window).status, 'none');
});
