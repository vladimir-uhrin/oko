// src/data/eventVideo.js — video udalosti (2026-10-01, vlastník: „sprav ale tak, aby sme rovnaký vzorec
// použili aj v budúcnosti"). Všeobecný vzorec pre každú udalosť: tempo sa vypočíta z jej údajov —
//   rozsah      ten istý ako graf výšky na obrázku: od prvého po posledné meranie v okne udalosti
//               (okno = 20 min pred prvým spúšťačom až 20 min po poslednom momente),
//   úvod        krátke zastavenie na prvom meraní,
//   prehrávanie úseky s údajmi trvajú úmerne svojmu času (spolu ~7 s, každý aspoň 0,3 s),
//   spomalene   okolie momentov, pri ktorých sa niečo deje v pohybe — strmhlavé klesanie (minúta pred
//               ním), začiatok diery v údajoch, obrat — sa prehrá spomalene (vlastník 10-01: „nie je tam
//               samotný pád"): 3 s na okolie, prekrývajúce sa okolia sa spoja,
//   moment      pri každom kľúčovom momente sa čas na chvíľu zastaví (značka a riadok zoznamu nastúpia;
//               viac momentov v tej istej sekunde = zastavenie pre každý zvlášť),
//   diera       úsek bez údajov ≥ 5 min prebehne rýchlo (lietadlo stojí na poslednej známej polohe);
//               keď sa cez ňu výška zmenila o 5 000 ft a viac (pád bez údajov), trvá 2 s,
//   záver       všetky momenty, médiá a zdroje ako na obrázku udalosti; hodiny a lietadlo ostávajú,
//   otvorenie a koncová karta  (len 3D video, `openingS`/`endCardS`; vlastník 10-01: „potrebujem
//               propagovať doménu aj moje meno ako na webe") — značka OKO, okolive.sk a autor
//               na začiatku a na konci, čas udalosti stojí,
//   podľa správ pristátie, ktoré siete nevideli (eventReported.js, vlastník 10-01: „vydolovať chýbajúce
//               dáta"), dostane po konci údajov vlastné zastavenie `reportedS` — hodiny ukážu čas zo
//               správy, lietadlo ostáva bledé na poslednej polohe (žiadny dopočítaný let).
// Snímky kreslí ten istý kód ako obrázok udalosti (eventCard.js s `frame`) alebo záber z OKO. Pure.

import { CARD_GAP_S, cardTimeRange } from './eventCard.js';
import { incidentWindow, keyMoments } from './eventPost.js';

export const VIDEO_DEFAULTS = Object.freeze({
  fps: 30,
  introS: 1,
  playS: 7,
  /**
   * Predĺženie jednotlivých kúskov plánu: index kúska → sekundy navyše (komentár: eventNarration.fitNarration
   * predĺži len záber, pri ktorom veta znie — spoločné voľby by natiahli aj ostatné a vzniklo by ticho).
   */
  stretch: null,
  holdS: 1,
  gapS: 0.6,
  /** Diera, cez ktorú sa výška zmenila aspoň o gapDropFt (pád bez údajov), trvá gapDropS. */
  gapDropS: 2,
  gapDropFt: 5000,
  minSegmentS: 0.3,
  spotlightS: 3,
  outroS: 3.5,
  /** Zastavenie na pristátí zo správ po konci údajov (značka na letisku, popis s médiami). */
  reportedS: 3,
  /** Otvorenie (značka a názov udalosti) pred úvodom a koncová karta po závere; 0 = bez nich. */
  openingS: 0,
  endCardS: 0,
});

/** Okolie momentu, ktoré sa prehrá spomalene: [sekúnd pred, sekúnd po] v čase údajov. */
export const VIDEO_SPOTLIGHT = Object.freeze({ dive: [60, 15], gap: [30, 0], uturn: [90, 90] });

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
 * Okolia momentov na spomalené prehranie, orezané na rozsah videa a spojené, keď sa prekrývajú.
 * Spojené okolie má čas spotlightS × (1 + 0,5 × počet ďalších momentov v ňom). Pure.
 */
export function spotlightWindows(moments, t0, t1, spotlightS = VIDEO_DEFAULTS.spotlightS) {
  const raw = [];
  for (const m of moments) {
    const span = VIDEO_SPOTLIGHT[m.kind];
    if (!span || !Number.isFinite(m.t)) continue;
    const from = Math.max(t0, m.t - span[0]);
    const to = Math.min(t1, m.t + span[1]);
    if (to > from) raw.push({ from, to, count: 1 });
  }
  raw.sort((a, b) => a.from - b.from);
  const merged = [];
  for (const w of raw) {
    const last = merged[merged.length - 1];
    if (last && w.from <= last.to) { last.to = Math.max(last.to, w.to); last.count += 1; } else merged.push({ ...w });
  }
  return merged.map((w) => ({ from: w.from, to: w.to, budgetS: spotlightS * (1 + 0.5 * (w.count - 1)) }));
}

