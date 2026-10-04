// src/data/flightAnomalies.js — zachytenie vážnych situácií v stope letu (2026-09-30, vlastník:
// „automatizované aj s overením z nezávislého zdroja… tak by sme odstránili šum", „potrebujem len
// overené, nie fake!"). Čisté funkcie nad bodmi stopy z ktorejkoľvek siete prijímačov (archív OKO =
// OpenSky, adsb.lol): núdzové kódy transpondéra, strmhlavé klesanie, obrat vo výške, diery v údajoch,
// štart, pristátie a posledný kontakt. Samy nič nevyhlasujú za udalosť — spúšťač overí druhá sieť
// (eventVerify.js). Naživo 29.–30. 9.: 15 letov s kódom 7500 v archíve OKO, štyri preverené druhou
// sieťou — všetky mali v tom čase bežný kód (šum); FZ1073 (A6-FKF) druhá sieť potvrdila.

/** Núdzové kódy transpondéra (ICAO): 7500 nezákonný zásah (únos), 7600 strata spojenia, 7700 núdza. */
export const EMERGENCY_CODES = Object.freeze({ 7500: 'hijack', 7600: 'radio', 7700: 'emergency' });
/** ft/min na 1 m/s. */
export const FPM_PER_MPS = 196.850394;
/** Strmhlavé klesanie: rýchlejšie než 8 000 ft/min (bežné klesanie 1 500–3 000, núdzové ~6 000). */
export const DIVE_VR_MPS = -8000 / FPM_PER_MPS;
/** Pod touto výškou sa prudké klesanie neráta (priblíženie, chyby pri zemi). */
export const DIVE_MIN_ALT_M = 3000;
/** Body strmhlavého klesania do tohto odstupu sú jedna udalosť. */
export const DIVE_GROUP_S = 120;
/** Epizóda kódu končí iným kódom alebo 10 min bez bodu s kódom (bod bez kódu ju nekončí — OpenSky ho často nenesie). */
export const EPISODE_BREAK_S = 600;
/** Obrat: zmena kurzu aspoň o 150° do 5 min vo výške nad 3 000 m. */
export const UTURN_MIN_DEG = 150;
export const UTURN_WINDOW_S = 300;
export const UTURN_MIN_ALT_M = 3000;
/** Diera v údajoch: aspoň 5 min bez bodu, kým je lietadlo vo vzduchu. */
export const GAP_MIN_S = 300;
/** Posledný kontakt nad touto výškou = údaje skončili vo vzduchu (nie pristátie). */
export const AIRBORNE_END_MIN_ALT_M = 1000;

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const norm180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

/**
 * Bod stopy v jednotnom tvare ({t s, lat, lon, alt m, gs m/s, trk °, vr m/s, squawk, gnd}), alebo null.
 * Prijme fix archívu OKO (fixFromCompact) aj bod adsb.lol (traceToFlight). Pure.
 */
export function normalizePoint(p) {
  if (!p || typeof p !== 'object') return null;
  const t = num(p.t);
  const lat = num(p.lat);
  const lon = num(p.lon);
  if (t === null || lat === null || lon === null) return null;
  const raw = p.squawk === null || p.squawk === undefined ? '' : String(p.squawk).trim();
  return {
    t,
    lat,
    lon,
    alt: num(p.alt),
    gs: num(p.gs),
    trk: num(p.trk),
    vr: num(p.vr),
    squawk: /^[0-7]{4}$/.test(raw) ? raw : null,
    gnd: p.gnd === true || p.gnd === 1,
  };
}

/** Chronologická stopa bez duplicitných sekúnd. Pure. */
export function normalizeTrack(points) {
  const out = [];
  for (const p of Array.isArray(points) ? points : []) {
    const n = normalizePoint(p);
    if (n) out.push(n);
  }
  out.sort((a, b) => a.t - b.t);
  return out.filter((p, i) => i === 0 || p.t !== out[i - 1].t);
}

