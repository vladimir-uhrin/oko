// src/data/flightPath.js — trasa, po ktorej letí odhadovaná poloha lietadla (2026-10-05).
//
// Vlastník vybral z návrhov „vietor vo výške letu" a „severoatlantické trate" (spolu s meraním
// presnosti). Lietadlá cez severný Atlantik nelietajú po najkratšej trase, ale po trasách
// Organizovaného systému trás (NAT OTS), ktoré sa vyhlasujú dvakrát denne (na východ v noci
// UTC, na západ cez deň). FAA ich publikuje ako JSON (https://nms.aim.faa.gov/datanat/nat.json,
// dielo vlády USA — voľné). Z trate berieme len SÚRADNICOVÉ body (napr. „52/50" = 52° N 50° W,
// „5030/50" = 50°30' N 50° W) — pomenované vstupné a výstupné body pri pobreží nemajú v správe
// súradnice a pre odhad nad oceánom netreba.
//
// Čisté funkcie: parser správy, výber trate pre let, trasa odhadu a bod na trase po vzdialenosti.

import { greatCircleKm } from './routePlausible.js';

const D2R = Math.PI / 180;
const EARTH_RADIUS_KM = 6371.0088;

/** Súradnica NAT („52/50", „5030/50", „52/050") → { lat, lon } alebo null. Severná šírka, západná dĺžka. */
export function parseNatCoordinate(token) {
  const m = /^(\d{2})(\d{2})?\/(\d{2,3})$/.exec(String(token || '').trim());
  if (!m) return null;
  const lat = Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0);
  const lon = -Number(m[3]);
  return lat <= 90 && lon >= -180 ? { lat, lon } : null;
}

/**
 * Trate zo súboru FAA nat.json (pole NOTAM-ov typu NAT_TRACK, správa rozdelená na časti).
 * @returns {{id:string, dir:'east'|'west'|null, fromMs:number, toMs:number, points:{lat:number,lon:number}[]}[]}
 */
export function parseNatTracks(json) {
  const items = Array.isArray(json) ? json : [];
  const tracks = [];
  for (const item of items) {
    if (item?.transaction_type && item.transaction_type !== 'NAT_TRACK') continue;
    const fromMs = Date.parse(item?.start_datetime);
    const toMs = Date.parse(item?.end_datetime);
    const lines = String(item?.condition_message || '').split(/\r?\n/).map((l) => l.trim());
    let current = null;
    for (const line of lines) {
      const head = /^([A-Z])\s+(.+)$/.exec(line);
      if (head && !/^(EAST|WEST|EUR|NAR|END|PART|REMARKS)\b/.test(line)) {
        const points = head[2].split(/\s+/).map(parseNatCoordinate).filter(Boolean);
        if (points.length >= 2) {
          current = { id: head[1], dir: null, fromMs, toMs, points };
          tracks.push(current);
        } else {
          current = null;
        }
        continue;
      }
      if (!current) continue;
      if (/^EAST LVLS\s+(?!NIL)/.test(line)) current.dir = 'east';
      else if (/^WEST LVLS\s+(?!NIL)/.test(line)) current.dir = current.dir || 'west';
    }
  }
  return tracks;
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D2R;
  const p2 = lat2 * D2R;
  const dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / D2R) + 360) % 360;
}

function greatCircleInterpolate(a, b, f) {
  const p1 = a.lat * D2R;
  const l1 = a.lon * D2R;
  const p2 = b.lat * D2R;
  const l2 = b.lon * D2R;
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d === 0) return { lat: a.lat, lon: a.lon };
  const s = Math.sin(d);
  const k1 = Math.sin((1 - f) * d) / s;
  const k2 = Math.sin(f * d) / s;
  const x = k1 * Math.cos(p1) * Math.cos(l1) + k2 * Math.cos(p2) * Math.cos(l2);
  const y = k1 * Math.cos(p1) * Math.sin(l1) + k2 * Math.cos(p2) * Math.sin(l2);
  const z = k1 * Math.sin(p1) + k2 * Math.sin(p2);
  return { lat: Math.atan2(z, Math.hypot(x, y)) / D2R, lon: Math.atan2(y, x) / D2R };
}

