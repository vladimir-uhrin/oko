// src/data/flightProfile.js
/**
 * @module flightProfile
 * @description Mini výškový a rýchlostný profil letu pre kartu sledovaného
 * stroja (2026-09-07, používateľ zvolil návrh „mini výškový profil").
 *
 * Dead-reckoning história (`_positionHistory`) drží len 5 fixov — na graf
 * za 30 minút je krátka. Tento modul drží VLASTNÝ riedky záznam: pre KAŽDÝ
 * stroj jednu vzorku za minútu (epoch, výška, rýchlosť) v kruhovom
 * Float64Array bufferi, takže graf je k dispozícii hneď pri začiatku
 * sledovania a nie až po 30 minútach čakania. Pamäť: 13 000 strojov × 31
 * vzoriek × 3 čísla × 8 B ≈ 10 MB v najhoršom prípade, žiadne objekty
 * per vzorka.
 *
 * `profileRowFromSamples` je čistý skladač riadku karty: normalizované
 * krivky 0..1 (výška v akcente, rýchlosť tlmená) + popisky. Bez DOM, bez
 * Cesia; čas sa vždy podáva.
 */
import { formatAltitude, formatSpeedRange } from '../units.js';

/** Minimálny odstup dvoch vzoriek jedného stroja (ms). */
export const PROFILE_SAMPLE_INTERVAL_MS = 60_000;
/** Kapacita kruhového bufferu — 30 min po minúte + aktuálna. */
export const PROFILE_MAX_SAMPLES = 31;
/** Okno grafu (ms). */
export const PROFILE_WINDOW_MS = 30 * 60_000;
/** Pod toľkoto vzoriek (alebo pod 2 min rozpätia) sa riadok nekreslí. */
export const PROFILE_MIN_SAMPLES = 3;
export const PROFILE_MIN_SPAN_MS = 2 * 60_000;
/** Plochý let: pod týmto rozsahom sa krivka kreslí v strede, nie „od nuly". */
export const PROFILE_FLAT_ALT_M = 300;
export const PROFILE_FLAT_SPEED_MPS = 20;

const STRIDE = 3;

/**
 * Kruhový sklad vzoriek per stroj.
 * @param {object} [options]
 * @param {number} [options.intervalMs]
 * @param {number} [options.maxSamples]
 */
export function createProfileStore({ intervalMs = PROFILE_SAMPLE_INTERVAL_MS, maxSamples = PROFILE_MAX_SAMPLES } = {}) {
  /** @type {Map<string, {buf: Float64Array, len: number, head: number, lastMs: number}>} */
  const rings = new Map();
  return {
    /**
     * Zapíš vzorku, ak od poslednej prešiel interval. Vracia true pri zápise.
     * @param {string} icao24
     * @param {number} epochMs
     * @param {number} altitudeM
     * @param {number} speedMps
     */
    record(icao24, epochMs, altitudeM, speedMps) {
      if (!icao24 || !Number.isFinite(epochMs)) return false;
      let ring = rings.get(icao24);
      if (!ring) {
        ring = { buf: new Float64Array(maxSamples * STRIDE), len: 0, head: 0, lastMs: Number.NEGATIVE_INFINITY };
        rings.set(icao24, ring);
      }
      if (epochMs - ring.lastMs < intervalMs) return false;
      let slot;
      if (ring.len < maxSamples) {
        slot = (ring.head + ring.len) % maxSamples;
        ring.len += 1;
      } else {
        slot = ring.head;
        ring.head = (ring.head + 1) % maxSamples;
      }
      const o = slot * STRIDE;
      ring.buf[o] = epochMs;
      ring.buf[o + 1] = Number.isFinite(altitudeM) ? altitudeM : NaN;
      ring.buf[o + 2] = Number.isFinite(speedMps) ? speedMps : NaN;
      ring.lastMs = epochMs;
      return true;
    },
    /**
     * Chronologické vzorky stroja (alokuje — volá sa len pre sledovaný stroj).
     * @param {string} icao24
     * @returns {Array<{epochMs: number, altitudeM: number, speedMps: number}>}
     */
    samples(icao24) {
      const ring = rings.get(icao24);
      if (!ring) return [];
      const out = new Array(ring.len);
      for (let i = 0; i < ring.len; i += 1) {
        const o = ((ring.head + i) % maxSamples) * STRIDE;
        out[i] = { epochMs: ring.buf[o], altitudeM: ring.buf[o + 1], speedMps: ring.buf[o + 2] };
      }
      return out;
    },
    delete(icao24) { rings.delete(icao24); },
    clear() { rings.clear(); },
    get size() { return rings.size; },
  };
}

/** FL340 nad hranicou hladín, inak „12 500 ft"; metricky „3 810 m" (units.js). Pure. */
export function levelLabel(altitudeM) {
  return formatAltitude(Number(altitudeM) || 0);
}

/** Normalizuj rad na 0..1; plochý rad (rozsah pod `flatRange`) ide do stredu. Pure. */
export function normalizeSeries(values, flatRange) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (!(range >= flatRange)) return values.map(() => 0.5);
  return values.map((v) => (v - min) / range);
}

/**
 * Riadok profilu pre kartu. Pure.
 * @param {Array<{epochMs: number, altitudeM: number, speedMps: number}>} samples chronologické
 * @param {number} nowMs
 * @param {object} [options]
 * @param {number} [options.windowMs]
 * @param {(key: string, vars?: object) => string} [options.translate]
 * @returns {?{altitude: number[], speed: number[], label: string, sublabel: string, spanMin: number}}
 */
export function profileRowFromSamples(samples, nowMs, { windowMs = PROFILE_WINDOW_MS, translate = (k, v) => `${k} ${JSON.stringify(v)}` } = {}) {
  if (!Array.isArray(samples) || !Number.isFinite(nowMs)) return null;
  const from = nowMs - windowMs;
  const rows = samples.filter((s) => s && Number.isFinite(s.epochMs) && s.epochMs >= from && s.epochMs <= nowMs + 1000
    && Number.isFinite(s.altitudeM));
  if (rows.length < PROFILE_MIN_SAMPLES) return null;
  const spanMs = rows[rows.length - 1].epochMs - rows[0].epochMs;
  if (spanMs < PROFILE_MIN_SPAN_MS) return null;
  const alt = rows.map((s) => s.altitudeM);
  const spdRaw = rows.map((s) => (Number.isFinite(s.speedMps) ? s.speedMps : NaN));
  const spdKnown = spdRaw.filter(Number.isFinite);
  const first = rows[0];
  const last = rows[rows.length - 1];
  const spanMin = Math.max(1, Math.round(spanMs / 60_000));
  const label = `${levelLabel(first.altitudeM)} → ${levelLabel(last.altitudeM)}`;
  const speedPart = spdKnown.length >= 2 ? formatSpeedRange(spdKnown[0], spdKnown[spdKnown.length - 1]) : '';
  const sublabel = [speedPart, translate('card.profile-span', { min: spanMin })].filter(Boolean).join(' · ');
  return {
    altitude: normalizeSeries(alt, PROFILE_FLAT_ALT_M),
    speed: spdKnown.length >= 2 ? normalizeSeries(spdRaw.map((v) => (Number.isFinite(v) ? v : spdKnown[0])), PROFILE_FLAT_SPEED_MPS) : [],
    label,
    sublabel,
    spanMin,
  };
}
