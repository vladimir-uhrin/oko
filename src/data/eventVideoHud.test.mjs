// src/data/eventVideoHud.test.mjs — popisy 3D videa udalosti v štýle OKO (2026-10-01, vlastník: „chýba
// tam moje logo", „v OKO style"). Testy SPRÁVANIA na FZ1073 zo skutočných stôp: nápis OKO a okolive.sk
// a zdroje (Google · Cesium ion, ODbL, adsbdb) na každej snímke, stavové štítky podľa fázy, výška na karte
// zhodná s textom momentu pri zastavení, nápis diery len počas diery a krátko po nej, neoverená udalosť
// nikdy „overené", záver so všetkými momentmi a médiami, ktorý sa zmestí aj pri veľa momentoch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { simplifyTrack } from './eventCard.js';
import { eventWhat, flightLine, keyMoments } from './eventPost.js';
import { videoPlan } from './eventVideo.js';
import { eventVideoScene } from './eventVideoScene.js';
import { VIDEO_3D_FORMAT, buildEventVideoHudSvg, gapLabel, groupFt, hudLayers, inlineLogoMarkup, keepNumbers, readoutFt } from './eventVideoHud.js';
import { normalizeTrack } from './flightAnomalies.js';
import { fz1073, fz1073Event } from './fixtures/flightEventFixtures.mjs';

