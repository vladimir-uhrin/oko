// src/data/frontDayVideo.js — plán denného videa „Deň na fronte" (2026-10-05). Natívne 9:16 (1080×1920, Reels
// odporúčanie Mety), háčik od prvej snímky (reč začína hneď, karta bez veľkého loga), rýchlejšie tempo než
// týždeň (kratšie nábehy a prelety — Meta: dopozeranie). Zábery idú za vetami komentára (frontDayNarration.js):
// 'opening' (karta s háčikom nad mapou miesta príbehu), 'overview' (celý front), 'dir:<smer>' (prelet nad smer),
// 'clip:<i>' (akčný záber ArmyInform — mapa sa vtedy nenahráva, záber sa vloží po nahrávaní), 'air' (celá
// Ukrajina pri nočnej hrozbe z neba a úderoch), 'closing' (koncová karta). Kamery: pri výške má Cesium 60° na
// zvislej osi, vodorovne len ~36° — kamera je vyššie než v týždennom videu 4:5, aby sa front zmestil na šírku. Pure.

import { directionCamera, flyCamera } from './frontWeekVideo.js';

/** Formát denného videa (natívne Reels). */
export const FRONT_DAY_FORMAT = Object.freeze({ w: 1080, h: 1920 });

export const FRONT_DAY_VIDEO = Object.freeze({
  fps: 30,
  gapS: 0.3,
  /** Nábeh reči od začiatku záberu (s) — háčik začína takmer hneď (prvé 3 sekundy). */
  leadS: Object.freeze({ opening: 0.15, overview: 0.45, dir: 0.85, clip: 0.3, air: 0.6, strike: 0.5, spot: 0.6, closing: 0.35 }),
  tailS: 0.35,
  minS: Object.freeze({ opening: 2.8, overview: 2.6, dir: 3.2, clip: 3.6, air: 3.0, strike: 3.4, spot: 3.2, closing: 3.0 }),
  // Dosah (2026-10-07): kratšie prelety a výraznejší dolet kamery v každom zábere — pohyb drží dopozeranie.
  flyS: 1.1,
  endMarginS: 0.6,
  fadeS: 0.35,
  /** Zvislý záber: výrez smeru je užší → kamera o toľko vyššie než rámovanie KARTY. */
  dirHeightScale: 1.38,
  /** Dolet kamery v zábere (podiel výšky): úvod, smer/miesto, ostatné. */
  openingPush: 0.16,
  shotPush: Object.freeze({ dir: 0.14, spot: 0.14, other: 0.1 }),
});

/**
 * Tempo videa v2 (2026-10-10, „videá sú slabučké"): reč skoro hneď po strihu, kratšie minimá záberov (strih každé
 * 2–3 s), krátka koncová karta a výrazný dolet kamery v úvode (háčik v pohybe, nie stojaca karta).
 */
export const FRONT_DAY_VIDEO_V2 = Object.freeze({
  ...FRONT_DAY_VIDEO,
  gapS: 0.15,
  leadS: Object.freeze({ opening: 0.08, overview: 0.2, dir: 0.45, clip: 0.12, air: 0.25, strike: 0.25, spot: 0.3, closing: 0.15 }),
  tailS: 0.18,
  minS: Object.freeze({ opening: 2.2, overview: 2.0, dir: 2.4, clip: 2.6, air: 2.2, strike: 2.6, spot: 2.4, closing: 2.4 }),
  flyS: 0.8,
  // Koncová karta ostane po hlase ~2 s, kým hudba stíchne (0,3 s pôsobilo odseknuto, 10. 10.).
  endMarginS: 2.1,
  openingPush: 0.42,
  shotPush: Object.freeze({ dir: 0.2, spot: 0.2, other: 0.14 }),
});

/** Celý front na výšku (Sumy → Cherson, Luhansk): stred mierne na sever, nech front leží pod hlavičkou. */
export const DAY_OVERVIEW_CAMERA = Object.freeze({ lon: 36.2, lat: 48.35, heightM: 1_060_000, pitchDeg: -88, headingDeg: 0 });
/** Celá Ukrajina (nočná hrozba z neba): Zakarpatsko → Luhansk na šírku. */
export const DAY_UKRAINE_CAMERA = Object.freeze({ lon: 31.4, lat: 48.7, heightM: 2_250_000, pitchDeg: -89, headingDeg: 0 });

