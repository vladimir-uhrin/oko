// src/data/eventReported.test.mjs — chýbajúce údaje udalosti zo správ (2026-10-01, vlastník: „vydolovať
// chýbajúce dáta", „len overené, nie fake"). Testy SPRÁVANIA: fakty FZ1073 s presnými citátmi z Arab News
// a Al Jazeera sa prijmú (letisko Tabuk z OurAirports, dve médiá = potvrdené), čokoľvek neoverené sa
// odmietne CELÉ (cudzí web, http, bez citátu, neznáme letisko, pristátie bez zdroja času, čas mimo
// udalosti, pokles nahor) — a fakt nikdy nevytvorí trasu: pristátie je bod na letisku, pokles poznámka.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORTED_LIMITS, descentCore, descentNote, landingPhrase, normalizeReportedFacts, reportedFacts, reportedForGap, reportedLandingMoments,
} from './eventReported.js';
import { FZ1073_REPORTED_INPUT, fz1073Event, fz1073ReportedEvent, reportedContext } from './fixtures/flightEventFixtures.mjs';

const clone = (v) => JSON.parse(JSON.stringify(v));
const utc = (s) => Date.parse(s) / 1000;

test('FZ1073: pristátie v Tabuku a pokles podľa Flightradar24 z dvoch médií sa prijmú s citátmi a polohou letiska', async () => {
  const event = await fz1073Event();
  const ctx = await reportedContext();
  const r = normalizeReportedFacts(FZ1073_REPORTED_INPUT, { event, ...ctx });
  assert.equal(r.error, null);
  assert.equal(r.facts.length, 2);
  const [descent, landing] = r.facts; // zoradené podľa času
  assert.equal(descent.kind, 'descent');
  assert.equal(landing.kind, 'landing');
  // Pristátie: 9:45 miestneho času = 06:45 UTC, letisko z OurAirports (nie zo vstupu).
  assert.equal(landing.t, utc('2026-09-30T06:45:00Z'));
  assert.equal(landing.airport.icao, 'OETB');
  assert.equal(landing.airport.iata, 'TUU');
  assert.ok(Math.abs(landing.airport.lat - 28.37) < 0.05 && Math.abs(landing.airport.lon - 36.62) < 0.05, 'poloha letiska Tabuk');
  assert.deepEqual(landing.domains.sort(), ['aljazeera.com', 'arabnews.com']);
  assert.equal(landing.status, 'confirmed', 'dve rôzne médiá = potvrdené');
  assert.deepEqual(landing.timeDomains, ['arabnews.com'], 'čas uvádza len Arab News (podľa letiska Tabuk)');
  // Každý zdroj nesie presný citát a odkaz.
  for (const f of r.facts) for (const s of f.sources) {
    assert.match(s.url, /^https:\/\//);
    assert.ok(s.quote.length >= REPORTED_LIMITS.quoteMin);
  }
  assert.ok(landing.sources.some((s) => s.quote.includes('9:45 a.m. local time')));
  // Pokles: z takmer 34 000 pod 17 000 ft medzi 05:21 a 05:22.
  assert.equal(descent.fromT, utc('2026-09-30T05:21:00Z'));
  assert.equal(descent.t, utc('2026-09-30T05:22:00Z'));
  assert.equal(descent.toFt, 17000);
  assert.equal(descent.toBelow, true);
  assert.equal(descent.status, 'confirmed');
});

test('odmietne sa celý vstup pri čomkoľvek neoverenom — nič sa neuloží napoly', async () => {
  const event = await fz1073Event();
  const ctx = await reportedContext();
  const bad = (mutate) => {
    const input = clone(FZ1073_REPORTED_INPUT);
    mutate(input);
    return normalizeReportedFacts(input, { event, ...ctx });
  };
  const cases = [
    ['untrusted_source', (i) => { i.facts[0].sources[1].url = 'https://www.example-blog.com/fz1073'; }],
    ['bad_source_url', (i) => { i.facts[0].sources[0].url = 'http://www.arabnews.com/x'; }],
    ['bad_quote', (i) => { i.facts[1].sources[0].quote = 'krátke'; }],
    ['bad_quote', (i) => { i.facts[1].sources[0].quote = 'x'.repeat(REPORTED_LIMITS.quoteMax + 1); }],
    ['no_sources', (i) => { i.facts[0].sources = []; }],
    ['unknown_airport', (i) => { i.facts[0].airport = 'ZZZZ'; }],
    ['no_time_source', (i) => { for (const s of i.facts[0].sources) delete s.time; }],
    ['bad_time', (i) => { i.facts[0].t = '2026-10-05T06:45:00Z'; }],
    ['bad_time', (i) => { i.facts[0].t = '2026-09-30 06:45'; }], // bez pásma sa čas nehádže
    ['bad_time', (i) => { i.facts[1].fromT = '2026-09-30T05:23:00Z'; }],
    ['bad_altitude', (i) => { i.facts[1].toFt = 36000; }],
    ['bad_kind', (i) => { i.facts[0].kind = 'route'; }],
  ];
  for (const [error, mutate] of cases) {
    const r = bad(mutate);
    assert.equal(r.error, error, `${error}: ${mutate}`);
    assert.equal(r.facts, null, 'pri chybe žiadne fakty');
  }
  const many = { facts: Array.from({ length: REPORTED_LIMITS.facts + 1 }, () => clone(FZ1073_REPORTED_INPUT.facts[0])) };
  assert.equal(normalizeReportedFacts(many, { event, ...ctx }).error, 'too_many_facts');
  assert.equal(normalizeReportedFacts({}, { event, ...ctx }).error, 'no_facts');
});

test('jedno médium = „single" (pri texte vždy jeho meno), to isté médium dvakrát sa ráta raz', async () => {
  const event = await fz1073Event();
  const ctx = await reportedContext();
  const input = clone(FZ1073_REPORTED_INPUT);
  input.facts = [input.facts[0]];
  input.facts[0].sources = [input.facts[0].sources[0], { ...input.facts[0].sources[0], url: 'https://www.arabnews.com/node/3003843' }];
  const r = normalizeReportedFacts(input, { event, ...ctx });
  assert.equal(r.error, null);
  assert.deepEqual(r.facts[0].domains, ['arabnews.com']);
  assert.equal(r.facts[0].status, 'single');
});

test('pristátie zo správ je bod na letisku (nie trasa), pokles patrí k diere, v ktorej leží', async () => {
  const event = await fz1073ReportedEvent();
  const landed = reportedLandingMoments(event);
  assert.equal(landed.length, 1);
  assert.equal(landed[0].kind, 'reported-landing');
  assert.deepEqual(landed[0].seenBy, [], 'žiadna sieť ho nevidela');
  assert.equal(landed[0].alt, null, 'výška nenameraná');
  assert.ok(Math.abs(landed[0].lat - 28.37) < 0.05, 'na letisku Tabuk');
  const gap = event.timeline.find((m) => m.kind === 'gap' && m.t > utc('2026-09-30T05:20:00Z'));
  assert.ok(gap, 'diera po páde');
  assert.equal(reportedForGap(event, gap).length, 1, 'pokles 05:21–05:22 patrí k diere od 05:22');
  const early = event.timeline.find((m) => m.kind === 'gap' && m.t < utc('2026-09-30T05:00:00Z'));
  if (early) assert.equal(reportedForGap(event, early).length, 0, 'k diere nad Saudskou Arábiou o hodinu skôr nie');
  // Zle uložené fakty sa preskočia.
  assert.equal(reportedFacts({ reported: [{ kind: 'landing', t: 1, domains: [] }, null, { kind: 'route' }] }).length, 0);
});

test('texty: pristátie a pokles po slovensky aj anglicky, s menami médií a tým, kto meral', async () => {
  const event = await fz1073ReportedEvent();
  const [descent, landing] = event.reported;
  assert.equal(landingPhrase(landing, 'sk'), 'núdzové pristátie na letisku Tabuk (TUU)');
  assert.equal(landingPhrase(landing, 'en'), 'emergency landing at Tabuk (TUU)');
  assert.equal(descentCore(descent, 'sk'), 'pod 17 000 ft už o 05:22');
  assert.equal(descentCore(descent, 'en'), 'below 17,000 ft by 05:22');
  assert.equal(descentNote(descent, 'sk'), 'podľa správ pod 17 000 ft už o 05:22 (údaje Flightradar24)');
  assert.equal(descentNote(descent, 'sk', 'Al Jazeera, Arab News'), 'podľa správ pod 17 000 ft už o 05:22 (údaje Flightradar24 podľa Al Jazeera, Arab News)');
  assert.equal(descentNote(descent, 'en'), 'per reports below 17,000 ft by 05:22 (Flightradar24 data)');
});
