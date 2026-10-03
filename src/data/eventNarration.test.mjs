// src/data/eventNarration.test.mjs — komentár videa z dát (2026-10-03, vlastník: „sprav" k automatizácii;
// „čísla zle vyslovuje", „prvé 3–4 sekundy musia diváka chytiť", „vždy spomínaj môj portál"). Testy SPRÁVANIA:
// slovenské číslovky a hláskovanie, vety FZ1073 zo skutočných momentov sa zhodujú so schváleným ručným
// scenárom, háčik je prvý a portál s podpisom posledné, tempo sa z dĺžok nahrávok vypočíta tak, že každá
// veta začne pri svojom zábere; kontrola výslovnosti z prepisu pustí zvyklosti rozpoznávača, nie chyby.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spokenDegrees, spokenDomain, spokenFeet, spokenFlightNumber, spokenHour, spokenMinutes, spokenNumber } from './eventSpeech.js';
import { anchorTime, fitNarration, fixedLines, momentSentence, narrationHeardMatches, narrationLines, roundFeet } from './eventNarration.js';
import { normalizeVideoScript, quoteFoundIn, scriptSources, sourceLine } from './eventVideoScript.js';
import { videoPlan } from './eventVideo.js';
import { keyMoments } from './eventPost.js';
import { simplifyTrack } from './eventCard.js';
import { normalizeTrack } from './flightAnomalies.js';
import { fz1073, fz1073Event, fz1073ReportedEvent, reportedContext } from './fixtures/flightEventFixtures.mjs';

const utc = (s) => Date.parse(s) / 1000;
const NB = ' ';

async function fzEvent() {
  const e = await fz1073ReportedEvent(await fz1073Event());
  const { oko, adsblol } = fz1073();
  e.track = simplifyTrack(normalizeTrack([...oko, ...adsblol]));
  return e;
}
const SCRIPT = {
  hook: {
    tag: 'útok na palube', lines: ['Pilot pobodal kolegu', 'a pokúsil sa zrútiť lietadlo'], sub: 'Cestujúci ho zneškodnili', attributed: 'izraelského premiéra',
    spoken: ['Pilot pobodal kolegu a pokúsil sa zrútiť lietadlo s cestujúcimi, tvrdí izraelský premiér.', 'Podľa neho útočníka zneškodnili cestujúci a posádka a odvrátili katastrofu.'],
    sources: [
      { url: 'https://www.aljazeera.com/news/2026/9/30/x', quote: 'one of the pilots stabbed the other pilot, and apparently tried to crash the plane' },
      { url: 'https://www.arabnews.com/middle-east/x', quote: 'passengers and crew members on the flight managed to subdue the attacker' },
    ],
  },
  extras: [{ spoken: 'Cestujúcich odviezlo do Tel Avivu náhradné lietadlo.', sources: [{ url: 'https://www.arabnews.com/middle-east/x', quote: 'A flight to retrieve the passengers from Tabuk landed in Israel' }] }],
  lines: { m6: { spoken: 'Podľa správ núdzovo pristálo v saudskom Tabuku.' } },
};
/** Dĺžky nahrávok hlasu vlastníka z 2. 10. (ticho na začiatku, koniec reči). */
const DUR = { hook1: { lead: 0.203, speechEnd: 7.449 }, hook2: { lead: 0.144, speechEnd: 5.851 }, m0: { lead: 0.206, speechEnd: 7.727 }, m1: { lead: 0.161, speechEnd: 2.316 }, m1n0: { lead: 0.201, speechEnd: 4.555 }, m2: { lead: 0.161, speechEnd: 3.51 }, m4: { lead: 0.152, speechEnd: 2.324 }, m5: { lead: 0.178, speechEnd: 3.572 }, m6: { lead: 0.265, speechEnd: 3.876 }, extra1: { lead: 0.161, speechEnd: 4.229 }, portal: { lead: 0.212, speechEnd: 4.11 }, signoff: { lead: 0.161, speechEnd: 2.854 } };

