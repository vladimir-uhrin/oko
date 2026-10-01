// src/data/eventVideo.test.mjs — video udalosti (2026-10-01, vlastník: „sprav ale tak, aby sme rovnaký
// vzorec použili aj v budúcnosti"). Testy SPRÁVANIA: plán z ktorejkoľvek udalosti (FZ1073 zo skutočných
// stôp aj umelé lety) — rozsah ako graf výšky, každý moment raz zastavený (aj dva v tej istej sekunde),
// diery rýchlo, čas len dopredu, záver bez zvýraznenia; snímky — len momenty, ktoré už nastali, hodiny
// s voľným rohom a stavom údajov, lietadlo nad staršími značkami, ale pod značkou, na ktorej stojí
// (overené na pixeloch cez sharp), zoznam sa vždy zmestí nad zdroje, podklad + vrstva = celý obrázok.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { CARD_FORMATS, CARD_GAP_S, buildEventCardSvg, cardListLayout, cardTimeRange, clockCorner, moreMomentsSk, simplifyTrack } from './eventCard.js';
import { incidentWindow, keyMoments } from './eventPost.js';
import { clockUtc } from './eventTimeline.js';
import { VIDEO_DEFAULTS, videoPlan } from './eventVideo.js';
import { normalizeTrack } from './flightAnomalies.js';
import { fz1073, fz1073Event } from './fixtures/flightEventFixtures.mjs';

async function fzCardEvent() {
  const e = await fz1073Event();
  const { oko, adsblol } = fz1073();
  e.track = simplifyTrack(normalizeTrack([...oko, ...adsblol]));
  return e;
}

const T0 = 1_790_000_000;
/** Let na východ, obrat a späť cez miesto prvého momentu (rovnaká šírka); voliteľne 10 min diera po ňom. */
function uturnEvent({ gapAfterDive = false } = {}) {
  const lons = [30.0, 30.2, 30.4, 30.6, 30.8, 30.6, 30.4, 30.2];
  const track = lons.map((lon, i) => [T0 + i * 60 + (gapAfterDive && i > 2 ? 600 : 0), 30, lon, 30_000]);
  return {
    id: 'abc123-20260922T1320', icao24: 'abc123', status: 'unverified', firstT: track[2][0], lastT: track[4][0], track,
    timeline: [
      { kind: 'dive', t: track[2][0], fpm: -12_000, alt: 9000, lat: 30, lon: 30.4, seenBy: ['opensky'] },
      { kind: 'uturn', t: track[4][0], turnDeg: -180, lat: 30, lon: 30.8, seenBy: ['opensky', 'adsblol'] },
    ],
  };
}

/** Snímky, ktoré padnú do kúska plánu (prvá a posledná). */
const framesOf = (plan, piece) => [Math.ceil(piece.start * plan.fps - 1e-9), Math.ceil((piece.start + piece.dur) * plan.fps - 1e-9) - 1];
/** Poloha lietadla zo snímky (stred šípky). */
const planeAt = (svg) => {
  const m = /<g transform="translate\(([\d.-]+) ([\d.-]+)\) rotate\([\d.-]+\)" opacity="([\d.]+)">/.exec(svg);
  return m ? { x: Number(m[1]), y: Number(m[2]), opacity: Number(m[3]) } : null;
};
async function pixel(svg, x, y) {
  const { data, info } = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (Math.round(y) * info.width + Math.round(x)) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}
const isWhite = ([r, g, b]) => r >= 230 && g >= 230 && b >= 230;
/** Texty panela (pod mapou vo feed, vpravo od mapy v og) bez dvoch riadkov päty. */
function panelTexts(svg, format) {
  const texts = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), text: m[3] }));
  const inPanel = texts.filter((tx) => (format === 'feed' ? tx.y > 760 : tx.x >= 740));
  const foot = inPanel.filter((tx) => tx.text.startsWith('údaje OpenSky') || tx.text.startsWith('okolive.sk · '));
  return { body: inPanel.filter((tx) => !foot.includes(tx)), footTop: Math.min(...foot.map((f) => f.y)) };
}

