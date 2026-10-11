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
/** Poloha a plavba z registra starnú — po tomto čase sa info vypýta znova (stará ostáva, kým nepríde nová). */
export const VESSEL_INFO_REFRESH_MS = 10 * 60 * 1000;

const state = {
  /** @type {Map<string, object|null>} MMSI → info (null = v registri nie je) */
  known: new Map(),
  /** @type {Map<string, Promise<object|null>>} */
  inflight: new Map(),
  /** @type {Map<string, number>} */
  failedAt: new Map(),
  /** @type {Map<string, number>} MMSI → kedy prišlo info */
  fetchedAt: new Map(),
  /** @type {Map<string, string>} dočasný kľúč lode z oceánu → skutočné MMSI */
  alias: new Map(),
  fetchImpl: null,
  now: () => Date.now(),
};

function normalizeMmsi(mmsi) {
  const text = String(mmsi ?? '').trim();
  return /^\d{9}$/.test(text) ? text : null;
}

/**
 * Loď z oceánu bez MMSI (dočasný kľúč „mt-<ID registra>", 2026-10-11): MMSI sa zistí na
 * požiadanie (/api/vessel-info/ship) a info sa uloží aj pod dočasný kľúč. Inak by kartička
 * pri prejdení myšou ostala bez registra a fotky (vlastník: „veľa je bez fotiek").
 */
const PSEUDO_RE = /^mt-(\d{1,10})$/;
function infoKey(id) {
  const text = String(id ?? '').trim();
  return normalizeMmsi(text) || (PSEUDO_RE.test(text) ? text : null);
}

/**
 * Už známe info bez dopytu (synchrónne — karta sa prekresľuje každú sekundu).
 * undefined = ešte sa nepýtalo, null = register loď nemá.
 * @param {string} mmsi
 */
export function cachedVesselInfo(mmsi) {
  const key = infoKey(mmsi);
  return key ? state.known.get(key) : undefined;
}

/**
 * Info o lodi (cache → server). Nikdy nevyhodí; zlyhanie = null.
 * @param {string} mmsi
 * @returns {Promise<object|null>}
 */
export function lookupVesselInfo(mmsi) {
  const key = infoKey(mmsi);
  if (!key) return Promise.resolve(null);
  if (PSEUDO_RE.test(key)) return lookupPseudo(key);
  const fetched = state.fetchedAt.get(key);
  const fresh = Number.isFinite(fetched) && state.now() - fetched < VESSEL_INFO_REFRESH_MS;
  if (state.known.has(key) && fresh) return Promise.resolve(state.known.get(key));
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
      const usable = info && (info.imo || info.typeDetail || info.photo || info.yearBuilt || info.voyage || info.lastPosition || info.destination || info.portCalls) ? info : null;
      state.known.set(key, usable);
      state.fetchedAt.set(key, state.now());
      return usable;
    } catch {
      state.failedAt.set(key, state.now());
      return null;
    }
  })().finally(() => state.inflight.delete(key));
  state.inflight.set(key, job);
  return job;
}

/** Dočasný kľúč lode z oceánu → MMSI (server) → info pod oboma kľúčmi. */
function lookupPseudo(key) {
  if (state.known.has(key)) {
    const real = state.alias.get(key);
    // MMSI už poznáme: obnov info cez neho (čerstvosť rieši bežná cesta).
    return real ? lookupVesselInfo(real).then((info) => { state.known.set(key, info); return info; }) : Promise.resolve(state.known.get(key));
  }
  if (state.inflight.has(key)) return state.inflight.get(key);
  const failedAt = state.failedAt.get(key);
  if (Number.isFinite(failedAt) && state.now() - failedAt < VESSEL_INFO_RETRY_MS) return Promise.resolve(null);
  const fetchImpl = state.fetchImpl || (typeof fetch === 'function' ? (url) => fetch(url) : null);
  if (!fetchImpl) return Promise.resolve(null);
  const shipId = PSEUDO_RE.exec(key)[1];
  const job = (async () => {
    try {
      const res = await fetchImpl(`/api/vessel-info/ship?shipId=${shipId}`);
      if (!res?.ok) { state.failedAt.set(key, state.now()); return null; }
      const ship = await res.json();
      const real = normalizeMmsi(ship?.mmsi);
      if (!real) { state.known.set(key, null); return null; }
      state.alias.set(key, real);
      const info = await lookupVesselInfo(real);
      const merged = info ? { ...info, mmsi: info.mmsi || real } : { mmsi: real, name: ship.name || null };
      state.known.set(key, merged);
      return merged;
    } catch {
      state.failedAt.set(key, state.now());
      return null;
    }
  })().finally(() => state.inflight.delete(key));
  state.inflight.set(key, job);
  return job;
}

/** Skutočné MMSI lode z oceánu, keď už je známe (inak null). */
export function realMmsiFor(id) {
  const text = String(id ?? '').trim();
  return normalizeMmsi(text) || state.alias.get(text) || null;
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
  state.fetchedAt.clear();
  state.alias.clear();
  state.fetchImpl = null;
  state.now = () => Date.now();
}