/** Bod vo vzdialenosti `km` v smere `brgDeg` (veľká kružnica). */
export function destinationPoint(lat, lon, brgDeg, km) {
  const d = km / EARTH_RADIUS_KM;
  const b = brgDeg * D2R;
  const p1 = lat * D2R;
  const l1 = lon * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / D2R, lon: ((((l2 / D2R) + 540) % 360) - 180) };
}

/** Najbližší bod úseku a→b k bodu p (rovinná aproximácia v stupňoch × cos šírky — stačí na výber trate). */
function projectOnSegment(p, a, b) {
  const k = Math.cos(((a.lat + b.lat) / 2) * D2R);
  const ax = a.lon * k;
  const bx = b.lon * k;
  const px = p.lon * k;
  const dx = bx - ax;
  const dy = b.lat - a.lat;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (p.lat - a.lat) * dy) / len2)) : 0;
  const point = { lat: a.lat + dy * t, lon: a.lon + (b.lon - a.lon) * t };
  return { point, t, distKm: greatCircleKm(p.lat, p.lon, point.lat, point.lon) };
}

/** Najbližší bod trate: { index úseku, bod, vzdialenosť }. */
export function nearestOnTrack(p, points) {
  let best = null;
  for (let i = 0; i < points.length - 1; i += 1) {
    const pr = projectOnSegment(p, points[i], points[i + 1]);
    if (!best || pr.distKm < best.distKm) best = { index: i, ...pr };
  }
  return best;
}

/** Oblasť, kde trate platia (severný Atlantik). */
function inNatRegion(p) {
  return p.lat >= 38 && p.lat <= 70 && p.lon >= -65 && p.lon <= -5;
}

/** Ďaleko od trate = iný let (napr. cez Grónsko alebo na juh), trať sa nepoužije. */
export const NAT_MAX_OFFSET_KM = 250;

/**
 * Trať pre let (pure): platná v čase, správny smer, lietadlo pri nej (v oblasti trás) a pred
 * jej koncom. Smer letu z cieľa (ak je) alebo z kurzu.
 * @returns {{track: object, along: object}|null}
 */
export function natTrackFor(fix, destination, tracks, nowMs) {
  if (!Array.isArray(tracks) || !tracks.length || !inNatRegion(fix)) return null;
  const east = destination ? destination.lon > fix.lon : (fix.trkDeg > 20 && fix.trkDeg < 160);
  const west = destination ? destination.lon < fix.lon : (fix.trkDeg > 200 && fix.trkDeg < 340);
  if (!east && !west) return null;
  // Cieľ musí byť za oceánom (inak to nie je prelet Atlantiku).
  if (destination && east && destination.lon < -20) return null;
  if (destination && west && destination.lon > -50) return null;
  let best = null;
  for (const track of tracks) {
    if (Number.isFinite(track.fromMs) && nowMs < track.fromMs - 3600_000) continue;
    if (Number.isFinite(track.toMs) && nowMs > track.toMs + 3 * 3600_000) continue;
    if (track.dir && track.dir !== (east ? 'east' : 'west')) continue;
    const points = east ? [...track.points].sort((a, b) => a.lon - b.lon) : [...track.points].sort((a, b) => b.lon - a.lon);
    const start = points[0];
    const beforeStart = east ? fix.lon < start.lon : fix.lon > start.lon;
    let along = null;
    let score = Infinity;
    if (beforeStart) {
      // Prílet k trati (2026-10-05, naživo): lety na východ strácajú signál už pri Novom Škótsku
      // (~60° z. d.), 600+ km pred začiatkom tratí. Trať = tá, ku ktorej začiatku lietadlo mieri.
      const approach = approachToStart(fix, start);
      if (approach) { along = { index: -1, t: 0, point: start, distKm: approach.distKm }; score = approach.crossKm; }
    } else {
      const on = nearestOnTrack(fix, points);
      // Za koncom trate už nemá zmysel ťahať lietadlo späť na ňu.
      if (on && on.distKm <= NAT_MAX_OFFSET_KM && !(on.index === points.length - 2 && on.t >= 0.999)) { along = on; score = on.distKm; }
    }
    if (along && (!best || score < best.score)) best = { track: { ...track, points }, along, score };
  }
  return best ? { track: best.track, along: best.along } : null;
}

/** Najďalej pred začiatkom trate a najviac bokom od kurzu, aby sa trať ešte priradila. */
export const NAT_APPROACH_MAX_KM = 1500;
export const NAT_APPROACH_MAX_CROSS_KM = 150;

