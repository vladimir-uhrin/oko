// Výber okna akčného záberu: najviac pohybu v obraze (nie počet strihov), bez úvodnej karty, v hraniciach videa;
// záber na výšku (rozhovor) do videa nejde.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLIP_SKIP_START_S, actionScore, bestWindow, clipUsable, contentEndOf, parseFrameStats, photoPixel } from './frontDayClipRender.mjs';

/** Snímky 5/s: pokojný základ, v zadaných úsekoch iný rozdiel snímok. */
function frames(total, spans = []) {
  const out = [];
  for (let t = 0; t < total; t += 0.2) {
    const span = spans.find(([a, b]) => t >= a && t < b);
    out.push([Math.round(t * 10) / 10, span ? span[2] : 0.01]);
  }
  return out;
}

test('okno s najväčším pohybom, nie úvod s titulkovou kartou', () => {
  const w = bestWindow(frames(30, [[0, 2, 0.2], [14, 19, 0.09]]), 30, 4);
  assert.ok(w.start >= 14 && w.start <= 15, `začiatok ${w.start}`);
  assert.equal(w.dur, 4);
});

test('rozhovor prestrihaný zábermi: strihy (hovoriaca hlava) neprebijú súvislý pohyb', () => {
  // 6–10 s: hlava so 4 strihmi (rozdiel 0,6), 20–24 s: štart dronu (súvislý pohyb 0,08).
  const talk = frames(30, [[6, 10, 0.012], [20, 24, 0.08]]).map(([t, v]) => ([6.4, 7.4, 8.4, 9.4].includes(t) ? [t, 0.6] : [t, v]));
  const w = bestWindow(talk, 30, 4);
  assert.ok(w.start >= 19.5 && w.start <= 20.5, `začiatok ${w.start}`);
});

test('zásah pred koncom, nie ruky na ovládači na začiatku; statické logo na konci sa nepočíta (ArmyInform, 2026-10-06)', () => {
  // 52,5 s: ruky na ovládači 6–9 s (pohyb 0,08), záber z dronu a zásah 40–47 s (0,06), logo 50–52,5 s (statické).
  const radar = frames(52.5, [[6, 9, 0.08], [40, 47, 0.06], [50, 52.6, 0.004]]);
  assert.ok(Math.abs(contentEndOf(radar, 52.5) - 47) < 0.5, `koniec obsahu = posledný pohyb, ${contentEndOf(radar, 52.5)}`);
  const w = bestWindow(radar, 52.5, 6.2);
  assert.ok(w.start >= 39 && w.start + w.dur <= 47.5, `okno ${w.start}–${w.start + w.dur}`);
});

test('akcia, nie ruky: farebný detail ovládača a tmavá karta prehrajú so záberom z dronu bez farby', () => {
  // [čas, pohyb, sýtosť, jas]: ruky (silný pohyb, farba 12), termovízia (menší pohyb, bez farby), čierna karta.
  const hands = [7, 0.2, 12, 100];
  const thermal = [40, 0.04, 1, 110];
  const dark = [48, 0.12, 1, 23];
  assert.ok(actionScore(thermal) > actionScore(hands), `${actionScore(thermal)} vs ${actionScore(hands)}`);
  assert.ok(actionScore(thermal) > actionScore(dark));
  assert.ok(actionScore([1, 0.6, 3, 90]) < actionScore(thermal), 'strih nie je akcia');
  assert.equal(actionScore([1, 0.03]), 0.03, 'bez sýtosti a jasu = len pohyb');
});

test('výpis ffmpeg: tri metadata=print tej istej snímky = jedna snímka', () => {
  const log = [
    'frame:0    pts:0       pts_time:0', 'lavfi.scene_score=0.000000',
    'frame:0    pts:0       pts_time:0', 'lavfi.signalstats.SATAVG=4.25',
    'frame:0    pts:0       pts_time:0', 'lavfi.signalstats.YAVG=96.1',
    'frame:1    pts:1       pts_time:0.2', 'lavfi.scene_score=0.081',
    'frame:1    pts:1       pts_time:0.2', 'lavfi.signalstats.SATAVG=12',
    'frame:1    pts:1       pts_time:0.2', 'lavfi.signalstats.YAVG=40',
  ].join('\n');
  assert.deepEqual(parseFrameStats(log), [[0, 0, 4.25, 96.1], [0.2, 0.081, 12, 40]]);
});

test('bez pohybu: okno v hraniciach videa po úvode; krátke video sa zmestí', () => {
  const w = bestWindow(frames(30), 30, 4);
  assert.ok(w.start >= CLIP_SKIP_START_S && w.start + w.dur <= 30, `začiatok ${w.start}`);
  const short = bestWindow(frames(5), 5, 4);
  assert.ok(short.start >= 0 && short.start + short.dur <= 5, JSON.stringify(short));
});

test('fotka zo satelitu: bod požiaru a Soči na správnom mieste snímky (bbox Copernicus)', () => {
  const bbox = [39.25, 43.52, 39.75, 43.75];
  const fire = photoPixel(bbox, 39.4675, 43.6362, 2500, 1600);
  assert.ok(Math.abs(fire.x - 1087.5) < 1 && Math.abs(fire.y - 791.2) < 1, JSON.stringify(fire));
  const corner = photoPixel(bbox, 39.25, 43.75, 2500, 1600);
  assert.deepEqual([corner.x, corner.y], [0, 0], 'severozápadný roh = ľavý horný');
});

test('záber na výšku (rozhovor, 464×824) vypadne, na šírku ostane', () => {
  assert.equal(clipUsable({ width: 464, height: 824 }), false);
  assert.equal(clipUsable({ width: 1280, height: 720 }), true);
  assert.equal(clipUsable({ width: 0, height: 0 }), false, 'neznámy rozmer');
});

test('dlhší akčný záber = dva najdynamickejšie úseky v čase za sebou; krátky = jeden', async () => {
  const { clipCuts } = await import('./frontDayClipRender.mjs');
  const fr = (total, spans) => { const out = []; for (let t = 0; t < total; t += 0.2) { const s = spans.find(([a, b]) => t >= a && t < b); out.push([Math.round(t * 10) / 10, s ? s[2] : 0.01, 2, 90]); } return out; };
  const frames = fr(40, [[8, 10, 0.05], [30, 32, 0.045]]);
  const parts = clipCuts(frames, 40, 3.6);
  assert.equal(parts.length, 2);
  assert.ok(parts[0].start < parts[1].start, 'v čase za sebou');
  assert.ok(parts.every((p) => Math.abs(p.dur - 1.8) < 1e-9));
  assert.ok(parts.some((p) => p.start >= 7 && p.start <= 9) && parts.some((p) => p.start >= 29 && p.start <= 31), JSON.stringify(parts));
  assert.equal(clipCuts(frames, 40, 2).length, 1, 'krátky záber jeden úsek');
});
