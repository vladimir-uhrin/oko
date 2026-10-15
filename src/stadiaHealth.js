// src/stadiaHealth.js — strážca podkladu Stadia (2026-10-15).
//
// Skúšobný plán Stadia Professional končí 20. 10. 2026; účet potom ostáva na bezplatnom pláne
// (stadiamaps.com/pricing: 200 000 kreditov mesačne, nekomerčné použitie, „No additional usage").
// Po vyčerpaní limitu alebo pri strate autorizácie domény Stadia odmieta dlaždice (401/403/429)
// a meteo by ostalo bez podkladu. Strážca nepýta nič navyše — počúva skutočné chyby dlaždíc
// (mapStackController, errorEvent poskytovateľa): po STADIA_FAIL_THRESHOLD odmietnutiach je Stadia
// na STADIA_BLOCK_MS „mimo" (zapamätá sa v prehliadači, ďalšie načítanie ju rovno obíde) a podklad
// sa prepne na bezplatný bez kľúča (meteo: NASA Blue Marble, ostatné štýly: OpenStreetMap).

import { STADIA_KEYLESS_HOSTS, stadiaAuthorizedHost } from './stadiaHosts.js';

export const STADIA_TILE_HOST = 'tiles.stadiamaps.com';
/** Odpovede, ktoré znamenajú „Stadia nás teraz neobslúži" (nie výpadok jednej dlaždice). */
export const STADIA_FAIL_STATUSES = Object.freeze([401, 403, 429]);
export const STADIA_FAIL_THRESHOLD = 3;
export const STADIA_BLOCK_MS = 6 * 3600 * 1000;
export const STADIA_STORAGE_KEY = 'oko.stadia.blockedUntil';
/** Náhrada podľa štýlu: tmavý → NASA Blue Marble (ako meteo bez Stadia), svetlé → OpenStreetMap. */
export const STADIA_FALLBACK_STACK = Object.freeze({
  'stadia-dark': 'gibs-blue-marble',
  'stadia-smooth': 'osm',
  'stadia-outdoors': 'osm',
  'stadia-terrain': 'osm',
});

/** Je URL dlaždica Stadia? Pure. */
export function isStadiaUrl(url) {
  return String(url || '').includes(STADIA_TILE_HOST);
}

/** Lokálny vývoj — Stadia tam ide bez účtu a limitu účtu sa netýka. Pure. */
function keylessHost(hostname) {
  const h = String(hostname || '').trim().toLowerCase();
  return STADIA_KEYLESS_HOSTS.includes(h) || h.endsWith('.localhost');
}

/**
 * @param {{ storage?: Storage|null, now?: () => number }} [options]
 */
export function createStadiaHealth({ storage = null, now = () => Date.now() } = {}) {
  let failures = 0;
  let blockedUntil = 0;
  const listeners = new Set();
  try {
    const saved = Number(storage?.getItem?.(STADIA_STORAGE_KEY));
    if (Number.isFinite(saved) && saved > now()) blockedUntil = saved;
  } catch { /* súkromné okno / zakázané úložisko — len v pamäti */ }

  return {
    /** Je Stadia teraz „mimo"? */
    blocked: () => now() < blockedUntil,
    blockedUntil: () => blockedUntil,
    /**
     * Chyba dlaždice Stadia. Vráti true práve vtedy, keď sa Stadia touto chybou stala „mimo".
     * @param {number|undefined} status HTTP kód (undefined = sieť / iné — nepočíta sa)
     */
    noteTileError(status) {
      if (!STADIA_FAIL_STATUSES.includes(Number(status))) return false;
      if (now() < blockedUntil) return false;
      failures += 1;
      if (failures < STADIA_FAIL_THRESHOLD) return false;
      failures = 0;
      blockedUntil = now() + STADIA_BLOCK_MS;
      try { storage?.setItem?.(STADIA_STORAGE_KEY, String(blockedUntil)); } catch { /* len v pamäti */ }
      for (const fn of listeners) { try { fn(); } catch { /* poslucháč nesmie zhodiť strážcu */ } }
      return true;
    },
    onBlocked(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Smie hostiteľ teraz použiť Stadia? Autorizovaný a (lokálne vždy, inak) nie „mimo". */
    usableHost(hostname) {
      if (!stadiaAuthorizedHost(hostname)) return false;
      return keylessHost(hostname) || now() >= blockedUntil;
    },
  };
}

let _shared = null;
/** Spoločný strážca prehliadača (localStorage); v Node bez úložiska. */
export function stadiaHealth() {
  if (!_shared) {
    let storage = null;
    try { storage = globalThis.localStorage || null; } catch { storage = null; }
    _shared = createStadiaHealth({ storage });
  }
  return _shared;
}

/** Smie hostiteľ teraz použiť Stadia (autorizácia + strážca)? Prázdny hostiteľ = testy/Node → podľa autorizácie. */
export function stadiaUsableHost(hostname) {
  const h = String(hostname || '').trim();
  if (!h) return true;
  return stadiaHealth().usableHost(h);
}
