// src/data/eventDig.js — dolovanie chýbajúcich údajov udalosti (2026-10-01, vlastník: „ešte by si mohol
// vydolovať chýbajúce dáta… a bol by workflow pre video super"). Krok pred videom, rovnaký pre každú
// udalosť (scripts/dig-event-data.mjs): kde údaje chýbajú (diery počas udalosti, koniec údajov vo vzduchu)
// a čo k tomu povedia ďalšie otvorené záznamy —
//   pokrytie   koľko INÝCH lietadiel siete v tom čase videli v okolí diery (vlastná história OKO): keď
//              veľa, prijímače tam boli a lietadlo udalosti nebolo počuť; keď žiadne, je to slepé miesto,
//   ďalší let  kde stroj nabudúce vzlietol (vlastná história): odvodené letisko pristátia, keď údaje
//              skončili vo vzduchu.
// Fakty zo správ (pristátie, pokles v diere) doplní človek alebo agent s presnými citátmi
// (eventReported.js) — tu sa len vypíše, čo chýba a ktoré overené články to môžu obsahovať. Pure.

import { CARD_GAP_S } from './eventCard.js';
import { distanceKm, nearestAirport } from './airportNearest.js';

/** Okolie diery pre pokrytie (km od priamky medzi koncami diery) a výška „vo vzduchu" porovnateľná s letom. */
export const DIG_DEFAULTS = Object.freeze({ radiusKm: 150, highM: 6000, nextLegDays: 7, nextLegMaxAltM: 1500, airportKm: 8 });

/**
 * Miesta bez údajov v okne udalosti zo stopy [[t, lat, lon, altFt]]: diery ≥ CARD_GAP_S (oba konce)
 * a koniec údajov vo vzduchu (posledný bod nad 1 000 ft). Pure.
 * @returns {Array<{kind: 'gap'|'end', fromT: number, toT: number|null, a: {lat:number, lon:number, altFt:number|null}, b: {lat:number, lon:number, altFt:number|null}|null}>}
 */
export function eventHoles(event) {
  const track = Array.isArray(event?.track) ? event.track : [];
  const w = event?.window || {};
  const inWin = track.filter((p) => (!Number.isFinite(w.fromT) || p[0] >= w.fromT) && (!Number.isFinite(w.toT) || p[0] <= w.toT));
  const out = [];
  const pt = (p) => ({ lat: p[1], lon: p[2], altFt: p[3] ?? null });
  for (let i = 1; i < inWin.length; i += 1) {
    if (inWin[i][0] - inWin[i - 1][0] >= CARD_GAP_S) out.push({ kind: 'gap', fromT: inWin[i - 1][0], toT: inWin[i][0], a: pt(inWin[i - 1]), b: pt(inWin[i]) });
  }
  const last = inWin.at(-1);
  if (last && (last[3] ?? 0) > 1000) out.push({ kind: 'end', fromT: last[0], toT: null, a: pt(last), b: null });
  return out;
}

/** Vzdialenosť bodu od úsečky a–b v km (rovina so stredným kosínusom). Pure. */
export function distanceToSegmentKm(p, a, b) {
  const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const X = (q) => q.lon * 111.32 * k;
  const Y = (q) => q.lat * 111.32;
  const [ax, ay, bx, by, px, py] = [X(a), Y(a), X(b), Y(b), X(p), Y(p)];
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const f = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + f * dx), py - (ay + f * dy));
}

/**
 * Pokrytie počas diery: iné lietadlá, ktoré siete v čase diery videli do `radiusKm` od nej.
 * @param {{fromT: number, toT: number, a: object, b: object}} hole
 * @param {Array<[string, number, number, number, number|null]>} rows [icao24, t, lat, lon, altM] z histórie
 * @param {string} self icao24 lietadla udalosti (nepočíta sa)
 * @returns {{aircraft: number, high: number, fixes: number, nearestKm: number|null}} Pure.
 */
export function gapCoverage(hole, rows, self, { radiusKm = DIG_DEFAULTS.radiusKm, highM = DIG_DEFAULTS.highM } = {}) {
  const seen = new Map();
  let fixes = 0;
  let nearestKm = null;
  for (const [hex, t, lat, lon, altM] of rows || []) {
    if (hex === self || t < hole.fromT || t > hole.toT || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const d = distanceToSegmentKm({ lat, lon }, hole.a, hole.b);
    if (d > radiusKm) continue;
    fixes += 1;
    nearestKm = nearestKm === null ? d : Math.min(nearestKm, d);
    seen.set(hex, Math.max(seen.get(hex) ?? -Infinity, Number.isFinite(altM) ? altM : -Infinity));
  }
  return { aircraft: seen.size, high: [...seen.values()].filter((m) => m >= highM).length, fixes, nearestKm: nearestKm === null ? null : Math.round(nearestKm) };
}

/**
 * Ďalší let toho istého stroja po konci údajov: prvý bod aspoň 10 min po konci; keď je na zemi alebo
 * nízko pri letisku, je to odvodené letisko, kde stroj stál (pristál). Pure.
 * @param {Array<{t: number, lat: number, lon: number, altM: number|null, gnd: boolean}>} fixes body stroja po konci údajov (zoradené)
 * @param {object[]} airports airportsFromIndex(...)
 */
export function nextDeparture(fixes, endT, airports, { maxAltM = DIG_DEFAULTS.nextLegMaxAltM, airportKm = DIG_DEFAULTS.airportKm } = {}) {
  const first = (fixes || []).find((f) => f.t >= endT + 600);
  if (!first) return null;
  const low = first.gnd || (Number.isFinite(first.altM) && first.altM <= maxAltM);
  const airport = low ? nearestAirport(airports, first.lat, first.lon, airportKm) : null;
  return { t: first.t, lat: first.lat, lon: first.lon, altM: first.altM ?? null, gnd: Boolean(first.gnd), airport: airport ? { icao: airport.icao, iata: airport.iata, name: airport.name, city: airport.municipality } : null };
}

const pad = (v) => String(v).padStart(2, '0');
const hhmm = (tS) => { const d = new Date(tS * 1000); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const group = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Riadok správy o diere: „05:22–05:31 bez údajov (9 min, 95 km) — siete videli v okolí 14 iných lietadiel (12 vo výške)". Pure. */
export function holeLine(hole, cov) {
  if (hole.kind === 'end') return `${hhmm(hole.fromT)} koniec údajov vo výške ${group(hole.a.altFt ?? 0)} ft`;
  const km = Math.round(distanceKm(hole.a.lat, hole.a.lon, hole.b.lat, hole.b.lon));
  const base = `${hhmm(hole.fromT)}–${hhmm(hole.toT)} bez údajov (${Math.round((hole.toT - hole.fromT) / 60)} min, ${km} km)`;
  if (!cov) return base;
  if (!cov.aircraft) return `${base} — v okolí siete nevideli ani iné lietadlo (slepé miesto prijímačov)`;
  return `${base} — siete videli v okolí ${cov.aircraft} iných lietadiel (${cov.high} vo výške nad ${Math.round(DIG_DEFAULTS.highM / 0.3048 / 1000)} tis. ft, najbližšie ${cov.nearestKm} km)`;
}