test('slovenské číslovky a hláskovanie pre hlas: tisíce, stovky, kódy letov, doména, hodina', () => {
  assert.equal(spokenNumber(21), 'dvadsaťjeden');
  assert.equal(spokenNumber(206), 'dvesto šesť');
  assert.equal(spokenNumber(1073), 'tisíc sedemdesiattri');
  assert.equal(spokenNumber(17000), 'sedemnásťtisíc');
  assert.equal(spokenNumber(21000), 'dvadsaťjeden tisíc');
  assert.equal(spokenNumber(2300), 'dvetisíc tristo');
  assert.equal(spokenFeet(21000), 'dvadsaťjeden tisíc stôp');
  assert.equal(spokenFeet(1), 'jedna stopa');
  assert.equal(spokenMinutes(9), 'deväť minút');
  assert.equal(spokenMinutes(2), 'dve minúty');
  assert.equal(spokenDegrees(206), 'dvesto šesť stupňov');
  assert.equal(spokenDegrees(3), 'tri stupne');
  assert.equal(spokenFlightNumber('FZ1073'), 'ef zet tisíc sedemdesiattri');
  assert.equal(spokenFlightNumber('OK007'), 'ó ká nula nula sedem');
  assert.equal(spokenFlightNumber('RYR12AB'), 'er ypsilon er dvanásť á bé');
  assert.equal(spokenDomain('okolive.sk'), 'okolajv bodka es ká', 'slovník — overené rozpoznávaním reči');
  assert.equal(spokenDomain('example.eu'), 'example bodka é ú');
  assert.equal(spokenHour(utc('2026-09-30T05:22:00Z')).spoken, 'krátko po piatej hodine');
  assert.equal(spokenHour(utc('2026-09-30T05:45:00Z')).spoken, 'pred šiestou hodinou');
  assert.equal(spokenHour(utc('2026-09-30T23:40:00Z')).spoken, 'pred polnocou');
  assert.equal(roundFeet(15025), 15000);
  assert.equal(roundFeet(4579), 4600);
});

test('vety FZ1073 zo skutočných momentov = schválený ručný scenár; háčik prvý, portál a podpis posledné; náhrada vety vlastníkom', async () => {
  const e = await fzEvent();
  const { trusted } = await reportedContext();
  const script = normalizeVideoScript(SCRIPT, { trusted });
  const lines = narrationLines(e, script);
  assert.deepEqual(lines.map((l) => l.id), ['hook1', 'hook2', 'm0', 'm1', 'm1n0', 'm2', 'm4', 'm5', 'm6', 'extra1', 'portal', 'signoff']);
  const spoken = Object.fromEntries(lines.map((l) => [l.id, l.spoken]));
  assert.equal(spoken.hook1, SCRIPT.hook.spoken[0], 'háčik hneď na začiatku (pravidlo prvých sekúnd)');
  assert.equal(spoken.m0, 'Krátko po piatej hodine svetového času prudko klesá, vyše dvadsaťjeden tisíc stôp za minútu.');
  assert.equal(spoken.m1, 'Potom deväť minút bez údajov.');
  assert.equal(spoken.m1n0, 'Podľa správ kleslo za minútu pod sedemnásťtisíc stôp.', 'pokles zo správ bez mena konkurencie');
  assert.equal(spoken.m2, 'Kód núdze, potom kód nezákonného zásahu.', 'dva kódy v jednej vete');
  assert.equal(spoken.m4, 'Obrat o dvesto šesť stupňov.');
  assert.equal(spoken.m5, 'Údaje končia vo výške pätnásťtisíc stôp.');
  assert.equal(spoken.m6, 'Podľa správ núdzovo pristálo v saudskom Tabuku.', 'náhrada vety vlastníkom');
  assert.equal(lines.find((l) => l.id === 'm6').edited, true);
  assert.equal(spoken.extra1, 'Cestujúcich odviezlo do Tel Avivu náhradné lietadlo.');
  assert.equal(spoken.portal, 'Celú rekonštrukciu nájdete na okolajv bodka es ká.');
  assert.equal(spoken.signoff, 'Video pripravil Vladimír Uhrin.');
  const caption = Object.fromEntries(lines.map((l) => [l.id, l.caption]));
  assert.equal(caption.m0, `Krátko po piatej hodine svetového času prudko klesá, vyše 21${NB}000${NB}stôp za minútu.`, 'titulok číslicami');
  assert.equal(caption.m1n0, `Podľa správ kleslo za minútu pod 17${NB}000${NB}stôp.`);
  assert.equal(caption.m5, `Údaje končia vo výške 15${NB}000${NB}stôp.`);
  assert.equal(caption.portal, 'Celú rekonštrukciu nájdete na okolive.sk.');
  assert.ok(lines.filter((l) => l.approved).every((l) => l.kind === 'fixed'), 'bez kontroly výslovnosti len pevné vety');
  assert.ok(!JSON.stringify(lines).match(/flight\s*radar/i), 'konkurencia nikde');
  // Bez scenára: veta o lete namiesto háčika, bez doplnkov; generická veta o pristátí (apozícia, bez skloňovania).
  const plain = narrationLines(e, null);
  assert.equal(plain[0].spoken, 'Let ef zet tisíc sedemdesiattri na trase Dubai – Tel Aviv.');
  assert.equal(plain.find((l) => l.id === 'm6').spoken, 'Podľa správ núdzovo pristálo na letisku Tabuk.');
  assert.ok(!plain.some((l) => l.kind === 'extra'));
  // Jednotlivé druhy momentov.
  assert.equal(momentSentence({ kind: 'squawk', meaning: 'radio' }).spoken, 'Transpondér hlási kód straty spojenia.');
  assert.equal(momentSentence({ kind: 'last-contact', airborne: false }).spoken, 'Posledný záznam je na zemi.');
  assert.equal(momentSentence({ kind: 'gap', s: 60 }).caption, 'Potom 1 minúta bez údajov.');
  assert.equal(momentSentence({ kind: 'cruise' }), null);
});