test('rozsah obrázka a videa: prvé až posledné meranie v okne udalosti; menej ako 2 merania v okne = celá stopa', () => {
  const track = [[0, 1, 1, 0], [1000, 1, 1, 0], [1500, 1, 1, 0], [3000, 1, 1, 0]];
  assert.deepEqual(cardTimeRange(track, [900, 2000]), [1000, 1500]);
  assert.deepEqual(cardTimeRange(track, [1400, 2000]), [0, 3000], 'jedno meranie v okne nestačí');
  assert.ok(cardTimeRange([], [0, 1]).every(Number.isNaN));
});

test('plán FZ1073: začína prvým meraním v okne (nie dierou pred ním), každý moment raz zastavený, diery rýchlo, úseky úmerne času, čas len dopredu, záver bez zvýraznenia', async () => {
  const e = await fzCardEvent();
  const plan = videoPlan(e);
  const moments = keyMoments(e);
  const win = incidentWindow(e, moments);
  const [t0, t1] = cardTimeRange(e.track, win);
  assert.deepEqual([plan.t0, plan.t1], [t0, t1], 'rovnaký rozsah ako graf výšky na obrázku');
  assert.ok(t0 > win[0] && e.track.some((p) => p[0] === t0), 'prvé meranie v okne, nie začiatok okna v diere');
  const holds = plan.pieces.filter((p) => p.phase === 'moment');
  const inRange = moments.map((m, i) => i).filter((i) => moments[i].t >= t0 && moments[i].t <= t1);
  assert.equal(inRange.length, 6);
  assert.deepEqual(holds.map((p) => p.moment), inRange, 'každý moment presne raz, v poradí');
  for (const h of holds) assert.equal(h.t, moments[h.moment].t);
  const gaps = plan.pieces.filter((p) => p.phase === 'gap');
  assert.ok(gaps.length >= 1, 'FZ1073 má 9 min bez údajov');
  for (const g of gaps) {
    const a = e.track.filter((p) => p[0] <= g.from + 1e-6).at(-1);
    const b = e.track.find((p) => p[0] >= g.to - 1e-6);
    const drop = Math.abs((b[3] ?? 0) - (a[3] ?? 0));
    assert.ok(g.to - g.from >= CARD_GAP_S);
    assert.equal(g.dur, drop >= VIDEO_DEFAULTS.gapDropFt ? VIDEO_DEFAULTS.gapDropS : VIDEO_DEFAULTS.gapS, 'diera rýchlo bez ohľadu na dĺžku; s pádom ≥ 5 000 ft 2 s');
  }
  assert.equal(gaps[0].dur, VIDEO_DEFAULTS.gapDropS, 'FZ1073: cez 9 min bez údajov kleslo o 12 925 ft');
  const rates = plan.pieces.filter((p) => p.phase === 'play' && p.dur > VIDEO_DEFAULTS.minSegmentS).map((p) => p.dur / (p.to - p.from));
  assert.ok(rates.length >= 3 && rates.every((r) => Math.abs(r - rates[0]) < 1e-9), 'úseky s údajmi úmerne času');
  assert.ok(Math.abs(plan.durationS - plan.pieces.reduce((s, p) => s + p.dur, 0)) < 1e-9);
  assert.equal(plan.totalFrames, Math.round(plan.durationS * 30));
  let prev = -Infinity;
  for (let f = 0; f < plan.totalFrames; f += 1) {
    const s = plan.at(f);
    assert.ok(s.t >= prev - 1e-6 && s.t >= t0 && s.t <= t1, `snímka ${f}`);
    prev = s.t;
  }
  assert.equal(plan.at(0).t, t0);
  const last = plan.at(plan.totalFrames - 1);
  assert.deepEqual([last.t, last.phase, last.showAll, last.current], [t1, 'outro', true, null], 'záver: súhrn bez zvýraznenia');
  const [a, b] = framesOf(plan, holds[3]);
  assert.deepEqual([plan.at(a).current, plan.at(b).current], [holds[3].moment, holds[3].moment]);
  assert.ok(plan.at(a).pop < plan.at(b).pop, 'značka nastupuje');
  const play = plan.pieces.find((p) => p.phase === 'play' && p.from >= holds[3].t);
  assert.equal(plan.at(framesOf(plan, play)[0] + 1).current, holds[3].moment, 'počas letu ďalej zvýraznený posledný moment');
});

