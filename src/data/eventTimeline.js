// src/data/eventTimeline.js — časová os udalosti z dvoch sietí prijímačov (2026-09-30, etapa 1
// systému Udalosti). Kľúčové momenty: štart, cestovná výška, strmhlavé klesanie, núdzové kódy,
// obrat, diery bez údajov (v OBOCH sieťach), pristátie alebo posledný kontakt vo vzduchu. Pri
// každom momente je, ktorá sieť ho videla (`seenBy`) — jedna sieť = neoverené, dve = overené.
// Nič sa nedopočítava: diera ostane dierou, pristátie mimo pokrytia sa nevymyslí.
// Pure; popisy SK/EN pre stránku udalosti a text príspevku (etapa 2).

import { FPM_PER_MPS, dataGaps, flightPhases, uTurns } from './flightAnomalies.js';
import { VERIFY_TOLERANCE_S } from './eventVerify.js';
import { descentNote, landingPhrase } from './eventReported.js';

const byTime = (a, b) => a.t - b.t;
const overlaps = (a, b) => a.startT <= b.endT + VERIFY_TOLERANCE_S && b.startT <= a.endT + VERIFY_TOLERANCE_S;

/** Obraty z oboch sietí spojené do jedného momentu s `seenBy`; čas a poloha z prvej siete, ktorá ho videla. Pure. */
function mergedUTurns(networks) {
  const out = [];
  for (const net of networks) {
    for (const u of uTurns(net.points)) {
      const twin = out.find((m) => overlaps(m, u) && Math.sign(m.turnDeg) === Math.sign(u.turnDeg));
      if (twin) {
        if (!twin.seenBy.includes(net.id)) twin.seenBy.push(net.id);
        twin.startT = Math.min(twin.startT, u.startT);
        twin.endT = Math.max(twin.endT, u.endT);
        if (Math.abs(u.turnDeg) > Math.abs(twin.turnDeg)) twin.turnDeg = u.turnDeg;
      } else {
        out.push({ ...u, seenBy: [net.id] });
      }
    }
  }
  return out;
}

/**
 * Časová os udalosti.
 * @param {Array<{id:string, label?:string, points:Array}>} networks normalizované stopy (flightAnomalies.normalizeTrack)
 * @param {Array} triggers overené spúšťače z eventVerify.verifyEvent (vyvrátené sa vynechajú)
 * @returns {{moments:Array, coverage:Array}}
 */
export function buildEventTimeline(networks, triggers = []) {
  const nets = (networks || []).filter((n) => n && Array.isArray(n.points));
  const moments = [];
  // Fázy z každej siete zvlášť (príznak „na zemi" sa medzi sieťami líši o sekundy), potom najskorší
  // štart, najneskoršie pristátie / posledný kontakt.
  const phases = nets.map((n) => ({ id: n.id, ...flightPhases(n.points) }));
  const pick = (key, better) => {
    const found = phases.filter((p) => p[key]).map((p) => ({ ...p[key], from: p.id }));
    if (!found.length) return null;
    const best = found.reduce((x, y) => (better(y, x) ? y : x));
    best.seenBy = [...new Set(found.filter((f) => Math.abs(f.t - best.t) <= VERIFY_TOLERANCE_S * 2).map((f) => f.from))];
    delete best.from;
    return best;
  };
  const takeoff = pick('takeoff', (y, x) => y.t < x.t);
  const cruise = pick('cruise', (y, x) => y.t < x.t);
  const landing = pick('landing', (y, x) => y.t > x.t);
  const last = pick('lastContact', (y, x) => y.t > x.t);
  if (takeoff) moments.push(takeoff);
  if (cruise) moments.push(cruise);
  for (const trig of triggers || []) {
    if (trig.status === 'contradicted') continue;
    if (trig.kind === 'dive') {
      moments.push({ kind: 'dive', t: trig.t, vr: trig.vr, fpm: Math.round(trig.vr * FPM_PER_MPS), alt: trig.alt, lat: trig.lat, lon: trig.lon, seenBy: trig.seenBy, status: trig.status });
    } else if (trig.kind === 'squawk') {
      moments.push({ kind: 'squawk', t: trig.startT, endT: trig.endT, code: trig.code, meaning: trig.meaning, alt: trig.alt, lat: trig.lat, lon: trig.lon, seenBy: trig.seenBy, status: trig.status });
    }
  }
  moments.push(...mergedUTurns(nets));
  // Diera = žiadna sieť nemá bod (spojené body oboch sietí).
  const union = nets.flatMap((n) => n.points).sort(byTime);
  // Dieru potvrdzujú len siete, ktoré v okne nejaké body majú (prázdna sieť nič nevidela).
  const withData = nets.filter((n) => n.points.length).map((n) => n.id);
  for (const g of dataGaps(union)) moments.push({ ...g, t: g.fromT, seenBy: withData });
  if (landing && (!last || landing.t >= last.t - VERIFY_TOLERANCE_S)) moments.push(landing);
  else if (last) moments.push(last);
  moments.sort(byTime);
  const coverage = nets.map((n) => ({
    id: n.id,
    label: n.label || n.id,
    points: n.points.length,
    fromT: n.points[0]?.t ?? null,
    toT: n.points[n.points.length - 1]?.t ?? null,
  }));
  return { moments, coverage };
}

