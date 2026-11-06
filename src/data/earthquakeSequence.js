// Dotrasy (2026-11-06): spojenie otrasov v 24-hodinovom katalógu do sekvencií
// „hlavný otras → dotrasy". Čisto geometrické pravidlo (čas po hlavnom otrase,
// slabšia magnitúda, vzdialenosť do polomeru podľa magnitúdy) — nie seizmologická
// klasifikácia; karta to označuje ako odhad OKO.
import { distanceKm } from './earthquakeCatalog.js';

/** Od tejto magnitúdy môže byť otras hlavným otrasom sekvencie. */
export const EARTHQUAKE_MAINSHOCK_MIN_MAG = 5;

/**
 * Polomer (km), do ktorého sa slabšie neskoršie otrasy považujú za dotrasy.
 * Veľkoryso podľa dĺžky zlomu: M5≈50 km, M6≈100, M7≈200, M8≈400 (strop 600). Pure.
 * @param {number} mag
 * @returns {number}
 */
export function aftershockRadiusKm(mag) {
  const m = Number.isFinite(mag) ? mag : 0;
  return Math.max(30, Math.min(600, 50 * Math.pow(2, m - 5)));
}

/**
 * @typedef {{role:'mainshock', aftershocks:number, strongest:{id:string, mag:number}|null}} MainshockLink
 * @typedef {{role:'aftershock', mainshockId:string, mainshockMag:number, mainshockPlace:string|null, deltaMs:number, distanceKm:number}} AftershockLink
 */

/**
 * Spojí otrasy do sekvencií. Silnejšie otrasy sa spracúvajú skôr; každý otras sa
 * priradí k najsilnejšiemu už prijatému hlavnému otrasu, ktorý ho predchádza
 * a leží v jeho polomere. Hlavný otras, ktorý je sám dotrasom, ďalšie otrasy nezbiera.
 * Pure, deterministické (poradie podľa magnitúdy, potom id).
 * @param {Array<{id:string, mag:number, lat:number, lon:number, time:number, place?:string|null}>} events
 * @returns {Map<string, MainshockLink|AftershockLink>}
 */
export function linkEarthquakeSequences(events) {
  const links = new Map();
  const list = (Array.isArray(events) ? events : []).filter(e => e && Number.isFinite(e.mag) && Number.isFinite(e.time)
    && Number.isFinite(e.lat) && Number.isFinite(e.lon) && typeof e.id === 'string');
  list.sort((a, b) => b.mag - a.mag || a.id.localeCompare(b.id));
  const mainshocks = [];
  for (const event of list) {
    const main = mainshocks.find(m => event.time > m.event.time && event.mag < m.event.mag
      && distanceKm(event, m.event) <= aftershockRadiusKm(m.event.mag));
    if (main) {
      main.aftershocks.push(event);
      links.set(event.id, { role: 'aftershock', mainshockId: main.event.id, mainshockMag: main.event.mag,
        mainshockPlace: main.event.place || null, deltaMs: event.time - main.event.time,
        distanceKm: distanceKm(event, main.event) });
    } else if (event.mag >= EARTHQUAKE_MAINSHOCK_MIN_MAG) {
      mainshocks.push({ event, aftershocks: [] });
    }
  }
  for (const { event, aftershocks } of mainshocks) {
    if (!aftershocks.length) continue;
    const strongest = aftershocks[0]; // zoznam je už zoradený podľa magnitúdy
    links.set(event.id, { role: 'mainshock', aftershocks: aftershocks.length, strongest: { id: strongest.id, mag: strongest.mag } });
  }
  return links;
}

/** „2 h 14 min" / „37 min" / „12 s" — pure, bez lokalizácie jednotiek (h/min/s sú medzinárodné). */
export function formatElapsed(ms) {
  const s = Math.max(0, Math.round(Number(ms) / 1000) || 0);
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60); const rest = min % 60;
  if (h < 24) return rest ? `${h} h ${rest} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} d ${h % 24} h`;
}

/**
 * Členovia sekvencie k vybranému otrasu (hlavný otras + všetky jeho dotrasy), alebo null, keď
 * otras do žiadnej sekvencie nepatrí. Výber dotrasu ukáže celú sekvenciu jeho hlavného otrasu. Pure.
 * @param {Map<string, object>} links výsledok linkEarthquakeSequences
 * @param {string|null} id vybraný otras
 * @returns {{mainshockId: string, members: Set<string>}|null}
 */
export function sequenceMembers(links, id) {
  const link = id ? links?.get?.(id) : null;
  if (!link) return null;
  const mainshockId = link.role === 'mainshock' ? id : link.mainshockId;
  const members = new Set([mainshockId]);
  for (const [other, entry] of links) if (entry.role === 'aftershock' && entry.mainshockId === mainshockId) members.add(other);
  return members.size > 1 ? { mainshockId, members } : null;
}
