// src/data/frontWeek.js — „Týždeň na fronte" (Ukrajina): čísla týždňa pre video a súhrn (2026-10-03, vlastník:
// „vrátime sa k Ukrajine" → video; rozhodnutie „s DeepState, zdroj uvedený"). Čistý model z toho, čo OKO už má:
//   strety      denné hlásenia Generálneho štábu ZSU (archív `/api/ukraine/events/directions`): súčet bojových
//               stretov frontu a útoky po smeroch za 7 dní a za 7 dní predtým — ÚDAJE JEDNEJ STRANY,
//   územie      rozdiel ruskej kontroly medzi dvoma dennými snímkami mapy DeepState (occupiedChangeRaster,
//               ten istý výpočet ako vrstva na mape) — ODVODENÉ z geometrie, nie údaj DeepState; mapa má
//               zámerné oneskorenie 2–3 dni. „Rusko obsadilo" = bunky, ktoré pribudli do okupovaného;
//               „Ukrajina získala späť" = bunky, ktoré z okupovaného ubudli a mapa ich dnes NEvedie ako
//               sivú zónu (prechod okupované → sivá zóna je strata ruskej kontroly, nie ukrajinský zisk).
//               Každá bunka patrí jednému smeru (výrezy smerov sa prekrývajú — inak by sa rátala dvakrát),
//   údery       týždenné súčty z úvodného odseku hlásení (riadené bomby, drony, obstrely), keď ich deň nesie.
// Dni bez hlásenia a smery bez počtu sa nerátajú ako nula — model nesie, koľko dní poznal. Pure.

import { occupiedChangeRaster, shiftDay } from './ukraineContactLine.js';
import { directionSeries, isPartialReport } from './ukraineDirectionTrend.js';
import { FRONT_SCENES, frontSceneByGsDirection } from '../ukraineFrontScenes.js';

export const FRONT_WEEK_DAYS = 7;
/** Trend smeru: pod týmto rozdielom (útoky za týždeň) alebo podielom je „drží sa". */
export const WEEK_TREND_MIN_DIFF = 8;
export const WEEK_TREND_MIN_REL = 0.15;
const KM_PER_DEG = 111.32;

/** Index polygónov snímky (vonkajší prstenec + druh) — ten istý tvar ako `buildPolyIndex` vrstvy DeepState. Pure. */
export function polyIndex(features) {
  const out = [];
  for (const f of features || []) {
    if (f?.type !== 'Polygon' || !Array.isArray(f.rings?.[0]) || f.rings[0].length < 4) continue;
    let w = 180; let s = 90; let e = -180; let n = -90;
    for (const [lon, lat] of f.rings[0]) { if (lon < w) w = lon; if (lon > e) e = lon; if (lat < s) s = lat; if (lat > n) n = lat; }
    out.push({ kind: f.kind, ring: f.rings[0], bbox: [w, s, e, n] });
  }
  return out;
}