async function fz(over = {}) {
  const e = { ...(await fz1073Event()), ...over };
  const { oko, adsblol } = fz1073();
  e.track = simplifyTrack(normalizeTrack([...oko, ...adsblol]));
  const plan = videoPlan(e);
  return { e, plan, scene: eventVideoScene(e, plan) };
}
const framesOf = (plan, piece) => [Math.ceil(piece.start * plan.fps - 1e-9), Math.ceil((piece.start + piece.dur) * plan.fps - 1e-9) - 1];
const hud = (e, scene, frame, anchors = { gap0: { x: 500, y: 600 } }) => buildEventVideoHudSvg(e, scene, scene.frame(frame), anchors);
const texts = (svg) => [...svg.matchAll(/<text [^>]*>([^<]*(?:<tspan[^>]*>[^<]*<\/tspan>)?[^<]*)<\/text>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').replace(/\u00a0/g, ' '));

test('značka ako na webe na celom videu: otvorenie (logo, OKO, heslo, podpis, čo sa stalo, okolive.sk bez „naživo"), počas videa hlavička, koncová karta (NAŽIVO okolive.sk); zdroje na každej snímke', async () => {
  const { e } = await fz();
  const plan = videoPlan(e, { openingS: 2.6, endCardS: 3 });
  const scene = eventVideoScene(e, plan);
  const logoMarkup = inlineLogoMarkup(readFileSync(new URL('../../public/logo.svg', import.meta.url), 'utf8'));
  const at = (frame) => {
    const svg = buildEventVideoHudSvg(e, scene, scene.frame(frame), {}, { logoMarkup });
    return { svg, t: texts(svg) };
  };
  for (let f = 0; f < plan.totalFrames; f += 37) {
    const { svg, t } = at(f);
    assert.match(svg, new RegExp(`^<svg[^>]+width="${VIDEO_3D_FORMAT.w}" height="${VIDEO_3D_FORMAT.h}"`));
    assert.ok(t.includes('© Google · Cesium ion · údaje OpenSky Network, adsb.lol (ODbL) · plán letu adsbdb'), `snímka ${f}: zdroje`);
    assert.ok(svg.includes('OK<tspan fill="#00d4ff" font-weight="300">O</tspan>'), `snímka ${f}: nápis OKO ako na webe`);
    assert.ok(t.includes('VYTVORIL UHRIN VLADIMÍR'), `snímka ${f}: podpis`);
    assert.ok(t.some((x) => x.includes('okolive.sk')), `snímka ${f}: doména`);
    assert.ok(svg.includes(`viewBox="${logoMarkup.viewBox}"`) && !svg.includes('<image'), `snímka ${f}: logo vložené`);
  }
  const open = at(10).t;
  assert.ok(open.includes('ŽIADNE MIESTO NEOSTANE BOKOM') && open.includes(eventWhat(e).toUpperCase()) && open.includes(flightLine(e)), 'čo sa stalo a ktorý let');
  assert.ok(!open.includes('NAŽIVO'), 'pri historickej udalosti nie „naživo"');
  assert.ok(!open.some((x) => /^\d\d:\d\d:\d\d UTC$/.test(x)), 'v otvorení ešte bez hodín');
  const mid = at(Math.round(plan.totalFrames / 2)).t;
  assert.ok(mid.includes('okolive.sk') && mid.some((x) => /^\d\d:\d\d:\d\d UTC$/.test(x)), 'počas videa hlavička a hodiny');
  const end = at(plan.totalFrames - 1).t;
  assert.ok(end.includes('NAŽIVO') && end.includes('okolive.sk') && end.includes('Lietadlá, lode a konflikty naživo v 3D'));
  assert.ok(!end.some((x) => x.startsWith('Médiá:')), 'súhrn už dozneje');
  // Prechody: otvorenie dozneje, kým nastúpi hlavička; súhrn dozneje pred koncovou kartou.
  const L = (f) => hudLayers(scene, scene.frame(f));
  assert.deepEqual([L(0).opening, L(0).main], [1, 0]);
  const after = Math.round((scene.opening.start + scene.opening.dur + 0.4) * plan.fps);
  assert.deepEqual([L(after).opening, L(after).main], [0, 1]);
  const outro = Math.round((scene.outroStart + 0.5) * plan.fps);
  assert.deepEqual([L(outro).summary, L(outro).endCard], [1, 0]);
  assert.deepEqual([L(plan.totalFrames - 1).summary, L(plan.totalFrames - 1).endCard], [0, 1]);
});

test('logo vložené do popisov bez tried a štýlov — kreslí sa hneď so snímkou a nezasiahne stránku', () => {
  const m = inlineLogoMarkup(readFileSync(new URL('../../public/logo.svg', import.meta.url), 'utf8'));
  assert.equal(m.viewBox, '180 120 775 520');
  for (const bad of ['class=', '<style', '<title', ' id=']) assert.ok(!m.body.includes(bad), bad);
  assert.equal((m.body.match(/<path /g) || []).length, 4);
  assert.ok(m.body.includes('fill: #00f6ff') && m.body.includes('stroke: #48b'), 'farby loga zachované');
  assert.equal(inlineLogoMarkup('<p>nie svg</p>'), null);
});

test('štítky podľa fázy: BEZ ÚDAJOV v diere, SPOMALENÉ pri spomalení, KONIEC ÚDAJOV na poslednom meraní (nie v súhrne)', async () => {
  const { e, plan, scene } = await fz();
  const at = (phase, k = 0) => framesOf(plan, plan.pieces.filter((p) => p.phase === phase)[k])[0] + 3;
  assert.ok(texts(hud(e, scene, at('gap'))).includes('BEZ ÚDAJOV'));
  assert.ok(texts(hud(e, scene, at('spotlight'))).includes('SPOMALENÉ'));
  const play = texts(hud(e, scene, at('play')));
  assert.ok(!play.includes('BEZ ÚDAJOV') && !play.includes('SPOMALENÉ') && !play.includes('KONIEC ÚDAJOV'));
  const lastHold = plan.pieces.filter((p) => p.phase === 'moment').at(-1);
  assert.ok(texts(hud(e, scene, framesOf(plan, lastHold)[0] + 3)).includes('KONIEC ÚDAJOV'), 'FZ1073: údaje končia vo vzduchu');
  assert.ok(!texts(hud(e, scene, plan.totalFrames - 1)).includes('KONIEC ÚDAJOV'), 'súhrn bez štítku');
});

test('výška na karte: pri zastavení na momente hodnota momentu (zhodná s textom), inak posledné meranie; v diere sivá', async () => {
  const { e, plan, scene } = await fz();
  const ms = keyMoments(e);
  const diveHold = plan.pieces.find((p) => p.phase === 'moment' && ms[p.moment].kind === 'dive');
  const f = scene.frame(framesOf(plan, diveHold)[0] + 5);
  assert.equal(readoutFt(f, ms), ms[diveHold.moment].alt / 0.3048);
  const svg = buildEventVideoHudSvg(e, scene, f, {});
  const shown = `${groupFt(Math.round(readoutFt(f, ms) / 25) * 25)} ft`.replace(/\u00a0/g, ' ');
  assert.ok(texts(svg).includes(shown), 'číslo na karte');
  assert.ok(texts(svg).some((t) => t.includes(`vo výške ${shown}`)), 'to isté číslo v texte momentu');
  const play = plan.pieces.find((p) => p.phase === 'play' && p.dur > 1);
  const fp = scene.frame(framesOf(plan, play)[0] + 10);
  assert.equal(readoutFt(fp, ms), fp.plane.measuredFt, 'pri lete posledné meranie');
  const gap = scene.frame(framesOf(plan, plan.pieces.find((p) => p.phase === 'gap'))[0] + 5);
  assert.ok(buildEventVideoHudSvg(e, scene, gap, {}).includes('fill="#8fa6b4">27\u00a0950 ft</text>'), 'v diere posledná výška sivo');
});

test('nápis diery: „9 min bez údajov · kleslo o 12 925 ft" od začiatku diery do 2,5 s po nej, potom nie', async () => {
  const { e, plan, scene } = await fz();
  const g = scene.gaps[0];
  assert.equal(gapLabel(g), '9 min bez údajov · kleslo o 12\u00a0925 ft');
  assert.equal(gapLabel({ fromT: 0, toT: 600, dFt: 200 }), '10 min bez údajov', 'malá zmena výšky sa neuvádza');
  assert.equal(gapLabel({ fromT: 0, toT: 360, dFt: 3000 }), '6 min bez údajov · stúplo o 3\u00a0000 ft');
  const gp = g.piece;
  const [head, drop] = gapLabel(g).replace(/\u00a0/g, ' ').split(' · ');
  const has = (frame, anchors) => { const t = texts(hud(e, scene, frame, anchors)); return t.includes(head.toUpperCase()) && t.includes(drop); };
  assert.equal(has(framesOf(plan, gp)[0] - 2), false, 'pred dierou nie');
  assert.equal(has(framesOf(plan, gp)[0] + 1), true, 'počas diery');
  assert.equal(has(Math.round((gp.start + gp.dur + 2) * plan.fps)), true, 'krátko po nej');
  assert.equal(has(Math.round((gp.start + gp.dur + 3.5) * plan.fps)), false, 'potom zmizne');
  assert.equal(has(framesOf(plan, gp)[0] + 1, {}), false, 'bez polohy na obrazovke nie');
});

test('neoverená udalosť nikdy „overené"; súhrn so všetkými momentmi a médiami, pri veľa momentoch „+ N ďalších" nad pätou', async () => {
  const { e, plan, scene } = await fz();
  const end = texts(hud(e, scene, plan.totalFrames - 1));
  const ms = keyMoments(e);
  assert.equal(end.filter((t) => /^\d\d:\d\d /.test(t)).length, ms.length, 'všetky momenty');
  assert.ok(end.some((t) => t.startsWith('Médiá: JTA, The Jerusalem Post, The Guardian, Arab News')));
  assert.ok(end.includes('Celá rekonštrukcia: okolive.sk'));
  const mid = texts(hud(e, scene, Math.round(plan.totalFrames / 2)));
  assert.ok(mid.some((t) => t.startsWith('✓ OVERENÉ: 2 SIETE + 4 MÉDIÁ')));
  const draft = await fz({ news: { status: 'reported', trusted: [] } });
  const dm = texts(hud(draft.e, draft.scene, Math.round(draft.plan.totalFrames / 2)));
  assert.ok(dm.includes('NÁHĽAD — EŠTE NEOVERENÉ') && !dm.some((t) => t.includes('OVERENÉ:')));
  const dEnd = texts(hud(draft.e, draft.scene, draft.plan.totalFrames - 1));
  assert.ok(!dEnd.some((t) => t.includes('Overené') || t.startsWith('Médiá')), 'bez overenia ani médií');
  // Veľa momentov: zoznam sa skráti, nič nezájde pod riadok s adresou.
  const many = await fz({ timeline: Array.from({ length: 24 }, (_, i) => ({ ...ms[i % ms.length], t: ms[0].t + i * 30 })) });
  const svg = hud(many.e, many.scene, many.plan.totalFrames - 1);
  const ys = [...svg.matchAll(/<text x="96" y="([\d.]+)"/g)].map((m) => Number(m[1]));
  const addressY = Number(/<text x="52" y="([\d.]+)"[^>]*>Celá rekonštrukcia/.exec(svg)[1]);
  assert.ok(Math.max(...ys) < addressY - 20, 'zoznam nad adresou');
  assert.ok(texts(svg).some((t) => /^\+ \d+ ďalších momentov$/.test(t)));
  assert.equal(keepNumbers('klesanie 21 319 ft/min vo výške 32 325 ft'), 'klesanie 21\u00a0319\u00a0ft/min vo výške 32\u00a0325\u00a0ft');
});

test('prechody po sebe: otvorenie dozneje skôr, než nastúpi hlavička; súhrn skôr, než nastúpi koncová karta (texty sa neprekryjú)', async () => {
  const { e } = await fz();
  const plan = videoPlan(e, { openingS: 2.6, endCardS: 3 });
  const scene = eventVideoScene(e, plan);
  for (let f = 0; f < plan.totalFrames; f += 1) {
    const L = hudLayers(scene, scene.frame(f));
    assert.ok(!(L.opening > 0 && L.main > 0), `snímka ${f}: otvorenie ${L.opening} a hlavička ${L.main} naraz`);
    assert.ok(!(L.summary > 0 && L.endCard > 0), `snímka ${f}: súhrn ${L.summary} a koncová karta ${L.endCard} naraz`);
  }
});

test('doplnené zo správ (FZ1073): pri diere „PODĽA SPRÁV / pod 17 000 ft už o 05:22 / médiá" (konkurenčnú službu nemenuje); pri letisku čas zo správy, štítok PODĽA SPRÁV, žiadna nameraná výška; súhrn s prázdnym krúžkom', async () => {
  const { fz1073ReportedEvent } = await import('./fixtures/flightEventFixtures.mjs');
  const { e: base } = await fz();
  const e = await fz1073ReportedEvent(base);
  const plan = videoPlan(e);
  const scene = eventVideoScene(e, plan);
  const ms = keyMoments(e);
  const idx = ms.findIndex((m) => m.kind === 'reported-landing');
  const anchors = { gap0: { x: 500, y: 600 }, [`reported${idx}`]: { x: 420, y: 700 } };
  // Diera: poznámka zo správ s tým, kto meral, a médiami — v ráme nad kartou letu.
  const gapFrame = framesOf(plan, scene.gaps[0].piece)[0] + 3;
  const gsvg = buildEventVideoHudSvg(e, scene, scene.frame(gapFrame), anchors);
  const gt = texts(gsvg);
  assert.ok(gt.includes('PODĽA SPRÁV'), gt.join(' | '));
  assert.ok(!/flight\s*radar/i.test(gsvg), 'konkurenčná služba sa vo videu nemenuje (vlastník 10-02)');
  assert.ok(gt.includes('pod 17 000 ft už o 05:22'));
  assert.ok(gt.includes('Al Jazeera, Arab News'));
  const box = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="(\d+)" rx="10" fill="rgba\(7,19,31,0.88\)"/.exec(gsvg);
  const [x, y, w, h] = box.slice(1).map(Number);
  assert.ok(x >= 20 && x + w <= VIDEO_3D_FORMAT.w - 20 && y >= 200 && y + h <= 930, `nápis diery v ráme nad kartou (${x}, ${y}, ${w}×${h})`);
  // Zastavenie na pristátí zo správ.
  const piece = plan.pieces.find((p) => p.phase === 'reported');
  const f = scene.frame(framesOf(plan, piece)[0] + 20);
  const svg = buildEventVideoHudSvg(e, scene, f, anchors);
  const t = texts(svg);
  assert.ok(t.includes('PODĽA SPRÁV'), 'štítok PODĽA SPRÁV');
  assert.ok(!t.includes('KONIEC ÚDAJOV'), 'nie „koniec údajov" pri správe');
  assert.ok(t.includes('06:45 UTC'), 'hodiny bez sekúnd (čas zo správy je na minúty)');
  assert.ok(t.includes('06:45 UTC · PODĽA SPRÁV'));
  assert.ok(t.includes('Núdzové pristátie na letisku Tabuk (TUU)'));
  assert.ok(t.includes('Arab News, Al Jazeera'));
  assert.equal(readoutFt(f, ms), null);
  assert.ok(t.includes('—'), 'výška na karte nenameraná');
  assert.ok(t.some((l) => l.startsWith('06:45 núdzové pristátie')), 'karta letu: aktuálny moment');
  assert.ok(svg.includes(`stroke-dasharray="5 3"/><text x="420" y="1108" text-anchor="middle" font-size="20" font-weight="700" fill="#ffb020">${idx + 1}</text>`), 'číslo v prázdnom krúžku');
  // Súhrn: pristátie zo správ s prázdnym krúžkom, diera bez poznámky (miesto).
  const end = buildEventVideoHudSvg(e, scene, scene.frame(plan.totalFrames - 1), anchors);
  const et = texts(end);
  assert.ok(et.includes('06:45 núdzové pristátie na letisku Tabuk (TUU) — podľa správ'));
  assert.ok(et.some((l) => /^05:22 9 min bez údajov$/.test(l)), et.join(' | '));
  assert.ok(end.includes('stroke-dasharray="4 3"/><text x="66"'));
  // Bez správ nikde „podľa správ".
  const { e: pe, plan: pp, scene: ps } = await fz();
  for (const fr of [0, Math.round(pp.totalFrames / 2), pp.totalFrames - 1]) assert.ok(!texts(hud(pe, ps, fr)).some((l) => /PODĽA SPRÁV|podľa správ/.test(l)));
});