test('scenár vlastníka: zdroj (dôveryhodné médium + citát) je povinný, konkurencia sa odmietne, riadok zdroja na kartu; citát sa hľadá doslova', async () => {
  const { trusted } = await reportedContext();
  const script = normalizeVideoScript(SCRIPT, { trusted });
  assert.equal(script.hook.tag, 'ÚTOK NA PALUBE');
  assert.equal(script.hook.source, 'podľa izraelského premiéra · Al Jazeera, Arab News');
  assert.equal(sourceLine({ attributed: null, sources: [{ domain: 'reuters.com' }] }), 'podľa správ · Reuters');
  assert.equal(scriptSources(script).length, 3);
  assert.equal(normalizeVideoScript(null, { trusted }), null);
  const codeOf = (input) => { try { normalizeVideoScript(input, { trusted }); return null; } catch (e) { return e.code === 'BAD_SCRIPT' ? e.why : e.message; } };
  assert.match(codeOf({ hook: { ...SCRIPT.hook, sources: [] } }), /zdroje/);
  assert.match(codeOf({ hook: { ...SCRIPT.hook, sources: [{ url: 'https://blog.example.com/a', quote: 'one of the pilots stabbed the other pilot' }] } }), /dôveryhodných/);
  assert.match(codeOf({ hook: { ...SCRIPT.hook, sources: [{ url: 'http://www.aljazeera.com/a', quote: 'one of the pilots stabbed the other pilot' }] } }), /https/);
  assert.match(codeOf({ hook: { ...SCRIPT.hook, sources: [{ url: 'https://www.aljazeera.com/a', quote: 'krátke' }] } }), /citát/);
  assert.match(codeOf({ extras: [{ spoken: 'Podľa Flightradar24 kleslo.', sources: SCRIPT.extras[0].sources }] }), /konkurenčná/);
  assert.match(codeOf({ hook: { ...SCRIPT.hook, lines: ['x'.repeat(40)] } }), /riadky/);
  assert.match(codeOf({ extras: [{ spoken: '', sources: SCRIPT.extras[0].sources }] }), /veta hlasu/);
  const page = '<p>Netanyahu said: “one of the pilots stabbed the other pilot, and apparently tried to crash the plane with everyone on board,” he said.</p>';
  assert.equal(quoteFoundIn(page, 'one of the pilots stabbed the other pilot, and apparently tried to crash the plane'), true, 'úvodzovky a HTML neprekážajú');
  assert.equal(quoteFoundIn(page, 'one of the pilots stabbed the co-pilot'), false);
});