/**
 * Plán videa udalosti: kúsky (úvod, prehrávanie, spomalene, diera, moment, záver) s dĺžkou v sekundách
 * a `at(snímka)` → stav snímky (`{t, current, pop, showAll, phase}`). Null, keď udalosť nemá stopu
 * v okne. Pure.
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
  // Okraj okolia v diere sa posunie na kraj diery (diera ostane jeden rýchly úsek).
  const holes = [];
  for (let i = 1; i < track.length; i += 1) {
    if (track[i][0] - track[i - 1][0] >= CARD_GAP_S) holes.push([track[i - 1][0], track[i][0], Math.abs((track[i][3] ?? 0) - (track[i - 1][3] ?? 0))]);
  }
  const dropOf = (a, b) => holes.find(([p, q]) => p <= a + 1e-6 && q >= b - 1e-6)?.[2] ?? 0;
  const spots = spotlightWindows(moments, t0, t1, o.spotlightS).map((w) => {
    let { from, to } = w;
    for (const [p, q] of holes) {
      if (to > p && to < q) to = p;
      if (from > p && from < q) from = q;
    }
    return { ...w, from, to };
  }).filter((w) => w.to > w.from);

  const anchors = new Set([t0, t1]);
  for (const m of moments) if (m.t > t0 && m.t < t1) anchors.add(m.t);
  for (const w of spots) { anchors.add(w.from); anchors.add(w.to); }
  for (let i = 1; i < track.length; i += 1) {
    const p = track[i - 1][0];
    const q = track[i][0];
    if (q - p >= CARD_GAP_S && q > t0 && p < t1) {
      if (p > t0) anchors.add(p);
      if (q < t1) anchors.add(q);
    }
  }
  const times = [...anchors].sort((a, b) => a - b);
  const spotOf = (a, b) => spots.find((w) => a >= w.from - 1e-6 && b <= w.to + 1e-6) || null;
  const segments = [];
  for (let i = 1; i < times.length; i += 1) {
    const from = times[i - 1];
    const to = times[i];
    const gap = insideGap(track, from, to);
    segments.push({ from, to, gap, spot: gap ? null : spotOf(from, to) });
  }
  const dataSeconds = segments.filter((s) => !s.gap && !s.spot).reduce((sum, s) => sum + (s.to - s.from), 0);
  for (const w of spots) w.dataS = segments.filter((s) => s.spot === w).reduce((sum, s) => sum + (s.to - s.from), 0);
  // Momenty v danom čase (v poradí; v tej istej sekunde ich môže byť viac).
  const momentsAt = (t) => moments.flatMap((m, i) => (Math.abs(m.t - t) < 1e-6 ? [i] : []));
  const holds = (t) => momentsAt(t).map((i) => ({ kind: 'hold', phase: 'moment', dur: o.holdS, t, moment: i }));

  const pieces = [];
  if (o.openingS > 0) pieces.push({ kind: 'hold', phase: 'opening', dur: o.openingS, t: t0, moment: null });
  pieces.push({ kind: 'hold', phase: 'intro', dur: o.introS, t: t0, moment: null }, ...holds(t0));
  for (const s of segments) {
    let dur;
    let phase;
    if (s.gap) { dur = dropOf(s.from, s.to) >= o.gapDropFt ? o.gapDropS : o.gapS; phase = 'gap'; } else if (s.spot) {
      dur = s.spot.dataS > 0 ? (s.spot.budgetS * (s.to - s.from)) / s.spot.dataS : o.minSegmentS;
      phase = 'spotlight';
    } else {
      dur = Math.max(o.minSegmentS, dataSeconds > 0 ? (o.playS * (s.to - s.from)) / dataSeconds : o.minSegmentS);
      phase = 'play';
    }
    pieces.push({ kind: 'move', phase, dur, from: s.from, to: s.to }, ...holds(s.to));
  }
  // Po konci údajov: momenty zo správ (pristátie) — každý vlastné zastavenie v svojom čase.
  const late = moments.flatMap((m, i) => (m.reported && m.t > t1 + 1e-6 ? [i] : []));
  for (const i of late) pieces.push({ kind: 'hold', phase: 'reported', dur: o.reportedS, t: moments[i].t, moment: i });
  const endT = late.length ? moments[late[late.length - 1]].t : t1;
  pieces.push({ kind: 'hold', phase: 'outro', dur: o.outroS, t: endT, moment: null });
  if (o.endCardS > 0) pieces.push({ kind: 'hold', phase: 'endcard', dur: o.endCardS, t: endT, moment: null });

  if (o.stretch) {
    for (const [i, extra] of Object.entries(o.stretch)) {
      const p = pieces[Number(i)];
      if (p && Number(extra) > 0) p.dur += Number(extra);
    }
  }
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
    spotlights: spots.map(({ from, to, budgetS }) => ({ from, to, budgetS })),
    /** Stav snímky `frame` (0 … totalFrames − 1). V závere nie je zvýraznený žiadny moment (súhrn). */
    at(frame) {
      const vt = Math.min(durationS, Math.max(0, frame / o.fps));
      let piece = pieces[pieces.length - 1];
      for (const p of pieces) { if (vt < p.start + p.dur) { piece = p; break; } }
      const local = Math.min(1, Math.max(0, (vt - piece.start) / Math.max(1e-9, piece.dur)));
      const t = piece.kind === 'move' ? piece.from + (piece.to - piece.from) * local : piece.t;
      // Záver a koncová karta: súhrn bez zvýraznenia; otvorenie: ešte nič nenastalo.
      const outro = piece.phase === 'outro' || piece.phase === 'endcard';
      // Zastavenie na momente zo správ: značka nastúpi za prvú tretinu zastavenia, potom stojí.
      const held = piece.phase === 'moment' || piece.phase === 'reported';
      return {
        t,
        current: held ? piece.moment : (outro || piece.phase === 'opening' ? null : currentAt(t)),
        pop: piece.phase === 'moment' ? local : (piece.phase === 'reported' ? Math.min(1, local * 3) : null),
        showAll: outro,
        phase: piece.phase,
        vt,
      };
    },
  };
}