const pad = (v) => String(v).padStart(2, '0');
/** HH:MM:SS UTC. Pure. */
export function clockUtc(tS) {
  const d = new Date(tS * 1000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
const ft = (m) => (m === null || m === undefined ? null : Math.round(m / 0.3048 / 25) * 25);
const group = (n, lang) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'sk' ? ' ' : ',');

const TEXT = {
  sk: {
    takeoff: () => 'štart',
    cruise: (m) => `cestovná výška ${group(ft(m.alt), 'sk')} ft`,
    dive: (m) => `strmhlavé klesanie ${group(Math.abs(m.fpm), 'sk')} ft/min vo výške ${group(ft(m.alt), 'sk')} ft`,
    squawk: (m) => `transpondér vysiela ${m.code} (${{ hijack: 'nezákonný zásah', radio: 'strata spojenia', emergency: 'núdza' }[m.meaning] || 'núdzový kód'})`,
    uturn: (m) => `obrat o ${Math.round(Math.abs(m.turnDeg))}° ${m.turnDeg > 0 ? 'doprava' : 'doľava'}`,
    gap: (m, notes) => `${Math.round(m.s / 60)} min bez údajov${notes ? gapNotes(m, 'sk') : ''}`,
    landing: () => 'pristátie',
    'last-contact': (m) => (m.airborne ? `koniec údajov vo výške ${group(ft(m.alt), 'sk')} ft` : 'posledný záznam na zemi'),
    'reported-landing': (m) => `${landingPhrase(m.reported, 'sk')} — podľa správ`,
  },
  en: {
    takeoff: () => 'takeoff',
    cruise: (m) => `cruise at ${group(ft(m.alt), 'en')} ft`,
    dive: (m) => `steep descent of ${group(Math.abs(m.fpm), 'en')} ft/min at ${group(ft(m.alt), 'en')} ft`,
    squawk: (m) => `transponder squawks ${m.code} (${{ hijack: 'unlawful interference', radio: 'radio failure', emergency: 'emergency' }[m.meaning] || 'emergency code'})`,
    uturn: (m) => `${Math.round(Math.abs(m.turnDeg))}° turn to the ${m.turnDeg > 0 ? 'right' : 'left'}`,
    gap: (m, notes) => `no data for ${Math.round(m.s / 60)} min${notes ? gapNotes(m, 'en') : ''}`,
    landing: () => 'landing',
    'last-contact': (m) => (m.airborne ? `data ends at ${group(ft(m.alt), 'en')} ft` : 'last record on the ground'),
    'reported-landing': (m) => `${landingPhrase(m.reported, 'en')} — per reports`,
  },
};

/** Poznámky zo správ k diere (eventPost.keyMoments ich pripojí ako `reportedNotes`). */
function gapNotes(m, lang) {
  const list = Array.isArray(m.reportedNotes) ? m.reportedNotes : [];
  return list.map((f) => ` — ${descentNote(f, lang)}`).join('');
}

/**
 * Čo sa v momente stalo, bez času a sietí: „strmhlavé klesanie 21 319 ft/min vo výške …". Pure.
 * @param {{notes?: boolean}} [opts] notes = poznámky zo správ k diere (vo videu má diera vlastný nápis)
 */
export function momentPhrase(m, lang = 'sk', { notes = true } = {}) {
  const dict = TEXT[lang] || TEXT.sk;
  return (dict[m.kind] || (() => m.kind))(m, notes);
}

/** Jeden riadok časovej osi: „05:22:05 UTC — strmhlavé klesanie … (OpenSky, adsb.lol)". Pure. */
export function describeMoment(m, { lang = 'sk', labels = {} } = {}) {
  const what = momentPhrase(m, lang);
  const who = (m.seenBy || []).map((id) => labels[id] || id).join(', ');
  return `${clockUtc(m.t)} UTC — ${what}${who ? ` (${who})` : ''}`;
}
