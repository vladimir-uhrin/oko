// src/data/shipHistory.js
/**
 * @module shipHistory
 * @description História lode — čisté výpočty pre panel (2026-10-11, bod 7). Dáta idú zo
 * záznamu na disku (/api/ais-live/history, shipHistoryStore.js); tu je zhrnutie, interpolácia
 * polohy v čase, rozdelenie trasy na úseky s príjmom a medzery (mimo pokrytia prijímačov)
 * a riadky textu. Všetko bez DOM a Cesia.
 */
import { greatCircleKm } from './vesselDestination.js';

/** Ponuka rozsahu (dni). */
export const SHIP_HISTORY_RANGES = Object.freeze([1, 7, 30, 90, 365]);
/** Medzera dlhšia než toto (s) = loď bola mimo príjmu; kreslí sa prerušovane. */
export const SHIP_HISTORY_GAP_SEC = 2 * 3600;
/** Rýchlosti prehrávania (× reálny čas): hodina za minútu … deň za 6 s. */
export const SHIP_REPLAY_SPEEDS = Object.freeze([60, 600, 3600, 14400]);

/** @returns {Promise<{samples: Array, total: number, first: number|null}>} */
export async function fetchShipHistory(mmsi, days = 7, fetchImpl = globalThis.fetch?.bind(globalThis)) {
  const res = await fetchImpl(`/api/ais-live/history?mmsi=${encodeURIComponent(mmsi)}&days=${encodeURIComponent(days)}`, { headers: { Accept: 'application/json' } });
  if (!res?.ok) throw new Error(`history ${res?.status || 'failed'}`);
  const body = await res.json();
  const samples = (Array.isArray(body?.samples) ? body.samples : [])
    .filter((s) => Number.isFinite(s?.t) && Number.isFinite(s?.lat) && Number.isFinite(s?.lon))
    .sort((a, b) => a.t - b.t);
  return { samples, total: Number(body?.total) || samples.length, first: Number.isFinite(body?.first) ? body.first : null };
}

/**
 * Zhrnutie: začiatok, koniec, prejdené km (len úseky s príjmom + medzery priamkou), max a
 * priemerná rýchlosť v pohybe. Pure.
 */
export function shipHistorySummary(samples) {
  if (!Array.isArray(samples) || !samples.length) return null;
  let km = 0;
  let maxSog = null;
  let sogSum = 0;
  let sogN = 0;
  let gaps = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i];
    if (Number.isFinite(s.sog)) {
      maxSog = maxSog === null ? s.sog : Math.max(maxSog, s.sog);
      if (s.sog >= 1) { sogSum += s.sog; sogN += 1; }
    }
    if (i) {
      const p = samples[i - 1];
      km += greatCircleKm(p.lat, p.lon, s.lat, s.lon);
      if (s.t - p.t > SHIP_HISTORY_GAP_SEC) gaps += 1;
    }
  }
  return {
    startT: samples[0].t,
    endT: samples.at(-1).t,
    points: samples.length,
    distanceKm: Math.round(km),
    maxSog,
    avgSog: sogN ? Math.round((sogSum / sogN) * 10) / 10 : null,
    gaps,
  };
}

/** Uhol cez 0/360 najkratšou cestou. */
function lerpAngle(a, b, f) {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (a + d * f + 360) % 360;
}

/**
 * Poloha v čase t (s): lineárne medzi susednými bodmi; `gap` = medzi nimi bola medzera v príjme
 * (poloha je len odhad priamkou). Pure.
 */
export function interpolateShipSample(samples, t) {
  if (!samples?.length) return null;
  if (t <= samples[0].t) return { ...samples[0], gap: false };
  const last = samples.at(-1);
  if (t >= last.t) return { ...last, gap: false };
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid; else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const f = (t - a.t) / Math.max(1, b.t - a.t);
  const gap = b.t - a.t > SHIP_HISTORY_GAP_SEC;
  const sog = Number.isFinite(a.sog) && Number.isFinite(b.sog) ? a.sog + (b.sog - a.sog) * f : (a.sog ?? b.sog ?? null);
  const cog = Number.isFinite(a.cog) && Number.isFinite(b.cog) ? lerpAngle(a.cog, b.cog, f) : (a.cog ?? b.cog ?? null);
  return { t, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, sog, cog, gap };
}