test('všeobecný vzorec: umelý let bez dier; dva momenty v tej istej sekunde = dve zastavenia; bez stopy žiadny plán', () => {
  const e = uturnEvent();
  const plan = videoPlan(e);
  assert.deepEqual([plan.t0, plan.t1], [e.track[0][0], e.track.at(-1)[0]]);
  // Klesanie (minúta pred ním) a obrat (1,5 min pred a po) spomalene.
  assert.deepEqual(plan.pieces.map((p) => p.phase), ['intro', 'play', 'spotlight', 'moment', 'spotlight', 'play', 'spotlight', 'moment', 'spotlight', 'play', 'outro']);
  const twin = { ...e, timeline: [e.timeline[0], { ...e.timeline[0], kind: 'squawk', code: '7700', meaning: 'emergency' }, e.timeline[1]] };
  const holds = videoPlan(twin).pieces.filter((p) => p.phase === 'moment');
  assert.deepEqual(holds.map((p) => [p.t, p.moment]), [[e.track[2][0], 0], [e.track[2][0], 1], [e.track[4][0], 2]], 'čísla nastúpia po jednom');
  assert.equal(videoPlan({ ...e, track: [] }), null);
  assert.equal(videoPlan({ ...e, track: [e.track[0]] }), null);
  const short = videoPlan(e, { playS: 3, holdS: 0.5, introS: 0.5, outroS: 1, spotlightS: 1 });
  const sumOf = (phase) => short.pieces.filter((p) => p.phase === phase).reduce((s, p) => s + p.dur, 0);
  assert.ok(Math.abs(sumOf('spotlight') - 2) < 1e-9 && Math.abs(sumOf('moment') - 1) < 1e-9 && sumOf('play') < 3.1, 'tempo sa dá prepísať');
});

test('spomalene: okolie pádu a obratu dostane svoj čas (FZ1073: minúta pádu 4,5 s namiesto zlomku sekundy), čas tam beží pomalšie než pri lete', async () => {
  const e = await fzCardEvent();
  const plan = videoPlan(e);
  const ms = keyMoments(e);
  const dive = ms.find((m) => m.kind === 'dive');
  const hole = ms.find((m) => m.kind === 'gap');
  const uturn = ms.find((m) => m.kind === 'uturn');
  const spots = plan.pieces.filter((p) => p.phase === 'spotlight');
  const fall = spots.filter((p) => p.to <= hole.t + 1e-6);
  assert.ok(Math.abs(fall.reduce((s, p) => s + p.dur, 0) - VIDEO_DEFAULTS.spotlightS * 1.5) < 1e-9, 'klesanie + začiatok diery spolu 1,5 × 3 s');
  assert.equal(fall[0].from, dive.t - 60, 'minúta pred strmhlavým klesaním');
  assert.equal(fall.at(-1).to, hole.t, 'okolie končí na začiatku diery, nie v nej');
  const turn = spots.filter((p) => p.from >= uturn.t - 90 - 1e-6);
  assert.ok(Math.abs(turn.reduce((s, p) => s + p.dur, 0) - VIDEO_DEFAULTS.spotlightS) < 1e-9, 'obrat 3 s');
  const rate = (p) => p.dur / (p.to - p.from);
  const play = plan.pieces.filter((p) => p.phase === 'play' && p.dur > VIDEO_DEFAULTS.minSegmentS);
  for (const s of spots) for (const p of play) assert.ok(rate(s) > rate(p) * 3, 'spomalene aspoň 3× pomalšie');
  assert.deepEqual(plan.spotlights.map((w) => w.budgetS), [4.5, 3]);
  assert.ok(plan.durationS > 20 && plan.durationS < 30, `${plan.durationS.toFixed(1)} s — na FB do pol minúty`);
});

