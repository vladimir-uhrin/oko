// src/mideastIndicators.js — ukazovatele BLÍZKEHO VÝCHODU bez mapy (etapa 6, 2026-11-06):
//
//  - HUMANITÁRNE SÚČTY (`createMideastHumanitarian`): súčty Tech for Palestine pre dejiská Gaza,
//    Západný breh a južný Libanon (src/data/mideastHumanitarian.js). Bez čipu — karta v paneli sa
//    ukáže sama pri dejisku, ktoré má súhrn; čísla sú hlásenia strany konfliktu a karta to menuje.
//  - INTERNET · OONI (`createMideastInternet`): podiel blokovaných meraní za 7 dní proti 30 dňom
//    po krajinách dejiska (src/data/mideastInternet.js). Čip v paneli (predvolene zapnutý).
//
// Oba sú čisté stavové stroje (žiadne Cesium, žiadny DOM): setActive(dejisko) → stiahnu raz za
// reláciu (obnova po 30 min), getState/onChange pre panel. Rovnaká disciplína ako vrstvy: nič sa
// nesťahuje pred prvým dejiskom a chyba len označí stav (panel ju ukáže), nikdy nehádžu.

import { fetchMideastHumanitarian, humanitarianKeyForTheatre, humanitarianRows } from './data/mideastHumanitarian.js';
import { fetchMideastInternet, internetCountriesForTheatre } from './data/mideastInternet.js';

export const INDICATORS_RELOAD_MS = 30 * 60_000;

/** Spoločná kostra: jeden dopyt, cache 30 min, stav + poslucháči. */
function createIndicator({ fetchImpl, now, activeFor, pick }) {
  let _enabled = true;
  let _theatre = null; // id dejiska alebo null
  let _active = false;
  let _data = null; // { at, json }
  let _loading = false;
  let _error = null;
  let _destroyed = false;
  const listeners = new Set();
  const emit = () => { const s = getState(); for (const fn of listeners) { try { fn(s); } catch { /* */ } } };
  async function load({ force = false } = {}) {
    if (_loading || _destroyed) return;
    if (!force && _data && now() - _data.at < INDICATORS_RELOAD_MS) return;
    _loading = true; _error = null; emit();
    try {
      const json = await fetchImpl();
      if (_destroyed) return;
      _data = { at: now(), json };
    } catch (error) {
      _error = error?.status === 404 ? 'missing' : (error?.message || String(error));
    } finally { _loading = false; if (!_destroyed) emit(); }
  }
  async function sync() {
    if (_destroyed) return;
    emit();
    if (_enabled && _active) await load();
  }
  function getState() {
    return { enabled: _enabled, active: _active, theatre: _theatre, loading: _loading, error: _error, loaded: Boolean(_data), fetchedAt: _data?.json?.fetchedAt ?? null, source: _data?.json?.source ?? null, ...pick(_data?.json ?? null, _theatre) };
  }
  return {
    setEnabled(on) { _enabled = Boolean(on); return sync(); },
    isEnabled: () => _enabled,
    /** Dejisko (objekt s id alebo id); mimo zoznamu je ukazovateľ neaktívny. */
    setActive(sceneOrId) {
      const id = sceneOrId && typeof sceneOrId === 'object' ? sceneOrId.id : (sceneOrId ? String(sceneOrId) : null);
      _active = Boolean(id) && activeFor(id);
      _theatre = _active ? id : null;
      return sync();
    },
    refresh() { return load({ force: true }); },
    getState,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy() { _destroyed = true; listeners.clear(); },
  };
}

/**
 * HUMANITÁRNE SÚČTY: stav nesie `rows` [{ id, value }] pre aktívne dejisko, `block` (surové súčty
 * s dátumom hlásenia) a `key` (gaza | west_bank | lebanon).
 */
export function createMideastHumanitarian({ fetchImpl = fetchMideastHumanitarian, now = () => Date.now() } = {}) {
  return createIndicator({
    fetchImpl, now,
    activeFor: (id) => Boolean(humanitarianKeyForTheatre(id)),
    pick: (json, theatre) => {
      const key = humanitarianKeyForTheatre(theatre);
      const block = key && json?.summary ? (json.summary[key] || null) : null;
      return { key, block, rows: json?.summary ? humanitarianRows(json.summary, theatre) : [] };
    },
  });
}

/**
 * INTERNET · OONI: stav nesie `countries` [{ cc, recent, baseline, delta, level, measurements, lastDay, sparkline }]
 * v poradí krajín dejiska (prehľad = všetky).
 */
export function createMideastInternet({ fetchImpl = fetchMideastInternet, now = () => Date.now() } = {}) {
  return createIndicator({
    fetchImpl, now,
    activeFor: (id) => Boolean(internetCountriesForTheatre(id)),
    pick: (json, theatre) => {
      const wanted = internetCountriesForTheatre(theatre) || [];
      const countries = json?.countries ? wanted.filter((cc) => json.countries[cc]).map((cc) => ({ cc, ...json.countries[cc] })) : [];
      return { wanted, countries, explorer: json?.source?.explorer || null };
    },
  });
}