/**
 * Úseky s príjmom (plná čiara) a medzery (prerušovaná). Pure.
 * @returns {{runs: Array<Array<{lat:number, lon:number}>>, gaps: Array<[object, object]>}}
 */
export function splitShipRuns(samples, gapSec = SHIP_HISTORY_GAP_SEC) {
  const runs = [];
  const gaps = [];
  let run = [];
  for (let i = 0; i < (samples?.length || 0); i += 1) {
    const s = samples[i];
    if (i && s.t - samples[i - 1].t > gapSec) {
      if (run.length) runs.push(run);
      gaps.push([samples[i - 1], s]);
      run = [];
    }
    run.push(s);
  }
  if (run.length) runs.push(run);
  return { runs, gaps };
}

/** „10. 10. 02:57 UTC". Pure. */
export function shipTimeUtc(tS, lang = 'sk') {
  if (!Number.isFinite(tS)) return '—';
  const d = new Date(tS * 1000);
  const hm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return lang === 'sk' ? `${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${hm} UTC` : `${d.toISOString().slice(0, 10)} ${hm} UTC`;
}

const num = (v, lang, digits = 1) => (lang === 'sk' ? v.toFixed(digits).replace('.', ',') : v.toFixed(digits));

/** Riadok aktuálnej polohy prehrávania. Pure. */
export function shipSampleLine(sample, t, lang = 'sk') {
  if (!sample) return '';
  return [
    shipTimeUtc(sample.t, lang),
    Number.isFinite(sample.sog) ? `${num(sample.sog, lang)} kn` : '',
    Number.isFinite(sample.cog) ? `${Math.round(sample.cog)}°` : '',
    `${num(Math.abs(sample.lat), lang, 3)}° ${sample.lat >= 0 ? 'N' : 'S'} ${num(Math.abs(sample.lon), lang, 3)}° ${sample.lon >= 0 ? 'E' : 'W'}`,
    sample.gap ? t('shiphistory.gap') : '',
  ].filter(Boolean).join(' · ');
}

/** Riadok zhrnutia. Pure. */
export function shipSummaryLine(summary, t, lang = 'sk') {
  if (!summary) return '';
  return [
    `${shipTimeUtc(summary.startT, lang)} – ${shipTimeUtc(summary.endT, lang)}`,
    t('shiphistory.distance', { km: summary.distanceKm.toLocaleString(lang === 'sk' ? 'sk-SK' : 'en-GB') }),
    Number.isFinite(summary.avgSog) ? t('shiphistory.avg', { kn: num(summary.avgSog, lang) }) : '',
    Number.isFinite(summary.maxSog) ? t('shiphistory.max', { kn: num(summary.maxSog, lang) }) : '',
    t('shiphistory.points', { n: summary.points }),
    summary.gaps ? t('shiphistory.gaps', { n: summary.gaps }) : '',
  ].filter(Boolean).join(' · ');
}

/** Graf rýchlosti: n hodnôt 0..1 (null = medzera v príjme). Pure. */
export function shipSpeedSeries(samples, n = 160) {
  const s = shipHistorySummary(samples);
  if (!s || s.endT <= s.startT) return null;
  const max = Math.max(1, s.maxSog ?? 1);
  const values = [];
  for (let i = 0; i < n; i += 1) {
    const p = interpolateShipSample(samples, s.startT + ((s.endT - s.startT) * i) / (n - 1));
    values.push(p.gap || !Number.isFinite(p.sog) ? null : Math.max(0, Math.min(1, p.sog / max)));
  }
  return { values, maxSog: s.maxSog, startT: s.startT, endT: s.endT };
}
