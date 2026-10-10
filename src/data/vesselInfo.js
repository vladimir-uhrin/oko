// src/data/vesselInfo.js
/**
 * @module vesselInfo
 * @description Klient /api/vessel-info: register lode (IMO, podrobný typ,
 * rok stavby, GT, DWT) a fotka podľa MMSI (2026-10-10). Pamäťová cache na
 * session, súbežné dopyty sa zlúčia, po zlyhaní pauza — fotka a register sú
 * doplnok, nie dáta, nesmú zahltiť server pri prelete myšou cez flotilu.
 */

/** Po zlyhaní (sieť, 429, 5xx) sa to isté MMSI neskúša skôr než po tomto čase. */
export const VESSEL_INFO_RETRY_MS = 5 * 60 * 1000;

const state = {
  /** @type {Map<string, object|null>} MMSI → info (null = v registri nie je) */
  known: new Map(),
  /** @type {Map<string, Promise<object|null>>} */
  inflight: new Map(),
  /** @type {Map<string, number>} */
  failedAt: new Map(),
  fetchImpl: null,
  now: () => Date.now(),
};

function normalizeMmsi(mmsi) {
  const text = String(mmsi ?? '').trim();
  return /^\d{9}$/.test(text) ? text : null;
}

/**
 * Už známe info bez dopytu (synchrónne — karta sa prekresľuje každú sekundu).
 * undefined = ešte sa nepýtalo, null = register loď nemá.
 * @param {string} mmsi
 */
export function cachedVesselInfo(mmsi) {
  const key = normalizeMmsi(mmsi);
  return key ? state.known.get(key) : undefined;
}

/**
 * Info o lodi (cache → server). Nikdy nevyhodí; zlyhanie = null.
 * @param {string} mmsi
 * @returns {Promise<object|null>}
 */
export function lookupVesselInfo(mmsi) {
  const key = normalizeMmsi(mmsi);
  if (!key) return Promise.resolve(null);
  if (state.known.has(key)) return Promise.resolve(state.known.get(key));
  if (state.inflight.has(key)) return state.inflight.get(key);
  const failedAt = state.failedAt.get(key);
  if (Number.isFinite(failedAt) && state.now() - failedAt < VESSEL_INFO_RETRY_MS) return Promise.resolve(null);
  const fetchImpl = state.fetchImpl || (typeof fetch === 'function' ? (url) => fetch(url) : null);
  if (!fetchImpl) return Promise.resolve(null);
  const job = (async () => {
    try {
      const res = await fetchImpl(`/api/vessel-info?mmsi=${key}`);
      if (!res?.ok) { state.failedAt.set(key, state.now()); return null; }
      const info = await res.json();
      const usable = info && (info.imo || info.typeDetail || info.photo || info.yearBuilt) ? info : null;
      state.known.set(key, usable);
      return usable;
    } catch {
      state.failedAt.set(key, state.now());
      return null;
    }
  })().finally(() => state.inflight.delete(key));
  state.inflight.set(key, job);
  return job;
}

/**
 * Fotka v tvare, ktorý pozná kartička pod kurzorom (src, link, kredit).
 * @param {string} mmsi
 * @returns {Promise<?{kind: 'vessel', src: string, link: string}>}
 */
export async function lookupVesselPhoto(mmsi) {
  const info = await lookupVesselInfo(mmsi);
  if (!info?.photo?.src) return null;
  return { kind: 'vessel', src: info.photo.src, link: info.photo.src };
}

/** Test seam. */
export function _setVesselInfoFetchForTest(fetchImpl, now) {
  state.fetchImpl = fetchImpl || null;
  if (typeof now === 'function') state.now = now;
}
export function _resetVesselInfoForTest() {
  state.known.clear();
  state.inflight.clear();
  state.failedAt.clear();
  state.fetchImpl = null;
  state.now = () => Date.now();
}
