// src/data/radarPresence.js
// Ktoré zrážkové radary sú práve zapnuté a čo ukazujú (2026-10-08, vlastník: radar „musí to vidieť" aj pri
// zapnutom vetre; potom „začni" — časová os pri radare ukazuje meranie, nie predpoveď).
// Ako na Windy: radar NAHRÁDZA farebné pole meteo vrstvy — drapéria poľa (10 km, bez hĺbkového testu) by ho
// inak úplne prekryla — a časová os meteo vrstvy prejde na snímky radaru (posledná hodina merania).
// Radary (shmuRadar.js a jeho inštancia OPERA) sa tu hlásia a registrujú ovládanie; meteoLayer.js počúva.

/** Ktorý radar ovláda časovú os, keď ich je zapnutých viac: Európa pred Slovenskom. */
export const RADAR_PRIORITY = Object.freeze(['opera-radar', 'shmu-radar']);

const active = new Set();
const controllers = new Map(); // id → { frames(), current(), showIndex(i), play(), pause(), playing(), label }
const listeners = new Set();

function emit(kind) {
  for (const fn of [...listeners]) { try { fn(anyRadarActive(), kind); } catch { /* poslucháč nesmie zhodiť radar */ } }
}

export function setRadarActive(id, on) {
  const had = active.has(id);
  if (on) active.add(id); else active.delete(id);
  if (had !== Boolean(on)) emit('presence');
}

export function anyRadarActive() { return active.size > 0; }

/** Ovládanie snímok radaru pre časovú os (null = odhlásiť). */
export function registerRadarController(id, controller) {
  if (controller) controllers.set(id, controller); else controllers.delete(id);
  emit('presence');
}

/** Radar zobrazil inú snímku alebo dostal nové snímky. */
export function notifyRadarFrame(id) {
  if (active.has(id)) emit('frame');
}

/** Radar, ktorý ovláda časovú os: zapnutý, s ovládaním, podľa RADAR_PRIORITY. */
export function primaryRadar() {
  for (const id of [...RADAR_PRIORITY, ...active]) {
    if (active.has(id) && controllers.has(id)) return { id, ...controllers.get(id) };
  }
  return null;
}

/** @param {(anyActive: boolean, kind: 'presence'|'frame') => void} fn @returns {() => void} odhlásenie */
export function onRadarPresenceChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let fieldVisible = false;
/**
 * Je farebné pole meteo vrstvy práve nakreslené? Výstrahy a stanice sa nad ním musia kresliť vysoko (nad
 * drapériou 10 km); bez neho idú k zemi, inak by sa v sklopenom 3D pohľade posunuli od svojho miesta.
 */
export function setMeteoFieldVisible(on) { fieldVisible = Boolean(on); }
export function isMeteoFieldVisible() { return fieldVisible; }

/** Len pre testy. */
export function _resetRadarPresenceForTest() { active.clear(); controllers.clear(); listeners.clear(); fieldVisible = false; }
