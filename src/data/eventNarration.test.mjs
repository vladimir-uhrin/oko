// src/data/eventNarration.test.mjs — komentár videa z dát (2026-10-03, vlastník: „sprav" k automatizácii;
// „čísla zle vyslovuje", „prvé 3–4 sekundy musia diváka chytiť", „vždy spomínaj môj portál"; k prvému videu
// zo služby: „viac informácií, dramatickejší text, moje meno nespomínaj"). Testy SPRÁVANIA: slovenské
// číslovky a hláskovanie, vety FZ1073 zo skutočných momentov (dramatické, len z údajov), veta kontextu
// (čas letu, km do cieľa, výška), doplnky zo správ pripnuté k momentom, háčik prvý a portál posledný —
// meno autora sa nehovorí; tempo sa z dĺžok nahrávok vypočíta tak, že každá veta začne pri svojom zábere;
// kontrola výslovnosti z prepisu pustí zvyklosti rozpoznávača, nie chyby.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spokenDegrees, spokenDomain, spokenFeet, spokenFlightNumber, spokenFlightTime, spokenHour, spokenKm, spokenMinutes, spokenMinutesAcc, spokenNumber } from './eventSpeech.js';
import { anchorTime, contextSentence, fitNarration, fixedLines, gapAftermathSentence, momentSentence, narrationHeardMatches, narrationLines, roundFeet } from './eventNarration.js';
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
  extras: [
    { spoken: 'Cestujúcich odviezlo do Tel Avivu náhradné lietadlo.', sources: [{ url: 'https://www.arabnews.com/middle-east/x', quote: 'A flight to retrieve the passengers from Tabuk landed in Israel' }] },
    { after: 'dive', spoken: 'Podľa cestujúcich sa z kokpitu ozýva krik.', sources: [{ url: 'https://www.arabnews.com/middle-east/x', quote: 'Screams were heard coming from the cockpit' }] },
    { after: 'gap', spoken: 'Do kokpitu podľa premiéra vošiel ďalší člen posádky a lietadlo stabilizoval.', sources: [{ url: 'https://www.arabnews.com/middle-east/x', quote: 'Another air crew member on the plane entered the cockpit' }] },
    { after: 'landing', spoken: 'Oboch pilotov odviezli do nemocnice.', sources: [{ url: 'https://www.aljazeera.com/news/2026/9/30/x', quote: 'The pilot and copilot were admitted to hospital with injuries' }] },
    { after: 'dive', spoken: 'Boli sme si istí, že nás zavraždia alebo sa zrútime, povedal jeden z cestujúcich.', sources: [{ url: 'https://www.arabnews.com/middle-east/x', quote: 'For several minutes we were certain we will be murdered or crash' }] },
    { spoken: 'Prečo sa to stalo, zatiaľ nie je známe. Prebieha vyšetrovanie.', sources: [{ url: 'https://www.arabnews.com/middle-east/x', quote: 'are unknown and remain subject to a formal investigation' }] },
  ],
  lines: { m6: { spoken: 'Podľa správ núdzovo pristálo v saudskom Tabuku.' } },
};
/** Dĺžky nahrávok hlasu vlastníka z 2. a 3. 10. (ticho na začiatku, koniec reči) podľa viet scenára SCRIPT. */
const DUR = {
  hook1: { lead: 0.203, speechEnd: 7.449 }, hook2: { lead: 0.144, speechEnd: 5.851 }, ctx: { lead: 0.161, speechEnd: 6.142 }, m0: { lead: 0.143, speechEnd: 5.683 },
  extra2: { lead: 0.187, speechEnd: 3.665 }, extra5: { lead: 0.146, speechEnd: 6.47 }, m1: { lead: 0.163, speechEnd: 3.136 }, m1n0: { lead: 0.18, speechEnd: 4.88 },
  m1a: { lead: 0.181, speechEnd: 4.292 }, extra3: { lead: 0.16, speechEnd: 6.66 }, m2: { lead: 0.154, speechEnd: 5.969 }, m4: { lead: 0.161, speechEnd: 4.036 },
  m5: { lead: 0.166, speechEnd: 5.707 }, m6: { lead: 0.265, speechEnd: 3.876 }, extra4: { lead: 0.155, speechEnd: 2.854 }, extra1: { lead: 0.161, speechEnd: 4.229 },
  extra6: { lead: 0.159, speechEnd: 4.844 }, portal: { lead: 0.212, speechEnd: 4.11 },
};

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

