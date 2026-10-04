// src/data/trailStyle.js — vzhľad trajektórie za lietadlom: farba podľa výšky a hladké zákruty
// (2026-10-04, vlastník: „trajektóriu za lietadlom aj s farbami výšky a nie ostrými hranami
// pri zatáčkach"). Čisté funkcie bez Cesia — trailRenderer.js ich používa pri každej novej
// polohe (kadencia dotazov, nie snímkov).
//
// Farby: obvyklá letecká stupnica výšky — pri zemi oranžovo-červená, nízko žltá, stredne zelená,
// cestovná hladina tyrkysová až modrá, najvyššie fialová. Stupnica je v stopách (tak sa výška
// v letectve číta) a čiara sa delí na pásma — každé pásmo je jedna entita, aby čiara ostala
// viditeľná aj za 3D mestom (depthFailMaterial; per-vertex Primitive tam mizol, viď trailRenderer).
//
// Zákruty: centripetálny Catmull-Rom cez namerané body (prechádza nimi presne, nepreháňa ostré
// slučky); body sa dopĺňajú len tam, kde sa smer naozaj láme — rovné úseky ostávajú rovné.

export const FT_PER_M = 3.28084;

/** Zastávky stupnice: [stopy, '#rrggbb']. */
export const TRAIL_ALTITUDE_STOPS_FT = Object.freeze([
  [0, '#e8401c'],
  [1000, '#ff7a1a'],
  [5000, '#ffcf1f'],
  [10000, '#9be03a'],
  [20000, '#22d68f'],
  [30000, '#1ea7ff'],
  [38000, '#5b6cff'],
  [45000, '#c24dff'],
]);

/** Počet farebných pásiem čiary (dosť na plynulý dojem, málo entít). */
export const TRAIL_ALTITUDE_BANDS = 32;
const MAX_FT = TRAIL_ALTITUDE_STOPS_FT[TRAIL_ALTITUDE_STOPS_FT.length - 1][0];

const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const STOPS = TRAIL_ALTITUDE_STOPS_FT.map(([ft, hex]) => [ft, hexRgb(hex)]);

/** Výška (m) → [r, g, b] v 0…1 (pure). Neznáma výška = farba zeme. */
export function trailAltitudeRgb(altM) {
  const ft = Number.isFinite(altM) ? Math.max(0, altM * FT_PER_M) : 0;
  if (ft >= MAX_FT) return [...STOPS[STOPS.length - 1][1]];
  for (let i = 1; i < STOPS.length; i += 1) {
    const [ft1, c1] = STOPS[i];
    if (ft <= ft1) {
      const [ft0, c0] = STOPS[i - 1];
      const t = (ft - ft0) / (ft1 - ft0);
      return c0.map((v, k) => v + (c1[k] - v) * t);
    }
  }
  return [...STOPS[STOPS.length - 1][1]];
}

/** Výška (m) → index pásma 0…bands−1 (pure). */
export function altitudeBand(altM, bands = TRAIL_ALTITUDE_BANDS) {
  const ft = Number.isFinite(altM) ? Math.max(0, altM * FT_PER_M) : 0;
  return Math.min(bands - 1, Math.floor((ft / MAX_FT) * bands));
}

/** Farba stredu pásma (pure). */
export function bandRgb(band, bands = TRAIL_ALTITUDE_BANDS) {
  return trailAltitudeRgb((((band + 0.5) / bands) * MAX_FT) / FT_PER_M);
}

/**
 * Rozdeľ čiaru na úseky rovnakého pásma (pure). Susedné úseky zdieľajú hraničný bod, aby
 * v čiare nebola medzera. Úsek má aspoň 2 body.
 * @param {number[]} bandsPerPoint pásmo každého bodu
 * @returns {{band: number, start: number, end: number}[]} indexy vrátane `end`
 */
export function splitByBand(bandsPerPoint) {
  const runs = [];
  const n = bandsPerPoint.length;
  if (n < 2) return runs;
  let start = 0;
  for (let i = 1; i < n; i += 1) {
    if (bandsPerPoint[i] !== bandsPerPoint[start] && i - start >= 1) {
      // Hranica leží na bode i: predchádzajúci úsek končí v ňom (spojitosť), nový od neho.
      runs.push({ band: bandsPerPoint[start], start, end: i });
      start = i;
    }
  }
  if (n - 1 > start) runs.push({ band: bandsPerPoint[start], start, end: n - 1 });
  else if (runs.length) runs[runs.length - 1].end = n - 1;
  return runs;
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v) => Math.hypot(v.x, v.y, v.z);

/** Uhol (stupne) medzi smermi a→b a b→c. */
function turnDeg(a, b, c) {
  const u = sub(b, a);
  const v = sub(c, b);
  const lu = len(u);
  const lv = len(v);
  if (lu === 0 || lv === 0) return 0;
  const cos = Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y + u.z * v.z) / (lu * lv)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Bod centripetálneho Catmull-Romu medzi p1 a p2 (t ∈ 0…1). */
function catmullRom(p0, p1, p2, p3, t) {
  const knot = (a, b) => Math.sqrt(len(sub(b, a))) || 1e-6;
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const lerp = (a, b, ta, tb) => {
    const w = (tt - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w, z: a.z + (b.z - a.z) * w };
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/**
 * Zaobli zákruty (pure). Vstup: body {x, y, z} (ECEF), výstup: nové pole bodov, ktoré obsahuje
 * všetky pôvodné body v pôvodnom poradí a medzi nimi doplnené body len v zákrutách.
 * @param {{x:number,y:number,z:number}[]} points
 * @param {{minTurnDeg?: number, degPerStep?: number, maxSteps?: number}} [options]
 */
export function smoothTrail(points, { minTurnDeg = 3, degPerStep = 5, maxSteps = 8 } = {}) {
  const n = points?.length ?? 0;
  if (n < 3) return points ? points.slice() : [];
  const out = [points[0]];
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(n - 1, i + 2)];
    const turn = Math.max(i > 0 ? turnDeg(p0, p1, p2) : 0, i + 2 < n ? turnDeg(p1, p2, p3) : 0);
    if (turn >= minTurnDeg) {
      const steps = Math.min(maxSteps, Math.max(1, Math.ceil(turn / degPerStep)));
      // Pri koncoch čiary chýba sused — zrkadlený bod drží krivku bez vybočenia.
      const q0 = i > 0 ? p0 : { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y, z: 2 * p1.z - p2.z };
      const q3 = i + 2 < n ? p3 : { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y, z: 2 * p2.z - p1.z };
      for (let s = 1; s <= steps; s += 1) out.push(catmullRom(q0, p1, p2, q3, s / (steps + 1)));
    }
    out.push(p2);
  }
  return out;
}