/** Epizódy núdzových kódov vo vzduchu: [{kind:'squawk', code, meaning, startT, endT, points, lat, lon, alt}]. Pure. */
export function squawkEpisodes(points) {
  const out = [];
  let cur = null;
  for (const p of points) {
    if (p.gnd || !p.squawk) continue;
    const meaning = EMERGENCY_CODES[p.squawk];
    if (!meaning) {
      if (cur) { out.push(cur); cur = null; }
      continue;
    }
    if (cur && cur.code === p.squawk && p.t - cur.endT <= EPISODE_BREAK_S) {
      cur.endT = p.t;
      cur.points += 1;
      continue;
    }
    if (cur) out.push(cur);
    cur = { kind: 'squawk', code: p.squawk, meaning, startT: p.t, endT: p.t, points: 1, lat: p.lat, lon: p.lon, alt: p.alt };
  }
  if (cur) out.push(cur);
  return out;
}

/** Po klesaní musí lietadlo do 15 min naozaj stratiť aspoň 1 500 m (inak chybná hodnota rýchlosti). */
export const DIVE_AFTER_S = 15 * 60;
export const DIVE_MIN_LOSS_M = 1500;

/**
 * Strmhlavé klesanie vo výške: [{kind:'dive', t (najprudšie), vr, alt, lat, lon, startT, endT, points, lossM}].
 * Uzná sa, keď lietadlo potom naozaj stratí výšku (`lossM`) — alebo keď údaje do 15 min skončia
 * (havária sa inak nedá odlíšiť; overí ju druhá sieť a správy). Osamelá chybná hodnota
 * vertikálnej rýchlosti pri pokojnom lete sa zahodí. Pure.
 */
export function diveEvents(points) {
  const groups = [];
  for (const p of points) {
    if (p.gnd || p.vr === null || p.vr > DIVE_VR_MPS || (p.alt ?? -Infinity) < DIVE_MIN_ALT_M) continue;
    const last = groups[groups.length - 1];
    if (last && p.t - last.endT <= DIVE_GROUP_S) {
      last.endT = p.t;
      last.points += 1;
      if (p.vr < last.vr) Object.assign(last, { t: p.t, vr: p.vr, alt: p.alt, lat: p.lat, lon: p.lon });
      continue;
    }
    groups.push({ kind: 'dive', t: p.t, vr: p.vr, alt: p.alt, lat: p.lat, lon: p.lon, startT: p.t, endT: p.t, points: 1 });
  }
  return groups.filter((g) => {
    let before = -Infinity;
    let after = Infinity;
    let hasAfter = false;
    for (const p of points) {
      if (p.alt === null) continue;
      if (p.t >= g.startT - 60 && p.t <= g.startT) before = Math.max(before, p.alt);
      if (p.t > g.endT && p.t <= g.endT + DIVE_AFTER_S) {
        hasAfter = true;
        after = Math.min(after, p.gnd ? 0 : p.alt);
      }
    }
    if (!hasAfter) return true;
    g.lossM = before - after;
    return g.lossM >= DIVE_MIN_LOSS_M;
  });
}

