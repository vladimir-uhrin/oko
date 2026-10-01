// src/data/eventVideoHud.test.mjs — popisy 3D videa udalosti v štýle OKO (2026-10-01, vlastník: „chýba
// tam moje logo", „v OKO style"). Testy SPRÁVANIA na FZ1073 zo skutočných stôp: nápis OKO a okolive.sk
// a zdroje (Google · Cesium ion, ODbL, adsbdb) na každej snímke, stavové štítky podľa fázy, výška na karte
// zhodná s textom momentu pri zastavení, nápis diery len počas diery a krátko po nej, neoverená udalosť
// nikdy „overené", záver so všetkými momentmi a médiami, ktorý sa zmestí aj pri veľa momentoch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simplifyTrack } from './eventCard.js';
import { keyMoments } from './eventPost.js';
import { videoPlan } from './eventVideo.js';
import { eventVideoScene } from './eventVideoScene.js';
import { VIDEO_3D_FORMAT, buildEventVideoHudSvg, gapLabel, groupFt, keepNumbers, readoutFt } from './eventVideoHud.js';
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

test('na každej snímke OKO, okolive.sk a zdroje (Google · Cesium ion, OpenSky, adsb.lol ODbL, plán letu adsbdb)', async () => {
  const { e, plan, scene } = await fz();
  for (const frame of [0, Math.round(plan.totalFrames / 3), Math.round((2 * plan.totalFrames) / 3), plan.totalFrames - 1]) {
    const svg = hud(e, scene, frame);
    assert.match(svg, new RegExp(`^<svg[^>]+width="${VIDEO_3D_FORMAT.w}" height="${VIDEO_3D_FORMAT.h}"`));
    assert.ok(svg.includes('>OK<tspan fill="#39d0ff">O</tspan></text>'), `snímka ${frame}: nápis OKO`);
    assert.ok(texts(svg).includes('okolive.sk'));
    assert.ok(texts(svg).includes('© Google · Cesium ion · údaje OpenSky Network, adsb.lol (ODbL) · plán letu adsbdb'), `snímka ${frame}: zdroje`);
  }
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
  const has = (frame) => hud(e, scene, frame).includes(gapLabel(g));
  assert.equal(has(framesOf(plan, gp)[0] - 2), false, 'pred dierou nie');
  assert.equal(has(framesOf(plan, gp)[0] + 1), true, 'počas diery');
  assert.equal(has(Math.round((gp.start + gp.dur + 2) * plan.fps)), true, 'krátko po nej');
  assert.equal(has(Math.round((gp.start + gp.dur + 3.5) * plan.fps)), false, 'potom zmizne');
  assert.equal(hud(e, scene, framesOf(plan, gp)[0] + 1, {}).includes(gapLabel(g)), false, 'bez polohy na obrazovke nie');
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
