// src/data/frontWeekVideo.js — plán videa „Týždeň na fronte" (2026-10-03, vlastník: „video v štýle OKO + Rybar").
// Zábery idú za komentárom (frontWeekNarration.js): úvodná karta s háčikom → prehľad frontu → let nad každý
// vybraný smer (KARTA zhora ako mapa Rybar) → koncová karta. Každý záber trvá tak dlho, ako jeho vety
// (dĺžky nahrávok) + nábeh a dozvuk — žiadny záber bez reči, žiadna veta mimo svojho záberu.
// Kamera: prehľad zhora nad celým frontom, smer podľa `frontSceneFraming` (−80°), prelety s nadhľadom
// (krátke vystúpanie, aby bolo vidieť, kam sa letí), v zábere pomalé približovanie. Pure.

import { FRONT_SCENES, frontSceneFraming } from '../ukraineFrontScenes.js';

export const FRONT_WEEK_VIDEO = Object.freeze({
  fps: 30,
  /** Medzera medzi vetami v zábere (s). */
  gapS: 0.35,
  /** Nábeh reči od začiatku záberu (s): karta sa najprv ukáže, kamera priletí. */
  leadS: Object.freeze({ opening: 0.3, overview: 0.6, dir: 1.0, closing: 0.5 }),
  /** Dozvuk záberu po poslednej vete (s). */
  tailS: 0.45,
  /** Najkratší záber (s) — aj bez viet (alebo s krátkou vetou) má oko čas zorientovať sa. */
  minS: Object.freeze({ opening: 3.2, overview: 3.0, dir: 3.6, closing: 3.4 }),
  /** Prelet kamery na začiatku záberu smeru a pri návrate na prehľad (s). */
  flyS: 1.8,
  /** Rezerva za poslednou vetou videa (s). */
  endMarginS: 0.7,
  /** Prelínanie vrstiev popisov (s). */
  fadeS: 0.45,
});

/**
 * Prehľad celého frontu na výšku 1080×1350: takmer kolmo, front od Sumskej oblasti po Cherson v páse
 * medzi hlavičkou a kartou (stred kamery posunutý na juh — spodnú tretinu obrazu kryje karta).
 */
export const OVERVIEW_CAMERA = Object.freeze({ lon: 36.4, lat: 47.75, heightM: 930_000, pitchDeg: -88, headingDeg: 0 });

/** Kamera smeru: rámovanie KARTY (zhora, −80°), posunuté na juh o kúsok výšky záberu (karta dole). Pure. */
export function directionCamera(sceneId, scenes = FRONT_SCENES) {
  const scene = scenes.find((s) => s.id === sceneId);
  if (!scene) return null;
  const f = frontSceneFraming(scene.rectDegrees, { karta: true });
  // Zvislý záber je užší: o 12 % vyššie, aby sa výrez smeru zmestil na šírku; juh o ~8 % výšky záberu.
  const heightM = f.heightM * 1.12;
  const groundHeightDeg = (heightM * 1.155) / 111_320;
  return { lon: f.lon, lat: f.lat - (f.heightM * 0.12 * Math.tan((10 * Math.PI) / 180)) / 111_320 - groundHeightDeg * 0.07, heightM, pitchDeg: f.pitchDeg, headingDeg: 0 };
}

/**
 * Z prekrývajúcich sa popisov mapy (obdĺžniky na obrazovke) ostane ten s vyššou prioritou; vráti indexy tých,
 * ktoré treba skryť. Popis, ktorý sám prehral, už nikoho neskrýva; pri rovnakej priorite vyhrá skôr uvedený.
 * Používa ho nahrávanie pri pohľade z výšky (KYIV, nie BROVARY cez neho). Pure.
 * @param {Array<{x0: number, y0: number, x1: number, y1: number, priority: number}>} boxes
 * @returns {number[]}
 */
export function overlapLosers(boxes) {
  const list = Array.isArray(boxes) ? boxes : [];
  const order = list.map((_, i) => i).sort((a, b) => (list[b].priority - list[a].priority) || (a - b));
  const kept = [];
  const losers = [];
  for (const i of order) {
    const b = list[i];
    if (kept.some((k) => b.x0 < k.x1 && b.x1 > k.x0 && b.y0 < k.y1 && b.y1 > k.y0)) losers.push(i);
    else kept.push(b);
  }
  return losers.sort((a, b) => a - b);
}

const smooth = (t) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;

/** Prelet medzi dvoma kamerami: poloha a sklon plynulo, výška logaritmicky s nadhľadom uprostred. Pure. */
export function flyCamera(a, b, t) {
  const s = smooth(t);
  const kmDist = Math.hypot((b.lon - a.lon) * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180), b.lat - a.lat) * 111.32;
  const hop = Math.min(260_000, kmDist * 1000 * 0.45);
  const base = Math.exp(lerp(Math.log(a.heightM), Math.log(b.heightM), s));
  return {
    lon: lerp(a.lon, b.lon, s), lat: lerp(a.lat, b.lat, s),
    heightM: base + hop * Math.sin(Math.PI * s) * Math.min(1, base / Math.max(a.heightM, b.heightM) + 0.35),
    pitchDeg: lerp(a.pitchDeg, b.pitchDeg, s), headingDeg: lerp(a.headingDeg || 0, b.headingDeg || 0, s),
  };
}

