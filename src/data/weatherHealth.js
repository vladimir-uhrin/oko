// src/data/weatherHealth.js
// Čerstvosť dát počasia pre stráženie v admine (2026-10-09, po chybe, keď sa predpoveď GFS niekoľko dní
// neobnovovala a nikto o tom nevedel). Stavové adresy /health vracajú 503, keď sú dáta staré — plánovač admina
// ich vzorkuje každých 10 min a upozornenie (admin + e-mail, ak je nastavený) príde po feedDownMinutes.
// Čisté funkcie bez I/O.

/**
 * 14 h: sťahovanie beží každých 6 h a nový beh GFS je dostupný ~4,5 h po svojom čase → tesne pred ďalším
 * sťahovaním má beh bežne až ~12,75 h. Pri 12 h by „zastaraný" svietil 45 min každých 6 h zbytočne.
 */
export const METEO_MAX_RUN_AGE_H = 14;
export const RADAR_MAX_AGE_MIN = 45;
export const STATIONS_MAX_AGE_MIN = 30;

function age(iso, nowMs, unitMs) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? Math.round(((nowMs - t) / unitMs) * 10) / 10 : null;
}

/** Beh modelu GFS: starší než 14 h = sťahovanie zlyháva alebo sa neobnovuje. Pure. */
export function meteoRunHealth(runIso, nowMs = Date.now(), maxH = METEO_MAX_RUN_AGE_H) {
  const ageHours = age(runIso, nowMs, 3_600_000);
  if (ageHours === null) return { ok: false, run: null, ageHours: null, reason: 'beh modelu neznámy' };
  const ok = ageHours <= maxH;
  return { ok, run: runIso, ageHours, reason: ok ? null : `beh GFS je starý ${ageHours} h (limit ${maxH} h)` };
}

/** Radar Európy: najnovšia snímka staršia než 45 min (zdroj mešká ~15 min). Pure. */
export function radarHealth(latestIso, nowMs = Date.now(), maxMin = RADAR_MAX_AGE_MIN) {
  const ageMinutes = age(latestIso, nowMs, 60_000);
  if (ageMinutes === null) return { ok: false, latest: null, ageMinutes: null, reason: 'žiadna snímka radaru' };
  const ok = ageMinutes <= maxMin;
  return { ok, latest: latestIso, ageMinutes, reason: ok ? null : `posledná snímka radaru je stará ${ageMinutes} min (limit ${maxMin} min)` };
}

/** Stanice SHMÚ: posledné meranie staršie než 30 min (súbory chodia každých 5 min). Pure. */
export function stationsHealth(observedIso, nowMs = Date.now(), maxMin = STATIONS_MAX_AGE_MIN) {
  const ageMinutes = age(observedIso, nowMs, 60_000);
  if (ageMinutes === null) return { ok: false, observedAt: null, ageMinutes: null, reason: 'žiadne meranie staníc' };
  const ok = ageMinutes <= maxMin;
  return { ok, observedAt: observedIso, ageMinutes, reason: ok ? null : `posledné meranie staníc je staré ${ageMinutes} min (limit ${maxMin} min)` };
}

/** Výstrahy: odpoveď služby (createWeatherWarningsService.get) — chyba alebo podržané staré dáta = nie ok. Pure. */
export function warningsHealth(result) {
  if (!result || result.status !== 200) return { ok: false, reason: `výstrahy nedostupné (${result?.error || `HTTP ${result?.status}`})` };
  if (result.payload?.stale) return { ok: false, reason: 'MeteoAlarm neodpovedá, zobrazujú sa podržané výstrahy' };
  return { ok: true, warnings: result.payload?.warnings?.length ?? 0, fetchedAt: result.payload?.fetchedAt || null, reason: null };
}
