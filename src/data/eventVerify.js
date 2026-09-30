// src/data/eventVerify.js — overenie spúšťača druhou, nezávislou sieťou prijímačov (2026-09-30,
// vlastník: „potrebujem len overené, nie fake!"). Spúšťač z jednej siete (kód 7500/7600/7700,
// strmhlavé klesanie) sa porovná so stopou toho istého lietadla z druhej siete v tom istom čase:
//  - potvrdené    — druhá sieť vidí to isté (ten istý kód / prudké klesanie),
//  - vyvrátené    — druhá sieť lietadlo v tom čase má a ukazuje niečo iné (bežný kód, pokojný let) = šum,
//  - bez údajov   — druhá sieť v tom čase nemá body (alebo nenesie kód) — nedá sa rozhodnúť.
// Naživo 30. 9.: štyri „7500" z archívu OKO (OpenSky) druhá sieť (adsb.lol) vyvrátila — kódy 5323,
// 3244, 1200, 7224; FZ1073 potvrdila strmhlavé klesanie (−21 300 ft/min v oboch sieťach).
// Pure — sieťové dopyty robí flightEventsService.js.

import { DIVE_VR_MPS, detectTriggers } from './flightAnomalies.js';

/** Tolerancia času pri porovnaní sietí (s) — body sietí nie sú v tých istých sekundách. */
export const VERIFY_TOLERANCE_S = 90;
/** Druhá sieť potvrdí klesanie už od polovice prahu (−4 000 ft/min) alebo poklesom výšky v okne. */
export const DIVE_CONFIRM_VR_MPS = DIVE_VR_MPS / 2;
export const DIVE_CONFIRM_DROP_M = 1500;
/** Pokojný let: bez prudkého klesania a pokles výšky v okne menší než toto. */
export const DIVE_CALM_DROP_M = 300;

/**
 * Overenie jedného spúšťača v stope druhej siete.
 * @returns {{status:'confirmed'|'contradicted'|'no-data', points:number, codes?:string[], vr?:number, dropM?:number}}
 */
export function verifyTrigger(trigger, otherPoints, { toleranceS = VERIFY_TOLERANCE_S } = {}) {
  const startT = trigger.startT ?? trigger.t;
  const endT = trigger.endT ?? trigger.t;
  const win = (otherPoints || []).filter((p) => p.t >= startT - toleranceS && p.t <= endT + toleranceS && !p.gnd);
  if (!win.length) return { status: 'no-data', points: 0 };
  if (trigger.kind === 'squawk') {
    const matching = win.filter((p) => p.squawk === trigger.code).length;
    if (matching) return { status: 'confirmed', points: win.length, matching };
    const codes = [...new Set(win.map((p) => p.squawk).filter(Boolean))];
    return codes.length
      ? { status: 'contradicted', points: win.length, codes }
      : { status: 'no-data', points: win.length, codes: [] };
  }
  if (trigger.kind === 'dive') {
    const vrs = win.map((p) => p.vr).filter((v) => v !== null);
    const minVr = vrs.length ? Math.min(...vrs) : null;
    const alts = win.filter((p) => p.alt !== null);
    let dropM = 0;
    for (let i = 0; i < alts.length; i += 1) {
      for (let j = i + 1; j < alts.length; j += 1) dropM = Math.max(dropM, alts[i].alt - alts[j].alt);
    }
    if ((minVr !== null && minVr <= DIVE_CONFIRM_VR_MPS) || dropM >= DIVE_CONFIRM_DROP_M) {
      return { status: 'confirmed', points: win.length, vr: minVr, dropM };
    }
    // Vyvrátiť sa dá len s bodmi pred aj po spúšťači — riedka sieť mohla krátky pád preskočiť.
    const before = win.some((p) => p.t <= startT);
    const after = win.some((p) => p.t >= endT);
    if (before && after && dropM < DIVE_CALM_DROP_M) return { status: 'contradicted', points: win.length, vr: minVr, dropM };
    return { status: 'no-data', points: win.length, vr: minVr, dropM };
  }
  return { status: 'no-data', points: win.length };
}

const sameTrigger = (a, b) => a.kind === b.kind
  && (a.kind !== 'squawk' || a.code === b.code)
  && (a.startT ?? a.t) <= (b.endT ?? b.t) + VERIFY_TOLERANCE_S
  && (b.startT ?? b.t) <= (a.endT ?? a.t) + VERIFY_TOLERANCE_S;

const RANK = { confirmed: 2, 'no-data': 1, contradicted: 0 };

/**
 * Overenie kandidáta dvoma sieťami. Spúšťače z oboch sietí, každý overený v tej druhej; ten istý
 * spúšťač z oboch sietí sa spojí (`seenBy` obe). Stav udalosti:
 *  - confirmed  — aspoň jeden spúšťač potvrdila druhá sieť,
 *  - rejected   — spúšťače sú a všetky druhá sieť vyvrátila (šum),
 *  - unverified — inak (druhá sieť v tom čase nemá údaje).
 * @param {{id:string, points:Array}} primary
 * @param {{id:string, points:Array}} secondary
 */
export function verifyEvent(primary, secondary) {
  const a = (detectTriggers(primary.points)).map((t) => ({ ...t, seenBy: [primary.id], verification: { [secondary.id]: verifyTrigger(t, secondary.points) } }));
  const b = (detectTriggers(secondary.points)).map((t) => ({ ...t, seenBy: [secondary.id], verification: { [primary.id]: verifyTrigger(t, primary.points) } }));
  const merged = [...a];
  for (const t of b) {
    const twin = merged.find((m) => m.seenBy.length === 1 && m.seenBy[0] === primary.id && sameTrigger(m, t));
    if (twin) {
      // Čas, poloha a výška ostávajú z prvej siete (siete sa vo výške líšia — barometrická vs GNSS,
      // pri FZ1073 o ~3 000 ft); druhá sieť pridá len potvrdenie.
      twin.seenBy = [primary.id, secondary.id];
      Object.assign(twin.verification, t.verification);
      if (t.kind === 'squawk') {
        twin.startT = Math.min(twin.startT, t.startT);
        twin.endT = Math.max(twin.endT, t.endT);
      }
    } else {
      merged.push(t);
    }
  }
  for (const t of merged) {
    // Spojený spúšťač videli obe siete = potvrdený; inak rozhoduje overenie v tej druhej.
    const statuses = Object.values(t.verification).map((v) => v.status);
    t.status = t.seenBy.length > 1 ? 'confirmed' : statuses.sort((x, y) => RANK[y] - RANK[x])[0] || 'no-data';
  }
  merged.sort((x, y) => (x.startT ?? x.t) - (y.startT ?? y.t));
  const status = merged.some((t) => t.status === 'confirmed')
    ? 'confirmed'
    : (merged.length && merged.every((t) => t.status === 'contradicted') ? 'rejected' : 'unverified');
  return { status, triggers: merged };
}
