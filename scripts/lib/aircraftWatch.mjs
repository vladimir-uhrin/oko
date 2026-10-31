// scripts/lib/aircraftWatch.mjs — strážca konkrétnych lietadiel verejných činiteľov (2026-11-01).
//
// Pozadie: vlastník chce vedieť hneď, keď charter, ktorým podľa médií odletel premiér do Splitu
// (SKV555, hex 440100, OE-EJJ Pilatus PC-12 NGX), vzlietne na spiatočnú cestu — aby sa reel
// o návrate dal pripraviť rýchlo. Výnimka v CLAUDE.md: lety verejných činiteľov a strojov, ktorými
// letia, z verejných dát (ADS-B). Na súkromné osoby sa nepoužíva.
//
// Čistá logika (bez siete a disku): prevod záznamu adsb.fi na pozorovanie, stav vzduch/zem
// sledovaného stroja s udalosťami vzlet / pristátie / strata signálu a odlety biznis a štátnych
// strojov z oblasti (napr. letisko Split), keby sa premiér vracal iným lietadlom.

export const FT_TO_M = 0.3048;
/** Bez signálu dlhšie než toto = stroj už nie je vo vzduchu (pristál alebo zmizol z pokrytia). */
export const LOST_AFTER_MS = 20 * 60_000;
/** Posledná výška pod touto hranicou pred stratou signálu = pravdepodobne pristál. */
export const LANDING_ALT_M = 2500;
/** Odlet z oblasti: stroj stúpa a je nižšie ako toto. */
export const DEPARTURE_MAX_ALT_M = 4500;
export const DEPARTURE_MIN_CLIMB_FPM = 300;
/** Ten istý stroj z oblasti sa neohlási znova skôr než o toľko. */
export const AREA_REPEAT_MS = 3 * 3600_000;

export const AIRPORTS = {
  LDSP: ['Split', 43.5389, 16.298], LDSB: ['Brač', 43.2857, 16.6797], LDZD: ['Zadar', 44.1083, 15.3467],
  LDDU: ['Dubrovník', 42.5614, 18.2682], LDZA: ['Záhreb', 45.7429, 16.0688], LDRI: ['Rijeka', 45.2169, 14.5703],
  LDPL: ['Pula', 44.8935, 13.9222], LQSA: ['Sarajevo', 43.8246, 18.3315], LQMO: ['Mostar', 43.2829, 17.8459],
  LZIB: ['Bratislava', 48.1702, 17.2127], LZKZ: ['Košice', 48.6631, 21.2411], LZPP: ['Piešťany', 48.6252, 17.8284],
  LZTT: ['Poprad', 49.0736, 20.2411], LZSL: ['Sliač', 48.6378, 19.1341], LZMC: ['Malacky', 48.4019, 17.1183],
  LOWW: ['Viedeň', 48.1103, 16.5697], LOWG: ['Graz', 46.9911, 15.4396], LOWL: ['Linz', 48.2332, 14.1875],
  LKPR: ['Praha', 50.1008, 14.26], LKTB: ['Brno', 49.1513, 16.6944], LHBP: ['Budapešť', 47.4369, 19.2556],
  LJLJ: ['Ľubľana', 46.2237, 14.4576], LIPZ: ['Benátky', 45.5053, 12.3519], LIPQ: ['Terst', 45.8275, 13.4722],
};

/** Typy biznis a vládnych strojov (ICAO), ktoré pri odlete z oblasti stoja za upozornenie. */
export const BIZ_TYPES = new Set([
  'PC12', 'PC24', 'TBM7', 'TBM8', 'TBM9', 'P180', 'B350', 'BE20', 'BE9L', 'BE40', 'PRM1', 'HDJT', 'SF50',
  'C25A', 'C25B', 'C25C', 'C25M', 'C510', 'C525', 'C550', 'C560', 'C56X', 'C680', 'C68A', 'C700', 'C750',
  'E50P', 'E55P', 'E545', 'E550', 'E35L', 'LJ35', 'LJ40', 'LJ45', 'LJ60', 'LJ75', 'H25B', 'G280',
  'CL30', 'CL35', 'CL60', 'GLEX', 'GL5T', 'GL7T', 'GLF4', 'GLF5', 'GLF6', 'F2TH', 'F900', 'FA50', 'FA7X', 'FA8X',
  'A319', 'A320', 'B737', 'BCS1', 'E190',
]);
const AIRLINER_TYPES = new Set(['A319', 'A320', 'B737', 'BCS1', 'E190']);
const AIRLINE_CALLSIGN = /^[A-Z]{3}\d/;