test('snímka: len momenty, ktoré už nastali (mapa, graf, zoznam), aktuálny tučne; hodiny HH:MM:SS UTC; médiá až v závere', async () => {
  const e = await fzCardEvent();
  const plan = videoPlan(e);
  const holds = plan.pieces.filter((p) => p.phase === 'moment');
  const h = holds[2];
  const svg = buildEventCardSvg(e, { format: 'feed', frame: plan.at(framesOf(plan, h)[0] + 5) });
  const moments = keyMoments(e);
  const count = (n) => (svg.match(new RegExp(`>${n}</text>`, 'g')) || []).length;
  for (let i = 0; i < moments.length; i += 1) {
    if (i <= h.moment) assert.equal(count(i + 1), 3, `moment ${i + 1}: značka na mape, v grafe aj v zozname`);
    else assert.equal(count(i + 1), 0, `moment ${i + 1} ešte nenastal — nikde`);
  }
  assert.ok(svg.includes(`>${clockUtc(h.t)} UTC</text>`), 'hodiny');
  assert.ok(new RegExp(`font-weight="700" fill="#e7f3f9">${clockUtc(moments[h.moment].t).slice(0, 5)} `).test(svg), 'aktuálny riadok tučne');
  assert.ok(!svg.includes('Médiá:'), 'médiá až v závere');
  const outro = buildEventCardSvg(e, { format: 'feed', frame: plan.at(plan.totalFrames - 1) });
  assert.ok(outro.includes('Médiá: JTA'), 'záver ukáže médiá ako obrázok');
  for (let i = 1; i <= moments.length; i += 1) assert.ok(outro.includes(`>${i}</text>`));
  assert.ok(!/font-weight="700" fill="#e7f3f9">\d\d:\d\d /.test(outro), 'v závere nič zvýraznené');
});

test('hodiny: stav „bez údajov" v diere a „koniec údajov" na poslednom meraní; roh mapy, ktorý nezakryje letisko ani stopu', async () => {
  const e = await fzCardEvent();
  const plan = videoPlan(e);
  const gap = plan.pieces.find((p) => p.phase === 'gap');
  const inGap = buildEventCardSvg(e, { format: 'feed', frame: plan.at(framesOf(plan, gap)[0] + 2) });
  assert.ok(inGap.includes('>bez údajov</text>'));
  const play = plan.pieces.find((p) => p.phase === 'play' && p.dur > 1);
  const flying = buildEventCardSvg(e, { format: 'feed', frame: plan.at(framesOf(plan, play)[0] + 3) });
  assert.ok(!flying.includes('>bez údajov</text>') && !flying.includes('>koniec údajov</text>'));
  const end = buildEventCardSvg(e, { format: 'feed', frame: plan.at(plan.totalFrames - 1) });
  assert.ok(end.includes('>koniec údajov</text>'), 'FZ1073: údaje končia vo vzduchu');
  // Tel Aviv je vľavo hore → hodiny vpravo (vo videu aj v og), na celom videu ten istý roh.
  const clockX = (svg) => Number(/<rect x="([\d.]+)" y="18" width="[\d.]+" height="[\d.]+" rx="10"/.exec(svg)[1]);
  assert.ok(clockX(inGap) > CARD_FORMATS.feed.w / 2 && clockX(inGap) === clockX(flying) && clockX(flying) === clockX(end));
  const og = buildEventCardSvg(e, { format: 'og', frame: plan.at(10) });
  assert.ok(clockX(og) > 720 / 2, 'og: mapa je široká 720 px');
  // Umelý let bez letísk v strede mapy: hodiny vľavo (pri zhode vľavo).
  const u = uturnEvent();
  assert.equal(clockX(buildEventCardSvg(u, { format: 'feed', frame: videoPlan(u).at(0) })), 18);
  // Geometria: popis letiska v ľavom rohu → vpravo; stopa v pravom rohu → vľavo.
  const map = { x: 0, y: 0, w: 1080, h: 760 };
  const box = { w: 300, h: 90 };
  assert.equal(clockCorner({ map, box, airports: [{ box: { x0: 150, x1: 260, y0: 30, y1: 55 } }] }).x, 1080 - 18 - 300);
  assert.equal(clockCorner({ map, box, pts: [[700, 50], [1070, 60]] }).x, 18);
  assert.equal(clockCorner({ map, box, pts: [[10, 50], [1070, 60]], marks: [{ x: 900, y: 60 }] }).x, 18, 'značka váži viac než kúsok stopy');
});

