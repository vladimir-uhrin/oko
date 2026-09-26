// src/data/ukraineAlertAreas.js
/**
 * @module ukraineAlertAreas
 * @description POPLACHY modulu UKRAJINA (2026-09-26, vlastník: „áno" na „poplachy
 * ako vyfarbené oblasti"): hrozby z neba podľa hlásení Vzdušných síl ZSU
 * (oficiálny Telegram `kpszsu`) → oblasti, ktoré hlásenie označuje ako ohrozené.
 * NIE je to oficiálna mapa poplachov (sirény vyhlasujú oblastné správy, tú mapu
 * nemáme) — len čo Vzdušné sily napísali, s vekom posledného hlásenia.
 *
 * Intenzita: plná do ALERT_FULL_MIN od posledného hlásenia, potom lineárne slabne
 * do ALERT_FADE_MIN. Sídlo sa priradí oblasti bodom v polygóne (Natural Earth
 * 1:10m, public domain; pobrežné mestá tesne mimo zjednodušeného okraja do
 * ALERT_NEAR_KM). Ruské mestá do žiadnej oblasti nepatria a vypadnú. Pure.
 */

export const ALERT_FULL_MIN = 60;
export const ALERT_FADE_MIN = 180;
export const ALERT_NEAR_KM = 3;
/** Krok intenzity (1 / 0,75 / 0,5 / 0,25 — menej prestavieb primitív; 0 = nekreslí sa). */
export const ALERT_LEVEL_STEP = 0.25;

const MIN = 60_000;
const KM_PER_DEG = 111.32;

/** Bod v prstenci [[lon,lat],…] (párno-nepárne). Pure. */
export function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Vzdialenosť bodu od prstenca v km (rovinne, škálované kosínusom). Pure. */
export function distanceToRingKm(lon, lat, ring) {
  const kx = KM_PER_DEG * Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (let i = 1; i < ring.length; i += 1) {
    const ax = (ring[i - 1][0] - lon) * kx; const ay = (ring[i - 1][1] - lat) * KM_PER_DEG;
    const bx = (ring[i][0] - lon) * kx; const by = (ring[i][1] - lat) * KM_PER_DEG;
    const dx = bx - ax; const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/**
 * Oblasť, v ktorej bod leží (alebo do `nearKm` od jej okraja), alebo null. Pure.
 * @param {Array<{name:string, rings:number[][][]}>} oblasts
 */
export function oblastForPoint(lon, lat, oblasts, nearKm = ALERT_NEAR_KM) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  for (const o of oblasts || []) if (o.rings.some((r) => pointInRing(lon, lat, r))) return o.name;
  let best = null; let bestKm = nearKm;
  for (const o of oblasts || []) {
    for (const r of o.rings) {
      const km = distanceToRingKm(lon, lat, r);
      if (km <= bestKm) { bestKm = km; best = o.name; }
    }
  }
  return best;
}

/** Oblasti jedného poplachu (bez duplicít); cieľ „oblasť" len keď ju mapa pozná. Pure. */
export function alertOblasts(alert, oblasts, names = new Set((oblasts || []).map((o) => o.name))) {
  const out = [];
  for (const target of alert?.targets || []) {
    const name = target.kind === 'oblast' ? (names.has(target.name) ? target.name : null) : oblastForPoint(target.lon, target.lat, oblasts);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Intenzita podľa veku posledného hlásenia (0…1), zaokrúhlená na stupeň. Pure. */
export function alertLevel(ageMs, { fullMin = ALERT_FULL_MIN, fadeMin = ALERT_FADE_MIN } = {}) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0;
  const age = ageMs / MIN;
  if (age <= fullMin) return 1;
  if (age >= fadeMin) return 0;
  // Nahor na krok: 0,25 drží až do konca okna (179 min = 0,25), 0 presne od fadeMin.
  const raw = 1 - (age - fullMin) / (fadeMin - fullMin);
  return Math.min(1, Math.ceil(raw / ALERT_LEVEL_STEP) * ALERT_LEVEL_STEP);
}

/**
 * Stav oblastí k času `atMs`: pre každú ohrozenú oblasť počet hlásení za
 * poslednú hodinu a za okno slabnutia, čas a text posledného hlásenia, intenzita.
 * Hlásenia po `atMs` sa nepočítajú (prehrávanie). Pure.
 * @param {Array<{id:string,t:number,targets:any[],text?:string,url?:string}>} alerts
 * @returns {Map<string, {name:string, level:number, lastT:number, count1h:number, count:number, text:string, url:string|null}>}
 */
export function alertLevels(alerts, atMs, oblasts, opts = {}) {
  const fadeMin = opts.fadeMin ?? ALERT_FADE_MIN;
  const out = new Map();
  if (!Number.isFinite(atMs)) return out;
  const names = new Set((oblasts || []).map((o) => o.name));
  const from = atMs - fadeMin * MIN;
  for (const a of alerts || []) {
    if (!Number.isFinite(a?.t) || a.t > atMs || a.t <= from) continue;
    for (const name of alertOblasts(a, oblasts, names)) {
      const cur = out.get(name) || { name, level: 0, lastT: -Infinity, count1h: 0, count: 0, text: '', url: null };
      cur.count += 1;
      if (atMs - a.t <= 60 * MIN) cur.count1h += 1;
      if (a.t >= cur.lastT) { cur.lastT = a.t; cur.text = a.text || ''; cur.url = a.url || null; }
      out.set(name, cur);
    }
  }
  for (const [name, cur] of out) {
    cur.level = alertLevel(atMs - cur.lastT, opts);
    if (!cur.level) out.delete(name);
  }
  return out;
}