/** Pomalé približovanie v zábere (o `amount` výšky za celý záber). Pure. */
const push = (cam, local, amount) => ({ ...cam, heightM: cam.heightM * (1 - amount * Math.min(1, Math.max(0, local))) });

/**
 * @param {object} model frontWeekModel(...)
 * @param {Array<{id: string, shot: string}>} lines frontWeekLines(model)
 * @param {Record<string, {lead: number, speechEnd: number}>} durations ticho na začiatku a koniec reči (s) podľa id vety
 * @param {object} [opts] FRONT_WEEK_VIDEO
 * @returns {{fps: number, durationS: number, totalFrames: number, shots: Array, placement: Array, at: (frame: number) => object}|null}
 */
export function frontWeekPlan(model, lines, durations, opts = {}) {
  const o = { ...FRONT_WEEK_VIDEO, ...opts };
  const order = [];
  for (const l of lines || []) if (!order.includes(l.shot)) order.push(l.shot);
  if (!order.length) return null;
  const kindOf = (shot) => (shot.startsWith('dir:') ? 'dir' : shot);
  const shots = [];
  const placement = [];
  let t = 0;
  let prevCam = OVERVIEW_CAMERA;
  for (const id of order) {
    const kind = kindOf(id);
    const sceneId = kind === 'dir' ? id.slice(4) : null;
    const cam = kind === 'dir' ? (directionCamera(sceneId) || OVERVIEW_CAMERA) : OVERVIEW_CAMERA;
    const lead = o.leadS[kind] ?? 0.5;
    let cursor = t + lead;
    let first = true;
    for (const l of lines.filter((x) => x.shot === id)) {
      const d = durations?.[l.id];
      if (!d) continue;
      const speechStart = first ? cursor : cursor + o.gapS;
      const speechEnd = speechStart + (d.speechEnd - d.lead);
      placement.push({ id: l.id, shot: id, start: speechStart - d.lead, speechStart, speechEnd });
      cursor = speechEnd;
      first = false;
    }
    const last = id === order[order.length - 1];
    const dur = Math.max(o.minS[kind] ?? 3, cursor - t + (last ? o.endMarginS : o.tailS));
    shots.push({ id, kind, sceneId, start: t, dur, from: prevCam, to: cam });
    prevCam = cam;
    t += dur;
  }
  const durationS = t;
  const totalFrames = Math.max(1, Math.round(durationS * o.fps));
  const fade = (x) => Math.min(1, Math.max(0, x / o.fadeS));

  return {
    fps: o.fps,
    durationS,
    totalFrames,
    shots,
    placement,
    /** Stav snímky `frame` (0 … totalFrames − 1): záber, kamera (`flying` = práve prelieta), viditeľnosť vrstiev popisov. */
    at(frame) {
      const vt = Math.min(durationS, Math.max(0, frame / o.fps));
      let i = shots.findIndex((s) => vt < s.start + s.dur);
      if (i < 0) i = shots.length - 1;
      const shot = shots[i];
      const localS = vt - shot.start;
      const local = Math.min(1, Math.max(0, localS / Math.max(1e-9, shot.dur)));
      let camera;
      // Prelet na začiatku záberu smeru a záveru; inde kamera stojí (len pomaly približuje).
      const flying = (shot.kind === 'dir' || shot.kind === 'closing') && localS < o.flyS;
      if (shot.kind === 'opening') camera = push({ ...OVERVIEW_CAMERA, heightM: OVERVIEW_CAMERA.heightM * 1.08 }, local, 0.04);
      else if (shot.kind === 'overview') camera = push({ ...OVERVIEW_CAMERA, heightM: OVERVIEW_CAMERA.heightM * 1.04 }, local, 0.06);
      else {
        const arrive = shot.kind === 'closing' ? OVERVIEW_CAMERA : shot.to;
        camera = flying ? flyCamera(shot.from, arrive, localS / o.flyS) : push(arrive, (localS - o.flyS) / Math.max(1e-9, shot.dur - o.flyS), shot.kind === 'dir' ? 0.07 : 0.03);
      }
      const opening = shot.kind === 'opening' ? 1 - fade(localS - (shot.dur - o.fadeS)) : 0;
      const endCard = shot.kind === 'closing' ? fade(localS - 0.25) : 0;
      // Hlavná vrstva (hlavička, karta, náhľad): od prehľadu po začiatok koncovej karty.
      const main = shot.kind === 'opening' ? fade(localS - (shot.dur - o.fadeS)) : (shot.kind === 'closing' ? 1 - fade(localS) : 1);
      return {
        vt, frame, shot: { id: shot.id, kind: shot.kind, sceneId: shot.sceneId, index: i }, localS, local, camera, flying,
        layers: { opening, main, endCard },
        // Karta dole patrí záberu; pri výmene smeru krátko nabehne.
        card: shot.kind === 'dir' ? shot.sceneId : (shot.kind === 'overview' || shot.kind === 'opening' ? 'overview' : null),
        cardAlpha: shot.kind === 'dir' || shot.kind === 'overview' ? fade(localS) : 1,
      };
    },
  };
}