/** Obraty vo výške: [{kind:'uturn', startT, endT, turnDeg (+ doprava), fromTrk, toTrk, lat, lon, alt}]. Pure. */
export function uTurns(points, { minDeg = UTURN_MIN_DEG, windowS = UTURN_WINDOW_S, minAlt = UTURN_MIN_ALT_M } = {}) {
  const pts = points.filter((p) => !p.gnd && p.trk !== null && (p.alt ?? -Infinity) >= minAlt);
  const out = [];
  let i = 0;
  while (i < pts.length) {
    // Najkratšie okno od i, v ktorom otočka dosiahne prah…
    let acc = 0;
    let hit = -1;
    for (let j = i + 1; j < pts.length && pts[j].t - pts[i].t <= windowS; j += 1) {
      acc += norm180(pts[j].trk - pts[j - 1].trk);
      if (Math.abs(acc) >= minDeg) { hit = j; break; }
    }
    if (hit < 0) { i += 1; continue; }
    // …a ďalej, kým sa lietadlo točí tým istým smerom (celá otočka, nie len po prah).
    const sign = Math.sign(acc);
    let end = hit;
    while (end + 1 < pts.length && pts[end + 1].t - pts[end].t <= 120) {
      const d = norm180(pts[end + 1].trk - pts[end].trk);
      if (Math.sign(d) !== sign || Math.abs(d) < 0.5) break;
      acc += d;
      end += 1;
    }
    out.push({ kind: 'uturn', startT: pts[i].t, endT: pts[end].t, turnDeg: acc, fromTrk: pts[i].trk, toTrk: pts[end].trk, lat: pts[end].lat, lon: pts[end].lon, alt: pts[end].alt });
    i = end + 1;
  }
  // Čas obratu = keď lietadlo prejde polovicu otočky. Okno začína už pomalým stáčaním kurzu pred
  // samotným otočením (FZ1073: okno od 05:39:54, polovica otočky 05:42:3x).
  for (const u of out) {
    let acc = 0;
    let prev = null;
    u.t = u.startT;
    for (const p of pts) {
      if (p.t < u.startT || p.t > u.endT) continue;
      if (prev) acc += norm180(p.trk - prev.trk);
      prev = p;
      if (Math.abs(acc) >= Math.abs(u.turnDeg) / 2) {
        Object.assign(u, { t: p.t, lat: p.lat, lon: p.lon, alt: p.alt });
        break;
      }
    }
  }
  return out;
}

/** Diery v údajoch vo vzduchu: [{kind:'gap', fromT, toT, s, fromAlt, toAlt}]. Pure. */
export function dataGaps(points, { minS = GAP_MIN_S } = {}) {
  const out = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (b.t - a.t < minS || a.gnd || b.gnd) continue;
    out.push({ kind: 'gap', fromT: a.t, toT: b.t, s: b.t - a.t, fromAlt: a.alt, toAlt: b.alt, lat: a.lat, lon: a.lon });
  }
  return out;
}

/**
 * Fázy letu: štart (zem → vzduch), cestovná výška (prvý bod v 95 % maxima), pristátie (posledné
 * vzduch → zem po štarte) a posledný kontakt (vo vzduchu = údaje skončili, nie pristátie). Pure.
 */
export function flightPhases(points) {
  let takeoff = null;
  let landing = null;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a.gnd && !b.gnd && !takeoff) takeoff = { kind: 'takeoff', t: b.t, lat: b.lat, lon: b.lon, alt: b.alt };
    if (!a.gnd && b.gnd && (takeoff ? b.t > takeoff.t : true)) landing = { kind: 'landing', t: b.t, lat: b.lat, lon: b.lon, alt: 0 };
  }
  const airborne = points.filter((p) => !p.gnd && p.alt !== null);
  const maxAlt = airborne.reduce((m, p) => Math.max(m, p.alt), -Infinity);
  const top = airborne.find((p) => p.alt >= 0.95 * maxAlt && Math.abs(p.vr ?? 0) < 2.5);
  const cruise = Number.isFinite(maxAlt) && maxAlt >= 6000 && top ? { kind: 'cruise', t: top.t, lat: top.lat, lon: top.lon, alt: top.alt, gs: top.gs, trk: top.trk } : null;
  const last = points[points.length - 1] || null;
  const lastContact = last ? {
    kind: 'last-contact',
    t: last.t,
    lat: last.lat,
    lon: last.lon,
    alt: last.alt,
    airborne: !last.gnd && (last.alt ?? 0) > AIRBORNE_END_MIN_ALT_M,
  } : null;
  if (landing && last && landing.t < last.t && !last.gnd) landing = null; // znova vzlietol — pristátie nebolo koniec
  return { takeoff, cruise, landing, lastContact };
}

/** Spúšťače kandidáta (čo musí overiť druhá sieť): núdzové kódy a strmhlavé klesanie. Pure. */
export function detectTriggers(points) {
  return [...squawkEpisodes(points), ...diveEvents(points)].sort((a, b) => (a.startT ?? a.t) - (b.startT ?? b.t));
}