/** Vzdušná vzdialenosť v km medzi [lat, lon]. Pure. */
export function kmBetween(a, b) {
  const r = Math.PI / 180;
  const dLa = (b[0] - a[0]) * r;
  const dLo = (b[1] - a[1]) * r;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(Math.min(1, x)));
}

/** Najbližšie známe letisko do maxKm, inak null. Pure. */
export function nearestAirport(pos, maxKm = 60) {
  if (!pos) return null;
  let best = null;
  for (const [icao, [name, lat, lon]] of Object.entries(AIRPORTS)) {
    const km = kmBetween(pos, [lat, lon]);
    if (km <= maxKm && (!best || km < best.km)) best = { icao, name, km: Math.round(km) };
  }
  return best;
}

/** Záznam adsb.fi v2 (readsb) → pozorovanie; bez polohy null. Pure. */
export function observationFromAdsb(ac, nowMs) {
  if (!ac || !Number.isFinite(ac.lat) || !Number.isFinite(ac.lon)) return null;
  const onGround = ac.alt_baro === 'ground';
  const altFt = onGround ? 0 : Number.isFinite(ac.alt_geom) ? ac.alt_geom : ac.alt_baro;
  const seen = Number.isFinite(ac.seen_pos) ? ac.seen_pos : Number.isFinite(ac.seen) ? ac.seen : 0;
  return {
    hex: String(ac.hex || '').toLowerCase().replace(/^~/, ''),
    callsign: String(ac.flight || '').trim() || null,
    reg: ac.r || null,
    type: ac.t || null,
    t: nowMs - Math.round(seen * 1000),
    lat: ac.lat,
    lon: ac.lon,
    altM: Number.isFinite(altFt) ? Math.round(altFt * FT_TO_M) : null,
    onGround,
    gsKt: Number.isFinite(ac.gs) ? Math.round(ac.gs) : null,
    track: Number.isFinite(ac.track) ? Math.round(ac.track) : null,
    climbFpm: Number.isFinite(ac.baro_rate) ? ac.baro_rate : Number.isFinite(ac.geom_rate) ? ac.geom_rate : null,
  };
}

function eventBase(type, obs, at) {
  return { type, at, hex: obs.hex, callsign: obs.callsign, reg: obs.reg, typeCode: obs.type, lat: obs.lat, lon: obs.lon, altM: obs.altM, track: obs.track };
}

/**
 * Krok sledovaného stroja. `obs` = posledné pozorovanie alebo null (adsb.fi ho nevidí).
 * Stav: { phase: 'unknown' | 'ground' | 'air', last: pozorovanie | null, airSince: ms | null }.
 * Udalosti: vzlet (prvé pozorovanie vo vzduchu po zemi/neznámom stave), pristatie (zem v dátach
 * alebo strata signálu nízko), strata_signalu (zmizol vysoko). Pure.
 */
export function stepTracked(prev, obs, nowMs) {
  const state = { phase: 'unknown', last: null, airSince: null, ...prev };
  const events = [];
  if (obs) {
    if (obs.onGround) {
      if (state.phase === 'air') events.push({ ...eventBase('pristatie', obs, obs.t), airport: nearestAirport([obs.lat, obs.lon], 15), sure: true });
      return { state: { phase: 'ground', last: obs, airSince: null }, events };
    }
    if (state.phase !== 'air') {
      // Letisko odletu len pri nízkom prvom bode — vysoko nad Záhrebom ešte neznamená „zo Záhrebu“.
      const low = Number.isFinite(obs.altM) && obs.altM <= DEPARTURE_MAX_ALT_M;
      events.push({ ...eventBase('vzlet', obs, obs.t), from: low ? nearestAirport([obs.lat, obs.lon], 80) : null, firstSeen: state.phase === 'unknown' });
      return { state: { phase: 'air', last: obs, airSince: obs.t }, events };
    }
    return { state: { ...state, last: obs }, events };
  }
  if (state.phase === 'air' && state.last && nowMs - state.last.t > LOST_AFTER_MS) {
    const low = Number.isFinite(state.last.altM) && state.last.altM < LANDING_ALT_M;
    const pos = [state.last.lat, state.last.lon];
    events.push(low
      ? { ...eventBase('pristatie', state.last, state.last.t), airport: nearestAirport(pos, 40), sure: false }
      : { ...eventBase('strata_signalu', state.last, state.last.t), near: nearestAirport(pos, 150) });
    return { state: { phase: low ? 'ground' : 'unknown', last: state.last, airSince: null }, events };
  }
  if (state.phase === 'unknown' && !state.last) return { state: { ...state, phase: 'ground' }, events };
  return { state, events };
}

