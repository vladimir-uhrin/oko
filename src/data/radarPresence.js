// src/data/radarPresence.js
// Ktoré zrážkové radary sú práve zapnuté (2026-10-08, vlastník: radar „musí to vidieť" aj pri zapnutom vetre).
// Ako na Windy: radar NAHRÁDZA farebné pole meteo vrstvy — drapéria poľa (10 km, bez hĺbkového testu) by ho
// inak úplne prekryla. Radary (shmuRadar.js a jeho inštancia OPERA) sa tu hlásia, meteoLayer.js počúva.
// Pobrežia, mená miest, prúdnice a časová os meteo vrstvy ostávajú.

const active = new Set();
const listeners = new Set();

export function setRadarActive(id, on) {
  const had = active.has(id);
  if (on) active.add(id); else active.delete(id);
  if (had !== Boolean(on)) for (const fn of [...listeners]) { try { fn(anyRadarActive()); } catch { /* poslucháč nesmie zhodiť radar */ } }
}

export function anyRadarActive() { return active.size > 0; }

/** @returns {() => void} odhlásenie */
export function onRadarPresenceChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Len pre testy. */
export function _resetRadarPresenceForTest() { active.clear(); listeners.clear(); }
