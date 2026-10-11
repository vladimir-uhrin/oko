// src/data/vesselFollowStatus.js
/**
 * @module vesselFollowStatus
 * @description Stav sledovanej lode a prechody vyplávala/priplávala — čisté funkcie spoločné
 * pre prehliadač (followedVessels.js, toast) aj server (strážca sledovaných lodí vo vite.config.js,
 * Web Push pri zatvorenej stránke, 2026-10-11). Bez DOM, bez Cesia.
 */

/** Na ceste: aspoň toľko uzlov (pod tým manévruje v prístave alebo stojí). */
export const VESSEL_UNDERWAY_MIN_KN = 3;
/** AIS navigačný stav: 1 kotví, 5 zakotvená pri móle (moored). */
const NAV_ANCHORED = 1;
const NAV_MOORED = 5;

/**
 * Cieľ z textu AIS na čítanie: „WILMINGTON.NC.USA" → „Wilmington NC USA", „NLRTM" ostáva. Pure.
 * Kódy (do 3 písmen alebo LOCODE) zostávajú veľkými písmenami.
 */
export function prettyAisDestination(text) {
  const words = String(text || '').replace(/[._>]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return null;
  if (words.length === 1 && /^[A-Z]{2}[A-Z0-9]{3}$/.test(words[0])) return words[0];
  return words.map((w) => (w.length <= 3 || /\d/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join(' ');
}

/**
 * Stav lode zo živého AIS a plavby z registra (čistá funkcia).
 * @param {{sog?: number|null, navStatus?: number|null}|null} live kontakt v dosahu
 * @param {{voyage?: object|null, destinationPort?: object|null, destination?: string|null}|null} info /api/vessel-info
 * @returns {{status: 'underway'|'port'|'anchor'|'stopped'|'unknown', port: string|null, to: string|null, source: 'live'|'register'|null}}
 */
export function vesselFollowStatus(live, info) {
  const voyage = info?.voyage || null;
  const to = info?.destinationPort?.name || (typeof info?.destination === 'string' ? prettyAisDestination(info.destination) : null) || null;
  // Register: príchod po odchode = v prístave, odchod = na ceste.
  const regInPort = Boolean(voyage?.lastPort && Number.isFinite(voyage.arrivedAt) && !Number.isFinite(voyage.departedAt));
  const regUnderway = Boolean(voyage?.lastPort && Number.isFinite(voyage.departedAt));
  if (live) {
    const sog = Number(live.sog);
    const nav = Number(live.navStatus);
    if (Number.isFinite(sog) && sog >= VESSEL_UNDERWAY_MIN_KN && nav !== NAV_MOORED) {
      return { status: 'underway', port: regUnderway ? voyage.lastPort : null, to, source: 'live' };
    }
    if (nav === NAV_MOORED || (regInPort && Number.isFinite(sog) && sog < 1)) {
      return { status: 'port', port: regInPort ? voyage.lastPort : null, to: null, source: 'live' };
    }
    if (nav === NAV_ANCHORED) return { status: 'anchor', port: null, to, source: 'live' };
    if (Number.isFinite(sog)) return { status: 'stopped', port: null, to, source: 'live' };
  }
  if (regInPort) return { status: 'port', port: voyage.lastPort, to: null, source: 'register' };
  if (regUnderway) return { status: 'underway', port: voyage.lastPort, to, source: 'register' };
  return { status: 'unknown', port: null, to: null, source: null };
}

/**
 * Udalosti na upozornenie (čistá funkcia). Kotva/stojí nič nehlási (manévre, čakanie na rejde);
 * „vyplávala" = z prístavu alebo kotvy na cestu, „priplávala" = z cesty do prístavu.
 * @param {Map<string, {status: string}>|null} prev null = základ, nič nehlási
 * @param {Map<string, {status: string}>} next
 * @returns {Array<{key: string, type: 'departed'|'arrived'}>}
 */
export function vesselFollowTransitions(prev, next) {
  const events = [];
  if (!prev) return events;
  for (const [key, s] of next) {
    const before = prev.get(key)?.status;
    if (!before || before === 'unknown') continue;
    if (s.status === 'underway' && (before === 'port' || before === 'anchor')) events.push({ key, type: 'departed' });
    else if (s.status === 'port' && before === 'underway') events.push({ key, type: 'arrived' });
  }
  return events;
}

