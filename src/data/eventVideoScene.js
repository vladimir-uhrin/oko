// src/data/eventVideoScene.js — 3D video udalosti v štýle OKO (2026-10-01, vlastník: „chcel by som to
// v OKO style", „nie je tam samotný pád", „chýba tam moje logo"). Čistá časť záberu z OKO: pre každú
// snímku plánu (eventVideo.js) poloha lietadla, preletená časť stopy, momenty, diery a kamera.
//
// Kamera (všeobecne pre každú udalosť, z údajov):
//   úvod a záver  celý región udalosti zošikma, kolmo na hlavný smer letu (z tej strany, ktorá je bližšie
//                 pohľadu na sever), záber posunutý nad kartu dole,
//   let           sleduje lietadlo zboku z ~88 km,
//   spomalene     strmhlavé klesanie zboku a zblízka, obrat skôr zhora (vidieť tvar otočky), začiatok
//                 diery zboku — záber medzi stredom okolia a lietadlom (lietadlo je vždy v zábere),
//   diera s pádom záber na celú čiarkovanú čiaru (oba konce) zboku; kamera prejde po nej, lietadlo
//                 ostáva bledé na poslednej známej polohe (nič sa nedomýšľa),
//   prechody      plynulé (váhy záberov podľa času videa, nie času udalosti — kamera neskáče).
// Pure — Cesium a prehliadač rieši src/eventVideoCapture.js, obraz skladá scripts/capture-event-video.mjs.

import { CARD_GAP_S, cardTimeRange, trackStateAt } from './eventCard.js';
import { incidentWindow, keyMoments } from './eventPost.js';

export const FT_M = 0.3048;
const R_KM = 6371;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;
/** Uhol do (−180, 180]. Pure. */
export const normDeg = (d) => ((((d % 360) + 540) % 360) - 180);
const smooth = (x) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
const ramp = (vt, a, b, inS, outS) => Math.min(smooth((vt - (a - inS)) / inS), 1 - smooth((vt - b) / outS));
/** Vzdialenosť v km (rovina so stredným kosínusom — stačí na desiatky až stovky km). Pure. */
export const distKm = (a, b) => Math.hypot(toRad(b.lon - a.lon) * R_KM * Math.cos(toRad((a.lat + b.lat) / 2)), toRad(b.lat - a.lat) * R_KM);
/** Azimut z bodu stopy p do q (stupne od severu). Pure. */
export const bearingDeg = (p, q) => normDeg(toDeg(Math.atan2(toRad(q[2] - p[2]) * Math.cos(toRad((p[1] + q[1]) / 2)), toRad(q[1] - p[1]))));

/** Nastavenia záberov (stupne, metre). */
export const VIDEO_CAMERA = Object.freeze({
  follow: { pitch: -27, rangeM: 88_000 },
  wide: { pitch: -45, rangeFactor: 2.4, lookDownIntro: 9, lookDownOutro: 13 },
  dive: { pitch: -11, minRangeM: 40_000, perKmM: 3600, altShare: 0.55 },
  uturn: { pitch: -55, minRangeM: 45_000, perKmM: 3400, altShare: 0.3 },
  gap: { pitch: -20, minRangeM: 45_000, perKmM: 3400, altShare: 0.5 },
  gapDrop: { pitch: -16, minRangeM: 60_000, perKmM: 1700, minDropFt: 5000 },
});

/**
 * Scéna 3D videa udalosti pre plán `plan` (videoPlan). Null bez plánu.
 * @param {object} event uložená udalosť (track [[t, lat, lon, altFt]], timeline)
 * @param {object} plan videoPlan(event)
 */