/** Mieri lietadlo k začiatku trate? { distKm, crossKm } alebo null (pure). */
function approachToStart(fix, start) {
  if (!Number.isFinite(fix.trkDeg)) return null;
  const distKm = greatCircleKm(fix.lat, fix.lon, start.lat, start.lon);
  if (distKm > NAT_APPROACH_MAX_KM) return null;
  const diff = ((bearingDeg(fix.lat, fix.lon, start.lat, start.lon) - fix.trkDeg + 540) % 360) - 180;
  if (Math.abs(diff) > 60) return null;
  const crossKm = Math.abs(Math.asin(Math.sin(distKm / EARTH_RADIUS_KM) * Math.sin(diff * D2R)) * EARTH_RADIUS_KM);
  return crossKm <= NAT_APPROACH_MAX_CROSS_KM ? { distKm, crossKm } : null;
}

/** Medziľahlé body po veľkej kružnici (každých ~stepKm), bez začiatku. */
function greatCircleLeg(a, b, stepKm = 300) {
  const total = greatCircleKm(a.lat, a.lon, b.lat, b.lon);
  const n = Math.max(1, Math.ceil(total / stepKm));
  const out = [];
  for (let i = 1; i <= n; i += 1) out.push(greatCircleInterpolate(a, b, i / n));
  return out;
}

/**
 * Trasa odhadu (pure): [poloha fixu, … , koniec]. S traťou: k najbližšiemu bodu trate, po trati
 * a od jej konca po kružnici k cieľu. Bez trate k cieľu po kružnici. Bez cieľa v poslednom smere.
 * @returns {{points:{lat:number,lon:number}[], toDestination:boolean, nat:string|null}}
 */
export function buildEstimatePath(fix, destination, nat = null, { noDestinationKm = 4000 } = {}) {
  const start = { lat: fix.lat, lon: fix.lon };
  const points = [start];
  if (nat) {
    const { track, along } = nat;
    points.push(along.point);
    // index −1 = prílet k začiatku trate (bod začiatku je už along.point).
    for (let i = along.index === -1 ? 1 : along.index + 1; i < track.points.length; i += 1) points.push(track.points[i]);
    const end = points[points.length - 1];
    if (destination) {
      points.push(...greatCircleLeg(end, destination));
      return { points, toDestination: true, nat: track.id };
    }
    const prev = points[points.length - 2];
    points.push(destinationPoint(end.lat, end.lon, bearingDeg(prev.lat, prev.lon, end.lat, end.lon), noDestinationKm));
    return { points, toDestination: false, nat: track.id };
  }
  if (destination) {
    points.push(...greatCircleLeg(start, destination));
    return { points, toDestination: true, nat: null };
  }
  points.push(destinationPoint(fix.lat, fix.lon, fix.trkDeg, noDestinationKm));
  return { points, toDestination: false, nat: null };
}

/** Dĺžka trasy (km). */
export function pathLengthKm(points) {
  let km = 0;
  for (let i = 1; i < points.length; i += 1) km += greatCircleKm(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
  return km;
}

/** Bod na trase vo vzdialenosti `km` od začiatku (pure): { lat, lon, trackDeg, remainingKm }. */
export function pointAlongPath(points, km) {
  let left = Math.max(0, km);
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const seg = greatCircleKm(a.lat, a.lon, b.lat, b.lon);
    if (left <= seg || i === points.length - 1) {
      const f = seg > 0 ? Math.min(1, left / seg) : 1;
      const p = greatCircleInterpolate(a, b, f);
      const trackDeg = f < 1 ? bearingDeg(p.lat, p.lon, b.lat, b.lon) : bearingDeg(a.lat, a.lon, b.lat, b.lon);
      let remainingKm = Math.max(0, seg - left);
      for (let j = i + 1; j < points.length; j += 1) remainingKm += greatCircleKm(points[j - 1].lat, points[j - 1].lon, points[j].lat, points[j].lon);
      return { lat: p.lat, lon: p.lon, trackDeg, remainingKm };
    }
    left -= seg;
  }
  const last = points[points.length - 1] || { lat: 0, lon: 0 };
  return { lat: last.lat, lon: last.lon, trackDeg: 0, remainingKm: 0 };
}
