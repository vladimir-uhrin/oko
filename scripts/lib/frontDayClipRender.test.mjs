// Výber okna akčného záberu: najviac pohybu v obraze (nie počet strihov), bez úvodnej karty, v hraniciach videa;
// záber na výšku (rozhovor) do videa nejde.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLIP_SKIP_START_S, bestWindow, clipUsable } from './frontDayClipRender.mjs';

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

test('bez pohybu: okno po úvode okolo tretiny videa; krátke video sa zmestí', () => {
  const w = bestWindow(frames(30), 30, 4);
  assert.ok(w.start >= CLIP_SKIP_START_S && w.start <= 10, `začiatok ${w.start}`);
  const short = bestWindow(frames(5), 5, 4);
  assert.ok(short.start >= 0 && short.start + short.dur <= 5, JSON.stringify(short));
});

test('záber na výšku (rozhovor, 464×824) vypadne, na šírku ostane', () => {
  assert.equal(clipUsable({ width: 464, height: 824 }), false);
  assert.equal(clipUsable({ width: 1280, height: 720 }), true);
  assert.equal(clipUsable({ width: 0, height: 0 }), false, 'neznámy rozmer');
});
