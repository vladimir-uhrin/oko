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

/** Zastávka: body do `radiusKm` od prvého bodu zastávky aspoň `minSec`. */
export const SHIP_STOP_MIN_SEC = 2 * 3600;
export const SHIP_STOP_RADIUS_KM = 2;

/**
 * Zastávky na trase (prístav, kotvisko): súvislý úsek, kde loď ostala do 2 km od miesta aspoň
 * 2 h. Bod zastávky = priemer. Pure.
 * @returns {Array<{startT:number, endT:number, lat:number, lon:number, points:number}>}
 */
export function detectShipStops(samples, { minSec = SHIP_STOP_MIN_SEC, radiusKm = SHIP_STOP_RADIUS_KM } = {}) {
  const stops = [];
  const list = Array.isArray(samples) ? samples : [];
  let i = 0;
  while (i < list.length) {
    const a = list[i];
    let j = i;
    let sumLat = 0;
    let sumLon = 0;
    while (j < list.length && greatCircleKm(a.lat, a.lon, list[j].lat, list[j].lon) <= radiusKm) { sumLat += list[j].lat; sumLon += list[j].lon; j += 1; }
    const n = j - i;
    if (n >= 2 && list[j - 1].t - a.t >= minSec) {
      stops.push({ startT: a.t, endT: list[j - 1].t, lat: sumLat / n, lon: sumLon / n, points: n });
      i = j;
    } else {
      i += 1;
    }
  }
  return stops;
}

/** „2 d 5 h", „7 h", „45 min". Pure. */
export function shipDurationLabel(sec, lang = 'sk') {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const dayUnit = lang === 'sk' ? 'd' : 'd';
  if (d > 0) return h ? `${d} ${dayUnit} ${h} h` : `${d} ${dayUnit}`;
  if (h > 0) return m ? `${h} h ${m} min` : `${h} h`;
  return `${m} min`;
}

const xmlEscape = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const isoOf = (tS) => new Date(tS * 1000).toISOString();

/** Trasa ako GPX 1.1 (trk s bodmi, čas a rýchlosť v extensions). Pure. */
export function shipHistoryGpx(samples, { name = '', mmsi = '' } = {}) {
  const pts = (samples || []).map((s) => `    <trkpt lat="${s.lat.toFixed(5)}" lon="${s.lon.toFixed(5)}"><time>${isoOf(s.t)}</time>${Number.isFinite(s.sog) ? `<extensions><sog>${s.sog}</sog>${Number.isFinite(s.cog) ? `<cog>${s.cog}</cog>` : ''}</extensions>` : ''}</trkpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="OKO okolive.sk" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${xmlEscape(name || mmsi)}</name>${mmsi ? `<desc>MMSI ${xmlEscape(mmsi)} · AIS positions recorded by OKO (okolive.sk)</desc>` : ''}</metadata>
  <trk><name>${xmlEscape(name || mmsi)}</name><trkseg>
${pts}
  </trkseg></trk>
</gpx>
`;
}

/** Trasa ako KML (LineString + zastávky ako body). Pure. */
export function shipHistoryKml(samples, { name = '', mmsi = '', stops = [] } = {}) {
  const coords = (samples || []).map((s) => `${s.lon.toFixed(5)},${s.lat.toFixed(5)},0`).join(' ');
  const marks = (stops || []).map((st) => `    <Placemark><name>${xmlEscape(st.label || 'stop')}</name><TimeSpan><begin>${isoOf(st.startT)}</begin><end>${isoOf(st.endT)}</end></TimeSpan><Point><coordinates>${st.lon.toFixed(5)},${st.lat.toFixed(5)},0</coordinates></Point></Placemark>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <name>${xmlEscape(name || mmsi)}</name>
  <Placemark><name>${xmlEscape(name || mmsi)}</name><Style><LineStyle><color>ffe6d05f</color><width>3</width></LineStyle></Style><LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString></Placemark>
${marks}
</Document></kml>
`;
}