/** Biznis/štátny stroj (nie bežná linka)? Sledované hexy vždy áno. Pure. */
export function isWatchWorthy(obs, trackedHexes = []) {
  if (!obs) return false;
  if (trackedHexes.includes(obs.hex)) return true;
  if (!obs.type || !BIZ_TYPES.has(obs.type)) return false;
  // Veľké typy (A319/A320/B737…) len vládne (SSG = Letka MV SR) alebo bez znaku leteckej spoločnosti.
  if (!AIRLINER_TYPES.has(obs.type)) return true;
  const cs = obs.callsign || '';
  return cs.startsWith('SSG') || !AIRLINE_CALLSIGN.test(cs);
}

/**
 * Odlety biznis/štátnych strojov z oblasti (stred [lat, lon], polomer km). `seen` = hex → ms
 * posledného ohlásenia (ochrana pred opakovaním). Pure — vráti nové `seen` a udalosti.
 */
export function stepArea(seen, list, area, nowMs, trackedHexes = []) {
  const next = Object.fromEntries(Object.entries(seen || {}).filter(([, t]) => nowMs - t < AREA_REPEAT_MS));
  const events = [];
  for (const obs of list) {
    if (!obs || obs.onGround || !isWatchWorthy(obs, trackedHexes)) continue;
    const km = kmBetween([obs.lat, obs.lon], area.center);
    if (km > area.radiusKm) continue;
    const climbing = Number.isFinite(obs.climbFpm) && obs.climbFpm >= DEPARTURE_MIN_CLIMB_FPM;
    const low = Number.isFinite(obs.altM) && obs.altM <= DEPARTURE_MAX_ALT_M;
    if (!climbing || !low || next[obs.hex]) continue;
    next[obs.hex] = nowMs;
    events.push({ ...eventBase('odlet_z_oblasti', obs, obs.t), area: area.name, km: Math.round(km), climbFpm: obs.climbFpm });
  }
  return { seen: next, events };
}

const TZ = 'Europe/Bratislava';
const hm = (ms) => new Date(ms).toLocaleString('sk-SK', { timeZone: TZ, day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
const label = (e) => [e.callsign, e.reg, e.typeCode].filter(Boolean).join(' · ') || e.hex;
const where = (a) => (a ? `${a.name} ${a.icao}${a.km ? ` (${a.km} km)` : ''}` : null);

/** Jednoriadková správa o udalosti (log, upozornenie). Pure. */
export function formatWatchEvent(e) {
  const alt = Number.isFinite(e.altM) ? `${e.altM.toLocaleString('sk-SK')} m` : 'výška ?';
  const pos = `${e.lat.toFixed(3)}, ${e.lon.toFixed(3)}`;
  const course = Number.isFinite(e.track) ? `, kurz ${e.track}°` : '';
  switch (e.type) {
    case 'vzlet':
      return `${e.firstSeen ? 'VO VZDUCHU' : 'VZLET'} ${label(e)} ${hm(e.at)} — ${where(e.from) || pos}, ${alt}${course}`;
    case 'pristatie':
      return `PRISTÁTIE${e.sure ? '' : ' (odhad, stratil signál nízko)'} ${label(e)} ${hm(e.at)} — ${where(e.airport) || pos}, ${alt}`;
    case 'strata_signalu':
      return `STRATA SIGNÁLU ${label(e)} ${hm(e.at)} — ${pos}, ${alt}${e.near ? `, najbližšie ${where(e.near)}` : ''}`;
    case 'odlet_z_oblasti':
      return `ODLET Z OBLASTI ${e.area}: ${label(e)} ${hm(e.at)} — ${e.km} km od stredu, ${alt}, stúpa ${e.climbFpm} ft/min${course}`;
    default:
      return `${e.type} ${label(e)} ${hm(e.at)}`;
  }
}