test('vety FZ1073 zo skutočných momentov: dramatické, ale len z údajov; kontext z dát; doplnky zo správ pri svojom momente; háčik prvý, portál posledný, meno autora sa nehovorí; náhrada vety vlastníkom', async () => {
  const e = await fzEvent();
  const { trusted } = await reportedContext();
  const script = normalizeVideoScript(SCRIPT, { trusted });
  const lines = narrationLines(e, script);
  // extra2 a extra5 pri páde (v poradí scenára), extra3 za vetami diery, extra4 za pristátím, bez miesta na záver.
  assert.deepEqual(lines.map((l) => l.id), ['hook1', 'hook2', 'ctx', 'm0', 'extra2', 'extra5', 'm1', 'm1n0', 'm1a', 'extra3', 'm2', 'm4', 'm5', 'm6', 'extra4', 'extra1', 'extra6', 'portal']);
  const spoken = Object.fromEntries(lines.map((l) => [l.id, l.spoken]));
  assert.equal(spoken.hook1, SCRIPT.hook.spoken[0], 'háčik hneď na začiatku (pravidlo prvých sekúnd)');
  assert.equal(spoken.ctx, 'Lietadlo je vyše dvoch hodín vo vzduchu, štyristo kilometrov pred cieľom.', 'viac informácií z dát: čas letu a km do cieľa');
  assert.equal(spoken.m0, 'Zrazu sa lietadlo rúti dolu — vyše dvadsaťjeden tisíc stôp za minútu.', 'krátko a úderne; čas beží v obraze');
  assert.equal(spoken.m1, 'Potom deväť minút ticho. Žiadne údaje.');
  assert.equal(spoken.m1n0, 'Podľa správ kleslo za jedinú minútu pod sedemnásťtisíc stôp.', 'pokles zo správ bez mena konkurencie');
  assert.equal(spoken.m1a, 'Keď sa stroj znova ozve, je o trinásťtisíc stôp nižšie.', 'z výšok na okrajoch diery (ako nápis v obraze)');
  assert.equal(spoken.m2, 'Lietadlo vysiela kód núdze. O päť minút neskôr kód nezákonného zásahu.', 'dva kódy v jednej vete s odstupom z údajov');
  assert.equal(spoken.m4, 'Stroj sa otáča späť — obrat o dvesto šesť stupňov.');
  assert.equal(spoken.m5, 'Údaje končia vo výške pätnásťtisíc stôp — lietadlo je stále vo vzduchu.');
  assert.equal(spoken.m6, 'Podľa správ núdzovo pristálo v saudskom Tabuku.', 'náhrada vety vlastníkom');
  assert.equal(lines.find((l) => l.id === 'm6').edited, true);
  assert.equal(spoken.extra1, 'Cestujúcich odviezlo do Tel Avivu náhradné lietadlo.');
  assert.equal(spoken.portal, 'Celú rekonštrukciu nájdete na okolajv bodka es ká.');
  assert.equal(lines.at(-1).id, 'portal', 'portál posledný');
  assert.ok(!/uhrin|vladim/i.test(JSON.stringify(lines)), 'meno autora sa v komentári nehovorí (vlastník 10-03)');
  assert.deepEqual(fixedLines().map((l) => l.id), ['portal']);
  // Kotvy: doplnky pri momente nemajú vlastnú (idú hneď za jeho vetou), prvý záverečný je nad súhrnom.
  const by = Object.fromEntries(lines.map((l) => [l.id, l]));
  assert.equal(by.extra2.anchor, null);
  assert.equal(by.extra4.anchor, null);
  assert.deepEqual(by.extra1.anchor, { at: 'outro', offset: 0.2 });
  assert.equal(by.extra6.anchor, null);
  assert.deepEqual(by.ctx.anchor, { at: 'play' });
  assert.deepEqual(by.m4.anchor, { spotlightBefore: 4 }, 'veta o obrate od začiatku spomaleného obratu');
  // Vlastník vie vygenerovanú vetu vynechať (`skip`), portál nie.
  const skipped = narrationLines(e, normalizeVideoScript({ ...SCRIPT, lines: { ...SCRIPT.lines, m1n0: { skip: true }, portal: { skip: true } } }, { trusted }));
  assert.ok(!skipped.some((l) => l.id === 'm1n0'));
  assert.equal(skipped.at(-1).id, 'portal', 'portál sa vynechať nedá (vždy spomínaj môj portál)');
  assert.equal(skipped.length, lines.length - 1);
  const caption = Object.fromEntries(lines.map((l) => [l.id, l.caption]));
  assert.equal(caption.ctx, `Lietadlo je vyše 2 hodín vo vzduchu, 400${NB}km pred cieľom.`, 'titulok číslicami');
  assert.equal(caption.m0, `Zrazu sa lietadlo rúti dolu — vyše 21${NB}000${NB}stôp za minútu.`);
  assert.equal(caption.m1, 'Potom 9 minút ticho. Žiadne údaje.');
  assert.equal(caption.m1n0, `Podľa správ kleslo za jedinú minútu pod 17${NB}000${NB}stôp.`);
  assert.equal(caption.m1a, `Keď sa stroj znova ozve, je o 13${NB}000${NB}stôp nižšie.`);
  assert.equal(caption.m2, 'Lietadlo vysiela kód núdze. O 5 minút neskôr kód nezákonného zásahu.');
  assert.equal(caption.m5, `Údaje končia vo výške 15${NB}000${NB}stôp — lietadlo je stále vo vzduchu.`);
  assert.equal(caption.portal, 'Celú rekonštrukciu nájdete na okolive.sk.');
  assert.ok(lines.filter((l) => l.approved).every((l) => l.kind === 'fixed'), 'bez kontroly výslovnosti len pevné vety');
  assert.ok(!JSON.stringify(lines).match(/flight\s*radar/i), 'konkurencia nikde');
  // Bez scenára: veta o lete namiesto háčika, kontext z dát ostáva, bez doplnkov; generická veta o pristátí.
  const plain = narrationLines(e, null);
  assert.equal(plain[0].spoken, 'Let ef zet tisíc sedemdesiattri na trase Dubai – Tel Aviv.');
  assert.equal(plain[1].id, 'ctx');
  assert.equal(plain.find((l) => l.id === 'm6').spoken, 'Podľa správ núdzovo pristálo na letisku Tabuk.');
  assert.ok(!plain.some((l) => l.kind === 'extra'));
  assert.equal(plain.at(-1).id, 'portal');
  // Doplnok k momentu, ktorý udalosť nemá, ide na záver; neznáme miesto scenár odmietne.
  const noMoment = narrationLines({ ...e, timeline: e.timeline.filter((m) => m.kind !== 'uturn') }, normalizeVideoScript({ extras: [{ ...SCRIPT.extras[1], after: 'uturn' }] }, { trusted }));
  assert.deepEqual(noMoment.at(-2).anchor, { at: 'outro', offset: 0.2 });
  assert.throws(() => normalizeVideoScript({ extras: [{ ...SCRIPT.extras[1], after: 'niekde' }] }, { trusted }), (err) => err.code === 'BAD_SCRIPT' && /miesto/.test(err.why));
  assert.equal(normalizeVideoScript({ extras: [SCRIPT.extras[0]] }, { trusted }).extras[0].after, 'end');
  // Jednotlivé druhy momentov — sila slov podľa čísla.
  assert.equal(momentSentence({ kind: 'dive', fpm: -6400, t: utc('2026-09-30T05:22:00Z') }).spoken, 'Zrazu lietadlo prudko klesá — vyše šesťtisíc stôp za minútu.', 'pod 10 000 stôp za minútu bez „rúti sa"');
  assert.equal(momentSentence({ kind: 'squawk', meaning: 'radio' }).spoken, 'Lietadlo vysiela kód straty spojenia.');
  assert.equal(momentSentence({ kind: 'squawk', meaning: 'emergency', t: 100 }, { nextSquawks: [{ kind: 'squawk', meaning: 'hijack', t: 120 }] }).spoken, 'Lietadlo vysiela kód núdze. Vzápätí kód nezákonného zásahu.');
  assert.equal(momentSentence({ kind: 'squawk', meaning: 'emergency', t: 100 }, { nextSquawks: [{ kind: 'squawk', meaning: 'radio', t: 160 }] }).caption, 'Lietadlo vysiela kód núdze. O minútu neskôr kód straty spojenia.');
  assert.equal(momentSentence({ kind: 'last-contact', airborne: false }).spoken, 'Posledný záznam je na zemi.');
  assert.equal(momentSentence({ kind: 'gap', s: 60 }).caption, 'Potom 1 minúta ticho. Žiadne údaje.');
  assert.equal(momentSentence({ kind: 'cruise' }), null);
  assert.equal(gapAftermathSentence({ fromAlt: 3000, toAlt: 6100 }).spoken, 'Keď sa stroj znova ozve, je o desaťtisíc stôp vyššie.');
  assert.equal(gapAftermathSentence({ fromAlt: 10000, toAlt: 9500 }), null, 'malá zmena výšky cez dieru = bez vety');
  assert.equal(gapAftermathSentence({ fromAlt: 10000 }), null);
});