test('tempo z dĺžok nahrávok: každá veta začne najviac 0,35 s po svojom zábere, posledná skončí pred koncom; bez háčika a doplnkov tiež', async () => {
  const e = await fzEvent();
  const { trusted } = await reportedContext();
  const lines = narrationLines(e, normalizeVideoScript(SCRIPT, { trusted }));
  const fit = fitNarration(e, lines, DUR);
  assert.equal(fit.converged, true);
  assert.ok(fit.maxLag <= 0.35, `oneskorenie ${fit.maxLag}`);
  assert.ok(fit.durationS > 60 && fit.durationS < 75, `dĺžka ${fit.durationS}`);
  const by = Object.fromEntries(fit.placement.map((p) => [p.id, p]));
  assert.ok(by.hook1.speechStart < 0.5, 'háčik od prvej polsekundy');
  assert.ok(by.hook2.speechStart > by.hook1.speechEnd && by.m0.speechStart > by.hook2.speechEnd, 'vety po sebe, neprekrývajú sa');
  const plan = videoPlan(e, fit.planOpts);
  const ms = keyMoments(e);
  const dive = plan.pieces.find((p) => p.phase === 'moment' && ms[p.moment].kind === 'dive');
  assert.ok(by.m0.speechStart <= anchorTime({ spotlightBefore: 0 }, plan, ms) + 0.35 && by.m0.speechEnd <= dive.start + dive.dur + 8, 'veta o klesaní znie počas spomaleného pádu');
  assert.ok(by.portal.anchor >= plan.pieces.find((p) => p.phase === 'endcard').start, 'portál na koncovej karte');
  assert.ok(by.signoff.speechEnd <= fit.durationS - 0.6, 'podpis skončí pred koncom');
  assert.ok(fit.planOpts.openingS >= 7, 'otvorenie natiahnuté pre háčik');
  // Bez scenára a s kratšími vetami sa tempo nenafúkne zbytočne.
  const plainLines = narrationLines(e, null);
  const plainDur = Object.fromEntries(plainLines.map((l) => [l.id, DUR[l.id] || { lead: 0.2, speechEnd: 3.0 }]));
  const plainFit = fitNarration(e, plainLines, plainDur);
  assert.equal(plainFit.converged, true);
  assert.ok(plainFit.durationS < fit.durationS, 'kratší komentár = kratšie video');
});

test('kontrola výslovnosti z prepisu: zvyklosti rozpoznávača prejdú (čísla, „LED", spojené slová, 5.), iné písmeno nie', () => {
  const ok = (c, h) => narrationHeardMatches(c, h).ok;
  assert.equal(ok('Krátko po piatej hodine svetového času prudko klesá, vyše 21 000 stôp za minútu.', 'Krátko po 5. hodine svetového času prudko klesá vyše 21 tisíc stôp za minútu.'), true);
  assert.equal(ok('Let FZ1073 z Dubaja do Tel Avivu.', 'LED FZ 1073 z Dubaja do Tel Avivu.'), true);
  assert.equal(ok('Obrat o 206 stupňov.', 'Obrato 206°C'), true);
  assert.equal(ok('Údaje končia vo výške 15 000 stôp.', 'Udaje končia vo výške 15 tisíc stôp.'), true);
  assert.equal(ok('Podľa správ kleslo za minútu pod 17 000 stôp.', 'Podľa Flightradaru 24 kleslo za minútu pod 17 tisíc stôp.'), false, 'iný text');
  assert.equal(ok('Podľa neho útočníka zneškodnili cestujúci a posádka a zabránili katastrofe.', 'Podľa neho útočníka zneškodnili cestujúci a posádka a zabránili katastrofé.'), false, 'zle vyslovená koncovka');
  assert.equal(ok('Celú rekonštrukciu nájdete na okolive.sk.', 'Celú rekonštrukciu nájdete na okolaiv.sk'), false);
  assert.deepEqual(narrationHeardMatches('Potom 9 minút bez údajov.', 'Potom 9 minút bez údajov.'), { ok: true, missing: [], extra: [] });
  assert.equal(fixedLines().every((l) => l.approved), true);
});