/**
 * Kamera záberu útoku: miesto s obeťami zblízka, pri dvoch miestach stred a výška podľa ich rozostupu
 * (2026-10-10: celá Ukrajina → štítok „Záporožie · 5 mŕtvych" bol drobný). Null bez miest. Pure.
 */
export function strikeCamera(casualties) {
  const pts = (casualties?.places || []).filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon)).slice(0, 2);
  if (!pts.length) return null;
  const lat = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
  const lon = pts.reduce((a, p) => a + p.lon, 0) / pts.length;
  let spanKm = 0;
  if (pts.length === 2) {
    const dx = (pts[1].lon - pts[0].lon) * 111.32 * Math.cos((lat * Math.PI) / 180);
    const dy = (pts[1].lat - pts[0].lat) * 110.57;
    spanKm = Math.hypot(dx, dy);
  }
  // Na výšku je vodorovný výrez ≈ 0,65 × výška kamery; miesta majú zabrať najviac ~60 % šírky.
  const heightM = Math.round(Math.min(DAY_UKRAINE_CAMERA.heightM, Math.max(380_000, (spanKm * 1000) / 0.39)));
  return { lon, lat, heightM, pitchDeg: -89, headingDeg: 0 };
}

/** Kamera smeru na výšku (rámovanie KARTY, vyššie). Pure. */
export function dayDirectionCamera(sceneId, opts = FRONT_DAY_VIDEO) {
  const c = directionCamera(sceneId);
  return c ? { ...c, heightM: c.heightM * opts.dirHeightScale } : null;
}

/** Kamera úvodnej karty: miesto príbehu dňa (smer zmeny), pri hrozbe z neba celá Ukrajina, inak front. Pure. */
export function openingCamera(story, focusSceneId, opts = FRONT_DAY_VIDEO) {
  if (story === 'air' || story === 'strike') return DAY_UKRAINE_CAMERA;
  if ((story === 'ru' || story === 'ua') && focusSceneId) return dayDirectionCamera(focusSceneId, opts) || DAY_OVERVIEW_CAMERA;
  return DAY_OVERVIEW_CAMERA;
}

const push = (cam, local, amount) => ({ ...cam, heightM: cam.heightM * (1 - amount * Math.min(1, Math.max(0, local))) });
const kindOf = (shot) => (shot.startsWith('dir:') ? 'dir' : shot.startsWith('clip:') ? 'clip' : shot.startsWith('spot:') ? 'spot' : shot);

/**
 * @param {{story: string, focusSceneId?: string|null}} ctx príbeh dňa (dayStory) a smer zmeny pre úvodnú kartu
 * @param {Array<{id: string, shot: string}>} lines frontDayLines(model)
 * @param {Record<string, {lead: number, speechEnd: number}>} durations nahrávky (ticho na začiatku, koniec reči)
 * @param {object} [opts] FRONT_DAY_VIDEO
 * @returns {{fps, durationS, totalFrames, shots, placement, at(frame)}|null}
 */