test('veta kontextu len z toho, čo údaje nesú: bez štartu alebo cieľa kratšia, cieľ za chrbtom sa nespomenie, jedna časť = žiadna veta', async () => {
  const e = await fzEvent();
  const noTakeoff = { ...e, timeline: e.timeline.filter((m) => m.kind !== 'takeoff') };
  assert.equal(contextSentence(noTakeoff).spoken, 'Lietadlo je štyristo kilometrov pred cieľom, vo výške tridsaťštyri tisíc stôp.');
  const noRoute = { ...e, route: null };
  assert.equal(contextSentence(noRoute).spoken, 'Lietadlo je vyše dvoch hodín vo vzduchu, vo výške tridsaťštyri tisíc stôp.');
  // Cieľ na opačnej strane, než kam lietadlo letí (zlá trasa v podklade) — vzdialenosť „pred cieľom" by bola nepravda.
  const behind = { ...e, route: { ...e.route, destination: { ...e.route.destination, lat: 25.25, lon: 55.36 } } };
  assert.equal(contextSentence(behind).spoken, 'Lietadlo je vyše dvoch hodín vo vzduchu, vo výške tridsaťštyri tisíc stôp.');
  assert.equal(contextSentence({ ...noTakeoff, route: null }), null, 'len výška = bez vety');
  assert.equal(contextSentence({ ...e, timeline: [] }), null);
  assert.deepEqual(spokenFlightTime(40 * 60), { spoken: 'štyridsať minút', caption: '40 minút' });
  assert.deepEqual(spokenFlightTime(95 * 60), { spoken: 'vyše hodiny', caption: 'vyše hodiny' });
  assert.deepEqual(spokenFlightTime(3 * 3600 + 120), { spoken: 'tri hodiny', caption: '3 hodiny' });
  assert.deepEqual(spokenFlightTime(2 * 3600 + 55 * 60), { spoken: 'takmer tri hodiny', caption: 'takmer 3 hodiny' });
  assert.deepEqual(spokenFlightTime(5 * 3600 + 20 * 60), { spoken: 'vyše piatich hodín', caption: 'vyše 5 hodín' });
  assert.equal(spokenFlightTime(120), null);
  assert.equal(spokenKm(411).spoken, 'štyristo kilometrov');
  assert.equal(spokenKm(1234).caption, `1${NB}250${NB}km`);
  assert.equal(spokenKm(64).spoken, 'šesťdesiat kilometrov');
  assert.equal(spokenMinutesAcc(1), 'minútu');
  assert.equal(spokenMinutesAcc(3), 'tri minúty');
  assert.equal(spokenMinutesAcc(7), 'sedem minút');
});

