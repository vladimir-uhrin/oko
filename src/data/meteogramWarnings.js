// src/data/meteogramWarnings.js
// Výstraha SHMÚ priamo v páse predpovede pre miesto (2026-10-08, vlastník „1, 2" z návrhov): po kliknutí
// na mapu sa zistí okres bodu a jeho platné / ohlásené výstrahy — aj keď vrstva výstrah nie je zapnutá
// (Windy ukazuje výstrahy v detaile miesta vždy). Mimo Slovenska sa nič nesťahuje.
// Čisté pomôcky + jeden lenivý načítač (polygóny okresov raz, výstrahy cez server cache 5 min).

import { DISTRICTS_URL } from './shmuWarningsLayer.js';
import { WARNINGS_URL, WARNING_LEVELS, isActiveAt } from './weatherWarnings.js';

/** Obdĺžnik Slovenska s rezervou — mimo neho sa okres nehľadá ani nesťahuje. */
export const SK_BBOX = Object.freeze({ south: 47.6, north: 49.7, west: 16.7, east: 22.7 });
const CLIENT_WARNINGS_TTL_MS = 2 * 60_000;

export function inSlovakiaBox(lat, lon) {
  return lat >= SK_BBOX.south && lat <= SK_BBOX.north && lon >= SK_BBOX.west && lon <= SK_BBOX.east;
}

function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Okres, v ktorom bod leží: { code, name } alebo null. Pure. */
export function districtAtPoint(districts, lat, lon) {
  for (const [code, d] of Object.entries(districts || {})) {
    if ((d?.rings || []).some((ring) => inRing(lon, lat, ring))) return { code, name: d.name };
  }
  return null;
}

/** Výstrahy okresu, ktoré ešte neskončili, najvyšší stupeň a najskorší začiatok prvé. Pure. */
export function warningsForDistrict(warnings, code, nowMs = Date.now()) {
  return (Array.isArray(warnings) ? warnings : [])
    .filter((w) => (w.codes || []).includes(code) && (!w.expires || Date.parse(w.expires) > nowMs))
    .sort((a, b) => b.level - a.level || String(a.onset).localeCompare(String(b.onset)));
}

/**
 * Pre každý stĺpec meteogramu (čas t, šírka stepMs) najvyšší stupeň výstrahy, ktorá v tom okne platí,
 * a jeho farba; 0 / null bez výstrahy. Pure.
 */
export function columnWarningLevels(columns, warnings, stepMs = 3 * 3600_000) {
  return (columns || []).map((c) => {
    let level = 0;
    for (const w of warnings || []) {
      const on = Date.parse(w.onset || '');
      const off = Date.parse(w.expires || '');
      const startsBeforeEnd = !Number.isFinite(on) || on < c.t + stepMs;
      const endsAfterStart = !Number.isFinite(off) || off > c.t;
      if (startsBeforeEnd && endsAfterStart && w.level > level) level = w.level;
    }
    return { level, color: WARNING_LEVELS[level]?.color || null };
  });
}

export { isActiveAt };

/**
 * Lenivý načítač pre pás predpovede: (lat, lon) → { district, warnings } alebo null (mimo SR, chyba).
 * @param {(url: string) => Promise<Response>} doFetch
 */
export function createPointWarningsLookup(doFetch = (...args) => fetch(...args), now = () => Date.now()) {
  let districts = null;
  let districtsLoad = null;
  let cached = null; // { at, warnings }
  async function loadDistricts() {
    if (districts) return districts;
    if (!districtsLoad) {
      districtsLoad = (async () => {
        const res = await doFetch(DISTRICTS_URL);
        if (!res?.ok) throw new Error(`okresy HTTP ${res?.status}`);
        districts = await res.json();
        return districts;
      })().finally(() => { districtsLoad = null; });
    }
    return districtsLoad;
  }
  async function loadWarnings() {
    if (cached && now() - cached.at < CLIENT_WARNINGS_TTL_MS) return cached.warnings;
    const res = await doFetch(WARNINGS_URL);
    if (!res?.ok) throw new Error(`warnings HTTP ${res?.status}`);
    const payload = await res.json();
    const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
    cached = { at: now(), warnings };
    return warnings;
  }
  return async function lookup(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inSlovakiaBox(lat, lon)) return null;
    try {
      const [d, warnings] = await Promise.all([loadDistricts(), loadWarnings()]);
      const district = districtAtPoint(d, lat, lon);
      if (!district) return null;
      return { district, warnings: warningsForDistrict(warnings, district.code, now()) };
    } catch {
      return null;
    }
  };
}
