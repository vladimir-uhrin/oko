// src/data/eventVideoAudio.js — zvuk videa udalosti (2026-10-03): hlas vlastníka po vetách na časoch
// z eventNarration.fitNarration, hudba z knižnice (Pixabay, bez nutnej atribúcie) natiahnutá slučkou
// hudobnej frázy na dĺžku videa a stlmená pod hlasom (sidechain), výsledok −16 LUFS (dva prechody
// loudnorm). Tu sa len SKLADÁ graf filtrov ffmpeg a plán hudby; spúšťa ho scripts/lib/eventVideoPipeline.mjs. Pure.

/** Hlasitosť a stlmenie (overené pri FZ1073: pod rečou ~−10 dB, medzi vetami hudba ≈ hlas). */
export const AUDIO_DEFAULTS = Object.freeze({
  targetLufs: -16, truePeak: -1.5, lra: 11,
  musicGain: 0.4, duck: { threshold: 0.025, ratio: 6, attackMs: 15, releaseMs: 450 },
  fadeInS: 0.15, crossfadeS: 0.03, tempoMin: 0.94, tempoMax: 1.06,
});

/**
 * Plán hudby na dĺžku videa: hlava [0, loop.to], k× slučka [loop.from, loop.to] (celé hudobné frázy),
 * chvost [loop.to, koniec] so záverom; k sa volí tak, aby tempo (zostrih / cieľ) bolo čo najbližšie k 1
 * v medziach tempoMin–tempoMax. Pure.
 * @param {{durationS: number, loop: {from: number, to: number}}} track metaúdaje skladby
 * @param {number} targetS dĺžka videa
 * @returns {{segments: Array<[number, number|null]>, splicedS: number, tempo: number, loops: number}}
 */
export function musicPlan(track, targetS, o = AUDIO_DEFAULTS) {
  const { durationS, loop } = track;
  const loopLen = loop.to - loop.from;
  if (!(loopLen > 0) || !(durationS > loop.to)) throw new Error('skladba potrebuje slučku vnútri trvania');
  const base = durationS;
  let best = null;
  for (let k = 0; k <= 40; k += 1) {
    const spliced = base + k * loopLen - o.crossfadeS * (k + 1);
    const tempo = spliced / targetS;
    const score = Math.abs(Math.log(tempo));
    if (!best || score < best.score) best = { k, spliced, tempo, score };
    if (spliced > targetS * 1.2) break;
  }
  const segments = [[0, loop.to]];
  for (let i = 0; i < best.k; i += 1) segments.push([loop.from, loop.to]);
  segments.push([loop.to, null]);
  const tempo = Math.min(o.tempoMax, Math.max(o.tempoMin, best.tempo));
  return { segments, splicedS: best.spliced, tempo, loops: best.k };
}

/**
 * Graf ffmpeg: vety hlasu (vstupy 0…n−1) na časoch `placement[i].start`, hudba (vstup n) podľa plánu,
 * stlmenie pod hlasom; výstup `[mix]` v dĺžke `totalS`. `tail` pripojí za mix (loudnorm). Pure.
 * @param {{placement: Array<{start: number}>, totalS: number, music: ReturnType<typeof musicPlan>|null, tail?: string}} p
 */
export function audioGraph({ placement, totalS, music, tail = '' }, o = AUDIO_DEFAULTS) {
  const n = placement.length;
  const T = totalS.toFixed(3);
  const parts = placement.map((p, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=mono,adelay=${Math.round(p.start * 1000)}:all=1[v${i}]`);
  const voiceMix = `${placement.map((_, i) => `[v${i}]`).join('')}amix=inputs=${n}:normalize=0:duration=longest,apad=whole_dur=${T},atrim=0:${T},aformat=channel_layouts=stereo,asplit=2[vo][vsc]`;
  if (!music) return [...parts, voiceMix.replace('asplit=2[vo][vsc]', `[mix]${tail}`)].join(';');
  const segs = music.segments;
  const segChain = segs.map(([a, b], k) => `[ms${k}]atrim=${a}${b === null ? '' : `:${b}`},asetpts=PTS-STARTPTS[mg${k}]`).join(';');
  let xf = '[mg0]';
  for (let k = 1; k < segs.length; k += 1) xf += `[mg${k}]acrossfade=d=${o.crossfadeS}:c1=tri:c2=tri${k < segs.length - 1 ? `[mx${k}];[mx${k}]` : ''}`;
  const musicChain = `[${n}:a]aresample=48000,asplit=${segs.length}${segs.map((_, k) => `[ms${k}]`).join('')};${segChain};`
    + `${xf},atempo=${music.tempo.toFixed(5)},apad=whole_dur=${T},atrim=0:${T},afade=t=in:st=0:d=${o.fadeInS},volume=${o.musicGain}[mus]`;
  const duck = `[mus][vsc]sidechaincompress=threshold=${o.duck.threshold}:ratio=${o.duck.ratio}:attack=${o.duck.attackMs}:release=${o.duck.releaseMs}:makeup=1[duck]`;
  const mix = `[vo][duck]amix=inputs=2:normalize=0:duration=first[mix]${tail}`;
  return [...parts, voiceMix, musicChain, duck, mix].join(';');
}

/** loudnorm: 1. prechod (meranie) a 2. prechod (lineárne na cieľ) z nameraných hodnôt. Pure. */
export function loudnormArgs(measured = null, o = AUDIO_DEFAULTS) {
  const base = `loudnorm=I=${o.targetLufs}:TP=${o.truePeak}:LRA=${o.lra}`;
  if (!measured) return `${base}:print_format=json`;
  return `${base}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true:print_format=json`;
}

/** Ticho na začiatku a koniec reči z výpisu `silencedetect` (ffmpeg): `{lead, speechEnd, pauses}`. Pure. */
export function speechBounds(silenceLog, durationS, { minLeadS = 0.05 } = {}) {
  const spans = [];
  let start = null;
  for (const m of String(silenceLog || '').matchAll(/silence_(start|end): ([0-9.]+)/g)) {
    if (m[1] === 'start') start = Number(m[2]);
    else if (start !== null) { spans.push([start, Number(m[2])]); start = null; }
  }
  if (start !== null) spans.push([start, durationS]);
  const lead = spans.length && spans[0][0] <= minLeadS ? spans[0][1] : 0;
  const last = spans.length && Math.abs(spans[spans.length - 1][1] - durationS) < 0.02 ? spans[spans.length - 1] : null;
  const speechEnd = last && last[0] > lead ? last[0] : durationS;
  const pauses = spans.filter((s) => s[0] > lead && (!last || s !== last)).map(([a, b]) => ({ from: a, to: b }));
  return { lead, speechEnd, pauses };
}