test('poradie na mape (pixely): lietadlo v pohybe nad staršou značkou; pri zastavení na momente značka nad lietadlom; bledé lietadlo v diere pod značkou', async () => {
  const e = uturnEvent();
  const plan = videoPlan(e);
  const holdDive = plan.pieces.find((p) => p.phase === 'moment' && p.moment === 0);
  const hold = buildEventCardSvg(e, { format: 'feed', frame: plan.at(framesOf(plan, holdDive)[0] + 10) });
  const ph = planeAt(hold);
  assert.ok(!isWhite(await pixel(hold, ph.x, ph.y)), 'zastavenie: číslo momentu nad lietadlom');
  // Späť cez miesto prvého momentu (t = 7. bod stopy) — lietadlo letí, má byť vidieť.
  const back = e.track[6][0];
  let best = 0;
  for (let f = 0; f < plan.totalFrames; f += 1) if (Math.abs(plan.at(f).t - back) < Math.abs(plan.at(best).t - back)) best = f;
  assert.equal(plan.at(best).phase, 'play');
  const over = buildEventCardSvg(e, { format: 'feed', frame: plan.at(best) });
  const po = planeAt(over);
  assert.ok(Math.abs(po.x - ph.x) < 3 && Math.abs(po.y - ph.y) < 3, 'lietadlo je nad prvou značkou');
  assert.ok(isWhite(await pixel(over, po.x, po.y)), 'v pohybe lietadlo nad staršou značkou');
  // Diera hneď po momente: lietadlo bledé na poslednej polohe (na značke) — číslo ostáva čitateľné.
  const g = uturnEvent({ gapAfterDive: true });
  const gp = videoPlan(g);
  const gapPiece = gp.pieces.find((p) => p.phase === 'gap');
  const inGap = buildEventCardSvg(g, { format: 'feed', frame: gp.at(framesOf(gp, gapPiece)[0] + 1) });
  const pg = planeAt(inGap);
  assert.equal(pg.opacity, 0.55);
  const [, , blue] = await pixel(inGap, pg.x, pg.y);
  assert.ok(blue < 100, `značka nad bledým lietadlom (modrá ${blue})`);
});

test('čísla v grafe výšky sa neprekrývajú (FZ1073: 1 a 2 deväť sekúnd po sebe), pri pravom okraji vľavo od čiary', async () => {
  const e = await fzCardEvent();
  for (const format of ['og', 'feed']) {
    const svg = buildEventCardSvg(e, { format });
    const size = format === 'feed' ? 16.8 : 12;
    const labels = [...svg.matchAll(new RegExp(`<text x="([\\d.]+)" y="([\\d.]+)" font-size="${size}" font-weight="700"( text-anchor="end")? fill="#ffb020">(\\d+)</text>`, 'g'))]
      .map((m) => {
        const x = Number(m[1]);
        const w = m[4].length * 0.62 * size;
        return { n: m[4], x0: m[3] ? x - w : x, x1: m[3] ? x : x + w, y0: Number(m[2]) - size * 0.75, y1: Number(m[2]) };
      });
    assert.equal(labels.length, 6, format);
    for (let i = 0; i < labels.length; i += 1) {
      for (let j = i + 1; j < labels.length; j += 1) {
        const a = labels[i];
        const b = labels[j];
        const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
        assert.ok(!overlap, `${format}: ${a.n} a ${b.n} sa prekrývajú`);
      }
    }
    const right = CARD_FORMATS[format].w - (format === 'feed' ? 40 : 480 + 30);
    for (const l of labels) assert.ok(l.x1 <= right + 10, `${format}: číslo ${l.n} v ráme grafu`);
  }
});