test('scenár vlastníka: zdroj (dôveryhodné médium + citát) je povinný, konkurencia sa odmietne, riadok zdroja na kartu; citát sa hľadá doslova', async () => {
  const { trusted } = await reportedContext();
  const script = normalizeVideoScript(SCRIPT, { trusted });
  assert.equal(script.hook.tag, 'ÚTOK NA PALUBE');
  assert.equal(script.hook.source, 'podľa izraelského premiéra · Al Jazeera, Arab News');
  assert.equal(sourceLine({ attributed: null, sources: [{ domain: 'reuters.com' }] }), 'podľa správ · Reuters');
  assert.equal(scriptSources(script).length, 8, 'dva zdroje háčika + šesť doplnkov');
  assert.deepEqual(script.extras.map((x) => x.after), ['end', 'dive', 'gap', 'landing', 'dive', 'end']);
  assert.equal(normalizeVideoScript(null, { trusted }), null);
  const codeOf = (input) => { try { normalizeVideoScript(input, { trusted }); return null; } catch (e) { return e.code === 'BAD_SCRIPT' ? e.why : e.message; } };
  assert.match(codeOf({ hook: { ...SCRIPT.hook, sources: [] } }), /zdroje/);
  assert.match(codeOf({ extras: Array.from({ length: 9 }, () => SCRIPT.extras[0]) }), /najviac 8/);
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

test('tempo z dĺžok nahrávok: každá veta začne najviac 0,35 s po svojom zábere, medzi vetami nevzniká ticho, predlžuje sa len záber, kde veta znie; posledná skončí pred koncom; bez háčika a doplnkov tiež', async () => {
  const e = await fzEvent();
  const { trusted } = await reportedContext();
  const lines = narrationLines(e, normalizeVideoScript(SCRIPT, { trusted }));
  assert.deepEqual(lines.map((l) => l.id).filter((id) => !DUR[id]), [], 'každá veta má dĺžku nahrávky');
  const fit = fitNarration(e, lines, DUR);
  assert.equal(fit.converged, true);
  assert.ok(fit.maxLag <= 0.35, `oneskorenie ${fit.maxLag}`);
  assert.ok(fit.durationS > 85 && fit.durationS < 105, `dĺžka ${fit.durationS}`);
  const by = Object.fromEntries(fit.placement.map((p) => [p.id, p]));
  assert.ok(by.hook1.speechStart < 0.5, 'háčik od prvej polsekundy');
  // Vety idú tesne po sebe — spoločné voľby plánu (holdS, playS, spotlightS) sa nemenia, takže sa nenafúkne
  // žiadny záber bez reči (2026-10-03: veta kontextu natiahla všetky prelety a medzi vetami bolo 20 s ticha).
  const silences = fit.placement.slice(1).map((p, i) => p.speechStart - fit.placement[i].speechEnd);
  assert.ok(Math.min(...silences) >= 0.3, 'vety sa neprekrývajú');
  assert.ok(Math.max(...silences) <= 1.5, `najdlhšie ticho medzi vetami ${Math.max(...silences).toFixed(2)} s`);
  assert.deepEqual(Object.keys(fit.planOpts).sort(), ['endCardS', 'openingS', 'stretch']);
  const plan = videoPlan(e, fit.planOpts);
  const base = videoPlan(e, { openingS: 2.6, endCardS: 3 });
  assert.equal(plan.pieces.length, base.pieces.length);
  const ms = keyMoments(e);
  const pieceAt = (t) => plan.pieces.find((p) => t >= p.start && t < p.start + p.dur);
  // Kontext počas prvého preletu, pád a doplnky pri ňom počas spomaleného pádu, vety o diere počas diery.
  assert.equal(pieceAt(by.ctx.speechStart).phase, 'play');
  assert.equal(plan.pieces.indexOf(pieceAt(by.ctx.speechStart)), plan.pieces.findIndex((p) => p.phase === 'play'));
  for (const id of ['m0', 'extra2', 'extra5']) assert.equal(pieceAt(by[id].speechStart).phase, 'spotlight', id);
  assert.ok(Math.abs(by.m0.anchor - anchorTime({ spotlightBefore: 0 }, plan, ms)) < 1e-9);
  for (const id of ['m1n0', 'm1a', 'extra3']) assert.equal(pieceAt(by[id].speechStart).phase, 'gap', id);
  const gapHold = plan.pieces.find((p) => p.phase === 'moment' && ms[p.moment].kind === 'gap');
  assert.ok(gapHold.dur < 1.5, 'zastavenie pred dierou ostáva krátke — predĺžila sa diera');
  assert.ok(plan.pieces.filter((p) => p.phase === 'moment').every((p) => p.dur <= 3), 'zastavenia sa nepredlžujú hromadne');
  assert.equal(pieceAt(by.m4.speechStart).phase, 'spotlight', 'veta o obrate počas spomaleného obratu');
  for (const id of ['m6', 'extra4']) assert.equal(pieceAt(by[id].speechStart).phase, 'reported', id);
  assert.equal(pieceAt(by.extra1.speechStart).phase, 'outro');
  assert.ok(by.portal.anchor >= plan.pieces.find((p) => p.phase === 'endcard').start, 'portál na koncovej karte');
  assert.ok(by.portal.speechEnd <= fit.durationS - 0.6, 'portál skončí pred koncom');
  assert.ok(plan.pieces[0].phase === 'opening' && plan.pieces[0].dur >= 7, 'otvorenie natiahnuté pre háčik');
  // Prelety a zastavenia bez viet ostávajú také, ako v pláne bez komentára.
  const untouched = plan.pieces.filter((p, i) => !(fit.planOpts.stretch[i] > 0));
  assert.ok(untouched.length >= 5 && untouched.every((p) => Math.abs(p.dur - base.pieces[plan.pieces.indexOf(p)].dur) < 1e-9));
  // Bez scenára a s kratšími vetami sa tempo nenafúkne zbytočne.
  const plainLines = narrationLines(e, null);
  const plainDur = Object.fromEntries(plainLines.map((l) => [l.id, DUR[l.id] || { lead: 0.2, speechEnd: 3.0 }]));
  const plainFit = fitNarration(e, plainLines, plainDur);
  assert.equal(plainFit.converged, true);
  assert.ok(plainFit.durationS < fit.durationS, 'kratší komentár = kratšie video');
  // Veta, ktorú nemožno ukotviť dopredu (kotva pred predošlou vetou), riešenie nezacyklí.
  const odd = [{ id: 'a', spoken: 'x', caption: 'x', anchor: { at: 'outro' } }, { id: 'b', spoken: 'y', caption: 'y', anchor: { at: 'intro' } }];
  const oddFit = fitNarration(e, odd, { a: { lead: 0.1, speechEnd: 2 }, b: { lead: 0.1, speechEnd: 2 } });
  assert.equal(oddFit.converged, false);
  assert.ok(oddFit.durationS < 60, 'video nenarástlo do stropu iterácií');
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
  // Malé číslovky slovom aj číslicou a „km" = „kilometrov" sú to isté; iné číslo nie.
  assert.equal(ok(`Lietadlo je vyše 2 hodín vo vzduchu, 400${NB}km pred cieľom, vo výške 34${NB}000${NB}stôp.`, 'Lietadlo je vyše dvoch hodín vo vzduchu, 400 kilometrov pred cieľom, vo výške 34 tisíc stôp.'), true);
  assert.equal(ok('Lietadlo vysiela kód núdze. O 5 minút neskôr kód nezákonného zásahu.', 'Lietadlo vysiela kód núdze o päť minút neskôr kód nezákonného zásahu.'), true);
  assert.equal(ok('Potom 9 minút ticho. Žiadne údaje.', 'Potom deväť minút ticho, žiadne údaje.'), true);
  assert.equal(ok('Potom 9 minút ticho. Žiadne údaje.', 'Potom desať minút ticho. Žiadne údaje.'), false);
  assert.equal(ok('„Boli sme si istí, že nás zavraždia alebo sa zrútime,“ povedal jeden z cestujúcich.', 'Boli sme si istí, že nás zavraždia alebo sa zrútime, povedal jeden z cestujúcich.'), true, 'úvodzovky titulku neprekážajú');
  assert.equal(fixedLines().every((l) => l.approved), true);
});

test('kontrola výslovnosti: km² = kilometrov štvorcových; vlastné mená smie rozpoznávač zapísať inak len na požiadanie, čísla nikdy', () => {
  const check = (c, h, opts) => narrationHeardMatches(c, h, opts);
  // Plocha: titulok s „km²", hlas „kilometrov štvorcových" (aj „kilometre štvorcové"); iné číslo neprejde.
  assert.equal(check(`Ukrajina získala späť 36${NB}km².`, 'Ukrajina získala späť 36 kilometrov štvorcových.').ok, true);
  assert.equal(check(`Ruská kontrola sa tu rozšírila o 3${NB}km².`, 'Ruská kontrola sa tu rozšírila o tri kilometre štvorcové.').ok, true);
  // Rozpoznávač píše aj „36 km štvorcových" (prepis hlasu vlastníka, 2026-10-03) — s menom zapísaným po svojom.
  assert.equal(check(`Pri Lymane sa front pohol opačným smerom: Ukrajina tu získala späť 36${NB}km².`, 'Pri Limane sa front pohol opačným smerom. Ukrajina tu získala späť 36 km štvorcových.', { names: true }).ok, true);
  assert.equal(check(`Ukrajina získala späť 36${NB}km².`, 'Ukrajina získala späť 35 kilometrov štvorcových.').ok, false);
  assert.equal(check(`Ukrajina získala späť 36${NB}km².`, 'Ukrajina získala späť 36 kilometrov.').ok, false, 'kilometer nie je kilometer štvorcový');
  // Vlastné mená: bez `names` prísne, s `names` stačí podobnosť (aj dve slová spojené do mena).
  const pokrovsk = ['Najviac útokov je pri Pokrovsku: 169 za týždeň.', 'Najviac útokov je pri Pokrovsko, 169 za týždeň.'];
  assert.equal(check(...pokrovsk).ok, false);
  assert.equal(check(...pokrovsk, { names: true }).ok, true);
  const deep = ['Ukazuje to porovnanie dvoch snímok mapy DeepState s odstupom siedmich dní.', 'Ukazuje to porovnanie dvoch snímok mapy Deep State s odstupom siedmich dní.'];
  assert.equal(check(...deep, { names: true }).ok, true);
  assert.equal(check(deep[0], 'Ukazuje to porovnanie dvoch snímok mapy Dipstate s odstupom siedmich dní.', { names: true }).ok, true);
  assert.equal(check(deep[0], 'Ukazuje to porovnanie dvoch snímok mapy Dípstejt s odstupom siedmich dní.', { names: true }).ok, false, 'príliš vzdialený zápis ide na vypočutie');
  // Tolerancia mien nie je tolerancia čísel ani obyčajných slov.
  assert.equal(check(pokrovsk[0], 'Najviac útokov je pri Pokrovsku, 168 za týždeň.', { names: true }).ok, false);
  assert.equal(check(pokrovsk[0], 'Najviac útokov bolo pri Pokrovsku, 169 za týždeň.', { names: true }).ok, false);
  // Úplne iné meno neprejde ani s toleranciou.
  assert.equal(check('Pri Lymane sa front pohol opačným smerom.', 'Pri Kupiansku sa front pohol opačným smerom.', { names: true }).ok, false);
  // Prvé slovo vety nie je „meno" len preto, že má veľké písmeno.
  assert.equal(check('Útokov tu bolo 56.', 'Úrokov tu bolo 56.', { names: true }).ok, false);
});

test('číslice vo vete vlastníka: hlas dostane slová, titulok ostáva s číslicami; neistý tvar sa vráti s radou; generované vety číslice nemajú nikdy', async () => {
  const { spokenDigits } = await import('./eventSpeech.js');
  const say = (t) => spokenDigits(t);
  assert.deepEqual(say('Na palube bolo 167 ľudí.'), { text: 'Na palube bolo sto šesťdesiatsedem ľudí.', problem: null });
  assert.equal(say('Lietadlo kleslo o 14 000 stôp za 30 sekúnd.').text, 'Lietadlo kleslo o štrnásťtisíc stôp za tridsať sekúnd.');
  assert.equal(say(`Kleslo z 34${NB}000 pod 17.000 stôp.`).text, 'Kleslo z tridsaťštyri tisíc pod sedemnásťtisíc stôp.', 'tisícky aj po predložke, oddelené medzerou, pevnou medzerou alebo bodkou');
  assert.equal(say('Let FZ1073 letel z Dubaja.').text, 'Let ef zet tisíc sedemdesiattri letel z Dubaja.', 'kód letu hláskovane');
  assert.equal(say('Bolo ich 21.').text, 'Bolo ich dvadsaťjeden.', 'bodka vety ostáva');
  assert.equal(say('Vyše 100 cestujúcich.').text, 'Vyše sto cestujúcich.');
  assert.equal(say('Bez čísel.').text, 'Bez čísel.');
  // Neisté tvary kód neháda.
  assert.match(say('Pristál o 9:45.').problem, /čas „9:45"/);
  assert.match(say('Pristálo do 5 minút.').problem, /„5" po „do"/);
  assert.match(say('Po 9 minútach sa ozval.').problem, /po „po"/);
  assert.match(say('Mal 2 pilotov.').problem, /„2" napíš slovom/);
  assert.match(say('Stalo sa to 30. septembra.').problem, /radovú číslovku „30\."/);
  assert.match(say('Rýchlosť 5,5 machu.').problem, /desatinné číslo „5,5"/);
  assert.equal(say('Mal 2 pilotov.').text, 'Mal 2 pilotov.', 'pri probléme sa text nemení');
  // Scenár: veta hlasu slovami, titulok s číslicami; neistý tvar = scenár sa neprijme s radou.
  const { trusted } = await reportedContext();
  const src = SCRIPT.extras[0].sources;
  const s = normalizeVideoScript({ extras: [{ spoken: 'Na palube bolo 167 ľudí.', sources: src }], lines: { m5: { spoken: 'Údaje končia vo výške 15 000 stôp.' } } }, { trusted });
  assert.equal(s.extras[0].spoken, 'Na palube bolo sto šesťdesiatsedem ľudí.');
  assert.equal(s.extras[0].caption, 'Na palube bolo 167 ľudí.');
  assert.deepEqual(s.lines.m5, { spoken: 'Údaje končia vo výške pätnásťtisíc stôp.', caption: 'Údaje končia vo výške 15 000 stôp.' });
  assert.throws(() => normalizeVideoScript({ extras: [{ spoken: 'Pristál o 9:45.', sources: src }] }, { trusted }), (err) => err.code === 'BAD_SCRIPT' && /čas „9:45" napíš slovom/.test(err.why) && err.index === 'extra1');
  // Vygenerované vety (z dát) idú do hlasu vždy bez číslic.
  const e = await fzEvent();
  for (const l of narrationLines(e, null)) assert.ok(!/\d/.test(l.spoken), `${l.id}: ${l.spoken}`);
  for (const l of narrationLines(e, normalizeVideoScript(SCRIPT, { trusted }))) assert.ok(!/\d/.test(l.spoken), `${l.id}: ${l.spoken}`);
});