export function frontDayPlan(ctx, lines, durations, opts = {}) {
  const o = { ...FRONT_DAY_VIDEO, ...opts, leadS: { ...FRONT_DAY_VIDEO.leadS, ...(opts.leadS || {}) }, minS: { ...FRONT_DAY_VIDEO.minS, ...(opts.minS || {}) } };
  const order = [];
  for (const l of lines || []) if (!order.includes(l.shot)) order.push(l.shot);
  if (!order.length) return null;
  const shots = [];
  const placement = [];
  let t = 0;
  // Scenár (vlastné miesto) môže dať kameru úvodu aj každého záberu `spot:<id>` (ctx.cameras).
  let prevCam = ctx?.cameras?.opening || openingCamera(ctx?.story, ctx?.focusSceneId, o);
  for (const id of order) {
    const kind = kindOf(id);
    const sceneId = kind === 'dir' ? id.slice(4) : kind === 'spot' ? id.slice(5) : null;
    const clipIndex = kind === 'clip' ? Number(id.slice(5)) : null;
    const cam = kind === 'dir' ? (dayDirectionCamera(sceneId, o) || DAY_OVERVIEW_CAMERA)
      : kind === 'air' ? DAY_UKRAINE_CAMERA
      : kind === 'strike' ? (ctx?.cameras?.strike || DAY_UKRAINE_CAMERA)
      : kind === 'spot' ? (ctx?.cameras?.[sceneId] || DAY_UKRAINE_CAMERA)
        : kind === 'opening' ? (ctx?.cameras?.opening || openingCamera(ctx?.story, ctx?.focusSceneId, o))
          : kind === 'clip' ? prevCam
            : DAY_OVERVIEW_CAMERA;
    const lead = o.leadS[kind] ?? 0.5;
    let cursor = t + lead;
    let first = true;
    for (const l of lines.filter((x) => x.shot === id)) {
      const d = durations?.[l.id];
      if (!d) continue;
      // Nahrávka nesmie začať pred 0 s (ticho na začiatku nahrávky dlhšie než úvod záberu → ffmpeg adelay < 0 zlyhá).
      const speechStart = Math.max(first ? cursor : cursor + o.gapS, d.lead);
      const speechEnd = speechStart + (d.speechEnd - d.lead);
      placement.push({ id: l.id, shot: id, start: speechStart - d.lead, speechStart, speechEnd });
      cursor = speechEnd;
      first = false;
    }
    const last = id === order[order.length - 1];
    const dur = Math.max(o.minS[kind] ?? 3, cursor - t + (last ? o.endMarginS : o.tailS));
    shots.push({ id, kind, sceneId, clipIndex, start: t, dur, from: prevCam, to: cam });
    if (kind !== 'clip') prevCam = cam;
    t += dur;
  }
  const durationS = t;
  const totalFrames = Math.max(1, Math.round(durationS * o.fps));
  const fade = (x) => Math.min(1, Math.max(0, x / o.fadeS));
  return {
    fps: o.fps, durationS, totalFrames, shots, placement,
    /** Stav snímky: záber, kamera (`flying`), viditeľnosť vrstiev; `clip` = index záberu (mapa sa nenahráva). */
    at(frame) {
      const vt = Math.min(durationS, Math.max(0, frame / o.fps));
      let i = shots.findIndex((s) => vt < s.start + s.dur);
      if (i < 0) i = shots.length - 1;
      const shot = shots[i];
      const localS = vt - shot.start;
      const local = Math.min(1, Math.max(0, localS / Math.max(1e-9, shot.dur)));
      const moves = ['dir', 'air', 'overview', 'closing', 'strike', 'spot'].includes(shot.kind);
      const differs = shot.from.lon !== shot.to.lon || shot.from.lat !== shot.to.lat || shot.from.heightM !== shot.to.heightM;
      const flying = moves && differs && localS < o.flyS;
      let camera;
      if (shot.kind === 'opening') camera = push(shot.to, local, o.openingPush ?? 0.16);
      else if (shot.kind === 'clip') camera = shot.to;
      else if (flying) camera = flyCamera(shot.from, shot.to, localS / o.flyS);
      else camera = push(shot.to, (localS - (differs ? o.flyS : 0)) / Math.max(1e-9, shot.dur - (differs ? o.flyS : 0)), (o.shotPush || FRONT_DAY_VIDEO.shotPush)[shot.kind === 'dir' || shot.kind === 'spot' ? shot.kind : 'other']);
      const opening = shot.kind === 'opening' ? 1 - fade(localS - (shot.dur - o.fadeS)) : 0;
      const endCard = shot.kind === 'closing' ? fade(localS - 0.2) : 0;
      const main = shot.kind === 'opening' ? fade(localS - (shot.dur - o.fadeS)) : shot.kind === 'closing' ? 1 - fade(localS) : 1;
      return {
        vt, frame, localS, local, camera, flying,
        shot: { id: shot.id, kind: shot.kind, sceneId: shot.sceneId, clipIndex: shot.clipIndex, index: i, start: shot.start, dur: shot.dur },
        clip: shot.kind === 'clip' ? shot.clipIndex : null,
        layers: { opening, main, endCard },
        cardAlpha: fade(localS),
      };
    },
  };
}