const inRing = (lon, lat, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
/** Druh polygónu snímky v bode (prvý, ktorý bod obsahuje), inak null. Pure. */
export function kindAt(index, lon, lat) {
  for (const p of index || []) {
    if (lon < p.bbox[0] || lon > p.bbox[2] || lat < p.bbox[1] || lat > p.bbox[3]) continue;
    if (inRing(lon, lat, p.ring)) return p.kind;
  }
  return null;
}

/** Smer, ktorému bod patrí: výrez, v ktorom leží (pri prekryve bližší stred), inak najbližší stred do `maxDeg`. Pure. */
export function sceneForPoint(lon, lat, scenes = FRONT_SCENES, maxDeg = 1.6) {
  const k = Math.cos((lat * Math.PI) / 180);
  let best = null; let bd = Infinity; let bestIn = null; let bdIn = Infinity;
  for (const sc of scenes) {
    if (sc.overview) continue;
    const d = Math.hypot((lon - sc.center.lon) * k, lat - sc.center.lat);
    const [w, south, e, n] = sc.rectDegrees;
    if (lon >= w && lon <= e && lat >= south && lat <= n && d < bdIn) { bdIn = d; bestIn = sc.id; }
    if (d < bd) { bd = d; best = sc.id; }
  }
  return bestIn || (bd <= maxDeg ? best : null);
}

/**
 * Rozdelenie zmeny: Rusko obsadilo (`ruKm2`, z toho `fromGreyKm2` zo sivej zóny), Ukrajina získala späť
 * (`uaKm2` — ubudlo z okupovaného a dnes to nie je sivá zóna), do sivej zóny prešlo `toGreyKm2`; to isté
 * po smeroch (`byScene`), každá bunka raz. Pure.
 */
export function changeBreakdown(raster, indexNow, indexBefore, scenes = FRONT_SCENES) {
  const out = { ruKm2: 0, uaKm2: 0, toGreyKm2: 0, fromGreyKm2: 0, byScene: {} };
  if (!raster) return out;
  const { width, height, cellDeg, bbox } = raster;
  const cells = {}; // smer → { ru: [[lon, lat]…], ua: […] } — pre bod „kde sa to stalo"
  for (let r = 0; r < height; r += 1) {
    const lat = bbox.north - (r + 0.5) * cellDeg;
    const km2 = cellDeg * cellDeg * KM_PER_DEG * KM_PER_DEG * Math.cos((lat * Math.PI) / 180);
    for (let c = 0; c < width; c += 1) {
      const idx = r * width + c;
      const gained = raster.ruValues[idx]; const lost = raster.values[idx];
      if (!gained && !lost) continue;
      const lon = bbox.west + (c + 0.5) * cellDeg;
      const id = sceneForPoint(lon, lat, scenes);
      const sc = id ? (out.byScene[id] = out.byScene[id] || { ruKm2: 0, uaKm2: 0, toGreyKm2: 0, ruAt: null, uaAt: null }) : null;
      const own = id ? (cells[id] = cells[id] || { ru: [], ua: [] }) : null;
      if (gained) {
        out.ruKm2 += km2; if (sc) { sc.ruKm2 += km2; own.ru.push([lon, lat]); }
        if (kindAt(indexBefore, lon, lat) === 'grey') out.fromGreyKm2 += km2;
      } else if (kindAt(indexNow, lon, lat) === 'grey') {
        out.toGreyKm2 += km2; if (sc) sc.toGreyKm2 += km2;
      } else {
        out.uaKm2 += km2; if (sc) { sc.uaKm2 += km2; own.ua.push([lon, lat]); }
      }
    }
  }
  const r1 = (v) => Math.round(v * 10) / 10;
  for (const k of ['ruKm2', 'uaKm2', 'toGreyKm2', 'fromGreyKm2']) out[k] = r1(out[k]);
  for (const [id, v] of Object.entries(out.byScene)) {
    for (const k of ['ruKm2', 'uaKm2', 'toGreyKm2']) v[k] = r1(v[k]);
    v.ruAt = changeAnchor(cells[id]?.ru);
    v.uaAt = changeAnchor(cells[id]?.ua);
  }
  return out;
}

/**
 * Bod zmeny pre popis na mape: zmenená bunka najbližšie k ťažisku zmenených buniek — popis tak vždy sedí
 * na území, ktoré sa naozaj zmenilo (ťažisko dvoch oddelených plôch by ležalo medzi nimi). Pure.
 * @param {Array<[number, number]>} cells stredy buniek [lon, lat]
 * @returns {{lon: number, lat: number}|null}
 */
export function changeAnchor(cells) {
  if (!Array.isArray(cells) || !cells.length) return null;
  let sx = 0; let sy = 0;
  for (const [x, y] of cells) { sx += x; sy += y; }
  const cx = sx / cells.length; const cy = sy / cells.length;
  const k = Math.cos((cy * Math.PI) / 180);
  let best = cells[0]; let bd = Infinity;
  for (const p of cells) { const d = Math.hypot((p[0] - cx) * k, p[1] - cy); if (d < bd) { bd = d; best = p; } }
  return { lon: Math.round(best[0] * 1000) / 1000, lat: Math.round(best[1] * 1000) / 1000 };
}

/** Týždeň končiaci dňom `refDay` a týždeň pred ním. Pure. */
export function weekRanges(refDay, days = FRONT_WEEK_DAYS) {
  const to = shiftDay(refDay, 0);
  if (!to) return null;
  return { week: { from: shiftDay(to, -(days - 1)), to }, prev: { from: shiftDay(to, -(2 * days - 1)), to: shiftDay(to, -days) } };
}

const sumKnown = (rows) => rows.filter((p) => Number.isFinite(p.attacks) && !p.partial).reduce((s, p) => s + p.attacks, 0);
const knownDays = (rows) => rows.filter((p) => Number.isFinite(p.attacks) && !p.partial).length;

/** Smer trendu týždňa oproti predošlému: 'up' | 'down' | 'flat' | null (málo dní s údajom). Pure. */
export function weekTrend(week, prev, weekDays, prevDays, minDays = 4) {
  if (weekDays < minDays || prevDays < minDays) return null;
  // Porovnávajú sa priemery na deň — týždne s rôznym počtom dní s údajom by sa inak nedali merať.
  const a = week / weekDays; const b = prev / prevDays;
  const diff = (a - b) * FRONT_WEEK_DAYS;
  const rel = b > 0 ? Math.abs(a - b) / b : (a > 0 ? Infinity : 0);
  if (Math.abs(diff) < WEEK_TREND_MIN_DIFF || rel < WEEK_TREND_MIN_REL) return 'flat';
  return diff > 0 ? 'up' : 'down';
}

/**
 * Model týždňa.
 * @param {object} p
 * @param {Record<string, any>} p.days hlásenia po dňoch (`/api/ukraine/events/directions` → days; voliteľne `strikes`)
 * @param {string} p.refDay posledný deň týždňa ('YYYY-MM-DD')
 * @param {{day?: string, features?: Array}|null} [p.snapshotNow] snímka DeepState na konci týždňa
 * @param {{day?: string, features?: Array}|null} [p.snapshotBefore] snímka spred 7 dní
 * @param {ReadonlyArray<object>} [p.scenes] smery frontu (FRONT_SCENES)
 */
export function frontWeekModel({ days = {}, refDay, snapshotNow = null, snapshotBefore = null, scenes = FRONT_SCENES } = {}) {
  const ranges = weekRanges(refDay);
  if (!ranges) return null;
  const both = { from: ranges.prev.from, to: ranges.week.to };
  const overview = scenes.find((s) => s.overview) || { id: 'front', overview: true };
  const series = directionSeries(days, overview, frontSceneByGsDirection, both);
  const weekRows = series.slice(-FRONT_WEEK_DAYS);
  const prevRows = series.slice(0, FRONT_WEEK_DAYS);
  const total = {
    week: sumKnown(weekRows), prev: sumKnown(prevRows), weekDays: knownDays(weekRows), prevDays: knownDays(prevRows),
    series: series.map((p) => ({ day: p.day, value: Number.isFinite(p.attacks) && !p.partial ? p.attacks : null })),
  };
  total.trend = weekTrend(total.week, total.prev, total.weekDays, total.prevDays);
  total.changePct = total.prevDays >= 4 && total.weekDays >= 4 && total.prev > 0
    ? Math.round(((total.week / total.weekDays) / (total.prev / total.prevDays) - 1) * 100) : null;

  let change = null;
  let raster = null;
  let parts = null;
  if (snapshotNow?.features?.length && snapshotBefore?.features?.length) {
    const now = polyIndex(snapshotNow.features); const before = polyIndex(snapshotBefore.features);
    raster = occupiedChangeRaster(now, before);
    if (raster) {
      parts = changeBreakdown(raster, now, before, scenes);
      // Stav „k dňu": zrkadlo mapy zapisuje len pri zmene, takže snímka staršia než žiadaný deň je stav mapy
      // aj v ten deň (`asOfDay`). O „týždni" sa smie hovoriť len pri odstupe presne 7 dní (`weekly`).
      const fromDay = snapshotBefore.asOfDay || snapshotBefore.day || null;
      const toDay = snapshotNow.day || null;
      const spanDays = fromDay && toDay ? Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000) : null;
      change = {
        fromDay, toDay, spanDays, weekly: spanDays === FRONT_WEEK_DAYS,
        ruKm2: parts.ruKm2, uaKm2: parts.uaKm2, toGreyKm2: parts.toGreyKm2, fromGreyKm2: parts.fromGreyKm2,
        // Surový geometrický rozdiel (to isté číslo ukazuje vrstva na mape: „RU +N · UA +M").
        gainedKm2: raster.gainedKm2, lostKm2: raster.lostKm2, gainedCells: raster.ruCells, lostCells: raster.cells,
      };
    }
  }

  const directions = scenes.filter((s) => !s.overview).map((scene) => {
    const rows = directionSeries(days, scene, frontSceneByGsDirection, both);
    const w = rows.slice(-FRONT_WEEK_DAYS); const p = rows.slice(0, FRONT_WEEK_DAYS);
    const entry = {
      id: scene.id, rect: [...scene.rectDegrees], center: { ...scene.center },
      week: sumKnown(w), prev: sumKnown(p), weekDays: knownDays(w), prevDays: knownDays(p),
      series: rows.map((x) => ({ day: x.day, value: Number.isFinite(x.attacks) && !x.partial ? x.attacks : null })),
    };
    entry.trend = weekTrend(entry.week, entry.prev, entry.weekDays, entry.prevDays);
    entry.changePct = entry.prevDays >= 4 && entry.weekDays >= 4 && entry.prev > 0
      ? Math.round(((entry.week / entry.weekDays) / (entry.prev / entry.prevDays) - 1) * 100) : null;
    const own = parts ? (parts.byScene[scene.id] || { ruKm2: 0, uaKm2: 0, toGreyKm2: 0, ruAt: null, uaAt: null }) : null;
    entry.ruKm2 = own ? own.ruKm2 : null;
    entry.uaKm2 = own ? own.uaKm2 : null;
    entry.toGreyKm2 = own ? own.toGreyKm2 : null;
    // Kde v smere sa územie zmenilo (bod na zmenenej bunke) — pre popis na mape.
    entry.ruAt = own ? own.ruAt : null;
    entry.uaAt = own ? own.uaAt : null;
    return entry;
  }).sort((a, b) => b.week - a.week || a.id.localeCompare(b.id));

  // Údery: súčet za dni týždňa, ktoré údaj nesú (hlásenie ich má v úvodnom odseku; nie každý deň každý druh).
  const strikes = {};
  for (const row of weekRows) {
    const rep = days?.[row.day];
    if (!rep?.strikes || isPartialReport(rep)) continue;
    for (const [k, v] of Object.entries(rep.strikes)) {
      if (!Number.isFinite(v)) continue;
      strikes[k] = strikes[k] || { sum: 0, days: 0 };
      strikes[k].sum += v; strikes[k].days += 1;
    }
  }

  return { refDay: ranges.week.to, week: ranges.week, prev: ranges.prev, total, directions, change, strikes, raster };
}