test('zoznam momentov sa vždy zmestí nad zdroje: veľa momentov = menšie písmo, potom „+ N ďalších"; FZ1073 v og bez zmenšenia', async () => {
  const e = await fzCardEvent();
  const base = keyMoments(e);
  for (const n of [6, 9, 14, 30]) {
    const timeline = Array.from({ length: n }, (_, i) => ({ ...base[i % base.length], t: base[0].t + i * 60 }));
    const many = { ...e, timeline };
    for (const format of ['og', 'feed']) {
      const svg = buildEventCardSvg(many, { format });
      const { body, footTop } = panelTexts(svg, format);
      const lowest = Math.max(...body.map((tx) => tx.y));
      assert.ok(lowest <= footTop - (format === 'feed' ? 20 : 13), `${format}, ${n} momentov: text ${lowest} nad pätou ${footTop}`);
      const listed = body.filter((tx) => /^\d\d:\d\d /.test(tx.text)).length;
      const more = body.find((tx) => tx.text.startsWith('+ '));
      assert.ok(listed >= 1 && listed <= n);
      if (listed < n) assert.equal(more?.text, moreMomentsSk(n - listed), `${format}, ${n}: zvyšok ako „+ N ďalších"`);
      else assert.equal(more, undefined);
    }
  }
  const og = cardListLayout({ moments: base, media: ['JTA', 'The Guardian'], headY: 200, width: 412, baseSize: 17, bottom: 560 });
  assert.deepEqual([og.size, og.more, og.items.length], [17, 0, 6], 'og FZ1073: plné písmo, všetko');
  const tight = cardListLayout({ moments: base, media: [], headY: 200, width: 412, baseSize: 17, bottom: 330 });
  assert.ok(tight.size >= Math.round(17 * 0.8) && tight.last <= 330);
  assert.deepEqual([moreMomentsSk(1), moreMomentsSk(3), moreMomentsSk(5)], ['+ 1 ďalší moment', '+ 3 ďalšie momenty', '+ 5 ďalších momentov']);
});

test('podklad (raz) + vrstva snímky = celý obrázok tej istej snímky (pixely), podklad bez textov', async () => {
  const e = await fzCardEvent();
  const marine = [{ polygons: [[[30, 30], [35, 30], [35, 34], [30, 34]]] }];
  const borders = [[[35, 29], [36, 32]]];
  const plan = videoPlan(e);
  const frame = plan.at(Math.floor(plan.totalFrames / 2));
  const base = buildEventCardSvg(e, { format: 'feed', marine, borders, layers: 'base' });
  assert.ok(!base.includes('<text'), 'podklad bez textov a stopy');
  const overlay = buildEventCardSvg(e, { format: 'feed', layers: 'overlay', frame });
  const composed = await sharp(await sharp(Buffer.from(base)).png().toBuffer()).composite([{ input: Buffer.from(overlay), top: 0, left: 0 }]).removeAlpha().raw().toBuffer();
  const whole = await sharp(Buffer.from(buildEventCardSvg(e, { format: 'feed', marine, borders, frame }))).removeAlpha().raw().toBuffer();
  assert.equal(composed.length, whole.length);
  let diff = 0;
  for (let i = 0; i < whole.length; i += 1) diff += Math.abs(whole[i] - composed[i]);
  assert.ok(diff / whole.length < 0.5, `priemerný rozdiel ${(diff / whole.length).toFixed(3)}`);
});
