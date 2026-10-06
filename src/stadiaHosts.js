// src/stadiaHosts.js — kde smie bežať Stadia bez kľúča (pure, bez Cesia; číta ho meteoLayer
// aj layerBasemap — ten druhý NESMIE importovať meteoLayer, aby sa meteo načítavalo lenivo).
//
// Stadia autorizuje cez Origin/Referer, nie api_key v URL (pravidlo 3: kľúče nie do prehliadača).
// Localhost funguje bez účtu; verejná doména musí byť autorizovaná v účte Stadia.

/** Hostitelia, ktoré Stadia obslúži bez účtu (dokumentácia: localhost / 127.0.0.1). */
export const STADIA_KEYLESS_HOSTS = Object.freeze(['localhost', '127.0.0.1', '[::1]', '::1']);
/** Domény autorizované v účte Stadia (2026-10-06, vlastnosť „Default Property“: *.okolive.sk, všetky poddomény). */
export const STADIA_AUTHORIZED_DOMAINS = Object.freeze(['okolive.sk']);

/**
 * Je hostiteľ pre Stadia autorizovaný (localhost bez kľúča alebo doména z účtu, vrátane poddomén)?
 * @param {string|null|undefined} hostname
 * @returns {boolean}
 */
export function stadiaAuthorizedHost(hostname) {
  const h = String(hostname || '').trim().toLowerCase();
  if (!h) return false;
  if (STADIA_KEYLESS_HOSTS.includes(h) || h.endsWith('.localhost')) return true;
  return STADIA_AUTHORIZED_DOMAINS.some((d) => h === d || h.endsWith('.' + d));
}