export function eventVideoScene(event, plan) {
  if (!plan) return null;
  const track = event.track;
  const moments = keyMoments(event);
  const [t0, t1] = cardTimeRange(track, incidentWindow(event, moments));
  const focus = track.filter((p) => p[0] >= t0 && p[0] <= t1);
  const center = { lat: focus.reduce((s, p) => s + p[1], 0) / focus.length, lon: focus.reduce((s, p) => s + p[2], 0) / focus.length };
  // Hlavný smer stopy (hlavná os rozptylu) → kamera kolmo naň.
  const kx = Math.cos(toRad(center.lat));
  const xy = focus.map((p) => [toRad(p[2] - center.lon) * R_KM * kx, toRad(p[1] - center.lat) * R_KM]);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of xy) { sxx += x * x; syy += y * y; sxy += x * y; }
  const axisBearing = 90 - toDeg(0.5 * Math.atan2(2 * sxy, sxx - syy));
  const sides = [normDeg(axisBearing + 90), normDeg(axisBearing - 90)];
  const heading = Math.abs(sides[0]) <= Math.abs(sides[1]) ? sides[0] : sides[1];
  const extentKm = Math.max(1, ...xy.map(([x, y]) => Math.hypot(x, y)));
  const sideOf = (bear) => {
    const c = [normDeg(bear + 90), normDeg(bear - 90)];
    return Math.abs(normDeg(c[0] - heading)) <= Math.abs(normDeg(c[1] - heading)) ? c[0] : c[1];
  };

  /** Výška stopy v čase t (ft) — značky momentov sedia na čiare. */
  const trackAltAt = (t) => {
    const st = trackStateAt(track, t);
    const a = track[st.i];
    const b = track[Math.min(st.i + 1, track.length - 1)];
    if (st.inGap || a[3] == null || b[3] == null) return a[3] ?? 0;
    return a[3] + (b[3] - a[3]) * st.f;
  };
  /** Lietadlo v čase t: medzi meraniami priamo, v diere a po konci údajov bledé na poslednej polohe. */
  const planeAt = (t) => {
    const st = trackStateAt(track, t);
    const a = track[st.i];
    const b = track[Math.min(st.i + 1, track.length - 1)];
    const prev = track[Math.max(0, st.i - 1)];
    if (!st.inGap && !st.after && st.i + 1 < track.length) {
      const f = st.f;
      const altFt = a[3] != null && b[3] != null ? a[3] + (b[3] - a[3]) * f : (a[3] ?? b[3]);
      return { lat: a[1] + (b[1] - a[1]) * f, lon: a[2] + (b[2] - a[2]) * f, altFt, trk: bearingDeg(a, b), dim: false, gap: false, ended: false, i: st.i, measuredFt: f < 0.5 ? a[3] : b[3] };
    }
    return { lat: a[1], lon: a[2], altFt: a[3], trk: bearingDeg(prev, a), dim: true, gap: st.inGap, ended: st.i === track.length - 1, i: st.i, measuredFt: a[3] };
  };

  const gaps = [];
  for (let i = 1; i < track.length; i += 1) {
    const a = track[i - 1];
    const b = track[i];
    if (b[0] - a[0] < CARD_GAP_S || b[0] <= t0 || a[0] >= t1) continue;
    const piece = plan.pieces.find((p) => p.phase === 'gap' && p.from >= a[0] - 1e-6 && p.to <= b[0] + 1e-6) || null;
    gaps.push({
      i, fromT: a[0], toT: b[0], a, b, piece,
      mid: { lat: (a[1] + b[1]) / 2, lon: (a[2] + b[2]) / 2, altM: (((a[3] ?? 0) + (b[3] ?? 0)) / 2) * FT_M },
      dFt: (b[3] ?? 0) - (a[3] ?? 0),
      lenKm: distKm({ lat: a[1], lon: a[2] }, { lat: b[1], lon: b[2] }),
    });
  }
  const C = VIDEO_CAMERA;
  const spots = (plan.spotlights || []).map((w) => {
    const inWin = track.filter((p) => p[0] >= w.from - 1e-6 && p[0] <= w.to + 1e-6);
    if (!inWin.length) return null;
    const kinds = moments.filter((m) => m.t >= w.from - 1 && m.t <= w.to + 1).map((m) => m.kind);
    const kind = kinds.includes('dive') ? 'dive' : (kinds.includes('uturn') ? 'uturn' : 'gap');
    const c = { lat: inWin.reduce((s, p) => s + p[1], 0) / inWin.length, lon: inWin.reduce((s, p) => s + p[2], 0) / inWin.length };
    const altFt = inWin.reduce((s, p) => s + (p[3] ?? 0), 0) / inWin.length;
    const radiusKm = Math.max(...inWin.map((p) => distKm(c, { lat: p[1], lon: p[2] })));
    const pieces = plan.pieces.filter((p) => (p.phase === 'spotlight' && p.from >= w.from - 1e-6 && p.to <= w.to + 1e-6)
      || (p.phase === 'moment' && p.t >= w.from - 1e-6 && p.t <= w.to + 1e-6));
    const cfg = C[kind];
    // Pokojný záber celého okolia (nehýbe sa): vstup lietadla do okolia je v zábere už pri prechode.
    return {
      kind,
      vStart: Math.min(...pieces.map((p) => p.start)),
      vEnd: Math.max(...pieces.map((p) => p.start + p.dur)),
      pose: {
        lat: c.lat, lon: c.lon, altM: altFt * FT_M * cfg.altShare, pitch: cfg.pitch, range: Math.max(cfg.minRangeM, radiusKm * cfg.perKmM),
        heading: kind === 'dive' ? sideOf(bearingDeg(inWin[0], inWin[inWin.length - 1])) : heading,
      },
    };
  }).filter(Boolean);
  const SPOT_IN_S = 1.4;
  const SPOT_OUT_S = 1.2;
  const playStart = plan.pieces.find((p) => p.phase !== 'intro')?.start ?? 0;
  const outroStart = plan.pieces[plan.pieces.length - 1].start;

  /** Kamera snímky: vážený priemer záberov (uhly cez sin/cos). */
  function cameraAt(vt, plane) {
    const wIntro = 1 - smooth((vt - playStart) / 1.4);
    const wOutro = smooth((vt - outroStart) / 1.6);
    let tgt = { lat: plane.lat, lon: plane.lon, altFt: plane.altFt ?? 0 };
    for (const g of gaps) {
      const p = g.piece;
      if (p && vt >= p.start && vt < p.start + p.dur) {
        const f = smooth((vt - p.start) / p.dur);
        tgt = { lat: g.a[1] + (g.b[1] - g.a[1]) * f, lon: g.a[2] + (g.b[2] - g.a[2]) * f, altFt: (g.a[3] ?? 0) + ((g.b[3] ?? 0) - (g.a[3] ?? 0)) * f };
      }
    }
    const wide = (lookDown) => ({ lat: center.lat, lon: center.lon, altM: 3000, pitch: C.wide.pitch, range: extentKm * 1000 * C.wide.rangeFactor, heading, lookDown });
    const poses = [[wIntro, wide(C.wide.lookDownIntro)], [wOutro, wide(C.wide.lookDownOutro)]];
    for (const s of spots) poses.push([ramp(vt, s.vStart, s.vEnd, SPOT_IN_S, SPOT_OUT_S) * (1 - wIntro) * (1 - wOutro), s.pose]);
    for (const g of gaps) {
      if (!g.piece || Math.abs(g.dFt) < C.gapDrop.minDropFt) continue;
      poses.push([ramp(vt, g.piece.start, g.piece.start + g.piece.dur, 0.5, 0.8) * (1 - wOutro), {
        lat: g.mid.lat, lon: g.mid.lon, altM: g.mid.altM * 0.5, pitch: C.gapDrop.pitch,
        range: Math.max(C.gapDrop.minRangeM, g.lenKm * C.gapDrop.perKmM), heading: sideOf(bearingDeg(g.a, g.b)),
      }]);
    }
    const used = Math.min(1, poses.reduce((s, [w]) => s + w, 0));
    poses.push([Math.max(0, 1 - used), { lat: tgt.lat, lon: tgt.lon, altM: tgt.altFt * FT_M * 0.5, pitch: C.follow.pitch, range: C.follow.rangeM, heading, lookDown: 0 }]);
    const sum = poses.reduce((s, [w]) => s + w, 0) || 1;
    const blend = (k, f = (v) => v) => poses.reduce((s, [w, p]) => s + (w / sum) * f(p[k] ?? 0), 0);
    const hx = poses.reduce((s, [w, p]) => s + (w / sum) * Math.cos(toRad(p.heading)), 0);
    const hy = poses.reduce((s, [w, p]) => s + (w / sum) * Math.sin(toRad(p.heading)), 0);
    return { lat: blend('lat'), lon: blend('lon'), altM: blend('altM'), heading: toDeg(Math.atan2(hy, hx)), pitch: blend('pitch'), range: Math.exp(blend('range', Math.log)), lookDown: blend('lookDown') };
  }

  return {
    t0,
    t1,
    center,
    heading,
    extentKm,
    gaps,
    spots,
    moments,
    /** Dáta pre scénu v prehliadači (src/eventVideoCapture.js): stopa v metroch, momenty na čiare stopy. */
    sceneData() {
      return {
        track: track.map((p) => [p[0], p[1], p[2], (p[3] ?? 0) * FT_M]),
        focusFrom: t0,
        focusTo: t1,
        gapS: CARD_GAP_S,
        moments: moments.map((m) => ({ lat: m.lat, lon: m.lon, altM: trackAltAt(m.t) * FT_M })),
      };
    },
    /** Stav snímky `frame`. */
    frame(frame) {
      const s = plan.at(frame);
      const vt = frame / plan.fps;
      const plane = planeAt(s.t);
      return {
        s,
        vt,
        plane,
        flown: plane.i,
        moments: moments.map((m, i) => ({ show: m.t <= s.t + 1e-6, pop: s.current === i && Number.isFinite(s.pop) ? s.pop : null })),
        gapsShown: gaps.map((g) => s.t >= g.fromT - 1e-6),
        camera: cameraAt(vt, plane),
        ghost: Math.max(0, 1 - smooth((vt - playStart) / 1.2)),
      };
    },
  };
}
