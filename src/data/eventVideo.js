// src/data/eventVideo.js — video udalosti (2026-10-01, vlastník: „sprav ale tak, aby sme rovnaký vzorec
// použili aj v budúcnosti"). Všeobecný vzorec pre každú udalosť: tempo sa vypočíta z jej údajov —
//   rozsah      ten istý ako graf výšky na obrázku: od prvého po posledné meranie v okne udalosti
//               (okno = 20 min pred prvým spúšťačom až 20 min po poslednom momente),
//   úvod        krátke zastavenie na prvom meraní,
//   prehrávanie úseky s údajmi trvajú úmerne svojmu času (spolu ~9 s, každý aspoň 0,3 s),
//   moment      pri každom kľúčovom momente sa čas na chvíľu zastaví (značka a riadok zoznamu nastúpia;
//               viac momentov v tej istej sekunde = zastavenie pre každý zvlášť),
//   diera       úsek bez údajov ≥ 5 min prebehne rýchlo (lietadlo stojí na poslednej známej polohe),
//   záver       všetky momenty, médiá a zdroje ako na obrázku udalosti; hodiny a lietadlo ostávajú.
// Snímky kreslí ten istý kód ako obrázok udalosti (eventCard.js s `frame`). Pure.

import { CARD_GAP_S, cardTimeRange } from './eventCard.js';
import { incidentWindow, keyMoments } from './eventPost.js';

export const VIDEO_DEFAULTS = Object.freeze({
  fps: 30,
  introS: 1,
  playS: 9,
  holdS: 1,
  gapS: 0.6,
  minSegmentS: 0.3,
  outroS: 3.5,
});

/** Leží úsek [a, b] celý v diere stopy (dva susedné body ďalej od seba než CARD_GAP_S)? Pure. */
function insideGap(track, a, b) {
  for (let i = 1; i < track.length; i += 1) {
    const p = track[i - 1][0];
    const q = track[i][0];
    if (q - p >= CARD_GAP_S && p <= a && q >= b) return true;
  }
  return false;
}

/**
 * Plán videa udalosti: kúsky (úvod, prehrávanie, diera, moment, záver) s dĺžkou v sekundách a
 * `at(snímka)` → stav snímky pre buildEventCardSvg (`{t, current, pop, showAll, phase}`). Null, keď
 * udalosť nemá stopu v okne. Pure.
 * @param {object} event uložená udalosť (s `track` a `timeline`)
 * @param {Partial<typeof VIDEO_DEFAULTS>} [opts]
 */
export function videoPlan(event, opts = {}) {
  const o = { ...VIDEO_DEFAULTS, ...opts };
  const track = Array.isArray(event?.track) ? event.track : [];
  if (track.length < 2) return null;
  const moments = keyMoments(event);
  const [t0, t1] = cardTimeRange(track, incidentWindow(event, moments));
  if (!(t1 > t0)) return null;

  const anchors = new Set([t0, t1]);
  for (const m of moments) if (m.t > t0 && m.t < t1) anchors.add(m.t);
  for (let i = 1; i < track.length; i += 1) {
    const p = track[i - 1][0];
    const q = track[i][0];
    if (q - p >= CARD_GAP_S && q > t0 && p < t1) {
      if (p > t0) anchors.add(p);
      if (q < t1) anchors.add(q);
    }
  }
  const times = [...anchors].sort((a, b) => a - b);
  const segments = [];
  for (let i = 1; i < times.length; i += 1) segments.push({ from: times[i - 1], to: times[i], gap: insideGap(track, times[i - 1], times[i]) });
  const dataSeconds = segments.filter((s) => !s.gap).reduce((sum, s) => sum + (s.to - s.from), 0);
  // Momenty v danom čase (v poradí; v tej istej sekunde ich môže byť viac).
  const momentsAt = (t) => moments.flatMap((m, i) => (Math.abs(m.t - t) < 1e-6 ? [i] : []));
  const holds = (t) => momentsAt(t).map((i) => ({ kind: 'hold', phase: 'moment', dur: o.holdS, t, moment: i }));

  const pieces = [{ kind: 'hold', phase: 'intro', dur: o.introS, t: t0, moment: null }, ...holds(t0)];
  for (const s of segments) {
    const dur = s.gap ? o.gapS : Math.max(o.minSegmentS, dataSeconds > 0 ? (o.playS * (s.to - s.from)) / dataSeconds : o.minSegmentS);
    pieces.push({ kind: 'move', phase: s.gap ? 'gap' : 'play', dur, from: s.from, to: s.to }, ...holds(s.to));
  }
  pieces.push({ kind: 'hold', phase: 'outro', dur: o.outroS, t: t1, moment: null });

  let start = 0;
  for (const p of pieces) { p.start = start; start += p.dur; }
  const durationS = start;
  const totalFrames = Math.max(1, Math.round(durationS * o.fps));
  const currentAt = (t) => {
    let found = null;
    moments.forEach((m, i) => { if (m.t <= t + 1e-6) found = i; });
    return found;
  };

  return {
    fps: o.fps,
    durationS,
    totalFrames,
    t0,
    t1,
    pieces,
    /** Stav snímky `frame` (0 … totalFrames − 1). V závere nie je zvýraznený žiadny moment (súhrn). */
    at(frame) {
      const vt = Math.min(durationS, Math.max(0, frame / o.fps));
      let piece = pieces[pieces.length - 1];
      for (const p of pieces) { if (vt < p.start + p.dur) { piece = p; break; } }
      const local = Math.min(1, Math.max(0, (vt - piece.start) / Math.max(1e-9, piece.dur)));
      const t = piece.kind === 'move' ? piece.from + (piece.to - piece.from) * local : piece.t;
      const outro = piece.phase === 'outro';
      return {
        t,
        current: piece.phase === 'moment' ? piece.moment : (outro ? null : currentAt(t)),
        pop: piece.phase === 'moment' ? local : null,
        showAll: outro,
        phase: piece.phase,
      };
    },
  };
}
